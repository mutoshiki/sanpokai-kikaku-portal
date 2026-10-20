import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFormMakerJobs, projectUrlWithHandoffCapability, writeCachedFormMakerHistory } from '../src/services/form-maker-history.js';

test('portal history contains only worker-confirmed forms and keeps local legacy entries', () => {
  const local = [{ formId: 'OLD', planName: '旧企画', spreadsheetUrl: 'https://example.test/legacy', createdAt: '2026-10-01T00:00:00.000Z' }];
  const jobs = [
    { jobId: 'queued', state: 'queued', requestedAt: 40, input: { planName: '待機中' } },
    { jobId: 'finished', state: 'completed', requestedAt: 30, input: { planName: '新企画' }, result: {
      formId: 'NEW', formUrl: 'https://docs.google.com/forms/d/NEW/viewform', editUrl: 'https://docs.google.com/forms/d/NEW/edit',
      projectId: 'ROOM-NEW', projectUrl: 'https://mutoshiki.github.io/circle-kikaku-tools/?room=ROOM-NEW',
      responseSheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET-NEW', createdAt: 1792000000000,
    } },
    { jobId: 'partial-no-form', state: 'partial', requestedAt: 10, input: { planName: '未作成' }, result: { projectId: 'ROOM' } },
  ];

  const merged = mergeFormMakerJobs(local, jobs);

  assert.deepEqual(merged.map((form) => form.formId), ['NEW', 'OLD']);
  assert.equal(merged[0].projectUrl, 'https://mutoshiki.github.io/circle-kikaku-tools/?room=ROOM-NEW');
  assert.equal(merged[0].jobId, 'finished');
  assert.equal(projectUrlWithHandoffCapability(merged[0].projectUrl, 'h_012345678901234567890123456789012345678901234567'), 'https://mutoshiki.github.io/circle-kikaku-tools/?room=ROOM-NEW&handoff=h_012345678901234567890123456789012345678901234567');
  assert.equal(merged[0].projectUrl.includes('handoff='), false, 'cached history must never include the bearer capability');
  assert.equal(merged[0].responseUrl, 'https://docs.google.com/forms/d/NEW/viewform');
  assert.equal(merged[0].responseSheetUrl, 'https://docs.google.com/spreadsheets/d/SHEET-NEW');
  assert.equal(merged[1].spreadsheetUrl, 'https://example.test/legacy');
  assert.equal(merged[1].createdAt, Date.parse('2026-10-01T00:00:00.000Z'));
});

test('project link leaves legacy URL untouched when no valid local capability exists', () => {
  const projectUrl = 'https://mutoshiki.github.io/circle-kikaku-tools/?room=ROOM-OLD&handoff=legacy-token';
  assert.equal(projectUrlWithHandoffCapability(projectUrl, ''), projectUrl);
  assert.equal(projectUrlWithHandoffCapability(projectUrl, 'bad token'), projectUrl);
});

test('history cache write returns false when the default storage getter is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage disabled'); } });
  try {
    assert.equal(writeCachedFormMakerHistory([]), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
