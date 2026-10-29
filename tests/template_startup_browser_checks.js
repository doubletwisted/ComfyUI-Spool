// Real native frontend startup timings; no template selection or generation.
(async () => {
  const w = window,
    d = w.document,
    n = w.spoolNative,
    $ = id => d.getElementById(id) || n.dialogRoot.getElementById(id),
    checks = [],
    samples = [];
  const check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    wait = async predicate => {
      const end = Date.now() + 45000;
      while (!predicate()) {
        if (Date.now() > end) throw Error('Template startup timed out');
        await new Promise(r => setTimeout(r, 10));
      }
    };
  await n.flush();
  const revision = n.revision,
    count = n.state.clips.length,
    compact = d.getElementById('editor').classList.contains('compact');
  if (compact) {
    $('workspaceMenu').click();
    $('workflowLibraryToggle').click();
  }
  let previous = null;
  for (let i = 0; i < 3; i++) {
    const before = w.performance.getEntriesByType('resource').length,
      start = performance.now();
    $('browseComfyTemplates').click();
    await wait(() => $('comfyTemplateBrowser') && !$('modalOverlay').hidden);
    const frame = $('comfyTemplateBrowser'),
      mountedMs = performance.now() - start;
    await wait(() => frame.classList.contains('ready'));
    const readyMs = performance.now() - start;
    await wait(() =>
      frame.contentDocument
        .querySelector('[aria-labelledby="global-workflow-template-selector"]')
        ?.textContent.includes('MiniMax'),
    );
    const entries = w.performance.getEntriesByType('resource').slice(before);
    if (!window.__templateProfileBaseline)
      check(
        'Open ' + (i + 1) + ' avoids full node-definition downloads',
        !entries.some(
          e => new URL(e.name).pathname === '/spool/api/capabilities' && !new URL(e.name).searchParams.has('types'),
        ),
      );
    samples.push({
      open: i + 1,
      mountedMs,
      readyMs,
      catalogMs: performance.now() - start,
      reused: frame === previous,
      definitionRequests: entries
        .filter(e => new URL(e.name).pathname === '/spool/api/capabilities')
        .map(e => ({ url: e.name, durationMs: e.duration, bytes: e.decodedBodySize })),
    });
    if (i && !window.__templateProfileBaseline)
      check('Reopen ' + i + ' reuses its initialized native frontend', frame === previous);
    previous = frame;
    $('templateCancel').click();
  }
  check(
    'Timing checks leave project contents and generation unchanged',
    n.revision === revision && n.state.clips.length === count && n.state.jobs.length === 0,
  );
  return { checks, samples, kind: 'Installed CPU QA timings, native chooser; no generation' };
})();
