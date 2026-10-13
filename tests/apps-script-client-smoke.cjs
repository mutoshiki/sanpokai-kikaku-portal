const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const INDEX = fs.readFileSync(path.resolve('apps-script/form-maker/Index.html'), 'utf8');
const CHANNEL = 'test-history-channel';
const HOST = 'sanpokai-form-history-host';
const CHILD = 'sanpokai-form-history-child';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') {
    const localOrigin = `http://${request.headers.host}`;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="ja"><body><iframe id="child" src="/Index.html?historyChannel=${CHANNEL}&historyOrigin=${encodeURIComponent(localOrigin)}&theme=dark"></iframe><iframe id="no-channel" src="/Index.html?theme=light"></iframe><iframe id="untrusted-parent" src="/Index.html?historyChannel=untrusted-channel&historyOrigin=https%3A%2F%2Fevil.example&theme=light"></iframe><script>window.__messages=[];window.addEventListener('message',event=>{const frames=['child','no-channel','untrusted-parent'];const frame=frames.find(id=>event.source===document.getElementById(id).contentWindow);if(!frame)return;const data=event.data;if(data?.source==="${CHILD}")window.__messages.push({frame,source:data.source,channel:data.channel,type:data.type,historyCount:Array.isArray(data.history)?data.history.length:null})})</script></body></html>`);
    return;
  }
  if (pathname === '/Index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(INDEX);
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.addInitScript(({ channel, host, child }) => {
    if (location.pathname !== '/Index.html') return;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sanpokai-form-builder-history-v1' && window.__qaFailHistoryStorage) {
        throw new DOMException('Storage is unavailable', 'SecurityError');
      }
      return nativeSetItem.call(this, key, value);
    };
    let successHandler;
    const run = {
      withSuccessHandler(handler) { successHandler = handler; return this; },
      withFailureHandler() { return this; },
      createForm(data) {
        successHandler({
          success: true,
          formId: 'FORM-TEST',
          title: data.planName,
          createdAt: '2026/10/13 00:00',
          responseUrl: 'https://forms.example.test/view',
          editUrl: 'https://forms.example.test/edit',
        });
      },
    };
    window.google = {
      script: {
        url: { getLocation(callback) { callback({ parameter: Object.fromEntries(new URL(location.href).searchParams) }); } },
        run,
      },
    };
    window.__historyBridgeSources = { host, child };
  }, { channel: CHANNEL, host: HOST, child: CHILD });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__messages.some(message => message.frame === 'child' && message.type === 'history-ready'));
    const frame = page.frameLocator('#child');
    const noChannelFrame = page.frameLocator('#no-channel');
    const darkTheme = await frame.locator('html').getAttribute('data-theme');
    if (darkTheme !== 'g100') throw new Error(`Dark theme preference was not applied: ${darkTheme}`);
    const darkBackground = await frame.locator('body').evaluate(node => getComputedStyle(node).backgroundColor);
    if (darkBackground !== 'rgb(22, 22, 22)') throw new Error(`Dark theme did not reach the Apps Script UI: ${darkBackground}`);
    await noChannelFrame.getByLabel('企画名（必須）').waitFor();
    const noChannelTheme = await noChannelFrame.locator('html').getAttribute('data-theme');
    if (noChannelTheme !== 'white') throw new Error(`Explicit light theme preference was not applied: ${noChannelTheme}`);
    const noChannelReady = await page.evaluate(() => window.__messages.some(message => message.frame === 'no-channel' && message.type === 'history-ready'));
    if (noChannelReady) throw new Error('Apps Script announced history readiness without a host channel');
    await page.frameLocator('#untrusted-parent').getByLabel('企画名（必須）').waitFor();
    const untrustedParentReady = await page.evaluate(() => window.__messages.some(message => message.frame === 'untrusted-parent' && message.type === 'history-ready'));
    if (untrustedParentReady) throw new Error('Apps Script disclosed history to an untrusted embedding origin');
    await page.evaluate(({ host, channel }) => {
      document.getElementById('untrusted-parent').contentWindow.postMessage({
        source: host,
        channel,
        type: 'history-state',
        history: [{ formId: 'INJECTED', title: '外部サイトから注入された履歴' }],
      }, location.origin);
    }, { host: HOST, channel: 'untrusted-channel' });
    const injectedHistoryVisible = await page.frameLocator('#untrusted-parent').locator('#historyRegion').evaluate(node => !node.hidden);
    if (injectedHistoryVisible) throw new Error('Apps Script accepted history-state from an untrusted embedding origin');
    await page.evaluate(({ channel, host }) => {
      document.getElementById('child').contentWindow.postMessage({
        source: host,
        channel,
        type: 'history-state',
        history: [{ formId: 'FORM-OLD', title: '保存済みフォーム', createdAt: '2026/10/12', responseUrl: 'https://forms.example.test/old', editUrl: 'https://forms.example.test/old/edit' }],
      }, location.origin);
    }, { channel: CHANNEL, host: HOST });
    await frame.getByRole('heading', { name: '保存済みフォーム' }).waitFor();
    await page.evaluate(() => { document.getElementById('child').contentWindow.__qaFailHistoryStorage = true; });
    await frame.getByLabel('企画名（必須）').fill('履歴保存失敗時の企画');
    await frame.getByLabel('編集者メールアドレス（必須）').fill('test@example.org');
    await frame.getByRole('button', { name: 'Googleフォームを作成' }).click();
    await frame.locator('#result').waitFor({ state: 'visible', timeout: 1000 }).catch(() => undefined);
    if (!await frame.locator('#result').isVisible()) {
      throw new Error('Successful form creation result was hidden when local history storage failed');
    }
    await page.waitForFunction(() => window.__messages.some(message => message.frame === 'child' && message.type === 'history-update'));
    if (pageErrors.length) throw new Error(`Apps Script client errors: ${pageErrors.join(' | ')}`);
    console.log('Apps Script history-ready/update bridge and storage failure smoke passed.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exit(1); });
