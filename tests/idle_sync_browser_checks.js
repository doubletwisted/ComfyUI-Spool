(async () => {
  const n = spoolNative,
    checks = [],
    check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    };
  const path = '/spool/api/projects/' + n.projectKey,
    original = window.fetch,
    reads = [];
  const preview = document.querySelector('[data-template="library"] img');
  await preview.decode();
  check(
    'Project workflow preview resolves through its own project media route',
    new URL(preview.src).pathname === '/spool/media/' + n.projectKey + '/.spool/previews/library-relative.png' &&
      preview.naturalWidth > 0,
  );
  check(
    'Saved workflow keeps a portable project-relative poster',
    n.state.importedWorkflows[0].poster === '.spool/previews/library-relative.png',
  );
  window.fetch = async (input, options) => {
    const response = await original(input, options);
    if (String(input) === path && options?.method === 'GET')
      reads.push({ headers: options.headers, value: await response.clone().json() });
    return response;
  };
  try {
    // The first check may refresh after fixture initialization; subsequent checks stay small.
    await n.poll();
    const before = JSON.stringify(n.state.clips),
      revision = n.revision,
      lane = n.laneDraws;
    await n.poll();
    await n.poll();
    check(
      'Idle polls send the accepted change token',
      reads.slice(-2).every(r => !!r.headers['X-Spool-Since']),
    );
    check(
      'Idle responses omit the complete document and workflow recipes',
      reads.slice(-2).every(r => !r.value.document && !r.value.recipes && JSON.stringify(r.value).length < 1024),
    );
    check(
      'Idle sync preserves clip data, revision and rendered lane',
      JSON.stringify(n.state.clips) === before && n.revision === revision && n.laneDraws === lane && !n.dirty,
    );
    const remote = await original(path).then(r => r.json());
    remote.document.brief = 'External editor update';
    const saved = await original(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: remote.revision, document: remote.document }),
    });
    check('Owned external edit is saved', saved.ok);
    await n.poll();
    check(
      'Remote edits invalidate the token and refresh the project',
      reads.at(-1).value.document?.brief === 'External editor update' &&
        n.state.brief === 'External editor update' &&
        n.revision > revision,
    );
    await n.poll();
    check(
      'Sync returns to small responses after applying the edit',
      !reads.at(-1).value.document && JSON.stringify(n.state.clips) === before,
    );
    check('Idle sync does not submit generation', !n.state.jobs.length);
    // Controlled progress transport against installed renderers; no execution.
    const baseline = await original(path).then(r => r.json());
    window.fetch = async (input, options) =>
      String(input) === path && options?.method === 'GET'
        ? new Response(
            JSON.stringify({
              ...baseline,
              document: { ...baseline.document, jobs: [{ id: 'progress-fixture', clipId: 'shot', status: 'queued' }] },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        : original(input, options);
    await n.poll();
    const authored = n.state,
      clips = n.state.clips,
      card = document.querySelector('[data-clip]'),
      draws = n.laneDraws;
    window.fetch = async (input, options) =>
      String(input) === path && options?.method === 'GET'
        ? new Response(
            JSON.stringify({
              revision: baseline.revision,
              syncToken: baseline.syncToken,
              jobs: [
                { id: 'progress-fixture', status: 'running', nodeProgress: [{ id: 'sampler', value: 1, max: 4 }] },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        : original(input, options);
    await n.poll();
    check(
      'Controlled progress updates preserve authored state and installed timeline nodes',
      n.state === authored &&
        n.state.clips === clips &&
        document.querySelector('[data-clip]') === card &&
        n.laneDraws === draws,
    );
    check(
      'Controlled progress refreshes jobs without marking the document dirty',
      n.state.jobs[0].nodeProgress[0].value === 1 && !n.dirty,
    );
  } finally {
    window.fetch = original;
  }
  return { checks };
})();
