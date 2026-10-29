import * as T from './timeline.js';

// Authored actions shared by installed controls and lifecycle checks.
export function createWorkflowAssignment({
  inputReplacements,
  copy,
  getRecipes,
  definitionsFor,
  getFps,
  matchClipInputs,
}) {
  function applyPreparedWorkflow(c, workflow, version) {
    inputReplacements.invalidate(c.id);
    const source = copy(c),
      recipe = getRecipes()[version];
    c.workflow = workflow;
    c.workflowVersion = version;
    c.bindings = copy(recipe.bindings);
    c.inputValues = Object.fromEntries(
      recipe.bindings.map(b => [
        b.key,
        recipe.provenance?.builtinTemplate && b.asset ? '' : copy(recipe.prompt[b.nodeId].inputs[b.input]),
      ]),
    );
    c.executionTarget = recipe.executionTarget || 'local';
    delete c.generationBase;
    delete c.shotInputs;
    delete c.seedKey;
    c.seedMode = 'same';
    c.revision++;
    matchClipInputs(c, source, recipe, definitionsFor(c), getFps());
  }
  return { applyPreparedWorkflow };
}

export function createHistoryActions({
  clearCut,
  getDrag,
  cancelClipDrag,
  pause,
  editView,
  viewState,
  history,
  getState,
  setState,
  inputReplacements,
  preserveTakes,
  review,
  setSelectionAnchor,
  buttons,
  setStatus,
  render,
  save,
  $,
  document = globalThis.document,
}) {
  function restoreHistory(from, to, verb) {
    clearCut();
    if (getDrag()) {
      cancelClipDrag();
      return;
    }
    if (!from.length) return;
    pause();
    editView();
    const view = viewState(),
      step = history.step(from, to, getState());
    if (!step) {
      buttons();
      setStatus('That edit is no longer available');
      return;
    }
    inputReplacements.invalidate();
    setState(preserveTakes(step.restored));
    review.reconcile();
    setSelectionAnchor(getState().selectedAudio || getState().selected);
    for (const key of ['zoom', 'snap', 'muted', 'loop']) getState()[key] = view[key];
    render();
    save();
    setStatus(verb + ' ' + (step.label || 'edit'));
    if (!document.activeElement || document.activeElement === document.body) $('editor').focus({ preventScroll: true });
  }
  return { restoreHistory };
}

export function createRemovalActions({
  getState,
  selectionIds,
  edits,
  pause,
  editView,
  inputReplacements,
  setTimelineSelection,
  clamp,
  total,
  setStatus,
}) {
  function remove(ripple = false) {
    const ids = selectionIds().slice();
    if (!ids.length) return;
    const index = Math.max(
        0,
        getState().clips.findIndex(c => c.id === getState().selected),
      ),
      videos = getState()
        .clips.filter(c => ids.includes(c.id))
        .reverse();
    edits.apply(
      (ripple ? 'Ripple delete ' : 'Delete ') + ids.length + ' ' + (ids.length === 1 ? 'clip' : 'clips'),
      () => {
        pause();
        editView();
        for (const c of videos) {
          inputReplacements.invalidate(c.id);
          T.removeClip(getState(), c.id, { ripple });
        }
        for (const id of ids) if ((getState().audioClips || []).some(c => c.id === id)) T.removeAudio(getState(), id);
        const next =
          getState().clips[Math.min(index, getState().clips.length - 1)]?.id || getState().audioClips?.[0]?.id;
        setTimelineSelection(next ? [next] : []);
        getState().frame = clamp(getState().frame, 0, total());
      },
    );
    setStatus(
      ripple
        ? 'Ripple delete - following video clips moved'
        : 'Clips deleted - gaps preserved; Shift+Delete ripple deletes',
    );
  }
  return { remove };
}
