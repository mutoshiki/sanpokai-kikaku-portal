import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormMakerSession } from '../src/form-maker-session.js';

function createStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('notifies the fast worker after the Firebase job is accepted with only its ID', async () => {
  const order = [];
  let captured;
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('accounts:signUp')) {
      return Response.json({ localId: 'user_123', idToken: 'firebase-token', refreshToken: 'refresh-token', expiresIn: '3600' });
    }
    if (href.includes('/formMakerV1/status.json')) return Response.json({ accepting: true, acceptanceMode: 'open' });
    if (href.includes('/formMakerV1/users/user_123/jobs/job_1234567890123456.json')) {
      if (options.method === 'PUT') {
        order.push('firebase-write');
        return Response.json({ name: 'job_1234567890123456' });
      }
      return Response.json(null);
    }
    if (href.includes('/formMakerV1/admission/slots/')) return Response.json({ name: 'reserved' });
    if (href === 'https://worker.example/v1/form-creation-jobs') {
      order.push('worker-notify');
      captured = { headers: options.headers, body: JSON.parse(options.body) };
      return Response.json({ jobId: captured.body.jobId, state: 'queued' }, { status: 202 });
    }
    throw new Error(`unexpected request ${href}`);
  };
  const session = createFormMakerSession({
    config: { apiKey: 'public-key', databaseURL: 'https://database.example', intakeUrl: 'https://worker.example/v1/form-creation-jobs' },
    fetchImpl,
    storage: createStorage(),
    cryptoApi: globalThis.crypto,
    now: () => 1_800_000_000_000,
  });
  const accepted = await session.enqueue({ planName: '秋の登山企画', editorEmail: 'editor@example.com' }, { jobId: 'job_1234567890123456' });
  assert.equal(accepted.state, 'queued');
  assert.deepEqual(order, ['firebase-write', 'worker-notify']);
  assert.deepEqual(captured.body, { jobId: 'job_1234567890123456' });
  assert.equal(captured.headers.Authorization, 'Bearer firebase-token');
});

test('keeps Firebase acceptance successful when the fast notification is unavailable', async () => {
  const storage = createStorage();
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('accounts:signUp')) return Response.json({ localId: 'user_123', idToken: 'firebase-token', refreshToken: 'refresh-token', expiresIn: '3600' });
    if (href.includes('/formMakerV1/status.json')) return Response.json({ accepting: true, acceptanceMode: 'open' });
    if (href.includes('/formMakerV1/users/user_123/jobs/job_1234567890123456.json') && options.method === 'PUT') return Response.json({ name: 'job' });
    if (href.includes('/formMakerV1/users/user_123/jobs/job_1234567890123456.json')) return Response.json(null);
    if (href.includes('/formMakerV1/admission/slots/')) return Response.json({ name: 'reserved' });
    if (href.startsWith('https://worker.example/')) throw new Error('worker unavailable');
    throw new Error(`unexpected request ${href}`);
  };
  const session = createFormMakerSession({
    config: { apiKey: 'public-key', databaseURL: 'https://database.example', intakeUrl: 'https://worker.example/v1/form-creation-jobs' }, fetchImpl, storage, cryptoApi: globalThis.crypto, now: () => 1_800_000_000_000,
  });
  const accepted = await session.enqueue({ planName: '秋の登山企画', editorEmail: 'editor@example.com' }, { jobId: 'job_1234567890123456' });
  assert.equal(accepted.state, 'queued');
});
