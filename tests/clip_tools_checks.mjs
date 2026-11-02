import assert from 'node:assert/strict';
import { createClipTools } from '../ui/clip-tools.js';

// Use take on a directed clip keeps its recipe and neighbour links; other clips still
// capture the take's workflow through workflow setup.
const media = frames => ({ id: 'm' + frames, kind: 'video', frames });
const state = {
  clips: [
    {
      id: 'transition',
      workflowVersion: 'v1',
      direction: { kind: 'transition', preset: 'smoke' },
      shotInputs: [
        { key: 'first', source: 'previous' },
        { key: 'last', source: 'next' },
      ],
      in: 1,
      out: 49,
      takeId: 'placeholder',
      takes: [
        { id: 'placeholder', placeholder: true, media: media(50) },
        { id: 'made', generated: true, number: 1, media: media(49), summary: { workflowVersion: 'v1' } },
        { id: 'older', generated: true, number: 2, media: media(49), summary: { workflowVersion: 'v0' } },
      ],
    },
  ],
};
const applied = [],
  setups = [];
const tools = createClipTools({
  getState: () => state,
  edits: {
    apply(label, fn) {
      applied.push(label);
      fn();
    },
  },
  getWorkflowSetup: () => ({
    start: async options => {
      setups.push(options.takeId);
    },
  }),
  getProductDefinitions: () => ({}),
  takeName: t => t.id,
  toast: message => assert.fail(message),
});
await tools.chooseTake('transition', 'made');
const c = state.clips[0];
assert.deepEqual(applied, ['Use take']);
assert.equal(c.takeId, 'made');
assert.deepEqual(
  c.shotInputs.map(s => s.source),
  ['previous', 'next'],
  'Links to the clips beside it stay',
);
assert.deepEqual(setups, [], 'No capture runs for the clip’s own take');
await tools.chooseTake('transition', 'older');
assert.deepEqual(setups, ['older'], 'A take from another recipe still goes through workflow setup');
// A draft-capable clip whose setup was adopted from a take: using its own draft keeps the
// recipe and drops the stale base, so Generate and Make final stay available.
state.clips.push({
  id: 'drafting',
  workflowVersion: 'v5',
  bindings: [{ key: 'draft', draft: true }],
  generationBase: { takeId: 'adopted' },
  in: 0,
  out: 49,
  takeId: 'adopted',
  takes: [
    { id: 'adopted', generated: true, number: 1, media: media(49), summary: { workflowVersion: 'v4' } },
    { id: 'draft', generated: true, number: 2, media: media(49), summary: { workflowVersion: 'v5', quality: 'draft' } },
  ],
});
await tools.chooseTake('drafting', 'draft');
const d = state.clips[1];
assert.equal(d.takeId, 'draft');
assert.equal(d.workflowVersion, 'v5');
assert.equal(d.generationBase, undefined, 'The stale take setup is cleared');
assert.deepEqual(setups, ['older'], 'Its own draft needs no capture');
console.log('clip tools checks passed');
