import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialFormMakerInput } from '../src/form-maker-input.js';
import { canonicalInput } from '../src/form-maker-session.js';

test('project context initializes only editable form fields before link reservation', () => {
  const project = { roomId: 'ROOM-A', projectName: '秋名山企画', eventDate: '2026-11-02' };
  const input = createInitialFormMakerInput({
    project,
    savedInput: { editorEmail: 'editor@example.test', description: '集合場所は駅前です。' },
  });

  assert.deepEqual(input, {
    planName: '秋名山企画',
    editorEmail: 'editor@example.test',
    eventDate: '2026-11-02',
    deadline: '',
    description: '集合場所は駅前です。',
  });
  assert.deepEqual(canonicalInput(input), input);
});

test('sample input stays editable and excludes project capability fields', () => {
  const input = createInitialFormMakerInput({
    project: {
      roomId: 'DEBUG-ROOM',
      projectName: 'サンプル企画',
      eventDate: '2026-11-02',
      sampleInput: { editorEmail: 'sample@example.invalid', deadline: '2026-10-31' },
    },
  });

  assert.equal(input.planName, 'サンプル企画');
  assert.equal(input.editorEmail, 'sample@example.invalid');
  assert.equal('targetRoomId' in input, false);
  assert.equal('targetRoomJobId' in input, false);
  assert.equal('targetRoomCapability' in input, false);
});
