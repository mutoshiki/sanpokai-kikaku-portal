const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');
const { serveDist } = require('./helpers/serve-dist.cjs');

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

async function installEnvironment(page, preference, baseUrl) {
  await page.route('https://identitytoolkit.googleapis.com/**', route => route.fulfill({ status: 200, json: { localId: 'portal-focus-uid', idToken: 'portal-focus-token', refreshToken: 'portal-focus-refresh', expiresIn: '3600' } }));
  await page.route('https://securetoken.googleapis.com/**', route => route.fulfill({ status: 200, json: { user_id: 'portal-focus-uid', id_token: 'portal-focus-token', refresh_token: 'portal-focus-refresh', expires_in: '3600' } }));
  await page.route('https://sanpokai-tool-default-rtdb.firebaseio.com/**', route => route.fulfill({ json: null }));
  await page.goto(`${baseUrl}qa-empty.html`);
  await page.evaluate(({ key, preference }) => localStorage.setItem(key, preference), { key: THEME_KEY, preference });
  await page.addInitScript(() => {
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
  });
}

async function installKeyboardHistoryFixture(page) {
  await page.evaluate(() => {
    localStorage.setItem('sanpokai_portal_project_history_v1', JSON.stringify({ version: 1, projects: [
      { roomId: 'FOCUS-PROJECT', name: 'キーボード確認企画', lastOpenedAt: Date.now() },
    ] }));
    localStorage.setItem('sanpokai-form-builder-history-v1', JSON.stringify([
      { formId: 'FOCUS-FORM', planName: 'キーボード確認フォーム', responseUrl: 'https://docs.google.com/forms/d/FOCUS-FORM/viewform', editUrl: 'https://docs.google.com/forms/d/FOCUS-FORM/edit', createdAt: Date.now() },
    ]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai_portal_project_history_v1' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai-form-builder-history-v1' }));
  });
}

async function clearKeyboardHistoryFixture(page) {
  await page.evaluate(() => {
    localStorage.setItem('sanpokai_portal_project_history_v1', JSON.stringify({ version: 1, projects: [] }));
    localStorage.setItem('sanpokai-form-builder-history-v1', JSON.stringify([]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai_portal_project_history_v1' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai-form-builder-history-v1' }));
  });
  await page.getByRole('link', { name: /キーボード確認企画/ }).waitFor({ state: 'detached' });
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

async function run(browser, engineName, preference, expectedTheme, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true });
  const page = await context.newPage();
  await installEnvironment(page, preference, baseUrl);
  await page.goto(baseUrl);
  await page.locator('.portal-title').waitFor({ timeout: 60000 });
  await page.waitForFunction(theme => document.documentElement.dataset.carbonTheme === theme, expectedTheme);
  await page.keyboard.press('Tab');
  const skipTarget = await page.evaluate(() => ({
    className: document.activeElement?.className?.toString?.() || '',
    href: document.activeElement?.getAttribute('href') || '',
    text: document.activeElement?.textContent.trim() || '',
  }));
  if (!skipTarget.className.includes('cds--skip-to-content') || skipTarget.href !== '#main' || skipTarget.text !== '本文へ移動') {
    throw new Error(`${preference}: Carbon SkipToContent keyboard entry regression: ${JSON.stringify(skipTarget)}`);
  }
  await page.keyboard.press('Enter');
  if (await page.evaluate(() => window.location.hash) !== '#main') throw new Error(`${preference}: SkipToContent did not reach main`);

  const emptyLists = await page.evaluate(() => [...document.querySelectorAll('.cds--contained-list')].map(node => ({
    label: node.getAttribute('aria-label') || document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.trim() || '',
    itemCount: node.querySelectorAll('.cds--contained-list-item').length,
    itemButtons: node.querySelectorAll('.cds--contained-list-item button').length,
  })));
  if (emptyLists.length !== 2 || emptyLists.some(list => list.itemCount !== 1 || list.itemButtons !== 0)) {
    throw new Error(`${preference}: empty contained list state is not non-interactive: ${JSON.stringify(emptyLists)}`);
  }
  if (emptyLists[0]?.label !== '最近の企画' || emptyLists[1]?.label !== '作成したフォーム') {
    throw new Error(`${preference}: empty contained list labels regression: ${JSON.stringify(emptyLists)}`);
  }
  const unavailablePage = await context.newPage();
  await installEnvironment(unavailablePage, preference, baseUrl);
  await unavailablePage.goto(baseUrl);
  await unavailablePage.locator('.portal-title').waitFor({ timeout: 60000 });
  await unavailablePage.evaluate(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage disabled'); } });
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  try { await unavailablePage.getByText('企画の履歴を読み込めませんでした。').waitFor({ timeout: 10000 }); }
  catch { throw new Error(`storage unavailable state did not render: ${(await unavailablePage.locator('body').innerText()).slice(0, 1200)}`); }
  const unavailableCopy = await unavailablePage.locator('.history-workspace').textContent();
  if (!unavailableCopy.includes('企画の履歴を読み込めませんでした。') || (!unavailableCopy.includes('フォームの履歴を読み込めませんでした。') && !unavailableCopy.includes('フォームの作成履歴はありません。')) || unavailableCopy.includes('企画を表示できません') || unavailableCopy.includes('フォームを表示できません')) {
    throw new Error(`${preference}: unavailable state still uses duplicate history copy: ${unavailableCopy}`);
  }
  await unavailablePage.close();
  const sectionOrder = await page.locator('main h2').allTextContents();
  if (JSON.stringify(sectionOrder) !== JSON.stringify(['ツール'])) {
    throw new Error(`${preference}: empty portal section order regression: ${JSON.stringify(sectionOrder)}`);
  }
  if (await page.locator('.history-toggle').count() !== 0) throw new Error(`${preference}: empty history showed an expansion control`);
  await installKeyboardHistoryFixture(page);
  await page.getByRole('link', { name: /キーボード確認企画/ }).waitFor();

  const themeButton = page.getByRole('button', { name: /表示設定を/ });
  await themeButton.click();
  if (await themeButton.getAttribute('aria-expanded') !== 'true') throw new Error(`${preference}: theme panel did not open`);
  if (await themeButton.getAttribute('aria-controls') !== 'theme-preference-panel') throw new Error(`${preference}: theme trigger does not control the panel`);
  if (await page.locator('#theme-preference-panel').getAttribute('aria-label') !== '表示設定') throw new Error(`${preference}: theme panel label regression`);
  await page.locator('#theme-system').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('theme-light')?.checked);
  if (await themeButton.getAttribute('aria-expanded') !== 'true') throw new Error(`${preference}: changing theme closed the panel`);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('theme-dark')?.checked);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[aria-label^="表示設定を"]')?.getAttribute('aria-expanded') === 'false');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('表示設定を'));
  await page.keyboard.press('Tab');
  if (await page.evaluate(() => document.activeElement?.getAttribute('role')) !== 'tab') {
    throw new Error(`${preference}: Tab did not move from the closed theme panel to the history tabs`);
  }
  const recentTab = page.getByRole('tab', { name: '最近の企画', exact: true });
  const formsTab = page.getByRole('tab', { name: '作成したフォーム', exact: true });
  if (await recentTab.getAttribute('aria-selected') !== 'true') throw new Error(`${preference}: recent-project tab was not initially selected`);
  const projectPanelId = await recentTab.getAttribute('aria-controls');
  const formPanelId = await formsTab.getAttribute('aria-controls');
  await page.keyboard.press('ArrowRight');
  if (await formsTab.getAttribute('aria-selected') !== 'true' || !await page.locator(`#${formPanelId}`).isVisible() || await page.locator(`#${projectPanelId}`).isVisible()) {
    throw new Error(`${preference}: ArrowRight did not reveal only the forms panel`);
  }
  await page.getByRole('link', { name: /「キーボード確認フォーム」の応募フォームを開く（新しいタブ）/ }).waitFor();
  const tabStops = [];
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => ({
      tag: document.activeElement?.tagName || '',
      className: document.activeElement?.className?.toString?.() || '',
      panelId: document.activeElement?.closest?.('[role="tabpanel"]')?.id || '',
    }));
    tabStops.push(stop);
    if (stop.panelId !== formPanelId) break;
  }
  if (tabStops.some(stop => stop.panelId === projectPanelId) || !tabStops.some(stop => stop.panelId === formPanelId)) {
    throw new Error(`${preference}: Tab entered the inactive project panel or skipped the active forms panel: ${JSON.stringify(tabStops)}`);
  }
  await formsTab.focus();
  await page.keyboard.press('ArrowLeft');
  if (await recentTab.getAttribute('aria-selected') !== 'true' || !await page.locator(`#${projectPanelId}`).isVisible() || await page.locator(`#${formPanelId}`).isVisible()) {
    throw new Error(`${preference}: ArrowLeft did not return to only the project panel`);
  }
  await clearKeyboardHistoryFixture(page);
  await page.locator('#theme-preference-panel input').evaluateAll(nodes => {
    if (nodes.some(node => node === document.activeElement)) throw new Error('closed panel retained focus');
  });

  const focusPage = await context.newPage();
  await installEnvironment(focusPage, preference, baseUrl);
  await focusPage.goto(baseUrl);
  await focusPage.locator('.portal-title').waitFor({ timeout: 60000 });
  await focusPage.waitForFunction(theme => document.documentElement.dataset.carbonTheme === theme, expectedTheme);
  const touchThemeButton = focusPage.getByRole('button', { name: /表示設定を/ });
  const toolLinks = await focusPage.locator('.tool-tile').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  if (!toolLinks.some(href => href && href.includes('/form-maker/'))) {
    throw new Error(`${preference}: form maker tile is not routed through the themed host`);
  }

  await focusPage.locator('.tool-tile').first().focus();
  await waitForFocusedTile(focusPage);
  const reached = await focusPage.evaluate(() => document.activeElement?.classList?.contains('tool-tile') === true);
  if (!reached) throw new Error(`${preference}: focus did not remain on the tool tile`);

  const focus = await focusPage.evaluate(() => {
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
  const outlineInvisible = focus.outline === 'none' || /transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(focus.outline);
  if (outlineInvisible && shadowIsTransparent(focus.boxShadow)) {
    throw new Error(`${preference}: keyboard focus ring is transparent after transition: ${JSON.stringify(focus)}`);
  }

  const touchBounds = await touchThemeButton.boundingBox();
  if (!touchBounds) throw new Error(`${preference}: theme trigger has no touch target`);
  await focusPage.touchscreen.tap(touchBounds.x + touchBounds.width / 2, touchBounds.y + touchBounds.height / 2);
  await focusPage.waitForFunction(() => document.querySelector('[aria-label^="表示設定を"]')?.getAttribute('aria-expanded') === 'true');
  const openBounds = await touchThemeButton.boundingBox();
  await focusPage.touchscreen.tap(openBounds.x + openBounds.width / 2, openBounds.y + openBounds.height / 2);
  await focusPage.waitForFunction(() => document.querySelector('[aria-label^="表示設定を"]')?.getAttribute('aria-expanded') === 'false');
  const touchFocus = await focusPage.evaluate(() => ({
    onTrigger: document.activeElement?.getAttribute('aria-label')?.startsWith('表示設定を') === true,
    visible: document.activeElement?.matches(':focus-visible') === true,
  }));
  if (touchFocus.onTrigger && touchFocus.visible) throw new Error(`${preference}: touch close forced a keyboard-style focus ring: ${JSON.stringify(touchFocus)}`);

  await focusPage.screenshot({ path: `browser-evidence/focus-${engineName}-${preference}.png`, fullPage: true });
  await focusPage.close();
  await context.close();
  return focus;
}

(async () => {
  fs.mkdirSync('browser-evidence', { recursive: true });
  const { server, baseUrl } = await serveDist();
  const results = {};
  for (const [engineName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    let launchOptions = { headless: true };
    if (engineName === 'chromium') {
      const policyDir = process.env.CHROMIUM_POLICY_DIR || path.join(process.cwd(), 'browser-evidence', 'empty-chromium-policy');
      fs.mkdirSync(policyDir, { recursive: true });
      launchOptions = {
        ...launchOptions,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps'],
        env: { ...process.env, CHROMIUM_POLICY_DIR: policyDir },
      };
    }
    const browser = await browserType.launch(launchOptions);
    try {
      results[engineName] = {
        light: await run(browser, engineName, 'light', 'white', baseUrl),
        dark: await run(browser, engineName, 'dark', 'g100', baseUrl),
      };
    } finally {
      await browser.close();
    }
  }
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync('browser-evidence/focus-strict.json', JSON.stringify(results, null, 2));
  console.log('Strict Carbon keyboard focus and history tab smoke passed for Chromium/WebKit in light and dark.');
})().catch(error => { console.error(error); process.exit(1); });
