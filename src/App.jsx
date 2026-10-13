import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  ClickableTile,
  ContainedList,
  ContainedListItem,
  Header,
  HeaderName,
  Layer,
  OverflowMenu,
  OverflowMenuItem,
  ToastNotification,
} from '@carbon/react';
import { Launch, Renew } from '@carbon/icons-react';
import { Group, Hiking, ListCheckbox, University } from '@carbon/pictograms-react';
import { ThemeHeaderControl } from './ThemeToggle.jsx';
import {
  getProjectDisplayDate,
  isRelevantPortalStorageKey,
  normalizePortalDate,
  readFormIndex,
  readProjectIndex,
} from './portalHistory.js';

const TOOL_URL = 'https://mutoshiki.github.io/circle-kikaku-tools/';
const FORM_MAKER_URL = `${import.meta.env.BASE_URL}form-maker/`;
const HISTORY_PREVIEW_LIMIT = 3;
const RESPONSE_LINK_COPY_LABEL = '応募フォームのリンクをコピー';
const EDIT_LINK_COPY_LABEL = '編集用リンクをコピー';

const TOOLS = [
  { title: '登山計画書メーカー', description: 'YAMAPの画像と基本情報から登山計画書を作成します。', href: 'https://mutoshiki.github.io/tozan-keikaku-syo-maker/', pictogram: Hiking },
  { title: '応募フォームメーカー', description: '参加者を募集するGoogleフォームを作成します。', href: FORM_MAKER_URL, pictogram: ListCheckbox },
  { title: 'サークル企画ツール', description: '参加者の車割・班割と交通費の精算を管理します。', href: TOOL_URL, pictogram: Group },
  { title: '学務提出書類作成ツール', description: '引き継ぎデータから書類を作成します。GitHubでアプリをダウンロードできます。', href: 'https://github.com/mutoshiki/sampokai-submission-builder/releases', pictogram: University },
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
  if (status === 'unavailable') return { heading: '履歴を読み込めませんでした', detail: '保存領域を確認して、もう一度読み込んでください。', empty: false };
  if (status === 'partial') return { heading: emptyMessage, detail: '一部の履歴を読み取れませんでした。表示できる項目を残しています。', empty: false };
  return { heading: emptyMessage, detail: '', empty: true };
}

function App() {
  const [portalState, setPortalState] = useState(loadPortalState);
  const [toast, setToast] = useState('');
  const [copyErrors, setCopyErrors] = useState({});
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllForms, setShowAllForms] = useState(false);
  const toastTimer = useRef(null);
  const projectHeadingRef = useRef(null);
  const formHeadingRef = useRef(null);

  const refreshPortalState = useCallback(() => setPortalState(loadPortalState()), []);

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

  useEffect(() => {
    if (showAllProjects && portalState.projects.projects.length <= HISTORY_PREVIEW_LIMIT) {
      projectHeadingRef.current?.focus();
      setShowAllProjects(false);
    }
  }, [portalState.projects.projects.length, showAllProjects]);

  useEffect(() => {
    if (showAllForms && portalState.forms.forms.length <= HISTORY_PREVIEW_LIMIT) {
      formHeadingRef.current?.focus();
      setShowAllForms(false);
    }
  }, [portalState.forms.forms.length, showAllForms]);

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
      setCopyErrors(errors => ({ ...errors, [errorId]: 'コピーできませんでした。もう一度お試しください。' }));
    }
  }, [showToast]);

  const projectInfo = sectionStatus(portalState.projects.status, 'このブラウザで開いた企画はありません。');
  const formInfo = sectionStatus(portalState.forms.status, 'このブラウザで作成したフォームはありません。');

  const toolsSection = (
    <section key="tools" className="tools-section" aria-labelledby="tools-heading">
      <h2 id="tools-heading" className="section-heading">ツール</h2>
      <Layer level={0} as="div" className="tool-grid" aria-label="利用するツール">
        {TOOLS.map((tool, index) => {
          const Pictogram = tool.pictogram;
          const descriptionId = `tool-description-${index}`;
          return (
            <ClickableTile
              key={tool.title}
              className="tool-tile"
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              renderIcon={Launch}
              aria-label={`${tool.title}を新しいタブで開く`}
              aria-describedby={descriptionId}
            >
              <div className="tool-tile__pictogram" aria-hidden="true"><Pictogram width={48} height={48} aria-hidden="true" /></div>
              <div className="tool-tile__content">
                <h3>{tool.title}</h3>
                <p id={descriptionId}>{tool.description}</p>
              </div>
            </ClickableTile>
          );
        })}
      </Layer>
    </section>
  );

  const formsSection = (
    <section key="forms" className="history-section projects form-history" aria-labelledby="forms-heading">
      <h2 id="forms-heading" className="section-heading" tabIndex="-1" ref={formHeadingRef}>作成したフォーム</h2>
      {portalState.forms.status === 'unavailable' && <div className="history-message" role="status"><p>{formInfo.heading}。{formInfo.detail}</p><Button kind="ghost" size="sm" renderIcon={Renew} onClick={refreshPortalState}>再読み込み</Button></div>}
      {portalState.forms.status === 'partial' && <p className="history-message" role="status">{formInfo.detail}</p>}
      <ContainedList id="form-history-list" className="project-list form-history-list" kind="on-page" size="xl" aria-labelledby="forms-heading">
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
              className={`project-list__row${responseUrl || editUrl ? ' project-list__row--form-actions' : ''}`}
              action={(responseUrl || editUrl) ? <div className="project-list__actions"><OverflowMenu aria-label={`${label}のフォーム操作`} iconDescription={`${label}のフォーム操作`} flipped menuOptionsClass="project-list__form-menu">
                {responseUrl && <OverflowMenuItem itemText={RESPONSE_LINK_COPY_LABEL} onClick={() => copyLink(responseUrl, `${RESPONSE_LINK_COPY_LABEL}しました`, errorId)} />}
                {editUrl && <OverflowMenuItem itemText={EDIT_LINK_COPY_LABEL} onClick={() => copyLink(editUrl, `${EDIT_LINK_COPY_LABEL}しました`, errorId)} />}
              </OverflowMenu></div> : undefined}
            >
              <div className="project-list__item">
                {responseUrl ? <a className="project-title history-link" href={responseUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}の応募フォームを新しいタブで開く`}>{label}</a> : <span className="project-title">{label}</span>}
                <time dateTime={createdAt === null ? undefined : new Date(createdAt).toISOString()}>{createdAt === null ? '作成日時不明' : `作成 ${formatDate(createdAt)}`}</time>
                {projectUrl && <a className="history-project-link" href={projectUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}の企画を新しいタブで開く`} onClick={() => { markProjectOpened(projectUrl); refreshPortalState(); }}>企画を開く</a>}
                {copyErrors[errorId] && <span className="copy-error" role="alert">{copyErrors[errorId]}</span>}
              </div>
            </ContainedListItem>
          );
        }) : portalState.forms.status !== 'unavailable' ? <ContainedListItem>{formInfo.heading} 上の「応募フォームメーカー」からフォームを作成すると、ここに表示されます。</ContainedListItem> : <ContainedListItem>フォーム履歴を表示できません。</ContainedListItem>}
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
    </section>
  );

  const projectsSection = (
    <section key="projects" className="history-section projects" aria-labelledby="projects-heading">
      <h2 id="projects-heading" className="section-heading" tabIndex="-1" ref={projectHeadingRef}>最近開いた企画</h2>
      {portalState.projects.status === 'unavailable' && <div className="history-message" role="status"><p>{projectInfo.heading}。{projectInfo.detail}</p><Button kind="ghost" size="sm" renderIcon={Renew} onClick={refreshPortalState}>再読み込み</Button></div>}
      {portalState.projects.status === 'partial' && <p className="history-message" role="status">{projectInfo.detail}</p>}
      <ContainedList id="project-history-list" className="project-list" kind="on-page" size="xl" aria-labelledby="projects-heading">
        {portalState.projects.projects.length ? portalState.projects.projects.slice(0, showAllProjects ? undefined : HISTORY_PREVIEW_LIMIT).map((project) => {
          const label = project.name || '名称未設定の企画';
          const projectUrl = `${TOOL_URL}?room=${encodeURIComponent(project.roomId)}`;
          const { timestamp: displayDate, label: dateLabel } = getProjectDisplayDate(project);
          return <ContainedListItem key={project.roomId} className="project-list__row">
            <div className="project-list__item">
              <a className="project-title history-link" href={projectUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}をサークル企画ツールで新しいタブに開く`} onClick={() => { markProjectOpened(projectUrl); refreshPortalState(); }}>{label}<Launch className="history-link__icon" size={20} aria-hidden="true" /></a>
              <time dateTime={displayDate === null ? undefined : new Date(displayDate).toISOString()}>{displayDate === null ? dateLabel : `${dateLabel} ${formatDate(displayDate)}`}</time>
            </div>
          </ContainedListItem>;
        }) : portalState.projects.status !== 'unavailable' ? <ContainedListItem>{projectInfo.heading} 上の「サークル企画ツール」から企画を開くと、ここに表示されます。</ContainedListItem> : <ContainedListItem>企画履歴を表示できません。</ContainedListItem>}
      </ContainedList>
      {portalState.projects.projects.length > HISTORY_PREVIEW_LIMIT && <Button
        className="history-toggle"
        kind="ghost"
        size="sm"
        aria-label={showAllProjects ? '最近開いた企画を折りたたむ' : '最近開いた企画をすべて見る'}
        aria-expanded={showAllProjects}
        aria-controls="project-history-list"
        onClick={() => setShowAllProjects(value => !value)}
      >{showAllProjects ? '表示を減らす' : 'すべて見る'}</Button>}
    </section>
  );

  const sections = { tools: toolsSection, forms: formsSection, projects: projectsSection };

  return <>
    <a className="skip-link" href="#main">本文へ移動</a>
    <Header aria-label="山歩会企画ポータル"><HeaderName href="./" prefix="">山歩会企画ポータル</HeaderName><ThemeHeaderControl /></Header>
    <main id="main" className="portal-page">
      <h1 className="portal-title">山歩会企画ポータル</h1>
      {sections.projects}
      {sections.tools}
      {sections.forms}
    </main>
    {toast && <div className="toast-host"><ToastNotification kind="success" title={toast} timeout={5000} lowContrast onCloseButtonClick={() => setToast('')} /></div>}
  </>;
}

export default App;
