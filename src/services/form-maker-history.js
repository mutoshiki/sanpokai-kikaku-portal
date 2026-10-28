const FORM_HISTORY_KEY = 'sanpokai-form-builder-history-v1';

function safeRead(storage, key) {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function resolveStorage(storage) {
  try { return storage === undefined ? globalThis.localStorage : storage; }
  catch { return null; }
}

function workerJobToHistory(job) {
  if (!['completed', 'partial'].includes(job?.state)) return null;
  const result = job.result;
  const formId = String(result?.formId || '').trim();
  if (!formId) return null;
  return {
    formId,
    jobId: String(job.jobId || ''),
    planName: String(result.planName || job.input?.planName || '企画名未設定の応募フォーム'),
    createdAt: Number(result.createdAt || job.finishedAt || job.requestedAt || 0) || '',
    projectId: String(result.projectId || ''),
    projectUrl: String(result.projectUrl || ''),
    responseUrl: String(result.formUrl || ''),
    editUrl: String(result.editUrl || ''),
    responseSheetUrl: String(result.responseSheetUrl || ''),
    editorEmail: String(job.input?.editorEmail || ''),
    stepResults: result.stepResults && typeof result.stepResults === 'object' ? result.stepResults : {},
  };
}

export function projectUrlWithHandoffCapability(projectUrl, token) {
  const url = String(projectUrl || '');
  const capability = String(token || '');
  if (!/^h_[A-Za-z0-9_-]{48,160}$/.test(capability)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'mutoshiki.github.io' || !parsed.pathname.startsWith('/circle-kikaku-tools/')) return url;
    parsed.searchParams.set('handoff', capability);
    return parsed.href;
  } catch {
    return url;
  }
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return '';
}

export function mergeFormMakerJobs(localHistory, jobs) {
  const byId = new Map();
  for (const item of Array.isArray(localHistory) ? localHistory : []) {
    const formId = String(item?.formId || '').trim();
    if (formId) byId.set(formId, { ...item, formId, createdAt: timestamp(item.createdAt) });
  }
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const item = workerJobToHistory(job);
    if (!item) continue;
    const existing = byId.get(item.formId) || {};
    byId.set(item.formId, { ...existing, ...item });
  }
  return [...byId.values()].sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

export function readCachedFormMakerHistory(storage) {
  const history = safeRead(resolveStorage(storage), FORM_HISTORY_KEY);
  return Array.isArray(history) ? history : [];
}

export function writeCachedFormMakerHistory(history, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.setItem(FORM_HISTORY_KEY, JSON.stringify(Array.isArray(history) ? history : []));
    return true;
  } catch {
    return false;
  }
}

export { FORM_HISTORY_KEY };
