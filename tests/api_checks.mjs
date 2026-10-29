// The studio's HTTP client: labels, background rules, recipe attachment, errors.
// node tests/api_checks.mjs
import { createApi, requestLabel } from '../ui/api.js';

const checks = [];
const check = (label, ok) => {
  if (!ok) throw Error(label);
  checks.push(label);
};
const reply = (status, value, text) => ({
  ok: status < 400,
  status,
  json: async () => {
    if (text !== undefined) throw SyntaxError('Unexpected token');
    return value;
  },
});

function harness(replies) {
  const sent = [],
    runs = [],
    recipes = new Map();
  const api = createApi({
    diagnostics: {
      run: (label, run, options) => {
        runs.push({ label, ...options });
        return run();
      },
    },
    project: () => 'p1',
    recipes: () => recipes,
    send: async (url, options) => {
      sent.push({ url, ...options });
      return replies.shift();
    },
  });
  return { api, sent, runs, recipes };
}

check(
  'Saving, syncing and slow operations have their own labels',
  requestLabel('projects/p1', 'PUT') === 'Saving project' &&
    requestLabel('projects/p1', 'GET') === 'Syncing project' &&
    requestLabel('projects/p1/c/generation-preview', 'POST') === 'Preparing generation inputs' &&
    requestLabel('projects/p1/media/m/preview', 'POST') === 'Preparing viewer preview' &&
    requestLabel('capabilities', 'GET') === 'Loading Comfy node definitions' &&
    requestLabel('projects/p1/commands', 'POST') === 'Updating project',
);

{
  const h = harness([reply(200, { revision: 3 }), reply(200, {}), reply(200, { definitions: {} })]);
  await h.api.request('projects/p1');
  await h.api.request('projects/p1/focus/view', { clipId: 'a' });
  await h.api.request('capabilities');
  check(
    'Requests carry the editor view',
    h.sent.every(r => r.headers['X-Spool-View'] === 'editor'),
  );
  check('A request without a body is a GET with no body', h.sent[0].method === 'GET' && h.sent[0].body === undefined);
  check('Routine project sync is quiet background work', h.runs[0].background && h.runs[0].quiet);
  check('Focus heartbeats are quiet background work', h.runs[1].background && h.runs[1].quiet);
  check('Loading node definitions is shown as work', !h.runs[2].background && !h.runs[2].quiet);
}

{
  const h = harness([reply(200, { revision: 4, recipes: { v1: {} } }), reply(200, { revision: 5, recipes: {} })]);
  h.recipes.set('v1', { prompt: 1 });
  h.recipes.set('v2', { prompt: 2 });
  h.recipes.set('unused', { prompt: 3 });
  await h.api.request(
    'projects/p1',
    {
      revision: 3,
      document: { clips: [{ workflowVersion: 'v1' }, { workflowVersion: 'v2' }, { workflowVersion: 'v1' }] },
    },
    'PUT',
  );
  const body = JSON.parse(h.sent[0].body);
  check(
    'A save carries the recipes its clips use that exist only in this tab',
    Object.keys(body.workflowRecipes).sort().join() === 'v1,v2',
  );
  check(
    'Recipes the server confirmed are forgotten; the rest wait for the next save',
    !h.recipes.has('v1') && h.recipes.has('v2') && h.recipes.has('unused'),
  );
  await h.api.request('projects/other', { revision: 1, document: { clips: [{ workflowVersion: 'v2' }] } }, 'PUT');
  check("Only this project's save carries recipes", !JSON.parse(h.sent[1].body).workflowRecipes);
}

{
  const h = harness([
    reply(409, { error: 'Project changed', current: { revision: 9 } }),
    reply(413, null, 'Request Entity Too Large'),
    reply(500, {}),
  ]);
  const conflict = await h.api
    .request('projects/p1', { revision: 1, document: { clips: [] } }, 'PUT')
    .catch(error => error);
  check(
    'A failed reply becomes an Error with its status and current project',
    conflict.message === 'Project changed' && conflict.status === 409 && conflict.current.revision === 9,
  );
  const tooLarge = await h.api
    .upload('upload?projectId=p1', 'bytes', 'big.mp4', { fallback: 'Import failed' })
    .catch(error => error);
  check(
    'A reply that is not JSON still fails with the fallback text and status',
    tooLarge.message === 'Import failed (413)' && tooLarge.status === 413,
  );
  const empty = await h.api
    .call('export', { method: 'POST', body: {}, fallback: 'Export failed.' })
    .catch(error => error);
  check('A JSON failure without a message uses the fallback text', empty.message === 'Export failed.');
}

{
  const h = harness([reply(200, { file: 'x.png' }), reply(200, { id: 'p2' })]);
  await h.api.upload('projects/p1/input', 'bytes', 'Ünïcode name.png');
  check(
    'Uploads send octet-stream with a percent-encoded filename',
    h.sent[0].headers['Content-Type'] === 'application/octet-stream' &&
      h.sent[0].headers['X-Filename'] === encodeURIComponent('Ünïcode name.png') &&
      h.sent[0].body === 'bytes',
  );
  await h.api.call('import-project', {
    method: 'POST',
    body: '{"raw":true}',
    json: false,
    headers: { 'Content-Type': 'application/json' },
  });
  check(
    'Raw bodies are sent unchanged',
    h.sent[1].body === '{"raw":true}' && h.sent[1].url === '/spool/api/import-project',
  );
}

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
