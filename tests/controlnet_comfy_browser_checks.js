(async () => {
  const n = spoolNative,
    checks = [],
    popups = [],
    originalOpen = window.open,
    shot = () => n.state.clips.find(c => c.id === 'shot');
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async fn => {
      const end = Date.now() + 60000;
      while (!(await fn())) {
        if (Date.now() > end) throw Error('ControlNet graph: ' + document.getElementById('toast').textContent);
        await new Promise(r => setTimeout(r, 60));
      }
    };
  window.open = function (...args) {
    const tab = originalOpen.apply(window, args);
    if (tab) popups.push(tab);
    return tab;
  };
  try {
    n.selectClip('shot');
    const field = [...document.querySelectorAll('.field')]
      .find(f => f.firstElementChild?.textContent === 'Control strength')
      .querySelector('[data-native-control]');
    field.value = '.65';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    await n.flush();
    for (const [label, value] of [
      ['Draw hands', 'false'],
      ['Draw head', 'false'],
      ['Maximum people', '1'],
    ]) {
      const input = [...document.querySelectorAll('.field')]
        .find(f => f.firstElementChild?.textContent === label)
        .querySelector('[data-native-control]');
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await n.flush();
    const before = await fetch('/spool/api/workflows/' + shot().workflowVersion).then(r => r.json()),
      source = JSON.stringify({ takes: shot().takes, takeId: shot().takeId, in: shot().in, out: shot().out });
    await n.editWorkflow();
    await wait(() =>
      popups[0]?.comfyAPI?.app?.app?.rootGraph?.nodes.some(n => n.type === 'MiniMaxH3FunControlNetApply'),
    );
    const comfy = popups[0],
      app = comfy.comfyAPI.app.app,
      graph = app.rootGraph,
      serialized = graph.serialize();
    check(
      'Comfy opens the saved graph with its original node count and notes',
      serialized.nodes.length === before.workflow.nodes.length && serialized.nodes.some(n => n.type === 'MarkdownNote'),
    );
    check(
      'Original groups, positions and the pose subgraph survive opening',
      serialized.groups.length === before.workflow.groups.length &&
        JSON.stringify([...graph.getNodeById(172).pos]) ===
          JSON.stringify(before.workflow.nodes.find(n => n.id === 172).pos) &&
        !!graph.getNodeById(700).subgraph,
    );
    check(
      'The original graph receives the current strength and baked timeline video',
      graph.getNodeById(172).widgets.find(w => w.name === 'strength').value === 0.65 &&
        graph
          .getNodeById(174)
          .widgets.find(w => w.name === 'file')
          .value.endsWith('.mp4'),
    );
    check(
      'Promoted and nested pose widgets receive their actual current values',
      graph.getNodeById(700).widgets.find(w => w.name === 'draw_hands').value === false &&
        graph
          .getNodeById(700)
          .subgraph.getNodeById(672)
          .widgets.find(w => w.name === 'draw_head').value === false &&
        graph.getNodeById(700).widgets.find(w => w.name === 'max_detections').value === 1,
    );
    graph.getNodeById(172).widgets.find(w => w.name === 'strength').value = 0.42;
    app.extensionManager.workflow.activeWorkflow.changeTracker.captureCanvasState();
    const toolbar = comfy.document.querySelector('#spool-workflow-toolbar');
    await wait(() => toolbar && !toolbar.querySelector('button').disabled);
    const version = shot().workflowVersion;
    await toolbar.querySelector('button').onclick();
    await n.flush();
    check(
      'Apply to clip saves a new recipe with the edited ControlNet strength',
      shot().workflowVersion !== version &&
        shot().bindings.some(b => b.input === 'strength' && shot().inputValues[b.key] === 0.42),
    );
    const applied = await fetch('/spool/api/workflows/' + shot().workflowVersion).then(r => r.json());
    check(
      'The applied recipe retains the editable layout, notes and pose subgraph',
      applied.workflow.nodes.some(n => n.type === 'MarkdownNote') &&
        applied.workflow.definitions.subgraphs.length === before.workflow.definitions.subgraphs.length &&
        shot().bindings.some(b => b.role === 'pose'),
    );
    check(
      'Opening and applying keep footage and trims and submit no generation',
      JSON.stringify({ takes: shot().takes, takeId: shot().takeId, in: shot().in, out: shot().out }) === source &&
        !n.state.jobs.length,
    );
    return { checks };
  } finally {
    window.open = originalOpen;
    for (const tab of popups) if (!tab.closed) tab.close();
  }
})();
