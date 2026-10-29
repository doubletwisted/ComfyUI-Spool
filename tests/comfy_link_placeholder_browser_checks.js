// Open and apply a newly appended placeholder in the real isolated Comfy GUI.
(async () => {
  const n = spoolNative,
    $ = id => document.getElementById(id),
    checks = [],
    popups = [],
    originalOpen = window.open;
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async fn => {
      const end = Date.now() + 45000;
      while (!(await fn())) {
        if (Date.now() > end) throw Error('Placeholder Comfy link: ' + $('toast').textContent);
        await new Promise(r => setTimeout(r, 60));
      }
    };
  window.open = function (...args) {
    const tab = originalOpen.apply(window, args);
    if (tab) popups.push(tab);
    return tab;
  };
  try {
    await n.flush();
    const count = n.state.clips.length,
      source = JSON.stringify(n.state.clips[0]);
    document.querySelector('[data-template="fresh-graph"]').click();
    await wait(() => n.state.clips.length === count + 1 && !!n.state.clips.at(-1).workflowVersion);
    await n.flush();
    const id = n.state.clips.at(-1).id,
      shot = () => n.state.clips.find(c => c.id === id),
      take = shot().takeId,
      version = shot().workflowVersion;
    check(
      'The workflow panel appends a saved shot without generated footage',
      shot().takes.length === 1 && shot().takes[0].placeholder,
    );
    await n.editWorkflow();
    check('Edit in Comfy opens the real paired Comfy tab', popups.length === 1 && !popups[0].closed);
    const comfy = popups[0];
    await wait(() => comfy.comfyAPI?.app?.app?.extensionManager?.workflow?.activeWorkflow);
    const app = comfy.comfyAPI.app.app,
      manager = app.extensionManager.workflow,
      linked = manager.activeWorkflow;
    check(
      'The assigned graph is active in Comfy',
      app.rootGraph.nodes.some(node => node.type === 'LoadImage') &&
        app.rootGraph.nodes.some(node => node.type === 'SaveImage'),
    );
    const toolbar = comfy.document.querySelector('#spool-workflow-toolbar');
    await wait(() => toolbar && !toolbar.querySelector('button').disabled);
    check('The new shot exposes the linked Apply to clip action', toolbar.textContent.includes(shot().name));
    const deadline = comfy.LiteGraph.createNode('DeadlineSubmit');
    app.rootGraph.add(deadline);
    linked.changeTracker.captureCanvasState();
    // Two takes stop at the review, so nothing renders; the clip's Execute on decides, not the open graph.
    const takes = shot().count;
    shot().count = 2;
    await n.queueClips([shot()]);
    shot().count = takes;
    check(
      'An unapplied Deadline node in Comfy does not block generating the saved local workflow',
      $('modal').classList.contains('review-dialog') &&
        $('modal').textContent.includes('Local ComfyUI') &&
        !$('toast').textContent.includes('Apply this clip') &&
        !n.state.jobs.length,
    );
    $('closeModal').click();
    check(
      'Generating leaves the assigned recipe and unsaved Comfy graph as they were',
      shot().workflowVersion === version && app.rootGraph.nodes.includes(deadline),
    );
    app.rootGraph.remove(deadline);
    linked.changeTracker.captureCanvasState();
    app.rootGraph.nodes
      .find(node => node.type === 'SaveImage')
      .widgets.find(widget => widget.name === 'filename_prefix').value = 'new-shot-edited-in-comfy';
    linked.changeTracker.captureCanvasState();
    await toolbar.querySelector('button').onclick();
    await n.flush();
    check('Apply creates a new workflow version for the ungenerated shot', shot().workflowVersion !== version);
    const recipe = await (await fetch('/spool/api/workflows/' + shot().workflowVersion)).json();
    check(
      'The saved recipe contains the real Comfy edit',
      Object.values(recipe.prompt).some(
        node => node.class_type === 'SaveImage' && node.inputs.filename_prefix === 'new-shot-edited-in-comfy',
      ),
    );
    check(
      'Applying preserves the placeholder and does not invent a take',
      shot().takeId === take && shot().takes.length === 1 && shot().takes[0].placeholder,
    );
    check('The original shot and its workflow remain unchanged', JSON.stringify(n.state.clips[0]) === source);
    const tabs = manager.openWorkflows.length;
    await n.editWorkflow();
    check(
      'Reopening focuses the linked graph after Apply',
      manager.activeWorkflow.path === linked.path && manager.openWorkflows.length === tabs && popups.length === 1,
    );
    n.undo();
    await n.flush();
    check('Applying the graph is one undoable edit', shot().workflowVersion === version && shot().takeId === take);
    n.redo();
    await n.flush();
    check('Opening and applying the workflow submit no generation', !n.state.jobs.length);
    return { checks, kind: 'New workflow-panel shot, real Comfy graph/Apply bridge and durable recipe; no generation' };
  } finally {
    window.open = originalOpen;
    for (const tab of popups) if (!tab.closed) tab.close();
  }
})();
