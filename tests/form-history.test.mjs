import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFormHistories } from '../public/form-maker/history-utils.js';

test('new form survives the ten item limit and output is newest first', () => {
  const stored = Array.from({ length: 10 }, (_, i) => ({ formId: `F${i}`, createdAt: `2026-01-${String(i + 1).padStart(2, '0')}` }));
  const result = mergeFormHistories(stored, [{ formId: 'NEW', createdAt: '2027-01-01' }]);
  assert.equal(result.length, 10);
  assert.equal(result[0].formId, 'NEW');
  assert.equal(result.some(form => form.formId === 'F0'), false);
});

test('duplicate form IDs use the newest updated record while preserving extra fields', () => {
  const result = mergeFormHistories(
    [{ formId: 'A', title: 'old', updatedAt: '2026-01-01', createdAt: '2026-01-01', legacy: true }],
    [{ formId: 'A', title: 'new', updatedAt: '2026-02-01', createdAt: '2026-01-01' }],
  );
  assert.equal(result[0].title, 'new');
  assert.equal(result[0].legacy, true);
});

test('unknown dates sort last and equal dates are stable by form ID', () => {
  const result = mergeFormHistories([], [
    { formId: 'Z', createdAt: '2026-01-01' },
    { formId: 'A', createdAt: '2026-01-01' },
    { formId: 'UNKNOWN' },
  ]);
  assert.deepEqual(result.map(form => form.formId), ['A', 'Z', 'UNKNOWN']);
});

test('invalid records are skipped and merging is idempotent', () => {
  const first = mergeFormHistories([], [null, {}, { formId: 'A', custom: 1 }]);
  assert.deepEqual(mergeFormHistories(first, first), first);
});
