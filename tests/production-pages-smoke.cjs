const fs = require('fs');
const { chromium } = require('playwright');

const LIVE_URL = (process.env.LIVE_URL || 'https://mutoshiki.github.io/sanpokai-kikaku-portal/').replace(/\/?$/, '/');
const OUT = process.env.SMOKE_OUT || 'production-pages-evidence';
fs.mkdirSync(OUT, { recursive: true });

async function openWithRetry(page, url, ready) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
      await ready();
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 12) await page.waitForTimeout(5000);
    }
  }
  throw lastError;
}

async function waitForAnimations(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = document.documentElement.getAnimations({ subtree: true });
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const firebaseWrites = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route(/https:\/\/(?:identitytoolkit|securetoken)\.googleapis\.com|https:\/\/[^/]*firebaseio\.com/, async route => {
    // Anonymous Auth may use POST to establish the browser identity. The smoke
    // blocks all Firebase traffic, but only RTDB mutations count as app writes.
    if (/firebaseio\.com/.test(route.request().url()) && route.request().method() !== 'GET') {
      firebaseWrites.push({ method: route.request().method() });
    }
    await route.abort('blockedbyclient');
  });

  const response = await openWithRetry(page, LIVE_URL, async () => {
    await page.waitForURL(url => url.origin === 'https://mutoshiki.github.io' && url.pathname === '/circle-kikaku-tools/', { timeout: 10000 });
  });
  const portal = { redirectedTo: page.url(), status: response?.status() || null };
  if (new URL(portal.redirectedTo).pathname !== '/circle-kikaku-tools/') throw new Error(`portal did not redirect to the circle tools: ${JSON.stringify(portal)}`);
  await page.screenshot({ path: `${OUT}/portal-redirect-mobile.png`, fullPage: true });

  const hostUrl = new URL('form-maker/', LIVE_URL).href;
  await openWithRetry(page, hostUrl, async () => {
    await page.getByRole('heading', { name: '応募フォーム', level: 1 }).waitFor({ timeout: 15000 });
    await page.getByLabel('企画名（必須）', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: /応募フォームを作成/ }).waitFor({ state: 'visible', timeout: 10000 });
  });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForAnimations(page);

  const mobile = await page.evaluate(() => ({
    title: document.title,
    theme: document.documentElement.dataset.carbonTheme,
    iframes: document.querySelectorAll('iframe').length,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    headerBackground: getComputedStyle(document.querySelector('.cds--header')).backgroundColor,
    inputCount: document.querySelectorAll('input').length,
    submitDisabled: [...document.querySelectorAll('button')].find(button => button.innerText.includes('応募フォームを作成'))?.disabled ?? null,
  }));
  if (mobile.iframes !== 0) throw new Error(`same-origin form-maker route rendered an iframe: ${mobile.iframes}`);
  if (mobile.theme !== 'g100' || mobile.headerBackground !== 'rgb(22, 22, 22)') throw new Error(`form-maker dark theme or black Carbon header failed: ${JSON.stringify(mobile)}`);
  if (mobile.documentWidth > mobile.viewportWidth + 1) throw new Error(`form-maker mobile overflow: ${JSON.stringify(mobile)}`);
  if (mobile.inputCount < 4 || mobile.submitDisabled !== true) throw new Error(`form-maker did not remain usable without an available backend: ${JSON.stringify(mobile)}`);
  await page.screenshot({ path: `${OUT}/form-maker-mobile-dark.png`, fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await waitForAnimations(page);
  const desktop = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    headerBackground: getComputedStyle(document.querySelector('.cds--header')).backgroundColor,
  }));
  if (desktop.documentWidth > desktop.viewportWidth + 1) throw new Error(`form-maker desktop overflow: ${JSON.stringify(desktop)}`);
  if (desktop.headerBackground !== 'rgb(22, 22, 22)') throw new Error(`form-maker desktop header is not black: ${JSON.stringify(desktop)}`);
  if (firebaseWrites.length) throw new Error(`production smoke attempted an external write: ${JSON.stringify(firebaseWrites)}`);
  if (pageErrors.length) throw new Error(`production page errors: ${pageErrors.join(' | ')}`);

  const report = { status: response?.status() || null, liveUrl: LIVE_URL, portal, mobile, desktop, firebaseWrites, pageErrors, consoleErrors };
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
