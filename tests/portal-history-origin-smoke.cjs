const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const DIST = path.resolve('dist');
const BASE = '/sanpokai-kikaku-portal/';
const INDEX_KEY = 'sanpokai_portal_project_history_v1';
const FORM_KEY = 'sanpokai-form-builder-history-v1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === `${BASE}producer.html`) {
    response.writeHead(200, { 'content-type': MIME['.html'] });
    response.end('<!doctype html><html><body>same-origin history producer fixture</body></html>');
    return;
  }
  if (!pathname.startsWith(BASE)) { response.writeHead(404); response.end('Not found'); return; }
  const target = path.resolve(DIST, decodeURIComponent(pathname.slice(BASE.length)) || 'index.html');
  if (!target.startsWith(`${DIST}${path.sep}`) && target !== path.join(DIST, 'index.html')) { response.writeHead(403); response.end(); return; }
  const file = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target;
  if (!fs.existsSync(file)) { response.writeHead(404); response.end('Not found'); return; }
  response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let responseMode = 'ready';
  try {
    const context = await browser.newContext();
    await context.addInitScript(originValue => {
      window.__qaOrigin = originValue;
      if (location.origin !== originValue) return;
      const nativeSetItem = Storage.prototype.setItem;
      localStorage.setItem('sanpo-react:v1:ORIGIN-ONE:room', JSON.stringify({ roomName: '初期企画', lastUpdatedAt: 1700000000000 }));
      window.__qaIndexWrites = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'sanpokai_portal_project_history_v1') window.__qaIndexWrites += 1;
        return nativeSetItem.call(this, key, value);
      };
      const nativeTimeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 10000) {
          window.__qaRunFormMakerFallback = callback;
          return nativeTimeout(() => {}, 60000);
        }
        return nativeTimeout(callback, delay, ...args);
      };
    }, origin);
    await context.route('https://script.google.com/macros/s/**', async route => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has('embedded')) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>直接フォーム</title><h1>直接フォームを開きました</h1>' });
        return;
      }
      if (responseMode === 'fail') { await route.abort(); return; }
      const channel = JSON.stringify(url.searchParams.get('historyChannel'));
      const delay = responseMode === 'delayed' ? 180 : 0;
      const body = `<!doctype html><script>setTimeout(()=>parent.postMessage({source:'sanpokai-form-history-child',channel:${channel},type:'history-ready',history:[{formId:'NEW-FORM',planName:'新しいフォーム',createdAt:'2027-01-01T00:00:00.000Z',updatedAt:'2027-01-01T00:00:00.000Z'}]},'*'),${delay})<\/script>`;
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    });

    const producer = await context.newPage();
    await producer.goto(`${origin}${BASE}producer.html`);
    const portalA = await context.newPage();
    const portalB = await context.newPage();
    await Promise.all([portalA.goto(`${origin}${BASE}`), portalB.goto(`${origin}${BASE}`)]);
    await Promise.all([portalA, portalB].map(page => page.getByRole('heading', { name: '山歩会企画ツール一覧' }).waitFor()));
    await Promise.all([portalA, portalB].map(page => page.getByRole('tab', { name: '最近の企画', exact: true }).waitFor()));
    if (await portalA.getByRole('link', { name: /初期企画/ }).count() !== 1) throw new Error('React room record was not listed from the deployed origin');
    await Promise.all([portalA, portalB].map(page => page.evaluate(() => { window.__qaIndexWrites = 0; })));

    const registry = { version: 1, projects: [
      { roomId: 'ORIGIN-ONE', name: '更新された企画名', updatedAt: 1800000000000, lastOpenedAt: 1700000000000 },
      { roomId: 'ORIGIN-TWO', name: '別タブから追加', updatedAt: 1800000000100, lastOpenedAt: 1800000000100 },
    ] };
    await producer.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: INDEX_KEY, value: registry });
    if (await producer.evaluate(() => window.__qaIndexWrites) !== 1) throw new Error('The project producer did not make a single index update');
    for (const page of [portalA, portalB]) {
      await page.getByRole('link', { name: /別タブから追加/ }).waitFor();
      await page.getByRole('link', { name: /更新された企画名/ }).waitFor();
      if (await page.evaluate(() => window.__qaIndexWrites) !== 0) throw new Error('A portal tab wrote back to the index after a storage event');
    }
    await producer.evaluate(() => localStorage.setItem('sanpo-react:v1:BROKEN:room', '{'));
    await Promise.all([portalA, portalB].map(page => page.getByRole('status').filter({ hasText: '一部を読み込めませんでした' }).waitFor()));
    if (await portalA.getByRole('link', { name: /更新された企画名/ }).count() !== 1) throw new Error('One corrupt record hid healthy project history');

    const oldForms = Array.from({ length: 10 }, (_, index) => ({ formId: `OLD-${index}`, planName: `旧フォーム${index}`, createdAt: `2026-01-${String(index + 1).padStart(2, '0')}` }));
    await producer.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: FORM_KEY, value: oldForms });
    const formPage = await context.newPage();
    responseMode = 'delayed';
    await formPage.goto(`${origin}${BASE}form-maker/`);
    const directLink = formPage.getByRole('link', { name: 'フォームメーカーを直接開く' });
    if (await directLink.count() !== 0) throw new Error('The non-synchronizing direct link is visible while the embedded app is loading');
    const loadingLayout = await formPage.evaluate(() => ({
      viewportHeight: window.innerHeight,
      statusTop: document.getElementById('form-maker-status').getBoundingClientRect().top,
      statusHeight: document.getElementById('form-maker-status').getBoundingClientRect().height,
      spinnerWidth: Number.parseFloat(getComputedStyle(document.getElementById('form-maker-status'), '::before').width),
    }));
    if (Math.abs(loadingLayout.statusTop) > 2 || Math.abs(loadingLayout.statusHeight - loadingLayout.viewportHeight) > 2 || loadingLayout.spinnerWidth < 20) {
      throw new Error(`Loading state does not fill the viewport with a visible indicator: ${JSON.stringify(loadingLayout)}`);
    }
    await formPage.evaluate(() => {
      const channel = new URL(document.getElementById('form-maker-frame').src).searchParams.get('historyChannel');
      window.postMessage({ source: 'sanpokai-form-history-child', channel, type: 'history-ready', history: [{ formId: 'SPOOF', createdAt: '2027-01-02' }] }, '*');
    });
    await formPage.waitForFunction(() => document.getElementById('form-maker-status')?.hidden === true);
    const readyLayout = await formPage.evaluate(() => ({
      viewportHeight: window.innerHeight,
      frameHeight: document.getElementById('form-maker-frame').getBoundingClientRect().height,
    }));
    if (Math.abs(readyLayout.frameHeight - readyLayout.viewportHeight) > 2) {
      throw new Error(`Iframe did not reclaim the hidden recovery area: ${JSON.stringify(readyLayout)}`);
    }
    const merged = await producer.evaluate(key => JSON.parse(localStorage.getItem(key)), FORM_KEY);
    if (merged.length !== 10 || merged[0]?.formId !== 'NEW-FORM' || merged.some(form => form.formId === 'OLD-0' || form.formId === 'SPOOF')) throw new Error(`Form merge or message-origin validation failed: ${JSON.stringify(merged.map(form => form.formId))}`);

    responseMode = 'ready';
    const readyPage = await context.newPage();
    await readyPage.goto(`${origin}${BASE}form-maker/`);
    await readyPage.waitForFunction(() => document.getElementById('form-maker-status')?.hidden === true);

    responseMode = 'delayed';
    const delayedPage = await context.newPage();
    await delayedPage.goto(`${origin}${BASE}form-maker/`);
    const delayedDirectLink = delayedPage.getByRole('link', { name: 'フォームメーカーを直接開く' });
    if (await delayedDirectLink.count() !== 0) throw new Error('The recovery link is visible before the embedded app has had time to load');
    await delayedPage.evaluate(() => window.__qaRunFormMakerFallback?.());
    await delayedPage.getByText('フォーム履歴の連携に時間がかかっています。').waitFor();
    await delayedDirectLink.waitFor();
    await delayedPage.getByText('直接開いた画面では、作成履歴がポータルに表示されないことがあります。').waitFor();
    if (await delayedDirectLink.getAttribute('target') !== '_blank') throw new Error('The direct recovery link must preserve the portal page in its current tab');
    if (await delayedPage.locator('#form-maker-status').evaluate(element => getComputedStyle(element, '::before').display) !== 'none') throw new Error('The spinner should stop after recovery guidance appears');
    const delayedDirectUrl = new URL(await delayedDirectLink.getAttribute('href'));
    if (delayedDirectUrl.origin !== 'https://script.google.com' || delayedDirectUrl.searchParams.has('historyChannel')) throw new Error('The direct recovery link must open Apps Script without a history handshake');
    for (let attempt = 0; attempt < 3 && await delayedDirectLink.evaluate(element => document.activeElement !== element); attempt += 1) {
      await delayedPage.keyboard.press('Tab');
    }
    const focusStyle = await delayedDirectLink.evaluate(element => ({
      focused: document.activeElement === element,
      outlineStyle: getComputedStyle(element).outlineStyle,
      outlineWidth: getComputedStyle(element).outlineWidth,
    }));
    if (!focusStyle.focused || focusStyle.outlineStyle !== 'solid' || Number.parseFloat(focusStyle.outlineWidth) < 2) throw new Error(`The recovery link is not keyboard reachable with a visible focus indicator: ${JSON.stringify(focusStyle)}`);
    const delayedPopupPromise = delayedPage.waitForEvent('popup');
    await delayedDirectLink.click();
    const delayedPopup = await delayedPopupPromise;
    await delayedPopup.waitForLoadState('domcontentloaded');
    const directPageText = await delayedPopup.locator('body').innerText().catch(() => '');
    if (!directPageText.includes('直接フォームを開きました')) throw new Error(`Direct recovery target did not load: url=${delayedPopup.url()} text=${directPageText.slice(0, 200)}`);
    await delayedPage.waitForFunction(() => document.getElementById('form-maker-status')?.hidden === true, { timeout: 3000 });

    responseMode = 'fail';
    const failedPage = await context.newPage();
    await failedPage.goto(`${origin}${BASE}form-maker/`);
    if (await failedPage.getByRole('link', { name: 'フォームメーカーを直接開く' }).count() !== 0) throw new Error('The recovery link is visible before the failure timeout');
    await failedPage.evaluate(() => window.__qaRunFormMakerFallback?.());
    await failedPage.getByText('フォーム履歴の連携に時間がかかっています。').waitFor();
    await failedPage.getByRole('link', { name: 'フォームメーカーを直接開く' }).waitFor();
    await context.close();
    console.log('Same-origin history convergence and form-host loading guidance smoke passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exit(1); });
