const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join('dist', 'index.html'), 'utf8');
const out = path.join(process.cwd(), 'browser-evidence');
fs.mkdirSync(out, { recursive: true });

function inlineDistHtml(source) {
  let result = source;
  result = result.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (_, href) => {
    const file = path.join('dist', href.replace(/^\/sanpokai-kikaku-portal\//, '').replace(/^\.\//, '').replace(/^\//, ''));
    return `<style>${fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  result = result.replace(/<script\b([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi, (_, before, src) => {
    const file = path.join('dist', src.replace(/^\/sanpokai-kikaku-portal\//, '').replace(/^\.\//, '').replace(/^\//, ''));
    return `<script type="module">${fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
  });
  return result;
}

const inlined = inlineDistHtml(html);

async function run(browser, name, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', isMobile: viewport.width <= 430, hasTouch: viewport.width <= 430 });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await page.goto(`about:blank?qa=${name}`);
  await page.evaluate(() => {
    const store = {
      syawari_last_room_id: 'ROOM-B',
      'sampokai_v10_split_ROOM-A': JSON.stringify({ roomName: '春山企画', lastUpdatedAt: 1000 }),
      'sampokai_v10_split_ROOM-B': JSON.stringify({ roomName: '夏山企画', lastUpdatedAt: 2000 }),
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: key => { delete store[key]; },
        clear: () => Object.keys(store).forEach(key => delete store[key]),
        key: index => Object.keys(store)[index] ?? null,
        get length() { return Object.keys(store).length; },
      },
    });
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: async () => true } });

    const listeners = new Set();
    const media = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
      dispatchEvent() { return true; },
      set(matches) {
        this.matches = matches;
        for (const listener of listeners) listener({ matches, media: this.media });
      },
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: query => query === '(prefers-color-scheme: dark)' ? media : ({ ...media, media: query }),
    });
    window.__QA_THEME_MEDIA__ = media;
  });

  await page.setContent(inlined, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'テーマ設定：システム設定' }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-carbon-theme') === 'white');

  const metrics = await page.evaluate(() => ({
    carbonTiles: document.querySelectorAll('.cds--tile--clickable').length,
    carbonStructuredRows: document.querySelectorAll('.cds--structured-list-row').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.innerText,
    projectLabels: [...document.querySelectorAll('.project-link')].map(a => a.textContent.trim()),
    projectHrefs: [...document.querySelectorAll('.project-link')].map(a => a.href),
  }));

  if (metrics.carbonTiles !== 4) throw new Error(`${name}: expected 4 Carbon clickable tiles, got ${metrics.carbonTiles}`);
  if (metrics.overflowX > 1) throw new Error(`${name}: horizontal overflow ${metrics.overflowX}px`);
  for (const text of ['学務提出書類メーカー', '登山計画書メーカー', '山歩会フォームメーカー', 'サークル企画ツール', '過去に開いた企画']) {
    if (!metrics.text.includes(text)) throw new Error(`${name}: missing ${text}`);
  }
  if (metrics.projectLabels[0] !== '夏山企画' || metrics.projectLabels[1] !== '春山企画') throw new Error(`${name}: project history ordering/name regression`);
  if (!metrics.projectHrefs[0]?.includes('?room=ROOM-B')) throw new Error(`${name}: last room project link regression`);

  const openThemePanel = async (label) => {
    const button = page.getByRole('button', { name: `テーマ設定：${label}` });
    await button.click();
    await page.getByText('表示テーマ', { exact: true }).first().waitFor();
  };
  const selectTheme = async (currentLabel, option) => {
    await openThemePanel(currentLabel);
    await page.getByLabel(option, { exact: true }).check();
  };

  await selectTheme('システム設定', 'ダーク');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  let dark = await page.evaluate(() => {
    const tile = document.querySelector('.tool-tile');
    const panel = document.querySelector('.cds--header-panel');
    return {
      preference: localStorage.getItem('sanpokai-theme-preference-v1'),
      rootTheme: document.documentElement.dataset.carbonTheme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      tileBg: tile ? getComputedStyle(tile).backgroundColor : '',
      tileColor: tile ? getComputedStyle(tile).color : '',
      panelBg: panel ? getComputedStyle(panel).backgroundColor : '',
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (dark.preference !== 'dark' || dark.rootTheme !== 'g100') throw new Error(`${name}: explicit dark not persisted/applied`);
  if (dark.bodyBg === 'rgb(255, 255, 255)' || dark.tileBg === 'rgb(255, 255, 255)' || dark.panelBg === 'rgb(255, 255, 255)') throw new Error(`${name}: white surface leaked into dark theme`);
  if (dark.overflowX > 1) throw new Error(`${name}: dark mode overflow ${dark.overflowX}px`);
  await page.screenshot({ path: path.join(out, `${name}-dark.png`), fullPage: true });

  await selectTheme('ダーク', 'ライト');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  if (await page.evaluate(() => localStorage.getItem('sanpokai-theme-preference-v1')) !== 'light') throw new Error(`${name}: explicit light not persisted`);
  await page.screenshot({ path: path.join(out, `${name}-light.png`), fullPage: true });

  await selectTheme('ライト', 'システム設定');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await page.evaluate(() => window.__QA_THEME_MEDIA__.set(true));
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await page.evaluate(() => window.__QA_THEME_MEDIA__.set(false));
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');

  await selectTheme('システム設定', 'ダーク');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await page.evaluate(() => window.__QA_THEME_MEDIA__.set(false));
  await page.waitForTimeout(50);
  if (await page.evaluate(() => document.documentElement.dataset.carbonTheme) !== 'g100') throw new Error(`${name}: explicit dark did not override system`);

  await page.setContent(inlined, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  if (await page.evaluate(() => localStorage.getItem('sanpokai-theme-preference-v1')) !== 'dark') throw new Error(`${name}: theme persistence lost on reload-equivalent render`);

  const focus = await page.locator('.tool-tile').first().evaluate((node) => {
    node.focus();
    const style = getComputedStyle(node);
    return { outline: style.outline, boxShadow: style.boxShadow };
  });
  if ((focus.outline === 'none' || focus.outline.startsWith('rgb(0, 0, 0) 0px')) && focus.boxShadow === 'none') throw new Error(`${name}: focus indicator not visible`);

  if (errors.length) throw new Error(`${name}: page errors: ${errors.join(' | ')}`);
  if (consoleErrors.length) throw new Error(`${name}: console errors: ${consoleErrors.join(' | ')}`);

  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ viewport, metrics, dark, focus, errors, consoleErrors }, null, 2));
  await context.close();
}

(async () => {
  fs.mkdirSync(process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy', { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps'],
    env: { ...process.env, CHROMIUM_POLICY_DIR: process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy' },
  });
  try {
    await run(browser, 'mobile-390x844', { width: 390, height: 844 });
    await run(browser, 'desktop-1280x900', { width: 1280, height: 900 });
  } finally {
    await browser.close();
  }
  console.log('Portal three-state Carbon theme browser smoke passed.');
})().catch(error => { console.error(error); process.exit(1); });
