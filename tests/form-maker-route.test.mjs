import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the production form-maker route is a same-origin app, not an Apps Script iframe', async () => {
  const html = await readFile(new URL('../dist/form-maker/index.html', import.meta.url), 'utf8');

  assert.match(html, /山歩会フォームメーカー/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.match(html, /assets\/.*\.js/);
});
