const { chromium } = require('playwright');
const { serveDist } = require('./helpers/serve-dist.cjs');

(async () => {
  const { server, baseUrl } = await serveDist();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let job = null;
  const admissionSlots = new Map();
  let writes = 0;
  await context.route('https://identitytoolkit.googleapis.com/**', route => route.fulfill({
    status: 200,
    json: { localId: 'origin-smoke-uid', idToken: 'origin-smoke-token', refreshToken: 'origin-smoke-refresh', expiresIn: '3600' },
  }));
  await context.route('https://securetoken.googleapis.com/**', route => route.fulfill({
    status: 200,
    json: { user_id: 'origin-smoke-uid', id_token: 'origin-smoke-token', refresh_token: 'origin-smoke-refresh', expires_in: '3600' },
  }));
  await context.route('https://sanpokai-tool-default-rtdb.firebaseio.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/status.json')) return route.fulfill({ json: { accepting: true, state: 'ready' } });
    const admissionMatch = url.pathname.match(/\/admission\/slots\/(\d+)\.json$/);
    if (admissionMatch) {
      const slotId = admissionMatch[1];
      if (request.method() === 'GET') {
        const reservation = admissionSlots.get(slotId);
        return reservation
          ? route.fulfill({ json: reservation })
          : route.fulfill({ status: 403, json: { error: 'PERMISSION_DENIED' } });
      }
      if (request.method() === 'PUT') {
        if (admissionSlots.has(slotId)) return route.fulfill({ status: 403, json: { error: 'PERMISSION_DENIED' } });
        admissionSlots.set(slotId, request.postDataJSON());
        return route.fulfill({ json: null });
      }
    }
    if (url.pathname.endsWith('/jobs.json')) return route.fulfill({ json: job ? { [job.jobId]: job } : null });
    if (url.pathname.includes('/jobs/')) {
      if (request.method() === 'PUT') {
        writes += 1;
        job = { ...request.postDataJSON(), state: 'queued' };
        return route.fulfill({ json: null });
      }
      if (job) job = {
        ...job,
        state: 'completed',
        result: {
          planName: '同じ画面の企画', formId: 'SAME-ORIGIN-FORM',
          formUrl: 'https://docs.google.com/forms/d/SAME-ORIGIN-FORM/viewform',
          editUrl: 'https://docs.google.com/forms/d/SAME-ORIGIN-FORM/edit',
          projectId: 'SAME-ORIGIN-ROOM',
          projectUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=SAME-ORIGIN-ROOM',
          responseSheetUrl: 'https://docs.google.com/spreadsheets/d/SAME-ORIGIN-SHEET',
          createdAt: Date.now(),
        },
      };
      return route.fulfill({ json: job });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  try {
    await page.goto(baseUrl);
    await page.getByRole('heading', { name: '山歩会企画ツール一覧' }).waitFor();
    await page.getByRole('tab', { name: '作成したフォーム' }).click();

    const formPage = await context.newPage();
    await formPage.goto(`${baseUrl}form-maker/`);
    await formPage.getByRole('heading', { name: 'フォーム作成' }).waitFor();
    if (await formPage.locator('iframe').count()) throw new Error('The same-origin form-maker route still contains an iframe');
    await formPage.getByLabel('企画名').fill('同じ画面の企画');
    await formPage.getByLabel('メールアドレス（必須）').fill('tester@example.com');
    await formPage.getByRole('button', { name: '応募フォームを作成' }).click();
    await formPage.getByText('依頼を受け付けました。').waitFor();
    await formPage.getByText('フォームを作成しました').waitFor({ timeout: 7000 });
    await page.getByText('同じ画面の企画', { exact: true }).waitFor({ timeout: 5000 });
    if (writes !== 1) throw new Error(`Expected one idempotent job write, got ${writes}`);
    const storedJob = job;
    const slotReservation = admissionSlots.get(storedJob.admissionSlotId);
    if (!slotReservation || slotReservation.uid !== 'origin-smoke-uid' || slotReservation.jobId !== storedJob.jobId || slotReservation.requestHash !== storedJob.inputHash) {
      throw new Error('The same-origin form job was not bound to its shared admission slot');
    }
    const sameOrigin = await formPage.evaluate(() => location.origin === opener?.location.origin);
    if (sameOrigin) throw new Error('Unexpected named opener; the form page should not navigate the portal tab');
    const overflow = await formPage.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error('390px same-origin form-maker page overflows horizontally');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Same-origin form creation and portal history smoke passed.');
})().catch(error => { console.error(error); process.exit(1); });
