import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRelevantPortalStorageKey,
  normalizePortalDate,
  persistProjectIndex,
  readFormIndex,
  readProjectIndex,
} from '../src/portalHistory.js';

function storage(values = {}) {
  const data = new Map(Object.entries(values));
  let writes = 0;
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { writes += 1; data.set(key, String(value)); },
    key(index) { return [...data.keys()][index] ?? null; },
    get length() { return data.size; },
    get writes() { return writes; },
  };
}

test('reads current React rooms and legacy rooms once, preferring fresh names and timestamps', () => {
  const store = storage({
    'sanpo-react:v1:ROOM%2FA:room': JSON.stringify({ roomName: '最新名', lastUpdatedAt: 2000 }),
    'sampokai_v10_split_ROOM/A': JSON.stringify({ roomName: '旧名', lastUpdatedAt: 1000 }),
    'syawari_history_ROOM/A': JSON.stringify([{ time: 3000, data: { roomName: '履歴名', lastUpdatedAt: 1500 } }]),
    'syawari_last_opened_at_ROOM/A': '4000',
  });
  const result = readProjectIndex(store);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.projects, [{ roomId: 'ROOM/A', name: '最新名', updatedAt: 2000, lastOpenedAt: 4000 }]);
  assert.equal(store.writes, 0);
});

test('corrupt entries yield a partial index without dropping valid projects', () => {
  const store = storage({
    'sanpo-react:v1:GOOD:room': JSON.stringify({ roomName: '正常', lastUpdatedAt: 1e20 }),
    'sanpo-react:v1:BROKEN:room': '{',
  });
  const result = readProjectIndex(store);
  assert.equal(result.status, 'partial');
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].name, '正常');
  assert.equal(normalizePortalDate(1e20), null);
});

test('project and form read failures stay independent', () => {
  const store = storage({ 'sanpokai-form-builder-history-v1': '{' });
  assert.equal(readProjectIndex(store).status, 'empty');
  assert.equal(readFormIndex(store).status, 'unavailable');
});

test('valid empty form history is empty and a partially invalid array is partial', () => {
  assert.equal(readFormIndex(storage({ 'sanpokai-form-builder-history-v1': '[]' })).status, 'empty');
  const result = readFormIndex(storage({ 'sanpokai-form-builder-history-v1': '[{"formId":"A"},null]' }));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.forms.map(form => form.formId), ['A']);
});

test('unavailable storage returns a truthful unavailable state', () => {
  const denied = { get length() { throw new Error('denied'); }, getItem() { throw new Error('denied'); } };
  assert.equal(readProjectIndex(denied).status, 'unavailable');
  assert.equal(readFormIndex(denied).status, 'unavailable');
});

test('persist writes only when normalized project contents change', () => {
  const store = storage();
  const projects = [{ roomId: 'A', name: '企画', updatedAt: 3, lastOpenedAt: 4 }];
  assert.equal(persistProjectIndex(store, projects).ok, true);
  assert.equal(persistProjectIndex(store, projects).ok, true);
  assert.equal(store.writes, 1);
});

test('storage filtering includes producer keys and ignores unrelated keys', () => {
  assert.equal(isRelevantPortalStorageKey('sanpo-react:v1:A:room'), true);
  assert.equal(isRelevantPortalStorageKey('sanpokai-form-builder-history-v1'), true);
  assert.equal(isRelevantPortalStorageKey('sanpokai_portal_project_history_v1'), true);
  assert.equal(isRelevantPortalStorageKey('random-key'), false);
});
