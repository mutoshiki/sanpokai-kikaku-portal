const ROOM_ID = /^[A-Za-z0-9_-]{6,80}$/;
const JOB_ID = /^[a-f0-9]{32}$/;
const TOKEN = /^h_[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
let lastConsumedHref = '';
let lastConsumedValue = null;

export function readFormMakerProjectLink({ href = globalThis.location?.href, history = globalThis.history } = {}) {
  if (href && href === lastConsumedHref) return lastConsumedValue;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!url.hash.startsWith('#sanpo-form-link=')) return null;
  lastConsumedHref = href;
  lastConsumedValue = null;
  const raw = url.hash.slice('#sanpo-form-link='.length);
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    const date = String(value?.eventDate || '');
    const validDate = DATE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    if (value?.version !== 1 || !ROOM_ID.test(String(value.roomId || '')) || !JOB_ID.test(String(value.jobId || '')) ||
        !TOKEN.test(String(value.token || '')) || !String(value.projectName || '').trim() || String(value.projectName).length > 120 ||
        (date && !validDate)) {
      url.hash = '';
      try { history?.replaceState?.(history.state, '', url.href); } catch { /* Invalid fragments are ignored. */ }
      return null;
    }
    const result = Object.freeze({ version: 1, roomId: value.roomId, jobId: value.jobId, token: value.token,
      projectName: String(value.projectName).trim(), eventDate: validDate ? date : '' });
    url.hash = '';
    try { history?.replaceState?.(history.state, '', url.href); } catch { /* The capability remains in component memory only. */ }
    lastConsumedValue = result;
    return lastConsumedValue;
  } catch {
    url.hash = '';
    try { history?.replaceState?.(history.state, '', url.href); } catch { /* Invalid fragments are ignored. */ }
    return null;
  }
}
