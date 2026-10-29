(async () => {
  const n = spoolNative,
    $ = selector => document.querySelector(selector),
    checks = [],
    c = () => n.state.clips.find(c => c.id === 'shot');
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async fn => {
      const end = Date.now() + 15000;
      while (!fn()) {
        if (Date.now() > end) throw Error('ControlNet video: ' + $('#toast').textContent);
        await new Promise(r => setTimeout(r, 20));
      }
    };
  const template = 'video_minimax_h3_fun_controlnet_union',
    card = () => $('[data-builtin="' + template + '"]');
  await wait(card);
  const original = JSON.stringify({ takes: c().takes, takeId: c().takeId, in: c().in, out: c().out }),
    node = $('[data-clip="shot"]'),
    r = node.getBoundingClientRect(),
    dt = new DataTransfer();
  dt.setData('application/spool', JSON.stringify({ builtin: template }));
  node.dispatchEvent(
    new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  );
  await wait(() => c().workflowVersion);
  await n.flush();
  if (!$('#inspector').getClientRects().length) $('#showRightPanel').click();
  const binding = c().bindings.find(b => b.slot === 'video'),
    field = () => $('[data-media-input]'),
    timeline = () => field().querySelector('[data-use-timeline-video]'),
    source = () => field().querySelector('[data-media-source]').textContent;
  check(
    'Dropping ControlNet Union on video automatically links its selected take',
    c().shotInputs.some(s => s.key === binding.key && s.source === 'selected'),
  );
  check(
    'Inspector displays the assigned timeline source instead of Choose video',
    source() === 'Timeline video · Timeline control clip' &&
      timeline().getAttribute('aria-pressed') === 'true' &&
      !timeline().disabled,
  );
  check(
    'Workflow assignment preserves the take and timeline trim',
    JSON.stringify({ takes: c().takes, takeId: c().takeId, in: c().in, out: c().out }) === original,
  );
  const state = await fetch('/spool/api/projects/' + n.projectKey).then(r => r.json());
  const preview = await fetch('/spool/api/projects/' + n.projectKey + '/generation-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: state.revision, clipId: 'shot' }),
  }).then(async r => {
    const v = await r.json();
    if (!r.ok) throw Error(v.error);
    return v;
  });
  check(
    'Generation preview bakes this clip’s video slot',
    preview.assets.some(a => a.nodeId === binding.nodeId && a.input === binding.input && a.frozen.endsWith('.mp4')),
  );
  const asset = preview.assets.find(a => a.nodeId === binding.nodeId && a.input === binding.input),
    video = document.createElement('video');
  video.muted = true;
  video.src = '/spool/api/input/' + encodeURIComponent(asset.frozen);
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(Error('Baked video did not load'));
  });
  check(
    'Generation uses the 30-frame timeline trim interpreted at 30 FPS',
    Math.abs(video.duration - 1) < 0.02 && video.videoWidth === 96 && video.videoHeight === 64,
  );
  const bytes = await fetch('/spool/media/' + n.projectKey + '/' + encodeURI(c().takes[0].media.originalFile)).then(r =>
      r.arrayBuffer(),
    ),
    upload = async () => {
      const picker = field().querySelector('input'),
        files = new DataTransfer();
      files.items.add(new File([bytes], 'external-control.mp4', { type: 'video/mp4' }));
      picker.files = files.files;
      await picker.onchange();
    };
  await upload();
  await n.flush();
  check(
    'Choosing an external file replaces timeline routing and shows its filename',
    !c().shotInputs.some(s => s.key === binding.key) &&
      source().includes('external-control') &&
      timeline().getAttribute('aria-pressed') === 'false',
  );
  const external = c().inputValues[binding.key];
  timeline().click();
  await n.flush();
  check(
    'Use timeline video restores routing with no file selection',
    c().shotInputs.some(s => s.key === binding.key && s.source === 'selected') &&
      source().startsWith('Timeline video') &&
      timeline().getAttribute('aria-pressed') === 'true',
  );
  check('The source button retains keyboard focus after repaint', document.activeElement === timeline());
  n.undo();
  await n.flush();
  check(
    'One Undo restores the external file source',
    !c().shotInputs.some(s => s.key === binding.key) &&
      c().inputValues[binding.key] === external &&
      timeline().getAttribute('aria-pressed') === 'false',
  );
  n.redo();
  await n.flush();
  check(
    'Redo restores timeline video routing',
    c().shotInputs.some(s => s.key === binding.key && s.source === 'selected') &&
      timeline().getAttribute('aria-pressed') === 'true',
  );
  const saved = await fetch('/spool/api/projects/' + n.projectKey).then(r => r.json());
  check(
    'Timeline source selection persists in the saved project',
    saved.document.clips
      .find(c => c.id === 'shot')
      .shotInputs.some(s => s.key === binding.key && s.source === 'selected'),
  );
  n.undo();
  await n.flush();
  const realFetch = window.fetch;
  let entered = false,
    release;
  const gate = new Promise(resolve => (release = resolve));
  window.fetch = async (input, options) => {
    if (String(input).endsWith('/input')) {
      entered = true;
      await gate;
    }
    return realFetch(input, options);
  };
  try {
    const pending = upload();
    await wait(() => entered);
    timeline().click();
    release();
    await pending;
    await n.flush();
    check(
      'A late upload cannot replace a newer timeline source choice',
      c().shotInputs.some(s => s.key === binding.key && s.source === 'selected') &&
        source().startsWith('Timeline video') &&
        $('#toast').textContent.includes('changed while uploading'),
    );
  } finally {
    release();
    window.fetch = realFetch;
  }
  entered = false;
  const reaffirmGate = new Promise(resolve => (release = resolve));
  window.fetch = async (input, options) => {
    if (String(input).endsWith('/input')) {
      entered = true;
      await reaffirmGate;
    }
    return realFetch(input, options);
  };
  try {
    const before = JSON.stringify({ inputs: c().inputValues, sources: c().shotInputs, revision: c().revision }),
      pending = upload();
    await wait(() => entered);
    timeline().click();
    release();
    await pending;
    await n.flush();
    check(
      'Reaffirming an already selected timeline video invalidates a pending upload without editing the clip',
      JSON.stringify({ inputs: c().inputValues, sources: c().shotInputs, revision: c().revision }) === before &&
        timeline().getAttribute('aria-pressed') === 'true' &&
        $('#toast').textContent.includes('changed while uploading'),
    );
  } finally {
    release();
    window.fetch = realFetch;
  }
  card().click();
  await wait(() => n.state.clips.length === 2);
  await n.flush();
  check(
    'An ungenerated shot clearly has no source and cannot supply timeline video',
    source() === 'No video selected' && timeline().disabled && timeline().getAttribute('aria-pressed') === 'false',
  );
  check('Source assignment and preview submit no render jobs', !n.state.jobs.length);
  video.removeAttribute('src');
  video.load();
  return { checks };
})();
