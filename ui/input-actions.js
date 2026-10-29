import { compactGroups } from './input-groups.js';

// A replacement may commit only while it still owns the clip input.
export function createInputActions({
  getClips,
  inputReplacements,
  take,
  edits,
  $,
  api,
  projectKey,
  flushNative,
  toast,
  decodeImage = file => createImageBitmap(file),
}) {
  function useTimelineVideo(clipId, index) {
    const c = getClips().find(c => c.id === clipId);
    if (!c) return;
    const b = c.bindings[index],
      current = take(c);
    if (b.slot !== 'video' || current.placeholder || current.media.kind !== 'video') return;
    inputReplacements.choose(c.id, b.key);
    if (c.shotInputs?.some(s => s.key === b.key && s.source === 'selected')) return;
    edits.apply(
      'Use timeline video',
      () => {
        c.shotInputs = [
          ...(c.shotInputs || []).filter(s => s.key !== b.key),
          { key: b.key, source: 'selected', ...(b.audio ? { audio: true } : {}) },
        ];
        settleGroups(c);
        c.revision++;
      },
      'inspector',
    );
    $('inspectorContent')
      .querySelector('[data-media-input="' + index + '"] [data-use-timeline-video]')
      ?.focus({ preventScroll: true });
  }
  // Filled inputs of a group stay in its first slots, so "Image 2" in a prompt is the second one shown.
  function settleGroups(c) {
    if (!(c.bindings || []).some(b => b.group)) return;
    const next = compactGroups(c.bindings, c.inputValues || {}, c.shotInputs || []);
    c.inputValues = next.values;
    c.shotInputs = next.settings;
  }
  function clearInput(c, index) {
    const b = c.bindings[index];
    if (!b?.optional) return;
    inputReplacements.choose(c.id, b.key);
    edits.apply(
      'Remove ' + b.label,
      () => {
        c.inputValues[b.key] = '';
        c.shotInputs = (c.shotInputs || []).filter(s => s.key !== b.key);
        settleGroups(c);
        c.revision++;
      },
      'inspector',
    );
  }
  async function replaceInputMedia(c, index, file) {
    const b = c.bindings[index];
    const allowed = b.slot === 'video' ? /\.(mp4|mov|mkv|webm|m4v)$/i : /\.(wav|mp3|ogg|flac|m4a)$/i;
    if (!allowed.test(file.name)) throw Error('Choose a ' + b.slot + ' file.');
    const replacement = inputReplacements.begin(c, b.key);
    try {
      const uploaded = await api.upload('projects/' + projectKey + '/input', file, file.name, {
        fallback: 'Could not save this input.',
      });
      const current = getClips().find(clip => clip.id === c.id);
      if (!replacement.owns(current)) throw Error('This input changed while uploading. Choose the file again.');
      edits.apply(
        'Replace ' + b.label,
        () => {
          current.inputValues[b.key] = uploaded.file;
          current.shotInputs = (current.shotInputs || []).filter(s => s.key !== b.key);
          settleGroups(current);
          current.revision++;
        },
        'inspector',
      );
      await flushNative();
      toast(b.label + ' replaced');
    } finally {
      replacement.finish();
    }
  }
  async function replaceInputImage(c, index, file) {
    if (!file.type.startsWith('image/')) throw Error('Choose an image file.');
    const b = c.bindings[index];
    if (file.size > 100 * 1024 * 1024) throw Error('Choose an image smaller than 100 MB.');
    const replacement = inputReplacements.begin(c, b.key);
    try {
      let blob = file,
        extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
      const bitmap = await decodeImage(file);
      if (!extension) {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        extension = 'png';
      }
      bitmap.close();
      const uploaded = await api.upload(
        'projects/' + projectKey + '/input',
        blob,
        file.name?.replace(/\.[^.]+$/, '') + '.' + extension || 'image.' + extension,
        { fallback: 'Could not save this input image.' },
      );
      const current = getClips().find(clip => clip.id === c.id);
      if (!replacement.owns(current)) throw Error('The input changed while uploading. Choose the image again.');
      const value = uploaded.file;
      edits.apply(
        'Replace ' + b.label,
        () => {
          current.inputValues[b.key] = value;
          current.shotInputs = (current.shotInputs || []).filter(s => s.key !== b.key);
          settleGroups(current);
          current.revision++;
        },
        'inspector',
      );
      await flushNative();
      toast(b.label + ' replaced');
    } finally {
      replacement.finish();
    }
  }
  return { useTimelineVideo, clearInput, replaceInputMedia, replaceInputImage };
}
