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
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const response = await openWithRetry(page, LIVE_URL, async () => {
    await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 10000 });
  });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForAnimations(page);

  const initial = await page.evaluate(() => ({
    theme: document.documentElement.dataset.carbonTheme,
    tiles: document.querySelectorAll('.tool-tile').length,
    bodyTextLength: document.body.innerText.trim().length,
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    formHref: [...document.querySelectorAll('.tool-tile')].find(node => node.textContent.includes('応募フォームメーカー'))?.getAttribute('href') || '',
  }));
  if (initial.tiles !== 4 || initial.bodyTextLength < 100) throw new Error(`portal production app did not render: ${JSON.stringify(initial)}`);
  if (initial.documentWidth > initial.viewportWidth + 1) throw new Error(`portal mobile overflow: ${initial.documentWidth} > ${initial.viewportWidth}`);
  if (!initial.formHref.includes('/form-maker/')) throw new Error(`form maker does not route through themed host: ${initial.formHref}`);
  await page.screenshot({ path: `${OUT}/portal-mobile-light.png`, fullPage: true });

  await page.getByRole('button', { name: 'テーマ設定：システム設定' }).click();
  await page.locator('label[for="theme-dark"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForAnimations(page);
  const dark = await page.evaluate(() => ({
    preference: localStorage.getItem('sanpokai-theme-preference-v1'),
    theme: document.documentElement.dataset.carbonTheme,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    tileBackground: getComputedStyle(document.querySelector('.tool-tile')).backgroundColor,
    tileColor: getComputedStyle(document.querySelector('.tool-tile')).color,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (dark.preference !== 'dark' || dark.theme !== 'g100') throw new Error(`portal dark theme failed: ${JSON.stringify(dark)}`);
  if ([dark.bodyBackground, dark.tileBackground].includes('rgb(255, 255, 255)')) throw new Error(`portal white leak in dark mode: ${JSON.stringify(dark)}`);
  if (dark.overflow > 1) throw new Error(`portal dark overflow: ${dark.overflow}`);
  await page.screenshot({ path: `${OUT}/portal-mobile-dark.png`, fullPage: true });

  const hostUrl = new URL('form-maker/', LIVE_URL).href;
  await openWithRetry(page, hostUrl, async () => {
    await page.locator('#form-maker-frame').waitFor({ state: 'visible', timeout: 10000 });
  });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'g100');
  const host = await page.evaluate(() => {
    const frame = document.getElementById('form-maker-frame');
    const rect = frame?.getBoundingClientRect();
    return {
      theme: document.documentElement.dataset.theme,
      preference: localStorage.getItem('sanpokai-theme-preference-v1'),
      background: getComputedStyle(document.body).backgroundColor,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '',
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      frameWidth: rect?.width || 0,
      frameHeight: rect?.height || 0,
      frameSrc: frame?.src || '',
    };
  });
  if (host.theme !== 'g100' || host.preference !== 'dark') throw new Error(`embedded host theme did not persist: ${JSON.stringify(host)}`);
  if (host.background === 'rgb(255, 255, 255)' || host.themeColor.toLowerCase() !== '#161616') throw new Error(`embedded host retained white chrome: ${JSON.stringify(host)}`);
  if (host.documentWidth > host.viewportWidth + 1 || host.frameWidth < 380 || host.frameHeight < 800) throw new Error(`embedded host layout regression: ${JSON.stringify(host)}`);
  if (!/[?&]theme=dark(?:&|$)/.test(host.frameSrc) || !/[?&]themeChannel=[^&]+/.test(host.frameSrc)) {
    throw new Error(`embedded host did not pass theme/channel through iframe URL: ${host.frameSrc}`);
  }

  let embedded = null;
  for (let attempt = 0; attempt < 20 && !embedded; attempt += 1) {
    for (const frame of page.frames()) {
      try {
        const text = await frame.locator('body').innerText({ timeout: 1500 });
        if (!text.includes('編集者メールアドレス') || !text.includes('Googleフォームを作成')) continue;
        embedded = await frame.evaluate(() => ({
          theme: document.documentElement.dataset.carbonTheme || '',
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          headerBackground: document.querySelector('.cds--header') ? getComputedStyle(document.querySelector('.cds--header')).backgroundColor : '',
          preference: localStorage.getItem('sanpokai-theme-preference-v1'),
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
        }));
        if (embedded.theme !== 'g100') embedded = null;
        if (embedded) break;
      } catch {}
    }
    if (!embedded) await page.waitForTimeout(1500);
  }
  if (!embedded) throw new Error('embedded Apps Script React UI did not reach Carbon g100 inside the Google wrapper');
  if ([embedded.bodyBackground, embedded.headerBackground].includes('rgb(255, 255, 255)')) {
    throw new Error(`embedded React UI leaked white surfaces in dark mode: ${JSON.stringify(embedded)}`);
  }
  if (embedded.documentWidth > embedded.viewportWidth + 1) throw new Error(`embedded React UI overflow: ${JSON.stringify(embedded)}`);
  await page.screenshot({ path: `${OUT}/form-maker-host-dark.png`, fullPage: true });

  if (pageErrors.length) throw new Error(`production page errors: ${pageErrors.join(' | ')}`);
  const report = { status: response?.status() || null, liveUrl: LIVE_URL, initial, dark, host, embedded, pageErrors, consoleErrors };
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
