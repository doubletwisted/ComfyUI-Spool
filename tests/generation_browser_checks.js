// Run only in Generation controls QA, in the full editor or actual Comfy dock.
(async () => {
  const w = window,
    d = w.document,
    n = w.spoolNative,
    $ = id => d.getElementById(id),
    root = () => n.dialogRoot,
    field = id => root().getElementById(id),
    checks = [];
  if (n?.state.project !== 'Generation controls QA') throw Error('Use Generation controls QA');
  const check = (ok, label) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async fn => {
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        if (await fn()) return;
        await new Promise(r => setTimeout(r, 40));
      }
      throw Error('Generation timeout: ' + $('toast').textContent);
    },
    edit = (id, value) => {
      const e = $(id);
      e.value = value;
      e.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    read = () => w.fetch('/spool/api/projects/' + n.projectKey).then(r => r.json());
  if (!field('modalOverlay').hidden) field('closeModal').click();
  n.selectClip('shot');
  await n.flush();
  check(
    $('inspectorContent').querySelector('[data-exact-integer]').value === '18446744073709551615',
    'Summary shows the exact saved uint64 seed',
  );
  const seedMode = value => {
    const field = d.querySelector('[data-seed-mode]');
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  seedMode('same');
  edit('nativeCount', '3');
  await n.flush();
  const before = await read(),
    jobsBefore = before.document.jobs.length;
  const preview = await w
    .fetch('/spool/api/projects/' + n.projectKey + '/generation-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: before.revision, clipId: 'shot' }),
    })
    .then(async response => {
      const value = await response.json();
      if (!response.ok) throw Error(value.error);
      return value;
    });
  const image = new Image();
  image.src = '/spool/api/input/' + encodeURIComponent(preview.assets[0].frozen);
  await image.decode();
  check(image.naturalWidth === 64, 'Actual input preview decodes the 64-pixel source');
  check(
    JSON.stringify(await read()) === JSON.stringify(before),
    'Preparing actual inputs changes no authored project, takes or queue',
  );
  $('generate').click();
  await wait(() => !field('modalOverlay').hidden && field('generationReviewQueue'));
  check(
    root().getElementById('modal').textContent.includes('Seed is Fixed, so all 3 takes use seed 18446744073709551615'),
    'Same-settings batches warn that their takes repeat before submission',
  );
  root().querySelector('[data-vary-seeds="shot"]').click();
  await wait(() => !root().querySelector('[data-vary-seeds]') && field('generationReviewQueue'));
  check(
    (await read()).document.clips[0].seedMode === 'increment' &&
      [...root().querySelectorAll('.review-seeds li')].map(li => li.textContent).join() === '0,1,2',
    'The repeat warning switches the shot to incrementing seeds and redraws the review',
  );
  field('generationReviewCancel').click();
  check((await read()).document.jobs.length === jobsBefore, 'Cancelling generation review submits nothing');
  seedMode('increment');
  await n.flush();
  const saved = await read();
  check(saved.document.clips[0].seedMode === 'increment', 'Seed choice persists in the shared shot');
  $('generate').click();
  await wait(() => !field('modalOverlay').hidden && field('generationReviewQueue'));
  check(
    [...root().querySelectorAll('.review-seeds li')].map(li => li.textContent).join() === '0,1,2',
    'Batch review increments before generation and wraps uint64 to 0, 1, 2',
  );
  const fetch = w.fetch;
  let queuedBody,
    lost = false;
  try {
    w.fetch = async (url, options) => {
      const response = await fetch(url, options);
      if (String(url).endsWith('/queue') && !lost) {
        queuedBody = JSON.parse(options.body);
        lost = true;
        throw Error('QA response lost after server acceptance');
      }
      return response;
    };
    await field('generationReviewQueue').onclick();
  } finally {
    w.fetch = fetch;
  }
  check(
    lost && (await read()).document.jobs.length === jobsBefore + 3,
    'Native queue accepts exactly the reviewed three requests despite a lost response',
  );
  field('generationReviewCancel').click();
  $('showQueue').click();
  check(!field('retryQueue').disabled, 'Lost acceptance offers an explicit retry');
  await field('retryQueue').onclick();
  check((await read()).document.jobs.length === jobsBefore + 3, 'Retrying acceptance creates no duplicate attempts');
  let after;
  await wait(async () => {
    after = await read();
    return after.document.jobs.slice(jobsBefore).every(j => j.status === 'complete');
  });
  await n.poll();
  const jobs = after.document.jobs.slice(jobsBefore),
    requests = await Promise.all(jobs.map(j => w.fetch('/spool/api/attempts/' + j.id).then(r => r.json())));
  check(
    requests.map(a => String(a.request.inputValues.seed?.__spool_int__ ?? a.request.inputValues.seed)).join('|') ===
      '0|1|2',
    'Real CPU attempts freeze the exact reviewed seeds',
  );
  check(
    after.document.clips[0].takeId === 'original' &&
      String(after.document.clips[0].inputValues.seed?.__spool_int__ ?? after.document.clips[0].inputValues.seed) ===
        '2',
    'Accepted retry advances Increment seeds once and preserves the chosen take',
  );
  check(
    jobs.every(j => j.takeNumber && j.createdAt && j.finishedAt && j.seeds.length === 1),
    'Collected jobs expose stable take numbers, seed values and durable elapsed bounds',
  );
  const duration = field('queueList').querySelector('[data-job-elapsed="' + jobs[0].id + '"]').textContent;
  await n.poll();
  await n.poll();
  check(
    field('queueList').querySelector('[data-job-elapsed="' + jobs[0].id + '"]').textContent === duration,
    'Completed take elapsed time stays fixed across polls',
  );
  check(
    field('queueList').textContent.includes('Ready') && !field('queueList').textContent.includes('frozen /'),
    'Queue uses readable stages and inspectable execution details',
  );
  const chosen = n.state.jobs.find(j => j.id === jobs[0].id),
    snapshot = JSON.parse(JSON.stringify(chosen));
  Object.assign(chosen, {
    status: 'running',
    nodeProgress: [{ id: 'noise', label: 'ImageAddNoise', value: 3, max: 8 }],
    finishedAt: null,
  });
  if (!$('rendersPanel').hidden) $('closeRenders').click();
  $('showQueue').click();
  check(
    field('queueList').querySelector('progress')?.value === 37.5 && field('queueList').textContent.includes('3 of 8'),
    'Observed node progress is shown as node steps, separate from job stage',
  );
  Object.keys(chosen).forEach(k => delete chosen[k]);
  Object.assign(chosen, snapshot);
  if (!$('rendersPanel').hidden) $('closeRenders').click();
  $('showQueue').click();
  root().getElementById('closeRenders').click();
  await n.poll();
  return {
    compact: $('editor').classList.contains('compact'),
    checks,
    project: n.projectKey,
    jobIds: jobs.map(j => j.id),
    queuedBody,
  };
})();
