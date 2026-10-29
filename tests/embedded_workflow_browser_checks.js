// Run in the isolated 8195 editor with an owned metadata fixture and ?bridge=embedded-workflow-qa.
// A render's embedded graph is media evidence: the working document only names it,
// and the editor fetches the payload when a graph is opened.
(async () => {
  const n = window.spoolNative,
    d = document,
    compact = new URLSearchParams(location.search).get('mode') === 'compact';
  if (location.port !== '8195' || !n || n.state.project !== 'Embedded take workflow QA')
    throw Error('Use the owned embedded-workflow QA project on 8195');
  const B = await import('/spool/ui/bridge.js'),
    channel = B.openChannel('embedded-workflow-qa'),
    opened = [];
  const stop = B.serve(channel, {
    ping: () => ({ connected: true, workflowLinks: true }),
    open: payload => {
      opened.push(payload);
      return { opened: true };
    },
  });
  const checks = [],
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
  const wait = async predicate => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (await predicate()) return;
      await new Promise(r => setTimeout(r, 25));
    }
    throw Error('Embedded workflow wait timed out');
  };
  const evidence = async mediaId => {
    const r = await fetch(
      '/spool/api/projects/' + n.projectKey + '/media/' + encodeURIComponent(mediaId) + '/evidence',
    );
    if (!r.ok) throw Error('Evidence request failed: ' + r.status);
    return r.json();
  };
  let c = n.state.clips[0];
  const before = JSON.stringify(c),
    revision = n.revision;
  const first = await evidence('embedded-source'),
    second = await evidence('other-source');
  const menu = () => {
    d.getElementById('openWorkflow').click();
    return [...d.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.startsWith('Open workflow in Comfy'));
  };
  const close = () => d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const openMenuGraph = async graph => {
    const button = menu(),
      count = opened.length;
    check('Context menu enables an available editable graph', !button.disabled);
    button.click();
    await wait(() => opened.length === count + 1);
    check(
      'Open forwards the resolved graph unchanged',
      JSON.stringify(opened.at(-1).workflow) === JSON.stringify(graph),
    );
  };
  try {
    check(
      'The working document names evidence without carrying it',
      !c.takes[0].media.workflow &&
        !c.takes[0].media.workflowData &&
        c.takes[0].media.evidence.includes('workflow') &&
        c.takes[0].media.embeddedGraph === true,
    );
    check(
      'Evidence keeps the probe beside the graph',
      Array.isArray(first.probe?.streams) && first.workflowData === undefined,
    );
    n.selectClip(c.id);
    if (!compact)
      check(
        'Embedded take enables inspector Open',
        !d.getElementById('editClipWorkflow').disabled &&
          d.getElementById('editClipWorkflow').textContent.trim() === 'Edit in Comfy',
      );
    check(
      'Embedded graph alone does not enable generation',
      d.getElementById('generate').disabled && !c.workflowVersion && !c.workflow,
    );
    check(
      'Inspector explains preparation before generation',
      d.getElementById('inspectorContent').textContent.includes('Use this take to set up generation'),
    );
    await openMenuGraph(first.workflow);
    if (!compact) {
      d.getElementById('editClipWorkflow').click();
      await wait(() => opened.length === 2);
      check(
        'Inspector opens the same embedded graph',
        JSON.stringify(opened[1].workflow) === JSON.stringify(first.workflow),
      );
    }
    await n.flush();
    check(
      'Opening a graph preserves the document, take choices and revision',
      JSON.stringify(c) === before && n.revision === revision && !n.state.jobs.length,
    );
    await n.chooseTake(c.id, 'other');
    c = n.state.clips[0];
    await n.flush();
    await openMenuGraph(second.workflow);
    check('Changing takes resolves that take rather than the first graph', opened.at(-1).workflow.nodes[0].id === 9);
    await n.chooseTake(c.id, 'plain');
    c = n.state.clips[0];
    await n.flush();
    if (!compact)
      check('A take without a graph disables inspector Open', d.getElementById('editClipWorkflow').disabled);
    check('A take without a graph omits the irrelevant context action', !menu());
    close();
    const size = { divisor: 1, width: 32, height: 32, fps: 24 };
    const preview = (media, body) =>
      fetch('/spool/api/projects/' + n.projectKey + '/media/' + media + '/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    check(
      'Preparing a preview accepts the playback size it was asked for',
      (await preview('embedded-source', size)).ok,
    );
    check('Preparing a preview requires that size', (await preview('embedded-source', { divisor: 1 })).status === 400);
    check(
      'Preparing a preview rejects odd dimensions',
      (await preview('embedded-source', { ...size, width: 31 })).status === 400,
    );
    check(
      'Preparing a preview leaves the saved revision unchanged',
      (await (await fetch('/spool/api/projects/' + n.projectKey)).json()).revision === n.revision,
    );
    c.takes[2].workflowSnapshot = { workflow: second.workflow };
    n.selectClip(c.id);
    await openMenuGraph(c.takes[2].workflowSnapshot.workflow);
    delete c.takes[2].workflowSnapshot;
    c.takes[2].media.workflowData = { workflow: first.workflow };
    n.selectClip(c.id);
    await openMenuGraph(first.workflow);
    delete c.takes[2].media.workflowData;
    c.takes[2].media.workflow = { save: { class_type: 'SaveImage', inputs: {} } };
    n.selectClip(c.id);
    check(
      'API-only metadata is not offered as an editable graph',
      (compact || d.getElementById('editClipWorkflow').disabled) && !menu(),
    );
    close();
    delete c.takes[2].media.workflow;
    const assigned = { workflow: { nodes: [{ id: 77, type: 'SaveImage' }], links: [], version: 0.4 } };
    n.state.importedWorkflows.push({ id: 'assigned-workflow', name: 'Assigned recipe', data: assigned });
    await n.flush();
    await n.poll();
    c = n.state.clips[0];
    c.workflow = 'assigned-workflow';
    c.takeId = 'embedded';
    n.selectClip(c.id);
    if (!compact) check('Assigned workflow retains its Prepare action', !d.getElementById('editClipWorkflow').disabled);
    await openMenuGraph(assigned.workflow);
    c.workflow = null;
    delete c.generationBase;
    n.selectClip(c.id);
    await n.flush();
    check('No graph opening creates generation jobs or resurrects takes', !n.state.jobs.length && c.takes.length === 3);
    return {
      checks,
      mode: compact ? 'compact' : 'full',
      opened: opened.length,
      project: n.projectKey,
      kind: 'Installed editor with synthetic metadata fixtures and a mocked Comfy bridge; no generation',
    };
  } finally {
    stop();
    channel.close();
  }
})();
