import * as B from './bridge.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createWorkflowDialogs({
  $,
  copy,
  esc,
  api,
  request,
  matchClipInputs,
  inputReplacements,
  getProductDefinitions,
  definitionsFor,
  projectKey,
  getFps,
  workflows,
  reusableBinding,
  registerWorkflowData,
  addImportedWorkflowClip,
  applyPreparedWorkflow,
  getState,
  review,
  history,
  edits,
  selected,
  take,
  total,
  clamp,
  saveHistory,
  save,
  toast,
  buttons,
  render,
  markTakesSeen,
  renderInspector,
  showModal,
  closeModal,
  saveView,
  nativeRecipes,
  linkedSidecarHashes,
  getBridgeClient,
  getBridgeReady,
  host,
  exactInt,
  isInt,
  decimal,
  projectEdit,
  flushNative,
  focusViewId,
  evidenceCache,
  getWorkflowSetup,
}) {
  async function mediaEvidence(m) {
    if (!m?.id || !Array.isArray(m.evidence) || !m.evidence.length) return null;
    if (evidenceCache.has(m.id)) return evidenceCache.get(m.id);
    const held = await request('projects/' + projectKey + '/media/' + encodeURIComponent(m.id) + '/evidence');
    evidenceCache.set(m.id, held);
    return held;
  }
  async function mediaWorkflowData(m) {
    if (m.workflowData) return m.workflowData;
    const kinds = Array.isArray(m.evidence) ? m.evidence : null;
    if (!kinds?.includes('workflowData')) return null;
    return (await mediaEvidence(m))?.workflowData || null;
  }
  function editableGraph(c) {
    const recipe = nativeRecipes[c.workflowVersion] || workflows[c.workflow]?.data;
    if (Array.isArray(recipe?.workflow?.nodes) || (c.generationBase && recipe?.prompt)) return { capture: recipe };
    const t = take(c),
      m = t?.media;
    const snapshot = t?.workflowSnapshot || t?.request?.capture;
    if (Array.isArray(snapshot?.workflow?.nodes)) return { capture: snapshot };
    if (t?.recipeGraph) return { take: t };
    const inline = m?.workflowData || (m?.workflow ? { workflow: m.workflow, prompt: m.prompt } : null);
    if (Array.isArray(inline?.workflow?.nodes)) return { capture: inline };
    return m?.embeddedGraph ? { media: m } : null;
  }
  async function resolvedClipWorkflow(c) {
    const graph = editableGraph(c);
    if (!graph) return null;
    if (graph.capture) return graph.capture;
    if (graph.take)
      return (await request('projects/' + projectKey + '/takes/' + encodeURIComponent(graph.take.id))).request.capture;
    const held = await mediaEvidence(graph.media);
    return held?.workflowData || (held?.workflow ? { workflow: held.workflow, prompt: held.prompt } : null);
  }
  function clipWorkflowLink(c) {
    return {
      projectId: projectKey,
      clipId: c.id,
      editorId: focusViewId,
      sidecarSha: linkedSidecarHashes.get(c.id) ?? nativeRecipes[c.workflowVersion]?.sidecar?.sha256 ?? '',
      sourceKey: JSON.stringify({
        graphFormat: 'workflow',
        version: c.workflowVersion,
        take: c.takeId,
        values: Object.fromEntries(
          Object.entries(c.inputValues || {}).map(([key, value]) => [key, isInt(value) ? decimal(value) : value]),
        ),
        sources: c.shotInputs || [],
        in: c.in,
        out: c.out,
        fps: getFps(),
      }),
    };
  }
  async function openNativeWorkflow() {
    const tab = getBridgeReady() !== true ? window.open('about:blank', '_blank') : null;
    if (tab) {
      tab.document.title = 'Opening Comfy workflow';
      tab.document.body.textContent = 'Spool is connecting to Comfy...';
    }
    try {
      await projectEdit.prepareNavigation();
      if (!selected()) throw Error('Select a clip first.');
      const c = copy(selected());
      const saved = c.workflowVersion ? await request('workflows/' + c.workflowVersion) : await resolvedClipWorkflow(c);
      const current = !take(c)?.placeholder
        ? await request(
            'projects/' +
              projectKey +
              '/take-workflow/' +
              encodeURIComponent(c.id) +
              '/' +
              encodeURIComponent(c.takeId),
          )
        : null;
      linkedSidecarHashes.set(c.id, current?.sidecar?.sha256 || '');
      const capture = current?.sidecar ? current : saved,
        link = clipWorkflowLink(c);
      if (!capture) throw Error('This clip has no workflow graph');
      if (!capture.workflow?.nodes?.length)
        throw Error('This recipe has no editable Comfy graph. Import the original workflow to edit it in Comfy.');
      const prompt = capture.prompt ? copy(capture.prompt) : null;
      const sameSetup = !capture.sidecar || capture.sidecar.sha256 === saved?.sidecar?.sha256;
      const controls = sameSetup
        ? (c.bindings || [])
            .filter(b => Object.hasOwn(c.inputValues || {}, b.key))
            .map(b => ({ nodeId: b.nodeId, input: b.input, value: c.inputValues[b.key] }))
        : [];
      if (prompt) for (const b of controls) if (prompt[b.nodeId]) prompt[b.nodeId].inputs[b.input] = b.value;
      if (prompt && sameSetup && c.shotInputs?.length) {
        const preview = await request('projects/' + projectKey + '/generation-preview', {
          revision: projectEdit.revision,
          clipId: c.id,
        });
        for (const asset of preview.assets) prompt[asset.nodeId].inputs[asset.input] = asset.frozen;
      }
      if (prompt)
        for (const control of controls) {
          control.value = prompt[control.nodeId].inputs[control.input];
          if (exactInt(control.value)) {
            const number = Number(decimal(control.value));
            if (!Number.isSafeInteger(number))
              throw Error(
                'This control exceeds Comfy’s exact browser integer range. Keep its preserved execution value or choose an exact safe integer before editing in Comfy.',
              );
            control.value = number;
          }
        }
      const result = await host(
        B.ACTIONS.open,
        { workflow: capture.workflow, prompt, preferWorkflow: true, controls, name: c.name, link },
        tab,
      );
      toast(
        result.reused
          ? 'Focused this clip’s linked Comfy workflow.'
          : 'Workflow linked. Edit it in Comfy, then choose Apply to clip in Spool.',
      );
    } catch (error) {
      if (tab && !tab.closed) {
        try {
          if (tab.location.href === 'about:blank') tab.close();
        } catch {}
      }
      toast(error.message);
    }
  }
  function paintWorkflowSetup(question) {
    const { capture, name, target, choices, result, issue, candidates, savers } = question;
    if (question.exact) {
      showModal(
        'Configure exact controls',
        '<p>Select literal inputs to expose. Linked inputs keep their edges. Recognized source files are frozen automatically before dispatch.</p><div style="max-height:42vh;overflow:auto">' +
          candidates
            .map(
              (b, i) =>
                '<label class="field"><span><input type="checkbox" data-bind="' +
                i +
                '" ' +
                (b.old ? 'checked' : '') +
                '> ' +
                esc(b.nodeId) +
                ' · ' +
                esc(capture.prompt[b.nodeId].class_type) +
                ' / ' +
                esc(b.input) +
                '</span><input data-bind-label="' +
                i +
                '" value="' +
                esc(b.old?.label || b.input) +
                '" aria-label="Control label"></label>',
            )
            .join('') +
          '</div><div class="three-fields"><label class="field"><span>Result saver</span><select id="nativeSaver">' +
          savers
            .map(
              ([id, n]) =>
                '<option value="' +
                esc(id) +
                '" ' +
                (capture.result?.nodeId === id ? 'selected' : '') +
                '>' +
                esc(id) +
                ' · ' +
                esc(n.class_type) +
                '</option>',
            )
            .join('') +
          '</select></label><label class="field"><span>History group</span><select id="nativeGroup">' +
          ['images', 'gifs', 'videos']
            .map(g => '<option ' + (capture.result?.group === g ? 'selected' : '') + '>' + g + '</option>')
            .join('') +
          '</select></label><label class="field"><span>Artifact index (0-based)</span><input id="nativeIndex" type="number" min="0" value="' +
          (capture.result?.index || 0) +
          '"></label></div><p class="audio-note">All normal output branches execute. This selection chooses which reported artifact enters review. VHS meta_batch is unsupported. A Submit node routes this recipe to Deadline with one job per take. Host widget capture cannot recover integers already rounded by Comfy; raw API JSON preserves 64-bit values.</p><label class="field"><span><input type="checkbox" id="keepOverrides"> Keep existing Spool control overrides instead of newly captured values</span></label>',
        '<button class="outline" id="captureCancel">Cancel</button><button class="primary" id="captureSave">Save to clip</button>',
      );
      $('captureCancel').onclick = closeModal;
      $('captureSave').onclick = () =>
        question.confirm('inputs', {
          bindings: candidates.flatMap((b, i) =>
            $('modal').querySelector('[data-bind="' + i + '"]').checked
              ? [{ index: i, label: $('modal').querySelector('[data-bind-label="' + i + '"]').value }]
              : [],
          ),
          result: {
            nodeId: $('nativeSaver').value,
            group: $('nativeGroup').value,
            index: Number($('nativeIndex').value),
          },
          keep: $('keepOverrides').checked,
        });
      return;
    }
    const values = question.essential,
      optional = question.optional,
      graphOnly = !capture.prompt && Array.isArray(capture.workflow?.nodes);
    showModal(
      graphOnly
        ? 'Prepare this workflow?'
        : capture.prompt
          ? 'Capture inputs from this workflow?'
          : 'Add this workflow?',
      '<p>' +
        esc(name) +
        '</p>' +
        (graphOnly
          ? '<p>Spool will open this workflow in a separate Comfy tab and prepare its settings for generation. Comfy starts if needed. Preparing does not generate a take.</p>'
          : issue
            ? '<p>' + esc(issue) + '</p>'
            : '<p>Choose the key inputs to edit in Spool. Everything else keeps its saved settings.</p>') +
        (!issue && choices.length > 1
          ? '<label class="field"><span>Which output belongs to this clip?</span><select id="captureOutput"><option value="">Choose output…</option>' +
            choices
              .map(
                (r, i) =>
                  '<option value="' +
                  i +
                  '" ' +
                  (result === r ? 'selected' : '') +
                  '>' +
                  esc(r.label) +
                  ' · output ' +
                  (i + 1) +
                  '</option>',
              )
              .join('') +
            '</select></label>'
          : '') +
        '<div class="native-capture-values">' +
        values
          .map(
            (b, i) =>
              '<label><input type="checkbox" data-key-input="' +
              i +
              '" checked> ' +
              esc(b.label) +
              '<output>' +
              esc(exactInt(b.value) ? decimal(b.value) : b.value) +
              '</output></label>',
          )
          .join('') +
        '</div>' +
        (!issue && result && !values.length
          ? '<p class="audio-note">No supported key inputs found. You can use the workflow’s saved settings.</p>'
          : '') +
        (optional.length
          ? '<details class="native-advanced"><summary>Optional controls</summary>' +
            optional
              .map(
                (b, i) =>
                  '<label class="field"><span><input type="checkbox" data-optional-input="' +
                  i +
                  '"> ' +
                  esc(b.label) +
                  '</span></label>',
              )
              .join('') +
            '</details>'
          : '') +
        (target && Object.keys(target.inputValues || {}).length
          ? '<label class="field"><span><input type="checkbox" id="keepKeyOverrides"> Keep my Spool input changes</span></label>'
          : ''),
      '<button class="outline" id="keyCaptureCancel">Cancel</button>' +
        (!issue
          ? '<button class="outline" id="keyCaptureSaved" ' +
            (!result ? 'disabled' : '') +
            '>Use saved settings</button><button class="primary" id="keyCaptureSave" ' +
            (!result ? 'disabled' : '') +
            '>Capture</button>'
          : graphOnly
            ? '<button class="outline" id="keyCaptureGraph">Save workflow only</button><button class="primary" id="keyCapturePrepare">Prepare in Comfy</button>'
            : '<button class="primary" id="keyCaptureGraph">Add workflow only</button>'),
    );
    $('keyCaptureCancel').onclick = closeModal;
    if ($('captureOutput')) $('captureOutput').onchange = e => question.chooseOutput(e.target.value);
    const selection = () => ({
      essential: values.flatMap((b, i) =>
        $('modal').querySelector('[data-key-input="' + i + '"]').checked ? [i] : [],
      ),
      optional: optional.flatMap((b, i) =>
        $('modal').querySelector('[data-optional-input="' + i + '"]').checked ? [i] : [],
      ),
      keep: $('keepKeyOverrides')?.checked,
    });
    if ($('keyCaptureGraph')) $('keyCaptureGraph').onclick = () => question.confirm('graph');
    if ($('keyCaptureSaved')) $('keyCaptureSaved').onclick = () => question.confirm('saved', selection());
    if ($('keyCaptureSave')) $('keyCaptureSave').onclick = () => question.confirm('inputs', selection());
    if (graphOnly)
      $('keyCapturePrepare').onclick = () => {
        const graph = { ...capture, importedWorkflowId: question.session.workflowId };
        closeModal();
        prepareWorkflow(graph, name, question.session.index, question.session.clipId);
      };
  }
  async function saveWorkflowSetup({ session, capture, name, clipId, index, mode, keep, exact, automatic }) {
    let c = clipId ? getState().clips.find(c => c.id === clipId) : null;
    if (session.replaceInputs) {
      const link = capture.provenance?.spoolLink;
      if (
        !c ||
        link?.projectId !== projectKey ||
        link.clipId !== clipId ||
        clipWorkflowLink(c).sourceKey !== link.sourceKey
      )
        throw Error('This clip changed while Comfy was being captured. Reopen its workflow before applying changes.');
    }
    if (clipId) inputReplacements.invalidate(clipId);
    if (session.takeId) {
      const before = copy(getState());
      const { adopted } = await projectEdit.change(
        revision =>
          request('projects/' + projectKey + '/use-take/' + encodeURIComponent(clipId), {
            revision,
            takeId: session.takeId,
            capture: mode === 'graph' ? null : capture,
          }),
        true,
      );
      if (adopted) {
        history.record(before, 'Use take and generation setup');
        review.used(clipId);
        markTakesSeen([session.takeId]);
        getState().frame = clamp(getState().frame, 0, total());
        render();
        saveView();
        toast(
          capture && mode !== 'graph'
            ? 'Take in edit. Next generation uses its metadata.'
            : 'Take in edit. No executable metadata; choose a workflow from the library.',
        );
      } else toast('Take setup saved. Reload to adopt it after resolving your local edit.');
      return;
    }
    const prepared = nativeRecipes[session.preparedVersion],
      reuse =
        prepared &&
        ['nodeId', 'group', 'index'].every(key => prepared.result[key] === capture.result?.[key]) &&
        prepared.bindings.length === capture.bindings.length &&
        capture.bindings.every(
          (b, i) => reusableBinding(prepared.bindings[i], b) && prepared.bindings[i].label === b.label,
        );
    if (!c) {
      const w = session.workflowId ? workflows[session.workflowId] : registerWorkflowData(capture, name);
      addImportedWorkflowClip(w.id, index, null, session.placement, reuse ? session.preparedVersion : null);
      c = selected();
      session.added = true;
      if (!reuse) await flushNative();
    }
    if (reuse) {
      if (clipId)
        edits.apply('Replace workflow', () => applyPreparedWorkflow(c, session.workflowId, session.preparedVersion));
      await flushNative();
      session.savedClipId = c.id;
      toast('Workflow prepared. Ready to generate.');
      return;
    }
    if (mode === 'graph') {
      if (clipId) {
        edits.apply(
          'Update workflow graph',
          () => {
            const w = registerWorkflowData(
              { workflow: capture.workflow, prompt: capture.prompt, provenance: capture.provenance },
              name,
            );
            c.workflow = w.id;
            delete c.workflowVersion;
            c.bindings = [];
            c.inputValues = {};
          },
          'none',
        );
        await flushNative();
      }
      toast('Workflow saved. Select the shot and click Prepare when ready.');
      return;
    }
    const before = copy(getState()),
      overrides = keep
        ? Object.fromEntries(
            capture.bindings
              .filter(b => Object.hasOwn(c.inputValues || {}, b.key))
              .map(b => [b.key, c.inputValues[b.key]]),
          )
        : undefined;
    const { adopted } = await projectEdit.change(revision =>
      request('projects/' + projectKey + '/capture/' + encodeURIComponent(c.id), {
        revision,
        capture,
        overrides,
        resetInputs: !!(session.replaceInputs || session.replaceWorkflow),
        saveSidecar: !!session.replaceInputs,
      }),
    );
    if (adopted) {
      if (clipId && !session.replaceInputs) {
        const updated = getState().clips.find(c => c.id === clipId);
        if (updated) {
          const workflow = workflows[session.workflowId] || registerWorkflowData(capture, name);
          updated.workflow = workflow.id;
          if (session.replaceWorkflow) {
            updated.executionTarget = capture.executionTarget || 'local';
            matchClipInputs(
              updated,
              before.clips.find(c => c.id === clipId),
              nativeRecipes[updated.workflowVersion],
              definitionsFor(updated),
              getFps(),
            );
          }
          save();
          await flushNative();
          renderInspector();
        }
      }
      if (!session.added)
        history.record(
          before,
          session.replaceInputs
            ? 'Apply Comfy workflow'
            : exact
              ? 'Save workflow to clip'
              : session.replaceWorkflow
                ? 'Replace workflow'
                : 'Capture clip inputs',
        );
      session.savedClipId = c.id;
      buttons();
      saveHistory();
      saveView();
      if (session.replaceInputs) {
        session.applied = true;
        const current = getState().clips.find(c => c.id === clipId);
        linkedSidecarHashes.set(clipId, nativeRecipes[current.workflowVersion]?.sidecar?.sha256 || '');
        try {
          await getBridgeClient()?.call(B.LINK_APPLIED, {
            previous: capture.provenance.spoolLink,
            next: clipWorkflowLink(current),
          });
        } catch {}
        toast('Comfy changes applied to ' + current.name);
        return;
      }
      toast(
        exact
          ? 'Immutable workflow version saved. Existing take requests are unchanged.'
          : automatic
            ? 'Workflow prepared. Ready to generate.'
            : 'Clip updated. Previous take settings are preserved.',
      );
    } else toast('Capture saved; newer local edits kept. Update again to adopt it.');
  }
  async function configureCapture(origin, initial = null) {
    const c = selected();
    if (!c) return;
    try {
      await getWorkflowSetup().start({
        name: c.name,
        clipId: c.id,
        exact: true,
        previous: nativeRecipes[c.workflowVersion],
        capture: async () => {
          let capture;
          if (origin === 'host') {
            capture = initial || (await host(B.ACTIONS.capture));
            if (c.workflowVersion) {
              const previous = await request('workflows/' + c.workflowVersion);
              capture.bindings = (previous.bindings || []).filter(
                b =>
                  capture.prompt[b.nodeId]?.class_type === previous.prompt[b.nodeId]?.class_type &&
                  Object.hasOwn(capture.prompt[b.nodeId].inputs, b.input) &&
                  (['string', 'number', 'boolean'].includes(typeof capture.prompt[b.nodeId].inputs[b.input]) ||
                    exactInt(capture.prompt[b.nodeId].inputs[b.input])),
              );
            }
          } else if (origin === 'saved') capture = await request('workflows/' + c.workflowVersion);
          else {
            const data = workflows[c.workflow]?.data;
            if (!data?.prompt || Array.isArray(data.prompt.nodes))
              throw Error('Graph-only JSON needs Open workflow, then Save graph to clip through Comfy.');
            capture = {
              workflow: Array.isArray(data.workflow?.nodes) ? data.workflow : null,
              prompt: copy(data.prompt),
              provenance: { source: 'explicit API import', historicalMetadata: copy(data) },
            };
          }
          capture.definitions = capture.definitions || (await request('capabilities')).definitions;
          return capture;
        },
      });
    } catch (error) {
      toast(error.message);
    }
  }
  async function importWorkflowFile(file) {
    const raw = await file.text();
    const { value, adopted } = await projectEdit.change(async revision => {
      return api.call('projects/' + projectKey + '/import-workflow', {
        method: 'POST',
        body: raw,
        json: false,
        headers: {
          'Content-Type': 'application/json',
          'X-Filename': encodeURIComponent(file.name),
          'X-Spool-Revision': String(revision),
        },
      });
    }, true);
    if (!adopted) throw Error('Workflow imported to the project library. Finish your local edit before adding it.');
    return value.workflow;
  }
  function captureInputs(capture, name, index = getState().clips.length, clipId = null, automatic = false) {
    return getWorkflowSetup().start({
      capture,
      name,
      index,
      clipId,
      automatic,
      definitions: getProductDefinitions(),
      previous: nativeRecipes[getState().clips.find(c => c.id === clipId)?.workflowVersion],
    });
  }
  async function prepareWorkflow(capture, name, index = getState().clips.length, clipId = null) {
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      toast('Allow Spool to open a Comfy tab, then prepare again.');
      return;
    }
    tab.document.title = 'Preparing workflow';
    tab.document.body.textContent = 'Spool is connecting to Comfy and preparing your workflow…';
    try {
      await captureInputs(
        async () => ({
          ...(await host('prepare', { workflow: capture.workflow, name, clipId }, tab)),
          importedWorkflowId: capture.importedWorkflowId,
        }),
        name,
        index,
        clipId,
        true,
      );
    } catch (error) {
      tab.close();
      toast(error.message);
    }
  }
  async function updateClipInputs(id, expected = null) {
    const c = getState().clips.find(c => c.id === id);
    try {
      if (!c) throw Error('This clip was removed.');
      if (expected && clipWorkflowLink(c).sourceKey !== expected.sourceKey)
        throw Error('This clip changed in Spool. Choose Edit in Comfy again.');
      const session = await getWorkflowSetup().start({
        name: c.name,
        clipId: id,
        index: getState().clips.indexOf(c),
        automatic: true,
        replaceInputs: true,
        previous: nativeRecipes[c.workflowVersion],
        definitions: getProductDefinitions(),
        capture: () => host(B.ACTIONS.capture, { link: clipWorkflowLink(c) }),
      });
      if (expected) {
        await session.completed;
        if (!session.applied)
          throw session.error || Error('Changes were not applied. Finish the workflow setup in Spool.');
      }
      return session;
    } catch (error) {
      toast(error.message);
      if (expected) throw error;
    }
  }
  async function addNativeGraph(capture, name = capture.name || 'Current workflow', index = getState().clips.length) {
    await captureInputs(capture, name, index);
  }
  return {
    mediaWorkflowData,
    editableGraph,
    clipWorkflowLink,
    openNativeWorkflow,
    paintWorkflowSetup,
    saveWorkflowSetup,
    configureCapture,
    importWorkflowFile,
    captureInputs,
    prepareWorkflow,
    updateClipInputs,
    addNativeGraph,
  };
}
