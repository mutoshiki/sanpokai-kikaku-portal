import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Button,
  ClickableTile,
  Column,
  ContainedList,
  ContainedListItem,
  Header,
  HeaderName,
  Grid,
  Layer,
  OverflowMenu,
  OverflowMenuItem,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  ToastNotification,
} from '@carbon/react';
import { Launch, Renew } from '@carbon/icons-react';
import { Group, Hiking, ListCheckbox, University } from '@carbon/pictograms-react';
import { ThemeHeaderControl } from './ThemeToggle.jsx';
import {
  getProjectDisplayDate,
  getProjectDisambiguators,
  isRelevantPortalStorageKey,
  normalizePortalDate,
  readFormIndex,
  readProjectIndex,
} from './portalHistory.js';

const TOOL_URL = 'https://mutoshiki.github.io/circle-kikaku-tools/';
const FORM_MAKER_URL = `${import.meta.env.BASE_URL}form-maker/`;
const HISTORY_PREVIEW_LIMIT = 3;
const RESPONSE_LINK_COPY_LABEL = '応募用リンクをコピー';
const EDIT_LINK_COPY_LABEL = '編集用リンクをコピー';

const TOOLS = [
  { title: '登山計画書メーカー', description: 'YAMAPの画像を使って、登山計画書を作ります。', href: 'https://mutoshiki.github.io/tozan-keikaku-syo-maker/', pictogram: Hiking },
  { title: '応募フォームメーカー', description: '参加者を募集するGoogleフォームを作ります。', href: FORM_MAKER_URL, pictogram: ListCheckbox },
  { title: 'サークル企画ツール', description: '参加者の車や班を割り当て、交通費を計算します。', href: TOOL_URL, pictogram: Group },
  { title: '学務提出書類作成ツール', description: '学務に出す書類を作ります。引き継ぎデータも使えます。', downloadHint: 'PC用アプリをダウンロード', href: 'https://github.com/mutoshiki/sampokai-submission-builder/releases', pictogram: University },
];

function loadPortalState() {
  let projects;
  let forms;
  try {
    projects = readProjectIndex(localStorage);
    forms = readFormIndex(localStorage);
  } catch {
    projects = { status: 'unavailable', projects: [], errors: ['企画履歴を読み取れません'] };
    forms = { status: 'unavailable', forms: [], errors: ['フォーム履歴を読み取れません'] };
  }
  return { projects, forms };
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function safeProjectToolUrl(value) {
  const url = safeExternalUrl(value);
  if (!url) return '';
  try {
    const expected = new URL(TOOL_URL);
    const candidate = new URL(url);
    return candidate.origin === expected.origin && candidate.pathname === expected.pathname && candidate.searchParams.has('room') ? candidate.href : '';
  } catch { return ''; }
}

function markProjectOpened(value) {
  const url = safeProjectToolUrl(value);
  if (!url) return;
  const roomId = new URL(url).searchParams.get('room');
  if (!roomId) return;
  try { localStorage.setItem(`syawari_last_opened_at_${roomId}`, String(Date.now())); } catch { /* Navigation is still available. */ }
}

function openExternalUrl(value) {
  const url = safeProjectToolUrl(value);
  if (!url) return;
  markProjectOpened(url);
  window.open(url, '_blank', 'noopener,noreferrer');
}

function formatDate(value) {
  const timestamp = normalizePortalDate(value);
  if (timestamp === null) return '—';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function sectionStatus(status, emptyMessage) {
  if (status === 'unavailable') return { heading: '履歴を読み込めませんでした', detail: 'もう一度お試しください。', empty: false };
  if (status === 'partial') return { heading: emptyMessage, detail: '一部の履歴を読み込めませんでした。表示できる分を載せています。', empty: false };
  return { heading: emptyMessage, detail: '', empty: true };
}

function App() {
  const [portalState, setPortalState] = useState(loadPortalState);
  const [toast, setToast] = useState('');
  const [copyErrors, setCopyErrors] = useState({});
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllForms, setShowAllForms] = useState(false);
  const [historyTabIndex, setHistoryTabIndex] = useState(0);
  const toastTimer = useRef(null);
  const projectHeadingRef = useRef(null);
  const formHeadingRef = useRef(null);
  const pendingHistoryFocusRef = useRef(null);

  const refreshPortalState = useCallback(() => {
    const activeElement = document.activeElement;
    if (activeElement?.closest?.('.history-workspace')) {
      pendingHistoryFocusRef.current = { element: activeElement };
    } else {
      const activeMenu = activeElement?.closest?.('[role="menu"]');
      const menuTrigger = activeMenu && [...document.querySelectorAll('.form-history .cds--overflow-menu[aria-expanded="true"]')]
        .find(trigger => trigger.getAttribute('aria-controls') === activeMenu.id);
      if (menuTrigger) pendingHistoryFocusRef.current = { element: activeElement, trigger: menuTrigger };
    }
    setPortalState(loadPortalState());
  }, []);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => false);
    const onStorage = (event) => { if (event.key === null || isRelevantPortalStorageKey(event.key)) refreshPortalState(); };
    const onVisibility = () => { if (!document.hidden) refreshPortalState(); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshPortalState]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useLayoutEffect(() => {
    const pending = pendingHistoryFocusRef.current;
    if (!pending) return;
    pendingHistoryFocusRef.current = null;
    if (pending.element?.isConnected) return;
    if (pending.trigger?.isConnected) {
      pending.trigger.focus();
      return;
    }
    (historyTabIndex === 1 ? formHeadingRef : projectHeadingRef).current?.focus();
  }, [portalState, historyTabIndex]);

  const showToast = useCallback((message) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  }, []);

  const copyLink = useCallback(async (url, message, errorId) => {
    if (!url) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      setCopyErrors(errors => ({ ...errors, [errorId]: '' }));
      showToast(message);
    } catch {
      setCopyErrors(errors => ({ ...errors, [errorId]: 'リンクをコピーできませんでした。もう一度お試しください。' }));
    }
  }, [showToast]);

  const projectInfo = sectionStatus(portalState.projects.status, '企画はまだありません。サークル企画ツールで開くと、ここに表示されます。');
  const formInfo = sectionStatus(portalState.forms.status, 'フォームはまだありません。応募フォームメーカーで作成すると、ここに表示されます。');
  const projectDisambiguators = getProjectDisambiguators(portalState.projects.projects);

  const toolsSection = (
    <section key="tools" className="tools-section" aria-labelledby="tools-heading">
      <Layer level={0} as="div" className="tool-grid" aria-label="利用するツール">
        <Grid narrow withRowGap className="tools-grid">
          <Column sm={4} md={8} lg={16}><h2 id="tools-heading" className="section-heading">ツール</h2></Column>
          {TOOLS.map((tool, index) => {
            const Pictogram = tool.pictogram;
            const descriptionId = `tool-description-${index}`;
            const hintId = tool.downloadHint ? `tool-hint-${index}` : undefined;
            return (
              <Column key={tool.title} sm={4} md={4} lg={4}>
                <ClickableTile
                  className="tool-tile"
                  href={tool.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  renderIcon={Launch}
                  aria-label={`${tool.title}を新しいタブで開く`}
                  aria-describedby={[descriptionId, hintId].filter(Boolean).join(' ')}
                >
                  <div className="tool-tile__pictogram" aria-hidden="true"><Pictogram width={48} height={48} aria-hidden="true" /></div>
                  <div className="tool-tile__content">
                    <h3>{tool.title}</h3>
                    <p id={descriptionId}>{tool.description}</p>
                    {tool.downloadHint && <span id={hintId} className="tool-tile__hint">{tool.downloadHint}</span>}
                  </div>
                </ClickableTile>
              </Column>
            );
          })}
        </Grid>
      </Layer>
    </section>
  );

  const formsSection = (
    <section key="forms" className="history-section projects form-history" aria-labelledby="forms-heading">
      <Grid narrow className="history-grid">
        <Column sm={4} md={8} lg={16}>
          <h3 id="forms-heading" className="section-heading" tabIndex="-1" ref={formHeadingRef}>作成したフォーム</h3>
          {portalState.forms.status === 'unavailable' && <div className="history-message" role="status"><p>{formInfo.heading}。{formInfo.detail}</p><Button kind="ghost" size="sm" renderIcon={Renew} onClick={refreshPortalState}>もう一度読み込む</Button></div>}
          {portalState.forms.status === 'partial' && <p className="history-message" role="status">{formInfo.detail}</p>}
          <ContainedList id="form-history-list" className="project-list form-history-list" kind="on-page" size="lg" aria-labelledby="forms-heading">
        {portalState.forms.forms.length ? portalState.forms.forms.slice(0, showAllForms ? undefined : HISTORY_PREVIEW_LIMIT).map((form) => {
          const label = String(form.planName ?? form.title ?? '').trim() || '応募フォーム';
          const responseUrl = safeExternalUrl(form.responseUrl);
          const editUrl = safeExternalUrl(form.editUrl);
          const projectUrl = safeProjectToolUrl(form.projectUrl) || safeProjectToolUrl(form.spreadsheetUrl);
          const createdAt = normalizePortalDate(form.createdAt);
          const errorId = `form-${form.formId}`;
          return (
            <ContainedListItem
              key={form.formId}
              className={`project-list__row${editUrl ? ' project-list__row--form-actions' : ''}`}
              action={editUrl ? <div className="project-list__actions"><OverflowMenu size="lg" aria-label={`${label}のフォーム操作`} iconDescription={`${label}のフォーム操作`} flipped menuOptionsClass="project-list__form-menu">
                <OverflowMenuItem itemText={EDIT_LINK_COPY_LABEL} onClick={() => copyLink(editUrl, `${EDIT_LINK_COPY_LABEL}しました`, errorId)} />
              </OverflowMenu></div> : undefined}
            >
              <div className="project-list__item">
                <span className="project-title">{label}</span>
                <time dateTime={createdAt === null ? undefined : new Date(createdAt).toISOString()}>{createdAt === null ? '作成日不明' : `作成 ${formatDate(createdAt)}`}</time>
                {(responseUrl || projectUrl) && <div className="project-list__form-links">
                  {responseUrl && <>
                    <a className="history-link history-response-link" href={responseUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}の応募フォームを開く`}>応募フォームを開く</a>
                    <Button className="form-copy-button" kind="ghost" size="sm" aria-label={`${label}の応募用リンクをコピー`} onClick={() => copyLink(responseUrl, `${RESPONSE_LINK_COPY_LABEL}しました`, errorId)}>{RESPONSE_LINK_COPY_LABEL}</Button>
                  </>}
                  {projectUrl && <a className="history-project-link" href={projectUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}の企画を開く`} onClick={() => { markProjectOpened(projectUrl); refreshPortalState(); }}>企画を開く</a>}
                </div>}
                {copyErrors[errorId] && <span className="copy-error" role="alert">{copyErrors[errorId]}</span>}
              </div>
            </ContainedListItem>
          );
        }) : portalState.forms.status !== 'unavailable' ? <ContainedListItem>{formInfo.heading}</ContainedListItem> : <ContainedListItem>フォーム履歴を表示できません。</ContainedListItem>}
          </ContainedList>
          {portalState.forms.forms.length > HISTORY_PREVIEW_LIMIT && <Button
            className="history-toggle"
            kind="ghost"
            size="sm"
            aria-label={showAllForms ? '作成したフォームを折りたたむ' : '作成したフォームをすべて見る'}
            aria-expanded={showAllForms}
            aria-controls="form-history-list"
            onClick={() => setShowAllForms(value => !value)}
          >{showAllForms ? '表示を減らす' : 'すべて見る'}</Button>}
        </Column>
      </Grid>
    </section>
  );

  const projectsSection = (
    <section key="projects" className="history-section projects" aria-labelledby="projects-heading">
      <Grid narrow className="history-grid">
        <Column sm={4} md={8} lg={16}>
          <h3 id="projects-heading" className="section-heading" tabIndex="-1" ref={projectHeadingRef}>最近の企画</h3>
          {portalState.projects.status === 'unavailable' && <div className="history-message" role="status"><p>{projectInfo.heading}。{projectInfo.detail}</p><Button kind="ghost" size="sm" renderIcon={Renew} onClick={refreshPortalState}>もう一度読み込む</Button></div>}
          {portalState.projects.status === 'partial' && <p className="history-message" role="status">{projectInfo.detail}</p>}
          <ContainedList id="project-history-list" className="project-list" kind="on-page" size="lg" aria-labelledby="projects-heading">
        {portalState.projects.projects.length ? portalState.projects.projects.slice(0, showAllProjects ? undefined : HISTORY_PREVIEW_LIMIT).map((project) => {
          const label = project.name || '名前のない企画';
          const projectUrl = `${TOOL_URL}?room=${encodeURIComponent(project.roomId)}`;
          const { timestamp: displayDate, label: dateLabel } = getProjectDisplayDate(project);
          return <ContainedListItem key={project.roomId} className="project-list__row">
            <div className="project-list__item">
              <a className="project-title history-link" href={projectUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}をサークル企画ツールで新しいタブに開く`} onClick={() => { markProjectOpened(projectUrl); refreshPortalState(); }}>{label}<Launch className="history-link__icon" size={20} aria-hidden="true" /></a>
              <time dateTime={displayDate === null ? undefined : new Date(displayDate).toISOString()}>{displayDate === null ? dateLabel : `${dateLabel} ${formatDate(displayDate)}`}</time>
              {projectDisambiguators.has(project.roomId) && <span className="project-disambiguator">{projectDisambiguators.get(project.roomId)}</span>}
            </div>
          </ContainedListItem>;
        }) : portalState.projects.status !== 'unavailable' ? <ContainedListItem>{projectInfo.heading}</ContainedListItem> : <ContainedListItem>企画履歴を表示できません。</ContainedListItem>}
          </ContainedList>
          {portalState.projects.projects.length > HISTORY_PREVIEW_LIMIT && <Button
            className="history-toggle"
            kind="ghost"
            size="sm"
            aria-label={showAllProjects ? '最近の企画を折りたたむ' : '最近の企画をすべて見る'}
            aria-expanded={showAllProjects}
            aria-controls="project-history-list"
            onClick={() => setShowAllProjects(value => !value)}
          >{showAllProjects ? '表示を減らす' : 'すべて見る'}</Button>}
        </Column>
      </Grid>
    </section>
  );

  return <>
    <a className="skip-link" href="#main">本文へ移動</a>
    <Header aria-label="山歩会企画ポータル"><HeaderName href="./" prefix="">山歩会企画ポータル</HeaderName><ThemeHeaderControl /></Header>
    <main id="main" className="portal-page">
      <h1 className="portal-title">企画の管理</h1>
      <section className="history-workspace" aria-labelledby="history-heading">
        <h2 id="history-heading" className="section-heading">履歴</h2>
        <p className="history-description">開いた企画や、作ったフォームを確認できます。</p>
        <Tabs className="history-tabs" selectedIndex={historyTabIndex} onChange={({ selectedIndex }) => setHistoryTabIndex(selectedIndex)}>
          <TabList aria-label="履歴" activation="automatic">
            <Tab>最近の企画</Tab>
            <Tab>作成したフォーム</Tab>
          </TabList>
          <TabPanels>
            <TabPanel id="project-history-panel" className="history-tabs-panel">{projectsSection}</TabPanel>
            <TabPanel id="form-history-panel" className="history-tabs-panel">{formsSection}</TabPanel>
          </TabPanels>
        </Tabs>
      </section>
      {toolsSection}
    </main>
    {toast && <div className="toast-host"><ToastNotification kind="success" title={toast} timeout={5000} lowContrast onCloseButtonClick={() => setToast('')} /></div>}
  </>;
}

export default App;
