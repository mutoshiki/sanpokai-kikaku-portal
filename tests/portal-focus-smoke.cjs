const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = 'dist';
const THEME_KEY = 'sanpokai-theme-preference-v1';

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

async function installEnvironment(page, preference) {
  await page.goto('about:blank?qa=portal-focus');
  await page.evaluate(({ key, preference }) => {
    const store = { [key]: preference };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: name => Object.prototype.hasOwnProperty.call(store, name) ? store[name] : null,
        setItem: (name, value) => { store[name] = String(value); },
        removeItem: name => { delete store[name]; },
        clear: () => Object.keys(store).forEach(name => delete store[name]),
        key: index => Object.keys(store)[index] ?? null,
        get length() { return Object.keys(store).length; },
      },
    });
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: async () => true } });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: query => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return true; },
      }),
    });
  }, { key: THEME_KEY, preference });
}

function shadowIsTransparent(value) {
  if (!value || value === 'none') return true;
  return /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value) || /transparent/i.test(value);
}

async function waitForFocusedTile(page) {
  await page.evaluate(async () => {
    const el = document.activeElement;
    if (!el?.classList?.contains('tool-tile')) return;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = el.getAnimations({ subtree: true });
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

async function run(browser, preference, expectedTheme) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await context.newPage();
  await installEnvironment(page, preference);
  await page.setContent(INLINED, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.waitForFunction(theme => document.documentElement.dataset.carbonTheme === theme, expectedTheme);

  const toolLinks = await page.locator('.tool-tile').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  if (!toolLinks.some(href => href && href.includes('/form-maker/'))) {
    throw new Error(`${preference}: form maker tile is not routed through the themed host`);
  }

  await page.evaluate(() => document.activeElement?.blur?.());
  let reached = false;
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.classList?.contains('tool-tile') === true);
    if (reached) break;
  }
  if (!reached) throw new Error(`${preference}: keyboard navigation did not reach a tool tile`);
  await waitForFocusedTile(page);

  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return {
      className: el?.className || '',
      boxShadow: style.boxShadow,
      outline: style.outline,
      color: style.color,
      textToken: style.getPropertyValue('--cds-text-primary').trim(),
    };
  });

  if (!focus.textToken) throw new Error(`${preference}: Carbon text-primary token is unavailable`);
  if (shadowIsTransparent(focus.boxShadow)) {
    throw new Error(`${preference}: keyboard focus ring is transparent after transition: ${JSON.stringify(focus)}`);
  }

  await page.screenshot({ path: `browser-evidence/focus-${preference}.png`, fullPage: true });
  await context.close();
  return focus;
}

(async () => {
  fs.mkdirSync('browser-evidence', { recursive: true });
  fs.mkdirSync(process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy', { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps'],
    env: { ...process.env, CHROMIUM_POLICY_DIR: process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy' },
  });
  try {
    const light = await run(browser, 'light', 'white');
    const dark = await run(browser, 'dark', 'g100');
    fs.writeFileSync('browser-evidence/focus-strict.json', JSON.stringify({ light, dark }, null, 2));
  } finally {
    await browser.close();
  }
  console.log('Strict Carbon keyboard focus smoke passed for light and dark.');
})().catch(error => { console.error(error); process.exit(1); });
