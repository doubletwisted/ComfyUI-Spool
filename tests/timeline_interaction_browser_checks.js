(async () => {
  const w = __timelineW,
    d = w.document,
    n = w.spoolNative,
    T = await w.eval("import('/spool/ui/timeline.js')"),
    g = __timelineGestures,
    checks = [],
    $ = id => d.getElementById(id),
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
  const api = async (path, data, method) => {
    const r = await w.fetch('/spool/api/' + path, {
      method: method || (data ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error);
    return result;
  };
  const wait = async test => {
    const end = Date.now() + 30000;
    while (!(await test())) {
      if (Date.now() > end) throw Error('Timeline interaction wait: ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 60));
    }
  };
  check('Middle-mouse drag pans horizontally like grabbing the timeline', g.panEnd.left > g.panStart.left + 80);
  check(
    'Panning changes neither clip edits, selection nor playhead',
    g.panEnd.clips === g.panStart.clips &&
      g.panEnd.frame === g.panStart.frame &&
      g.panEnd.selected === g.panStart.selected &&
      g.panEnd.revision === g.panStart.revision,
  );
  check('Escape cancels a middle-mouse pan', g.panCancel.left === g.panEnd.left);
  check(
    'Ruler labels are sparse and omit full frame timecodes',
    [...d.querySelectorAll('#ruler .tick:not(.minor)')].every(
      (t, i, a) =>
        !t.textContent.match(/\d+:\d+:\d+/) && (!i || parseFloat(t.style.left) - parseFloat(a[i - 1].style.left) >= 95),
    ),
  );
  check(
    'Duplicate toolbar timecode and zoom percentage are hidden',
    w.getComputedStyle($('timelineTime')).display === 'none' && w.getComputedStyle($('zoomValue')).display === 'none',
  );
  const row = id => T.rowFor(n.state, id),
    source = () => n.state.clips.find(c => c.id === 'shot');
  const afterMove = JSON.parse(g.moveEnd.clips),
    moved = afterMove.find(c => c.id === 'shot'),
    movedDoc = { clips: afterMove };
  check(
    'A trusted clip drag overwrites the occupied position',
    T.rowFor(movedDoc, 'shot').start === 84 && moved.in === 12 && moved.out === 60,
  );
  const fragments = T.layout(movedDoc).filter(r => r.clip.takeId === 'drag-take-0');
  check(
    'Covered footage survives on both sides at exact source offsets',
    JSON.stringify(fragments.map(r => [r.start, r.end, r.clip.in, r.clip.out])) ===
      JSON.stringify([
        [48, 84, 0, 36],
        [132, 168, 84, 120],
      ]),
  );
  check('Following edits stay in place after overwrite', T.rowFor(movedDoc, 'following').start === 168);
  const independent = () => n.state.clips.find(c => c.id !== 'shot' && c.takeId === 's15'),
    promoted = independent();
  check(
    'A trusted take drag creates a separate clip at the drop position',
    g.trustedTakeDrag && !!promoted && row(promoted.id).start === 192 && promoted.in === 0 && promoted.out === 120,
  );
  check(
    'Moved takes leave their original review list',
    !T.realTakes(source()).some(t => t.id === 's15') && source().takeId === 's04',
  );
  const recipe = await api('workflows/' + promoted.workflowVersion);
  check(
    'The independent clip adopts that take?s actual source and workflow',
    recipe.prompt['105:114'].inputs.image.startsWith(
      'spool-projects/' + n.projectKey + '/input/images/take-setup-s15-',
    ) && promoted.generationBase.takeId === 's15',
  );
  n.undo();
  await n.flush();
  check(
    'Undo restores the take list and removes the separate clip',
    !independent() && T.realTakes(source()).some(t => t.id === 's15'),
  );
  n.redo();
  await n.flush();
  check(
    'Redo restores the moved take without duplicating it',
    !!independent() && !T.realTakes(source()).some(t => t.id === 's15'),
  );
  n.selectClip('shot');
  const activeData = new w.DataTransfer(),
    activeButton = d.querySelector('[data-view="s04"]');
  activeButton.dispatchEvent(new w.DragEvent('dragstart', { dataTransfer: activeData, bubbles: true }));
  const activeScroll = $('timelineScroll').getBoundingClientRect(),
    activeTarget = d.querySelector('[data-clip="shot"]').getBoundingClientRect();
  $('timelineScroll').dispatchEvent(
    new w.DragEvent('drop', {
      dataTransfer: activeData,
      bubbles: true,
      cancelable: true,
      clientX: activeScroll.left + 1,
      clientY: activeTarget.top + 20,
    }),
  );
  await wait(() => !$('editor').inert && n.state.clips.some(c => c.id !== 'shot' && c.takeId === 's04'));
  await n.flush();
  check(
    'Moving the active take chooses a remaining take and clears its obsolete recipe',
    source()?.takeId === 'plain' && !source().workflowVersion && !T.realTakes(source()).some(t => t.id === 's04'),
  );
  n.undo();
  await n.flush();
  check(
    'Undo restores the active take and its workflow in one step',
    source()?.takeId === 's04' &&
      !!source().workflowVersion &&
      !n.state.clips.some(c => c.id !== 'shot' && c.takeId === 's04'),
  );
  const oldJobs = new Set(n.state.jobs.map(j => j.id)),
    parent = independent();
  n.selectClip(parent.id);
  await n.queueClips([parent]);
  await wait(async () => {
    await n.poll();
    return n.state.jobs.some(j => !oldJobs.has(j.id) && j.status === 'complete');
  });
  const generated = n.state.clips
    .find(c => c.id === parent.id)
    .takes.find(t => t.generated && !__timelineOriginal.jobs?.some(j => j.id === t.request?.attemptId));
  check('The independent clip can generate a real CPU result', !!generated);
  const data = new w.DataTransfer(),
    button = d.querySelector('[data-view="' + generated.id + '"]');
  button.dispatchEvent(new w.DragEvent('dragstart', { dataTransfer: data, bubbles: true }));
  const sc = $('timelineScroll').getBoundingClientRect(),
    target = d.querySelector('[data-clip="' + parent.id + '"]'),
    scale = target.getBoundingClientRect().width / (parent.out - parent.in),
    x = sc.left + Math.min(sc.width - 10, 24 * scale);
  $('timelineScroll').dispatchEvent(
    new w.DragEvent('drop', {
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: target.getBoundingClientRect().top + 20,
    }),
  );
  await wait(() => !$('editor').inert && n.state.clips.some(c => c.id !== parent.id && c.takeId === generated.id));
  await n.flush();
  const generatedClip = n.state.clips.find(c => c.id !== parent.id && c.takeId === generated.id);
  check(
    'Generated takes move with a specific durable receipt link',
    generatedClip.takeSourceTakeIds.includes(generated.id) &&
      !T.realTakes(n.state.clips.find(c => c.id === parent.id)).some(t => t.id === generated.id),
  );
  const stored = await api('projects/' + n.projectKey),
    savedClip = stored.document.clips.find(c => c.id === generatedClip.id);
  check(
    'Saved projection retains the generated take, evidence and independent workflow',
    savedClip.takes.some(t => t.id === generated.id) && savedClip.workflowVersion === generatedClip.workflowVersion,
  );
  const ids = new Set(savedClip.takes.map(t => t.id));
  n.selectClip(savedClip.id);
  await n.queueClips([n.state.clips.find(c => c.id === savedClip.id)]);
  await wait(async () => {
    await n.poll();
    return n.state.clips.find(c => c.id === savedClip.id)?.takes.some(t => t.generated && !ids.has(t.id));
  });
  const latest = n.state.clips.find(c => c.id === savedClip.id).takes.find(t => !ids.has(t.id));
  await n.chooseTake(savedClip.id, latest.id);
  await n.flush();
  const reopened = await api('projects/' + n.projectKey),
    kept = reopened.document.clips.find(c => c.id === savedClip.id);
  check(
    'Choosing a newer result keeps the original moved take after reload',
    kept.takeId === latest.id && kept.takes.some(t => t.id === generated.id),
  );
  check(
    'Take moves and overwrite edits create no accidental generation requests',
    n.state.jobs.filter(j => !oldJobs.has(j.id)).length === 2,
  );
  const current = await api('projects/' + n.projectKey);
  await api('projects/' + n.projectKey, { revision: current.revision, document: __timelineOriginal }, 'PUT');
  return { checks, generatedClipId: generatedClip.id };
})();
