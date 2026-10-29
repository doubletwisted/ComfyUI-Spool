(async () => {
  const n = window.spoolNative,
    $ = id => document.getElementById(id),
    checks = [],
    timings = [],
    requests = [],
    tasks = [];
  const check = (label, ok) => {
    if (!ok) throw Error(label);
    checks.push(label);
  };
  const wait = async predicate => {
    const end = performance.now() + 120000;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Insertion timeout: ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  await wait(() => document.querySelector('[data-builtin="video_ltx2_5_i2v"]'));
  await n.flush();
  const takeSignature = c => JSON.stringify([...c.takes].sort((a, b) => a.id.localeCompare(b.id)));
  const originalTakes = new Map(n.state.clips.map(c => [c.id, takeSignature(c)])),
    jobCount = n.state.jobs.length;
  const observer = new PerformanceObserver(list =>
    tasks.push(...list.getEntries().map(t => ({ start: Math.round(t.startTime), ms: Math.round(t.duration) }))),
  );
  observer.observe({ type: 'longtask' });
  const original = window.fetch;
  window.fetch = async (input, options) => {
    const start = performance.now(),
      response = await original(input, options);
    requests.push({
      path: String(input),
      method: options?.method || 'GET',
      ms: Math.round(performance.now() - start),
      serverTiming: response.headers.get('Server-Timing'),
    });
    return response;
  };
  try {
    for (const id of [
      'video_minimax_h3_i2v',
      'video_minimax_h3_i2v',
      'video_ltx2_5_i2v',
      'video_ltx2_5_i2v',
      'api_ltx2_5_t2v',
    ]) {
      const before = n.state.clips.length,
        start = performance.now(),
        requestStart = requests.length,
        taskStart = tasks.length;
      document.querySelector('[data-builtin="' + id + '"]').click();
      await wait(() => n.state.clips.length === before + 1);
      const visible = Math.round(performance.now() - start);
      await wait(() => n.state.clips.at(-1).workflowVersion && !$('inspector').inert);
      const ready = Math.round(performance.now() - start);
      await n.flush();
      timings.push({
        id,
        visible,
        ready,
        saved: Math.round(performance.now() - start),
        requests: requests.slice(requestStart),
        tasks: tasks.slice(taskStart),
      });
      check(id + ' inserts a prepared shot', !!n.state.clips.at(-1).workflowVersion);
      if (id === 'video_minimax_h3_i2v') check('Previously captured MiniMax is interactive within 1.5 s', ready < 1500);
    }
  } finally {
    window.fetch = original;
    observer.disconnect();
  }
  check(
    'Original clip takes and job ledger are preserved',
    n.state.clips.filter(c => originalTakes.has(c.id)).every(c => takeSignature(c) === originalTakes.get(c.id)) &&
      n.state.jobs.length === jobCount,
  );
  return { checks, timings, diagnostics: n.diagnostics() };
})();
