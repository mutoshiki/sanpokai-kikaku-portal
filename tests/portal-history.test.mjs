import test from 'node:test';
import assert from 'node:assert/strict';
import * as portalHistory from '../src/portalHistory.js';

const {
  FORM_HISTORY_KEY,
  PROJECT_REGISTRY_KEY,
  getProjectDisambiguators,
  isRelevantPortalStorageKey,
  normalizePortalDate,
  persistProjectIndex,
  readFormIndex,
  readProjectIndex,
} = portalHistory;

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

test('keeps missing lastOpenedAt null and displays updatedAt', () => {
  const store = storage({
    [PROJECT_REGISTRY_KEY]: JSON.stringify({ projects: [
      { roomId: 'UPDATED', name: '更新だけ', updatedAt: 2000 },
      { roomId: 'MISSING', name: '日時なし' },
    ] }),
  });
  const result = readProjectIndex(store);
  const updated = result.projects.find(project => project.roomId === 'UPDATED');
  const missing = result.projects.find(project => project.roomId === 'MISSING');
  assert.equal(updated.lastOpenedAt, null);
  assert.equal(updated.updatedAt, 2000);
  assert.deepEqual(portalHistory.getProjectDisplayDate(updated), { timestamp: 2000, label: '更新日時' });
  assert.deepEqual(portalHistory.getProjectDisplayDate(missing), { timestamp: null, label: '日時不明' });
});

test('normalizes absent and non-positive portal timestamps', () => {
  for (const value of [null, undefined, '', '   ', 'bad date', 0, '0', -1, '-1', NaN, Infinity, 8.64e15 + 1, {}, { seconds: '' }, { seconds: 0 }, { _seconds: 0 }]) {
    assert.equal(normalizePortalDate(value), null, `expected ${String(value)} to be absent`);
  }
  assert.equal(normalizePortalDate(1), 1);
  assert.equal(normalizePortalDate('2000'), 2000);
  assert.equal(normalizePortalDate('1970-01-01T00:00:00.001Z'), 1);
  assert.equal(normalizePortalDate({ seconds: 2 }), 2000);
  assert.equal(normalizePortalDate({ _seconds: 3 }), 3000);
});

test('keeps same-name projects separate and orders undated projects last', () => {
  const store = storage({
    [PROJECT_REGISTRY_KEY]: JSON.stringify({ projects: [
      { roomId: 'TIED-B', name: '同じ名前', lastOpenedAt: 20 },
      { roomId: 'UNDATED-B', name: '日時なし' },
      { roomId: 'TIED-A', name: '同じ名前', lastOpenedAt: 20 },
      { roomId: 'UNDATED-A', name: '別の企画' },
      { roomId: 'OLDER', name: '古い企画', updatedAt: 10 },
    ] }),
  });
  const result = readProjectIndex(store);
  assert.deepEqual(result.projects.map(project => project.roomId), ['TIED-A', 'TIED-B', 'OLDER', 'UNDATED-A', 'UNDATED-B']);
  assert.equal(result.projects.filter(project => project.name === '同じ名前').length, 2);
});

test('disambiguates only same-name projects with the same displayed date and preserves inputs', () => {
  const stamp = Date.UTC(2026, 8, 29, 1, 5, 10);
  const projects = [
    { roomId: 'SAME-A', name: '秋名山企画', lastOpenedAt: stamp },
    { roomId: 'SAME-B', name: '秋名山企画', lastOpenedAt: stamp + 35_000 },
    { roomId: 'DIFFERENT-MINUTE', name: '秋名山企画', lastOpenedAt: stamp + 60_000 },
    { roomId: 'DIFFERENT-NAME', name: '別企画', lastOpenedAt: stamp },
    { roomId: 'UNDATED-A', name: '', updatedAt: null, lastOpenedAt: null },
    { roomId: 'UNDATED-B', name: '', updatedAt: null, lastOpenedAt: null },
    { roomId: 'LABEL-DIFF', name: '秋名山企画', updatedAt: stamp },
  ];
  const before = structuredClone(projects);
  const result = getProjectDisambiguators(projects);

  assert.deepEqual([...result.entries()], [
    ['SAME-A', '企画ID：SAME-A'],
    ['SAME-B', '企画ID：SAME-B'],
    ['UNDATED-A', '企画ID：UNDATED-A'],
    ['UNDATED-B', '企画ID：UNDATED-B'],
  ]);
  assert.deepEqual(projects, before);
});

test('sorts form history by creation time without rewriting storage', () => {
  const store = storage({
    [FORM_HISTORY_KEY]: JSON.stringify([
      { formId: 'OLD', createdAt: 100 },
      { formId: 'TIED-B', createdAt: 200, responseUrl: 'https://example.test/b' },
      { formId: 'UNDATED-B', title: '欠損' },
      { formId: 'TIED-A', createdAt: '200' },
      { formId: 'INVALID', createdAt: 'not-a-date' },
      { formId: 'UNDATED-A', createdAt: 0 },
      null,
    ]),
  });
  const result = readFormIndex(store);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.forms.map(form => form.formId), ['TIED-A', 'TIED-B', 'OLD', 'INVALID', 'UNDATED-A', 'UNDATED-B']);
  assert.deepEqual(result.forms.map(form => form.createdAt), [200, 200, 100, null, null, null]);
  assert.equal(result.forms[1].responseUrl, 'https://example.test/b');
  assert.equal(store.writes, 0);
});
