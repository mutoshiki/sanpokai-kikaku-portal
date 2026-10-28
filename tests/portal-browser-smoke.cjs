const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveDist } = require('./helpers/serve-dist.cjs');

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

async function installIsolatedEnvironment(page, baseUrl) {
  await page.route('https://identitytoolkit.googleapis.com/**', route => route.fulfill({ status: 200, json: { localId: 'portal-smoke-uid', idToken: 'portal-smoke-token', refreshToken: 'portal-smoke-refresh', expiresIn: '3600' } }));
  await page.route('https://securetoken.googleapis.com/**', route => route.fulfill({ status: 200, json: { user_id: 'portal-smoke-uid', id_token: 'portal-smoke-token', refresh_token: 'portal-smoke-refresh', expires_in: '3600' } }));
  await page.route('https://sanpokai-tool-default-rtdb.firebaseio.com/**', route => route.fulfill({ json: null }));
  await page.goto(`${baseUrl}qa-empty.html`);
  await page.evaluate(() => {
    const store = {
      syawari_last_room_id: 'ROOM-B',
      'syawari_last_opened_at_ROOM-A': '2026-09-04T16:42:00.000Z',
      'syawari_last_opened_at_ROOM-B': '2026-09-04T08:19:00.000Z',
      'syawari_last_opened_at_ROOM-C': '2026-09-05T08:19:00.000Z',
      'sampokai_v10_split_ROOM-A': JSON.stringify({ roomName: '春山企画', lastUpdatedAt: 1000 }),
      'sampokai_v10_split_ROOM-B': JSON.stringify({ roomName: '夏山企画', lastUpdatedAt: 2000 }),
      'sampokai_v10_split_ROOM-D': JSON.stringify({ roomName: '秋山企画', lastUpdatedAt: 1000 }),
      'sampokai_v10_split_ROOM-E': JSON.stringify({ roomName: '冬山企画', lastUpdatedAt: 900 }),
      'sampokai_v10_split_ROOM-F': JSON.stringify({ roomName: '長い企画名NoSpaceWithoutBreaks1234567890123456789012345678901234567890', lastUpdatedAt: 800 }),
      'sanpo-react:v1:ROOM-C:room': JSON.stringify({ roomName: 'React企画', lastUpdatedAt: 3000 }),
      'syawari_history_ROOM-A': JSON.stringify([{ time: 3000, data: { roomName: '春山企画', lastUpdatedAt: 1500 } }]),
      'sanpokai-form-builder-history-v1': JSON.stringify([
        { formId: 'FORM-B', planName: '夏山応募フォーム', title: '夏山応募フォーム', createdAt: '2026-08-02T10:00:00.000Z', projectId: 'PROJECT-B', projectUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=PROJECT-B', spreadsheetUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=PROJECT-B&handoff=legacy-token', responseUrl: 'https://docs.google.com/forms/d/FORM-B/viewform', editUrl: 'https://docs.google.com/forms/d/FORM-B/edit' },
        { formId: 'FORM-A', planName: '春山応募フォーム', title: '春山応募フォーム', createdAt: '2026-08-01T10:00:00.000Z', responseUrl: 'https://docs.google.com/forms/d/FORM-A/viewform' },
        { formId: 'FORM-C', planName: '紅葉応募フォーム', createdAt: '2026-07-31T10:00:00.000Z', projectUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=PROJECT-C' },
        { formId: 'FORM-D', planName: '雪山応募フォーム', createdAt: '2026-07-30T10:00:00.000Z', editUrl: 'https://docs.google.com/forms/d/FORM-D/edit' },
        { formId: 'FORM-E', planName: '新緑応募フォーム', createdAt: 'invalid date', responseUrl: 'javascript:alert(1)', editUrl: 'data:text/html,unsafe', projectUrl: 'javascript:alert(2)' },
        { formId: 'FORM-F', planName: 'URLなし応募フォーム', createdAt: '2026-07-29T10:00:00.000Z' },
      ]),
    };
    Object.entries(store).forEach(([key, value]) => localStorage.setItem(key, value));
  });

  await page.addInitScript(() => {
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
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async value => { if (window.__QA_CLIPBOARD_FAIL__) throw new Error('clipboard denied'); window.__QA_COPIED__ = value; } },
    });
  });
}

async function selectTheme(page, currentLabel, id) {
  const trigger = page.getByRole('button', { name: /表示設定を/ });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.locator(`label[for="${id}"]`).click();
}

async function selectHistoryTab(page, label) {
  const tab = page.getByRole('tab', { name: label, exact: true });
  const panel = await tab.getAttribute('aria-controls');
  await tab.click();
  await page.locator(`#${panel}`).waitFor({ state: 'visible' });
}

async function waitForSurfaceTokens(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nodes = [
      document.querySelector('.tool-tile'),
      document.querySelector('.cds--header-panel'),
      document.querySelector('.app-theme-root'),
    ].filter(Boolean);
    const animations = nodes.flatMap(node => node.getAnimations({ subtree: true }));
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

async function focusFirstTileWithKeyboard(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
  let reached = false;
  for (let i = 0; i < 32; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.classList?.contains('tool-tile') === true);
    if (reached) break;
  }
  if (!reached) throw new Error('keyboard navigation did not reach the first tool tile');
  await page.waitForFunction(() => {
    const element = document.activeElement;
    if (!element?.classList?.contains('tool-tile')) return false;
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  });
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

async function run(browser, name, viewport, baseUrl) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', isMobile: viewport.width <= 430, hasTouch: viewport.width <= 430 });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const missingResources = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => { if (response.status() === 404) missingResources.push(response.url()); });

  await installIsolatedEnvironment(page, baseUrl);
  await page.goto(baseUrl);
  await page.locator('.portal-title').waitFor({ timeout: 60000 });
  await page.getByRole('tab', { name: '最近の企画', exact: true }).waitFor({ timeout: 60000 });
  if (await page.getByRole('tab', { name: '最近の企画', exact: true }).getAttribute('aria-selected') !== 'true') {
    throw new Error(`${name}: recent-project tab is not selected by default`);
  }
  await page.getByRole('button', { name: /表示設定を開く（現在：端末の設定に合わせる）/ }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForSurfaceTokens(page);

  const initial = await page.evaluate(() => ({
    documentTitle: document.title,
    pageHeading: document.querySelector('.portal-title')?.textContent.trim() || '',
    headerName: document.querySelector('.cds--header__name')?.textContent.trim() || '',
    headerBackground: getComputedStyle(document.querySelector('.cds--header')).backgroundColor,
    headerToTitleGap: document.querySelector('.portal-title').getBoundingClientRect().top - document.querySelector('.cds--header').getBoundingClientRect().bottom,
    headerBottom: document.querySelector('.cds--header').getBoundingClientRect().bottom,
    titleTop: document.querySelector('.portal-title').getBoundingClientRect().top,
    contentMarginTop: getComputedStyle(document.querySelector('#main')).marginBlockStart,
    contentPaddingTop: getComputedStyle(document.querySelector('#main')).paddingBlockStart,
    contentClass: document.querySelector('#main')?.className || '',
    skipToContentHref: document.querySelector('.cds--skip-to-content')?.getAttribute('href') || '',
    historyHeadings: [...document.querySelectorAll('.history-section .section-heading')].map(node => node.textContent.trim()),
    visibleText: document.querySelector('main')?.innerText || '',
    tabLabels: [...document.querySelectorAll('[role="tab"]')].map(node => node.textContent.trim()),
    tiles: document.querySelectorAll('.cds--tile--clickable').length,
    tileLaunchIcons: document.querySelectorAll('.tool-tile .cds--tile--icon').length,
    pictograms: [...document.querySelectorAll('.tool-tile__pictogram svg')].map(node => {
      const tile = node.closest('.tool-tile').getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return {
        ariaHidden: node.getAttribute('aria-hidden'),
        width: rect.width,
        height: rect.height,
        topOffset: rect.top - tile.top,
        leftOffset: rect.left - tile.left,
      };
    }),
    toolLayouts: [...document.querySelectorAll('.tool-tile')].map(tile => {
      const pictogram = tile.querySelector('.tool-tile__pictogram').getBoundingClientRect();
      const content = tile.querySelector('.tool-tile__content').getBoundingClientRect();
      const title = tile.querySelector('h3').getBoundingClientRect();
      const description = tile.querySelector('p').getBoundingClientRect();
      const launch = tile.querySelector('.cds--tile--icon').getBoundingClientRect();
      return {
        iconRight: pictogram.right,
        contentLeft: content.left,
        titleLeft: title.left,
        descriptionLeft: description.left,
        descriptionRight: description.right,
        launchLeft: launch.left,
      };
    }),
    toolColumns: [...document.querySelectorAll('.tool-tile')].map(tile => {
      const column = tile.closest('[class*="cds--css-grid-column"], [class*="cds--col-"]');
      const rect = column?.getBoundingClientRect();
      return { className: column?.className || '', left: Math.round(rect?.left || 0), top: Math.round(rect?.top || 0) };
    }),
    historyColumns: [...document.querySelectorAll('.history-grid > [class*="cds--css-grid-column"], .history-grid > [class*="cds--col-"]')].map(column => ({
      width: column.getBoundingClientRect().width,
      gridWidth: column.parentElement.getBoundingClientRect().width,
      className: column.className,
    })),
    leftEdges: [
      document.querySelector('.portal-title'),
      document.querySelector('[role="tablist"]'),
      document.querySelector('#project-history-list'),
      document.querySelector('#tools-heading'),
      document.querySelector('.tool-tile'),
    ].map(node => Math.round(node.getBoundingClientRect().left)),
    toolGridCarbonClass: document.querySelector('.tools-grid')?.className || '',
    toolCopies: [...document.querySelectorAll('.tool-tile')].map(node => {
      const descriptionIds = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      return {
        title: node.querySelector('h3')?.textContent.trim() || '',
        description: node.querySelector('p')?.textContent.trim() || '',
        hint: node.querySelector('.tool-tile__hint')?.textContent.trim() || '',
        describedText: descriptionIds.map(id => document.getElementById(id)?.textContent.trim() || ''),
      };
    }),
    titleFontSize: parseFloat(getComputedStyle(document.querySelector('.portal-title')).fontSize),
    formTileTitleFinalGlyphTop: (() => {
      const node = document.querySelectorAll('.tool-tile h3')[1]?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent.length < 2) return null;
      const range = document.createRange();
      range.setStart(node, node.textContent.length - 1);
      range.setEnd(node, node.textContent.length);
      return range.getBoundingClientRect().top;
    })(),
    formTileTitlePreviousGlyphTop: (() => {
      const node = document.querySelectorAll('.tool-tile h3')[1]?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE || node.textContent.length < 2) return null;
      const range = document.createRange();
      range.setStart(node, node.textContent.length - 2);
      range.setEnd(node, node.textContent.length - 1);
      return range.getBoundingClientRect().top;
    })(),
    toolTitleFinalGlyphRows: [...document.querySelectorAll('.tool-tile h3')].map(node => {
      const text = node.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE || text.textContent.length < 2) return null;
      const previous = document.createRange();
      previous.setStart(text, text.textContent.length - 2);
      previous.setEnd(text, text.textContent.length - 1);
      const final = document.createRange();
      final.setStart(text, text.textContent.length - 1);
      final.setEnd(text, text.textContent.length);
      return { title: text.textContent, previousTop: previous.getBoundingClientRect().top, finalTop: final.getBoundingClientRect().top };
    }),
    sectionHeadingFontSize: parseFloat(getComputedStyle(document.querySelector('.section-heading')).fontSize),
    toolDescriptionFontSize: parseFloat(getComputedStyle(document.querySelector('.tool-tile__content p')).fontSize),
    historyDateFontSize: parseFloat(getComputedStyle(document.querySelector('.project-list__item time')).fontSize),
    tileNestedInteractive: [...document.querySelectorAll('.tool-tile')].some(node => node.querySelector('a, button')),
    containedLists: [...document.querySelectorAll('.cds--contained-list')].map(node => ({
      className: node.className,
      label: node.getAttribute('aria-label') || document.getElementById(node.getAttribute('aria-labelledby'))?.textContent.trim() || '',
      itemCount: node.querySelectorAll('.cds--contained-list-item').length,
    })),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.innerText,
    pageBackground: getComputedStyle(document.querySelector('.app-theme-root')).backgroundColor,
    tileBackground: getComputedStyle(document.querySelector('.tool-tile')).backgroundColor,
    toolGridClass: document.querySelector('.tool-grid')?.className || '',
    labels: [...document.querySelectorAll('.projects:not(.form-history) .project-title')].map(node => node.textContent.trim()),
    formHistoryLabels: [...document.querySelectorAll('.form-history .project-title')].map(node => node.textContent.trim()),
    projectRowCount: document.querySelectorAll('.projects:not(.form-history) .cds--contained-list-item').length,
    formRowCount: document.querySelectorAll('.form-history .cds--contained-list-item').length,
    historyToggles: [...document.querySelectorAll('.history-toggle')].map(node => ({ name: node.getAttribute('aria-label'), expanded: node.getAttribute('aria-expanded'), controls: node.getAttribute('aria-controls') })),
    sectionOrder: [...document.querySelectorAll('main > section')].map(node => node.querySelector('h2')?.textContent.trim()),
    describedTiles: [...document.querySelectorAll('.tool-tile')].map(node => {
      const ids = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      return { ids, texts: ids.map(id => document.getElementById(id)?.textContent.trim() || '') };
    }),
    openIconCount: document.querySelectorAll('.projects:not(.form-history) .history-link__icon').length,
    openIconsDecorative: [...document.querySelectorAll('.projects:not(.form-history) .history-link__icon')].every(node => node.getAttribute('aria-hidden') === 'true'),
    nestedInteractiveContent: [...document.querySelectorAll('.cds--contained-list-item__content')].some(node => node.tagName === 'BUTTON' && node.querySelector('a, button')),
    formActionLinks: document.querySelectorAll('.form-history .cds--contained-list-item__action a').length,
    formOverflowMenus: document.querySelectorAll('.form-history .cds--overflow-menu').length,
    projectActionLinks: document.querySelectorAll('.projects:not(.form-history) .cds--contained-list-item__action a').length,
    actionOverflow: [...document.querySelectorAll('.project-list__actions > *')].some(node => {
      const rect = node.getBoundingClientRect();
      return rect.right > window.innerWidth || rect.left < 0;
    }),
    clickableRows: document.querySelectorAll('.project-list .cds--contained-list-item--clickable').length,
    rowHeights: [...document.querySelectorAll('.project-list .cds--contained-list-item')].filter(node => node.getClientRects().length).map(node => node.getBoundingClientRect().height),
  }));
  if (initial.documentTitle !== '山歩会企画ツール一覧' || initial.pageHeading !== '山歩会企画ツール一覧' || initial.headerName !== '山歩会企画ツール一覧') {
    throw new Error(`${name}: site title is inconsistent: ${JSON.stringify({ title: initial.documentTitle, heading: initial.pageHeading, header: initial.headerName })}`);
  }
  if (['企画の管理', '履歴', '開いた企画や、作ったフォームを確認できます。'].some(copy => initial.visibleText.includes(copy))) {
    throw new Error(`${name}: removed history copy is still visible: ${initial.visibleText}`);
  }
  if (initial.historyHeadings.length || initial.tabLabels.join('|') !== '最近の企画|作成したフォーム') {
    throw new Error(`${name}: history tab labels are duplicated: ${JSON.stringify({ headings: initial.historyHeadings, tabs: initial.tabLabels })}`);
  }
  if (initial.headerBackground !== 'rgb(22, 22, 22)') {
    throw new Error(`${name}: Carbon header is not fixed to black in light theme: ${initial.headerBackground}`);
  }
  if (!initial.contentClass.includes('cds--content') || initial.skipToContentHref !== '#main') {
    throw new Error(`${name}: Carbon page shell is missing Content or SkipToContent: ${JSON.stringify({ content: initial.contentClass, skipHref: initial.skipToContentHref })}`);
  }
  if (initial.headerToTitleGap < 60 || initial.headerToTitleGap > 80) {
    throw new Error(`${name}: Carbon content spacing does not clear the header consistently: ${JSON.stringify({ gap: initial.headerToTitleGap, headerBottom: initial.headerBottom, titleTop: initial.titleTop, margin: initial.contentMarginTop, padding: initial.contentPaddingTop })}`);
  }
  await selectHistoryTab(page, '作成したフォーム');
  const formOpenTargetHeights = await page.locator('.form-history .history-response-link').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
  if (formOpenTargetHeights.some(height => height < 44)) throw new Error(`${name}: form open actions are too small for touch input: ${JSON.stringify(formOpenTargetHeights)}`);
  if (!await page.locator('.form-history').innerText().then(text => text.includes('作成日時'))) throw new Error(`${name}: form date label is missing`);
  await selectHistoryTab(page, '最近の企画');
  const themeTrigger = page.getByRole('button', { name: /表示設定を開く（現在：端末の設定に合わせる）/ });
  if (await themeTrigger.getAttribute('aria-expanded') === 'true') {
    await themeTrigger.focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[aria-label^="表示設定を"]')?.getAttribute('aria-expanded') === 'false');
  }
  await page.screenshot({ path: path.join(OUT, `${name}-initial.png`), fullPage: true });
  if (initial.tiles !== 4) throw new Error(`${name}: expected 4 Carbon tiles, got ${initial.tiles}`);
  if (initial.tileLaunchIcons !== 4 || initial.tileNestedInteractive) throw new Error(`${name}: ClickableTile icon or nesting regression`);
  if (initial.pictograms.length !== 4 || initial.pictograms.some(icon => icon.ariaHidden !== 'true' || Math.abs(icon.width - 48) > 1 || Math.abs(icon.height - 48) > 1)) {
    throw new Error(`${name}: pictogram size or decorative aria regression: ${JSON.stringify(initial.pictograms)}`);
  }
  if (initial.toolLayouts.some(layout => (
    layout.contentLeft - layout.iconRight < 11
    || Math.abs(layout.titleLeft - layout.contentLeft) > 1
    || Math.abs(layout.descriptionLeft - layout.contentLeft) > 1
    || layout.descriptionRight > layout.launchLeft + 1
  ))) {
    throw new Error(`${name}: tool tile two-column or Launch spacing regression: ${JSON.stringify(initial.toolLayouts)}`);
  }
  const firstPictogram = initial.pictograms[0];
  if (initial.pictograms.some(icon => Math.abs(icon.topOffset - firstPictogram.topOffset) > 1 || Math.abs(icon.leftOffset - firstPictogram.leftOffset) > 1)) {
    throw new Error(`${name}: pictogram alignment drift: ${JSON.stringify(initial.pictograms)}`);
  }
  if (!initial.toolGridClass.includes('cds--layer-one') || initial.pageBackground === initial.tileBackground) {
    throw new Error(`${name}: ClickableTile is not using a distinct contextual layer: ${JSON.stringify(initial)}`);
  }
  if (initial.containedLists.length !== 2) throw new Error(`${name}: expected 2 Carbon contained lists, got ${initial.containedLists.length}`);
  if (initial.containedLists.some(list => !list.className.includes('cds--contained-list--on-page') || !list.className.includes('cds--contained-list--lg'))) {
    throw new Error(`${name}: contained list variant or size regression: ${JSON.stringify(initial.containedLists)}`);
  }
  if (initial.containedLists[0].label !== '最近の企画' || initial.containedLists[1].label !== '作成したフォーム') {
    throw new Error(`${name}: contained list labels regression: ${JSON.stringify(initial.containedLists)}`);
  }
  if (initial.overflowX > 1) throw new Error(`${name}: initial overflow ${initial.overflowX}px`);
  if (initial.leftEdges.some(left => Math.abs(left - initial.leftEdges[0]) > 1)) throw new Error(`${name}: main headings, tabs, list, and tool card do not share the page gutter: ${JSON.stringify(initial.leftEdges)}`);
  for (const text of ['山歩会企画ツール一覧', '登山計画書メーカー', '応募フォームメーカー', 'サークル企画ツール', '学務提出書類作成ツール', '最近の企画', '作成したフォーム', '開いた日時']) {
    if (!initial.text.includes(text)) throw new Error(`${name}: missing ${text}`);
  }
  const expectedToolCopy = [
    ['登山計画書メーカー', 'YAMAPの画像から登山計画書を作成します。', ''],
    ['応募フォームメーカー', '参加者募集用のGoogleフォームを作成します。', ''],
    ['サークル企画ツール', '車割り・班割りと交通費の精算を行います。', ''],
    ['学務提出書類作成ツール', '学務に提出する書類を作成します。', 'PC用アプリのダウンロードページ'],
  ];
  if (JSON.stringify(initial.toolCopies.map(item => [item.title, item.description, item.hint])) !== JSON.stringify(expectedToolCopy)
    || initial.toolCopies.some(item => JSON.stringify(item.describedText) !== JSON.stringify([item.description, ...(item.hint ? [item.hint] : [])]))) {
    throw new Error(`${name}: tool copy or accessible descriptions regression: ${JSON.stringify(initial.toolCopies)}`);
  }
  if (initial.labels[0] !== 'React企画' || initial.labels[1] !== '春山企画' || initial.labels[2] !== '夏山企画') throw new Error(`${name}: project history ordering or current React storage regression`);
  if (initial.formHistoryLabels[0] !== '夏山応募フォーム' || initial.formHistoryLabels[1] !== '春山応募フォーム') throw new Error(`${name}: form history ordering regression`);
  if (JSON.stringify(initial.sectionOrder) !== JSON.stringify([null, 'ツール'])) throw new Error(`${name}: populated history section order regression: ${JSON.stringify(initial.sectionOrder)}`);
  if (initial.projectRowCount !== 3 || initial.formRowCount !== 3 || initial.historyToggles.length !== 2) throw new Error(`${name}: history preview does not start at three rows: ${JSON.stringify(initial)}`);
  if (initial.historyToggles.some(toggle => toggle.expanded !== 'false' || !toggle.controls)) throw new Error(`${name}: preview toggle semantics regression: ${JSON.stringify(initial.historyToggles)}`);
  const toolColumnCount = viewport.width < 672 ? 1 : viewport.width < 1056 ? 2 : 4;
  const toolRowTops = [...new Set(initial.toolColumns.map(column => column.top))];
  const hasSpan = (classes, breakpoint, span) => classes.includes(`cds--${breakpoint}:col-span-${span}`) || classes.includes(`cds--col-${breakpoint}-${span}`);
  if (initial.toolColumns.length !== 4 || initial.toolColumns.some(column => !hasSpan(column.className, 'sm', 4) || !hasSpan(column.className, 'md', 4) || !hasSpan(column.className, 'lg', 4))) throw new Error(`${name}: Carbon tool column spans regression: ${JSON.stringify(initial.toolColumns)}`);
  if (!initial.toolGridCarbonClass.includes('cds--css-grid--narrow') || !initial.toolGridCarbonClass.includes('cds--css-grid--with-row-gap') || toolRowTops.length !== Math.ceil(4 / toolColumnCount)) throw new Error(`${name}: Carbon tool grid column count regression: ${JSON.stringify(initial)}`);
  if (initial.historyColumns.length !== 2 || initial.historyColumns.some(column => column.width / column.gridWidth < 0.85 || !hasSpan(column.className, 'sm', 4) || !hasSpan(column.className, 'md', 8) || !hasSpan(column.className, 'lg', 16))) throw new Error(`${name}: full-width history grid regression: ${JSON.stringify(initial.historyColumns)}`);
  if (Math.abs(initial.titleFontSize - 20) > 1) throw new Error(`${name}: portal title is not Carbon heading-03: ${initial.titleFontSize}px`);
  if (initial.formTileTitleFinalGlyphTop !== null && initial.formTileTitlePreviousGlyphTop !== null && Math.abs(initial.formTileTitleFinalGlyphTop - initial.formTileTitlePreviousGlyphTop) > 1) throw new Error(`${name}: Japanese prolonged sound mark wrapped alone in tool title`);
  if (initial.toolTitleFinalGlyphRows.some(item => item && Math.abs(item.previousTop - item.finalTop) > 1)) throw new Error(`${name}: final Japanese title character wrapped onto an isolated line: ${JSON.stringify(initial.toolTitleFinalGlyphRows)}`);
  if (Math.abs(initial.sectionHeadingFontSize - 14) > 1 || Math.abs(initial.toolDescriptionFontSize - 14) > 1 || Math.abs(initial.historyDateFontSize - 12) > 1) throw new Error(`${name}: Carbon type hierarchy regression: ${JSON.stringify({ sectionHeadingFontSize: initial.sectionHeadingFontSize, toolDescriptionFontSize: initial.toolDescriptionFontSize, historyDateFontSize: initial.historyDateFontSize })}`);
  if (viewport.width <= 390) {
    const stress = await page.locator('.tool-tile').nth(3).evaluate(tile => {
      const title = tile.querySelector('h3');
      const description = tile.querySelector('p');
      const hint = tile.querySelector('.tool-tile__hint');
      title.textContent = '学務提出書類作成ツール'.repeat(6);
      description.textContent = '学務に出す書類を作ります。引き継ぎデータも使えます。'.repeat(6) + 'DownloadWithoutAnySpaces'.repeat(5);
      if (hint) hint.textContent = 'PC用アプリをダウンロード'.repeat(5);
      const measurements = [title, description, hint].filter(Boolean).map(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
      const launch = tile.querySelector('.cds--tile--icon').getBoundingClientRect();
      const text = description.getBoundingClientRect();
      return { measurements, launchLeft: launch.left, descriptionRight: text.right, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    if (stress.measurements.some(item => item.scrollWidth > item.clientWidth + 1) || stress.descriptionRight > stress.launchLeft + 1 || stress.overflowX > 1) {
      throw new Error(`${name}: long tool copy overlaps or overflows: ${JSON.stringify(stress)}`);
    }
  }
  if (initial.describedTiles.some(tile => !tile.ids.length || tile.texts.some(text => !text))) throw new Error(`${name}: a tool tile does not reference its description: ${JSON.stringify(initial.describedTiles)}`);
  const toolsTopBeforeBulk = await page.locator('#tools-heading').evaluate(node => node.getBoundingClientRect().top);
  await page.evaluate(() => {
    localStorage.setItem('sanpokai_portal_project_history_v1', JSON.stringify({ version: 1, projects: Array.from({ length: 100 }, (_, index) => ({
      roomId: `BULK-${index + 1}`, name: `大量履歴${index + 1}`, updatedAt: 1000 + index,
    })) }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai_portal_project_history_v1' }));
  });
  await page.waitForFunction(() => document.querySelectorAll('#project-history-list .history-link').length === 3);
  const toolsTopAfterBulk = await page.locator('#tools-heading').evaluate(node => node.getBoundingClientRect().top);
  if (Math.abs(toolsTopAfterBulk - toolsTopBeforeBulk) > 1) throw new Error(`${name}: hidden history moved tools after 100 records were added`);
  await page.evaluate(() => {
    localStorage.setItem('sanpokai_portal_project_history_v1', JSON.stringify({ version: 1, projects: [] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai_portal_project_history_v1' }));
  });
  await page.waitForFunction(() => document.querySelectorAll('#project-history-list .history-link').length === 3);
  if (initial.openIconCount !== 3 || !initial.openIconsDecorative) throw new Error(`${name}: Launch icon anatomy regression`);
  if (initial.text.includes('企画ID：') || initial.text.includes('フォームID：') || /(?:^|\n)ID：/.test(initial.text)) {
    throw new Error(`${name}: obsolete history copy or IDs remain`);
  }
  if (initial.nestedInteractiveContent) throw new Error(`${name}: contained list item content nested an interactive element`);
  if (initial.formActionLinks !== 0 || initial.formOverflowMenus !== 1) throw new Error(`${name}: form history action anatomy regression: ${initial.formActionLinks} links, ${initial.formOverflowMenus} menus`);
  if (initial.projectActionLinks !== 0 || initial.actionOverflow || initial.clickableRows !== 0) throw new Error(`${name}: project history action geometry regression`);
  if (initial.rowHeights.some(height => height < 48)) throw new Error(`${name}: contained list row is shorter than Carbon lg: ${JSON.stringify(initial.rowHeights)}`);
  if (!initial.text.includes('作成したフォーム')) throw new Error(`${name}: missing form history section`);

  const projectToggle = page.getByRole('button', { name: '最近の企画をすべて表示' });
  const projectPanelId = await page.getByRole('tab', { name: '最近の企画', exact: true }).getAttribute('aria-controls');
  const formPanelId = await page.getByRole('tab', { name: '作成したフォーム', exact: true }).getAttribute('aria-controls');
  await projectToggle.focus();
  await page.keyboard.press('Enter');
  if (await page.locator('#project-history-list .cds--contained-list-item').count() !== 6) throw new Error(`${name}: project preview did not expand to all six records`);
  if (await page.locator('#form-history-list .cds--contained-list-item').count() !== 3) throw new Error(`${name}: project expansion changed form history`);
  if (await page.getByRole('button', { name: '最近の企画を3件だけ表示' }).getAttribute('aria-expanded') !== 'true') throw new Error(`${name}: expanded project ARIA state missing`);
  await page.keyboard.press('Space');
  if (await page.locator('#project-history-list .cds--contained-list-item').count() !== 3) throw new Error(`${name}: project history did not collapse to three records`);
  if (await page.evaluate(() => !document.activeElement?.classList.contains('history-toggle'))) throw new Error(`${name}: collapsing history lost button focus`);
  await page.getByRole('button', { name: '最近の企画をすべて表示' }).click();
  await selectHistoryTab(page, '作成したフォーム');
  if (await page.locator(`#${projectPanelId}`).isVisible() || !await page.locator(`#${formPanelId}`).isVisible()) throw new Error(`${name}: inactive history panel remained visible or focusable`);
  await page.getByRole('button', { name: '作成したフォームをすべて表示' }).click();
  if (await page.locator('#project-history-list .cds--contained-list-item').count() !== 6 || await page.locator('#form-history-list .cds--contained-list-item').count() !== 6) throw new Error(`${name}: independent history expansion failed`);
  await selectHistoryTab(page, '最近の企画');
  if (await page.locator(`#${projectPanelId}`).locator('#project-history-list .cds--contained-list-item').count() !== 6) throw new Error(`${name}: project expansion did not survive the tab round trip`);
  await selectHistoryTab(page, '作成したフォーム');
  if (await page.locator(`#${formPanelId}`).locator('#form-history-list .cds--contained-list-item').count() !== 6) throw new Error(`${name}: form expansion did not survive the tab round trip`);
  const longProjectLayout = await page.locator('#project-history-list .history-link').filter({ hasText: '長い企画名NoSpace' }).evaluate(node => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    text: node.textContent.trim(),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (longProjectLayout.scrollWidth > longProjectLayout.clientWidth + 1 || longProjectLayout.overflowX > 1) throw new Error(`${name}: long no-space project name overflowed: ${JSON.stringify(longProjectLayout)}`);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  if (await page.locator('#project-history-list .cds--contained-list-item').count() !== 6 || await page.locator('#form-history-list .cds--contained-list-item').count() !== 6) throw new Error(`${name}: visibility refresh reset expanded history`);
  if (await page.getByRole('tab', { name: '作成したフォーム', exact: true }).getAttribute('aria-selected') !== 'true') throw new Error(`${name}: visibility refresh reset selected tab`);
  await selectHistoryTab(page, '作成したフォーム');
  const formActionAudit = await page.locator('#form-history-list .cds--contained-list-item').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('.project-title')?.textContent.trim(),
    createdText: row.querySelector('time')?.textContent.trim() || '',
    createdDateTime: row.querySelector('time')?.getAttribute('datetime') || '',
    responseText: row.querySelector('.history-response-link')?.textContent.trim() || '',
    responseHref: row.querySelector('.history-response-link')?.getAttribute('href') || '',
    responseTarget: row.querySelector('.history-response-link')?.getAttribute('target') || '',
    responseRel: row.querySelector('.history-response-link')?.getAttribute('rel') || '',
    responseName: row.querySelector('.history-response-link')?.getAttribute('aria-label') || '',
    copyText: row.querySelector('.form-copy-button')?.textContent.trim() || '',
    copyName: row.querySelector('.form-copy-button')?.getAttribute('aria-label') || '',
    copyHeight: row.querySelector('.form-copy-button')?.getBoundingClientRect().height || 0,
    responseHeight: row.querySelector('.history-response-link')?.getBoundingClientRect().height || 0,
    projectHeight: row.querySelector('.history-project-link')?.getBoundingClientRect().height || 0,
    responseFontSize: row.querySelector('.history-response-link') ? getComputedStyle(row.querySelector('.history-response-link')).fontSize : '',
    projectFontSize: row.querySelector('.history-project-link') ? getComputedStyle(row.querySelector('.history-project-link')).fontSize : '',
    projectText: row.querySelector('.history-project-link')?.textContent.trim() || '',
    projectHref: row.querySelector('.history-project-link')?.getAttribute('href') || '',
    projectName: row.querySelector('.history-project-link')?.getAttribute('aria-label') || '',
    menuCount: row.querySelectorAll('.cds--overflow-menu').length,
    contentOrder: [...row.querySelector('.project-list__item')?.children || []].map(node => node.tagName),
  })));
  const [fullForm, responseOnlyForm, projectOnlyForm, editOnlyForm, noUrlForm, unsafeForm] = formActionAudit;
  if (fullForm.responseText !== '応募フォームを開く' || fullForm.responseName !== '「夏山応募フォーム」の応募フォームを開く（新しいタブ）' || fullForm.responseHref !== 'https://docs.google.com/forms/d/FORM-B/viewform' || fullForm.responseTarget !== '_blank' || !fullForm.responseRel.includes('noopener') || !fullForm.responseRel.includes('noreferrer') || fullForm.projectText !== '企画を開く' || fullForm.projectName !== '「夏山応募フォーム」の企画を開く（新しいタブ）' || !fullForm.projectHref.includes('?room=PROJECT-B') || fullForm.copyText !== '応募用リンクをコピー' || fullForm.copyName !== '「夏山応募フォーム」の応募用リンクをコピー' || fullForm.copyHeight < 44 || fullForm.responseHeight < 44 || fullForm.projectHeight < 44 || fullForm.responseFontSize !== fullForm.projectFontSize || fullForm.menuCount !== 1) throw new Error(`${name}: full form action links regression: ${JSON.stringify(fullForm)}`);
  if (responseOnlyForm.responseText !== '応募フォームを開く' || responseOnlyForm.copyText !== '応募用リンクをコピー' || responseOnlyForm.menuCount || responseOnlyForm.projectText || projectOnlyForm.responseText || projectOnlyForm.copyText || projectOnlyForm.menuCount || projectOnlyForm.projectText !== '企画を開く' || noUrlForm.responseText || noUrlForm.copyText || noUrlForm.menuCount || noUrlForm.projectText || editOnlyForm.responseText || editOnlyForm.copyText || editOnlyForm.projectText || unsafeForm.responseText || unsafeForm.copyText || unsafeForm.projectText || unsafeForm.menuCount) throw new Error(`${name}: missing/edit-only/unsafe form action regression: ${JSON.stringify(formActionAudit)}`);
  if (editOnlyForm.menuCount !== 1 || editOnlyForm.name !== '雪山応募フォーム') throw new Error(`${name}: edit-only form lost its copy menu: ${JSON.stringify(editOnlyForm)}`);
  if (unsafeForm.createdText !== '作成日時不明' || unsafeForm.createdDateTime) throw new Error(`${name}: invalid form timestamp was not shown as unknown: ${JSON.stringify(unsafeForm)}`);
  if (JSON.stringify(fullForm.contentOrder.slice(0, 3)) !== JSON.stringify(['SPAN', 'TIME', 'DIV']) || !fullForm.contentOrder.includes('SPAN')) throw new Error(`${name}: form name/date/action order regression: ${JSON.stringify(fullForm.contentOrder)}`);
  const editOnlyRow = page.locator('#form-history-list .cds--contained-list-item').filter({ has: page.getByText('雪山応募フォーム', { exact: true }) });
  await editOnlyRow.locator('.cds--overflow-menu').focus();
  await page.keyboard.press('Enter');
  const editOnlyItems = await page.getByRole('menuitem').allTextContents();
  if (JSON.stringify(editOnlyItems.map(text => text.trim())) !== JSON.stringify(['フォームを編集する', 'フォームの編集リンクをコピー'])) throw new Error(`${name}: edit-only menu exposed a missing response link: ${JSON.stringify(editOnlyItems)}`);
  await page.keyboard.press('Escape');
  await selectHistoryTab(page, '最近の企画');
  await page.evaluate(() => {
    localStorage.setItem('sanpo-react:v1:LIVE-UPDATE:room', JSON.stringify({ roomName: '更新中に追加された企画', lastUpdatedAt: 1700000000000 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpo-react:v1:LIVE-UPDATE:room' }));
  });
  await page.getByRole('link', { name: /更新中に追加された企画/ }).waitFor();
  const updatedOrder = await page.locator('main h2').allTextContents();
  if (JSON.stringify(updatedOrder) !== JSON.stringify(initial.sectionOrder.filter(Boolean))) throw new Error(`${name}: history update moved the focused section order`);
  if (await page.locator('#project-history-list .cds--contained-list-item').count() !== 7 || await page.locator('#form-history-list .cds--contained-list-item').count() !== 6) throw new Error(`${name}: storage refresh reset expanded history`);

  await selectHistoryTab(page, '最近の企画');
  const rowFocus = await page.locator('.projects:not(.form-history) .history-link').first().evaluate((link) => {
    link.focus();
    const focus = getComputedStyle(link);
    return { outlineStyle: focus.outlineStyle, outlineColor: focus.outlineColor, outlineWidth: focus.outlineWidth, boxShadow: focus.boxShadow };
  });
  const rowFocusInvisible = rowFocus.outlineStyle === 'none' && (rowFocus.outlineWidth === '0px' || rowFocus.outlineColor === 'rgba(0, 0, 0, 0)') && (!rowFocus.boxShadow || rowFocus.boxShadow === 'none');
  if (rowFocusInvisible) {
    throw new Error(`${name}: contained list row focus indicator is missing: ${JSON.stringify(rowFocus)}`);
  }

  const projectPopupPromise = page.waitForEvent('popup');
  await page.locator('.projects:not(.form-history) .history-link').first().focus();
  await page.keyboard.press('Enter');
  const projectPopup = await projectPopupPromise;
  if (!projectPopup.url().includes('?room=ROOM-C')) throw new Error(`${name}: recent row navigation regression: ${projectPopup.url()}`);
  await projectPopup.close();

  const recentRow = page.locator('.projects:not(.form-history) .history-link').first();
  const openIconBounds = await recentRow.locator('.history-link__icon').boundingBox();
  if (!openIconBounds) throw new Error(`${name}: Launch icon has no hit area`);
  const iconPopupPromise = page.waitForEvent('popup');
  await page.mouse.click(openIconBounds.x + openIconBounds.width / 2, openIconBounds.y + openIconBounds.height / 2);
  const iconPopup = await iconPopupPromise;
  if (!iconPopup.url().includes('?room=ROOM-C')) throw new Error(`${name}: Launch icon did not activate the row: ${iconPopup.url()}`);
  await iconPopup.close();

  await selectHistoryTab(page, '作成したフォーム');
  const responsePopupPromise = page.waitForEvent('popup');
  await page.locator('.form-history .history-response-link').first().focus();
  await page.keyboard.press('Enter');
  const responsePopup = await responsePopupPromise;
  if (!responsePopup.url().includes('/forms/d/FORM-B/viewform')) throw new Error(`${name}: response link destination regression: ${responsePopup.url()}`);
  await responsePopup.close();

  const formProjectPopupPromise = page.waitForEvent('popup');
  await page.locator('.form-history .history-project-link').first().click();
  const formProjectPopup = await formProjectPopupPromise;
  if (!formProjectPopup.url().includes('?room=PROJECT-B')) throw new Error(`${name}: explicit project link regression: ${formProjectPopup.url()}`);
  await formProjectPopup.close();

  const formRow = page.locator('.form-history .cds--contained-list-item').first();
  await formRow.locator('.cds--overflow-menu').focus();
  const noRowPopup = page.waitForEvent('popup', { timeout: 500 }).then(() => false).catch(() => true);
  await page.keyboard.press('Enter');
  if (!(await noRowPopup)) throw new Error(`${name}: opening the OverflowMenu also opened the project`);
  const menuBounds = await page.getByRole('menu').boundingBox();
  if (!menuBounds || menuBounds.left < 0 || menuBounds.right > viewport.width) throw new Error(`${name}: overflow menu escaped viewport: ${JSON.stringify(menuBounds)}`);
  if (await page.getByRole('menu').getAttribute('aria-label') !== '「夏山応募フォーム」のフォーム操作') throw new Error(`${name}: form menu label regression`);
  const menuItems = await page.getByRole('menuitem').evaluateAll(nodes => nodes.map(node => {
    const content = node.querySelector('.cds--overflow-menu-options__option-content');
    return { text: node.textContent.trim(), scrollWidth: content?.scrollWidth || 0, clientWidth: content?.clientWidth || 0, textOverflow: content ? getComputedStyle(content).textOverflow : '' };
  }));
  if (JSON.stringify(menuItems.map(item => item.text)) !== JSON.stringify(['フォームを編集する', 'フォームの編集リンクをコピー'])) throw new Error(`${name}: response-copy item remained in the edit menu: ${JSON.stringify(menuItems)}`);
  if (menuItems.some(item => item.scrollWidth > item.clientWidth || item.textOverflow === 'ellipsis')) throw new Error(`${name}: overflow menu item text was truncated: ${JSON.stringify(menuItems)}`);
  if (await page.evaluate(() => document.activeElement?.getAttribute('role')) !== 'menuitem') throw new Error(`${name}: OverflowMenu did not move focus to its first item`);
  await page.screenshot({ path: path.join(OUT, `${name}-menu-open.png`), fullPage: false });
  await page.keyboard.press('Escape');
  if (await page.getByRole('menu').count() !== 0 || await page.evaluate(() => document.activeElement?.classList?.contains('cds--overflow-menu') !== true)) {
    throw new Error(`${name}: Escape did not close OverflowMenu and restore trigger focus`);
  }
  const directCopy = formRow.locator('.form-copy-button');
  const responseCopyPopup = page.waitForEvent('popup', { timeout: 500 }).then(() => false).catch(() => true);
  await directCopy.focus();
  await page.keyboard.press('Enter');
  if (!(await responseCopyPopup)) throw new Error(`${name}: response copy opened a new tab`);
  await page.waitForFunction(() => document.body.innerText.includes('応募用リンクをコピーしました'));
  if (await page.evaluate(() => window.__QA_COPIED__) !== 'https://docs.google.com/forms/d/FORM-B/viewform') throw new Error(`${name}: response URL copy regression`);
  if (await directCopy.evaluate(node => node !== document.activeElement)) throw new Error(`${name}: response copy moved focus away from its button`);

  await page.locator('.toast-host button').click();
  await page.evaluate(() => { window.__QA_CLIPBOARD_FAIL__ = true; });
  const failedCopyPopup = page.waitForEvent('popup', { timeout: 500 }).then(() => false).catch(() => true);
  await directCopy.click();
  if (!(await failedCopyPopup)) throw new Error(`${name}: failed response copy opened a new tab`);
  await page.getByRole('alert').filter({ hasText: 'コピーできませんでした' }).waitFor();
  if (await page.getByText('応募用リンクをコピーしました').count()) throw new Error(`${name}: clipboard failure showed a success message`);
  await page.evaluate(() => { window.__QA_CLIPBOARD_FAIL__ = false; });

  await formRow.locator('.cds--overflow-menu').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'フォームの編集リンクをコピー' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('フォームの編集リンクをコピーしました'));
  if (await page.evaluate(() => window.__QA_COPIED__) !== 'https://docs.google.com/forms/d/FORM-B/edit') throw new Error(`${name}: editor URL copy regression`);

  const olderFormRow = page.locator('.form-history .cds--contained-list-item').nth(1);
  const olderCopyPopup = page.waitForEvent('popup', { timeout: 500 }).then(() => false).catch(() => true);
  await olderFormRow.locator('.form-copy-button').click();
  if (!(await olderCopyPopup)) throw new Error(`${name}: second response copy opened a new tab`);
  await page.waitForFunction(() => document.body.innerText.includes('応募用リンクをコピーしました'));
  if (await page.evaluate(() => window.__QA_COPIED__) !== 'https://docs.google.com/forms/d/FORM-A/viewform') throw new Error(`${name}: second history response URL mix-up`);

  await page.evaluate(() => {
    const base = Math.ceil(Date.now() / 60_000) * 60_000 + 2 * 60_000;
    localStorage.clear();
    localStorage.setItem('sanpokai_portal_project_history_v1', JSON.stringify({ version: 1, projects: [
      { roomId: 'NEWER-A', name: '別の企画1', lastOpenedAt: base + 5 * 60_000 },
      { roomId: 'NEWER-B', name: '別の企画2', lastOpenedAt: base + 4 * 60_000 },
      { roomId: 'DUP-A', name: '同じ企画名', lastOpenedAt: base + 15_000 },
      { roomId: 'DUP-B', name: '同じ企画名', lastOpenedAt: base + 45_000 },
    ] }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai_portal_project_history_v1' }));
  });
  await selectHistoryTab(page, '最近の企画');
  await page.waitForFunction(() => document.querySelectorAll('#project-history-list .cds--contained-list-item').length === 4);
  await page.getByRole('button', { name: '最近の企画を3件だけ表示' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#project-history-list .cds--contained-list-item').length === 3);
  const duplicatePreview = page.locator('#project-history-list .cds--contained-list-item').nth(2);
  const previewDisambiguator = await duplicatePreview.locator('.project-disambiguator').textContent().catch(() => 'missing');
  if (previewDisambiguator !== '企画ID：DUP-B') throw new Error(`${name}: full-history duplicate was not disambiguated inside the three-item preview: ${previewDisambiguator}; rows=${await page.locator('#project-history-list .cds--contained-list-item').allTextContents()}`);
  await page.getByRole('button', { name: '最近の企画をすべて表示' }).click();
  const duplicateRows = page.locator('#project-history-list .cds--contained-list-item').filter({ hasText: '同じ企画名' });
  if (await duplicateRows.count() !== 2 || await duplicateRows.nth(0).locator('.project-disambiguator').textContent() !== '企画ID：DUP-B' || await duplicateRows.nth(1).locator('.project-disambiguator').textContent() !== '企画ID：DUP-A') {
    throw new Error(`${name}: duplicate room IDs were not both shown`);
  }
  for (const roomId of ['DUP-A', 'DUP-B']) {
    const popupPromise = page.waitForEvent('popup');
    await page.locator(`#project-history-list a[href$="room=${roomId}"]`).click();
    const popup = await popupPromise;
    if (new URL(popup.url()).searchParams.get('room') !== roomId) throw new Error(`${name}: duplicate project opened the wrong room: ${popup.url()}`);
    await popup.close();
  }

  await page.locator('.tool-tile').first().focus();
  const tilePopupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const tilePopup = await tilePopupPromise;
  if (!tilePopup.url().includes('tozan-keikaku-syo-maker')) throw new Error(`${name}: ClickableTile Enter navigation regression: ${tilePopup.url()}`);
  await tilePopup.close();

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
      headerBg: css(document.querySelector('.cds--header'))?.backgroundColor || '',
      overflowX: root.scrollWidth - root.clientWidth,
    };
  }, THEME_KEY);

  if (dark.preference !== 'dark' || dark.rootTheme !== 'g100') throw new Error(`${name}: dark preference failed: ${JSON.stringify(dark)}`);
  if ([dark.bodyBg, dark.appBg, dark.tileBg, dark.panelBg].includes('rgb(255, 255, 255)')) throw new Error(`${name}: white surface leaked: ${JSON.stringify(dark)}`);
  if (dark.tileColor === 'rgb(22, 22, 22)' || dark.tileColor === 'rgb(0, 0, 0)') throw new Error(`${name}: dark tile text stayed dark: ${JSON.stringify(dark)}`);
  if (dark.headerBg !== 'rgb(22, 22, 22)') throw new Error(`${name}: Carbon header changed with dark page theme: ${dark.headerBg}`);
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
  await page.waitForSurfaceTokens?.catch?.(() => undefined);
  if (await page.evaluate(() => document.documentElement.dataset.carbonTheme) !== 'g100') throw new Error(`${name}: explicit dark did not override OS`);

  await page.reload();
  await page.locator('.portal-title').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForSurfaceTokens(page);
  if (await page.evaluate(key => localStorage.getItem(key), THEME_KEY) !== 'dark') throw new Error(`${name}: theme lost on reload-equivalent render`);

  async function setProjectCount(count) {
    await page.evaluate(({ count, themeKey }) => {
      localStorage.clear();
      localStorage.setItem(themeKey, 'dark');
      localStorage.setItem('sanpokai_portal_project_history_v1', JSON.stringify({ version: 1, projects: Array.from({ length: count }, (_, index) => ({
        roomId: `BOUNDARY-${index + 1}`,
        name: `境界確認企画${index + 1}`,
        updatedAt: 1000 + index,
      })) }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai_portal_project_history_v1' }));
    }, { count, themeKey: THEME_KEY });
    await page.waitForFunction(expected => {
      const expanded = document.querySelector('.projects:not(.form-history) .history-toggle')?.getAttribute('aria-expanded') === 'true';
      return document.querySelectorAll('#project-history-list .history-link').length === Math.min(expected, expanded ? expected : 3);
    }, count);
  }
  async function setFormCount(count) {
    await page.evaluate(({ count }) => {
      localStorage.setItem('sanpokai-form-builder-history-v1', JSON.stringify(Array.from({ length: count }, (_, index) => ({
        formId: `BOUNDARY-FORM-${index + 1}`,
        planName: `境界確認フォーム${index + 1}`,
        createdAt: `2026-10-${String(14 - index).padStart(2, '0')}T10:00:00.000Z`,
        editUrl: `https://docs.google.com/forms/d/BOUNDARY-FORM-${index + 1}/edit`,
      }))));
      window.dispatchEvent(new StorageEvent('storage', { key: 'sanpokai-form-builder-history-v1' }));
    }, { count });
    await page.waitForFunction(expected => {
      const expanded = document.querySelector('.form-history .history-toggle')?.getAttribute('aria-expanded') === 'true';
      return document.querySelectorAll('#form-history-list .cds--contained-list-item').length === Math.max(1, Math.min(expected, expanded ? expected : 3));
    }, count);
  }
  for (const count of [0, 1, 3]) {
    await setProjectCount(count);
    if (await page.locator('.projects:not(.form-history) .history-toggle').count() !== 0) throw new Error(`${name}: history boundary ${count} incorrectly showed a toggle`);
  }
  await setProjectCount(4);
  if (await page.locator('.projects:not(.form-history) .history-toggle').count() !== 1) throw new Error(`${name}: four-item history did not show a toggle`);
  await page.getByRole('button', { name: '最近の企画をすべて表示' }).click();
  const collapseButton = page.getByRole('button', { name: '最近の企画を3件だけ表示' });
  await collapseButton.focus();
  await setProjectCount(2);
  await page.waitForFunction(() => document.activeElement?.id === 'project-history-section');
  if (await page.locator('.projects:not(.form-history) .history-toggle').count() !== 0) throw new Error(`${name}: updated short history retained a toggle`);

  await setProjectCount(4);
  const projectCollapseButton = page.getByRole('button', { name: '最近の企画を3件だけ表示' });
  if (await projectCollapseButton.count()) await projectCollapseButton.click();
  const projectExpandButton = page.getByRole('button', { name: '最近の企画をすべて表示' });
  await projectExpandButton.focus();
  await setProjectCount(2);
  if (await page.evaluate(() => document.activeElement?.id) !== 'project-history-section') throw new Error(`${name}: collapsed project toggle removal did not move focus to its section`);
  await setProjectCount(4);
  await page.getByRole('button', { name: '最近の企画をすべて表示' }).click();
  await page.locator('.tool-tile').first().focus();
  await setProjectCount(2);
  if (await page.locator('.tool-tile').first().evaluate(node => node === document.activeElement) !== true) throw new Error(`${name}: project refresh stole focus from a still-visible tool`);
  await setProjectCount(4);
  if (await page.locator('#project-history-list .history-link').count() !== 4 || await page.getByRole('button', { name: '最近の企画を3件だけ表示' }).getAttribute('aria-expanded') !== 'true') throw new Error(`${name}: expanded project history did not recover after a short refresh`);

  await selectHistoryTab(page, '作成したフォーム');
  await setFormCount(4);
  await page.getByRole('button', { name: '作成したフォームをすべて表示' }).focus();
  await setFormCount(2);
  if (await page.evaluate(() => document.activeElement?.id) !== 'form-history-section') throw new Error(`${name}: collapsed form toggle removal did not move focus to its section`);
  await setFormCount(4);
  await page.getByRole('button', { name: '作成したフォームをすべて表示' }).click();
  await page.locator('.tool-tile').first().focus();
  await setFormCount(2);
  if (await page.locator('.tool-tile').first().evaluate(node => node === document.activeElement) !== true) throw new Error(`${name}: form refresh stole focus from a still-visible tool`);
  await setFormCount(4);
  if (await page.locator('#form-history-list .cds--contained-list-item').count() !== 4 || await page.getByRole('button', { name: '作成したフォームを3件だけ表示' }).getAttribute('aria-expanded') !== 'true') throw new Error(`${name}: expanded form history did not recover after a short refresh`);

  const removedFormMenu = page.locator('#form-history-list .cds--contained-list-item').nth(3).locator('.cds--overflow-menu');
  await removedFormMenu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'フォームの編集リンクをコピー' }).focus();
  await setFormCount(2);
  if (await page.evaluate(() => document.activeElement?.id) !== 'form-history-section') throw new Error(`${name}: removing the focused overflow-menu row did not move focus to the form section`);
  if (await page.getByRole('menu').count()) throw new Error(`${name}: removed form left its overflow menu open`);

  const focus = await focusFirstTileWithKeyboard(page);
  const focusInvisible = focus.outlineStyle === 'none' || focus.outlineWidth === '0px' || focus.outlineColor === 'rgba(0, 0, 0, 0)' || focus.outlineColor === 'transparent';
  if (focusInvisible && focus.boxShadow === 'none') throw new Error(`${name}: keyboard focus indicator missing: ${JSON.stringify(focus)}`);
  if (pageErrors.length) throw new Error(`${name}: page errors: ${pageErrors.join(' | ')}`);
  if (consoleErrors.length) throw new Error(`${name}: console errors: ${consoleErrors.join(' | ')}; resources: ${missingResources.join(' | ')}`);

  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ viewport, initial, dark, focus, pageErrors, consoleErrors }, null, 2));
  await context.close();
}

(async () => {
  fs.mkdirSync(process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy', { recursive: true });
  const { server, baseUrl } = await serveDist();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps'],
    env: { ...process.env, CHROMIUM_POLICY_DIR: process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy' },
  });
  try {
    for (const width of [320, 390, 640, 672, 1056, 1280]) {
      const name = width === 640 ? 'zoom-200-effective-640' : `viewport-${width}`;
      await run(browser, name, { width, height: 900 }, baseUrl);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Portal three-state Carbon theme browser smoke passed.');
})().catch(error => { console.error(error); process.exit(1); });
