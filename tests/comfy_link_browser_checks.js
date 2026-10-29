(async () => {
  const w = window,
    n = w.spoolNative,
    d = w.document,
    $ = id => d.getElementById(id),
    checks = [];
  const check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    shot = () => n.state.clips.find(c => c.id === 'shot');
  const wait = async fn => {
    const end = Date.now() + 45000;
    while (!(await fn())) {
      if (Date.now() > end) throw Error('Workflow link wait: ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 70));
    }
  };
  const api = path => fetch('/spool/api/' + path).then(r => r.json()),
    recipe = () => api('workflows/' + shot().workflowVersion);
  const popups = [],
    originalOpen = w.open;
  w.open = function (...args) {
    const tab = originalOpen.apply(w, args);
    if (tab) popups.push(tab);
    return tab;
  };
  let comfy = window,
    app,
    originalLoader;
  try {
    if (!window.spoolNative) {
      app = window.comfyAPI.app.app;
      originalLoader = app.loadGraphData;
      app.loadGraphData = async function (...args) {
        await originalLoader.apply(this, args);
      };
    }
    n.selectClip('shot');
    await n.chooseTake('shot', 's04');
    await n.flush();
    const replaceImage = async name => {
      const b = shot().bindings.find(b => b.asset),
        old = shot().inputValues[b.key],
        blob = await w.fetch('/spool/api/input/' + name).then(r => r.blob()),
        files = new w.DataTransfer();
      files.items.add(new w.File([blob], name, { type: 'image/png' }));
      const input = d.querySelector('[data-image-file]');
      input.files = files.files;
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
      await wait(() => shot().inputValues[b.key] !== old);
      await n.flush();
      return shot().inputValues[b.key];
    };
    const chosenImage = await replaceImage('take-setup-s15.png');
    const jobsBefore = new Set(n.state.jobs.map(j => j.id));
    const initialVersion = shot().workflowVersion,
      chosen = shot().takeId,
      originalEvidence = await api('projects/' + n.projectKey + '/media/s04/evidence');
    await n.editWorkflow();
    if (!window.spoolNative) comfy = window;
    else {
      check('Stale editor bridge automatically opens a recovery Comfy tab', popups.length === 1 && !popups[0].closed);
      comfy = popups[0];
    }
    await wait(() => comfy.comfyAPI?.app?.app?.extensionManager?.workflow?.activeWorkflow);
    app = comfy.comfyAPI.app.app;
    if (!originalLoader) {
      originalLoader = app.loadGraphData;
      app.loadGraphData = async function (...args) {
        await originalLoader.apply(this, args);
      };
    }
    const manager = app.extensionManager.workflow,
      first = manager.activeWorkflow,
      path = first.path;
    const toolbar = comfy.document.querySelector('#spool-workflow-toolbar');
    check(
      'Linked Apply is mounted in the native Comfy toolbar',
      app.menu.actionsGroup.element.contains(toolbar) && comfy.getComputedStyle(toolbar).position !== 'fixed',
    );
    const { keyText } = await import('/spool/ui/keys.js'),
      saveKey = keyText('Ctrl+S');
    check(
      'Apply explains that it saves the clip workflow JSON separately from ' + saveKey,
      toolbar.querySelector('button').title.includes('workflow JSON') &&
        toolbar.querySelector('button').title.includes(saveKey),
    );
    const image = () =>
      app.rootGraph.nodes.find(node => node.type === 'LoadImage').widgets.find(widget => widget.name === 'image');
    check(
      'Opened graph uses the current clip input instead of a stale editor widget (' +
        image().value +
        ' vs ' +
        chosenImage +
        ')',
      image().value === chosenImage,
    );
    check(
      'Recovery keeps the project and selected take',
      shot().takeId === chosen && shot().workflowVersion === initialVersion,
    );
    const B = await import('/spool/ui/bridge.js'),
      client = B.createClient(B.openChannel(comfy.sessionStorage.getItem('spool-comfy-bridge')));
    try {
      const graph = JSON.parse(JSON.stringify(app.rootGraph.serialize())),
        data = {
          name: 'Graph-only loader QA',
          workflow: graph,
          link: { projectId: 'loader-qa', clipId: 'graph', sourceKey: 'v1' },
        };
      const droppingLoader = app.loadGraphData;
      app.loadGraphData = async () => {};
      try {
        let error;
        try {
          await client.call(B.ACTIONS.open, data);
        } catch (e) {
          error = e;
        }
        check('A loader that never activates the graph is rejected', error?.message.includes('could not open'));
      } finally {
        app.loadGraphData = droppingLoader;
      }
      await client.call(B.ACTIONS.open, data);
      check(
        'Graph-only recipes open when an extension drops the loader return value',
        manager.activeWorkflow.path !== path && app.rootGraph.nodes.length === graph.nodes.length,
      );
      await n.editWorkflow();
      check(
        'Linked focus also accepts the dropped return value',
        manager.activeWorkflow.path === path && image().value === chosenImage,
      );
    } finally {
      client.close();
    }
    const text = comfy.LiteGraph.createNode('CLIPTextEncode');
    app.rootGraph.add(text);
    text.widgets.find(widget => widget.name === 'text').value = 'Edited linked prompt';
    image().value = 'take-setup-s04.png';
    first.changeTracker.captureCanvasState();
    const size = manager.openWorkflows.length;
    check('Comfy edits remain unapplied until explicit Apply', shot().workflowVersion === initialVersion);
    await n.editWorkflow();
    check(
      'Edit focuses the same workflow and retains unsaved changes',
      manager.activeWorkflow.path === path &&
        manager.openWorkflows.length === size &&
        image().value === 'take-setup-s04.png',
    );
    const graph = JSON.parse(JSON.stringify(app.rootGraph.serialize())),
      other = manager.createTemporary('Unrelated workflow QA.json', graph);
    await app.loadGraphData(graph, true, true, other);
    image().value = 'take-setup-s15.png';
    await wait(() => comfy.document.querySelector('#spool-workflow-toolbar').style.display === 'none');
    check(
      'Unrelated Comfy tabs do not offer Apply',
      comfy.document.querySelector('#spool-workflow-toolbar').style.display === 'none',
    );
    await n.applyWorkflow('shot');
    check(
      'Apply rejects an unrelated active Comfy graph',
      $('toast').textContent.includes('different Comfy workflow') && shot().workflowVersion === initialVersion,
    );
    await n.editWorkflow();
    check(
      'Edit returns to the linked graph without overwriting it',
      manager.activeWorkflow.path === path && image().value === 'take-setup-s04.png',
    );
    const applyButton = comfy.document.querySelector('#spool-workflow-toolbar button');
    await wait(() => applyButton && !applyButton.disabled);
    const serializer = app.graphToPrompt;
    let serializations = 0;
    image().value = 'take-setup-s15.png';
    try {
      app.graphToPrompt = async function (...args) {
        const value = await serializer.apply(this, args);
        serializations++;
        app.rootGraph.nodes[0].pos[0]++;
        app.rootGraph.nodes[0].order++;
        app.rootGraph.extra.ds = { scale: serializations };
        if (serializations === 1) image().value = 'take-setup-s04.png';
        return value;
      };
      await applyButton.onclick();
    } finally {
      app.graphToPrompt = serializer;
    }
    await n.flush();
    const applied = shot().workflowVersion,
      held = await recipe();
    check(
      'Apply ignores layout/bookkeeping changes and automatically retries an input edit',
      serializations === 2 && applied !== initialVersion,
    );
    check(
      'Explicit Apply saves the edited image',
      applied !== initialVersion &&
        Object.values(held.prompt).some(
          node =>
            node.class_type === 'LoadImage' &&
            node.inputs.image.startsWith('spool-projects/' + n.projectKey + '/input/images/take-setup-s04-'),
        ),
    );
    check(
      'Explicit Apply saves the edited prompt',
      Object.values(held.prompt).some(node => node.inputs.text === 'Edited linked prompt'),
    );
    check(
      'Apply retains the selected take and its historical metadata',
      shot().takeId === chosen &&
        JSON.stringify(await api('projects/' + n.projectKey + '/media/s04/evidence')) ===
          JSON.stringify(originalEvidence),
    );
    const afterApply = manager.openWorkflows.length;
    await n.editWorkflow();
    check(
      'Applied version remains linked to the existing Comfy tab',
      manager.activeWorkflow.path === path && manager.openWorkflows.length === afterApply,
    );
    const originalFetch = comfy.fetch;
    let waiting = false,
      release;
    const hold = new Promise(r => (release = r));
    comfy.fetch = async function (...args) {
      if (String(args[0]) === '/object_info') {
        waiting = true;
        await hold;
      }
      return originalFetch.apply(comfy, args);
    };
    try {
      const applying = n.applyWorkflow('shot');
      await wait(() => waiting);
      await replaceImage('take-setup-s15.png');
      release();
      await applying;
      await n.flush();
      check(
        'An edit made during capture is preserved rather than overwritten',
        shot().workflowVersion === applied && $('toast').textContent.includes('changed while Comfy'),
      );
      n.undo();
      await n.flush();
    } finally {
      release();
      comfy.fetch = originalFetch;
    }
    n.undo();
    await n.flush();
    check('Applying a graph can be undone', shot().workflowVersion === initialVersion);
    await n.editWorkflow();
    check(
      'A changed Spool setup opens separately and preserves old unsaved graph',
      manager.activeWorkflow.path !== path &&
        first.changeTracker.activeState.nodes.some(
          node => node.type === 'LoadImage' && node.widgets_values[0] === 'take-setup-s04.png',
        ),
    );
    n.redo();
    await n.flush();
    if (window.spoolNative) {
      const count = popups.length,
        id = new URL(w.location.href).searchParams.get('bridge');
      comfy.location.reload();
      await new Promise(r => setTimeout(r, 500));
      await wait(
        () =>
          comfy.document.readyState === 'complete' &&
          comfy.comfyAPI?.app?.app?.extensionManager?.workflow?.activeWorkflow,
      );
      await n.editWorkflow();
      check(
        'Reloaded Comfy keeps the existing editor bridge',
        popups.length === count &&
          new URL(w.location.href).searchParams.get('bridge') === id &&
          !$('toast').textContent.includes('unavailable'),
      );
      window.__continueWorkflowChecks = async () => {
        const opened = [],
          beforeOpen = w.open;
        w.open = function (...args) {
          const tab = beforeOpen.apply(w, args);
          if (tab) opened.push(tab);
          return tab;
        };
        try {
          await n.editWorkflow();
          if (opened.length !== 1 || opened[0].closed || shot().workflowVersion !== applied)
            throw Error('Closed-tab recovery: ' + $('toast').textContent);
          return { checks: ['Closing the original Comfy tab recovers on the next Edit'] };
        } finally {
          w.open = beforeOpen;
          for (const tab of opened) if (!tab.closed) tab.close();
        }
      };
    }
    check(
      'Workflow editing and Apply never queue generation',
      n.state.jobs.every(j => jobsBefore.has(j.id)),
    );
    const old = new Set(shot().takes.map(t => t.id));
    await n.queueClips([shot()]);
    await wait(async () => {
      await n.poll();
      return shot().takes.some(t => t.generated && !old.has(t.id));
    });
    const generated = shot().takes.find(t => t.generated && !old.has(t.id)),
      img = new Image();
    img.src = '/spool/media/' + n.projectKey + '/' + generated.media.file;
    await img.decode();
    const canvas = d.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const color = [...ctx.getImageData(0, 0, 1, 1).data];
    check(
      'A real CPU render uses the applied red source',
      color[0] > 240 && color[1] < 15 && color[2] < 15 && shot().takeId === chosen,
    );
    check(
      'Apply lives only in the linked Comfy workflow',
      d.querySelectorAll('#editClipWorkflow').length === 1 &&
        !d.querySelector('#applyClipWorkflow') &&
        !d.querySelector('.workflow-advanced') &&
        comfy.document.querySelectorAll('#spool-workflow-toolbar').length === 1,
    );
    return { checks };
  } finally {
    if (app && originalLoader) app.loadGraphData = originalLoader;
    w.open = originalOpen;
    for (const tab of popups) if (!tab.closed) tab.close();
  }
})();
