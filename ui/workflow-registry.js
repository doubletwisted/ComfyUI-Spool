import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createWorkflowRegistry({
  copy,
  url,
  getFps,
  workflows,
  importedWorkflowPoster,
  getApplyPreparedWorkflow,
  getState,
  getEdits,
  getActiveVideoTrack,
  getRowFor,
  setStatus,
  editView,
  getPause,
  clearHeld,
}) {
  function isWorkflowDocument(value) {
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (Array.isArray(value.nodes)
        ? value.nodes.every(n => n && n.id !== undefined && typeof n.type === 'string')
        : Object.keys(value).length > 0 &&
          Object.values(value).every(
            n =>
              n &&
              typeof n.class_type === 'string' &&
              n.inputs &&
              typeof n.inputs === 'object' &&
              !Array.isArray(n.inputs),
          ))
    );
  }
  function decodeWorkflowValue(value) {
    for (let i = 0; i < 3 && typeof value === 'string'; i++) value = JSON.parse(value.trim());
    return value;
  }
  function readWorkflowData(value) {
    value = decodeWorkflowValue(value);
    if (isWorkflowDocument(value))
      return { workflow: copy(value), prompt: Array.isArray(value.nodes) ? null : copy(value) };
    if (value && typeof value === 'object') {
      const graph = decodeWorkflowValue(value.workflow ?? value.prompt);
      if (isWorkflowDocument(graph)) {
        let prompt = null;
        try {
          prompt = decodeWorkflowValue(value.prompt ?? null);
        } catch (error) {}
        return { workflow: copy(graph), prompt: isWorkflowDocument(prompt) ? copy(prompt) : null };
      }
    }
    throw Error('This JSON is not a ComfyUI workflow. Use Open project for Spool projects.');
  }
  function syncImportedWorkflows() {
    for (const [id, w] of Object.entries(workflows)) if (w.imported) delete workflows[id];
    for (const saved of getState().importedWorkflows || [])
      workflows[saved.id] = {
        ...saved,
        imported: true,
        short: 'WF',
        poster: url(saved.poster || importedWorkflowPoster),
        sources: [],
        prompt: '',
        media: null,
      };
  }
  function registerWorkflowData(data, name, poster) {
    const key = JSON.stringify(data),
      existing = (getState().importedWorkflows || []).find(w => JSON.stringify(w.data) === key);
    if (existing) return existing;
    const w = {
      id: 'workflow-' + crypto.randomUUID(),
      name: name.replace(/\.(json|png|webp|jpe?g|mp4|mov|mkv|webm|gif)$/i, ''),
      data: copy(data),
      poster: poster || importedWorkflowPoster,
    };
    (getState().importedWorkflows ??= []).push(w);
    syncImportedWorkflows();
    return w;
  }
  function addImportedWorkflowClip(
    workflow,
    index = getState().clips.length,
    m = null,
    placement = null,
    workflowVersion = null,
  ) {
    const w = workflows[workflow];
    if (!w?.imported) return;
    getEdits().apply('Add ' + w.name, () => {
      getPause()();
      editView();
      clearHeld();
      const duration = w.data?.bindings?.find(b => b.role === 'duration'),
        seconds = duration?.unit === 'seconds' ? Number(w.data.prompt[duration.nodeId].inputs[duration.input]) : 5;
      const asset = m
        ? copy(m)
        : {
            id: 'empty-' + crypto.randomUUID(),
            name: 'Not generated',
            kind: 'image',
            file: 'assets/black.png',
            poster: importedWorkflowPoster,
            frames: Math.max(1, Math.round((seconds || 5) * getFps())),
            audio: false,
          };
      const t = {
        id: 'take-' + crypto.randomUUID(),
        number: m ? 1 : 0,
        seed: null,
        revision: 1,
        media: asset,
        sample: false,
        placeholder: !m,
        workflowSnapshot: copy(w.data),
      };
      const c = {
        id: 'clip-' + crypto.randomUUID(),
        name: m ? m.name.replace(/\.[^.]+$/, '') : w.name,
        workflow: w.id,
        ...(w.data.executionTarget ? { executionTarget: w.data.executionTarget } : {}),
        prompt: '',
        sources: [],
        seed: 0,
        duration: asset.frames / getFps(),
        count: 1,
        strength: 0.75,
        revision: 1,
        takes: [t],
        takeId: t.id,
        in: 0,
        out: asset.frames,
      };
      if (workflowVersion) getApplyPreparedWorkflow()(c, workflow, workflowVersion);
      T.insertClip(
        getState(),
        c,
        index,
        placement
          ? { ...placement, ripple: true }
          : {
              track: getActiveVideoTrack(),
              start: T.videoTracks(getState()) > 1 ? Math.round(getState().frame) : null,
            },
      );
      getState().selected = c.id;
      getState().selectedAudio = null;
      getState().frame = getRowFor()(c.id).start;
    });
    setStatus(m ? 'Video and workflow added to the edit' : 'Workflow added · no generated take yet');
  }
  return { readWorkflowData, syncImportedWorkflows, registerWorkflowData, addImportedWorkflowClip };
}
