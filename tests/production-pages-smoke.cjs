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
    await page.getByRole('heading', { name: '山歩会企画ツール一覧', level: 1 }).waitFor({ timeout: 10000 });
    await page.getByRole('tab', { name: '最近の企画', exact: true }).waitFor({ timeout: 10000 });
  });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForAnimations(page);

  const portal = await page.evaluate(() => ({
    theme: document.documentElement.dataset.carbonTheme,
    tiles: document.querySelectorAll('.tool-tile').length,
    bodyTextLength: document.body.innerText.trim().length,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    formHref: [...document.querySelectorAll('.tool-tile')].find(node => node.textContent.includes('応募フォームメーカー'))?.getAttribute('href') || '',
  }));
  if (portal.tiles !== 4 || portal.bodyTextLength < 100) throw new Error(`portal production app did not render: ${JSON.stringify(portal)}`);
  if (portal.documentWidth > portal.viewportWidth + 1) throw new Error(`portal mobile overflow: ${portal.documentWidth} > ${portal.viewportWidth}`);
  if (!portal.formHref.includes('/form-maker/')) throw new Error(`form maker does not route through the same-origin route: ${portal.formHref}`);
  await page.screenshot({ path: `${OUT}/portal-mobile-light.png`, fullPage: true });

  await page.getByRole('button', { name: '表示テーマ：システム設定' }).click();
  await page.locator('label[for="theme-dark"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForAnimations(page);
  const portalDark = await page.evaluate(() => ({
    preference: localStorage.getItem('sanpokai-theme-preference-v1'),
    theme: document.documentElement.dataset.carbonTheme,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    tileBackground: getComputedStyle(document.querySelector('.tool-tile')).backgroundColor,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (portalDark.preference !== 'dark' || portalDark.theme !== 'g100') throw new Error(`portal dark theme failed: ${JSON.stringify(portalDark)}`);
  if ([portalDark.bodyBackground, portalDark.tileBackground].includes('rgb(255, 255, 255)')) throw new Error(`portal white leak in dark mode: ${JSON.stringify(portalDark)}`);
  if (portalDark.overflow > 1) throw new Error(`portal dark overflow: ${portalDark.overflow}`);
  await page.screenshot({ path: `${OUT}/portal-mobile-dark.png`, fullPage: true });

  const hostUrl = new URL('form-maker/', LIVE_URL).href;
  await openWithRetry(page, hostUrl, async () => {
    await page.getByRole('heading', { name: '応募フォームを作る', level: 1 }).waitFor({ timeout: 15000 });
    await page.getByLabel('企画名', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByRole('button', { name: /Googleフォームを作成/ }).waitFor({ state: 'visible', timeout: 10000 });
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
    submitDisabled: [...document.querySelectorAll('button')].find(button => button.innerText.includes('Googleフォームを作成'))?.disabled ?? null,
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

  const report = { status: response?.status() || null, liveUrl: LIVE_URL, portal, portalDark, mobile, desktop, firebaseWrites, pageErrors, consoleErrors };
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
