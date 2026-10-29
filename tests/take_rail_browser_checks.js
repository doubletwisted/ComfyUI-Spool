// Synthetic jobs on a clip with real takes: rendering and failed takes on the rail,
// the failure announcement, compact takes, the status bar and readable Activity.
(async () => {
  const w = window,
    n = w.spoolNative,
    d = w.document,
    $ = id => d.getElementById(id),
    checks = [],
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
  const wait = async (predicate, label) => {
    const end = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > end) throw Error(label + ' timed out: ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  n.selectClip('shot');
  await n.flush();
  const now = Date.now() / 1000,
    base = { clipId: 'shot', target: 'local', createdAt: now - 90, nodeProgress: [] },
    error =
      'API key authentication is not available for free tier accounts. Running on Comfy Cloud needs a paid plan; use Partner Nodes on this ComfyUI instead.',
    jobs = [
      { ...base, id: 'rail-running', takeNumber: 3, status: 'running', nodeProgress: [{ id: '3', value: 6, max: 8 }] },
      { ...base, id: 'rail-waiting', takeNumber: 4, status: 'queued' },
      { ...base, id: 'rail-farm', takeNumber: 5, status: 'farm_queued', target: 'deadline' },
      { ...base, id: 'rail-failed', takeNumber: 6, status: 'failed', finishedAt: now, error },
    ];
  const original = w.fetch;
  w.fetch = async (input, options) => {
    const path = new URL(String(input), location.href).pathname;
    if (path === '/spool/api/projects/' + n.projectKey && (!options?.method || options.method === 'GET')) {
      const headers = new Headers(options?.headers);
      headers.delete('X-Spool-Since');
      const value = await original(input, { ...options, headers }).then(r => r.json());
      value.document.jobs = jobs;
      return new Response(JSON.stringify(value), { status: 200 });
    }
    return original(input, options);
  };
  try {
    await n.poll();
    await wait(() => d.querySelector('[data-pending-job="rail-failed"]'), 'Take rail rows');
    const row = id => d.querySelector('[data-pending-job="' + id + '"]'),
      stage = id => row(id).querySelector('.take-pending-stage');
    await wait(() => /Take 06 failed: API key authentication/.test($('toast').textContent), 'Failure toast');
    checks.push('A take that fails while Spool is open is announced with its clip, take and reason');
    check(
      'Failed takes lead the rail, then rendering takes, each in its own state',
      ['failed', 'running', 'waiting', 'waiting'].join() ===
        [...d.querySelectorAll('[data-pending-job]')].map(r => r.dataset.state).join(),
    );
    check('A running take shows its percent and progress', /75%/.test(row('rail-running').textContent));
    check(
      'Stages are never cut off',
      ['rail-running', 'rail-waiting', 'rail-farm'].every(id => stage(id).scrollWidth <= stage(id).clientWidth + 1),
    );
    check(
      'Pending rows are compact, without a placeholder thumbnail',
      row('rail-waiting').getBoundingClientRect().height < 48 && !d.querySelector('.take-pending-thumb'),
    );
    const reason = row('rail-failed').querySelector('.take-pending-error');
    check('A failed take shows why on the rail', reason?.title === error && reason.getClientRects().length > 0);
    check(
      'The Renders button counts the failure',
      $('renderFailures').textContent === '1' && /1 failed/.test($('showQueue').getAttribute('aria-label')),
    );
    row('rail-failed').querySelector('[data-dismiss-render]').click();
    await wait(() => !row('rail-failed'), 'Dismiss');
    check(
      'Dismissing a failed take clears it from the rail and Renders',
      n.state.clearedRenderIds.includes('rail-failed') && $('renderFailures').textContent === '',
    );

    const card = d.querySelector('.take-card'),
      tall = card.getBoundingClientRect().height;
    $('compactTakes').click();
    check(
      'Compact takes make each tile shorter and are remembered',
      $('takes').classList.contains('compact-takes') &&
        card.getBoundingClientRect().height < tall * 0.8 &&
        localStorage.getItem('spool-compact-takes') === '1',
    );
    $('compactTakes').click();
    check('Compact takes switch back', Math.abs(card.getBoundingClientRect().height - tall) < 1);

    check(
      'The status bar has one line: work in progress or the last edit, never a resting Ready',
      $('status').closest('.footer').contains($('processingStatus')) &&
        !d.querySelector('.topbar').contains($('processingStatus')) &&
        !/Ready/.test($('status').textContent),
    );

    $('projectMenu').click();
    $('projectActivity').click();
    await wait(() => $('modal').classList.contains('activity-dialog'), 'Activity');
    check(
      'Activity reads as sentences, with the raw event folded away',
      !!$('modal').querySelector('.activity-list, .setup-note') &&
        [...$('modal').querySelectorAll('.activity-row details')].every(e => !e.open),
    );
    $('closeModal').click();
  } finally {
    w.fetch = original;
  }
  return { checks };
})();
