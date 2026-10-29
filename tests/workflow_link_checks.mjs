import assert from 'node:assert/strict';
import { createWorkflowLinks } from '../web/workflow-link.js';
const checks = [],
  check = (label, value) => {
    assert.ok(value, label);
    checks.push(label);
  };
const records = new Map(),
  storage = { getItem: k => records.get(k), setItem: (k, v) => records.set(k, v) };
const manager = { openWorkflows: [], activeWorkflow: null },
  app = {
    extensionManager: { workflow: manager, spinner: false },
    loadGraphData: async (graph, _a, _b, w) => {
      manager.activeWorkflow = w;
      w.changeTracker.activeState = graph;
      return true;
    },
  };
let loads = 0,
  captures = 0,
  release = null;
const load = async () => {
  loads++;
  if (release) await release;
  const w = { path: 'tab-' + loads, changeTracker: { activeState: { value: 'initial' } } };
  manager.openWorkflows.push(w);
  manager.activeWorkflow = w;
  return { opened: true };
};
const capture = async () => {
  captures++;
  return {
    prompt: { value: manager.activeWorkflow.changeTracker.activeState.value },
    provenance: { source: 'test serializer' },
  };
};
const links = createWorkflowLinks(app, load, capture, storage),
  link = { projectId: 'p', clipId: 'shot', sourceKey: 'v1' },
  data = { link, name: 'Test clip' };
await links.open(data);
check(
  'The active linked tab exposes its clip context',
  links.current().name === 'Test clip' && links.current().link === link,
);
const first = manager.activeWorkflow;
first.changeTracker.activeState.value = 'unsaved edit';
const other = { path: 'other', changeTracker: { activeState: { value: 'other image' } } };
manager.openWorkflows.push(other);
manager.activeWorkflow = other;
check('An unrelated tab has no Apply context', !links.current());
await assert.rejects(links.capture(data), /different Comfy workflow/);
check('A different active workflow cannot be applied to a linked clip', captures === 0);
const graphLoader = app.loadGraphData;
app.loadGraphData = async (...args) => {
  await graphLoader(...args);
};
const focused = await links.open(data);
check(
  'Opening a linked clip focuses its existing workflow when an extension drops the loader return value',
  focused.reused && manager.activeWorkflow === first && loads === 1,
);
app.loadGraphData = graphLoader;
const result = await links.capture(data);
check(
  'Focusing preserves unsaved graph edits and exact clip identity',
  result.prompt.value === 'unsaved edit' && result.provenance.spoolLink.clipId === 'shot',
);
await assert.rejects(links.capture({ link: { ...link, sourceKey: 'changed' } }), /changed in Spool/);
check('Changed Spool settings reject an old linked capture', captures === 1);
const next = { ...link, sourceKey: 'v2' };
check('Applied version acknowledgment updates the existing link', links.applied({ previous: link, next }).linked);
await links.open({ link: next });
check('Applying then reopening does not create another workflow', loads === 1);
const restored = createWorkflowLinks(app, load, capture, storage);
await restored.open({ link: next });
check('Restored links reuse the persisted workflow path', loads === 1);
await links.open({ link: { ...link, sourceKey: 'v3' } });
check(
  'Changed setup opens a new workflow without replacing old edits',
  loads === 2 && first.changeTracker.activeState.value === 'unsaved edit',
);
await links.open({ link: { ...link, projectId: 'another-project', sourceKey: 'v3' } });
check('Projects with the same clip id have separate workflow links', loads === 3);
manager.openWorkflows = manager.openWorkflows.filter(w => w !== manager.activeWorkflow);
await links.open({ link: { ...link, projectId: 'another-project', sourceKey: 'v3' } });
check('A closed workflow can be reopened safely', loads === 4);
release = new Promise(r => (globalThis.finish = r));
const opening = links.open({ link: { ...link, clipId: 'pending' } }),
  same = links.open({ link: { ...link, clipId: 'pending' } });
await assert.rejects(links.open({ link: { ...link, clipId: 'different' } }), /Finish opening/);
await assert.rejects(links.capture(data), /Finish opening/);
globalThis.finish();
await Promise.all([opening, same]);
check('Concurrent repeated open shares one operation and blocks unrelated graph actions', loads === 5);
check(
  'An acknowledgment for an obsolete setup cannot replace a new link',
  !links.applied({ previous: link, next }).linked,
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
