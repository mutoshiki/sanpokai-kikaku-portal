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

const TOOLS = [
  {
    title: '登山計画書メーカー',
    description: '日付などの最小限の情報を入力し、YAMAPのスクリーンショットを2〜4枚添付するだけで、登山計画書をすぐに作成できます。',
    href: 'https://mutoshiki.github.io/tozan-keikaku-syo-maker/',
  },
  {
    title: '応募フォームメーカー',
    description: '企画名や日付などの最小限の情報を入力するだけで、企画の応募フォームを作成できます。作成したフォームは自動でサークル企画ツールの部屋と結び付き、応募者や車出しの有無、定員などが自動でインポートされます。応募者の中から任意の参加者を選択してツールを使用できます。',
    href: FORM_MAKER_URL,
  },
  {
    title: 'サークル企画ツール',
    description: '車割・班割を作成してリンクで共有できます。交通費などの精算を簡単に行えます。サークル長が学務提出書類作成ツールで書類を作るための引き継ぎデータも作成できます。',
    href: TOOL_URL,
  },
  {
    title: '学務提出書類作成ツール',
    description: 'サークル長が、企画者から受け取った引き継ぎデータから学務提出書類を自動で作成できます。「山歩会_提出書類作成ツール_〇〇_x64-setup.exe」を押してダウンロード後、開くとインストールできます。',
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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function App() {
  const [{ lastRoom, projects }, setProjects] = useState(() => {
    try { return readProjects(); } catch { return { lastRoom: '', projects: [] }; }
  });

  const refreshProjects = useCallback(() => {
    try { setProjects(readProjects()); } catch { setProjects({ lastRoom: '', projects: [] }); }
  }, []);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => false);
    const onVisibility = () => { if (!document.hidden) refreshProjects(); };
    window.addEventListener('storage', refreshProjects);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', refreshProjects);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshProjects]);

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
