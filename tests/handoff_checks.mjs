import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { HANDOFF_PARAM } from '../ui/bridge.js';

const source = fs.readFileSync('web/spool.js', 'utf8');
const fragment = source.slice(
  source.indexOf('async function receiveHandoff()'),
  source.indexOf('app.registerExtension('),
);
function fixture(replaced = false) {
  const written = [],
    opened = [],
    app = { extensionManager: { spinner: true }, rootGraph: { extra: {} } };
  const payload = {
    action: 'prepare',
    name: 'Requested graph',
    workflow: { nodes: [{ id: 1, type: 'SaveImage' }], extra: { authored: 'preserved' } },
  };
  let captured = 0;
  const context = {
    app,
    bridgeId: 'qa-bridge',
    URLSearchParams,
    location: { search: '?' + HANDOFF_PARAM + '=owned-id' },
    HANDOFF_PARAM,
    Date,
    Promise,
    setTimeout,
    Error,
    JSON,
    encodeURIComponent,
    ACTIONS: { open: 'open' },
    graphActions: {
      open: async data => {
        opened.push(data);
        app.rootGraph.extra = replaced ? {} : data.workflow.extra;
      },
    },
    captureGraph: async () => {
      captured++;
      return { workflow: JSON.parse(JSON.stringify(app.rootGraph)), prompt: { save: { class_type: 'SaveImage' } } };
    },
    fetch: async (path, options) => ({
      ok: true,
      json: async () => {
        if (options.method === 'POST') {
          written.push(JSON.parse(options.body));
          return {};
        }
        return { state: 'pending', payload };
      },
    }),
  };
  return {
    run: vm.runInNewContext(fragment + '\nreceiveHandoff', context),
    app,
    opened,
    written,
    payload,
    captured: () => captured,
  };
}
const tick = () => new Promise(r => setTimeout(r, 70));
const ready = fixture(),
  running = ready.run();
await tick();
assert.equal(ready.opened.length, 0);
ready.app.extensionManager.spinner = false;
await running;
assert.equal(ready.captured(), 1);
assert.equal(ready.written[0].workflow.extra.authored, 'preserved');
assert.equal(ready.written[0].workflow.extra.spoolPreparationId, undefined);
assert.equal(ready.app.rootGraph.extra.spoolPreparationId, undefined);
assert.equal(ready.payload.workflow.extra.spoolPreparationId, undefined);
const replaced = fixture(true);
replaced.app.extensionManager.spinner = false;
await replaced.run();
assert.equal(replaced.captured(), 0);
assert.match(replaced.written[0].error, /changed the workflow/);
console.log(
  JSON.stringify(
    {
      passed: 3,
      checks: [
        'Handoff waits for frontend workspace restoration',
        'Preparation marker does not change the authored or captured workflow',
        'A replaced graph cannot be accepted as the requested recipe',
      ],
    },
    null,
    2,
  ),
);
