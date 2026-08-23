const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = 'dist';
const OUT = path.join(process.cwd(), 'browser-evidence');
const THEME_KEY = 'sanpokai-theme-preference-v1';
fs.mkdirSync(OUT, { recursive: true });

function inlineDistHtml(source) {
  let html = source;
  html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (_, href) => {
    const file = path.join(DIST, href.replace(/^\/sanpokai-kikaku-portal\//, '').replace(/^\.\//, '').replace(/^\//, ''));
    return `<style>${fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  html = html.replace(/<script\b([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi, (_, before, src) => {
    const file = path.join(DIST, src.replace(/^\/sanpokai-kikaku-portal\//, '').replace(/^\.\//, '').replace(/^\//, ''));
    return `<script type="module">${fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
  });
  return html;
}

const INLINED = inlineDistHtml(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'));

async function installIsolatedEnvironment(page) {
  await page.goto('about:blank?qa=portal');
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
      value: query => query === media.media ? media : ({ ...media, media: query }),
    });
    window.__QA_THEME_MEDIA__ = media;
  });
}

async function selectTheme(page, currentLabel, id) {
  await page.getByRole('button', { name: `テーマ設定：${currentLabel}` }).click();
  await page.locator(`label[for="${id}"]`).click();
}

async function waitForSurfaceTokens(page) {
  await page.waitForFunction(() => {
    const tile = document.querySelector('.tool-tile');
    const panel = document.querySelector('.cds--header-panel');
    if (!tile || !panel) return false;

    const resolveColor = value => {
      const probe = document.createElement('span');
      probe.style.color = value;
      probe.style.position = 'fixed';
      probe.style.left = '-9999px';
      document.body.appendChild(probe);
      const result = getComputedStyle(probe).color;
      probe.remove();
      return result;
    };

    const tileStyle = getComputedStyle(tile);
    const panelStyle = getComputedStyle(panel);
    const expectedTileBg = resolveColor(tileStyle.getPropertyValue('--cds-layer').trim());
    const expectedTileText = resolveColor(tileStyle.getPropertyValue('--cds-text-primary').trim());
    const expectedPanelBg = resolveColor(panelStyle.getPropertyValue('--cds-layer').trim());

    return tileStyle.backgroundColor === expectedTileBg &&
      tileStyle.color === expectedTileText &&
      panelStyle.backgroundColor === expectedPanelBg;
  }, { timeout: 5000 });
}

async function focusFirstTileWithKeyboard(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
  let reached = false;
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.classList?.contains('tool-tile') === true);
    if (reached) break;
  }
  if (!reached) throw new Error('keyboard navigation did not reach the first tool tile');
  return page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return {
      outline: style.outline,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
}

async function run(browser, name, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', isMobile: viewport.width <= 430, hasTouch: viewport.width <= 430 });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await installIsolatedEnvironment(page);
  await page.setContent(INLINED, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'テーマ設定：システム設定' }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForSurfaceTokens(page);

  const initial = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.cds--tile--clickable').length,
    rows: document.querySelectorAll('.cds--structured-list-row').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.innerText,
    labels: [...document.querySelectorAll('.project-link')].map(node => node.textContent.trim()),
    hrefs: [...document.querySelectorAll('.project-link')].map(node => node.href),
  }));
  if (initial.tiles !== 4) throw new Error(`${name}: expected 4 Carbon tiles, got ${initial.tiles}`);
  if (initial.overflowX > 1) throw new Error(`${name}: initial overflow ${initial.overflowX}px`);
  for (const text of ['学務提出書類メーカー', '登山計画書メーカー', '山歩会フォームメーカー', 'サークル企画ツール', '過去に開いた企画']) {
    if (!initial.text.includes(text)) throw new Error(`${name}: missing ${text}`);
  }
  if (initial.labels[0] !== '夏山企画' || initial.labels[1] !== '春山企画') throw new Error(`${name}: project history ordering regression`);
  if (!initial.hrefs[0]?.includes('?room=ROOM-B')) throw new Error(`${name}: last-room link regression`);

  await selectTheme(page, 'システム設定', 'theme-dark');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForSurfaceTokens(page);

  const dark = await page.evaluate((key) => {
    const root = document.documentElement;
    const app = document.querySelector('.app-theme-root');
    const grid = document.querySelector('.tool-grid');
    const tile = document.querySelector('.tool-tile');
    const panel = document.querySelector('.cds--header-panel');
    const css = node => node ? getComputedStyle(node) : null;
    const prop = (node, name) => css(node)?.getPropertyValue(name).trim() || '';
    return {
      preference: localStorage.getItem(key),
      rootTheme: root.dataset.carbonTheme,
      rootClasses: root.className,
      appClasses: app?.className || '',
      gridClasses: grid?.className || '',
      rootBackgroundToken: prop(root, '--cds-background'),
      rootLayerToken: prop(root, '--cds-layer'),
      rootTextToken: prop(root, '--cds-text-primary'),
      gridLayerToken: prop(grid, '--cds-layer'),
      tileLayerToken: prop(tile, '--cds-layer'),
      tileTextToken: prop(tile, '--cds-text-primary'),
      bodyBg: css(document.body).backgroundColor,
      appBg: css(app)?.backgroundColor || '',
      tileBg: css(tile)?.backgroundColor || '',
      tileColor: css(tile)?.color || '',
      panelBg: css(panel)?.backgroundColor || '',
      overflowX: root.scrollWidth - root.clientWidth,
    };
  }, THEME_KEY);

  if (dark.preference !== 'dark' || dark.rootTheme !== 'g100') throw new Error(`${name}: dark preference failed: ${JSON.stringify(dark)}`);
  if ([dark.bodyBg, dark.appBg, dark.tileBg, dark.panelBg].includes('rgb(255, 255, 255)')) throw new Error(`${name}: white surface leaked: ${JSON.stringify(dark)}`);
  if (dark.overflowX > 1) throw new Error(`${name}: dark overflow ${dark.overflowX}px`);
  await page.screenshot({ path: path.join(OUT, `${name}-dark.png`), fullPage: true });

  await selectTheme(page, 'ダーク', 'theme-light');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForSurfaceTokens(page);
  if (await page.evaluate(key => localStorage.getItem(key), THEME_KEY) !== 'light') throw new Error(`${name}: light preference not persisted`);
  await page.screenshot({ path: path.join(OUT, `${name}-light.png`), fullPage: true });

  await selectTheme(page, 'ライト', 'theme-system');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForSurfaceTokens(page);
  await page.evaluate(() => window.__QA_THEME_MEDIA__.set(true));
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForSurfaceTokens(page);
  await page.evaluate(() => window.__QA_THEME_MEDIA__.set(false));
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForSurfaceTokens(page);

  await selectTheme(page, 'システム設定', 'theme-dark');
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForSurfaceTokens(page);
  await page.evaluate(() => window.__QA_THEME_MEDIA__.set(false));
  await page.waitForTimeout(50);
  if (await page.evaluate(() => document.documentElement.dataset.carbonTheme) !== 'g100') throw new Error(`${name}: explicit dark did not override OS`);

  await page.setContent(INLINED, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForSurfaceTokens(page);
  if (await page.evaluate(key => localStorage.getItem(key), THEME_KEY) !== 'dark') throw new Error(`${name}: theme lost on reload-equivalent render`);

  const focus = await focusFirstTileWithKeyboard(page);
  const focusInvisible = focus.outlineStyle === 'none' || focus.outlineWidth === '0px' || focus.outlineColor === 'rgba(0, 0, 0, 0)' || focus.outlineColor === 'transparent';
  if (focusInvisible && focus.boxShadow === 'none') throw new Error(`${name}: keyboard focus indicator missing: ${JSON.stringify(focus)}`);
  if (pageErrors.length) throw new Error(`${name}: page errors: ${pageErrors.join(' | ')}`);
  if (consoleErrors.length) throw new Error(`${name}: console errors: ${consoleErrors.join(' | ')}`);

  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ viewport, initial, dark, focus, pageErrors, consoleErrors }, null, 2));
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
