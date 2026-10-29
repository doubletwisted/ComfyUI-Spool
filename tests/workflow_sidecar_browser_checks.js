(async () => {
  const w = window,
    n = w.spoolNative,
    d = w.document,
    checks = [],
    check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    };
  const api = async path => {
      const r = await fetch('/spool/api/' + path),
        v = await r.json();
      if (!r.ok) throw Error(v.error);
      return v;
    },
    shot = () => n.state.clips.find(c => c.id === 'shot');
  const popups = [],
    originalOpen = w.open;
  w.open = function (...args) {
    const tab = originalOpen.apply(w, args);
    if (tab) popups.push(tab);
    return tab;
  };
  try {
    const prefix = 'projects/' + n.projectKey + '/take-workflow/shot/s04',
      before = await api(prefix),
      evidence = await api('projects/' + n.projectKey + '/media/s04/evidence');
    check(
      'A plain normal JSON sidecar takes priority and asks for Comfy serialization',
      before.preferWorkflow &&
        before.sidecar.needsSerialization &&
        !before.prompt &&
        before.workflow.nodes[0].widgets_values[0].includes('take-setup-s15'),
    );
    n.selectClip('shot');
    await n.chooseTake('shot', 's04');
    await n.flush();
    const cached = await api(prefix),
      recipe = await api('workflows/' + shot().workflowVersion);
    check(
      'Use take serializes the normal graph through Comfy and caches its API',
      !cached.sidecar.needsSerialization && !!cached.prompt && recipe.preferWorkflow,
    );
    check(
      'The sidecar image wins over the red source embedded in the take',
      recipe.prompt['105:114'].inputs.image.includes('take-setup-s15-') && shot().takeId === 's04',
    );
    check(
      'Serialization preserves the original editable layout',
      cached.workflow.groups[0].title === 'Recovered layout' &&
        cached.workflow.nodes.find(n => n.type === 'LoadImage').pos[0] === 40,
    );
    check(
      'Live widget addresses are captured for subsequent edits',
      cached.widgetBindings.some(b => b.nodeId === '105:114' && b.input === 'image' && b.widgetName === 'image'),
    );
    check(
      'Historical metadata remains unchanged',
      JSON.stringify(evidence) === JSON.stringify(await api('projects/' + n.projectKey + '/media/s04/evidence')),
    );
    check('Preparing a sidecar never queues generation', !n.state.jobs.length);
    return { checks };
  } finally {
    w.open = originalOpen;
    for (const tab of popups) if (!tab.closed) tab.close();
  }
})();
