import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectFormLinks } from '../src/form-maker-project-links.js';

test('project link panel exposes only the public URL and owner links for the same current form', () => {
  assert.deepEqual(resolveProjectFormLinks(
    { linked: true, formUrl: 'https://docs.google.com/forms/d/e/current/viewform', responseCount: 3 },
    { formUrl: 'https://docs.google.com/forms/d/e/current/viewform', editUrl: 'https://docs.google.com/forms/d/current/edit', responseSheetUrl: 'https://docs.google.com/spreadsheets/d/current' },
  ), {
    formUrl: 'https://docs.google.com/forms/d/e/current/viewform',
    linked: true,
    responseCount: 3,
    editUrl: 'https://docs.google.com/forms/d/current/edit',
    responseSheetUrl: 'https://docs.google.com/spreadsheets/d/current',
  });
});

test('project link panel never shows owner links when a cached result belongs to another form', () => {
  assert.deepEqual(resolveProjectFormLinks(
    { formUrl: 'https://docs.google.com/forms/d/e/current/viewform', responseCount: 0 },
    { formUrl: 'https://docs.google.com/forms/d/e/other/viewform', editUrl: 'https://docs.google.com/forms/d/other/edit', responseSheetUrl: 'https://docs.google.com/spreadsheets/d/other' },
  ), {
    formUrl: 'https://docs.google.com/forms/d/e/current/viewform', linked: false, responseCount: 0, editUrl: '', responseSheetUrl: '',
  });
});

test('project link panel rejects non-Google or non-HTTPS URLs', () => {
  assert.deepEqual(resolveProjectFormLinks({ formUrl: 'javascript:alert(1)', responseCount: 1 }, null), {
    formUrl: '', linked: false, responseCount: 1, editUrl: '', responseSheetUrl: '',
  });
});

test('project link panel rejects edit URLs as public response links', () => {
  assert.deepEqual(resolveProjectFormLinks({ linked: true, formUrl: 'https://docs.google.com/forms/d/example/edit', responseCount: 0 }, null), {
    formUrl: '', linked: true, responseCount: 0, editUrl: '', responseSheetUrl: '',
  });
});
