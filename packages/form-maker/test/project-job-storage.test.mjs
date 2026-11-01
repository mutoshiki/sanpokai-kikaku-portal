import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectJobStorage, formMakerProjectStorageKey, migrateLegacyPendingJob } from '../src/project-job-storage.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('project input and pending job are isolated by room', () => {
  const storage = memoryStorage();
  const a = createProjectJobStorage({ storage, roomId: 'ROOM-A_123' });
  const b = createProjectJobStorage({ storage, roomId: 'ROOM-B_123' });

  a.writeInput({ planName: 'A企画' });
  a.writePendingJob({ jobId: 'a'.repeat(32), state: 'queued' });

  assert.deepEqual(a.readInput(), { planName: 'A企画' });
  assert.equal(a.readPendingJob().jobId, 'a'.repeat(32));
  assert.deepEqual(b.readInput(), null);
  assert.equal(b.readPendingJob(), null);
  const afterReload = createProjectJobStorage({ storage, roomId: 'ROOM-A_123' });
  assert.deepEqual(afterReload.readPendingJob(), a.readPendingJob());
  assert.match(formMakerProjectStorageKey('ROOM-A_123', 'input'), /ROOM-A_123/);
});

test('invalid room ids and malformed pending records are ignored', () => {
  const storage = memoryStorage();
  assert.throws(() => createProjectJobStorage({ storage, roomId: '../ROOM' }), /room/i);
  const scoped = createProjectJobStorage({ storage, roomId: 'ROOM-A_123' });
  storage.setItem(formMakerProjectStorageKey('ROOM-A_123', 'pending'), JSON.stringify({ jobId: 'bad' }));
  assert.equal(scoped.readPendingJob(), null);
});

test('capability tokens are never included in the saved form input', () => {
  const storage = memoryStorage();
  const scoped = createProjectJobStorage({ storage, roomId: 'ROOM-A_123' });
  scoped.writeInput({ planName: 'A企画', targetRoomCapability: 'sensitive-token', targetRoomId: 'ROOM-A_123' });
  assert.deepEqual(scoped.readInput(), { planName: 'A企画' });
  assert.doesNotMatch(storage.getItem(formMakerProjectStorageKey('ROOM-A_123', 'input')), /sensitive-token|targetRoomCapability/);
});

test('storage failures are reported without throwing', () => {
  const scoped = createProjectJobStorage({ storage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } }, roomId: 'ROOM-A_123' });
  assert.deepEqual(scoped.readInput(), null);
  assert.equal(scoped.writeInput({ planName: 'A企画' }), false);
  assert.equal(scoped.writePendingJob({ jobId: 'a'.repeat(32), state: 'queued' }), false);
});

test('a browser storage getter that throws is treated as unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    const scoped = createProjectJobStorage({ roomId: 'ROOM-A_123' });
    assert.equal(scoped.writeInput({ planName: 'A企画' }), false);
    assert.deepEqual(scoped.readInput(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('legacy pending job migrates only when it matches the room reservation', () => {
  const storage = memoryStorage();
  const legacy = memoryStorage();
  legacy.setItem('sanpokai-form-maker-pending-job-v1', 'a'.repeat(32));
  const room = createProjectJobStorage({ storage, roomId: 'ROOM-A_123' });

  assert.equal(migrateLegacyPendingJob({ roomStorage: room, projectJobId: 'b'.repeat(32), legacyStorage: legacy }), false);
  assert.equal(legacy.getItem('sanpokai-form-maker-pending-job-v1'), 'a'.repeat(32));
  assert.equal(migrateLegacyPendingJob({ roomStorage: room, projectJobId: 'a'.repeat(32), legacyStorage: legacy }), true);
  assert.equal(room.readPendingJob().jobId, 'a'.repeat(32));
  assert.equal(legacy.getItem('sanpokai-form-maker-pending-job-v1'), null);
});
