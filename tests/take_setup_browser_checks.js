(async () => {
  const w = window,
    d = w.document,
    n = w.spoolNative,
    checks = [],
    check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    $ = id => d.getElementById(id),
    shot = () => n.state.clips.find(c => c.id === 'shot');
  const api = async (path, data, method) => {
    const r = await fetch('/spool/api/' + path, {
      method: method || (data ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
    });
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v;
  };
  const wait = async predicate => {
    const until = performance.now() + 30000;
    while (!(await predicate())) {
      if (performance.now() > until) throw Error('Take setup timed out');
      await new Promise(r => setTimeout(r, 100));
    }
  };
  n.selectClip('shot');
  await n.flush();
  const original = await api('projects/' + n.projectKey),
    oldVersion = shot().workflowVersion;
  check(
    'Workflow setup controls do not clutter the inspector',
    !$('clipWorkflow') && !d.querySelector('.workflow-advanced'),
  );
  check(
    'Custom setup is presented as a clip workflow',
    $('inspectorContent').querySelector('.clip-workflow-heading').textContent.includes('Clip workflow'),
  );
  n.viewTake('s15');
  check(
    'Preview keeps the selected take and generation setup',
    shot().takeId === 's04' && shot().workflowVersion === oldVersion,
  );
  await n.chooseTake('shot', 's04');
  await n.flush();
  let c = shot(),
    recipe = await api('workflows/' + c.workflowVersion);
  check(
    'Use the already-selected take replaces the stale setup',
    c.takeId === 's04' && c.generationBase.takeId === 's04' && c.workflowVersion !== oldVersion,
  );
  check(
    'Exact API source wins over stale nested editor widget',
    recipe.prompt['105:114'].inputs.image.startsWith(
      'spool-projects/' + n.projectKey + '/input/images/take-setup-s04-',
    ) && recipe.workflow.definitions.subgraphs[0].nodes[0].widgets_values[0] === recipe.prompt['105:114'].inputs.image,
  );
  check(
    'Source thumbnail and editable source control are visible',
    !!$('inspectorContent').querySelector('.native-source-preview') &&
      $('inspectorContent').querySelector('.native-source-preview').src.includes('take-setup-s04-'),
  );
  check(
    'Take workflow is ready without a setup chooser',
    $('inspectorContent').querySelector('.clip-workflow-heading').textContent.includes('Workflow from take') &&
      !$('generate').disabled,
  );
  n.undo();
  await n.flush();
  check(
    'Undo restores the previous edit and workflow together',
    shot().takeId === 's04' && shot().workflowVersion === oldVersion && !shot().generationBase,
  );
  n.redo();
  await n.flush();
  check('Redo restores the adopted generation base', shot().generationBase.takeId === 's04');
  await n.chooseTake('shot', 's15');
  await n.flush();
  recipe = await api('workflows/' + shot().workflowVersion);
  check(
    'Using another take updates both picture and source',
    shot().takeId === 's15' &&
      shot().generationBase.takeId === 's15' &&
      recipe.prompt['105:114'].inputs.image.startsWith(
        'spool-projects/' + n.projectKey + '/input/images/take-setup-s15-',
      ),
  );
  $('openWorkflow').click();
  check(
    'API-only take recipes can be opened in Comfy',
    [...d.querySelectorAll('[role="menuitem"]')].some(
      b => b.textContent.startsWith('Open workflow in Comfy') && !b.disabled,
    ),
  );
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await n.chooseTake('shot', 'plain');
  await n.flush();
  check(
    'Metadata-free footage clears the previous recipe and blocks generation',
    shot().takeId === 'plain' &&
      !shot().workflowVersion &&
      $('generate').disabled &&
      $('inspectorContent').textContent.includes('no executable metadata'),
  );
  await n.chooseTake('shot', 's04');
  await n.flush();
  const existing = new Set(shot().takes.map(t => t.id));
  await n.queueClips([shot()]);
  await wait(async () => {
    await n.poll();
    return shot().takes.some(t => t.generated && !existing.has(t.id));
  });
  const generated = shot().takes.find(t => t.generated && !existing.has(t.id));
  check('Real CPU generation adds a result without changing the selected take', !!generated && shot().takeId === 's04');
  const pixel = async src => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = d.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const color = await pixel('/spool/media/' + n.projectKey + '/' + generated.media.file);
  check(
    'Rendered pixels use the red S04 input instead of the blue S15 input',
    color[0] > 240 && color[1] < 15 && color[2] < 15,
  );
  await n.chooseTake('shot', generated.id);
  await n.flush();
  recipe = await api('workflows/' + shot().workflowVersion);
  check(
    'Using a generated result adopts its automatic workflow sidecar and executed frozen source',
    shot().generationBase.takeId === generated.id &&
      recipe.provenance.source === 'Workflow sidecar' &&
      !recipe.sidecar.needsSerialization &&
      recipe.prompt['105:114'].inputs.image.startsWith('spool-projects/' + n.projectKey + '/'),
  );
  const stored = await api('projects/' + n.projectKey);
  check(
    'Saved project retains selected take, base identity and exact recipe',
    stored.document.clips[0].takeId === generated.id &&
      stored.document.clips[0].generationBase.takeId === generated.id &&
      stored.document.clips[0].workflowVersion === shot().workflowVersion,
  );
  // Keep the shared fixture identical for the second editor mode.
  await api('projects/' + n.projectKey, { revision: stored.revision, document: original.document }, 'PUT');
  return { checks, color, attemptId: generated.request.attemptId, generatedTakeId: generated.id };
})();
