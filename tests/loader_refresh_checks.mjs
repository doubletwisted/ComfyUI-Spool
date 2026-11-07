import assert from 'node:assert/strict';
import { refreshLoaderOptions } from '../web/graph-inputs.js';
import { createWorkflowLinks } from '../web/workflow-link.js';

const checks = [];
const checked = label => checks.push(label);
const loader = (type = 'LoadImage', value = 'old.png') => ({
  id: 1,
  type,
  properties: { authored: 'unchanged' },
  widgets: [
    {
      name: 'image',
      type: 'combo',
      value,
      options: { values: ['old.png'] },
      callback() {
        assert.fail('Refreshing choices must not invoke an input callback');
      },
    },
  ],
});
const definition = (type, values) => ({ [type]: { input: { required: { image: [values, { image_upload: true }] } } } });
const response = data => ({ ok: true, json: async () => data });

{
  const image = loader('LoadImage', 'spool-projects/project/input/new.png'),
    mask = loader('LoadImageMask', 'spool-projects/project/input/new.png'),
    root = { nodes: [image, { type: 'Subgraph', subgraph: { nodes: [mask] } }, { type: 'KSampler' }] };
  const calls = [],
    originalValue = image.widgets[0].value,
    properties = JSON.stringify(image.properties);
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    return response(definition(url.split('/').at(-1), ['old.png', originalValue]));
  };
  await refreshLoaderOptions(root, fetcher);
  assert.deepEqual(calls.map(([url]) => url).sort(), ['/object_info/LoadImage', '/object_info/LoadImageMask']);
  assert.ok(calls.every(([, options]) => options.cache === 'no-store'));
  assert.ok(image.widgets[0].options.values.includes(originalValue));
  assert.ok(mask.widgets[0].options.values.includes(originalValue));
  assert.equal(image.widgets[0].value, originalValue);
  assert.equal(JSON.stringify(image.properties), properties);
  checked('Staged images and nested mask loaders refresh only their exact definitions, preserving source and metadata');

  image.widgets[0].value = 'actually-missing.png';
  await refreshLoaderOptions(root, fetcher);
  assert.equal(image.widgets[0].value, 'actually-missing.png');
  assert.ok(!image.widgets[0].options.values.includes('actually-missing.png'));
  checked('A genuinely missing selected source remains missing and is never rewritten or invented as an option');
}

{
  const selected = 'spool-projects/project/input/new image.png [input]',
    image = loader('LoadImage', selected),
    mask = loader('LoadImageMask', selected),
    root = { nodes: [image, mask] },
    calls = [];
  let present = true;
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    if (options.method !== 'HEAD') return response(definition(url.split('/').at(-1), ['old.png']));
    const query = new URL(url, 'http://localhost').searchParams;
    assert.equal(query.get('filename'), 'new image.png');
    assert.equal(query.get('subfolder'), 'spool-projects/project/input');
    assert.equal(query.get('type'), 'input');
    return { ok: present, status: present ? 200 : 404, headers: new Headers({ 'Content-Type': 'image/png' }) };
  };
  await refreshLoaderOptions(root, fetcher);
  assert.equal(calls.filter(([, options]) => options.method === 'HEAD').length, 1);
  assert.deepEqual(image.widgets[0].options.values, ['old.png', selected]);
  assert.deepEqual(mask.widgets[0].options.values, ['old.png', selected]);
  assert.equal(image.widgets[0].value, selected);
  checked('Nested staged selections absent from native definitions are confirmed with one HEAD request and retained');
  present = false;
  await refreshLoaderOptions(root, fetcher);
  assert.deepEqual(image.widgets[0].options.values, ['old.png']);
  assert.equal(image.widgets[0].value, selected);
  checked('A removed staged image is no longer offered while its authored selection remains unchanged');

  image.widgets[0].options.values = ['before.png'];
  await assert.rejects(
    refreshLoaderOptions(root, async (url, options) =>
      options.method === 'HEAD' ? { ok: false, status: 500 } : response(definition(url.split('/').at(-1), [])),
    ),
    /Could not check/,
  );
  assert.deepEqual(image.widgets[0].options.values, ['before.png']);
  checked('Availability errors preserve previous choices instead of hiding a valid staged source');
}

{
  const image = loader('LoadImage', 'folder/a.png'),
    root = { nodes: [image] };
  let complete, headStarted;
  const held = new Promise(resolve => (complete = resolve)),
    started = new Promise(resolve => (headStarted = resolve));
  const pending = refreshLoaderOptions(root, async (url, options) => {
    if (options.method !== 'HEAD') return response(definition('LoadImage', ['old.png']));
    headStarted();
    await held;
    return { ok: true, status: 200, headers: new Headers({ 'Content-Type': 'image/png' }) };
  });
  await started;
  image.widgets[0].value = 'folder/newly-uploaded.png';
  image.widgets[0].options.values.push(image.widgets[0].value);
  const uploadedChoices = [...image.widgets[0].options.values];
  complete();
  await pending;
  assert.deepEqual(image.widgets[0].options.values, uploadedChoices);
  assert.ok(image.widgets[0].options.values.includes(image.widgets[0].value));
  checked('An upload selected during a pending availability request retains its newer choices and selection');
}

{
  const inner = loader(),
    exposed = { name: 'reference', type: 'combo', value: 'new.png', options: { values: ['old.png'] } },
    parent = { id: 2, type: 'Subgraph', widgets: [exposed] };
  inner.inputs = [{ name: 'image', link: 1 }];
  parent.subgraph = {
    nodes: [inner],
    inputs: [{ name: 'reference' }],
    links: new Map([[1, { origin_id: -10, origin_slot: 0 }]]),
    getNodeById: id => (String(id) === String(inner.id) ? inner : null),
  };
  const root = {
    nodes: [parent],
    getNodeById: id => (String(id) === String(parent.id) ? parent : null),
  };
  await refreshLoaderOptions(root, async () => response(definition('LoadImage', ['old.png', 'new.png'])));
  assert.deepEqual(exposed.options.values, ['old.png', 'new.png']);
  assert.equal(exposed.value, 'new.png');
  checked('Exposed subgraph image inputs refresh their parent-owned choices without changing their selected value');
}

{
  const first = loader(),
    second = loader(),
    root = { nodes: [first, second] };
  let complete,
    calls = 0;
  const held = new Promise(resolve => (complete = resolve));
  const fetcher = async () => {
    calls++;
    await held;
    return response(definition('LoadImage', ['fresh.png']));
  };
  const one = refreshLoaderOptions(root, fetcher),
    two = refreshLoaderOptions(root, fetcher);
  complete();
  await Promise.all([one, two]);
  assert.equal(calls, 1);
  assert.deepEqual(first.widgets[0].options.values, ['fresh.png']);
  first.widgets[0].options.values.push('only-first.png');
  assert.deepEqual(second.widgets[0].options.values, ['fresh.png']);
  await refreshLoaderOptions(root, fetcher);
  assert.equal(calls, 2);
  checked('Concurrent refreshes share a request, widgets own independent option arrays, and later imports fetch again');
}

{
  const previous = loader(),
    replacement = loader(),
    root = { nodes: [previous] };
  let complete;
  const held = new Promise(resolve => (complete = resolve));
  const pending = refreshLoaderOptions(root, async () => {
    await held;
    return response(definition('LoadImage', ['late.png']));
  });
  root.nodes = [replacement];
  complete();
  await pending;
  assert.deepEqual(previous.widgets[0].options.values, ['old.png']);
  assert.deepEqual(replacement.widgets[0].options.values, ['old.png']);
  checked('A response for a detached graph cannot change the replacement workflow or old widgets');
}

{
  const child = loader(),
    parent = { type: 'Subgraph', subgraph: { nodes: [child] } },
    root = { nodes: [parent] };
  let complete;
  const held = new Promise(resolve => (complete = resolve));
  const pending = refreshLoaderOptions(root, async () => {
    await held;
    return response(definition('LoadImage', ['late.png']));
  });
  root.nodes = [];
  complete();
  await pending;
  assert.deepEqual(child.widgets[0].options.values, ['old.png']);
  const replaced = loader();
  await refreshLoaderOptions(
    { nodes: [replaced] },
    async () => response(definition('LoadImage', ['late.png'])),
    () => false,
  );
  assert.deepEqual(replaced.widgets[0].options.values, ['old.png']);
  checked('Detached subgraphs and superseded root graphs cannot receive late choices');
}

{
  const image = loader(),
    root = { nodes: [image] };
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return calls === 1 ? { ok: false } : response(definition('LoadImage', ['recovered.png']));
  };
  await assert.rejects(refreshLoaderOptions(root, fetcher), /Could not refresh/);
  assert.deepEqual(image.widgets[0].options.values, ['old.png']);
  await refreshLoaderOptions(root, fetcher);
  assert.equal(calls, 2);
  assert.deepEqual(image.widgets[0].options.values, ['recovered.png']);
  checked('Failed requests preserve choices, report failure and can be retried without a cached rejection');

  await assert.rejects(
    refreshLoaderOptions(root, async () => response({ LoadImage: {} })),
    /no image choices/,
  );
  assert.deepEqual(image.widgets[0].options.values, ['recovered.png']);
  await refreshLoaderOptions(root, async () =>
    response({ LoadImage: { input: { required: { image: ['COMBO', { options: ['modern.png'] }] } } } }),
  );
  assert.deepEqual(image.widgets[0].options.values, ['modern.png']);
  checked('Malformed definitions never erase choices; modern COMBO option definitions are supported');
}

{
  const savedFetch = globalThis.fetch;
  const storageValues = new Map(),
    storage = { getItem: key => storageValues.get(key), setItem: (key, value) => storageValues.set(key, value) },
    current = { path: 'linked.json', changeTracker: { activeState: {} } },
    manager = { openWorkflows: [current], activeWorkflow: current },
    image = loader(),
    app = { rootGraph: { nodes: [image] }, extensionManager: { workflow: manager, spinner: false } },
    link = { projectId: 'project', clipId: 'clip', sourceKey: 'v1' };
  let loads = 0,
    requests = 0,
    choices = ['old.png'];
  const load = async () => {
    loads++;
    return { opened: true };
  };
  const capture = async () => ({ prompt: {}, provenance: {} });
  globalThis.fetch = async url => {
    requests++;
    assert.equal(url, '/object_info/LoadImage');
    return response(definition('LoadImage', choices));
  };
  try {
    const links = createWorkflowLinks(app, load, capture, storage);
    await links.open({ link, name: 'Linked clip' });
    choices = ['old.png', image.widgets[0].value];
    const restored = createWorkflowLinks(app, load, capture, storage);
    const reopened = await restored.open({ link, name: 'Linked clip' });
    assert.ok(reopened.reused);
    assert.equal(loads, 1);
    assert.equal(requests, 1);
    assert.ok(image.widgets[0].options.values.includes(image.widgets[0].value));
    const captured = await restored.capture({ link });
    assert.equal(captured.provenance.spoolLink.workflowPath, current.path);
    checked(
      'Restored links refresh a reused active tab after a new upload without loading or recapturing another graph',
    );

    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(restored.open({ link, name: 'Linked clip' }), /Could not refresh/);
    assert.equal(manager.activeWorkflow, current);
    assert.equal(image.widgets[0].value, 'old.png');
    checked('An explicit linked-tab refresh failure leaves the active workflow and selected input intact');

    let complete;
    const held = new Promise(resolve => (complete = resolve));
    globalThis.fetch = async () => {
      await held;
      return response(definition('LoadImage', choices));
    };
    const opening = restored.open({ link, name: 'Linked clip' });
    const same = restored.open({ link, name: 'Linked clip' });
    await assert.rejects(restored.open({ link: { ...link, clipId: 'other' } }), /Finish opening/);
    await assert.rejects(restored.capture({ link }), /Finish opening/);
    manager.activeWorkflow = { path: 'unrelated.json' };
    complete();
    await assert.rejects(opening, /linked workflow changed/);
    await assert.rejects(same, /linked workflow changed/);
    checked(
      'Concurrent repeated opens share work, block other captures, and cannot claim success after switching tabs',
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
}

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
