// Controlled observations and retry responses; actual QA project reads, no generation.
(async () => {
  const w = window,
    n = w.spoolNative,
    d = w.document,
    $ = id => d.getElementById(id) || n.dialogRoot.getElementById(id),
    active = () => n.dialogRoot.activeElement,
    checks = [];
  const check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    visible = el => {
      if (!el?.getClientRects().length) return false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement)
        if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector('summary')?.contains(el))
          return false;
      return true;
    };
  await n.flush();
  const revision = n.revision,
    clips = JSON.stringify(n.state.clips),
    key = 'spool-native-' + n.projectKey + ':queue-request',
    pending = !!sessionStorage.getItem(key);
  const prefix = d.getElementById('editor').classList.contains('compact') ? 'compact-' : 'full-';
  const now = Date.now() / 1000,
    job = {
      id: prefix + 'ui-running',
      clipId: 'shot',
      name: 'Pasted image 2026-10-16-14-26-23.png',
      takeNumber: 12,
      status: 'running',
      target: 'local',
      createdAt: now - 20,
      promptId: 'qa-prompt',
      seeds: [{ label: 'Seed', value: { __spool_int__: '18446744073709551615' } }],
      nodeProgress: [
        { id: 'steps', label: 'If/Else Switch (Steps)', value: 1, max: 1 },
        { id: 'model', label: 'If/Else Switch (Model)', value: 1, max: 1 },
        { id: 'clip', label: 'CLIPLoader', value: 1, max: 1 },
      ],
    };
  const past = {
      ...job,
      id: prefix + 'ui-complete',
      takeNumber: 11,
      status: 'complete',
      finishedAt: now - 5,
      nodeProgress: [],
    },
    farm = {
      ...job,
      id: prefix + 'ui-farm',
      takeNumber: 13,
      status: 'farm_running',
      target: 'deadline',
      nodeProgress: [],
      farmProgress: { percent: 85, worker: 'render-02', message: 'Step 17/20', observedAt: now },
    };
  let jobs = [past, job, farm],
    refreshes = 0,
    attempts = [];
  const original = w.fetch;
  w.fetch = async (input, options) => {
    const path = new URL(String(input), location.href).pathname;
    if (path === '/spool/api/reconcile') {
      refreshes++;
      return new Response('{}', { status: 200 });
    }
    if (path === '/spool/api/projects/' + n.projectKey + '/queue') {
      attempts.push(JSON.parse(options.body));
      if (attempts.length === 1)
        return new Response(JSON.stringify({ error: 'Controlled lost submission response' }), { status: 503 });
      const value = await original('/spool/api/projects/' + n.projectKey).then(r => r.json());
      value.document.jobs = jobs;
      return new Response(JSON.stringify(value), { status: 200 });
    }
    // Synthetic job identities require a full snapshot; unchanged sync only updates existing jobs.
    if (path === '/spool/api/projects/' + n.projectKey && (!options?.method || options.method === 'GET')) {
      const headers = new Headers(options?.headers);
      headers.delete('X-Spool-Since');
      options = { ...options, headers };
    }
    const response = await original(input, options);
    if (
      path === '/spool/api/projects/' + n.projectKey &&
      (!options?.method || ['GET', 'PUT'].includes(options.method))
    ) {
      const value = await response.json();
      if (value.document) value.document.jobs = jobs;
      else value.jobs = jobs;
      return new Response(JSON.stringify(value), { status: response.status });
    }
    return response;
  };
  try {
    await n.poll();
    $('showQueue').click();
    const row = () => $('queueList').querySelector('[data-render="' + prefix + 'ui-running"]'),
      details = () => row().querySelector('details');
    check(
      'Default queue focuses on a compact render status',
      $('rendersTitle').textContent === 'Renders' &&
        row().querySelector('.render-stage').textContent === 'Generating' &&
        row().textContent.includes('Take 12'),
    );
    check(
      'Node names, actions and exact seeds stay inside the collapsed take row',
      !visible(row().querySelector('.job-node')) &&
        !visible(row().querySelector('.job-seeds')) &&
        !visible(row().querySelector('.render-row-actions')),
    );
    const farmRow = () => $('queueList').querySelector('[data-render="' + prefix + 'ui-farm"]');
    check(
      'Worker-reported farm progress is visible without expanding a row',
      farmRow().querySelector('.render-percent').textContent === '85%' &&
        farmRow().querySelector('progress').value === 85,
    );
    check(
      'A shot name appears once above its active takes',
      $('queueList').querySelectorAll(':scope > .render-shot').length === 1 &&
        row().closest('.render-shot') === farmRow().closest('.render-shot') &&
        row().getBoundingClientRect().height < 70,
    );
    farm.farmProgress.percent = 90;
    await n.poll();
    check(
      'Farm progress updates through normal polling',
      farmRow().querySelector('.render-percent').textContent === '90%',
    );
    check(
      'Completed renders stay in collapsed history',
      !$('queueList').querySelector('.render-history').open &&
        !visible($('queueList').querySelector('[data-render="' + prefix + 'ui-complete"]')),
    );
    check(
      'Bulk queue and retry controls do not crowd normal status',
      !visible($('queueAll')) &&
        visible($('retryQueue')) === pending &&
        !$('rendersPanel').querySelector('.modal-footer'),
    );
    check(
      'Renders leaves the edit usable: no modal overlay and the editor stays interactive',
      $('modalOverlay').hidden && !$('editor').inert && $('showQueue').getAttribute('aria-expanded') === 'true',
    );
    const box = $('rendersPanel').getBoundingClientRect();
    check(
      'Renders panel fits the viewport without horizontal overflow',
      box.width <= 560 &&
        box.left >= 0 &&
        box.right <= innerWidth + 1 &&
        $('rendersPanel').scrollWidth <= $('rendersPanel').clientWidth,
    );
    details().open = true;
    details().querySelector('summary').focus();
    check(
      'Details preserve exact seeds and execution records',
      visible(row().querySelector('.job-seeds')) &&
        row().querySelector('.job-seeds').textContent.includes('18446744073709551615') &&
        !!row().querySelector('a[href$="/attempts/' + prefix + 'ui-running"]'),
    );
    job.nodeProgress = [{ id: 'sampler', label: 'Sampler', value: 3, max: 8 }];
    await n.poll();
    check(
      'Current node progress is compact while exact steps remain in Details',
      row().querySelector('progress')?.value === 37.5 &&
        row().querySelector('.render-percent').textContent === '38%' &&
        row().querySelector('.job-node').textContent.includes('3 of 8') &&
        row().querySelector('.render-stage').textContent === 'Generating',
    );
    check(
      'Progress updates preserve open Details and keyboard focus',
      details().open && active() === details().querySelector('summary'),
    );
    const summary = details().querySelector('summary');
    await n.poll();
    check('Unchanged observations retain the existing row DOM', details().querySelector('summary') === summary);
    const history = $('queueList').querySelector('.render-history');
    history.open = true;
    job.nodeProgress[0].value = 4;
    await n.poll();
    check('History stays open when another render advances', $('queueList').querySelector('.render-history').open);
    job.status = 'collection_pending';
    job.error = 'Output is ready but its preview could not be collected.\nControlled collection error';
    job.nodeProgress = [];
    await n.poll();
    check(
      'Collection failures expose a relevant recovery action',
      !!row().querySelector('[data-retry-collection]') &&
        row().querySelector('.render-stage').textContent === 'Collection needs retry' &&
        row().querySelector('.render-error').textContent.includes('Controlled collection error'),
    );
    await row().querySelector('[data-retry-collection]').onclick();
    check('Retry collection never submits another render', refreshes === 1 && attempts.length === 0);
    job.status = 'failed';
    await n.poll();
    check(
      'Failed renders stay visible and readable',
      visible(row()) &&
        row().querySelector('.render-stage').textContent === 'Generation failed' &&
        $('queueSummary').textContent.includes('1 needs attention'),
    );
    job.status = 'waiting_for_host';
    delete job.error;
    await n.poll();
    check(
      'Waiting requests retain their cancel control',
      !!row().querySelector('[data-cancel-attempt="' + prefix + 'ui-running"]'),
    );
    job.status = 'submission_uncertain';
    job.target = 'deadline';
    await n.poll();
    check(
      'Uncertain farm submissions retain explicit recovery',
      !!row().querySelector('[data-recover-submission="' + prefix + 'ui-running"]'),
    );
    if (pending) {
      await $('retryQueue').onclick();
      check(
        'Failed retry keeps its original submission available',
        !$('retryQueue').disabled && !!sessionStorage.getItem(key),
      );
      await $('retryQueue').onclick();
      check(
        'Successful retry reuses the exact request and hides its action',
        JSON.stringify(attempts[0]) === JSON.stringify(attempts[1]) &&
          attempts[1].operationId === 'ui-queue-retry' &&
          !sessionStorage.getItem(key) &&
          !visible($('retryQueue')) &&
          active() === $('reconcileQueue'),
      );
    }
    check(
      'Browsing and recovery presentation preserve the edit',
      n.revision === revision && JSON.stringify(n.state.clips) === clips,
    );
    const failed = { ...job, id: prefix + 'clear-failed', status: 'failed' },
      cancelled = { ...job, id: prefix + 'clear-cancelled', status: 'cancelled' },
      cancelling = { ...job, id: prefix + 'clear-cancelling', status: 'cancel_requested' },
      live = { ...job, id: prefix + 'keep-running', status: 'farm_running' },
      recover = { ...job, id: prefix + 'keep-collection', status: 'collection_pending' };
    jobs = [past, failed, cancelled, cancelling, live, recover];
    await n.poll();
    const cleared = id => !$('queueList').querySelector('[data-render="' + prefix + id + '"]'),
      undoLabel = $('undo').title,
      submissionCount = attempts.length;
    check(
      'Only finished and cancellation-requested rows offer Clear',
      !!$('queueList').querySelector('[data-clear-render="' + prefix + 'clear-failed"]') &&
        !$('queueList').querySelector('[data-clear-render="' + prefix + 'keep-running"]') &&
        !$('queueList').querySelector('[data-clear-render="' + prefix + 'keep-collection"]'),
    );
    await $('queueList')
      .querySelector('[data-clear-render="' + prefix + 'clear-failed"]')
      .onclick(new MouseEvent('click', { cancelable: true }));
    check(
      'Individual Clear removes only that entry, preserving the edit and Undo',
      cleared('clear-failed') &&
        !cleared('clear-cancelled') &&
        JSON.stringify(n.state.clips) === clips &&
        $('undo').title === undoLabel,
    );
    await $('queueList')
      .querySelector('[data-clear-render="' + prefix + 'clear-cancelling"]')
      .onclick(new MouseEvent('click', { cancelable: true }));
    check(
      'A pending cancellation can be cleared without changing its execution state',
      cleared('clear-cancelling') &&
        n.state.jobs.find(j => j.id === prefix + 'clear-cancelling').status === 'cancel_requested',
    );
    await $('clearFinishedRenders').onclick();
    check(
      'Clear finished removes history and failures but keeps active renders and collection retries',
      cleared('ui-complete') &&
        cleared('clear-cancelled') &&
        !cleared('keep-running') &&
        !cleared('keep-collection') &&
        $('clearFinishedRenders').disabled,
    );
    const stored = await original('/spool/api/projects/' + n.projectKey).then(r => r.json());
    check(
      'Queue clearing persists in the project without submitting jobs',
      stored.document.clearedRenderIds.includes(prefix + 'clear-failed') &&
        stored.document.clearedRenderIds.includes(prefix + 'clear-cancelling') &&
        attempts.length === submissionCount,
    );
    failed.status = 'collection_pending';
    await n.poll();
    check(
      'New recovery needs reappear even if an earlier terminal state was cleared',
      !cleared('clear-failed') &&
        !!$('queueList').querySelector('[data-render="' + prefix + 'clear-failed"] [data-retry-collection]'),
    );
    jobs = [];
    await n.poll();
    check(
      'Empty queue has a brief useful state',
      $('queueSummary').textContent === 'No renders yet' &&
        $('queueList').textContent.includes('Generated takes will appear here'),
    );
    jobs = [
      { ...past, id: prefix + 'ui-recent-uncleared' },
      {
        ...job,
        status: 'running',
        target: 'local',
        nodeProgress: [{ id: 'clip', label: 'CLIPLoader', value: 1, max: 1 }],
      },
      {
        ...failed,
        id: prefix + 'ui-failed-uncleared',
        status: 'failed',
        error: 'A render failed. Clear it from the queue.',
      },
    ];
    await n.poll();
    $('queueList').querySelector('.render-history').open = false;
    const clearButton = $('queueList').querySelector('[data-clear-render="' + prefix + 'ui-failed-uncleared"]'),
      clearBox = clearButton.getBoundingClientRect();
    check(
      'Individual Clear remains visible and fits narrow rows',
      visible(clearButton) &&
        clearBox.right <= $('rendersPanel').getBoundingClientRect().right &&
        $('rendersPanel').scrollWidth <= $('rendersPanel').clientWidth,
    );
    $('closeRenders').focus();
    $('closeRenders').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    check(
      'Escape closes the Renders panel and returns focus to its button',
      $('rendersPanel').hidden && active() === $('showQueue'),
    );
    return { checks, kind: 'Controlled queue observations; real QA project reads; no generation' };
  } finally {
    w.fetch = original;
  }
})();
