// Real project/recipe APIs with a controlled Comfy BroadcastChannel receiver.
(async () => {
  const n = spoolNative,
    $ = id => document.getElementById(id),
    B = await import('/spool/ui/bridge.js'),
    checks = [],
    opened = [],
    requests = [];
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async fn => {
      const end = Date.now() + 10000;
      while (!fn()) {
        if (Date.now() > end) throw Error('New workflow wait: ' + $('toast').textContent);
        await new Promise(r => setTimeout(r, 20));
      }
    };
  const channel = B.openChannel('new-workflow-qa'),
    stop = B.serve(channel, {
      ping: () => ({ connected: true, workflowLinks: true }),
      open: payload => {
        opened.push(payload);
        return { opened: true };
      },
    }),
    originalFetch = window.fetch;
  window.fetch = async (input, options) => {
    requests.push({ path: String(input), method: options?.method || 'GET' });
    return originalFetch(input, options);
  };
  try {
    await wait(() => document.querySelector('[data-builtin="video_ltx2_5_t2v"]'));
    await n.flush();
    for (const id of ['video_ltx2_5_t2v', 'api_ltx2_5_t2v', 'video_minimax_h3_i2v']) {
      const count = n.state.clips.length;
      document.querySelector('[data-builtin="' + id + '"]').click();
      await wait(() => n.state.clips.length === count + 1 && !!n.state.clips.at(-1).workflowVersion);
      const c = n.state.clips.at(-1),
        takes = JSON.stringify(c.takes),
        version = c.workflowVersion,
        selected = c.takeId;
      check(id + ' starts as an ungenerated workflow shot', c.takes.find(t => t.id === selected)?.placeholder);
      const prompt = c.bindings.find(b => b.role === 'positive');
      if (prompt) {
        const field = document.querySelector('[data-native-control="' + c.bindings.indexOf(prompt) + '"]');
        field.value = 'New shot ready to edit';
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const from = requests.length,
        opens = opened.length;
      $('editClipWorkflow').click();
      await wait(
        () =>
          opened.length > opens ||
          $('toast').textContent.includes('no longer available') ||
          $('toast').textContent.includes('Reference file unavailable'),
      );
      check(id + ' Edit in Comfy reaches the linked host: ' + $('toast').textContent, opened.length === opens + 1);
      check(
        id + ' never looks up a placeholder take workflow',
        !requests.slice(from).some(r => r.path.includes('/take-workflow/')),
      );
      const payload = opened.at(-1);
      check(
        id + ' opens the assigned recipe with a clip-specific Apply link',
        payload.link.clipId === c.id && payload.link.projectId === n.projectKey && !!payload.prompt,
      );
      check(
        id + ' forwards current prompt overrides',
        !prompt || payload.prompt[prompt.nodeId].inputs[prompt.input] === 'New shot ready to edit',
      );
      check(
        id + ' leaves unchosen sources empty and Generate disabled',
        c.bindings.filter(b => b.asset).every(b => payload.prompt[b.nodeId].inputs[b.input] === '') &&
          (!c.bindings.some(b => b.asset) || $('generate').disabled),
      );
      check(
        id + ' preserves the placeholder, selected take and workflow',
        JSON.stringify(c.takes) === takes && c.takeId === selected && c.workflowVersion === version,
      );
      const saved = await (await originalFetch('/spool/api/projects/' + n.projectKey)).json();
      check(
        id + ' saves the new shot and recipe before opening',
        saved.document.clips.some(s => s.id === c.id && s.workflowVersion === version) && !!saved.recipes[version],
      );
    }
    n.selectClip('shot');
    const from = requests.length,
      count = opened.length;
    await n.editWorkflow();
    check(
      'A take with only execution data requests its original editable workflow',
      requests.slice(from).some(r => r.path.endsWith('/take-workflow/shot/one')) &&
        opened.length === count &&
        $('toast').textContent.includes('original workflow'),
    );
    check(
      'Opening workflows never queues generation or adds takes',
      !n.state.jobs.length && n.state.clips.slice(1).every(c => c.takes.length === 1 && c.takes[0].placeholder),
    );
    return {
      checks,
      opened: opened.length,
      kind: 'New Local/Cloud workflow shots, real recipe APIs and controlled Comfy bridge; no generation',
    };
  } finally {
    window.fetch = originalFetch;
    stop();
    channel.close();
  }
})();
