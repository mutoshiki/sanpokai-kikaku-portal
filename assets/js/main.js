(() => {
  'use strict';

  const TOOL_BASE_URL = 'https://mutoshiki.github.io/circle-kikaku-tools/';
  const ROOM_STORAGE_PREFIX = 'sampokai_v10_split_';
  const LAST_ROOM_KEY = 'syawari_last_room_id';
  const INTERNAL_PREFIXES = ['sync_base_', 'sync_outbox_'];

  const list = document.getElementById('project-list');
  const refreshButton = document.getElementById('refresh-projects');

  if (!list) return;

  function safeParse(value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function getRoomIdFromKey(key) {
    if (!key.startsWith(ROOM_STORAGE_PREFIX)) return null;
    const suffix = key.slice(ROOM_STORAGE_PREFIX.length);
    if (!suffix || INTERNAL_PREFIXES.some(prefix => suffix.startsWith(prefix))) return null;
    return suffix;
  }

  function readProjects() {
    const projects = new Map();
    const lastRoomId = localStorage.getItem(LAST_ROOM_KEY) || '';

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;

      const roomId = getRoomIdFromKey(key);
      if (!roomId) continue;

      const data = safeParse(localStorage.getItem(key));
      if (!data) continue;

      const updatedAt = Number(
        data.lastUpdatedAt ??
        data.updatedAt ??
        data.meta?.updatedAt ??
        0
      );

      projects.set(roomId, {
        roomId,
        name: String(data.roomName || '').trim() || `企画 ${roomId}`,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
        isLastOpened: roomId === lastRoomId
      });
    }

    return [...projects.values()].sort((a, b) => {
      if (a.isLastOpened !== b.isLastOpened) return a.isLastOpened ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function createProjectRow(project) {
    const row = document.createElement('a');
    row.className = 'project-row';
    row.href = `${TOOL_BASE_URL}?room=${encodeURIComponent(project.roomId)}`;

    const main = document.createElement('div');
    main.className = 'project-main';

    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = project.name;

    const meta = document.createElement('span');
    meta.className = 'project-meta';
    meta.textContent = project.isLastOpened ? '最後に開いた企画' : `ID: ${project.roomId}`;

    const date = document.createElement('time');
    date.className = 'project-date';
    date.textContent = formatDate(project.updatedAt);
    if (project.updatedAt) date.dateTime = new Date(project.updatedAt).toISOString();

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 32 32');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.classList.add('project-arrow');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M18 6l-1.4 1.4 7.6 7.6H6v2h18.2l-7.6 7.6L18 26l10-10z');
    arrow.appendChild(path);

    main.append(name, meta);
    row.append(main, date, arrow);
    return row;
  }

  function render() {
    list.replaceChildren();

    let projects = [];
    try {
      projects = readProjects();
    } catch (error) {
      console.warn('企画一覧を読み込めませんでした。', error);
      const errorBox = document.createElement('div');
      errorBox.className = 'notification notification-error';
      errorBox.textContent = '企画一覧を読み込めませんでした。';
      list.append(errorBox);
      return;
    }

    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `
        <h3>まだ企画がありません</h3>
        <p>このブラウザでサークル企画ツールを開くと、ここに表示されます。</p>
      `;
      list.append(empty);
      return;
    }

    projects.forEach(project => list.append(createProjectRow(project)));
  }

  refreshButton?.addEventListener('click', render);
  window.addEventListener('storage', render);
  render();
})();
