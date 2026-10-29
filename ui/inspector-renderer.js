import { visibleInputs } from './input-groups.js';
// Editor adapters are explicit; rendering always reads the current draft.
export function createInspectorRenderer({
  $,
  esc,
  workflowStatus,
  definitionsFor,
  workflows,
  pixelResolution,
  builtinBindings,
  drawn,
  getInspectorTab,
  getState,
  edits,
  selected,
  selectionIds,
  take,
  toast,
  draw,
  takeFacts,
  renderNonVideoInspector,
  renderSelectionInspector,
  inspectorNotes,
  getRenderTakes,
  getChooseTake,
  getSelectedAudio,
  getNativeRecipes,
  getIsInt,
  getRenderJobStatus,
  getQueueReason,
  getBindWorkflowControls,
  getControlField,
  getBindImageInputs,
  getUseTimelineVideo,
  getClearInput,
  getReplaceInputMedia,
  getCountLabel,
  getJobStatus,
  getEditableGraph,
  getOpenNativeWorkflow,
  getPrepareWorkflow,
}) {
  function renderInspector() {
    inspectorNotes.render();
    if (selectionIds().length > 1) {
      renderSelectionInspector();
      return;
    }
    $('inspector').classList.remove('multi-selected');
    const c = selected();
    if (!c || getSelectedAudio()() || getInspectorTab() === 'audio') {
      renderNonVideoInspector();
      getCountLabel().hidden = true;
      getJobStatus().textContent = '';
      return;
    }
    $('inspector').classList.remove('audio-selected');
    $('clipName').value = c.name;
    $('inputsInspectorTab').classList.add('active');
    $('inputsInspectorTab').setAttribute('aria-selected', 'true');
    $('audioInspectorTab').classList.remove('active');
    $('audioInspectorTab').setAttribute('aria-selected', 'false');
    getRenderTakes()();
    const reason = getQueueReason()(c),
      embedded = !c.workflow && !c.workflowVersion && !!getEditableGraph()(c),
      bindings = getNativeRecipes()[c.workflowVersion]
        ? builtinBindings(getNativeRecipes()[c.workflowVersion], definitionsFor(c), c.bindings)
        : c.bindings || [],
      shown = new Set(visibleInputs(bindings, c.inputValues || {}, c.shotInputs || [])),
      essential = bindings.map((b, i) => ({ b, i })).filter(({ b }) => !b.advanced && shown.has(b)),
      pose = essential.filter(({ b }) => b.role === 'pose');
    $('generate').hidden = false;
    $('generate').disabled = !!reason;
    $('generate').title = reason || 'Generate new takes with these settings';
    $('generateLabel').textContent = 'Generate';
    getCountLabel().hidden = !!reason;
    $('nativeCount').value = c.count || 1;
    $('nativeCount').onchange = e => {
      const value = Number(e.target.value);
      if (!Number.isInteger(value) || value < 1 || value > 16) {
        e.target.value = c.count || 1;
        return;
      }
      edits.apply(
        'Change take count',
        () => {
          c.count = value;
        },
        'none',
      );
    };
    getRenderJobStatus()();
    const setup = workflowStatus(
      c,
      workflows[c.workflow],
      getNativeRecipes()[c.workflowVersion],
      definitionsFor(c),
      embedded,
    );
    const workflowLabel = c.generationBase
      ? 'Workflow from take'
      : c.workflowVersion
        ? 'Clip workflow'
        : embedded
          ? 'Workflow from take'
          : 'Choose a take with a workflow';
    draw(
      'inspectorContent',
      '<div class="clip-workflow-heading' +
        (!c.workflowVersion && !embedded && !c.workflow && !c.generationBase ? ' no-workflow' : '') +
        '"><span>' +
        workflowLabel +
        '<small class="workflow-route">' +
        (Object.values(getNativeRecipes()[c.workflowVersion]?.prompt || {}).some(n =>
          ['DeadlineSubmit', 'SaveAndSubmitNode'].includes(n.class_type),
        )
          ? 'Deadline'
          : c.executionTarget === 'cloud'
            ? 'Comfy Cloud'
            : 'Local ComfyUI') +
        '</small></span><div class="clip-workflow-actions"><button class="outline" id="editClipWorkflow">Edit in Comfy</button><button class="outline" id="reloadTakeWorkflow" title="Restore the selected take’s saved workflow and inputs, replacing current edits">Reload workflow from take</button></div></div>' +
        (!setup.ready
          ? '<p class="' +
            (setup.problem ? 'workflow-problem' : 'workflow-hint') +
            '" role="status">' +
            esc(setup.note) +
            '</p>'
          : '') +
        (getNativeRecipes()[c.workflowVersion]?.executionTarget === 'cloud'
          ? '<label class="field"><span>Execute on</span><select id="clipExecutionTarget"><option value="cloud" ' +
            ((c.executionTarget || 'cloud') === 'cloud' ? 'selected' : '') +
            '>Comfy Cloud · Developer Platform</option><option value="local" ' +
            (c.executionTarget === 'local' ? 'selected' : '') +
            '>Local ComfyUI · Partner Nodes</option></select></label>'
          : '') +
        '<div class="native-bindings">' +
        essential
          .filter(({ b }) => b.role !== 'pose')
          .map(({ b, i }) => getControlField()(b, i, c))
          .join('') +
        '</div>' +
        (pose.length
          ? '<details class="native-advanced"><summary>Pose extraction</summary><div class="native-bindings">' +
            pose.map(({ b, i }) => getControlField()(b, i, c)).join('') +
            '</div></details>'
          : '') +
        (!c.workflowVersion ? takeFacts(take(c)) : ''),
    );
    $('editClipWorkflow').disabled = $('editClipWorkflow').hidden = !c.workflowVersion && !embedded && !c.workflow;
    $('editClipWorkflow').onclick = () =>
      c.workflow && !c.workflowVersion && !embedded
        ? getPrepareWorkflow()(
            { ...workflows[c.workflow].data, importedWorkflowId: c.workflow },
            c.name,
            getState().clips.indexOf(c),
            c.id,
          )
        : getOpenNativeWorkflow()();
    $('reloadTakeWorkflow').disabled = $('reloadTakeWorkflow').hidden = !!take(c).placeholder || !getEditableGraph()(c);
    $('reloadTakeWorkflow').onclick = () => getChooseTake()(c.id, c.takeId);
    const executionTarget = $('clipExecutionTarget');
    if (executionTarget)
      executionTarget.onchange = () => {
        edits.apply(
          'Change execution target',
          () => {
            c.executionTarget = executionTarget.value;
            c.revision++;
          },
          'inspector',
        );
      };
    getBindImageInputs()(c);
    $('inspectorContent')
      .querySelectorAll('[data-clear-input]')
      .forEach(
        button =>
          (button.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            getClearInput()(c, Number(button.dataset.clearInput));
          }),
      );
    $('inspectorContent')
      .querySelectorAll('[data-media-input]')
      .forEach(field => {
        const index = Number(field.dataset.mediaInput),
          picker = field.querySelector('input'),
          button = field.querySelector('[data-media-upload]'),
          timeline = field.querySelector('[data-use-timeline-video]');
        button.onclick = () => picker.click();
        if (timeline) timeline.onclick = () => getUseTimelineVideo()(c.id, index);
        const replace = async files => {
          if (files.length !== 1) return;
          button.disabled = true;
          try {
            await getReplaceInputMedia()(c, index, files[0]);
          } catch (error) {
            toast(error.message);
          } finally {
            button.disabled = false;
          }
        };
        picker.onchange = () => replace([...picker.files]);
        field.ondragover = e => {
          e.preventDefault();
          e.stopPropagation();
        };
        field.ondrop = e => {
          e.preventDefault();
          e.stopPropagation();
          void replace([...e.dataTransfer.files]);
        };
      });

    $('inspectorContent')
      .querySelectorAll('[data-pixel-resolution]')
      .forEach(group => {
        for (const field of group.querySelectorAll('select'))
          field.onchange = () => {
            const b = c.bindings[Number(group.dataset.pixelResolution)],
              size = Number(group.querySelector('[data-resolution-size]').value),
              ratio = group.querySelector('[data-resolution-ratio]').value,
              value = b.options.find(v => {
                const p = pixelResolution(v);
                return p.size === size && p.ratio === ratio;
              });
            if (!value) return;
            edits.apply(
              'Change resolution and aspect ratio',
              () => {
                c.inputValues[b.key] = value;
                c.revision++;
              },
              'none',
            );
          };
      });

    $('inspectorContent')
      .querySelectorAll('[data-seed-mode]')
      .forEach(
        field =>
          (field.onchange = () => {
            edits.apply(
              'Change seed behavior',
              () => {
                c.seedMode = field.value;
                c.seedKey = field.dataset.seedMode;
                c.revision++;
              },
              'inspector',
            );
          }),
      );
    $('inspectorContent')
      .querySelectorAll('[data-native-control]')
      .forEach(
        field =>
          (field.onchange = () => {
            const b = bindings[Number(field.dataset.nativeControl)],
              original = Object.hasOwn(c.inputValues, b.key)
                ? c.inputValues[b.key]
                : getNativeRecipes()[c.workflowVersion].prompt[b.nodeId].inputs[b.input],
              integer = getIsInt()(original) && b.contract?.inputType !== 'FLOAT';
            let value = integer
              ? { __spool_int__: field.value }
              : typeof original === 'boolean'
                ? field.value === 'true'
                : typeof original === 'number'
                  ? Number(field.value)
                  : field.value;
            if (integer && !/^[-]?\d+$/.test(field.value)) {
              toast('Use an exact decimal integer');
              return;
            }
            if (typeof value === 'number' && !Number.isFinite(value)) return;
            edits.apply(
              'Change ' + b.label,
              () => {
                getBindWorkflowControls()(c, bindings);
                c.inputValues[b.key] = value;
                c.revision++;
                delete drawn.inspectorContent;
              },
              'none',
            );
          }),
      );
  }

  return { renderInspector };
}
