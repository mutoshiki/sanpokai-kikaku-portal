const JOB_ID_RE = /^[A-Za-z0-9_-]{16,80}$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function tokenUid(token, projectId, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return '';
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` ||
        typeof payload.sub !== 'string' || !UID_RE.test(payload.sub) || Number(payload.exp) <= nowSeconds) return '';
    return payload.sub;
  } catch {
    return '';
  }
}

async function dispatch(request, env) {
  if (!env.JOBS || !env.FIREBASE_DATABASE_URL || !env.FIREBASE_PROJECT_ID) return json({ error: 'service_unavailable' }, 503);
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const uid = tokenUid(token, env.FIREBASE_PROJECT_ID);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const jobId = String(body?.jobId || '');
  if (!JOB_ID_RE.test(jobId)) return json({ error: 'invalid_request' }, 400);

  const base = String(env.FIREBASE_DATABASE_URL).replace(/\/$/, '');
  const path = `formMakerV1/users/${encodeURIComponent(uid)}/jobs/${encodeURIComponent(jobId)}.json`;
  let response;
  try {
    response = await fetch(`${base}/${path}?auth=${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } });
  } catch { return json({ error: 'firebase_unavailable' }, 503); }
  if (!response.ok) return json({ error: response.status === 401 || response.status === 403 ? 'unauthorized' : 'firebase_unavailable' }, response.status === 401 || response.status === 403 ? 403 : 503);
  const job = await response.json().catch(() => null);
  if (!job || job.jobId !== jobId || job.state !== 'queued') return json({ error: 'job_not_queued' }, 409);

  try { await env.JOBS.send({ uid, jobId }); }
  catch { return json({ error: 'dispatch_unavailable' }, 503); }
  return json({ jobId, state: 'queued' }, 202);
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const headers = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return headers ? new Response(null, { status: 204, headers }) : json({ error: 'origin_not_allowed' }, 403);
    if (!headers) return json({ error: 'origin_not_allowed' }, 403);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/form-creation-jobs') return json({ error: 'not_found' }, 404, headers);
    const result = await dispatch(request, env);
    const responseHeaders = new Headers(result.headers);
    Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
    return new Response(result.body, { status: result.status, headers: responseHeaders });
  },

  async queue(batch, env) {
    if (!env.APPS_SCRIPT_WEB_APP_URL || !env.APPS_SCRIPT_HMAC_SECRET) throw new Error('worker_not_configured');
    for (const message of batch.messages) {
      const { uid, jobId } = message.body || {};
      if (!UID_RE.test(String(uid || '')) || !JOB_ID_RE.test(String(jobId || ''))) {
        message.ack();
        continue;
      }
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const canonical = [timestamp, nonce, uid, jobId].join('\n');
      const signature = await sign(env.APPS_SCRIPT_HMAC_SECRET, canonical);
      let response;
      try {
        response = await fetch(env.APPS_SCRIPT_WEB_APP_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version: 1, timestamp, nonce, uid, jobId, signature }),
          redirect: 'follow',
        });
      } catch (error) {
        message.retry();
        continue;
      }
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok === true && ['completed', 'partial', 'failed', 'unknown', 'already_running', 'not_queued'].includes(result.state)) {
        message.ack();
      } else {
        message.retry();
      }
    }
  },
};

export { tokenUid, sign };
