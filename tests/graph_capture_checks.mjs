import assert from 'node:assert/strict';
import { captureComfyGraph } from '../web/graph-capture.js';

const checks = [],
  check = (label, value) => {
    assert.ok(value, label);
    checks.push(label);
  };
const stats = { system: { comfy_package_versions: [{ name: 'comfyui-frontend-package', installed: 'test' }] } };
const originalFetch = globalThis.fetch;
const metadata = async path => ({ json: async () => (path === '/system_stats' ? stats : {}) });
function fixture() {
  const data = {
    nodes: [
      {
        id: 1,
        type: 'Source',
        pos: [0, 0],
        size: [100, 100],
        order: 0,
        mode: 0,
        properties: {},
        widgets_values: ['first'],
      },
    ],
    links: [],
    extra: { ds: { scale: 1 } },
    definitions: { subgraphs: [{ nodes: [{ id: 2, type: 'Nested', widgets_values: ['nested'] }], links: [] }] },
  };
  const graph = {
    id: 'graph',
    nodes: [],
    getNodeById: () => null,
    serialize: () => structuredClone(data),
    computeExecutionOrder: () => {},
  };
  const workflow = { filename: 'Clip.json', path: 'clip' },
    app = { rootGraph: graph, extensionManager: { workflow: { activeWorkflow: workflow } } };
  let calls = 0;
  app.graphToPrompt = async pinned => {
    assert.equal(pinned, graph);
    calls++;
    return {
      workflow: structuredClone(data),
      output: { 1: { class_type: 'Source', inputs: { value: data.nodes[0].widgets_values[0] } } },
    };
  };
  return {
    app,
    data,
    workflow,
    get calls() {
      return calls;
    },
  };
}
try {
  globalThis.fetch = metadata;
  const layout = fixture(),
    serializeLayout = layout.app.graphToPrompt;
  layout.app.graphToPrompt = async graph => {
    const value = await serializeLayout(graph);
    layout.data.nodes[0].pos[0]++;
    layout.data.nodes[0].order++;
    layout.data.extra.ds.scale++;
    return value;
  };
  const captured = await captureComfyGraph(layout.app);
  check(
    'Moving nodes, viewport updates and derived order never interrupt capture',
    layout.calls === 1 && captured.prompt['1'].inputs.value === 'first',
  );
  layout.data.nodes[0].widgets_values[0] = 'later';
  check(
    'The accepted graph and API are detached from subsequent edits',
    captured.workflow.nodes[0].widgets_values[0] === 'first' && captured.prompt['1'].inputs.value === 'first',
  );

  for (const change of ['widget', 'link', 'subgraph', 'properties']) {
    const f = fixture(),
      serialize = f.app.graphToPrompt;
    f.app.graphToPrompt = async graph => {
      const value = await serialize(graph);
      if (f.calls === 1) {
        if (change === 'widget') f.data.nodes[0].widgets_values[0] = 'latest';
        if (change === 'link') f.data.links.push([1, 1, 0, 2, 0, 'IMAGE']);
        if (change === 'subgraph') f.data.definitions.subgraphs[0].nodes[0].widgets_values[0] = 'latest';
        if (change === 'properties') f.data.nodes[0].properties.strength = 0.8;
      }
      return value;
    };
    const value = await captureComfyGraph(f.app);
    check(
      'A changed ' + change + ' automatically retries and saves a coherent pair',
      f.calls === 2 &&
        JSON.stringify(value.workflow) === JSON.stringify(f.data) &&
        value.prompt['1'].inputs.value === f.data.nodes[0].widgets_values[0],
    );
  }
  const pending = fixture();
  let release,
    entered = false;
  const gate = new Promise(r => (release = r));
  globalThis.fetch = async path => {
    entered = true;
    await gate;
    return metadata(path);
  };
  const saving = captureComfyGraph(pending.app);
  assert.ok(entered);
  pending.data.nodes[0].widgets_values[0] = 'edited while waiting';
  release();
  check(
    'Editing during schema loading is included without a retry',
    (await saving).prompt['1'].inputs.value === 'edited while waiting' && pending.calls === 1,
  );

  globalThis.fetch = metadata;
  const switched = fixture(),
    serializeSwitch = switched.app.graphToPrompt;
  switched.app.graphToPrompt = async graph => {
    const value = await serializeSwitch(graph);
    switched.app.extensionManager.workflow.activeWorkflow = { path: 'different' };
    return value;
  };
  await assert.rejects(captureComfyGraph(switched.app), /switched workflows/);
  check('Switching tabs never applies a different workflow', switched.calls === 1);
  const continuous = fixture(),
    serializeContinuous = continuous.app.graphToPrompt;
  continuous.app.graphToPrompt = async graph => {
    const value = await serializeContinuous(graph);
    continuous.data.nodes[0].widgets_values[0] += 'x';
    return value;
  };
  await assert.rejects(captureComfyGraph(continuous.app), /Your edits are still in the graph/);
  check('Continuous input mutation is bounded and never accepts a mismatched graph', continuous.calls === 3);
  const prepared = fixture(),
    known = { definitions: { Source: { input: { required: { value: ['STRING'] } } } }, frontendVersion: 'prepared' };
  globalThis.fetch = () => {
    throw Error('Prepared template metadata must stay inside its serializer');
  };
  const reused = await captureComfyGraph(prepared.app, known);
  check(
    'An isolated template can reuse its node schemas without network requests',
    reused.definitions.Source.input.required.value[0] === 'STRING' &&
      reused.provenance.frontendVersion === 'prepared' &&
      prepared.calls === 1,
  );
  reused.definitions.Source.input.required.value[0] = 'changed';
  check(
    'Reusing template schemas never gives a capture mutable access to the cache',
    known.definitions.Source.input.required.value[0] === 'STRING',
  );
} finally {
  globalThis.fetch = originalFetch;
}
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
