import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  ClickableTile,
  Column,
  ContainedList,
  ContainedListItem,
  Content,
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
  SkipToContent,
  Theme as CarbonTheme,
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
import { FORM_MAKER_FIREBASE_CONFIG } from './services/firebase-public-config.js';
import { createFormMakerSession } from './services/form-maker-session.js';
import { mergeFormMakerJobs, projectUrlWithHandoffCapability, writeCachedFormMakerHistory } from './services/form-maker-history.js';

const TOOL_URL = 'https://mutoshiki.github.io/circle-kikaku-tools/';
const FORM_MAKER_URL = `${import.meta.env.BASE_URL}form-maker/`;
const HISTORY_PREVIEW_LIMIT = 3;
const RESPONSE_LINK_COPY_LABEL = '応募用リンクをコピー';
const EDIT_LINK_COPY_LABEL = 'フォームの編集リンクをコピー';

const TOOLS = [
  { title: '登山計画書メーカー', description: 'YAMAPの画像から登山計画書を作成します。', href: 'https://mutoshiki.github.io/tozan-keikaku-syo-maker/', pictogram: Hiking },
  { title: '応募フォームメーカー', description: '参加者募集用のGoogleフォームを作成します。', href: FORM_MAKER_URL, pictogram: ListCheckbox },
  { title: 'サークル企画ツール', description: '車割り・班割りと交通費の精算を行います。', href: TOOL_URL, pictogram: Group },
  { title: '学務提出書類作成ツール', description: '学務に提出する書類を作成します。', downloadHint: 'PC用アプリのダウンロードページ', href: 'https://github.com/mutoshiki/sampokai-submission-builder/releases', pictogram: University },
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

function safeResponseSheetUrl(value) {
  const url = safeExternalUrl(value);
  if (!url) return '';
  try {
    const candidate = new URL(url);
    return candidate.hostname === 'docs.google.com' && candidate.pathname.startsWith('/spreadsheets/d/') ? candidate.href : '';
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

function sectionStatus(status, errorMessage, emptyMessage) {
  if (status === 'unavailable') return { heading: errorMessage, detail: '', empty: false };
  if (status === 'partial') return { heading: emptyMessage, detail: '履歴の一部を読み込めませんでした。表示できる分だけを載せています。', empty: false };
  return { heading: emptyMessage, detail: '', empty: true };
}

function App() {
  const [portalState, setPortalState] = useState(loadPortalState);
  const formMakerSession = useMemo(() => createFormMakerSession({ config: FORM_MAKER_FIREBASE_CONFIG }), []);
  const [toast, setToast] = useState('');
  const [copyErrors, setCopyErrors] = useState({});
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllForms, setShowAllForms] = useState(false);
  const [historyTabIndex, setHistoryTabIndex] = useState(0);
  const toastTimer = useRef(null);
  const projectSectionRef = useRef(null);
  const formSectionRef = useRef(null);
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

  const refreshFormHistory = useCallback(async () => {
    const localState = loadPortalState();
    setPortalState((current) => ({ ...current, ...localState }));
    try {
      const jobs = await formMakerSession.listJobs(50);
      setPortalState((current) => {
        const forms = mergeFormMakerJobs(current.forms.forms, jobs);
        writeCachedFormMakerHistory(forms);
        return { ...current, forms: { status: forms.length ? 'ready' : 'empty', forms, errors: [] } };
      });
    } catch {
      setPortalState((current) => ({
        ...current,
        forms: { ...current.forms, status: current.forms.forms.length ? 'partial' : 'unavailable' },
      }));
    }
  }, [formMakerSession]);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => false);
    const onStorage = (event) => { if (event.key === null || isRelevantPortalStorageKey(event.key)) refreshPortalState(); };
    const onVisibility = () => { if (!document.hidden) { refreshPortalState(); void refreshFormHistory(); } };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshFormHistory, refreshPortalState]);

  useEffect(() => { void refreshFormHistory(); }, [refreshFormHistory]);

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
    (historyTabIndex === 1 ? formSectionRef : projectSectionRef).current?.focus();
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
      setCopyErrors(errors => ({ ...errors, [errorId]: 'リンクをコピーできませんでした。リンク先を開き、アドレス欄からコピーしてください。' }));
    }
  }, [showToast]);

  const projectInfo = sectionStatus(portalState.projects.status, '企画の履歴を読み込めませんでした。', 'このブラウザーに企画の履歴はありません。');
  const formInfo = sectionStatus(portalState.forms.status, 'フォームの履歴を読み込めませんでした。', 'このブラウザーにフォームの作成履歴はありません。');
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
                  aria-label={`${tool.title}を開く（新しいタブ）`}
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
    <section key="forms" id="form-history-section" ref={formSectionRef} tabIndex="-1" className="history-section projects form-history" aria-label="フォーム一覧">
      <Grid narrow className="history-grid">
        <Column sm={4} md={8} lg={16}>
          {portalState.forms.status === 'unavailable' && <div className="history-message" role="status"><p>{formInfo.heading}</p><Button kind="ghost" size="sm" renderIcon={Renew} onClick={() => void refreshFormHistory()}>履歴を読み込み直す</Button></div>}
          {portalState.forms.status === 'partial' && <p className="history-message" role="status">{formInfo.detail}</p>}
          <ContainedList id="form-history-list" className="project-list form-history-list" kind="on-page" size="lg" aria-label="作成したフォーム">
        {portalState.forms.forms.length ? portalState.forms.forms.slice(0, showAllForms ? undefined : HISTORY_PREVIEW_LIMIT).map((form) => {
          const planName = String(form.planName ?? form.title ?? '').trim();
          const label = planName || '企画名未設定の応募フォーム';
          const responseUrl = safeExternalUrl(form.responseUrl);
          const editUrl = safeExternalUrl(form.editUrl);
          const projectBaseUrl = safeProjectToolUrl(form.projectUrl) || safeProjectToolUrl(form.spreadsheetUrl);
          const projectUrl = projectUrlWithHandoffCapability(projectBaseUrl, formMakerSession.getHandoffToken(form.jobId));
          const responseSheetUrl = safeResponseSheetUrl(form.responseSheetUrl) || safeResponseSheetUrl(form.sheetUrl) || safeResponseSheetUrl(form.spreadsheetUrl);
          const createdAt = normalizePortalDate(form.createdAt);
          const errorId = `form-${form.formId}`;
          return (
            <ContainedListItem
              key={form.formId}
              className={`project-list__row${responseUrl || editUrl ? ' project-list__row--form-actions' : ''}`}
              action={responseUrl || editUrl ? <div className="project-list__actions"><OverflowMenu size="lg" aria-label={`「${label}」のリンクをコピー`} iconDescription={`「${label}」のリンクをコピー`} flipped menuOptionsClass="project-list__form-menu">
                {responseUrl && <OverflowMenuItem itemText={RESPONSE_LINK_COPY_LABEL} onClick={() => copyLink(responseUrl, `${RESPONSE_LINK_COPY_LABEL}しました`, errorId)} />}
                {editUrl && <OverflowMenuItem itemText={EDIT_LINK_COPY_LABEL} onClick={() => copyLink(editUrl, `${EDIT_LINK_COPY_LABEL}しました`, errorId)} />}
              </OverflowMenu></div> : undefined}
            >
              <div className="project-list__item">
                <span className="project-title">{label}</span>
                <time dateTime={createdAt === null ? undefined : new Date(createdAt).toISOString()}>{createdAt === null ? '作成日時不明' : `作成日時 ${formatDate(createdAt)}`}</time>
                {(responseUrl || editUrl || projectUrl || responseSheetUrl) && <div className="project-list__form-links">
                  {responseUrl && <a className="history-response-link" href={responseUrl} target="_blank" rel="noopener noreferrer" aria-label={`「${label}」の応募フォームを開く（新しいタブ）`}>応募フォームを開く</a>}
                  {editUrl && <a className="history-edit-link" href={editUrl} target="_blank" rel="noopener noreferrer" aria-label={`「${label}」のフォームを編集する（新しいタブ）`}>フォームを編集する</a>}
                  {projectUrl && <a className="history-project-link" href={projectUrl} target="_blank" rel="noopener noreferrer" aria-label={`「${label}」の企画を開く（新しいタブ）`} onClick={() => { markProjectOpened(projectUrl); refreshPortalState(); }}>企画を開く</a>}
                  {responseSheetUrl && <a className="history-sheet-link" href={responseSheetUrl} target="_blank" rel="noopener noreferrer" aria-label={`「${label}」の回答シートを開く（新しいタブ）`}>回答シートを開く</a>}
                  {!responseSheetUrl && (responseUrl || editUrl || projectUrl) && <span className="history-link-unavailable">回答シートのリンクはありません</span>}
                </div>}
                {copyErrors[errorId] && <span className="copy-error" role="alert">{copyErrors[errorId]}</span>}
              </div>
            </ContainedListItem>
          );
        }) : portalState.forms.status !== 'unavailable' ? <ContainedListItem>{formInfo.heading}</ContainedListItem> : null}
          </ContainedList>
          {portalState.forms.forms.length > HISTORY_PREVIEW_LIMIT && <Button
            className="history-toggle"
            kind="ghost"
            size="sm"
            aria-label={showAllForms ? `作成したフォームを${HISTORY_PREVIEW_LIMIT}件だけ表示` : '作成したフォームをすべて表示'}
            aria-expanded={showAllForms}
            aria-controls="form-history-list"
            onClick={() => setShowAllForms(value => !value)}
          >{showAllForms ? `${HISTORY_PREVIEW_LIMIT}件だけ表示` : 'すべて表示'}</Button>}
        </Column>
      </Grid>
    </section>
  );

  const projectsSection = (
    <section key="projects" id="project-history-section" ref={projectSectionRef} tabIndex="-1" className="history-section projects" aria-label="企画一覧">
      <Grid narrow className="history-grid">
        <Column sm={4} md={8} lg={16}>
          {portalState.projects.status === 'unavailable' && <div className="history-message" role="status"><p>{projectInfo.heading}</p><Button kind="ghost" size="sm" renderIcon={Renew} onClick={refreshPortalState}>履歴を読み込み直す</Button></div>}
          {portalState.projects.status === 'partial' && <p className="history-message" role="status">{projectInfo.detail}</p>}
          <ContainedList id="project-history-list" className="project-list" kind="on-page" size="lg" aria-label="最近の企画">
        {portalState.projects.projects.length ? portalState.projects.projects.slice(0, showAllProjects ? undefined : HISTORY_PREVIEW_LIMIT).map((project) => {
          const label = project.name || '企画名未設定';
          const projectUrl = `${TOOL_URL}?room=${encodeURIComponent(project.roomId)}`;
          const { timestamp: displayDate, label: dateLabel } = getProjectDisplayDate(project);
          return <ContainedListItem key={project.roomId} className="project-list__row">
            <div className="project-list__item">
              <a className="project-title history-link" href={projectUrl} target="_blank" rel="noopener noreferrer" aria-label={`「${label}」をサークル企画ツールで開く（新しいタブ）`} onClick={() => { markProjectOpened(projectUrl); refreshPortalState(); }}>{label}<Launch className="history-link__icon" size={20} aria-hidden="true" /></a>
              <time dateTime={displayDate === null ? undefined : new Date(displayDate).toISOString()}>{displayDate === null ? dateLabel : `${dateLabel} ${formatDate(displayDate)}`}</time>
              {projectDisambiguators.has(project.roomId) && <span className="project-disambiguator">{projectDisambiguators.get(project.roomId)}</span>}
            </div>
          </ContainedListItem>;
        }) : portalState.projects.status !== 'unavailable' ? <ContainedListItem>{projectInfo.heading}</ContainedListItem> : null}
          </ContainedList>
          {portalState.projects.projects.length > HISTORY_PREVIEW_LIMIT && <Button
            className="history-toggle"
            kind="ghost"
            size="sm"
            aria-label={showAllProjects ? `最近の企画を${HISTORY_PREVIEW_LIMIT}件だけ表示` : '最近の企画をすべて表示'}
            aria-expanded={showAllProjects}
            aria-controls="project-history-list"
            onClick={() => setShowAllProjects(value => !value)}
          >{showAllProjects ? `${HISTORY_PREVIEW_LIMIT}件だけ表示` : 'すべて表示'}</Button>}
        </Column>
      </Grid>
    </section>
  );

  return <>
    <CarbonTheme as={Header} theme="g100" aria-label="山歩会企画ツール一覧"><SkipToContent href="#main">本文へ移動</SkipToContent><HeaderName href="./" prefix="">山歩会企画ツール一覧</HeaderName><ThemeHeaderControl /></CarbonTheme>
    <Content id="main" className="portal-page">
      <h1 className="portal-title">山歩会企画ツール一覧</h1>
      <section className="history-workspace" aria-label="企画とフォーム">
        <Tabs className="history-tabs" selectedIndex={historyTabIndex} onChange={({ selectedIndex }) => setHistoryTabIndex(selectedIndex)}>
          <TabList aria-label="企画とフォームの切り替え" activation="automatic">
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
    </Content>
    {toast && <ToastNotification className="toast-host" kind="success" title={toast} timeout={5000} lowContrast onCloseButtonClick={() => setToast('')} />}
  </>;
}

export default App;
