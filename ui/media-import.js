import * as T from './timeline.js';
import { keyText } from './keys.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createMediaImport({
  $,
  copy,
  esc,
  diagnostics,
  api,
  request,
  productCapabilities,
  projectKey,
  getFps,
  writeFps,
  getTemplateBrowser,
  writeTemplateBrowser,
  readWorkflowData,
  registerWorkflowData,
  getState,
  getBinTab,
  writeBinTab,
  review,
  edits,
  projectData,
  getActiveVideoTrack,
  take,
  videoTotal,
  rowFor,
  editingSignature,
  save,
  toast,
  setStatus,
  render,
  projectMedia,
  editView,
  addMediaClip,
  getPause,
  getDialogs,
  getShowModal,
  getCloseModal,
  setBinTab,
  addAudioClip,
  clearHeld,
  flushNative,
  connectComfy,
  importWorkflowFile,
  captureInputs,
}) {
  async function browseComfyTemplates() {
    const { createTemplateBrowser } = await import('./template-browser.js');
    getShowModal()(
      'Workflow templates',
      '<div id="templateMount" class="template-mount"><div class="template-loading">Loading Comfy templates...</div></div>',
      '<span id="templateStatus" role="status">Connecting to Comfy...</span><button class="outline" id="templateRetry" hidden>Retry</button><button class="outline" id="templateCancel">Cancel</button><button class="primary" id="templateUse" disabled>Use workflow</button>',
    );
    $('modal').classList.add('template-dialog');
    const mount = $('templateMount'),
      status = $('templateStatus'),
      retryButton = $('templateRetry');
    const browser = writeTemplateBrowser(
      getTemplateBrowser() ??
        createTemplateBrowser({
          overlay: $('modalOverlay'),
          onCancel: getCloseModal(),
          onUse: async capture => {
            getCloseModal()();
            try {
              await captureInputs(capture, capture.name || 'Comfy template');
            } catch (error) {
              toast(error.message);
            }
          },
        }),
    );
    getDialogs().setCleanup(browser.suspend);
    $('templateCancel').onclick = getCloseModal();
    retryButton.onclick = () => {
      browser.reset();
      void browseComfyTemplates();
    };
    try {
      await flushNative();
      if (!browser.canReuse(productCapabilities.configuration?.comfyUrl)) {
        await connectComfy();
        const { definitions, ...metadata } = await request('capabilities?types=');
        Object.assign(productCapabilities, metadata);
      }
      if (mount.isConnected && !$('modalOverlay').hidden)
        browser.open(productCapabilities.configuration.comfyUrl, {
          mount,
          status,
          useButton: $('templateUse'),
          retryButton,
        });
    } catch (error) {
      if (mount.isConnected) {
        status.textContent = error.message;
        retryButton.hidden = false;
      }
    }
  }
  function removeMedia(id) {
    const items = projectMedia(),
      index = items.findIndex(m => m.id === id);
    if (index < 0) return;
    edits.apply('Remove ' + items[index].name + ' from media pool', () => {
      getState().hiddenMediaIds = [...new Set([...(getState().hiddenMediaIds || []), id])];
      if (review.source?.media.id === id) {
        getPause()();
        editView();
        review.clear();
      }
    });
    setStatus('Removed from media pool');
    const next = projectMedia()[Math.min(index, projectMedia().length - 1)];
    ($('binGrid').querySelector('[data-media="' + CSS.escape(next?.id || '') + '"]') || $('editor')).focus({
      preventScroll: true,
    });
  }
  function pickImport(add = false, workflowOnly = false) {
    $('mediaFiles').accept = workflowOnly ? '.json' : '.json,video/*,image/*,audio/*';
    $('mediaFiles').onchange = e => importFiles(e.target.files, add, videoTotal());
    $('mediaFiles').click();
  }
  async function uploadFile(file) {
    return diagnostics.run(
      'Importing ' + file.name,
      async () => {
        const m = await api.upload(
          'upload?projectId=' + encodeURIComponent(projectKey) + '&fps=' + getFps(),
          file,
          file.name,
          { fallback: 'Import failed' },
        );
        if (m.workflow) {
          m.workflowData = m.workflowData || readWorkflowData({ workflow: m.workflow, prompt: m.prompt });
          registerWorkflowData(m.workflowData, m.name, m.poster);
        }
        getState().media.push(m);
        return m;
      },
      { detail: Math.round(file.size / 1024) + ' KB' },
    );
  }
  async function importFiles(
    files,
    add = false,
    start = Math.round(getState().frame),
    index = getState().clips.length,
    audioOnly = false,
    audioTrack = 'music',
    audioLane = getActiveVideoTrack(),
  ) {
    let imported = 0,
      failed = 0;
    for (const file of files) {
      try {
        if (!/\.json$/i.test(file.name)) {
          const m = await uploadFile(file);
          if (!add) save();
          if (add) {
            if (audioOnly) {
              if (!m.audio) throw Error(m.name + ' has no audio stream');
              addAudioClip(m, start, audioTrack, audioLane);
            } else await addMediaClip(m.id, index, start);
            if (!audioOnly && m.kind !== 'audio') {
              index++;
              if (T.videoTracks(getState()) > 1 && getState().selected) {
                const placed = rowFor(getState().selected);
                if (placed) start = placed.end;
              }
            } else start += m.frames;
          }
          imported++;
          continue;
        }
        if (add) {
          const session = await captureInputs(
            async () => {
              const w = await importWorkflowFile(file);
              return { ...copy(w.data), importedWorkflowId: w.id };
            },
            file.name,
            index,
          );
          if (session && (await session.completed)) index++;
        } else {
          await flushNative();
          await importWorkflowFile(file);
        }
        imported++;
      } catch (error) {
        toast(error.message);
        failed++;
      }
    }
    writeBinTab(!audioOnly && [...files].some(file => /\.json$/i.test(file.name)) ? 'workflows' : 'media');
    $('mediaFiles').value = '';
    $('audioFiles').value = '';
    render();
    save();
    return { imported, failed };
  }
  async function pasteImages(images, destination) {
    if (!images.length) {
      toast('No image in the clipboard. Copy an image, then paste again.');
      return;
    }
    getPause()();
    setStatus('Pasting image...');
    const frame = Math.round(getState().frame),
      index = T.dropIndex(getState(), frame),
      files = [];
    try {
      for (let i = 0; i < images.length; i++) {
        let blob = images[i],
          extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type];
        if (!extension) {
          const bitmap = await createImageBitmap(blob),
            canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (!blob) throw Error('The clipboard image could not be read.');
          extension = 'png';
        }
        files.push(
          new File(
            [blob],
            'Pasted image ' +
              new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') +
              (images.length > 1 ? ' ' + (i + 1) : '') +
              '.' +
              extension,
            { type: blob.type },
          ),
        );
      }
      const result = await importFiles(files, destination === 'timeline', frame, index);
      setBinTab('media');
      if (result.imported) {
        await flushNative();
        const message =
          result.imported +
          (result.imported === 1 ? ' image' : ' images') +
          ' pasted to ' +
          (destination === 'timeline' ? 'timeline' : 'media pool');
        setStatus(message);
        if (!result.failed) toast(message);
      }
    } catch (error) {
      toast(error.message);
    }
  }
  async function pasteClipboardImage(destination) {
    if (!navigator.clipboard?.read) {
      toast(
        'Click the ' +
          (destination === 'timeline' ? 'timeline' : 'media pool') +
          ' and press ' +
          keyText('Ctrl') +
          '+V to paste an image.',
      );
      return;
    }
    try {
      const items = await diagnostics.run('Reading clipboard', () => navigator.clipboard.read()),
        images = [];
      for (const item of items) {
        const type = item.types.includes('image/png')
          ? 'image/png'
          : item.types.find(type => type.startsWith('image/'));
        if (type) images.push(await diagnostics.run('Reading clipboard image', () => item.getType(type)));
      }
      await pasteImages(images, destination);
    } catch (error) {
      toast(
        'Clipboard access was blocked. Click the ' +
          (destination === 'timeline' ? 'timeline' : 'media pool') +
          ' and press ' +
          keyText('Ctrl') +
          '+V.',
      );
    }
  }
  function importFootageDialog() {
    getShowModal()(
      'Import video',
      '<p>Spool reads the file where it is and makes review copies. Each detected shot becomes a clip whose first take is the original footage.</p><label class="field"><span>Video file path</span><input id="footagePath" placeholder="Full path to the video file" spellcheck="false"></label><label class="export-audio"><input type="checkbox" id="footageCuts" checked> Split at detected cuts</label><div id="footageResult"></div>',
      '<button class="outline" id="footageCancel">Cancel</button><button class="primary" id="footageImport">Import</button>',
    );
    $('footagePath').focus();
    $('footageCancel').onclick = getCloseModal();
    $('footagePath').onkeydown = e => {
      if (e.key === 'Enter') $('footageImport').click();
    };
    $('footageImport').onclick = async () => {
      const path = $('footagePath')
        .value.trim()
        .replace(/^"(.*)"$/, '$1');
      if (!path) return;
      const button = $('footageImport');
      button.disabled = true;
      button.textContent = 'Importing…';
      $('footageResult').textContent = 'Making review copies and finding cuts…';
      try {
        const count = await importFootage(path, $('footageCuts').checked);
        getCloseModal()();
        toast(count + (count === 1 ? ' clip' : ' clips') + ' added from ' + path.split(/[\\/]/).pop());
      } catch (error) {
        if ($('footageResult')) {
          $('footageResult').textContent = error.message;
          button.disabled = false;
          button.textContent = 'Import';
        }
      }
    };
  }
  async function importFootage(path, detectCuts) {
    const empty = !getState().clips.length && !(getState().audioClips || []).length;
    const result = await api.call('import-footage?projectId=' + encodeURIComponent(projectKey), {
      method: 'POST',
      body: { path, detectCuts, fps: empty && !getState().fpsExplicit ? null : getFps() },
      fallback: 'Import failed',
    });
    return edits.apply('Import ' + result.source.name, () => {
      getPause()();
      editView();
      clearHeld();
      if (empty) writeFps((getState().fps = result.fps));
      for (const m of [result.source, result.audio])
        if (m) {
          getState().media.push(m);
        }
      const clips = result.shots.map(m => {
        const t = {
          id: 'take-' + crypto.randomUUID(),
          number: 0,
          original: true,
          revision: 1,
          media: m,
          sample: false,
        };
        return {
          id: 'clip-' + crypto.randomUUID(),
          name: m.name,
          workflow: null,
          sources: [],
          prompt: '',
          seed: 0,
          duration: m.frames / getFps(),
          count: 1,
          revision: 1,
          takes: [t],
          takeId: t.id,
          in: 0,
          out: m.frames,
        };
      });
      if (T.videoTracks(getState()) > 1)
        getState().frame = T.trackClips(getState(), getActiveVideoTrack()).reduce(
          (n, c) => n + (c.gapBefore || 0) + c.out - c.in,
          0,
        );
      for (const c of clips) {
        T.insertClip(getState(), c, getState().clips.length, {
          track: getActiveVideoTrack(),
          start: T.videoTracks(getState()) > 1 ? Math.round(getState().frame) : null,
        });
        getState().frame = rowFor(c.id).end;
      }
      const start = rowFor(clips[0].id).start;
      if (result.audio)
        T.addAudioClip(getState(), result.audio, start, 'audio-' + crypto.randomUUID()).audio.gainDb = 0;
      getState().selected = clips[0].id;
      getState().selectedAudio = null;
      getState().frame = start;
      return clips.length;
    });
  }
  async function detectClipCuts(id) {
    const c = getState().clips.find(c => c.id === id);
    if (!c) return;
    const chosen = take(c),
      before = editingSignature(projectData());
    getShowModal()(
      'Detect cuts',
      '<p>Find hard cuts inside <b>' +
        esc(c.name) +
        '</b> using its selected take and current trim. Review the result before splitting. Audio on A2 stays in place.</p><p id="cutsResult">Detecting cuts…</p>',
      '<button class="outline" id="cutsCancel">Cancel</button><button class="primary" id="cutsApply" disabled>Split at cuts</button>',
    );
    const button = $('cutsApply'),
      result = $('cutsResult');
    $('cutsCancel').onclick = getCloseModal();
    try {
      await flushNative();
      const { cuts } = await request(
        'projects/' + projectKey + '/detect-cuts',
        { clipId: id, takeId: chosen.id },
        'POST',
      );
      if ($('cutsResult') !== result) return;
      result.textContent = cuts.length
        ? cuts.length + ' cuts found · ' + (cuts.length + 1) + ' clips. You can undo the split.'
        : 'No hard cuts found in this clip.';
      button.disabled = !cuts.length;
      button.onclick = () => {
        if (editingSignature(projectData()) !== before) {
          result.textContent = 'The edit changed. Close this dialog and detect again.';
          button.disabled = true;
          return;
        }
        const start = rowFor(id).start,
          name = c.name.replace(/\.(mp4|mov|webm|mkv|m4v)$/i, '');
        edits.apply('Detect cuts', () => {
          editView();
          const shots = [c];
          for (const cut of cuts) {
            const { clip } = T.splitClip(getState(), start + cut, 'clip-' + crypto.randomUUID(), shots.at(-1).id);
            if (clip) shots.push(clip);
          }
          shots.forEach((shot, index) => (shot.name = name + '_' + String(index + 1).padStart(2, '0')));
          getState().selected = id;
          getState().selectedAudio = null;
          getState().frame = start;
          getCloseModal()();
        });
        toast('Clip split at ' + cuts.length + ' cuts');
      };
    } catch (error) {
      if ($('cutsResult') === result) result.textContent = error.message;
    }
  }
  return {
    importFiles,
    pasteImages,
    pasteClipboardImage,
    importFootageDialog,
    detectClipCuts,
    pickImport,
    removeMedia,
    browseComfyTemplates,
  };
}
