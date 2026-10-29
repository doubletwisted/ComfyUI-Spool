import { inputFilled } from './input-groups.js';
import { mayStayEmpty } from './input-groups.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createWorkflowControls({
  $,
  copy,
  esc,
  svg,
  request,
  getProductDefinitions,
  projectKey,
  pixelResolution,
  selected,
  take,
  toast,
  unsavedRecipes,
  nativeRecipes,
  isInt,
  decimal,
  projectEdit,
  flushNative,
  generationSourceLabel,
  getImagePreviewTicket,
  writeImagePreviewTicket,
  getReplaceInputImage,
  clipWorkflowLink,
}) {
  function bindWorkflowControls(c, bindings) {
    if (bindings.length === c.bindings.length) return;
    const capture = copy(nativeRecipes[c.workflowVersion]),
      version = crypto.randomUUID();
    capture.bindings = copy(bindings);
    c.inputValues = {
      ...Object.fromEntries(bindings.map(b => [b.key, copy(capture.prompt[b.nodeId].inputs[b.input])])),
      ...c.inputValues,
    };
    c.bindings = copy(bindings);
    c.workflowVersion = version;
    nativeRecipes[version] = capture;
    unsavedRecipes.set(version, capture);
  }
  function mediaInputLabel(b, label, empty, c) {
    return (
      '<span class="media-label">' +
      label +
      (empty && mayStayEmpty(b, c.bindings || [], nativeRecipes[c.workflowVersion]?.inputRules)
        ? '<em>Optional</em>'
        : '') +
      '</span>'
    );
  }
  function mediaRemove(b, i, c, label) {
    return b.optional && inputFilled(b, c.inputValues || {}, c.shotInputs || [])
      ? '<button type="button" class="media-action input-clear" data-clear-input="' +
          i +
          '" aria-label="Remove ' +
          label +
          '" title="Remove">' +
          svg('close') +
          '</button>'
      : '';
  }
  function controlField(b, i, c) {
    const value = Object.hasOwn(c.inputValues || {}, b.key)
        ? c.inputValues[b.key]
        : nativeRecipes[c.workflowVersion]?.prompt[b.nodeId]?.inputs[b.input],
      label = esc(b.label || b.input),
      source = (c.shotInputs || []).find(s => s.key === b.key);
    if (b.role === 'resolution' && b.options?.length && b.options.every(v => /^\d+x\d+$/.test(v))) {
      const current = pixelResolution(value),
        sizes = [...new Set(b.options.map(v => pixelResolution(v).size))],
        ratios = [...new Set(b.options.map(v => pixelResolution(v).ratio))];
      return (
        '<div class="two-fields" data-pixel-resolution="' +
        i +
        '"><label class="field"><span>Resolution</span><select data-resolution-size>' +
        sizes
          .map(v => '<option value="' + v + '" ' + (v === current.size ? 'selected' : '') + '>' + v + 'p</option>')
          .join('') +
        '</select></label><label class="field"><span>Aspect ratio</span><select data-resolution-ratio>' +
        ratios.map(v => '<option ' + (v === current.ratio ? 'selected' : '') + '>' + v + '</option>').join('') +
        '</select></label></div>'
      );
    }

    const missing = nativeRecipes[c.workflowVersion]?.inputRecovery?.missing?.some(
      m => m.nodeId === b.nodeId && m.input === b.input && m.sources.includes(value),
    );
    if (b.asset && ['video', 'audio'].includes(b.slot)) {
      const video = b.slot === 'video',
        current = take(c),
        available = !current.placeholder && current.media.kind === 'video',
        timeline = video && source?.source === 'selected';
      const empty = !source && (!value || missing),
        description = source
          ? timeline
            ? 'Timeline video · ' + c.name
            : generationSourceLabel(source)
          : empty
            ? 'No ' + b.slot + ' selected'
            : String(value).split('/').at(-1);
      return (
        '<div class="field binding-source media-slot' +
        (empty ? ' empty' : '') +
        '" data-media-input="' +
        i +
        '"><div class="media-row"><span class="media-thumb">' +
        svg(video ? 'video' : 'audio') +
        '</span><span class="media-text">' +
        mediaInputLabel(b, label, empty, c) +
        '<span class="native-source-value" data-media-source>' +
        esc(description) +
        '</span></span><span class="media-input-actions">' +
        (video
          ? '<button class="media-action" type="button" data-use-timeline-video aria-pressed="' +
            timeline +
            '" ' +
            (!available ? 'disabled' : '') +
            ' aria-label="Use timeline video" title="' +
            (available ? 'Use this clip’s selected take and timeline trim' : 'This clip needs a video take first') +
            '">' +
            svg('timeline') +
            '</button>'
          : '') +
        '<button class="media-action" type="button" data-media-upload aria-label="Choose ' +
        b.slot +
        ' file" title="Choose file…">' +
        svg('folder') +
        '</button>' +
        mediaRemove(b, i, c, label) +
        '</span></div><input type="file" accept="' +
        b.slot +
        '/*" hidden></div>'
      );
    }
    if (
      b.asset &&
      ['LoadImage', 'LoadImageMask'].includes(
        b.contract?.classType || nativeRecipes[c.workflowVersion]?.prompt[b.nodeId]?.class_type,
      )
    ) {
      const empty = !source && (!value || missing),
        name = source ? generationSourceLabel(source) : empty ? 'Choose image' : String(value).split('/').at(-1);
      return (
        '<div class="field binding-source image-input media-slot' +
        (empty ? ' empty' : '') +
        '" data-image-input="' +
        i +
        '"><button type="button" class="image-input-target media-row" aria-label="' +
        (empty ? 'Choose ' : 'Replace ') +
        label +
        '" title="Click, paste or drop an image"><span class="media-thumb"><img class="native-source-preview" ' +
        (!value || missing || source ? 'hidden' : 'src="/spool/api/input/' + encodeURIComponent(value) + '"') +
        ' alt="">' +
        svg('image') +
        '</span><span class="media-text">' +
        mediaInputLabel(b, label, empty, c) +
        '<strong>' +
        esc(name) +
        '</strong></span></button>' +
        mediaRemove(b, i, c, label) +
        '<input type="file" accept="image/*" data-image-file hidden></div>'
      );
    }
    let field =
      typeof value === 'boolean'
        ? '<select data-native-control="' +
          i +
          '"><option value="true" ' +
          (value ? 'selected' : '') +
          '>On</option><option value="false" ' +
          (!value ? 'selected' : '') +
          '>Off</option></select>'
        : isInt(value) && b.contract?.inputType !== 'FLOAT'
          ? '<input type="text" inputmode="numeric" data-exact-integer="true" data-native-control="' +
            i +
            '" value="' +
            esc(decimal(value)) +
            '">'
          : typeof value === 'number'
            ? '<input type="number" step="any" data-native-control="' + i + '" value="' + esc(value) + '">'
            : '<textarea data-native-control="' + i + '">' + esc(value ?? '') + '</textarea>';
    if (source) field = '<span class="native-source-value">' + esc(generationSourceLabel(source)) + '</span>';
    else if (b.role === 'source' || b.options) {
      const input = getProductDefinitions()[b.contract?.classType]?.input?.required?.[b.input],
        options = b.options || (Array.isArray(input?.[0]) ? input[0] : input?.[1]?.options || []);
      field =
        '<select data-native-control="' +
        i +
        '">' +
        [...new Set([value, ...options])]
          .map(v => '<option value="' + esc(v) + '" ' + (v === value ? 'selected' : '') + '>' + esc(v) + '</option>')
          .join('') +
        '</select>';
    }
    if (b.role === 'seed') {
      const mode = !c.seedKey || c.seedKey === b.key ? c.seedMode || 'same' : 'same';
      field =
        '<div class="seed-controls">' +
        field +
        '<select data-seed-mode="' +
        esc(b.key) +
        '" aria-label="' +
        label +
        ' behavior">' +
        [
          ['same', 'Fixed'],
          ['increment', 'Increment'],
          ['decrement', 'Decrement'],
          ['randomize', 'Randomize'],
        ]
          .map(
            ([id, name]) =>
              '<option value="' +
              id +
              '" ' +
              (id === (mode === 'different' ? 'increment' : mode) ? 'selected' : '') +
              '>' +
              name +
              '</option>',
          )
          .join('') +
        '</select></div>';
    }
    return (
      '<label class="field binding-' + esc(b.role || 'other') + '"><span>' + label + '</span>' + field + '</label>'
    );
  }
  function bindImageInputs(c) {
    const ticket = writeImagePreviewTicket(getImagePreviewTicket() + 1);
    const fields = [...$('inspectorContent').querySelectorAll('[data-image-input]')];
    for (const field of fields) {
      const index = Number(field.dataset.imageInput),
        button = field.querySelector('.image-input-target'),
        picker = field.querySelector('input');
      const replace = async files => {
        if (button.disabled) return;
        if (files.length !== 1) {
          toast('Choose one image for this input.');
          return;
        }
        button.disabled = true;
        try {
          await getReplaceInputImage()(c, index, files[0]);
        } catch (error) {
          toast(error.message);
        } finally {
          button.disabled = false;
        }
      };
      button.onclick = () => picker.click();
      picker.onchange = () => replace([...picker.files]);
      field.onpaste = e => {
        const files = [...e.clipboardData.items]
          .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
          .map(item => item.getAsFile())
          .filter(Boolean);
        if (files.length) {
          e.preventDefault();
          e.stopPropagation();
          void replace(files);
        }
      };
      field.ondragover = e => {
        e.preventDefault();
        e.stopPropagation();
        field.classList.add('drag-over');
      };
      field.ondragleave = () => field.classList.remove('drag-over');
      field.ondrop = e => {
        e.preventDefault();
        e.stopPropagation();
        field.classList.remove('drag-over');
        void replace([...e.dataTransfer.files]);
      };
    }
    if (
      fields.some(field => (c.shotInputs || []).some(s => s.key === c.bindings[Number(field.dataset.imageInput)].key))
    ) {
      const signature = clipWorkflowLink(c).sourceKey,
        current = () =>
          ticket === getImagePreviewTicket() &&
          selected()?.id === c.id &&
          clipWorkflowLink(selected()).sourceKey === signature &&
          fields.some(field => field.isConnected);
      void flushNative()
        .then(() =>
          current()
            ? request('projects/' + projectKey + '/generation-preview', {
                revision: projectEdit.revision,
                clipId: c.id,
              })
            : null,
        )
        .then(preview => {
          if (!preview || !current()) return;
          for (const field of fields) {
            const b = c.bindings[Number(field.dataset.imageInput)],
              asset = preview.assets.find(a => a.nodeId === b.nodeId && a.input === b.input);
            if (asset && field.isConnected) {
              const image = field.querySelector('img');
              image.src = '/spool/api/input/' + encodeURIComponent(asset.frozen);
              image.hidden = false;
            }
          }
        })
        .catch(error => {
          if (current() && error.status !== 409) toast(error.message);
        });
    }
  }
  return { bindWorkflowControls, controlField, bindImageInputs };
}
