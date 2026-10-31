import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverProjectJob } from '../src/project-job-recovery.js';

test('recovery checks the same job first and never enqueues when it already exists', async () => {
  const calls = [];
  const result = await recoverProjectJob({
    session: { getJob: async id => { calls.push(['get', id]); return { state: 'running' }; }, enqueue: async () => calls.push(['enqueue']) },
    jobId: 'a'.repeat(32), project: { roomId: 'ROOM-A' }, input: {},
    createProjectLink: async () => calls.push(['reserve']),
  });
  assert.equal(result.resumed, false);
  assert.equal(result.job.state, 'running');
  assert.deepEqual(calls, [['get', 'a'.repeat(32)]]);
});

test('recovery reuses the reserved room and job only after a lookup confirms no job exists', async () => {
  const calls = [];
  const jobId = 'b'.repeat(32);
  const result = await recoverProjectJob({
    session: {
      getJob: async id => { calls.push(['get', id]); return null; },
      enqueue: async (input, options) => { calls.push(['enqueue', input, options]); return { state: 'queued', handoffToken: 'h_token' }; },
    },
    jobId, project: { roomId: 'ROOM-A' }, input: { planName: '秋名山企画' },
    createProjectLink: async () => { calls.push(['reserve']); return { roomId: 'ROOM-A', jobId, token: 'target-capability' }; },
    onHandoffReady: value => calls.push(['handoff', value]),
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(calls.map(call => call[0]), ['get', 'reserve', 'enqueue', 'handoff']);
  assert.deepEqual(calls[2][2], { jobId });
  assert.equal(calls[2][1].targetRoomId, 'ROOM-A');
  assert.equal(calls[2][1].targetRoomJobId, jobId);
  assert.equal(calls[3][1].jobId, jobId);
});

test('recovery rejects a reservation for another room or job before enqueue', async () => {
  let enqueued = false;
  await assert.rejects(recoverProjectJob({
    session: { getJob: async () => null, enqueue: async () => { enqueued = true; } },
    jobId: 'c'.repeat(32), project: { roomId: 'ROOM-A' }, input: {},
    createProjectLink: async () => ({ roomId: 'ROOM-B', jobId: 'd'.repeat(32), token: 'secret' }),
  }), /同じ企画・依頼/);
  assert.equal(enqueued, false);
});
