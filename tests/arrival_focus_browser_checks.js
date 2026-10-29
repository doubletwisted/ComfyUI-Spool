(async () => {
  const n = window.spoolNative,
    $ = id => document.getElementById(id),
    checks = [];
  const check = (label, value) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  n.selectClip('shot');
  await n.flush();
  const c = n.state.clips.find(c => c.id === 'shot'),
    chosen = c.takeId,
    trim = [c.in, c.out],
    name = c.name,
    revision = n.revision;
  const field = $('clipName'),
    original = window.fetch,
    path = '/spool/api/projects/' + n.projectKey;
  const arrival = {
    id: 'focused-arrival',
    number: 42,
    generated: true,
    media: { ...c.takes[0].media, id: 'focused-media', frames: 240 },
  };
  let reads = 0,
    newRevision = false;
  try {
    window.fetch = async (input, options) => {
      // This fixture injects a complete receipt, so request the complete representation.
      const headers = { ...options?.headers };
      delete headers['X-Spool-Since'];
      const response = await original(input, { ...options, headers });
      if (String(input) !== path || options?.method !== 'GET') return response;
      reads++;
      const value = await response.json();
      value.syncToken = 'injected-focus-receipt';
      value.document.clips.find(c => c.id === 'shot').takes.push(arrival);
      value.document.jobs.push({
        id: 'focused-job',
        clipId: 'shot',
        name: 'Arrival QA',
        target: 'deadline',
        status: 'complete',
        takeNumber: 42,
      });
      if (newRevision) {
        value.revision++;
        value.document.project = 'Remote authored edit';
      }
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    };
    field.focus();
    field.value = 'Still typing this name';
    field.setSelectionRange(6, 12);
    await n.poll();
    check('A focused input does not stop render-status polling', reads === 1);
    check(
      'A completed take appears while an input keeps focus',
      n.state.clips.find(c => c.id === 'shot').takes.some(t => t.id === arrival.id) &&
        !!document.querySelector('[data-take="focused-arrival"]'),
    );
    const card = document.querySelector('[data-take="focused-arrival"]');
    check(
      'Take cards report full source length rather than the existing shot trim',
      card.querySelector('.take-duration')?.textContent === '10.00s' &&
        card.querySelector('.take-duration').title === 'Full take duration',
    );
    check(
      'A newly collected take has a visible New marker',
      card.querySelector('.take-badge.new')?.textContent === 'New',
    );
    check(
      'Arrivals preserve the focused field, unsaved text and caret',
      document.activeElement === field &&
        field.value === 'Still typing this name' &&
        field.selectionStart === 6 &&
        field.selectionEnd === 12,
    );
    check(
      'Arrivals preserve chosen take, clip name and trim',
      c.takeId === chosen && c.name === name && JSON.stringify([c.in, c.out]) === JSON.stringify(trim) && !n.dirty,
    );
    await n.poll();
    check(
      'Repeated arrival does not duplicate the take',
      n.state.clips.find(c => c.id === 'shot').takes.filter(t => t.id === arrival.id).length === 1,
    );
    newRevision = true;
    await n.poll();
    check(
      'A newer authored revision is deferred while a field is focused',
      n.revision === revision &&
        n.state.project !== 'Remote authored edit' &&
        document.activeElement === field &&
        field.value === 'Still typing this name',
    );
  } finally {
    window.fetch = original;
    field.value = name;
    field.blur();
    await n.poll();
  }
  check(
    'No generation was submitted and the real ledger remains unchanged',
    !n.state.jobs.length && !n.state.clips.find(c => c.id === 'shot').takes.some(t => t.id === arrival.id),
  );
  return { checks };
})();
