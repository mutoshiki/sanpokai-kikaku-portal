import assert from 'node:assert/strict';
import test from 'node:test';
import { readFormMakerProjectLink } from '../src/services/form-maker-project-link.js';

function href(payload) {
  return `https://example.test/form-maker/#sanpo-form-link=${encodeURIComponent(JSON.stringify(payload))}`;
}

test('reads a valid existing-project handoff and removes its one-time capability from browser history', () => {
  const writes = [];
  const payload = { version: 1, roomId: 'ROOM1234', jobId: 'a'.repeat(32), token: `h_${'b'.repeat(64)}`, projectName: '山歩会企画', eventDate: '2026-11-02' };
  const result = readFormMakerProjectLink({ href: href(payload), history: { state: null, replaceState: (...args) => writes.push(args) } });
  assert.deepEqual(result, { ...payload });
  assert.equal(writes.length, 1);
  assert.equal(new URL(writes[0][2]).hash, '');
  assert.equal(readFormMakerProjectLink({ href: href(payload), history: null }), result, 'StrictMode double invocation must retain the one-time handoff in memory');
});

test('rejects malformed project IDs, job IDs, capabilities, and dates', () => {
  const base = { version: 1, roomId: 'ROOM1234', jobId: 'a'.repeat(32), token: `h_${'b'.repeat(64)}`, projectName: '山歩会企画', eventDate: '2026-11-02' };
  for (const patch of [{ roomId: 'x' }, { jobId: 'not-a-job' }, { token: 'secret' }, { eventDate: '2026-02-30' }]) {
    assert.equal(readFormMakerProjectLink({ href: href({ ...base, ...patch }), history: null }), null);
  }
});

test('clears malformed one-time handoff fragments from browser history', () => {
  const writes = [];
  const result = readFormMakerProjectLink({ href: 'https://example.test/form-maker/#sanpo-form-link=%7Bbad-json', history: { state: null, replaceState: (...args) => writes.push(args) } });
  assert.equal(result, null);
  assert.equal(writes.length, 1);
  assert.equal(new URL(writes[0][2]).hash, '');
});
