import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { ArrowRight, Launch } from '@carbon/icons-react';
import { ThemeHeaderControl } from './ThemeToggle.jsx';

const TOOL_URL = 'https://mutoshiki.github.io/circle-kikaku-tools/';
const FORM_MAKER_URL = `${import.meta.env.BASE_URL}form-maker/`;
const STORE_PREFIX = 'sampokai_v10_split_';
const SYNC_BASE_PREFIX = `${STORE_PREFIX}sync_base_`;
const SYNC_OUTBOX_PREFIX = `${STORE_PREFIX}sync_outbox_`;
const HISTORY_PREFIX = 'syawari_history_';
const LAST_ROOM_KEY = 'syawari_last_room_id';
const PROJECT_REGISTRY_KEY = 'sanpokai_portal_project_history_v1';
const FORM_HISTORY_KEY = 'sanpokai-form-builder-history-v1';
const FORM_HISTORY_LIMIT = 10;
const RESPONSE_LINK_COPY_LABEL = '応募フォームのリンクをコピー';
const EDIT_LINK_COPY_LABEL = '編集用リンクをコピー';

const TOOLS = [
  {
    title: '登山計画書メーカー',
    description: '日付などの最小限の入力と、YAMAPのスクリーンショットの2〜3枚の添付で、一瞬で登山計画書が作れます。',
    href: 'https://mutoshiki.github.io/tozan-keikaku-syo-maker/',
  },
  {
    title: '応募フォームメーカー',
    description: '企画名や日付などの最小限の情報を入力するだけで、応募フォームを自動で生成できます。ここで作成したフォームは【サークル企画ツール】の部屋と結び付けられ、フォームを入力した人が自動でツールにインポートされます。',
    href: FORM_MAKER_URL,
  },
  {
    title: 'サークル企画ツール',
    description: '企画当日に使用する車割や班割の作成、精算が簡単にできます。らくらく連絡網の参加者発表の文書を自動で作成できます。サークル長が【学務提出書類作成ツール】で書類を作るために必要な引き継ぎデータを作成できます。',
    href: TOOL_URL,
  },
  {
    title: '学務提出書類作成ツール',
    description: 'サークル長が、企画者から受け取った引き継ぎデータを使って学務提出書類を高速で作成できます。※「山歩会_提出書類作成ツール_〇〇_x64-setup.exe」を押してダウンロード後、開くとインストールできます。',
    href: 'https://github.com/mutoshiki/sampokai-submission-builder/releases',
  },
];

function parse(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function readProjects() {
  const projects = new Map();
  const merge = (roomId, data = {}) => {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) return;
    const current = projects.get(normalizedRoomId) || { roomId: normalizedRoomId, name: '', updatedAt: 0 };
    const updatedAt = Number(data.lastUpdatedAt ?? data.updatedAt ?? data.meta?.updatedAt ?? 0) || 0;
    const nextName = String(data.roomName ?? data.name ?? '').trim();
    projects.set(normalizedRoomId, {
      roomId: normalizedRoomId,
      name: nextName || current.name || '',
      updatedAt: Math.max(current.updatedAt || 0, updatedAt),
    });
  };

  const registry = parse(localStorage.getItem(PROJECT_REGISTRY_KEY));
  if (Array.isArray(registry?.projects)) registry.projects.forEach((project) => merge(project?.roomId, project || {}));

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith(SYNC_BASE_PREFIX)) {
      merge(key.slice(SYNC_BASE_PREFIX.length), parse(localStorage.getItem(key)) || {});
      continue;
    }
    if (key.startsWith(STORE_PREFIX) && !key.startsWith(SYNC_OUTBOX_PREFIX)) {
      merge(key.slice(STORE_PREFIX.length), parse(localStorage.getItem(key)) || {});
      continue;
    }
    if (key.startsWith(HISTORY_PREFIX)) {
      const roomId = key.slice(HISTORY_PREFIX.length);
      const history = parse(localStorage.getItem(key));
      if (Array.isArray(history) && history.length) {
        const latest = history.reduce((best, item) => Number(item?.time || 0) > Number(best?.time || 0) ? item : best, history[0]);
        merge(roomId, {
          ...(latest?.data || {}),
          lastUpdatedAt: Number(latest?.data?.lastUpdatedAt ?? latest?.data?.updatedAt ?? latest?.time ?? 0) || 0,
        });
      } else {
        merge(roomId, {});
      }
    }
  }

  const lastRoom = localStorage.getItem(LAST_ROOM_KEY) || '';
  if (lastRoom && !projects.has(lastRoom)) merge(lastRoom, { updatedAt: Date.now() });

  const sorted = [...projects.values()].sort((a, b) => {
    if (a.roomId === lastRoom && b.roomId !== lastRoom) return -1;
    if (b.roomId === lastRoom && a.roomId !== lastRoom) return 1;
    return b.updatedAt - a.updatedAt;
  });

  try {
    localStorage.setItem(PROJECT_REGISTRY_KEY, JSON.stringify({ version: 1, projects: sorted, savedAt: Date.now() }));
  } catch (error) {
    console.warn('企画一覧の永続履歴を保存できませんでした。', error);
  }
  return { lastRoom, projects: sorted };
}

function readFormHistory() {
  const history = parse(localStorage.getItem(FORM_HISTORY_KEY));
  if (!Array.isArray(history)) return [];

  const seen = new Set();
  return history.filter((item) => {
    const formId = String(item?.formId || '').trim();
    if (!formId || seen.has(formId)) return false;
    seen.add(formId);
    return true;
  }).slice(0, FORM_HISTORY_LIMIT);
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function safeProjectToolUrl(value) {
  const url = safeExternalUrl(value);
  if (!url) return '';
  try {
    const expected = new URL(TOOL_URL);
    const candidate = new URL(url);
    return candidate.origin === expected.origin && candidate.pathname === expected.pathname ? candidate.href : '';
  } catch {
    return '';
  }
}

function openExternalUrl(value) {
  const url = safeProjectToolUrl(value);
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function App() {
  const [{ projects, formHistory }, setPortalState] = useState(() => {
    try { return { ...readProjects(), formHistory: readFormHistory() }; } catch { return { lastRoom: '', projects: [], formHistory: [] }; }
  });
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const refreshPortalState = useCallback(() => {
    try { setPortalState({ ...readProjects(), formHistory: readFormHistory() }); } catch { setPortalState({ lastRoom: '', projects: [], formHistory: [] }); }
  }, []);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => false);
    const onVisibility = () => { if (!document.hidden) refreshPortalState(); };
    window.addEventListener('storage', refreshPortalState);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', refreshPortalState);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshPortalState]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((message) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }, []);

  const copyLink = useCallback(async (url, message) => {
    if (!url) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) return;
      }
      showToast(message);
    } catch {
      // Clipboard failures do not create a second alert surface in the portal.
    }
  }, [showToast]);

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <Header aria-label="山歩会企画ツール一覧">
        <HeaderName href="./" prefix="">山歩会企画ツール一覧</HeaderName>
        <ThemeHeaderControl />
      </Header>

      <main id="main" className="portal-page">
        <h1 className="portal-title">ツール</h1>

        <Layer level={0} as="section" className="tool-grid" aria-label="利用するツール">
          {TOOLS.map((tool) => (
            <ClickableTile
              key={tool.title}
              className="tool-tile"
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              renderIcon={ArrowRight}
              aria-label={`${tool.title}を新しいタブで開く`}
            >
              <div className="tool-tile__content">
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
              </div>
            </ClickableTile>
          ))}
        </Layer>

        <section className="projects form-history">
          <ContainedList className="project-list form-history-list" kind="on-page" size="md" label="作成したフォーム">
            {formHistory.length ? formHistory.map((form) => {
              const label = String(form.planName ?? form.title ?? '').trim() || '応募フォーム';
              const responseUrl = safeExternalUrl(form.responseUrl);
              const editUrl = safeExternalUrl(form.editUrl);
              const projectUrl = safeProjectToolUrl(form.spreadsheetUrl) || safeProjectToolUrl(form.projectUrl);
              const createdAt = String(form.createdAt || '').trim();
              return (
                <ContainedListItem
                  key={form.formId}
                  className={`project-list__row${projectUrl ? ' project-list__row--form-actions' : ''}`}
                  onClick={projectUrl ? () => openExternalUrl(projectUrl) : undefined}
                  action={projectUrl || responseUrl || editUrl ? (
                    <div className="project-list__actions">
                      {(responseUrl || editUrl) && (
                        <OverflowMenu
                          aria-label={`${label}のフォーム操作`}
                          iconDescription={`${label}のフォーム操作`}
                          flipped
                          menuOptionsClass="project-list__form-menu"
                          onClick={(event) => event?.stopPropagation?.()}
                        >
                          {responseUrl && (
                            <OverflowMenuItem
                              itemText={RESPONSE_LINK_COPY_LABEL}
                              onClick={() => copyLink(responseUrl, `${RESPONSE_LINK_COPY_LABEL}しました`)}
                            />
                          )}
                          {editUrl && (
                            <OverflowMenuItem
                              itemText={EDIT_LINK_COPY_LABEL}
                              onClick={() => copyLink(editUrl, `${EDIT_LINK_COPY_LABEL}しました`)}
                            />
                          )}
                        </OverflowMenu>
                      )}
                      {projectUrl && (
                        <span className="project-list__open-icon" aria-hidden="true">
                          <Launch size={20} />
                        </span>
                      )}
                    </div>
                  ) : undefined}
                >
                  <div className="project-list__item">
                    <span className="project-title">{label}</span>
                    <time dateTime={createdAt || undefined}>作成 {formatDate(createdAt)}</time>
                  </div>
                </ContainedListItem>
              );
            }) : (
              <ContainedListItem>このブラウザで作成したフォームはありません。</ContainedListItem>
            )}
          </ContainedList>
        </section>

        <section className="projects">
          <ContainedList className="project-list" kind="on-page" size="md" label="最近開いた企画">
            {projects.length ? projects.map((project) => {
              const label = project.name || '名称未設定の企画';
              const projectUrl = `${TOOL_URL}?room=${encodeURIComponent(project.roomId)}`;
              return (
                <ContainedListItem
                  key={project.roomId}
                  className="project-list__row"
                  onClick={() => openExternalUrl(projectUrl)}
                  action={(
                    <div className="project-list__actions">
                      <span className="project-list__open-icon" aria-hidden="true">
                        <Launch size={20} />
                      </span>
                    </div>
                  )}
                >
                  <div className="project-list__item">
                    <span className="project-title">{label}</span>
                    <time dateTime={project.updatedAt ? new Date(project.updatedAt).toISOString() : undefined}>
                      最終閲覧 {formatDate(project.updatedAt)}
                    </time>
                  </div>
                </ContainedListItem>
              );
            }) : (
              <ContainedListItem>このブラウザで開いた企画はありません。</ContainedListItem>
            )}
          </ContainedList>
        </section>
      </main>

      {toast && (
        <div className="toast-host">
          <ToastNotification
            kind="success"
            title={toast}
            timeout={0}
            lowContrast
            onCloseButtonClick={() => setToast('')}
          />
        </div>
      )}
    </>
  );
}

export default App;
