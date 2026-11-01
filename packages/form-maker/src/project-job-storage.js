const ROOM_ID = /^[A-Za-z0-9_-]{6,80}$/;
const JOB_ID = /^[a-f0-9]{32}$/;
const INPUT_FIELDS = ['planName', 'editorEmail', 'eventDate', 'deadline', 'description'];
const JOB_STATES = new Set(['queued', 'running', 'partial', 'failed', 'unknown']);
const PREFIX = 'sanpokai-form-maker-project-v1:';

function resolveStorage(storage, name) {
  if (storage !== undefined) return storage;
  try { return globalThis[name]; } catch { return null; }
}

export function formMakerProjectStorageKey(roomId, kind) {
  if (!ROOM_ID.test(String(roomId || ''))) throw new Error('Invalid room id');
  if (!['input', 'pending'].includes(kind)) throw new Error('Invalid storage kind');
  return `${PREFIX}${encodeURIComponent(roomId)}:${kind}`;
}

function safeRead(storage, key) {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function cleanInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const field of INPUT_FIELDS) {
    if (typeof value[field] === 'string') result[field] = value[field].slice(0, field === 'description' ? 3000 : field === 'planName' ? 100 : 254);
  }
  return result;
}

function cleanPending(value) {
  if (!value || typeof value !== 'object' || !JOB_ID.test(String(value.jobId || '')) || !JOB_STATES.has(value.state)) return null;
  return { jobId: value.jobId, state: value.state, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0 };
}

export function createProjectJobStorage({ storage, roomId }) {
  if (!ROOM_ID.test(String(roomId || ''))) throw new Error('Invalid room id');
  storage = resolveStorage(storage, 'localStorage');
  const inputKey = formMakerProjectStorageKey(roomId, 'input');
  const pendingKey = formMakerProjectStorageKey(roomId, 'pending');
  const write = (key, value) => {
    try { if (!storage) return false; storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  return Object.freeze({
    roomId,
    readInput: () => cleanInput(safeRead(storage, inputKey)),
    writeInput: value => {
      const clean = cleanInput(value);
      return clean ? write(inputKey, clean) : false;
    },
    clearInput: () => { try { if (!storage) return false; storage.removeItem(inputKey); return true; } catch { return false; } },
    readPendingJob: () => cleanPending(safeRead(storage, pendingKey)),
    writePendingJob: value => {
      const clean = cleanPending(value);
      return clean ? write(pendingKey, clean) : false;
    },
    clearPendingJob: () => { try { if (!storage) return false; storage.removeItem(pendingKey); return true; } catch { return false; } },
  });
}

export function migrateLegacyPendingJob({ roomStorage, projectJobId, legacyStorage } = {}) {
  legacyStorage = resolveStorage(legacyStorage, 'sessionStorage');
  if (!roomStorage || !JOB_ID.test(String(projectJobId || '')) || roomStorage.readPendingJob()) return false;
  let legacyJobId = '';
  try { legacyJobId = String(legacyStorage?.getItem('sanpokai-form-maker-pending-job-v1') || ''); } catch { return false; }
  if (legacyJobId !== projectJobId) return false;
  if (!roomStorage.writePendingJob({ jobId: legacyJobId, state: 'unknown', updatedAt: Date.now() })) return false;
  try { legacyStorage?.removeItem('sanpokai-form-maker-pending-job-v1'); } catch { /* The room-scoped copy is already durable. */ }
  return true;
}
