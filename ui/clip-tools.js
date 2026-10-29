import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createClipTools({
  $,
  copy,
  esc,
  svg,
  request,
  productCapabilities,
  getProductDefinitions,
  projectKey,
  getFps,
  registerWorkflowData,
  addImportedWorkflowClip,
  getInspectorTab,
  writeInspectorTab,
  getState,
  getDrag,
  review,
  edits,
  selected,
  getActiveVideoTrack,
  selectionIds,
  setTimelineSelection,
  selectedVideos,
  take,
  tc,
  toast,
  setStatus,
  projectMedia,
  takeName,
  editView,
  selectClip,
  getRemove,
  getPause,
  detectClipCuts,
  exportViewerFrame,
  getViewerExpanded,
  toggleViewerFullscreen,
  resetViewerZoom,
  selectedAudio,
  addAudioClip,
  splitAudio,
  getBridge,
  host,
  mediaWorkflowData,
  editableGraph,
  openNativeWorkflow,
  getWorkflowSetup,
  getActionMenu,
  getClipMenu,
  getCloseClipMenu,
  getShowActionMenu,
  getPlaceMenu,
}) {
  async function chooseTake(clipId, id) {
    const c = getState().clips.find(c => c.id === clipId),
      t = c && T.realTakes(c).find(t => t.id === id);
    if (!t) return;
    try {
      await getWorkflowSetup().start({
        clipId,
        takeId: id,
        name: t.media.name || takeName(t),
        index: getState().clips.indexOf(c),
        automatic: true,
        definitions: getProductDefinitions(),
        capture: () => takeWorkflowCapture(clipId, id, t.media.name || takeName(t)),
      });
    } catch (error) {
      toast(error.message);
    }
  }
  async function takeWorkflowCapture(clipId, takeId, name) {
    const setup = await request(
      'projects/' + projectKey + '/take-workflow/' + encodeURIComponent(clipId) + '/' + encodeURIComponent(takeId),
    );
    if (!setup?.sidecar?.needsSerialization) return setup;
    const captured = await host('prepare', { workflow: setup.workflow, name });
    return {
      ...captured,
      preferWorkflow: true,
      sidecar: setup.sidecar,
      provenance: { ...captured.provenance, ...setup.provenance },
    };
  }
  async function addMediaClip(id, index = getState().clips.length, start = Math.round(getState().frame)) {
    if (T.videoTracks(getState()) > 1) getState().frame = start;
    const m = projectMedia().find(x => x.id === id);
    if (!m) return;
    if (m.kind === 'audio') {
      addAudioClip(m, start);
      return;
    }
    let data;
    try {
      data = await mediaWorkflowData(m);
    } catch (error) {
      toast(error.message);
      return;
    }
    if (data) {
      const w = registerWorkflowData(data, m.name, m.poster);
      addImportedWorkflowClip(w.id, index, m);
      return;
    }
    edits.apply('Add footage', () => {
      const t = { id: 'take-' + crypto.randomUUID(), number: 1, revision: 1, media: copy(m), sample: false },
        c = {
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
      T.insertClip(getState(), c, index, {
        track: getActiveVideoTrack(),
        start: T.videoTracks(getState()) > 1 ? Math.round(getState().frame) : null,
      });
      getState().selected = c.id;
      getState().selectedAudio = null;
      editView();
    });
  }
  function duplicate() {
    const ids = selectionIds().slice();
    if (!ids.length) return;
    const videos = getState().clips.filter(c => ids.includes(c.id)),
      audio = (getState().audioClips || []).filter(c => ids.includes(c.id));
    edits.apply('Duplicate ' + ids.length + ' ' + (ids.length === 1 ? 'clip' : 'clips'), () => {
      getPause()();
      editView();
      const copies = [];
      for (const c of videos) copies.push(T.duplicateClip(getState(), c.id, 'clip-' + crypto.randomUUID()).id);
      for (const c of audio) copies.push(T.duplicateAudio(getState(), c.id, 'audio-' + crypto.randomUUID()).id);
      setTimelineSelection(copies);
    });
    toast(ids.length === 1 ? 'Clip duplicated' : ids.length + ' clips duplicated');
  }
  function split() {
    if (selectionIds().length > 1) return;
    if (selectedAudio()) {
      splitAudio();
      return;
    }
    getPause()();
    editView();
    const row = T.splitTarget(getState(), getState().frame, selected()?.id);
    if (!row) {
      toast('Place the playhead inside a clip, at least 6 frames from either edge.');
      return;
    }
    edits.apply('Split at playhead', () => {
      const { clip: d } = T.splitClip(getState(), getState().frame, 'clip-' + crypto.randomUUID(), row.clip.id);
      getState().selected = d.id;
    });
    setStatus('Split at ' + tc(getState().frame));
  }
  function unlinkClipAudio(id) {
    const c = getState().clips.find(c => c.id === id);
    if (!c || !T.linkedAudio(c) || take(c).placeholder) return;
    getPause()();
    edits.apply('Unlink audio and video', () => {
      const audio = T.unlinkAudio(getState(), id, 'audio-' + crypto.randomUUID());
      getState().selectedAudio = audio.id;
      review.rememberMedia(audio.media, audio.in);
      writeInspectorTab('audio');
      editView();
    });
    toast('Audio unlinked on A1 - move or trim it independently');
  }
  function unlinkSelectedAudio() {
    const clips = selectedVideos().filter(c => T.linkedAudio(c) && !take(c).placeholder);
    if (!clips.length) return;
    getPause()();
    edits.apply('Unlink ' + clips.length + ' clips', () => {
      const ids = clips.map(c => T.unlinkAudio(getState(), c.id, 'audio-' + crypto.randomUUID()).id);
      setTimelineSelection(ids);
      writeInspectorTab('audio');
      editView();
    });
  }
  function toggleSelectedEnabled() {
    if (getDrag()) return;
    const ids = selectionIds(),
      clips = [...getState().clips, ...(getState().audioClips || [])].filter(c => ids.includes(c.id));
    if (!clips.length) return;
    const value = clips.some(c => !T.enabled(c));
    edits.apply(value ? 'Enable clips' : 'Disable clips', () => {
      getPause()();
      T.setEnabled(getState(), ids, value);
    });
    $('editor').focus({ preventScroll: true });
  }
  function enableAction() {
    const ids = selectionIds(),
      off = [...getState().clips, ...(getState().audioClips || [])].some(c => ids.includes(c.id) && !T.enabled(c));
    return {
      label: off ? 'Enable clip' + (ids.length > 1 ? 's' : '') : 'Disable clip' + (ids.length > 1 ? 's' : ''),
      run: toggleSelectedEnabled,
    };
  }
  function selectionActions() {
    return [
      enableAction(),
      ...(selectedVideos().some(c => T.linkedAudio(c) && !take(c).placeholder)
        ? [{ label: 'Unlink audio and video', run: unlinkSelectedAudio }]
        : []),
      { label: 'Delete selection', run: () => getRemove()(false) },
      { label: 'Ripple delete selection', run: () => getRemove()(true) },
    ];
  }
  function openClipMenu(id, x, y, origin, inspector = false) {
    const c = getState().clips.find(c => c.id === id);
    if (!c) return;
    getCloseClipMenu()(false);
    selectClip(id, false, {}, true);
    getActionMenu().setOrigin(origin, id);
    if (selectionIds().length > 1) {
      getShowActionMenu()(
        'Selection actions',
        inspector ? [{ label: 'Delete selection', run: () => getRemove()(false) }] : selectionActions(),
        x,
        y,
        origin,
      );
      return;
    }
    const actions = [
      ...(editableGraph(c)
        ? [
            {
              label: 'Open workflow in Comfy',
              reason: !getBridge() && !productCapabilities.connected ? 'Start the paired Comfy host.' : null,
              run: () => openNativeWorkflow(),
            },
          ]
        : []),
      {
        label: 'Delete',
        run: () => {
          selectClip(id, false);
          getRemove()(false);
        },
      },
    ];
    if (!inspector) {
      actions.unshift(
        enableAction(),
        ...(T.linkedAudio(c) && !take(c).placeholder
          ? [{ label: 'Unlink audio and video', run: () => unlinkClipAudio(id) }]
          : []),
      );
      actions.splice(
        actions.length - 1,
        0,
        ...(!take(c).placeholder && take(c).media.kind === 'video'
          ? [{ label: 'Detect cuts\u2026', run: () => detectClipCuts(id) }]
          : []),
      );
    }
    getShowActionMenu()('Clip actions', actions, x, y, origin);
  }
  function showViewerMenu(picture, x, y) {
    const available =
      picture && !picture.gap && !picture.take?.placeholder && ['video', 'image'].includes(picture.media.kind);
    getCloseClipMenu()(false);
    getActionMenu().setOrigin($('viewer'));
    getClipMenu().className = 'viewer-menu';
    getClipMenu().setAttribute('aria-label', 'Viewer actions');
    const detail = available
      ? 'Original' +
        (picture.media.width && picture.media.height ? ' · ' + picture.media.width + ' × ' + picture.media.height : '')
      : 'Choose a frame from video or an image';
    getClipMenu().innerHTML =
      '<button class="menu-action" role="menuitem" aria-label="Export frame" aria-describedby="viewer-menu-export-detail" data-viewer-action="export" ' +
      (available ? '' : 'disabled aria-disabled="true"') +
      '>' +
      svg('export') +
      '<span>Export frame<small id="viewer-menu-export-detail">' +
      esc(detail) +
      '</small></span><span class="menu-format">PNG</span></button><div class="menu-divider" role="separator"></div><button class="menu-action" role="menuitem" data-viewer-action="fit">' +
      svg('fit') +
      '<span>Fit to viewer</span></button><button class="menu-action" role="menuitem" data-viewer-action="fullscreen">' +
      svg('expand') +
      '<span>' +
      (getViewerExpanded() ? 'Exit fullscreen' : 'Fullscreen') +
      '</span><kbd>F</kbd></button>';
    getClipMenu().querySelector('[data-viewer-action="export"]').onclick = () => {
      getCloseClipMenu()();
      exportViewerFrame(copy(picture));
    };
    getClipMenu().querySelector('[data-viewer-action="fit"]').onclick = () => {
      getCloseClipMenu()();
      resetViewerZoom();
    };
    getClipMenu().querySelector('[data-viewer-action="fullscreen"]').onclick = () => {
      getCloseClipMenu()();
      toggleViewerFullscreen();
    };
    getPlaceMenu()(x, y);
  }
  return {
    chooseTake,
    takeWorkflowCapture,
    addMediaClip,
    duplicate,
    split,
    toggleSelectedEnabled,
    enableAction,
    selectionActions,
    openClipMenu,
    showViewerMenu,
  };
}
