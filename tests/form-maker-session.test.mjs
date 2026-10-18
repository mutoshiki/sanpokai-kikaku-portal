import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createFormMakerSession } from '../src/services/form-maker-session.js';

const config = {
  apiKey: 'public-test-key',
  databaseURL: 'https://test.example.invalid',
};

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('prepares an anonymous session and submits one immutable queued request', async () => {
  const calls = [];
  const storage = memoryStorage();
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('accounts:signUp')) {
      return response({ localId: 'owner-uid', idToken: 'owner-id-token', refreshToken: 'refresh-token', expiresIn: '3600' });
    }
    if (String(url).includes('/formMakerV1/status.json')) {
      return response({ accepting: true, state: 'ready' });
    }
    if (String(url).includes('/formMakerV1/users/owner-uid/jobs/')) return response(null);
    if (String(url).includes('/formMakerV1/admission/slots/')) return response(null);
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = createFormMakerSession({ config, fetchImpl, storage });
  const input = {
    planName: 'テスト企画',
    editorEmail: 'tester@example.com',
    eventDate: '2026-10-20',
    deadline: '',
    description: '合成データ',
  };

  const readiness = await session.prepare();
  const job = await session.enqueue(input, { jobId: '0123456789abcdef0123456789abcdef' });

  assert.equal(readiness.accepting, true);
  assert.equal(job.state, 'queued');
  assert.match(job.handoffToken, /^h_[A-Za-z0-9_-]{48,160}$/);
  const reservationWrite = calls.find((call) => call.options.method === 'PUT' && call.url.includes('/admission/slots/'));
  assert.ok(reservationWrite, 'the client reserves one global admission slot before creating a job');
  assert.equal(reservationWrite.options.headers['if-match'], 'null_etag');
  const reservation = JSON.parse(reservationWrite.options.body);
  assert.equal(reservation.uid, 'owner-uid');
  assert.equal(reservation.jobId, '0123456789abcdef0123456789abcdef');
  assert.equal(reservation.kind, 'create');
  assert.match(reservation.requestHash, /^[a-f0-9]{64}$/);
  assert.equal(reservation.requestedAt > 0, true);

  const write = calls.find((call) => call.options.method === 'PUT' && call.url.includes('/jobs/'));
  assert.ok(write, 'the request is saved once to its owner job path');
  assert.match(write.url, /formMakerV1\/users\/owner-uid\/jobs\/0123456789abcdef0123456789abcdef\.json/);
  const payload = JSON.parse(write.options.body);
  const canonical = JSON.stringify(payload.input);
  assert.equal(payload.jobId, '0123456789abcdef0123456789abcdef');
  assert.equal(payload.admissionSlotId, reservationWrite.url.match(/slots\/(\d+)\.json/)?.[1]);
  assert.equal(payload.protocolVersion, 1);
  assert.equal(payload.inputHash, createHash('sha256').update(canonical).digest('hex'));
  assert.match(payload.input.handoffTokenHash, /^[a-f0-9]{64}$/);
  assert.equal(write.options.body.includes(job.handoffToken), false, 'the bearer capability itself never enters RTDB');
  assert.equal(session.getHandoffToken(payload.jobId), job.handoffToken);
  assert.equal(payload.state, 'queued');
  assert.equal('result' in payload, false);
  assert.equal('updatedAt' in payload, false);
  assert.ok(storage.getItem('sanpokai-form-maker-auth-v1'));
});

test('does not submit a request while the worker has paused intake', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('accounts:signUp')) {
      return response({ localId: 'owner-uid', idToken: 'owner-id-token', refreshToken: 'refresh-token', expiresIn: '3600' });
    }
    if (String(url).includes('/formMakerV1/status.json')) return response({ accepting: false, state: 'paused' });
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = createFormMakerSession({ config, fetchImpl, storage: memoryStorage() });

  await assert.rejects(session.enqueue({ planName: 'テスト', editorEmail: 'tester@example.com' }, {
    jobId: '0123456789abcdef0123456789abcdef',
  }), /受付を一時停止中/);
  assert.equal(calls.some((call) => call.options.method === 'PUT'), false);
});

test('does not create a job when all global admission slots are occupied', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('accounts:signUp')) {
      return response({ localId: 'owner-uid', idToken: 'owner-id-token', refreshToken: 'refresh-token', expiresIn: '3600' });
    }
    if (String(url).includes('/formMakerV1/status.json')) return response({ accepting: true, state: 'ready' });
    if (String(url).includes('/formMakerV1/users/owner-uid/jobs/')) return response(null);
    if (String(url).includes('/formMakerV1/admission/slots/')) return response({ error: { message: 'PERMISSION_DENIED' } }, 403);
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = createFormMakerSession({ config, fetchImpl, storage: memoryStorage() });

  await assert.rejects(session.enqueue({ planName: 'テスト', editorEmail: 'tester@example.com' }, {
    jobId: '0123456789abcdef0123456789abcdef',
  }), /受付枠を確保できません/);
  assert.equal(calls.filter((call) => call.options.method === 'PUT' && call.url.includes('/jobs/')).length, 0);
});

test('recovers the same reservation after an uncertain job write without changing its request time', async () => {
  const storage = memoryStorage();
  const calls = [];
  let clock = 100_000;
  let reservation = null;
  let jobWriteFailed = false;
  let reservationPutCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const urlText = String(url);
    calls.push({ url: urlText, options });
    if (urlText.includes('accounts:signUp')) {
      return response({ localId: 'owner-uid', idToken: 'owner-id-token', refreshToken: 'refresh-token', expiresIn: '3600' });
    }
    if (urlText.includes('/formMakerV1/status.json')) return response({ accepting: true, state: 'ready' });
    if (urlText.includes('/formMakerV1/users/owner-uid/jobs/')) {
      if (options.method === 'PUT' && !jobWriteFailed) {
        jobWriteFailed = true;
        return response({ error: { message: 'UNAVAILABLE' } }, 503);
      }
      return response(null);
    }
    if (urlText.includes('/formMakerV1/admission/slots/')) {
      if (options.method === 'PUT') {
        reservationPutCount += 1;
        if (reservationPutCount === 1) {
          reservation = JSON.parse(options.body);
          return response(null);
        }
        return response({ error: { message: 'PERMISSION_DENIED' } }, 403);
      }
      return response(reservation);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = createFormMakerSession({ config, fetchImpl, storage, now: () => clock });
  const input = { planName: 'テスト企画', editorEmail: 'tester@example.com' };
  const options = { jobId: '0123456789abcdef0123456789abcdef' };

  await assert.rejects(session.enqueue(input, options), /Firebase request failed/);
  clock += 1000;
  const recovered = await session.enqueue(input, options);

  assert.equal(recovered.state, 'queued');
  assert.equal(reservationPutCount, 2);
  assert.equal(reservation.requestedAt, 100_000);
  const writes = calls.filter(call => call.options.method === 'PUT' && call.url.includes('/jobs/'));
  const recoveredPayload = JSON.parse(writes.at(-1).options.body);
  const reservedSlotId = new URL(calls.find(call => call.options.method === 'PUT' && call.url.includes('/admission/slots/')).url).pathname.match(/slots\/(\d+)\.json/)?.[1];
  assert.equal(recoveredPayload.requestedAt, reservation.requestedAt);
  assert.equal(recoveredPayload.admissionSlotId, reservedSlotId);
});

test('test acceptance is limited to UIDs explicitly registered by the worker', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('accounts:signUp')) return response({ localId: 'other-uid', idToken: 'token', refreshToken: 'refresh', expiresIn: '3600' });
    if (String(url).includes('/formMakerV1/status.json')) return response({ accepting: true, state: 'ready', acceptanceMode: 'test' });
    if (String(url).includes('/formMakerV1/testOwners/other-uid.json')) return response(null);
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = createFormMakerSession({ config, fetchImpl, storage: memoryStorage() });

  const readiness = await session.prepare();
  assert.equal(readiness.acceptanceMode, 'test');
  assert.equal(readiness.testOwner, false);
  assert.equal(readiness.accepting, false);
  await assert.rejects(session.enqueue({ planName: '拒否される企画', editorEmail: 'tester@example.com' }, {
    jobId: '0123456789abcdef0123456789abcdef',
  }), /メンテナンス中/);
  assert.equal(calls.some(({ url, options }) => url.includes('/formMakerV1/') && ['PUT', 'PATCH', 'POST'].includes(options.method)), false);
});

test('test acceptance allows the registered UID to reserve and enqueue one job', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('accounts:signUp')) return response({ localId: 'test-owner', idToken: 'token', refreshToken: 'refresh', expiresIn: '3600' });
    if (String(url).includes('/formMakerV1/status.json')) return response({ accepting: true, state: 'ready', acceptanceMode: 'test' });
    if (String(url).includes('/formMakerV1/testOwners/test-owner.json')) return response(true);
    if (String(url).includes('/formMakerV1/users/test-owner/jobs/')) return response(null);
    if (String(url).includes('/formMakerV1/admission/slots/')) return response(null);
    throw new Error(`Unexpected request: ${url}`);
  };
  const session = createFormMakerSession({ config, fetchImpl, storage: memoryStorage() });

  const readiness = await session.prepare();
  const job = await session.enqueue({ planName: '合成企画', editorEmail: 'tester@example.com' }, {
    jobId: '0123456789abcdef0123456789abcdef',
  });
  assert.equal(readiness.acceptanceMode, 'test');
  assert.equal(readiness.testOwner, true);
  assert.equal(readiness.accepting, true);
  assert.equal(job.state, 'queued');
  assert.ok(calls.some(({ url, options }) => options.method === 'PUT' && url.includes('/admission/slots/')));
});

test('invalid acceptance modes and test-owner read failures fail closed', async (t) => {
  await t.test('invalid mode', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('accounts:signUp')) return response({ localId: 'owner', idToken: 'token', refreshToken: 'refresh', expiresIn: '3600' });
      if (String(url).includes('/formMakerV1/status.json')) return response({ accepting: true, acceptanceMode: 'staging' });
      throw new Error(`Unexpected request: ${url}`);
    };
    const session = createFormMakerSession({ config, fetchImpl, storage: memoryStorage() });
    await assert.rejects(session.prepare(), /受付状況を確認できません/);
  });

  await t.test('test owner read denied', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('accounts:signUp')) return response({ localId: 'owner', idToken: 'token', refreshToken: 'refresh', expiresIn: '3600' });
      if (String(url).includes('/formMakerV1/status.json')) return response({ accepting: true, acceptanceMode: 'test' });
      if (String(url).includes('/formMakerV1/testOwners/owner.json')) return response({ error: { message: 'PERMISSION_DENIED' } }, 403);
      throw new Error(`Unexpected request: ${url}`);
    };
    const session = createFormMakerSession({ config, fetchImpl, storage: memoryStorage() });
    await assert.rejects(session.prepare(), /受付状況を確認できません/);
  });
});
