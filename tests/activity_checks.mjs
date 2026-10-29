import assert from 'node:assert/strict';
import { activityEntry } from '../ui/activity.js';

const state = {
    clips: [{ id: 'clip', name: 'c11' }],
    jobs: [{ id: 'a14', clipId: 'clip', takeNumber: 14 }],
  },
  read = (kind, data) => activityEntry({ cursor: 1, kind, data, created: 0 }, state);

assert.deepEqual(read('attempt.status', { attemptId: 'a14', status: 'failed', error: 'API key refused' }), {
  tone: 'problem',
  title: 'Generation failed',
  subject: 'c11 · Take 14',
  detail: 'API key refused',
});
assert.equal(read('attempt.status', { attemptId: 'a14', status: 'running' }).title, 'Generating');
assert.equal(read('attempt.status', { attemptId: 'a14', status: 'complete' }).tone, 'done');
assert.equal(read('attempt.status', { attemptId: 'gone', status: 'queued' }).subject, 'A take');
assert.equal(read('queue.accepted', { attemptIds: ['a', 'b'], actor: 'human' }).title, 'Queued 2 takes');
assert.equal(read('queue.accepted', { attemptIds: ['a'], actor: 'codex' }).title, 'Queued 1 take by codex');
assert.equal(read('submission.acknowledged', { attemptId: 'a14', jobId: 'j1' }).detail, 'Job j1');
assert.equal(read('receipt.rejected', { attemptId: 'a14', error: 'bad file' }).tone, 'problem');
assert.equal(read('graph.handoff', { clipId: 'clip', action: 'open' }).subject, 'c11');
assert.deepEqual(
  [read('command.set_execution', { actor: 'codex', arguments: { clipId: 'clip' } })].map(e => [e.title, e.subject]),
  [['Set execution by codex', 'c11']],
);
assert.equal(read('something.new', {}).title, 'something new');
console.log('Activity reads events as sentences with their clip and take');
