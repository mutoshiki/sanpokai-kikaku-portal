export const PROJECT_REGISTRY_KEY = 'sanpokai_portal_project_history_v1';
export const FORM_HISTORY_KEY = 'sanpokai-form-builder-history-v1';
export const REACT_ROOM_PREFIX = 'sanpo-react:v1:';
const STORE_PREFIX = 'sampokai_v10_split_';
const SYNC_BASE_PREFIX = `${STORE_PREFIX}sync_base_`;
const SYNC_OUTBOX_PREFIX = `${STORE_PREFIX}sync_outbox_`;
const HISTORY_PREFIX = 'syawari_history_';
const OPENED_AT_PREFIX = 'syawari_last_opened_at_';
const LAST_ROOM_KEY = 'syawari_last_room_id';
const MAX_DATE = 8.64e15;

function parsed(value) {
  try { return { ok: true, value: JSON.parse(value) }; }
  catch { return { ok: false, value: null }; }
}

export function normalizePortalDate(value) {
  let timestamp = null;
  if (typeof value === 'number' && Number.isFinite(value)) timestamp = value;
  else if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value);
  } else if (value && typeof value === 'object') {
    const rawSeconds = value.seconds ?? value._seconds;
    if (rawSeconds !== undefined && rawSeconds !== null && rawSeconds !== '') {
      const seconds = Number(rawSeconds);
      if (Number.isFinite(seconds)) timestamp = seconds * 1000;
    }
  }
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= MAX_DATE ? timestamp : null;
}

function sourceRecord(data, source, order) {
  const updatedAt = normalizePortalDate(data.lastUpdatedAt ?? data.updatedAt ?? data.meta?.updatedAt);
  const lastOpenedAt = normalizePortalDate(data.lastOpenedAt ?? data.lastOpened);
  const name = String(data.roomName ?? data.name ?? '').trim();
  return { updatedAt, lastOpenedAt, name, source, order };
}

export function readProjectIndex(storage) {
  const candidates = new Map();
  const errors = [];
  let foundData = false;
  let order = 0;
  const add = (roomId, data, source, forcedUpdatedAt = null) => {
    const id = String(roomId || '').trim();
    if (!id) { errors.push('企画IDが空です'); return; }
    const record = sourceRecord(data || {}, source, order++);
    if (forcedUpdatedAt !== null) record.updatedAt = normalizePortalDate(forcedUpdatedAt) ?? record.updatedAt;
    const records = candidates.get(id) || [];
    records.push(record);
    candidates.set(id, records);
    foundData = true;
  };

  try {
    const registryText = storage.getItem(PROJECT_REGISTRY_KEY);
    if (registryText !== null) {
      const registry = parsed(registryText);
      if (!registry.ok || !Array.isArray(registry.value?.projects)) errors.push('企画履歴の索引を読み取れません');
      else registry.value.projects.forEach(project => {
        if (!project || typeof project !== 'object' || Array.isArray(project)) { errors.push('企画索引の一部に不正な項目があります'); return; }
        add(project.roomId, project, 'registry');
      });
    }
  } catch { errors.push('企画履歴の索引にアクセスできません'); }

  try {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      try {
        if (key.startsWith(REACT_ROOM_PREFIX) && key.endsWith(':room')) {
          const encoded = key.slice(REACT_ROOM_PREFIX.length, -':room'.length);
          let roomId;
          try { roomId = decodeURIComponent(encoded); } catch { errors.push('React企画IDを読み取れません'); continue; }
          const result = parsed(storage.getItem(key));
          if (!result.ok || !result.value || typeof result.value !== 'object' || Array.isArray(result.value)) { errors.push(`企画データを読み取れません: ${roomId}`); continue; }
          add(roomId, result.value, 'react');
          continue;
        }
        if (key.startsWith(OPENED_AT_PREFIX)) {
          add(key.slice(OPENED_AT_PREFIX.length), { lastOpenedAt: storage.getItem(key) }, 'opened');
          continue;
        }
        if (key.startsWith(SYNC_BASE_PREFIX)) {
          const result = parsed(storage.getItem(key));
          if (!result.ok) { errors.push('同期基準データを読み取れません'); continue; }
          add(key.slice(SYNC_BASE_PREFIX.length), result.value || {}, 'legacy');
          continue;
        }
        if (key.startsWith(STORE_PREFIX) && !key.startsWith(SYNC_OUTBOX_PREFIX)) {
          const result = parsed(storage.getItem(key));
          if (!result.ok) { errors.push('旧企画データを読み取れません'); continue; }
          add(key.slice(STORE_PREFIX.length), result.value || {}, 'legacy');
          continue;
        }
        if (key.startsWith(HISTORY_PREFIX)) {
          const roomId = key.slice(HISTORY_PREFIX.length);
          const result = parsed(storage.getItem(key));
          if (!result.ok || !Array.isArray(result.value)) { errors.push(`企画履歴を読み取れません: ${roomId}`); continue; }
          if (!result.value.length) { add(roomId, {}, 'legacy'); continue; }
          const latest = result.value.reduce((best, item) => normalizePortalDate(item?.time) > normalizePortalDate(best?.time) ? item : best, result.value[0]);
          add(roomId, latest?.data || {}, 'legacy', latest?.data?.lastUpdatedAt ?? latest?.data?.updatedAt ?? latest?.time);
        }
      } catch { errors.push(`企画データを読み取れません: ${key}`); }
    }
    const lastRoom = storage.getItem(LAST_ROOM_KEY) || '';
    if (lastRoom && !candidates.has(lastRoom)) add(lastRoom, {}, 'legacy');
  } catch { errors.push('保存された企画一覧にアクセスできません'); }

  const projects = [...candidates.entries()].map(([roomId, records]) => {
    const named = records.filter(record => record.name).sort((a, b) =>
      (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity)
      || ({ react: 3, legacy: 2, registry: 1, opened: 0 }[b.source] - { react: 3, legacy: 2, registry: 1, opened: 0 }[a.source])
      || b.order - a.order,
    )[0];
    const maxDate = key => {
      const values = records.map(record => record[key]).filter(value => value !== null);
      return values.length ? Math.max(...values) : null;
    };
    return { roomId, name: named?.name || '', updatedAt: maxDate('updatedAt'), lastOpenedAt: maxDate('lastOpenedAt') };
  }).sort((a, b) => {
    const aDate = a.lastOpenedAt ?? a.updatedAt;
    const bDate = b.lastOpenedAt ?? b.updatedAt;
    if (aDate === null && bDate !== null) return 1;
    if (aDate !== null && bDate === null) return -1;
    return (bDate ?? 0) - (aDate ?? 0) || a.roomId.localeCompare(b.roomId);
  });

  const status = errors.length ? (projects.length ? 'partial' : 'unavailable') : (foundData ? 'ready' : 'empty');
  return { status, projects, errors };
}

export function getProjectDisplayDate(project) {
  const lastOpenedAt = normalizePortalDate(project?.lastOpenedAt);
  if (lastOpenedAt !== null) return { timestamp: lastOpenedAt, label: '最終閲覧' };
  const updatedAt = normalizePortalDate(project?.updatedAt);
  if (updatedAt !== null) return { timestamp: updatedAt, label: '最終更新' };
  return { timestamp: null, label: '日時不明' };
}

export function getProjectDisambiguators(projects) {
  const groups = new Map();
  for (const project of Array.isArray(projects) ? projects : []) {
    const roomId = String(project?.roomId ?? '').trim();
    if (!roomId) continue;
    const name = String(project?.name ?? '').trim() || '名称未設定の企画';
    const { timestamp, label } = getProjectDisplayDate(project);
    const minute = timestamp === null ? 'unknown' : String(Math.floor(timestamp / 60_000));
    const key = JSON.stringify([name, label, minute]);
    const ids = groups.get(key) || new Set();
    ids.add(roomId);
    groups.set(key, ids);
  }

  const disambiguators = new Map();
  for (const ids of groups.values()) {
    if (ids.size < 2) continue;
    for (const roomId of ids) disambiguators.set(roomId, `企画ID: ${roomId}`);
  }
  return disambiguators;
}

export function readFormIndex(storage) {
  try {
    const value = storage.getItem(FORM_HISTORY_KEY);
    if (value === null) return { status: 'empty', forms: [], errors: [] };
    const result = parsed(value);
    if (!result.ok || !Array.isArray(result.value)) return { status: 'unavailable', forms: [], errors: ['フォーム履歴を読み取れません'] };
    const forms = [];
    const errors = [];
    const seen = new Set();
    for (const item of result.value) {
      const formId = String(item?.formId || '').trim();
      if (!item || typeof item !== 'object' || Array.isArray(item) || !formId) { errors.push('フォーム履歴の一部に不正な項目があります'); continue; }
      if (seen.has(formId)) continue;
      seen.add(formId);
      forms.push({ ...item, formId, createdAt: normalizePortalDate(item.createdAt) });
    }
    forms.sort((a, b) => {
      if (a.createdAt === null && b.createdAt !== null) return 1;
      if (a.createdAt !== null && b.createdAt === null) return -1;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.formId.localeCompare(b.formId);
    });
    return { status: errors.length ? (forms.length ? 'partial' : 'unavailable') : forms.length ? 'ready' : 'empty', forms, errors };
  } catch { return { status: 'unavailable', forms: [], errors: ['フォーム履歴にアクセスできません'] }; }
}

export function persistProjectIndex(storage, projects) {
  try {
    const value = JSON.stringify({ version: 1, projects });
    if (storage.getItem(PROJECT_REGISTRY_KEY) === value) return { ok: true, changed: false };
    storage.setItem(PROJECT_REGISTRY_KEY, value);
    return { ok: true, changed: true };
  } catch (error) { return { ok: false, error }; }
}

export function isRelevantPortalStorageKey(key) {
  return typeof key === 'string' && (
    key === PROJECT_REGISTRY_KEY || key === FORM_HISTORY_KEY || key === LAST_ROOM_KEY
    || key.startsWith(REACT_ROOM_PREFIX) && key.endsWith(':room')
    || key.startsWith(OPENED_AT_PREFIX) || key.startsWith(SYNC_BASE_PREFIX)
    || key.startsWith(STORE_PREFIX) && !key.startsWith(SYNC_OUTBOX_PREFIX)
    || key.startsWith(HISTORY_PREFIX)
  );
}
