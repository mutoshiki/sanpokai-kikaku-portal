const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let BASE = '';

function startDistServer() {
  const root = path.join(process.cwd(), 'dist');
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const assetPath = pathname.replace(/^\/sanpokai-kikaku-portal\/?/, '') || 'index.html';
    const relativePath = assetPath.endsWith('/') ? `${assetPath}index.html` : assetPath;
    const filePath = path.resolve(root, relativePath);
    if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, 'index.html')) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404).end(); return; }
      const extension = path.extname(filePath);
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream');
      response.end(content);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    BASE = `http://127.0.0.1:${server.address().port}/sanpokai-kikaku-portal/`;
    resolve(server);
  }));
}

async function run(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const writes = [];
  const admissionSlots = new Map();
  let savedJob = null;
  page.on('pageerror', error => errors.push(error.message));

  await page.route('https://identitytoolkit.googleapis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ localId: 'browser-smoke-uid', idToken: 'smoke-id-token', refreshToken: 'smoke-refresh-token', expiresIn: '3600' }),
  }));
  await page.route('https://securetoken.googleapis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user_id: 'browser-smoke-uid', id_token: 'smoke-id-token', refresh_token: 'smoke-refresh-token', expires_in: '3600' }),
  }));
  await page.route('https://sanpokai-tool-default-rtdb.firebaseio.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/status.json')) return route.fulfill({ json: { accepting: true, state: 'ready', dailyCount: 1, dailyLimit: 40 } });
    const slotMatch = url.pathname.match(/\/formMakerV1\/admission\/slots\/(\d+)\.json$/);
    if (slotMatch) {
      if (request.method() === 'PUT') {
        admissionSlots.set(slotMatch[1], request.postDataJSON());
        return route.fulfill({ json: null });
      }
      return route.fulfill({ json: admissionSlots.get(slotMatch[1]) ?? null });
    }
    if (url.pathname.endsWith('/jobs.json')) return route.fulfill({ json: savedJob ? { [savedJob.jobId]: savedJob } : null });
    if (url.pathname.includes('/jobs/')) {
      if (request.method() === 'PUT') {
        writes.push(request.postDataJSON());
        savedJob = { ...request.postDataJSON(), state: 'queued' };
        return route.fulfill({ json: null });
      }
      if (savedJob) {
        savedJob = {
          ...savedJob,
          state: 'completed',
          result: {
            planName: 'ブラウザ検証企画',
            formId: 'FORM-SMOKE',
            formUrl: 'https://docs.google.com/forms/d/FORM-SMOKE/viewform',
            editUrl: 'https://docs.google.com/forms/d/FORM-SMOKE/edit',
            projectId: 'ROOM-SMOKE',
            projectUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=ROOM-SMOKE',
            responseSheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET-SMOKE',
            createdAt: 1792000000000,
          },
        };
      }
      return route.fulfill({ json: savedJob });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  await page.goto(`${BASE}form-maker/`);
  await page.getByRole('heading', { name: '応募フォームを作る' }).waitFor();
  if (await page.locator('iframe').count()) throw new Error(`${width}px: the form-maker page must not wait on an Apps Script iframe`);
  const lightHeader = await page.locator('.cds--header').evaluate(node => getComputedStyle(node).backgroundColor);
  if (lightHeader !== 'rgb(22, 22, 22)') throw new Error(`${width}px: Carbon header is not black in light mode (${lightHeader})`);
  await page.getByRole('button', { name: '表示テーマ：システム設定' }).click();
  await page.locator('label[for="theme-dark"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  const headerBackground = await page.locator('.cds--header').evaluate(node => getComputedStyle(node).backgroundColor);
  if (headerBackground !== 'rgb(22, 22, 22)') {
    const headerInfo = await page.locator('.cds--header').evaluate(node => ({ theme: node.getAttribute('data-carbon-theme'), className: node.className, root: document.documentElement.dataset.carbonTheme, parentBackground: getComputedStyle(node.parentElement).backgroundColor, background: getComputedStyle(node).backgroundColor, variable: getComputedStyle(node).getPropertyValue('--cds-background') }));
    throw new Error(`${width}px: dark theme did not keep the Carbon header black (${JSON.stringify(headerInfo)})`);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '表示テーマ：ダーク' }).waitFor({ state: 'visible' });
  await page.getByLabel('企画名').fill('ブラウザ検証企画');
  await page.getByLabel('フォームを編集する人のメールアドレス').fill('tester@example.com');
  await page.getByLabel('実施日').fill('2026-10-20');
  await page.getByLabel('企画の内容・集合場所・注意事項').fill('合成データです');
  await page.getByRole('button', { name: 'Googleフォームを作成' }).click();
  await page.getByText('受付済み').waitFor();
  await page.getByText('作成完了').waitFor({ timeout: 7000 });
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('応募フォームを作る'));
  if (writes.length !== 1) throw new Error(`${width}px: expected one job creation, received ${writes.length}`);
  if (await page.getByRole('link', { name: /サークル企画ツールで企画を開く/ }).getAttribute('target') !== '_blank') {
    throw new Error(`${width}px: project link should leave the form-maker tab open`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error(`${width}px: horizontal overflow detected`);
  await page.getByRole('button', { name: '別のフォームを作る' }).waitFor();
  if (errors.length) throw new Error(`${width}px: ${errors.join(' | ')}`);
  await context.close();
}

async function runStorageDenied(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let writes = 0;
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('storage blocked'); } }));
  await page.route('https://identitytoolkit.googleapis.com/**', route => route.fulfill({ status: 200, json: { localId: 'storage-smoke-uid', idToken: 'storage-token', refreshToken: 'storage-refresh', expiresIn: '3600' } }));
  await page.route('https://sanpokai-tool-default-rtdb.firebaseio.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status.json')) return route.fulfill({ json: { accepting: true, state: 'ready' } });
    if (route.request().method() === 'PUT') writes += 1;
    return route.fulfill({ json: null });
  });
  try {
    await page.goto(`${BASE}form-maker/`);
    await page.getByLabel('企画名').fill('保存拒否テスト');
    await page.getByLabel('フォームを編集する人のメールアドレス').fill('tester@example.com');
    await page.getByRole('button', { name: 'Googleフォームを作成' }).click();
    await page.getByText('このタブで作成状況を保存できません').waitFor();
    if (writes !== 0) throw new Error('A form request was sent without a persisted idempotency key');
  } finally {
    await context.close();
  }
}

async function runMaintenance(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const writes = [];
  await page.route('https://identitytoolkit.googleapis.com/**', route => route.fulfill({ status: 200, json: { localId: 'maintenance-uid', idToken: 'maintenance-token', refreshToken: 'maintenance-refresh', expiresIn: '3600' } }));
  await page.route('https://sanpokai-tool-default-rtdb.firebaseio.com/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/status.json')) return route.fulfill({ json: { accepting: true, state: 'ready', acceptanceMode: 'test' } });
    if (url.pathname.endsWith('/testOwners/maintenance-uid.json')) return route.fulfill({ json: null });
    if (request.method() !== 'GET') writes.push(request.method());
    return route.fulfill({ json: null });
  });
  try {
    await page.goto(`${BASE}form-maker/`);
    await page.getByText('メンテナンス中です').waitFor();
    await page.getByRole('heading', { name: '作成したフォーム' }).waitFor();
    if (await page.getByLabel('企画名').isVisible() !== true) throw new Error('form inputs should remain visible in maintenance mode');
    if (await page.getByRole('button', { name: 'Googleフォームを作成' }).isEnabled()) throw new Error('non-test browser must not create a form during test intake');
    if (writes.length) throw new Error(`maintenance page attempted Firebase data writes: ${writes.join(',')}`);
  } finally {
    await context.close();
  }
}

(async () => {
  const server = await startDistServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await run(browser, 390);
    await run(browser, 1280);
    await runStorageDenied(browser);
    await runMaintenance(browser);
    console.log('Form-maker same-origin browser smoke passed at 390px, 1280px, with tab storage denied, and during test-only maintenance.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
