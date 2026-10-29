(async () => {
  const n = window.spoolNative,
    $ = id => document.getElementById(id),
    checks = [],
    timings = [],
    requests = [],
    versions = new Map();
  const check = (label, ok) => {
    if (!ok) throw Error(label);
    checks.push(label);
  };
  const wait = async predicate => {
    const end = performance.now() + 120000;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Workflow insertion timed out: ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  await wait(() => document.querySelector('[data-builtin="video_ltx2_5_t2v"]'));
  await n.flush();
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
    for (const id of ['video_ltx2_5_t2v', 'video_ltx2_5_t2v', 'api_ltx2_5_t2v', 'api_ltx2_5_t2v']) {
      const before = n.state.clips.length,
        start = performance.now(),
        requestStart = requests.length;
      const button = document.querySelector('[data-builtin="' + id + '"]');
      button.focus();
      button.click();
      await wait(
        () => n.state.clips.length === before + 1 && n.state.clips.at(-1).workflowVersion && !$('inspector').inert,
      );
      await n.flush();
      timings.push({ id, ms: Math.round(performance.now() - start), requests: requests.slice(requestStart) });
      check(
        id + ' adds one prepared shot',
        n.state.clips.length === before + 1 && n.state.clips.at(-1).bindings.length > 0,
      );
      check('Workflow insertion keeps keyboard focus inside Spool', $('editor').contains(document.activeElement));
      check(
        'Built-in workflows do not start a Comfy serializer iframe',
        !document.querySelector('iframe[title="Preparing Comfy workflow"]'),
      );
      const version = n.state.clips.at(-1).workflowVersion;
      if (versions.has(id)) {
        const work = timings.at(-1).requests;
        check('Repeated ' + id + ' reuses the immutable recipe', version === versions.get(id));
        check(
          'Repeated ' + id + ' writes once without template preparation',
          work.filter(r => r.method === 'PUT').length === 1 &&
            !work.some(
              r => r.path.includes('/capture/') || r.path.includes('/templates/') || r.path.endsWith('/capabilities'),
            ),
        );
      } else versions.set(id, version);
    }
    window.__workflowInsertMeasurements = { timings, undoTitle: $('undo').title };
    const count = n.state.clips.length,
      originalClips = n.state.clips.map(c => ({
        id: c.id,
        version: c.workflowVersion,
        take: c.takeId,
        in: c.in,
        out: c.out,
      }));
    const shortcut = async redo => {
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: !!redo, bubbles: true }),
      );
      await n.flush();
    };
    for (let i = 1; i <= count; i++) {
      await shortcut();
      check('Ctrl+Z removes workflow addition ' + i + ' as one complete action', n.state.clips.length === count - i);
    }
    check('Undo does not leave an extra capture-only history step', $('undo').disabled);
    for (let i = 1; i <= count; i++) {
      await shortcut(true);
      check(
        'Ctrl+Shift+Z restores prepared workflow addition ' + i,
        n.state.clips.length === i && n.state.clips.every(c => c.workflowVersion && c.bindings.length),
      );
    }
    check(
      'Redo restores the exact clip IDs, take IDs, recipes and timing',
      JSON.stringify(
        n.state.clips.map(c => ({ id: c.id, version: c.workflowVersion, take: c.takeId, in: c.in, out: c.out })),
      ) === JSON.stringify(originalClips),
    );
    const first = n.state.clips[0],
      oldName = first.name;
    n.selectClip(first.id);
    $('clipName').value = 'Renamed before capture';
    $('clipName').dispatchEvent(new Event('change', { bubbles: true }));
    await n.flush();
    const button = document.querySelector('[data-builtin="video_minimax_h3_t2v"]');
    button.focus();
    button.click();
    await wait(
      () => n.state.clips.length === count + 1 && n.state.clips.at(-1).workflowVersion && !$('inspector').inert,
    );
    await n.flush();
    await shortcut();
    check(
      'Undo removes a freshly serialized template in one step',
      n.state.clips.length === count && n.state.clips[0].name === 'Renamed before capture',
    );
    await shortcut();
    check('Workflow capture preserves earlier unrelated Undo steps', n.state.clips[0].name === oldName);
    await shortcut(true);
    await shortcut(true);
    check(
      'Redo restores both the prior edit and the complete new shot',
      n.state.clips.length === count + 1 &&
        n.state.clips[0].name === 'Renamed before capture' &&
        n.state.clips.at(-1).workflowVersion,
    );
    const target = n.state.clips[0],
      oldVersion = target.workflowVersion,
      trim = [target.in, target.out],
      take = target.takeId,
      requestStart = requests.length;
    const node = document.querySelector('[data-clip="' + target.id + '"]'),
      rect = node.getBoundingClientRect(),
      dataTransfer = new DataTransfer();
    dataTransfer.setData('application/spool', JSON.stringify({ builtin: 'api_ltx2_5_t2v' }));
    node.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await wait(() => n.state.clips[0].workflowVersion !== oldVersion && !$('inspector').inert);
    await n.flush();
    const replacement = n.state.clips[0];
    check(
      'A cached workflow drop replaces only workflow/setup',
      replacement.workflowVersion === versions.get('api_ltx2_5_t2v') &&
        replacement.executionTarget === 'cloud' &&
        replacement.takeId === take &&
        JSON.stringify([replacement.in, replacement.out]) === JSON.stringify(trim),
    );
    check(
      'A cached workflow replacement writes once',
      requests.slice(requestStart).filter(r => r.method === 'PUT').length === 1 &&
        !requests.slice(requestStart).some(r => r.path.includes('/capture/')),
    );
    $('editor').focus();
    await shortcut();
    check('Undo restores the replaced workflow', n.state.clips[0].workflowVersion === oldVersion);
    await shortcut(true);
    check(
      'Redo restores the workflow replacement',
      n.state.clips[0].workflowVersion === versions.get('api_ltx2_5_t2v'),
    );
    check('No workflow was executed', !n.state.jobs.length);
  } catch (error) {
    error.message += ' ' + JSON.stringify(window.__workflowInsertMeasurements);
    throw error;
  } finally {
    window.fetch = original;
  }
  return { checks, timings };
})();
