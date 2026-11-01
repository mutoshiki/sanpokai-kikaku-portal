import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowProjectToolLink } from '../src/project-tool-link-visibility.js';

test('project-tool links stay available in the standalone maker', () => {
  assert.equal(shouldShowProjectToolLink(null), true);
  assert.equal(shouldShowProjectToolLink({}), true);
});

test('embedded maker omits the link back to its already-open project', () => {
  assert.equal(shouldShowProjectToolLink({ roomId: 'ROOM-1' }), false);
});
