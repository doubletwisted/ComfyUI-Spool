// Opt-in paid check: one real Comfy Cloud generation through the studio. LTX-2.5
// text to video, 2 seconds at 1280x720, one take. The runner refuses it unless
// SPOOL_CLOUD_SMOKE=1; give the host its key through COMFY_API_KEY. Set
// SPOOL_CLOUD_SMOKE_TARGET=local to run it as Partner Nodes on the host instead of
// the Developer Platform (which free-tier accounts cannot use).
(async () => {
  const n = window.spoolNative,
    $ = id => document.getElementById(id),
    checks = [],
    target = window.__cloudSmokeTarget || 'cloud';
  const check = (label, value) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const wait = async (predicate, label, ms = 20000) => {
    const end = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > end) throw Error(label + ' timed out: ' + ($('toast')?.textContent || ''));
      await new Promise(r => setTimeout(r, 500));
    }
  };
  const clip = () => n.state.clips[0],
    control = label =>
      [...$('inspectorContent').querySelectorAll('[data-native-control]')].find(field =>
        field.closest('label')?.textContent.trim().startsWith(label),
      );
  const set = (field, value) => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  await wait(() => document.querySelector('[data-builtin="api_ltx2_5_t2v"]'), 'Cloud card');
  document.querySelector('[data-builtin="api_ltx2_5_t2v"]').click();
  await wait(() => n.state.clips.length === 1 && clip().workflowVersion, 'Cloud card preparation');
  n.selectClip(clip().id);
  await n.flush();
  check('The Cloud card defaults to Comfy Cloud', $('clipExecutionTarget').value === 'cloud');
  if (target === 'local') {
    set($('clipExecutionTarget'), 'local');
    await n.flush();
  }
  check(
    'The clip runs on ' + (target === 'local' ? 'Local ComfyUI Partner Nodes' : 'Comfy Cloud'),
    clip().executionTarget === target,
  );
  check('The host reports a Cloud key', (await (await fetch('/spool/api/comfy')).json()).hasApiKey);

  set(control('Duration'), '2');
  set(control('Prompt'), 'A paper boat drifting across a calm pond at sunrise, gentle ripples, soft light.');
  await n.flush();
  const values = clip().inputValues;
  check('The shortest duration is set', values['3/model.duration'] === '2');
  check('The lowest resolution is kept', (values['3/model.resolution'] ?? '1280x720') === '1280x720');
  check('The prompt is set', values['3/prompt'].startsWith('A paper boat'));
  check('Generate is ready', !$('generate').disabled && !$('generateReason')?.textContent.trim());

  const placeholder = clip().takeId,
    started = Date.now();
  $('generate').click();
  await wait(() => n.state.jobs.length === 1, 'Cloud submission');
  const job = () => n.state.jobs[0];
  check('One request is accepted for that target', job().target === target && n.state.jobs.length === 1);
  await wait(
    async () => {
      await n.poll();
      return ['complete', 'failed', 'cancelled', 'uncertain'].includes(job().status);
    },
    'Cloud render',
    20 * 60 * 1000,
  );
  if (job().status !== 'complete') throw Error('The Cloud render ended ' + job().status + ': ' + (job().error || ''));
  check('The Cloud render completes', true);
  const take = clip().takes.find(t => !t.placeholder);
  check('The result arrives as a take on the clip', !!take && take.media.kind === 'video');
  check('The new take does not replace the take in the edit', clip().takeId === placeholder);
  check('The take is about two seconds long', take.media.frames >= 40 && take.media.frames <= 60);
  return {
    checks,
    target,
    jobId: job().id,
    takeId: take.id,
    media: take.media.file,
    frames: take.media.frames,
    seconds: Math.round((Date.now() - started) / 1000),
  };
})();
