// Editor adapters are explicit; rendering always reads the current draft.
export function createWorkflowCoordinator({
  $,
  copy,
  esc,
  svg,
  productCapabilities,
  getProductDefinitions,
  builtinCaptures,
  cloudDefinitions,
  url,
  thumbnails,
  getFps,
  workflows,
  getWorkflowLibrary,
  builtinBindings,
  resultChoices,
  builtinPreparer,
  getWorkflowAdds,
  setWorkflowAdds,
  registerWorkflowData,
  addImportedWorkflowClip,
  applyPreparedWorkflow,
  getState,
  edits,
  videoTotal,
  total,
  toast,
  setStatus,
  projectMedia,
  getPickImport,
  getAddMediaClip,
  getPause,
  getShowModal,
  getCloseModal,
  getNativeRecipes,
  getConnectComfy,
  getWorkflowSetup,
}) {
  const preparedWorkflows = new Map();
  const workflowLoads = new Map();
  const unsavedRecipes = new Map();
  const workflowSignatures = new WeakMap();
  function workflowSourceKey(data) {
    if (!workflowSignatures.has(data))
      workflowSignatures.set(
        data,
        JSON.stringify([
          data.workflow,
          data.prompt,
          data.bindings,
          data.result,
          data.resultOnly,
          data.widgetBindings,
          data.executionTarget || 'local',
        ]),
      );
    return workflowSignatures.get(data);
  }
  function libraryWorkflow(id, builtin) {
    const w = builtin ? getWorkflowLibrary().template(id) : workflows[id];
    if (!w) return {};
    const sources = builtin
        ? Object.values(workflows).filter(
            w =>
              w.data?.prompt &&
              w.data.provenance?.builtinTemplate === id &&
              workflowSourceKey(w.data) === workflowSourceKey(builtinCaptures[id]),
          )
        : [w],
      source = sources[0];
    const key = (builtin ? 'builtin:' : 'project:') + id;
    let prepared = preparedWorkflows.get(key);
    if (!prepared)
      for (const candidate of sources.filter(w => w?.data.prompt)) {
        const signature = workflowSourceKey(candidate.data),
          entry = Object.entries(getNativeRecipes()).find(([, recipe]) => workflowSourceKey(recipe) === signature);
        if (entry) {
          prepared = { workflow: candidate.id, version: entry[0], definitions: getProductDefinitions() };
          preparedWorkflows.set(key, prepared);
          break;
        }
      }
    return { w, source, key, prepared };
  }
  function loadProjectWorkflow(id) {
    const { w, source, key } = libraryWorkflow(id, false);
    if (!w) return;
    if (workflowLoads.has(key)) return workflowLoads.get(key);
    const promise = (async () => {
      if (source?.data.prompt) return { ...copy(source.data), importedWorkflowId: source.id };
      if (!productCapabilities.connected) await getConnectComfy()();
      const graph = w.data?.workflow;
      const captured = await builtinPreparer.capture(productCapabilities.configuration.comfyUrl, copy(graph));
      return { ...captured, importedWorkflowId: id };
    })();
    workflowLoads.set(key, promise);
    promise.catch(() => workflowLoads.delete(key));
    return promise;
  }
  function addLibraryShot(id, index = null, clipId = null, builtin = false, placement = null) {
    setWorkflowAdds(
      getWorkflowAdds()
        .catch(() => {})
        .then(async () => {
          const { w, key, prepared: existing } = libraryWorkflow(id, builtin);
          if (!w) return;
          let prepared = existing;
          const target = clipId && getState().clips.find(c => c.id === clipId);
          if (clipId && !target) throw Error('This clip was removed.');
          if (index === null) {
            index = getState().clips.length;
            placement = { track: 1, start: total() };
          }
          const name = builtin ? w.family + ' · ' + w.name : w.name;
          const profileTemplate = builtin ? w : getWorkflowLibrary().template(w.data?.provenance?.builtinTemplate);
          if (!prepared && builtin) {
            const capture = copy(builtinCaptures[id]);
            capture.bindings = builtinBindings(capture, getProductDefinitions());
            const workflow = registerWorkflowData(capture, name),
              version = crypto.randomUUID();
            getNativeRecipes()[version] = capture;
            unsavedRecipes.set(version, capture);
            prepared = {
              workflow: workflow.id,
              version,
              definitions:
                w.section === 'cloud' ? { ...getProductDefinitions(), ...cloudDefinitions } : getProductDefinitions(),
            };
            preparedWorkflows.set(key, prepared);
          }
          // The new shot and its recipe share the ordinary save queue. Neither graph
          // capture nor NAS publication should block the edit.
          if (
            prepared &&
            (profileTemplate ||
              resultChoices(getNativeRecipes()[prepared.version].prompt, prepared.definitions).length === 1)
          ) {
            if (target)
              edits.apply('Replace workflow', () => applyPreparedWorkflow(target, prepared.workflow, prepared.version));
            else addImportedWorkflowClip(prepared.workflow, index, null, placement, prepared.version);
            $('editor').focus({ preventScroll: true });
            setStatus('Workflow added');
            return;
          }
          setStatus('Preparing ' + name + '…');
          let definitions;
          const capture = async () => {
            const value = prepared
              ? {
                  ...copy(getNativeRecipes()[prepared.version]),
                  definitions: prepared.definitions,
                  importedWorkflowId: prepared.workflow,
                }
              : copy(await loadProjectWorkflow(id));
            definitions = value.definitions || getProductDefinitions();
            return value;
          };
          const session = await getWorkflowSetup().start({
            capture,
            name,
            index,
            clipId,
            automatic: true,
            builtin: profileTemplate,
            replaceWorkflow: !!clipId,
            placement,
            preparedVersion: prepared?.version,
            definitions: getProductDefinitions(),
            previous: !clipId && profileTemplate ? w.data : null,
          });
          if (session) {
            await session.completed;
            const saved = getState().clips.find(c => c.id === session.savedClipId);
            if (saved?.workflowVersion)
              preparedWorkflows.set(key, { workflow: saved.workflow, version: saved.workflowVersion, definitions });
          }
        })
        .catch(error => {
          toast(error.message);
          setStatus('Workflow was not added');
        }),
    );
    return getWorkflowAdds();
  }
  function addBuiltinShot(id, index = null, clipId = null, placement = null) {
    return addLibraryShot(id, index, clipId, true, placement);
  }
  function showShotPicker() {
    getPause()();
    getShowModal()(
      'Add shot',
      '<div class="shot-picker"><section><h3>Workflows</h3><div class="shot-workflows">' +
        Object.entries(workflows)
          .map(([id, w]) => '<button class="workflow-row" data-shot-workflow="' + id + '">' + esc(w.name) + '</button>')
          .join('') +
        '</div><button class="outline" id="shotImportWorkflow">' +
        svg('plus') +
        'Import workflow</button></section><section><h3>Media</h3><div class="shot-media">' +
        projectMedia()
          .filter(m => m.kind !== 'audio')
          .map(
            m =>
              '<button class="shot-media-item" data-shot-media="' +
              m.id +
              '"><img src="' +
              esc(url(m.poster)) +
              '" alt=""><span>' +
              esc(m.name) +
              '</span></button>',
          )
          .join('') +
        '</div><button class="outline" id="shotImportMedia">' +
        svg('import') +
        'Import media</button></section></div>',
      '<button class="outline" id="shotCancel">Cancel</button>',
    );
    $('shotCancel').onclick = getCloseModal();
    $('modal')
      .querySelectorAll('[data-shot-media]')
      .forEach(b => {
        const m = projectMedia().find(m => m.id === b.dataset.shotMedia);
        thumbnails.bind(b.querySelector('img'), m, m.frames / 2, getFps());
      });
    $('modal')
      .querySelectorAll('[data-shot-workflow]')
      .forEach(
        b =>
          (b.onclick = () => {
            const id = b.dataset.shotWorkflow;
            getCloseModal()();
            addLibraryShot(id);
          }),
      );
    $('modal')
      .querySelectorAll('[data-shot-media]')
      .forEach(
        b =>
          (b.onclick = () => {
            const id = b.dataset.shotMedia;
            getCloseModal()();
            getAddMediaClip()(id, getState().clips.length, videoTotal());
          }),
      );
    $('shotImportWorkflow').onclick = () => {
      getCloseModal()();
      getPickImport()(true, true);
    };
    $('shotImportMedia').onclick = () => {
      getCloseModal()();
      getPickImport()(true);
    };
  }

  return {
    preparedWorkflows,
    workflowLoads,
    unsavedRecipes,
    libraryWorkflow,
    addLibraryShot,
    addBuiltinShot,
    showShotPicker,
  };
}
