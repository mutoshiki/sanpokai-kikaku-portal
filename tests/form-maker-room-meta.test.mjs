import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps-script/form-maker-worker/Code.js', import.meta.url), 'utf8');

test('worker manifest preserves the web app entry point on version updates', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../apps-script/form-maker-worker/appsscript.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.webapp, { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' });
});

function loadWorker(overrides = {}) {
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Number,
    String,
    Array,
    Utilities: { getUuid: () => 'uuid' },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'Code.js' });
  Object.assign(sandbox, overrides);
  return sandbox;
}

function validRoom(meta) {
  const room = { schemaVersion: 6, allocations: { car: {}, team: {} } };
  if (meta !== undefined) room.meta = meta;
  return room;
}

test('room with Firebase-pruned empty meta remains valid for existing-project checks', () => {
  const worker = loadWorker({ firebaseGetJson_: () => ({ value: validRoom(), etag: 'room-etag' }) });

  assert.equal(worker.isManagedProjectRoomValid_(validRoom()), true);
  assert.equal(worker.formMakerCheckExistingProjectRoom_({ projectId: 'ROOM1234' }, 'token').state, 'ready');
});

test('room-link claim accepts missing meta while retaining one-time reservation validation', () => {
  const calls = [];
  const job = {
    protocolVersion: 2,
    jobId: 'a'.repeat(32),
    workerIdToken: 'token',
    input: {
      targetRoomId: 'ROOM1234',
      targetRoomCapabilityHash: 'b'.repeat(64),
      handoffTokenHash: 'c'.repeat(64),
    },
  };
  const link = {
    schemaVersion: 1,
    jobId: job.jobId,
    tokenHash: job.input.targetRoomCapabilityHash,
    state: 'pending',
    requestedAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000,
  };
  const worker = loadWorker({
    formMakerWorkerRequest_: (method, path, options = {}) => {
      calls.push({ method, path, options });
      if (path === 'rooms/ROOM1234') return { value: validRoom(), etag: 'room-etag' };
      if (path === 'projectFormLinksV1/ROOM1234') return { value: link, etag: 'link-etag' };
      return { value: null, etag: '' };
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(worker.formMakerClaimProjectRoomLink_(job))), {
    roomId: 'ROOM1234',
    alreadyProcessing: false,
  });
  assert.equal(calls.some(call => call.method === 'put' && call.path === 'projectFormLinksV1/ROOM1234'), true);
});

test('linked application snapshot can create the missing metadata leaf conditionally', () => {
  const calls = [];
  const metadata = {
    projectId: 'ROOM1234',
    projectLinkJobId: 'a'.repeat(32),
    projectLinkCapabilityHash: 'b'.repeat(64),
    handoffTokenHash: 'c'.repeat(64),
  };
  const link = {
    jobId: metadata.projectLinkJobId,
    tokenHash: metadata.projectLinkCapabilityHash,
    state: 'processing',
  };
  const worker = loadWorker({
    formMakerWorkerRequest_: (method, path, options = {}) => {
      calls.push({ method, path, options });
      if (method === 'get' && path === 'projectFormLinksV1/ROOM1234') return { value: link, etag: 'link-etag' };
      if (method === 'put' && path === 'rooms/ROOM1234/meta/applicationSync') return { value: options.body, etag: 'sync-etag' };
      throw new Error(`Unexpected worker request: ${method} ${path}`);
    },
    firebaseGetJson_: path => {
      if (path === 'rooms/ROOM1234') return { value: validRoom(), etag: 'room-etag' };
      if (path === 'rooms/ROOM1234/meta/applicationSync') return { value: null, etag: 'null_etag' };
      throw new Error(`Unexpected Firebase read: ${path}`);
    },
  });

  const applicationSync = { kind: 'formApplicationSync', version: 2, projectId: 'ROOM1234', handoffTokenHash: metadata.handoffTokenHash };
  assert.doesNotThrow(() => worker.formMakerWriteLinkedApplicationSnapshot_(metadata, applicationSync, 'token'));
  const write = calls.find(call => call.method === 'put' && call.path === 'rooms/ROOM1234/meta/applicationSync');
  assert.ok(write);
  assert.equal(write.options.headers['if-match'], 'null_etag');
  assert.equal(JSON.stringify(write.options.body), JSON.stringify(applicationSync));
});

test('malformed metadata and foreign sync links remain invalid or conflicting', () => {
  assert.equal(loadWorker().isManagedProjectRoomValid_(validRoom('invalid')), false);
  const foreignLinkedRoom = validRoom({ applicationSync: { projectId: 'OTHER123' } });
  const worker = loadWorker({ firebaseGetJson_: () => ({ value: foreignLinkedRoom, etag: 'room-etag' }) });

  assert.equal(worker.formMakerCheckExistingProjectRoom_({ projectId: 'ROOM1234', handoffTokenHash: 'expected' }, 'token').state, 'conflict');
});
