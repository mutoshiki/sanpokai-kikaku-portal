const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

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

async function installIsolatedEnvironment(page) {
  await page.goto('about:blank?qa=portal');
  await page.evaluate(() => {
    const store = {
      syawari_last_room_id: 'ROOM-B',
      'syawari_last_opened_at_ROOM-A': '2026-09-04T16:42:00.000Z',
      'syawari_last_opened_at_ROOM-B': '2026-09-04T08:19:00.000Z',
      'sampokai_v10_split_ROOM-A': JSON.stringify({ roomName: '春山企画', lastUpdatedAt: 1000 }),
      'sampokai_v10_split_ROOM-B': JSON.stringify({ roomName: '夏山企画', lastUpdatedAt: 2000 }),
      'syawari_history_ROOM-A': JSON.stringify([{ time: 3000, data: { roomName: '春山企画', lastUpdatedAt: 1500 } }]),
      'sanpokai-form-builder-history-v1': JSON.stringify([
        { formId: 'FORM-B', planName: '夏山応募フォーム', title: '夏山応募フォーム', createdAt: '2026-08-02T10:00:00.000Z', projectId: 'PROJECT-B', projectUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=PROJECT-B', spreadsheetUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=PROJECT-B&handoff=legacy-token', responseUrl: 'https://docs.google.com/forms/d/FORM-B/viewform', editUrl: 'https://docs.google.com/forms/d/FORM-B/edit' },
        { formId: 'FORM-A', planName: '春山応募フォーム', title: '春山応募フォーム', createdAt: '2026-08-01T10:00:00.000Z', responseUrl: 'https://docs.google.com/forms/d/FORM-A/viewform' },
      ]),
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: key => { delete store[key]; },
        clear: () => Object.keys(store).forEach(key => delete store[key]),
        key: index => Object.keys(store)[index] ?? null,
        get length() { return Object.keys(store).length; },
      },
    });
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: async () => true } });

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
      value: { writeText: async value => { window.__QA_COPIED__ = value; } },
    });
  });
}

async function selectTheme(page, currentLabel, id) {
  await page.getByRole('button', { name: `テーマ設定：${currentLabel}` }).click();
  await page.locator(`label[for="${id}"]`).click();
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
  for (let i = 0; i < 12; i += 1) {
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

async function run(browser, name, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', isMobile: viewport.width <= 430, hasTouch: viewport.width <= 430 });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await installIsolatedEnvironment(page);
  await page.setContent(INLINED, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'テーマ設定：システム設定' }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'white');
  await waitForSurfaceTokens(page);

  const initial = await page.evaluate(() => ({
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
    tileNestedInteractive: [...document.querySelectorAll('.tool-tile')].some(node => node.querySelector('a, button')),
    containedLists: [...document.querySelectorAll('.cds--contained-list')].map(node => ({
      className: node.className,
      label: node.querySelector('.cds--contained-list__label')?.textContent.trim() || '',
      itemCount: node.querySelectorAll('.cds--contained-list-item').length,
    })),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.innerText,
    pageBackground: getComputedStyle(document.querySelector('.app-theme-root')).backgroundColor,
    tileBackground: getComputedStyle(document.querySelector('.tool-tile')).backgroundColor,
    toolGridClass: document.querySelector('.tool-grid')?.className || '',
    labels: [...document.querySelectorAll('.projects:not(.form-history) .project-title')].map(node => node.textContent.trim()),
    formHistoryLabels: [...document.querySelectorAll('.form-history .project-title')].map(node => node.textContent.trim()),
    openIconCount: document.querySelectorAll('.projects .project-list__open-icon svg').length,
    openIconsDecorative: [...document.querySelectorAll('.projects .project-list__open-icon svg')].every(node => node.getAttribute('aria-hidden') === 'true'),
    nestedInteractiveContent: [...document.querySelectorAll('.cds--contained-list-item__content')].some(node => node.querySelector('a, button')),
    formActionLinks: document.querySelectorAll('.form-history .cds--contained-list-item__action a').length,
    formOverflowMenus: document.querySelectorAll('.form-history .cds--overflow-menu').length,
    projectActionLinks: document.querySelectorAll('.projects:not(.form-history) .cds--contained-list-item__action a').length,
    actionOverflow: [...document.querySelectorAll('.project-list__actions > *')].some(node => {
      const rect = node.getBoundingClientRect();
      return rect.right > window.innerWidth || rect.left < 0;
    }),
    clickableRows: document.querySelectorAll('.project-list .cds--contained-list-item--clickable').length,
    rowHeights: [...document.querySelectorAll('.project-list .cds--contained-list-item')].map(node => node.getBoundingClientRect().height),
  }));
  if (initial.tiles !== 4) throw new Error(`${name}: expected 4 Carbon tiles, got ${initial.tiles}`);
  if (initial.tileLaunchIcons !== 4 || initial.tileNestedInteractive) throw new Error(`${name}: ClickableTile icon or nesting regression`);
  if (initial.pictograms.length !== 4 || initial.pictograms.some(icon => icon.ariaHidden !== 'true' || Math.abs(icon.width - 48) > 1 || Math.abs(icon.height - 48) > 1)) {
    throw new Error(`${name}: pictogram size or decorative aria regression: ${JSON.stringify(initial.pictograms)}`);
  }
  const firstPictogram = initial.pictograms[0];
  if (initial.pictograms.some(icon => Math.abs(icon.topOffset - firstPictogram.topOffset) > 1 || Math.abs(icon.leftOffset - firstPictogram.leftOffset) > 1)) {
    throw new Error(`${name}: pictogram alignment drift: ${JSON.stringify(initial.pictograms)}`);
  }
  if (!initial.toolGridClass.includes('cds--layer-one') || initial.pageBackground === initial.tileBackground) {
    throw new Error(`${name}: ClickableTile is not using a distinct contextual layer: ${JSON.stringify(initial)}`);
  }
  if (initial.containedLists.length !== 2) throw new Error(`${name}: expected 2 Carbon contained lists, got ${initial.containedLists.length}`);
  if (initial.containedLists.some(list => !list.className.includes('cds--contained-list--on-page') || !list.className.includes('cds--contained-list--xl'))) {
    throw new Error(`${name}: contained list variant or size regression: ${JSON.stringify(initial.containedLists)}`);
  }
  if (initial.containedLists[0].label !== '作成したフォーム' || initial.containedLists[1].label !== '最近開いた企画') {
    throw new Error(`${name}: contained list labels regression: ${JSON.stringify(initial.containedLists)}`);
  }
  if (initial.overflowX > 1) throw new Error(`${name}: initial overflow ${initial.overflowX}px`);
  for (const text of ['登山計画書メーカー', '応募フォームメーカー', 'サークル企画ツール', '学務提出書類作成ツール', '最近開いた企画', '作成', '最終閲覧']) {
    if (!initial.text.includes(text)) throw new Error(`${name}: missing ${text}`);
  }
  if (initial.labels[0] !== '春山企画' || initial.labels[1] !== '夏山企画') throw new Error(`${name}: project history ordering regression`);
  if (initial.formHistoryLabels[0] !== '夏山応募フォーム' || initial.formHistoryLabels[1] !== '春山応募フォーム') throw new Error(`${name}: form history ordering regression`);
  if (initial.openIconCount !== 3 || !initial.openIconsDecorative) throw new Error(`${name}: Launch icon anatomy regression`);
  if (initial.text.includes('企画を開く') || initial.text.includes('企画ID:') || initial.text.includes('フォームID:') || /(?:^|\n)ID:/.test(initial.text)) {
    throw new Error(`${name}: obsolete history copy or IDs remain`);
  }
  if (initial.nestedInteractiveContent) throw new Error(`${name}: contained list item content nested an interactive element`);
  if (initial.formActionLinks !== 0 || initial.formOverflowMenus !== 2) throw new Error(`${name}: form history action anatomy regression`);
  if (initial.projectActionLinks !== 0 || initial.actionOverflow || initial.clickableRows !== 3) throw new Error(`${name}: project history action geometry regression`);
  if (initial.rowHeights.some(height => Math.abs(height - 64) > 1)) throw new Error(`${name}: contained list row height drifted from Carbon xl: ${JSON.stringify(initial.rowHeights)}`);
  if (!initial.text.includes('作成したフォーム')) throw new Error(`${name}: missing form history section`);

  const rowFocus = await page.locator('.projects:not(.form-history) .cds--contained-list-item--clickable .cds--contained-list-item__content').first().evaluate((button) => {
    button.focus();
    const focus = getComputedStyle(button, '::after');
    return { outlineStyle: focus.outlineStyle, outlineColor: focus.outlineColor, outlineWidth: focus.outlineWidth };
  });
  if (rowFocus.outlineStyle === 'none' || rowFocus.outlineWidth === '0px' || rowFocus.outlineColor === 'rgba(0, 0, 0, 0)') {
    throw new Error(`${name}: contained list row focus indicator is missing: ${JSON.stringify(rowFocus)}`);
  }

  const projectPopupPromise = page.waitForEvent('popup');
  await page.locator('.projects:not(.form-history) .cds--contained-list-item--clickable .cds--contained-list-item__content').first().focus();
  await page.keyboard.press('Enter');
  const projectPopup = await projectPopupPromise;
  if (!projectPopup.url().includes('?room=ROOM-A')) throw new Error(`${name}: recent row navigation regression: ${projectPopup.url()}`);
  await projectPopup.close();

  const recentRow = page.locator('.projects:not(.form-history) .cds--contained-list-item--clickable').first();
  const openIconBounds = await recentRow.locator('.project-list__open-icon').boundingBox();
  if (!openIconBounds) throw new Error(`${name}: Launch icon has no hit area`);
  const iconPopupPromise = page.waitForEvent('popup');
  await page.mouse.click(openIconBounds.x + openIconBounds.width / 2, openIconBounds.y + openIconBounds.height / 2);
  const iconPopup = await iconPopupPromise;
  if (!iconPopup.url().includes('?room=ROOM-A')) throw new Error(`${name}: Launch icon did not activate the row: ${iconPopup.url()}`);
  await iconPopup.close();

  const formPopupPromise = page.waitForEvent('popup');
  await page.locator('.form-history .cds--contained-list-item--clickable .cds--contained-list-item__content').first().focus();
  await page.keyboard.press('Enter');
  const formPopup = await formPopupPromise;
  if (!formPopup.url().includes('?room=PROJECT-B')) throw new Error(`${name}: form project link regression: ${formPopup.url()}`);
  await formPopup.close();

  const formRow = page.locator('.form-history .cds--contained-list-item').first();
  await formRow.locator('.cds--overflow-menu').focus();
  const noRowPopup = page.waitForEvent('popup', { timeout: 500 }).then(() => false).catch(() => true);
  await page.keyboard.press('Enter');
  if (!(await noRowPopup)) throw new Error(`${name}: opening the OverflowMenu also opened the project`);
  const menuBounds = await page.getByRole('menu').boundingBox();
  if (!menuBounds || menuBounds.left < 0 || menuBounds.right > viewport.width) throw new Error(`${name}: overflow menu escaped viewport: ${JSON.stringify(menuBounds)}`);
  if (await page.getByRole('menu').getAttribute('aria-label') !== '夏山応募フォームのフォーム操作') throw new Error(`${name}: form menu label regression`);
  const menuItems = await page.getByRole('menuitem').evaluateAll(nodes => nodes.map(node => {
    const content = node.querySelector('.cds--overflow-menu-options__option-content');
    return { text: node.textContent.trim(), scrollWidth: content?.scrollWidth || 0, clientWidth: content?.clientWidth || 0, textOverflow: content ? getComputedStyle(content).textOverflow : '' };
  }));
  if (menuItems.some(item => item.scrollWidth > item.clientWidth || item.textOverflow === 'ellipsis')) throw new Error(`${name}: overflow menu item text was truncated: ${JSON.stringify(menuItems)}`);
  if (await page.evaluate(() => document.activeElement?.getAttribute('role')) !== 'menuitem') throw new Error(`${name}: OverflowMenu did not move focus to its first item`);
  await page.screenshot({ path: path.join(OUT, `${name}-menu-open.png`), fullPage: false });
  await page.keyboard.press('Escape');
  if (await page.getByRole('menu').count() !== 0 || await page.evaluate(() => document.activeElement?.classList?.contains('cds--overflow-menu') !== true)) {
    throw new Error(`${name}: Escape did not close OverflowMenu and restore trigger focus`);
  }
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '応募フォームのリンクをコピー' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('応募フォームのリンクをコピーしました'));
  if (await page.evaluate(() => window.__QA_COPIED__) !== 'https://docs.google.com/forms/d/FORM-B/viewform') throw new Error(`${name}: response URL copy regression`);

  await formRow.locator('.cds--overflow-menu').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '編集用リンクをコピー' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('編集用リンクをコピーしました'));
  if (await page.evaluate(() => window.__QA_COPIED__) !== 'https://docs.google.com/forms/d/FORM-B/edit') throw new Error(`${name}: editor URL copy regression`);

  const olderFormRow = page.locator('.form-history .cds--contained-list-item').nth(1);
  await olderFormRow.locator('.cds--overflow-menu').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: '応募フォームのリンクをコピー' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('応募フォームのリンクをコピーしました'));
  if (await page.evaluate(() => window.__QA_COPIED__) !== 'https://docs.google.com/forms/d/FORM-A/viewform') throw new Error(`${name}: second history response URL mix-up`);

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
      overflowX: root.scrollWidth - root.clientWidth,
    };
  }, THEME_KEY);

  if (dark.preference !== 'dark' || dark.rootTheme !== 'g100') throw new Error(`${name}: dark preference failed: ${JSON.stringify(dark)}`);
  if ([dark.bodyBg, dark.appBg, dark.tileBg, dark.panelBg].includes('rgb(255, 255, 255)')) throw new Error(`${name}: white surface leaked: ${JSON.stringify(dark)}`);
  if (dark.tileColor === 'rgb(22, 22, 22)' || dark.tileColor === 'rgb(0, 0, 0)') throw new Error(`${name}: dark tile text stayed dark: ${JSON.stringify(dark)}`);
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

  await page.setContent(INLINED, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('heading', { name: 'ツール', level: 1 }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.carbonTheme === 'g100');
  await waitForSurfaceTokens(page);
  if (await page.evaluate(key => localStorage.getItem(key), THEME_KEY) !== 'dark') throw new Error(`${name}: theme lost on reload-equivalent render`);

  const focus = await focusFirstTileWithKeyboard(page);
  const focusInvisible = focus.outlineStyle === 'none' || focus.outlineWidth === '0px' || focus.outlineColor === 'rgba(0, 0, 0, 0)' || focus.outlineColor === 'transparent';
  if (focusInvisible && focus.boxShadow === 'none') throw new Error(`${name}: keyboard focus indicator missing: ${JSON.stringify(focus)}`);
  if (pageErrors.length) throw new Error(`${name}: page errors: ${pageErrors.join(' | ')}`);
  if (consoleErrors.length) throw new Error(`${name}: console errors: ${consoleErrors.join(' | ')}`);

  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ viewport, initial, dark, focus, pageErrors, consoleErrors }, null, 2));
  await context.close();
}

(async () => {
  fs.mkdirSync(process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy', { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps'],
    env: { ...process.env, CHROMIUM_POLICY_DIR: process.env.CHROMIUM_POLICY_DIR || '/tmp/empty-chromium-policy' },
  });
  try {
    await run(browser, 'mobile-390x844', { width: 390, height: 844 });
    await run(browser, 'desktop-1280x900', { width: 1280, height: 900 });
  } finally {
    await browser.close();
  }
  console.log('Portal three-state Carbon theme browser smoke passed.');
})().catch(error => { console.error(error); process.exit(1); });
