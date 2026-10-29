// Comfy owns live graph tabs; Spool owns the immutable recipe applied to a clip.
export function createWorkflowLinks(app, load, capture, storage) {
  const key = 'spool-workflow-links';
  let links = new Map(),
    opening = null;
  try {
    links = new Map(JSON.parse(storage.getItem(key) || '[]'));
  } catch {}
  const identity = link => JSON.stringify([link.projectId, link.clipId]);
  const save = () => storage.setItem(key, JSON.stringify([...links]));
  const workflow = record => app.extensionManager.workflow.openWorkflows.find(w => w.path === record?.path);
  async function ready() {
    const until = Date.now() + 120000;
    while (app.extensionManager.spinner) {
      if (Date.now() > until) throw Error('Comfy is still restoring its workspace. Try again when it is ready.');
      await new Promise(r => setTimeout(r, 50));
    }
  }
  async function openWorkflow(data) {
    await ready();
    const link = data.link;
    if (!link) return load(data);
    const record = links.get(identity(link)),
      existing = workflow(record);
    if (existing && record.sourceKey === link.sourceKey && record.link?.sidecarSha === link.sidecarSha) {
      record.link = link;
      record.name = data.name;
      save();
      if (app.extensionManager.workflow.activeWorkflow !== existing) {
        const graph = existing.changeTracker?.activeState || JSON.parse(existing.content);
        const loaded = await app.loadGraphData(graph, true, true, existing);
        if (loaded === false || app.extensionManager.workflow.activeWorkflow !== existing)
          throw Error('Comfy could not focus the linked workflow');
      }
      return { opened: true, reused: true };
    }
    await load(data);
    links.set(identity(link), {
      path: app.extensionManager.workflow.activeWorkflow.path,
      sourceKey: link.sourceKey,
      link,
      name: data.name,
    });
    save();
    return { opened: true, reused: false };
  }
  async function open(data) {
    const target = JSON.stringify(data.link || data);
    if (opening) {
      if (opening.target === target) return opening.promise;
      throw Error('Finish opening the current Spool workflow before opening another clip.');
    }
    const promise = openWorkflow(data);
    opening = { target, promise };
    try {
      return await promise;
    } finally {
      opening = null;
    }
  }
  async function captureLinked(data) {
    if (!data.link) return capture();
    if (opening) throw Error('Finish opening the linked Comfy workflow before applying changes.');
    await ready();
    const link = data.link,
      record = links.get(identity(link)),
      current = workflow(record);
    if (!current) throw Error('Choose Edit in Comfy for this clip before applying changes.');
    if (record.sourceKey !== link.sourceKey || record.link?.sidecarSha !== link.sidecarSha)
      throw Error('This clip changed in Spool. Choose Edit in Comfy again to open its current setup.');
    if (app.extensionManager.workflow.activeWorkflow !== current)
      throw Error(
        'A different Comfy workflow is active. Choose Edit in Comfy to focus this clip, then apply its changes.',
      );
    const result = await capture();
    if (app.extensionManager.workflow.activeWorkflow !== current || links.get(identity(link)) !== record)
      throw Error('The linked workflow changed during capture. Try again.');
    result.provenance = { ...result.provenance, spoolLink: { ...link, workflowPath: current.path } };
    return result;
  }
  function applied({ previous, next }) {
    const record = links.get(identity(previous));
    if (!record || record.sourceKey !== previous.sourceKey || !workflow(record)) return { linked: false };
    record.sourceKey = next.sourceKey;
    record.link = next;
    save();
    return { linked: true };
  }
  function current() {
    return [...links.values()].find(record => record.path === app.extensionManager.workflow.activeWorkflow?.path);
  }
  return { open, capture: captureLinked, applied, current };
}
