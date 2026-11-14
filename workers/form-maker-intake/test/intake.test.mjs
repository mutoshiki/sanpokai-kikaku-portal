import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const origin = 'https://mutoshiki.github.io';
function jwt(payload) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.signature`;
}
function env(overrides = {}) {
  return {
    FIREBASE_PROJECT_ID: 'sanpokai-tool',
    FIREBASE_DATABASE_URL: 'https://example.test',
    ALLOWED_ORIGINS: origin,
    JOBS: { send: async () => {} },
    ...overrides,
  };
}

test('allows only configured browser origins', async () => {
  const response = await worker.fetch(new Request('https://worker.test/v1/form-creation-jobs', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), env());
  assert.equal(response.status, 403);
});

test('dispatches only the authenticated owner queued job and sends minimal queue payload', async () => {
  const token = jwt({ aud: 'sanpokai-tool', iss: 'https://securetoken.google.com/sanpokai-tool', sub: 'user_123', exp: Math.floor(Date.now() / 1000) + 3600 });
  let queued;
  const fetchImpl = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /formMakerV1\/users\/user_123\/jobs\/job_1234567890123456\.json/);
    assert.match(String(url), /auth=/);
    return Response.json({ jobId: 'job_1234567890123456', state: 'queued', input: { private: true } });
  };
  try {
    const response = await worker.fetch(new Request('https://worker.test/v1/form-creation-jobs', {
      method: 'POST', headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job_1234567890123456' }),
    }), env({ JOBS: { send: async body => { queued = body; } } }));
    assert.equal(response.status, 202);
    assert.deepEqual(queued, { uid: 'user_123', jobId: 'job_1234567890123456' });
  } finally { globalThis.fetch = fetchImpl; }
});

test('rejects expired and wrong-audience Firebase tokens', async () => {
  for (const payload of [
    { aud: 'sanpokai-tool', iss: 'https://securetoken.google.com/sanpokai-tool', sub: 'user_123', exp: 1 },
    { aud: 'other', iss: 'https://securetoken.google.com/sanpokai-tool', sub: 'user_123', exp: 9999999999 },
  ]) {
    const response = await worker.fetch(new Request('https://worker.test/v1/form-creation-jobs', {
      method: 'POST', headers: { origin, authorization: `Bearer ${jwt(payload)}`, 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job_1234567890123456' }),
    }), env());
    assert.equal(response.status, 401);
  }
});

test('rejects jobs not in queued state and does not enqueue them', async () => {
  const token = jwt({ aud: 'sanpokai-tool', iss: 'https://securetoken.google.com/sanpokai-tool', sub: 'user_123', exp: Math.floor(Date.now() / 1000) + 3600 });
  const fetchImpl = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jobId: 'job_1234567890123456', state: 'running' });
  let sent = false;
  try {
    const response = await worker.fetch(new Request('https://worker.test/v1/form-creation-jobs', {
      method: 'POST', headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job_1234567890123456' }),
    }), env({ JOBS: { send: async () => { sent = true; } } }));
    assert.equal(response.status, 409);
    assert.equal(sent, false);
  } finally { globalThis.fetch = fetchImpl; }
});

test('signs queue delivery payload without including the form input', async () => {
  const delivered = [];
  const message = { body: { uid: 'user_123', jobId: 'job_1234567890123456' }, ack() { delivered.push('ack'); }, retry() { delivered.push('retry'); } };
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.uid, 'user_123');
    assert.equal(body.jobId, 'job_1234567890123456');
    assert.equal('input' in body, false);
    assert.match(body.signature, /^[a-f0-9]{64}$/);
    return Response.json({ ok: true, state: 'already_running' });
  };
  try {
    await worker.queue({ messages: [message] }, { APPS_SCRIPT_WEB_APP_URL: 'https://script.google.com/macros/s/test/exec', APPS_SCRIPT_HMAC_SECRET: 'test-secret' });
    assert.deepEqual(delivered, ['ack']);
  } finally { globalThis.fetch = original; }
});
