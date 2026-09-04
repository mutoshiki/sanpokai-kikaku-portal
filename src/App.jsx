import React, { useCallback, useEffect, useState } from 'react';
import {
  ClickableTile,
  Header,
  HeaderName,
  Layer,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
} from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function App() {
  const [{ lastRoom, projects, formHistory }, setPortalState] = useState(() => {
    try { return { ...readProjects(), formHistory: readFormHistory() }; } catch { return { lastRoom: '', projects: [], formHistory: [] }; }
  });

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

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <Header aria-label="山歩会企画ツール一覧">
        <HeaderName href="./" prefix="">山歩会企画ツール一覧</HeaderName>
        <ThemeHeaderControl />
      </Header>

      <main id="main" className="portal-page">
        <h1 className="portal-title">ツール</h1>

        <Layer as="section" className="tool-grid" aria-label="利用するツール">
          {TOOLS.map((tool) => (
            <ClickableTile
              key={tool.title}
              className="tool-tile"
              href={tool.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${tool.title}を新しいタブで開く`}
            >
              <div className="tool-tile__content">
                <h2>{tool.title}</h2>
                <p>{tool.description}</p>
              </div>
              <ArrowRight className="tool-tile__arrow" size={20} aria-hidden="true" />
            </ClickableTile>
          ))}
        </Layer>

        <section className="projects form-history" aria-labelledby="form-history-title">
          <h2 id="form-history-title">フォーム作成履歴</h2>
          {formHistory.length ? (
            <StructuredListWrapper className="project-list form-history-list" aria-label="フォーム作成履歴">
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>フォーム</StructuredListCell>
                  <StructuredListCell head>作成日時</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {formHistory.map((form) => {
                  const label = String(form.planName ?? form.title ?? '').trim() || '応募フォーム';
                  const responseUrl = safeExternalUrl(form.responseUrl);
                  const editUrl = safeExternalUrl(form.editUrl);
                  const primaryUrl = responseUrl || editUrl;
                  const primaryLinkLabel = responseUrl ? '回答フォームを開く' : editUrl ? '編集フォームを開く' : 'フォームURLなし';
                  const createdAt = String(form.createdAt || '').trim();
                  return (
                    <StructuredListRow key={form.formId}>
                      <StructuredListCell>
                        {primaryUrl ? (
                          <a
                            className="project-link"
                            href={primaryUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${label}を新しいタブで開く`}
                          >{label}</a>
                        ) : <span className="project-link">{label}</span>}
                        <span className="project-meta">
                          {primaryLinkLabel} · ID: {form.formId}
                          {editUrl && editUrl !== primaryUrl ? (
                            <> · <a className="form-history__edit-link" href={editUrl} target="_blank" rel="noopener noreferrer">編集</a></>
                          ) : null}
                        </span>
                      </StructuredListCell>
                      <StructuredListCell>
                        <time dateTime={createdAt || undefined}>{formatDate(createdAt)}</time>
                      </StructuredListCell>
                    </StructuredListRow>
                  );
                })}
              </StructuredListBody>
            </StructuredListWrapper>
          ) : (
            <p className="empty-state">このブラウザで作成したフォームはありません。</p>
          )}
        </section>

        <section className="projects" aria-labelledby="projects-title">
          <h2 id="projects-title">過去に開いた企画</h2>
          {projects.length ? (
            <StructuredListWrapper className="project-list" aria-label="過去に開いた企画">
              <StructuredListHead>
                <StructuredListRow head>
                  <StructuredListCell head>企画</StructuredListCell>
                  <StructuredListCell head>最終更新</StructuredListCell>
                </StructuredListRow>
              </StructuredListHead>
              <StructuredListBody>
                {projects.map((project) => {
                  const label = project.name || `企画 ${project.roomId}`;
                  return (
                    <StructuredListRow key={project.roomId}>
                      <StructuredListCell>
                        <a
                          className="project-link"
                          href={`${TOOL_URL}?room=${encodeURIComponent(project.roomId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${label}を新しいタブで開く`}
                        >{label}</a>
                        <span className="project-meta">
                          {project.roomId === lastRoom ? `最後に開いた企画 · ID: ${project.roomId}` : `ID: ${project.roomId}`}
                        </span>
                      </StructuredListCell>
                      <StructuredListCell>
                        <time dateTime={project.updatedAt ? new Date(project.updatedAt).toISOString() : undefined}>
                          {formatDate(project.updatedAt)}
                        </time>
                      </StructuredListCell>
                    </StructuredListRow>
                  );
                })}
              </StructuredListBody>
            </StructuredListWrapper>
          ) : (
            <p className="empty-state">このブラウザで開いた企画はありません。</p>
          )}
        </section>
      </main>
    </>
  );
}

export default App;
