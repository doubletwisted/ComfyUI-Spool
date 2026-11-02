// The online demo's in-page API (pages/demo-api.js): the host replies it imitates.
import { pathToFileURL } from 'node:url';

const checks = [];
const check = (label, ok) => {
  if (!ok) throw Error(label);
  checks.push(label);
};

const ID = '00000000-0000-4000-8000-000000000001';
const take = (id, frames = 48) => ({
  id,
  media: { id: 'media-' + id, file: 'output/' + id + '.mp4', frames, kind: 'video' },
});
const project = {
  id: ID,
  revision: 5,
  recipes: {},
  document: {
    project: 'Demo',
    fps: 24,
    tailGap: 0,
    jobs: [{ id: 'job-1', status: 'complete' }],
    clips: [
      { id: 'clip-1', in: 0, out: 48, takeId: 'a', takes: [take('a'), take('b', 24), take('c')] },
      {
        id: 'clip-2',
        name: 'c2',
        videoTrack: 2,
        in: 0,
        out: 48,
        takeId: 'g',
        takes: [take('d'), { ...take('g'), generated: true }],
      },
    ],
  },
};
const replies = {
  ['GET projects/' + ID]: project,
  'GET capabilities': { definitions: {} },
  ['GET projects/' + ID + '/takes/c']: { __demoStatus: 400, body: { error: 'No details' } },
  ['GET projects/' + ID + '/take-workflow/clip-2/d']: { bindings: [] },
};

const body = { dataset: {}, classList: { add() {} }, prepend() {} };
const window = {
  SPOOL_DEMO: { base: '/site/', project: ID, studio: pathToFileURL('ui/').href },
  fetch: async address => {
    if (address === '/site/replies.json') return new Response(JSON.stringify(replies));
    return new Response('static');
  },
};
// The script is classic in the page; as a module here it sees the same globals.
Object.assign(globalThis, {
  window,
  document: { body, createElement: () => ({ setAttribute() {} }) },
  location: { href: 'http://demo.test/site/', origin: 'http://demo.test' },
});
await import('../pages/demo-api.js');
const api = (path, init) => window.fetch('/site/spool/api/' + path, init).then(async r => [r.status, await r.json()]);
const send = (method, path, value, headers) => api(path, { method, body: JSON.stringify(value), headers });

{
  const [status, value] = await api('projects/' + ID);
  check('The project is the recorded one', status === 200 && value.revision === 5 && value.syncToken);
  const [, unchanged] = await api('projects/' + ID, { headers: { 'X-Spool-Since': value.syncToken } });
  check('A poll at the current token gets only revision and jobs', !unchanged.document && unchanged.jobs.length === 1);
  check('Recorded reads replay', (await api('capabilities'))[0] === 200);
  check('Recorded errors replay', (await api('projects/' + ID + '/takes/c'))[0] === 400);
  check('Static files still load', (await window.fetch('/site/spool/ui/editor.js').then(r => r.text())) === 'static');
}
{
  const [, current] = await api('projects/' + ID);
  const document = structuredClone(current.document);
  delete document.jobs;
  document.clips[0].out = 40;
  // The studio saves the authored edit, without generated takes (ledger.authored).
  document.clips[1].takes = document.clips[1].takes.filter(t => !t.generated);
  const [status, saved] = await send('PUT', 'projects/' + ID, { revision: 5, document });
  check('A save raises the revision', status === 200 && saved.revision === 6 && saved.document.clips[0].out === 40);
  check('A save keeps the jobs the host owns', saved.document.jobs.length === 1);
  const generatedTakes = saved.document.clips[1].takes.filter(t => t.generated);
  check('A save attaches the generated takes', generatedTakes.length === 1 && generatedTakes[0].id === 'g');
  check('A stale save conflicts', (await send('PUT', 'projects/' + ID, { revision: 5, document }))[0] === 409);
}
{
  const path = 'projects/' + ID + '/delete-takes/clip-1';
  const [refused, error] = await send('POST', path, { revision: 6, takeIds: ['a'] });
  check('The take in the edit is never deleted', refused === 400 && /kept/.test(error.error));
  const [status, value] = await send('POST', path, { revision: 6, takeIds: ['c'] });
  check('Deleting takes replies with the project', status === 200 && value.pendingFiles === 0);
  check('Deleted takes are gone and recorded', value.project.document.clips[0].takes.length === 2);
  check('Deleted media are recorded', value.project.document.deletedMediaIds.includes('media-c'));
}
{
  const path = 'projects/' + ID + '/use-take/clip-1';
  const capture = {
    prompt: { 3: { inputs: { seed: 7 } } },
    bindings: [{ key: 'seed', nodeId: '3', input: 'seed' }],
    provenance: { takeBase: { takeId: 'b' } },
  };
  const [wrong] = await send('POST', path, { revision: 7, takeId: 'a', capture });
  check('A setup from another take is refused', wrong === 400);
  const [status, value] = await send('POST', path, { revision: 7, takeId: 'b', capture });
  const clip = value.document.clips[0];
  check('Use take puts the take in the edit', status === 200 && clip.takeId === 'b');
  check('Use take refits the clip to a shorter take', clip.out - clip.in === 24 && value.document.tailGap === 16);
  check('Use take adopts the setup', clip.inputValues.seed === 7 && !!value.recipes[clip.workflowVersion]);
  const [, recipe] = await api('workflows/' + clip.workflowVersion);
  check('The adopted setup is readable', recipe.bindings.length === 1);
}
{
  const [status, value] = await send('POST', 'projects/' + ID + '/queue', {});
  check('Generation is declined with the install hint', status === 403 && /ComfyUI/.test(value.error));
  check('Declined requests are listed for the smoke check', body.dataset.demoDeclined === 'POST projects/{id}/queue');
}

{
  // Split clip-2: the new half owns its takes through takeOwnerId and shares their files.
  const [, current] = await api('projects/' + ID);
  const document = structuredClone(current.document);
  delete document.jobs;
  const half = { ...structuredClone(document.clips[1]), id: 'clip-3', takeOwnerId: 'clip-2' };
  half.takes = half.takes.filter(t => !t.generated);
  document.clips.push(half);
  const [, saved] = await send('PUT', 'projects/' + ID, { revision: current.revision, document });
  check(
    'A split half gets the generated takes',
    saved.document.clips[2].takes.some(t => t.id === 'g'),
  );
  const [status, setup] = await api('projects/' + ID + '/take-workflow/clip-3/d');
  check('A split half reads the recorded setup of its take', status === 200 && Array.isArray(setup.bindings));
  const path = 'projects/' + ID + '/delete-takes/clip-2';
  const [refused, error] = await send('POST', path, { revision: saved.revision, takeIds: ['d'] });
  check('A file the other half uses is not deleted', refused === 400 && /c2/.test(error.error));
}

console.log(checks.length + ' demo API checks passed');
