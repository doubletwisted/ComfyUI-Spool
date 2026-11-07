// The online demo's backend. It answers the studio's /spool/api requests inside
// the page: recorded replies for reads, an in-memory project for edits, and a
// plain "not in the demo" reply for everything that needs Spool on a computer
// (generation, Comfy, import, export, files). Reloading resets the project.
// Loaded as a classic script before the studio, so the studio's own fetch calls
// reach it. See docs/dev/demo.md.
(() => {
  const { base, project: projectId, studio = base + 'spool/ui/' } = window.SPOOL_DEMO;
  const API = base + 'spool/api/';
  const PROJECT = 'projects/' + projectId;
  const MESSAGE =
    'Not in the online demo: this needs Spool running with ComfyUI. Install it from github.com/doubletwisted/ComfyUI-Spool.';
  const originalFetch = window.fetch.bind(window);
  const copy = value => structuredClone(value);
  let replies = {},
    project = null,
    generated = [],
    tokens = 0;

  const loaded = originalFetch(base + 'replies.json')
    .then(reply => {
      if (!reply.ok) throw Error('Demo project unavailable (' + reply.status + ')');
      return reply.json();
    })
    .then(value => {
      replies = value;
      project = copy(value['GET ' + PROJECT]);
      project.syncToken = 'demo-' + tokens++;
      // Generated takes live outside the document on the host, as attempts: a save
      // leaves them out and every reply attaches them again (ledger.attach). The
      // recording does not name the clip that rendered a take, so every clip that
      // held it then counts as its owner.
      const byTake = new Map();
      for (const clip of project.document.clips)
        for (const take of clip.takes)
          if (take.generated) {
            if (!byTake.has(take.id)) byTake.set(take.id, { takeId: take.id, clipIds: new Set(), take: copy(take) });
            byTake.get(take.id).clipIds.add(clip.id);
          }
      generated = [...byTake.values()];
    });

  const reply = (status, value) =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  // Declined requests are listed on the page, so the smoke check can tell when the
  // studio starts asking for something the demo does not answer.
  const declinedRequests = new Set();
  function declined(method, path) {
    declinedRequests.add(method + ' ' + path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}'));
    if (document.body) document.body.dataset.demoDeclined = [...declinedRequests].join(', ');
    return reply(403, { error: MESSAGE, code: 'demo_unavailable' });
  }
  const conflict = () =>
    reply(409, { error: 'This project changed. Reload to see it.', code: 'revision_conflict', current: copy(project) });
  function recorded(method, path) {
    const value = replies[method + ' ' + path];
    if (value === undefined) return null;
    return value && value.__demoStatus ? reply(value.__demoStatus, value.body) : reply(200, value);
  }
  function changed() {
    project.revision++;
    project.syncToken = 'demo-' + tokens++;
  }

  // ledger.owns: the clip a generated take belongs to, after splits and copies.
  const owns = (clip, a) =>
    (clip.takeSourceTakeIds || []).includes(a.takeId) ||
    a.clipIds.has(clip.id) ||
    (clip.takeSourceIds || []).some(id => a.clipIds.has(id)) ||
    a.clipIds.has(clip.takeOwnerId) ||
    clip.takeId === a.takeId;
  function attach(document) {
    const deleted = new Set(document.deletedTakeIds || []);
    for (const clip of document.clips)
      clip.takes = [
        ...clip.takes.filter(t => !t.generated),
        ...generated.filter(a => !deleted.has(a.takeId) && owns(clip, a)).map(a => copy(a.take)),
      ];
    return document;
  }
  const filePath = value => {
    if (typeof value !== 'string' || !value) return null;
    let path = value;
    try {
      path = decodeURIComponent(path);
    } catch {
      // A literal percent sign is valid in a recorded file name.
    }
    path = path.replaceAll('\\', '/');
    const parts = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
      else parts.push(part);
    }
    return (path.startsWith('/') ? '/' : '') + parts.join('/');
  };
  const original = media => filePath(media?.originalFile || media?.file);
  const sidecar = path => (path ? path.replace(/\.[^/.]+$/, '') + '.json' : null);
  const files = media =>
    [...new Set([media?.originalFile, media?.file, media?.poster].map(filePath)), sidecar(original(media))].filter(
      Boolean,
    );

  // Delete takes as the host does: never the take in the edit, then record the
  // deletion so the takes stay gone. Nothing is on disk to remove.
  function deleteTakes(clipId, body) {
    const clip = project.document.clips.find(c => c.id === clipId),
      requested = body.takeIds;
    if (!clip || !Array.isArray(requested) || !requested.length || requested.some(id => typeof id !== 'string'))
      return reply(400, { error: 'Select the takes to delete' });
    const ids = [...new Set(requested)].sort();
    const hidden = new Set(clip.hiddenTakeIds || []);
    const available = new Map(clip.takes.filter(t => !t.placeholder && !hidden.has(t.id)).map(t => [t.id, t]));
    if (!ids.every(id => available.has(id)))
      return reply(400, { error: 'Some selected takes are no longer available' });
    if (ids.includes(clip.takeId))
      return reply(400, { error: 'The take in the edit is kept. Choose another take before deleting it.' });
    const document = project.document;
    const originals = new Set(ids.map(id => original(available.get(id).media)));
    if (
      [...originals].some(
        path =>
          !/^(output|input|\.spool)\//.test(path || '') ||
          !/\.(mp4|mov|webm|mkv|m4v|png|jpg|jpeg|webp|wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(path),
      )
    )
      return reply(400, {
        error: 'Delete from disk only manages media owned by this project; archive this take instead.',
      });
    // Match the host's deletion plan: original, sidecar and project preview files.
    // Other referenced files are protected but are not automatically deleted.
    const selected = new Set([...originals, ...[...originals].map(sidecar)]);
    for (const id of ids)
      for (const path of files(available.get(id).media)) if (path.startsWith('.spool/previews/')) selected.add(path);
    // A file another take or timeline audio still uses stays: a split shares its takes.
    for (const other of document.clips)
      for (const take of other.takes || [])
        if (!(other.id === clipId && ids.includes(take.id)) && files(take.media).some(f => selected.has(f)))
          return reply(400, {
            error:
              'A selected file is also used by another take in ' +
              (other.name || 'this clip') +
              '. Archive it instead.',
          });
    if ((document.audioClips || []).some(a => files(a.media).some(f => selected.has(f))))
      return reply(400, { error: 'A selected file is used by timeline audio. Archive it instead.' });
    for (const other of document.clips)
      for (const binding of other.bindings || []) {
        const value = other.inputValues?.[binding.key];
        if (!binding.asset || typeof value !== 'string') continue;
        const staged = value.startsWith('spool-projects/')
          ? value
              .replace(/ \[input\]$/, '')
              .split('/')
              .slice(2)
              .join('/')
          : null;
        const candidate = staged ? filePath(staged) : /^(\/|[A-Za-z]:[\\/])/.test(value) ? filePath(value) : null;
        if (originals.has(candidate))
          return reply(400, { error: 'A selected file is a generation input. Archive it instead.' });
      }
    const mediaIds = new Set(ids.map(id => available.get(id).media?.id).filter(Boolean));
    for (const media of document.media || [])
      if (files(media).some(path => selected.has(path))) {
        if (!originals.has(original(media)))
          return reply(400, {
            error: 'A selected file is shared with another media-pool asset. Archive it instead.',
          });
        if (media.id) mediaIds.add(media.id);
      }
    document.deletedTakeIds = [...new Set([...(document.deletedTakeIds || []), ...ids])].sort();
    document.deletedMediaIds = [...new Set([...(document.deletedMediaIds || []), ...mediaIds])].sort();
    clip.takes = clip.takes.filter(t => !ids.includes(t.id));
    document.media = (document.media || []).filter(media => !mediaIds.has(media.id));
    changed();
    return reply(200, { project: copy(project), deleted: ids, pendingFiles: 0 });
  }

  // Use take as Store.capture does it: put the take in the edit with the studio's
  // own refit, then adopt the setup read from the take (or clear it). The host
  // also freezes input files and writes sidecars; the demo has none.
  async function useTake(clipId, body) {
    const timeline = await import(studio + 'timeline.js');
    const clip = project.document.clips.find(c => c.id === clipId),
      { takeId, capture } = body;
    if (!clip) return reply(404, { error: 'Clip not found' });
    const take = clip.takes.find(t => t.id === takeId && !t.placeholder);
    if (!take || ((clip.hiddenTakeIds || []).includes(takeId) && takeId !== clip.takeId))
      return reply(400, { error: 'This take is no longer available for the shot' });
    const takeBase = capture?.provenance?.takeBase;
    if (capture && takeBase?.takeId !== takeId)
      return reply(400, { error: 'Generation setup must belong to the chosen take' });
    timeline.chooseTake(project.document, clipId, takeId);
    clip.generationBase = takeBase || { takeId, source: 'No executable metadata' };
    for (const field of ['workflow', 'shotInputs', 'seedKey']) delete clip[field];
    clip.seedMode = 'same';
    if (capture) {
      const version = crypto.randomUUID();
      clip.workflowVersion = version;
      clip.bindings = capture.bindings || [];
      clip.inputValues = Object.fromEntries(clip.bindings.map(b => [b.key, capture.prompt[b.nodeId].inputs[b.input]]));
      project.recipes = { ...project.recipes, [version]: capture };
    } else {
      delete clip.workflowVersion;
      clip.bindings = [];
      clip.inputValues = {};
    }
    clip.revision = (clip.revision || 0) + 1;
    changed();
    return reply(200, copy(project));
  }

  async function answer(method, path, body, headers) {
    await loaded;
    if (method === 'GET' && path === 'projects')
      return reply(200, [{ id: projectId, revision: project.revision, name: project.document.project, folder: '' }]);
    if (method === 'GET' && path === PROJECT) {
      // Unchanged since the studio's last read: only job progress, as the host replies.
      if (headers.get('X-Spool-Since') === project.syncToken)
        return reply(200, {
          revision: project.revision,
          syncToken: project.syncToken,
          jobs: project.document.jobs || [],
        });
      return reply(200, copy(project));
    }
    if (method === 'PUT' && path === PROJECT) {
      const value = JSON.parse(body);
      if (value.revision !== project.revision) return conflict();
      // The studio leaves out jobs, which the host owns and adds back to every reply.
      project.document = attach({ ...value.document, jobs: project.document.jobs });
      changed();
      return reply(200, copy(project));
    }
    if (method === 'POST' && path.startsWith(PROJECT + '/focus/')) return reply(200, { ok: true });
    const deletion = method === 'POST' && path.match(/^projects\/[^/]+\/delete-takes\/([^/]+)$/);
    if (deletion) {
      const value = JSON.parse(body);
      if (value.revision !== project.revision) return conflict();
      return deleteTakes(decodeURIComponent(deletion[1]), value);
    }
    const use = method === 'POST' && path.match(/^projects\/[^/]+\/use-take\/([^/]+)$/);
    if (use) {
      const value = JSON.parse(body);
      if (value.revision !== project.revision) return conflict();
      return useTake(decodeURIComponent(use[1]), value);
    }
    const version = method === 'GET' && path.match(/^workflows\/([^/]+)$/);
    if (version && project.recipes?.[decodeURIComponent(version[1])])
      return reply(200, project.recipes[decodeURIComponent(version[1])]);
    // A take's setup is recorded under the clip it was on; a split or copied clip
    // asks under its own id for the same take.
    const setup = method === 'GET' && path.match(/^projects\/[^/]+\/take-workflow\/([^/]+)\/([^/]+)$/);
    if (setup && !replies['GET ' + path]) {
      const clip = project.document.clips.find(c => c.id === decodeURIComponent(setup[1]));
      const prefix = 'GET ' + PROJECT + '/take-workflow/';
      const other = Object.keys(replies).find(k => k.startsWith(prefix) && k.endsWith('/' + setup[2]));
      if (other && clip?.takes.some(t => t.id === decodeURIComponent(setup[2]))) return recorded('GET', other.slice(4));
    }
    // Recorded reads, and playback copies whose size the recording already chose.
    if (method === 'GET' || (method === 'POST' && path.endsWith('/preview')))
      return recorded(method, path) || declined(method, path);
    return declined(method, path);
  }

  window.fetch = (input, init = {}) => {
    const address = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (address.origin !== location.origin || !address.pathname.startsWith(API)) return originalFetch(input, init);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return answer(method, address.pathname.slice(API.length), init.body, new Headers(init.headers));
  };

  function banner() {
    const bar = document.createElement('div');
    bar.id = 'spool-demo-banner';
    bar.setAttribute('role', 'note');
    bar.innerHTML =
      '<strong>Spool online demo</strong><span>Edits reset when you reload. Generating takes needs ComfyUI.</span>' +
      '<a href="https://github.com/doubletwisted/ComfyUI-Spool" target="_blank" rel="noopener">Install Spool</a>';
    document.body.prepend(bar);
    document.body.classList.add('spool-demo');
  }
  if (document.body) banner();
  else document.addEventListener('DOMContentLoaded', banner, { once: true });
})();
