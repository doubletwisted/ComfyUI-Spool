import { createWorkflowDialogs } from './workflow-dialogs.js';
import { createProjectSync } from './project-sync.js';
import { createWorkflowControls } from './workflow-controls.js';
import { createRenderQueue } from './render-queue.js';
import { createComfyConnection } from './comfy-connection.js';
import { createTrimPreview } from './trim-preview.js';
import { createAudioEditor } from './audio-editor.js';
import { createLayoutControls } from './layout-controls.js';
import { createProjectDialogs } from './project-dialogs.js';
import { createExports } from './exports.js';
import { createMediaImport } from './media-import.js';
import { createTimelineDrops } from './timeline-drops.js';
import { createClipTools } from './clip-tools.js';
import { createTakeActions } from './take-actions.js';
import { createTakeRenderer } from './take-renderer.js';
import { createClipBadges } from './clip-badges.js';
import { createClipSelection } from './clip-selection.js';
import { createTrackLayout } from './track-layout.js';
import { createWorkflowRegistry } from './workflow-registry.js';
import { createWorkflowAssignment, createHistoryActions, createRemovalActions } from './edit-actions.js';
import { createWorkflowCoordinator } from './workflow-coordinator.js';
import { createLibraryRenderer } from './library-renderer.js';
import { createInspectorRenderer } from './inspector-renderer.js';
import { createTimelinePointer } from './timeline-pointer.js';
import { createTimelineRenderer } from './timeline-renderer.js';
import { createViewer } from './viewer.js';
import { createDialogs } from './dialogs.js';
import { createActionMenu } from './action-menu.js';
import { createQueueActions } from './queue-submission.js';
import { createInputActions } from './input-actions.js';
import { createInputReplacements } from './input-replacement.js';
import { keyText } from './keys.js';
// Native editor runtime. Demo source is not loaded or transformed.
let initialization;
export function initializeEditor(isFailed) {
  return (initialization ??= startEditor(isFailed));
}
async function startEditor(isFailed) {
  'use strict';
  const ICONS = {
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="m3 3 18 18M9 5c8-2 13 7 13 7s-2 4-6 6M6 6c-3 2-4 6-4 6s4 7 10 7l3-1"/>',
    pointer: '<path d="M5 3v17l4-5 4 7 3-2-4-7 7-1z"/>',
    trim: '<path d="M9 4H5v16h4M15 4h4v16h-4M9 12h6"/>',
    roll: '<path d="M10 4v16M14 4v16M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    slip: '<path d="M5 4v16M19 4v16M8 7h8v10H8zM1 12h4M19 12h4"/>',
    slide: '<path d="M2 7h4v10H2zM9 7h6v10H9zM18 7h4v10h-4M9 3h6M9 21h6"/>',
    audio: '<path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 5v14M23 10v4"/>',
    link: '<path d="m10 14 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    folder: '<path d="M3 7h6l2 2h10v11H3z"/><path d="M3 7V4h7l2 3"/>',
    save: '<path d="M4 3h14l3 3v15H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    queue: '<path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 4v2M3 11v2M3 18v2"/>',
    export: '<path d="M12 15V3m-4 4 4-4 4 4M4 13v8h16v-8"/>',
    bin: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-8 8"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
    clipboard:
      '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h6"/>',
    sliders: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    settings:
      '<path d="m10 3-1 3-3 1-3 3 2 2-2 2 3 3 3 1 1 3h4l1-3 3-1 3-3-2-2 2-2-3-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
    previous: '<path d="M5 5v14M19 5l-10 7 10 7z"/>',
    next: '<path d="M19 5v14M5 5l10 7-10 7z"/>',
    frameback: '<path d="M6 5v14M17 7l-7 5 7 5z"/>',
    frameforward: '<path d="M18 5v14M7 7l7 5-7 5z"/>',
    play: '<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
    loop: '<path d="M4 8a7 7 0 0 1 12-3l3 3M19 3v5h-5M20 16a7 7 0 0 1-12 3l-3-3M5 21v-5h5"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/>',
    volume: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
    nodes:
      '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h9v9M6 9v9h9"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    timeline: '<path d="M3 4h18M3 9h7v5H3zM12 9h9v5h-9zM3 17h18"/>',
    cursor: '<path d="m5 3 14 10-7 1-3 7z"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
    trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    magnet: '<path d="M4 4h5v9a3 3 0 0 0 6 0V4h5v9a8 8 0 0 1-16 0zM4 8h5M15 8h5"/>',
    undo: '<path d="M9 5 3 10l6 5M3 10h10a7 7 0 0 1 0 14" transform="translate(0 -3)"/>',
    redo: '<path d="m15 5 6 5-6 5M21 10H11a7 7 0 0 0 0 14" transform="translate(0 -3)"/>',
    fit: '<path d="M8 4H4v16h4M16 4h4v16h-4M8 12h8"/>',
    keyboard:
      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1M7 16h10"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    warning: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  };
  let diagnosticsTimer = 0;
  const $ = id => document.getElementById(id);
  const copy = x => JSON.parse(JSON.stringify(x));
  const esc = x =>
    String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = name =>
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.plus) + '</svg>';
  function icons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => (el.innerHTML = svg(el.dataset.icon)));
  }

  const processingButton = document.createElement('button');
  processingButton.id = 'processingStatus';
  processingButton.className = 'processing-status';
  processingButton.title = 'Processing details and local diagnostics';
  processingButton.setAttribute('aria-label', 'Processing status and diagnostics');
  processingButton.setAttribute('aria-haspopup', 'dialog');
  let topbar = null,
    latestSaveStatus = { kind: 'saved' };
  processingButton.innerHTML =
    '<span class="processing-dot" aria-hidden="true"></span><span id="processingLabel" role="status" aria-live="polite">Ready</span><span id="processingElapsed" aria-hidden="true"></span>';
  $('saveStatus').parentElement.before(processingButton);
  const { createDiagnostics } = await import('/spool/ui/diagnostics.js');
  const diagnostics = createDiagnostics(value => {
    const current = value.active.find(a => !a.background),
      label = current?.label || 'Ready',
      elapsed = current ? (current.elapsedMs / 1000).toFixed(1) + 's' : '';
    if ($('processingLabel').textContent !== label) $('processingLabel').textContent = label;
    $('processingElapsed').textContent = elapsed;
    processingButton.classList.toggle('busy', !!current);
    processingButton.title = current
      ? (current.detail ? current.detail + ' - ' : '') + label + ' - ' + elapsed
      : 'Processing details and local diagnostics';
    const loading = $('spool-loading');
    if (loading?.textContent.startsWith('Loading Spool'))
      loading.textContent = 'Loading Spool... ' + (current ? label + ' (' + elapsed + ')' : '');
  });
  const bootParams = new URLSearchParams(location.search);
  let bootId = bootParams.get('project');
  const { createApi } = await import('/spool/ui/api.js'),
    { createInterruptions } = await import('/spool/ui/pointer.js');
  const interruptions = createInterruptions();
  const api = createApi({
      diagnostics,
      project: () => bootId,
      recipes: () => unsavedRecipes,
      onOutdated: message => {
        const notice = document.createElement('div');
        notice.id = 'spool-outdated';
        notice.setAttribute('role', 'alert');
        notice.textContent = message;
        $('editor').prepend(notice);
      },
    }),
    request = api.request;
  if (!bootId) {
    const projects = await api.call('projects');
    bootId = projects[0]?.id;
    if (!bootId) {
      const created = await api.call('projects', { method: 'POST', body: {} });
      bootId = created.id;
    }
    const address = new URL(location.href);
    address.searchParams.set('project', bootId);
    window.history.replaceState(null, '', address);
  }
  const BOOT = await diagnostics.run('Opening project', () =>
    api.call('projects/' + encodeURIComponent(bootId), {
      headers: { 'X-Spool-View': 'editor' },
      fallback: 'Project unavailable',
    }),
  );
  const [
    { createWorkflowSetup, workflowStatus, matchClipInputs },
    { createProjectEdit },
    { createHistory, sameStacks },
    { createEditSession },
    T,
    L,
    B,
    W,
    { createVideoSeekGuard },
    productCapabilities,
    { createThumbnails },
    G,
    { createTakeReview },
    builtinCatalog,
    ownCatalog,
  ] = await Promise.all([
    import('/spool/ui/workflow-setup.js'),
    import('/spool/ui/project-edit.js'),
    import('/spool/ui/history.js'),
    import('/spool/ui/edit-session.js'),
    import('/spool/ui/timeline.js'),
    import('/spool/ui/ledger.js'),
    import('/spool/ui/bridge.js'),
    import('/spool/ui/wire.js'),
    import('/spool/ui/video-seek-guard.js'),
    diagnostics
      .run('Loading Comfy node definitions', () =>
        api.call('capabilities', { fallback: 'Comfy node definitions unavailable' }),
      )
      .catch(() => ({ definitions: {} })),
    import('/spool/ui/thumbnails.js'),
    import('/spool/ui/generation.js'),
    import('/spool/ui/take-review.js'),
    fetch('/spool/ui/builtin-captures.json')
      .then(r => {
        if (!r.ok) throw Error('Built-in workflows unavailable');
        return r.json();
      })
      .catch(() => ({ templates: {}, cloudDefinitions: {}, unavailable: true })),
    api.call('builtin-workflows', { fallback: 'Spool workflows unavailable' }).catch(() => ({ templates: {} })),
  ]);
  const inputReplacements = createInputReplacements();
  let productDefinitions = productCapabilities.definitions || {};
  const builtinCaptures = { ...builtinCatalog.templates, ...ownCatalog.templates };
  const cloudDefinitions = { ...builtinCatalog.cloudDefinitions, ...productCapabilities.cloudDefinitions };
  function definitionsFor(c) {
    return (c?.executionTarget || nativeRecipes[c?.workflowVersion]?.executionTarget) === 'cloud'
      ? { ...productDefinitions, ...cloudDefinitions }
      : productDefinitions;
  }
  if (isFailed()) throw Error('Initialization cancelled');
  const BASE = '/spool/media/' + encodeURIComponent(BOOT.id) + '/';
  const params = new URLSearchParams(location.search);
  if (params.has('mode')) {
    const address = new URL(location.href);
    address.searchParams.delete('mode');
    window.history.replaceState(null, '', address);
  }
  const projectKey = BOOT.id,
    STORAGE_KEY = 'spool-native-' + projectKey,
    VIEW_KEY = STORAGE_KEY + ':view';
  const url = path =>
    path.startsWith('api/') ? '/spool/' + path : path.startsWith('/') || path.startsWith('data:') ? path : BASE + path;
  const thumbnails = createThumbnails(url, diagnostics, $('viewerStage'), async (m, rate) => {
    const entry = reviewSource(m, rate);
    if (entry.pending) await entry.pending;
    const ready = reviewSource(m, rate);
    if (ready.state === 'failed') throw Error(ready.error);
    return ready;
  });
  const takeHoverLabel = document.createElement('span');
  takeHoverLabel.className = 'take-hover-label';
  $('viewerStage').append(takeHoverLabel);
  let fps = BOOT.document.fps || 24;
  const workflows = {};
  let workflowLibrary = null,
    templateBrowser = null;
  const { createBuiltinPreparer, pixelResolution, builtinBindings } = await import('/spool/ui/builtin-workflows.js');
  const { reusableBinding, resultChoices } = await import('/spool/ui/profile.js');
  const builtinPreparer = createBuiltinPreparer();
  let workflowAdds = Promise.resolve();
  const importedWorkflowPoster =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#18181b"/><g transform="translate(224 84) scale(8)" fill="none" stroke="#ff9f5a" stroke-width="1.3">' +
        ICONS.nodes +
        '</g></svg>',
    );
  const workflowRegistryOwner = createWorkflowRegistry({
    copy,
    url,
    getFps: () => fps,
    workflows,
    importedWorkflowPoster,
    getApplyPreparedWorkflow: () => applyPreparedWorkflow,
    getState: () => state,
    getEdits: () => edits,
    getActiveVideoTrack: () => activeVideoTrack,
    getRowFor: () => rowFor,
    setStatus,
    editView,
    getPause: () => pause,
    clearHeld,
  });

  function readWorkflowData(value) {
    return workflowRegistryOwner.readWorkflowData(value);
  }
  function syncImportedWorkflows() {
    return workflowRegistryOwner.syncImportedWorkflows();
  }
  function registerWorkflowData(data, name, poster) {
    return workflowRegistryOwner.registerWorkflowData(data, name, poster);
  }
  function addImportedWorkflowClip(
    workflow,
    index = state.clips.length,
    m = null,
    placement = null,
    workflowVersion = null,
  ) {
    return workflowRegistryOwner.addImportedWorkflowClip(workflow, index, m, placement, workflowVersion);
  }
  const { applyPreparedWorkflow } = createWorkflowAssignment({
    inputReplacements,
    copy,
    getRecipes: () => nativeRecipes,
    definitionsFor,
    getFps: () => fps,
    matchClipInputs,
  });
  const INITIAL = { ...BOOT.document, selected: null, frame: 0, zoom: 100, snap: true, muted: true, loop: false };
  const defaultAudioTracks = { sourceMuted: false, sourceSolo: false, musicMuted: false, musicSolo: false };
  const drawn = {};
  let inspectorTab = 'inputs',
    trimPreviewTimer = 0,
    savedHistory = null,
    timelineDrag = null,
    timelinePan = null;
  const held = { s: false, d: false, shift: false, alt: false };
  let hoverTarget = null,
    selectedCut = null,
    nudgeGroup = null,
    trimSingle = false;
  let exportRangeDrag = null;
  let state = copy(INITIAL),
    binTab = 'workflows',
    workflowLocked = false,
    ppf = 1,
    drag = null,
    toastTimer,
    statusTimer;
  const review = createTakeReview(() => state.clips);
  const { createTakeSeen } = await import('/spool/ui/take-seen.js');
  const takeSeen = createTakeSeen(projectKey, state.clips, localStorage);
  const history = createHistory(),
    undoStack = history.undo,
    redoStack = history.redo;
  const edits = createEditSession({
    history,
    current: () => state,
    reset: () => {
      selectedCut = null;
      nudgeGroup = null;
    },
    recorded: () => buttons(),
    save: () => save(),
    repaint: scope =>
      ({
        all: () => render(),
        inspector: renderInspector,
        timeline: () => {
          renderTimeline();
          updateViewer();
        },
        audio: () => {
          renderAudioTimeline(layout());
          audioButtons();
        },
        range: renderExportRange,
        none: () => {},
      })[scope](),
  });
  try {
    const view = JSON.parse(sessionStorage.getItem(VIEW_KEY));
    if (view) {
      Object.assign(state, view);
      trimSingle = !!view.trimSingle;
    }
  } catch (error) {}
  delete state.previewQuality;
  let selectedTakeClip = state.takeSelection?.clipId || null,
    selectedTakeIds = state.takeSelection?.ids || [],
    takeSelectionAnchor = state.takeSelection?.anchor || null;
  function viewState() {
    return {
      takeSelection: { clipId: selectedTakeClip, ids: selectedTakeIds, anchor: takeSelectionAnchor },
      selected: state.selected,
      selectedAudio: state.selectedAudio,
      selection: selectionIds(),
      frame: state.frame,
      zoom: state.zoom,
      snap: state.snap,
      muted: state.muted,
      loop: state.loop,
      trimSingle,
      viewerZoom,
      activeVideoTrack,
    };
  }
  function projectData() {
    return L.savedDocument(state);
  }
  const selected = () => state.clips.find(c => c.id === state.selected);
  let selectionAnchor = null,
    activeVideoTrack = state.activeVideoTrack || T.videoTrack(state.clips.find(c => c.id === state.selected) || {});
  const trackHeightsKey = STORAGE_KEY + ':track-heights:full';
  const trackHeights = {};
  let trackResize = null;
  try {
    const saved = JSON.parse(localStorage.getItem(trackHeightsKey));
    for (const [key, value] of Object.entries(saved || {}))
      if (/^(video:[1-9]\d*|source:[1-9]\d*|music)$/.test(key) && Number.isFinite(value)) trackHeights[key] = value;
  } catch (error) {}
  const trackHeightBounds = key => ({
    min: key.startsWith('video:') ? 48 : 24,
    max: key.startsWith('video:') ? 480 : 320,
  });
  const defaultTrackHeight = key => (key.startsWith('video:') ? 72 : 48);
  // The height a track is set to; tracks shrink together below it when they do not
  // all fit the timeline, down to a fitting floor below the resize minimum, so the
  // timeline scrolls only once every track is that small.
  const preferredTrackHeight = key => {
    const b = trackHeightBounds(key);
    return Math.min(b.max, Math.max(b.min, trackHeights[key] ?? defaultTrackHeight(key)));
  };
  let trackFit = 1;
  const trackHeight = key =>
    trackFit < 1
      ? Math.max(key.startsWith('video:') ? 36 : 22, Math.floor(preferredTrackHeight(key) * trackFit))
      : preferredTrackHeight(key);
  const trackVariable = (kind, track, part) => '--' + kind + '-' + part + '-' + track;
  const trackLayoutOwner = createTrackLayout({
    $,
    getState: () => state,
    trackHeightsKey,
    trackHeights,
    trackHeightBounds,
    trackHeight,
    preferredTrackHeight,
    setTrackFit: value => (trackFit = value),
    trackVariable,
    draw,
  });
  function trackAt(e) {
    return trackLayoutOwner.trackAt(e);
  }
  function trackResizeHandle(key, label) {
    return trackLayoutOwner.trackResizeHandle(key, label);
  }
  function setStyle(node, key, value) {
    return trackLayoutOwner.setStyle(node, key, value);
  }
  function applyTrackHeights() {
    return trackLayoutOwner.applyTrackHeights();
  }
  function storeTrackHeights() {
    return trackLayoutOwner.storeTrackHeights();
  }
  function renderAudioTrackHeaders(count) {
    return trackLayoutOwner.renderAudioTrackHeaders(count);
  }
  const clipSelectionOwner = createClipSelection({
    $,
    getInspectorTab: () => inspectorTab,
    writeInspectorTab: value => (inspectorTab = value),
    getSelectedCut: () => selectedCut,
    writeSelectedCut: value => (selectedCut = value),
    getNudgeGroup: () => nudgeGroup,
    writeNudgeGroup: value => (nudgeGroup = value),
    getState: () => state,
    review,
    getSelectionAnchor: () => selectionAnchor,
    writeSelectionAnchor: value => (selectionAnchor = value),
    getActiveVideoTrack: () => activeVideoTrack,
    writeActiveVideoTrack: value => (activeVideoTrack = value),
    getSelectedVideos: () => selectedVideos,
    getRowFor: () => rowFor,
    buttons,
    getRenderBin: () => renderBin,
    getRenderInspector: () => renderInspector,
    editView,
    getRenderTimeline: () => renderTimeline,
    getUpdateViewer: () => updateViewer,
    getPause: () => pause,
    saveView,
    selectedAudio,
    hideTrimPreview,
    queueReason,
  });
  function selectionIds() {
    return clipSelectionOwner.selectionIds();
  }
  function setTimelineSelection(ids, primary = ids.at(-1)) {
    return clipSelectionOwner.setTimelineSelection(ids, primary);
  }
  function selectTimelineItem(id, modifiers = {}, preserve = false) {
    return clipSelectionOwner.selectTimelineItem(id, modifiers, preserve);
  }
  const selectedVideos = () => {
    const ids = new Set(selectionIds());
    return state.clips.filter(c => ids.has(c.id));
  };
  function selectionQueueReason() {
    return clipSelectionOwner.selectionQueueReason();
  }
  const take = T.takeOf;
  const videoTotal = () => T.videoTotal(state);
  const total = () => T.total(state);
  const layout = () => T.layout(state);
  const gapAfter = index => T.gapAfter(state, index);
  const editActions = {
    move: { name: 'Move' },
    trim: { name: 'Trim' },
    ripple: { name: 'Ripple trim' },
    roll: { name: 'Roll' },
    slip: { name: 'Slip' },
    slide: { name: 'Slide' },
  };
  const rowFor = id => T.rowFor(state, id);
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
  // Positions read as timecode; durations read as seconds with two decimals.
  function seconds(frames) {
    return (frames / fps).toFixed(2) + 's';
  }
  function tc(frames) {
    frames = Math.max(0, Math.floor(frames));
    return [
      Math.floor(frames / (fps * 3600)),
      Math.floor(frames / (fps * 60)) % 60,
      Math.floor(frames / fps) % 60,
      frames % fps,
    ]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
  }
  function saveHistory() {
    try {
      const project = editingSignature(projectData());
      if (savedHistory?.project === project && sameStacks(savedHistory, undoStack, redoStack)) return;
      const started = performance.now();
      sessionStorage.setItem(VIEW_KEY + ':history', history.serialize(project));
      if (performance.now() - started > 50) diagnostics.record('Saving undo history', performance.now() - started);
      savedHistory = { project, undo: undoStack.slice(), redo: redoStack.slice() };
    } catch (error) {}
  }
  const editingSignature = L.editSignature;

  function save() {
    if (drag && drag.kind !== 'scrub') return;
    saveView();
    saveHistory();
    projectEdit.save();
  }
  function receiveProject(saved) {
    evidenceCache.clear();
    if (drag && drag.before && editingSignature(saved) === editingSignature(drag.before)) {
      L.mergeArrivals(state, saved);
      renderTakes();
      return;
    }
    if (editingSignature(saved) !== editingSignature(projectData())) {
      inputReplacements.invalidate();
      selectedCut = null;
      nudgeGroup = null;
      if (drag) cancelClipDrag();
      if (!workflowLocked) history.clear();
    }
    const view = viewState(),
      active = document.activeElement,
      clipId = state.selected;
    const draft =
      active && $('editor').contains(active) && active.matches('input:not([type=range]),textarea,select')
        ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
        : null;
    state = { ...copy(INITIAL), ...saved, ...view };
    fps = state.fps || 24;
    if (state.selected && !state.clips.some(c => c.id === state.selected)) state.selected = state.clips[0]?.id || null;
    state.frame = clamp(state.frame, 0, total());
    review.reconcile();
    render(false);
    if (draft && (clipId === state.selected || draft.id === 'projectName')) {
      const field = $(draft.id);
      if (field) {
        field.value = draft.value;
        field.focus({ preventScroll: true });
        if (draft.start !== null && field.setSelectionRange && field.type !== 'number')
          field.setSelectionRange(draft.start, draft.end);
      }
    }
    if ($('queueList')) renderQueueList();
  }
  function toast(message, duration = 3300) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($('toast').hidden = true), duration);
  }
  // The status bar confirms the last edit briefly; work in progress shows beside it.
  function setStatus(text) {
    $('status').textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => ($('status').textContent = ''), 6000);
  }
  function buttons() {
    const audio = selectedAudio(),
      count = selectionIds().length;
    $('split').disabled =
      count > 1 ||
      review.mode === 'source' ||
      (audio
        ? state.frame <= audio.start + 5 || state.frame >= audio.start + audio.out - audio.in - 5
        : !T.splitTarget(state, state.frame, selected()?.id));
    for (const [id, stack, shortcut] of [
      ['undo', undoStack, keyText('Ctrl+Z')],
      ['redo', redoStack, keyText('Ctrl+Shift+Z / Ctrl+Y')],
    ]) {
      $(id).disabled = !stack.length || !!drag;
      $(id).title = stack.length
        ? id[0].toUpperCase() + id.slice(1) + ' ' + (stack.at(-1)._label || 'edit') + ' (' + shortcut + ')'
        : 'Nothing to ' + id + ' (' + shortcut + ')';
    }
    $('remove').disabled = !count;
    $('duplicate').title = count > 1 ? 'Duplicate ' + count + ' selected clips' : 'Duplicate selected clip';
    $('remove').title = count > 1 ? 'Delete ' + count + ' selected clips (Delete)' : 'Delete selected clip (Delete)';
    $('duplicate').disabled = !count;
    $('clipName').disabled = !count || count > 1;
    for (const id of ['generate', 'openWorkflow']) $(id).disabled = !selected() || !!audio;
    $('snap').setAttribute('aria-pressed', state.snap);
    $('loop').setAttribute('aria-pressed', state.loop);
    if (count > 1) $('generate').disabled = !!selectionQueueReason();
    else if (selected() && !selectedAudio()) $('generate').disabled = !!queueReason(selected());
    const generateReason =
      selectedAudio() || !selected() ? '' : count > 1 ? selectionQueueReason() : queueReason(selected());
    $('generateReason').textContent = generateReason || '';
    $('generateReason').hidden = !generateReason;
  }

  const preserveTakes = restored => L.preserveArrivals(restored, state);
  const { restoreHistory } = createHistoryActions({
    clearCut: () => {
      selectedCut = null;
    },
    getDrag: () => drag,
    cancelClipDrag: () => cancelClipDrag(),
    pause: () => pause(),
    editView,
    viewState,
    history,
    getState: () => state,
    setState: value => {
      state = value;
    },
    inputReplacements,
    preserveTakes,
    review,
    setSelectionAnchor: value => {
      selectionAnchor = value;
    },
    buttons,
    setStatus,
    render,
    save,
    $,
    document,
  });
  function undo() {
    nudgeGroup = null;
    restoreHistory(undoStack, redoStack, 'Undid');
  }
  function redo() {
    nudgeGroup = null;
    restoreHistory(redoStack, undoStack, 'Redid');
  }

  let laneDraws = 0;
  function draw(id, html) {
    if (drawn[id] === html) return false;
    drawn[id] = html;
    if (id === 'clipLane') laneDraws++;
    $(id).innerHTML = html;
    return true;
  }
  function syncTimelineSelection() {
    const ids = new Set(selectionIds());
    for (const node of $('timelineContent').querySelectorAll('[data-clip],[data-audio],[data-linked-audio]')) {
      const on = ids.has(node.dataset.clip || node.dataset.audio || node.dataset.linkedAudio);
      node.classList.toggle('selected', on);
      if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', on);
    }
  }
  function render(force = true) {
    fps = state.fps || 24;
    document.querySelectorAll('.project-fps').forEach(e => (e.textContent = Math.round(fps * 1000) / 1000));
    renderBin();
    renderInspector();
    renderTimeline();
    updateViewer(force);
    $('projectName').value = state.project;
    $('zoom').value = state.zoom;
    $('zoomValue').textContent = state.zoom + '%';
    $('snap').classList.toggle('active', state.snap);
    $('loop').classList.toggle('active', state.loop);
    audioButtons();
    buttons();
    queueLabel();
  }
  let mediaView = 'grid',
    mediaFilter = 'all';
  try {
    mediaView = sessionStorage.getItem(VIEW_KEY + ':media-view') === 'list' ? 'list' : 'grid';
  } catch (error) {}
  const layoutControlsOwner = createLayoutControls({
    $,
    VIEW_KEY,
    getTimelineDrag: () => timelineDrag,
    writeTimelineDrag: value => (timelineDrag = value),
    getState: () => state,
    getBinTab: () => binTab,
    writeBinTab: value => (binTab = value),
    getPpf: () => ppf,
    getDrag: () => drag,
    review,
    viewState,
    trackHeights,
    getTrackResize: () => trackResize,
    writeTrackResize: value => (trackResize = value),
    applyTrackHeights,
    storeTrackHeights,
    clamp,
    getMediaView: () => mediaView,
    getRenderBin: () => renderBin,
    getRenderTimeline: () => renderTimeline,
    getPointerBusy: () => pointerBusy,
    getViewer: () => viewer,
    getViewerData: () => viewerData,
    getUpdateViewer: () => updateViewer,
    getMediaCollapsedKey: () => mediaCollapsedKey,
    getMediaRail: () => mediaRail,
    getViewerExpanded: () => viewerExpanded,
    writeViewerExpanded: value => (viewerExpanded = value),
    getFullscreenPending: () => fullscreenPending,
    writeFullscreenPending: value => (fullscreenPending = value),
    getViewerZoom: () => viewerZoom,
    getViewerPan: () => viewerPan,
    writeViewerPan: value => (viewerPan = value),
    getViewSaveTimer: () => viewSaveTimer,
    writeViewSaveTimer: value => (viewSaveTimer = value),
    getInspectorFull: () => inspectorFull,
    getInspectorHeightButton: () => inspectorHeightButton,
    getPanelWidths: () => panelWidths,
    getPanelDrag: () => panelDrag,
    writePanelDrag: value => (panelDrag = value),
    getPanelKey: () => panelKey,
    getTimelineHeightKey: () => timelineHeightKey,
  });
  function applyMediaView() {
    return layoutControlsOwner.applyMediaView();
  }
  for (const view of ['grid', 'list'])
    $('mediaView' + view).onclick = () => {
      mediaView = view;
      try {
        sessionStorage.setItem(VIEW_KEY + ':media-view', view);
      } catch (error) {}
      renderBin();
    };
  const { renderBin, takeFacts, projectMedia } = createLibraryRenderer({
    $,
    esc,
    svg,
    T,
    url,
    thumbnails,
    getFps: () => fps,
    getWorkflowLibrary: () => workflowLibrary,
    syncImportedWorkflows,
    getState: () => state,
    getBinTab: () => binTab,
    review,
    seconds,
    draw,
    getMediaFilter: () => mediaFilter,
    applyMediaView,
    getPickImport: () => pickImport,
    getRenderTakes: () => renderTakes,
    getCloseTakeComparison: () => closeTakeComparison,
    getAddMediaClip: () => addMediaClip,
    getUpdateViewer: () => updateViewer,
    getPause: () => pause,
    getFinishViewerPan: () => finishViewerPan,
    getDecimal: () => decimal,
  });
  const mediaImportOwner = createMediaImport({
    $,
    copy,
    esc,
    diagnostics,
    api,
    request,
    productCapabilities,
    projectKey,
    getFps: () => fps,
    writeFps: value => (fps = value),
    getTemplateBrowser: () => templateBrowser,
    writeTemplateBrowser: value => (templateBrowser = value),
    readWorkflowData,
    registerWorkflowData,
    getState: () => state,
    getBinTab: () => binTab,
    writeBinTab: value => (binTab = value),
    review,
    edits,
    projectData,
    getActiveVideoTrack: () => activeVideoTrack,
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
    getPause: () => pause,
    getDialogs: () => dialogs,
    getShowModal: () => showModal,
    getCloseModal: () => closeModal,
    setBinTab,
    addAudioClip,
    clearHeld,
    flushNative,
    connectComfy,
    importWorkflowFile,
    captureInputs,
  });
  function browseComfyTemplates() {
    return mediaImportOwner.browseComfyTemplates();
  }
  function removeMedia(id) {
    return mediaImportOwner.removeMedia(id);
  }
  $('binGrid').addEventListener(
    'click',
    e => {
      const button = e.target.closest('[data-remove-media]');
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      removeMedia(button.dataset.removeMedia);
    },
    true,
  );
  $('binGrid').addEventListener('keydown', e => {
    const card = e.target.closest('[data-media]');
    if (!card || e.target.closest('button')) return;
    if (['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      removeMedia(card.dataset.media);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      card.click();
    }
  });
  const {
    preparedWorkflows,
    workflowLoads,
    unsavedRecipes,
    libraryWorkflow,
    addLibraryShot,
    addBuiltinShot,
    showShotPicker,
  } = createWorkflowCoordinator({
    $,
    copy,
    esc,
    svg,
    productCapabilities,
    getProductDefinitions: () => productDefinitions,
    builtinCaptures,
    cloudDefinitions,
    url,
    thumbnails,
    getFps: () => fps,
    workflows,
    getWorkflowLibrary: () => workflowLibrary,
    builtinBindings,
    resultChoices,
    builtinPreparer,
    getWorkflowAdds: () => workflowAdds,
    setWorkflowAdds: value => {
      workflowAdds = value;
    },
    registerWorkflowData,
    addImportedWorkflowClip,
    applyPreparedWorkflow,
    getState: () => state,
    edits,
    videoTotal,
    total,
    toast,
    setStatus,
    projectMedia,
    getPickImport: () => pickImport,
    getAddMediaClip: () => addMediaClip,
    getPause: () => pause,
    getShowModal: () => showModal,
    getCloseModal: () => closeModal,
    getNativeRecipes: () => nativeRecipes,
    getConnectComfy: () => connectComfy,
    getWorkflowSetup: () => workflowSetup,
  });
  function pickImport(add = false, workflowOnly = false) {
    return mediaImportOwner.pickImport(add, workflowOnly);
  }
  const takeName = t =>
    t.placeholder ? 'Not generated' : t.original ? 'Original clip' : 'Take ' + String(t.number).padStart(2, '0');
  const pendingJobs = c => visibleJobs().filter(j => j.clipId === c.id && G.PENDING.includes(j.status)),
    failedJobs = c => visibleJobs().filter(j => j.clipId === c.id && j.status === 'failed');
  const clipBadgesOwner = createClipBadges({
    $,
    svg,
    drawn,
    getInspectorTab: () => inspectorTab,
    getState: () => state,
    takeSeen,
    selectionIds,
    selectedVideos,
    selectionQueueReason,
    buttons,
    draw,
    getClipNotes: () => clipNotes,
    renderTakes,
    selectedAudio,
    renderAudioInspector,
    getCountLabel: () => countLabel,
    getJobStatus: () => jobStatus,
  });
  function renderNonVideoInspector() {
    return clipBadgesOwner.renderNonVideoInspector();
  }
  function renderSelectionInspector() {
    return clipBadgesOwner.renderSelectionInspector();
  }
  const { clipNotes, createNotes } = await import('/spool/ui/notes.js');
  const inspectorNotes = createNotes($('clipNotesSection'), {
    selected: () => (selectionIds().length === 1 ? selectedAudio() || selected() : null),
    record: edits.record,
    save: () => {
      save();
      renderClipAttention();
    },
    notify: toast,
  });

  function clipAttention(c, video = true) {
    return clipBadgesOwner.clipAttention(c, video);
  }
  function renderClipAttention() {
    return clipBadgesOwner.renderClipAttention();
  }
  function markTakesSeen(ids) {
    return clipBadgesOwner.markTakesSeen(ids);
  }
  const seenStorage = e => {
    if (e.key === takeSeen.key && takeSeen.refresh()) {
      renderClipAttention();
      renderTakes();
    }
  };
  window.addEventListener('storage', seenStorage);
  const { renderInspector } = createInspectorRenderer({
    $,
    esc,
    workflowStatus,
    definitionsFor,
    workflows,
    pixelResolution,
    builtinBindings,
    drawn,
    getInspectorTab: () => inspectorTab,
    getState: () => state,
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
    getRenderTakes: () => renderTakes,
    getChooseTake: () => chooseTake,
    getSelectedAudio: () => selectedAudio,
    getNativeRecipes: () => nativeRecipes,
    getIsInt: () => isInt,
    getRenderJobStatus: () => renderJobStatus,
    getQueueReason: () => queueReason,
    getBindWorkflowControls: () => bindWorkflowControls,
    getControlField: () => controlField,
    getBindImageInputs: () => bindImageInputs,
    getUseTimelineVideo: () => useTimelineVideo,
    getClearInput: () => clearInput,
    getReplaceInputMedia: () => replaceInputMedia,
    getCountLabel: () => countLabel,
    getJobStatus: () => jobStatus,
    getEditableGraph: () => editableGraph,
    getOpenNativeWorkflow: () => openNativeWorkflow,
    getPrepareWorkflow: () => prepareWorkflow,
    deadlineExecution: () => productCapabilities.deadlineExecution === true,
  });
  const takeRendererOwner = createTakeRenderer({
    $,
    esc,
    projectKey,
    url,
    thumbnails,
    takeHoverLabel,
    getFps: () => fps,
    getState: () => state,
    review,
    takeSeen,
    selected,
    clamp,
    seconds,
    tc,
    draw,
    takeName,
    pendingJobs,
    failedJobs,
    clearRenders: ids => renderQueueOwner.clearRenders(ids, () => renderPendingTakes(selected())),
    getTakeBatchKey: () => takeBatchKey,
    updateTakeSelection,
    viewTake,
    chooseTake,
    getDraggedTake: () => draggedTake,
    writeDraggedTake: value => (draggedTake = value),
    getTakeDropPreview: () => takeDropPreview,
    getRenderPlaceholderState: () => renderPlaceholderState,
    getPlay: () => play,
    selectedAudio,
    getDecimal: () => decimal,
  });

  // Consecutive takes generated from the same inputs form one batch; seeds may differ within it.
  function takeBatchInputs(t) {
    return takeRendererOwner.takeBatchInputs(t);
  }
  const takeBatchKey = t =>
    t.generated
      ? 'generated:' +
        (t.summary?.workflowVersion ?? t.request?.workflowVersion ?? '') +
        ':' +
        JSON.stringify(takeBatchInputs(t))
      : t.original
        ? 'original'
        : 'imported';

  function jobPercent(j) {
    return takeRendererOwner.jobPercent(j);
  }
  function renderPendingTakes(c) {
    return takeRendererOwner.renderPendingTakes(c);
  }
  function renderTakes() {
    return takeRendererOwner.renderTakes();
  }
  const takeSelectionTools = document.createElement('div');
  takeSelectionTools.className = 'take-selection-tools';
  takeSelectionTools.innerHTML =
    '<span id="takeSelectionCount" role="status"></span><button id="selectAllTakes" class="outline">Select all</button>';
  const takesHead = $('takes').querySelector('.takes-head');
  takesHead.querySelector('.takes-title').after(takeSelectionTools);
  takeSelectionTools.append($('compareTakesStrip'));
  const takeTools = document.createElement('div');
  takeTools.className = 'take-tools';
  takeTools.innerHTML =
    '<button id="archiveTakes" class="outline" aria-haspopup="menu" aria-expanded="false" title="Remove takes from this clip; ' +
    keyText('Ctrl') +
    '+Z restores them. Files are kept.">Delete &#9662;</button><button id="deleteTakesFromDisk" class="outline" aria-haspopup="menu" aria-expanded="false" title="Permanently delete media and its workflow JSON; cannot be undone">Permanently delete &#9662;</button>';
  takesHead.append(takeTools);
  const clipFolderButton = document.createElement('button');
  clipFolderButton.id = 'openClipFolder';
  clipFolderButton.className = 'outline';
  clipFolderButton.innerHTML = svg('folder') + '<span class="folder-label">Open clip folder</span>';
  takesHead.append(clipFolderButton);
  // Take size trades thumbnail size for rows: large, compact, or a one-line list.
  // The choice is kept in this browser.
  const takeSizeKey = 'spool-take-size',
    takeSizes = { large: 'Large takes', compact: 'Compact takes', list: 'Take list' },
    takeSize = document.createElement('button');
  takeSize.id = 'takeSize';
  takeSize.className = 'outline';
  takeSize.innerHTML = svg('queue');
  const showTakeSize = size => {
    const next = Object.keys(takeSizes)[(Object.keys(takeSizes).indexOf(size) + 1) % 3];
    $('takes').dataset.takeSize = size;
    takeSize.setAttribute('aria-label', takeSizes[size] + '. Switch to ' + takeSizes[next].toLowerCase());
    takeSize.title = takeSizes[size] + ' · click for ' + takeSizes[next].toLowerCase();
  };
  try {
    const saved = localStorage.getItem(takeSizeKey);
    showTakeSize(saved in takeSizes ? saved : 'large');
  } catch (error) {
    showTakeSize('large');
  }
  takeSize.onclick = () => {
    const keys = Object.keys(takeSizes),
      size = keys[(keys.indexOf($('takes').dataset.takeSize) + 1) % keys.length];
    showTakeSize(size);
    try {
      localStorage.setItem(takeSizeKey, size);
    } catch (error) {}
  };
  clipFolderButton.before(takeSize);
  const takePending = document.createElement('div');
  takePending.id = 'takePending';
  takePending.className = 'take-pending';
  takePending.setAttribute('aria-label', 'Takes being generated');
  $('takeList').after(takePending, document.querySelector('.takes-keys'));
  let openingClipFolder = false;
  clipFolderButton.onclick = async () => {
    const clipId = selected()?.id,
      projectId = projectKey;
    if (!clipId || openingClipFolder) return;
    openingClipFolder = true;
    updateTakeSelection();
    try {
      await flushNative();
      await request('projects/' + projectId + '/clip-folder/' + encodeURIComponent(clipId) + '/reveal', {});
      toast('Clip folder opened. Copy videos or images here to add takes.');
    } catch (error) {
      toast(error.message);
    } finally {
      openingClipFolder = false;
      updateTakeSelection();
    }
  };
  const takeActionsOwner = createTakeActions({
    $,
    request,
    productCapabilities,
    projectKey,
    thumbnails,
    getSelectedCut: () => selectedCut,
    writeSelectedCut: value => (selectedCut = value),
    getNudgeGroup: () => nudgeGroup,
    writeNudgeGroup: value => (nudgeGroup = value),
    getState: () => state,
    review,
    history,
    edits,
    getSelectedTakeClip: () => selectedTakeClip,
    writeSelectedTakeClip: value => (selectedTakeClip = value),
    getSelectedTakeIds: () => selectedTakeIds,
    writeSelectedTakeIds: value => (selectedTakeIds = value),
    getTakeSelectionAnchor: () => takeSelectionAnchor,
    writeTakeSelectionAnchor: value => (takeSelectionAnchor = value),
    selected,
    take,
    rowFor,
    clamp,
    saveHistory,
    toast,
    setStatus,
    render,
    takeName,
    markTakesSeen,
    renderInspector,
    renderTakes,
    takeSelectionTools,
    takeTools,
    clipFolderButton,
    getOpeningClipFolder: () => openingClipFolder,
    getRenderTimeline: () => renderTimeline,
    chooseTake,
    getViewer: () => viewer,
    getUpdateViewer: () => updateViewer,
    getPause: () => pause,
    getPlay: () => play,
    getShowModal: () => showModal,
    getCloseModal: () => closeModal,
    getViewerExpanded: () => viewerExpanded,
    saveView,
    finishViewerPan,
    selectedAudio,
    hideTrimPreview,
    clearHeld,
    getProjectEdit: () => projectEdit,
    getShowActionMenu: () => showActionMenu,
  });
  function takeSelection(c = selected()) {
    return takeActionsOwner.takeSelection(c);
  }
  function updateTakeSelection() {
    return takeActionsOwner.updateTakeSelection();
  }
  function selectTake(id, e = {}) {
    return takeActionsOwner.selectTake(id, e);
  }
  function archiveTakes(others = false) {
    return takeActionsOwner.archiveTakes(others);
  }
  $('selectAllTakes').onclick = () => {
    const takes = T.realTakes(selected()),
      ids = takeSelection();
    selectedTakeIds = ids.length === takes.length ? [] : takes.map(t => t.id);
    takeSelectionAnchor = selectedTakeIds[0] || null;
    updateTakeSelection();
    saveView();
  };
  function openTakeActions(action, origin) {
    return takeActionsOwner.openTakeActions(action, origin);
  }
  $('archiveTakes').onclick = () => openTakeActions('archive', $('archiveTakes'));
  $('deleteTakesFromDisk').onclick = () => openTakeActions('delete', $('deleteTakesFromDisk'));

  $('takeList').addEventListener(
    'click',
    e => {
      const card = e.target.closest('[data-take]');
      if (!card) return;
      const checkbox = e.target.closest('[data-select-take]');
      if (checkbox || e.ctrlKey || e.metaKey || e.shiftKey || !e.target.closest('button,input')) {
        if (!checkbox) e.preventDefault();
        e.stopPropagation();
        selectTake(card.dataset.take, {
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          toggle: !!checkbox,
        });
      }
    },
    true,
  );
  $('takes').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      $('selectAllTakes').click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      selectedTakeIds = [];
      updateTakeSelection();
      saveView();
    } else if (['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      archiveTakes();
    }
  });
  $('takes').addEventListener(
    'wheel',
    e => {
      if (e.ctrlKey || e.metaKey) return;
      const list = $('takeList');
      if (list.scrollWidth <= list.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      e.preventDefault();
      e.stopPropagation();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? list.clientWidth : 1;
      list.scrollLeft += delta * unit;
    },
    { passive: false },
  );
  function comparisonTakes() {
    return takeActionsOwner.comparisonTakes();
  }
  function sourceLength() {
    return takeActionsOwner.sourceLength();
  }
  function comparisonVideos() {
    return takeActionsOwner.comparisonVideos();
  }
  function closeTakeComparison() {
    return takeActionsOwner.closeTakeComparison();
  }
  function toggleTakeComparison() {
    return takeActionsOwner.toggleTakeComparison();
  }
  function selectComparisonPane(index) {
    return takeActionsOwner.selectComparisonPane(index);
  }
  function editView() {
    return takeActionsOwner.editView();
  }
  function viewTake(id, c = selected()) {
    return takeActionsOwner.viewTake(id, c);
  }

  function flipTake(step) {
    return takeActionsOwner.flipTake(step);
  }
  function setViewMode(mode) {
    return takeActionsOwner.setViewMode(mode);
  }
  function tryInEdit() {
    return takeActionsOwner.tryInEdit();
  }
  function cancelAudition() {
    return takeActionsOwner.cancelAudition();
  }
  function useViewerTake() {
    return takeActionsOwner.useViewerTake();
  }
  const timelineRenderer = createTimelineRenderer({
    $,
    getState: () => state,
    getActiveTrack: () => activeVideoTrack,
    setActiveTrack: value => {
      activeVideoTrack = value;
    },
    getPixelScale: () => ppf,
    setPixelScale: value => {
      ppf = value;
    },
    getDrag: () => drag,
    getCurrentClip: () => viewer.currentClip,
    invalidateLane: () => {
      drawn.clipLane = null;
    },
    markGestureHintsStale: () => {
      gestureHintsStale = true;
    },
    layout,
    total,
    setStyle,
    seconds,
    draw,
    svg,
    trackResizeHandle,
    edits,
    pause: () => pause(),
    saveView,
    renderAudioTrackHeaders,
    getFps: () => fps,
    tc,
    renderExportRange,
    rowFor,
    take,
    review,
    pendingJobs,
    workflows,
    esc,
    url,
    clipAttention,
    thumbnails,
    startClipDrag: (...args) => startClipDrag(...args),
    selectClip,
    renderAudioTimeline,
    applyTrackHeights,
    selectionIds,
    refreshGestureHints,
  });
  const { renderTimeline } = timelineRenderer;
  function selectClip(id, seekTo = false, modifiers = {}, preserve = false) {
    return clipSelectionOwner.selectClip(id, seekTo, modifiers, preserve);
  }
  const clipToolsOwner = createClipTools({
    $,
    copy,
    esc,
    svg,
    request,
    productCapabilities,
    getProductDefinitions: () => productDefinitions,
    projectKey,
    getFps: () => fps,
    registerWorkflowData,
    addImportedWorkflowClip,
    getInspectorTab: () => inspectorTab,
    writeInspectorTab: value => (inspectorTab = value),
    getState: () => state,
    getDrag: () => drag,
    review,
    edits,
    selected,
    getActiveVideoTrack: () => activeVideoTrack,
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
    getRemove: () => remove,
    getPause: () => pause,
    detectClipCuts,
    exportViewerFrame,
    getViewerExpanded: () => viewerExpanded,
    toggleViewerFullscreen,
    resetViewerZoom,
    selectedAudio,
    addAudioClip,
    splitAudio,
    getBridge: () => bridge,
    host,
    mediaWorkflowData,
    editableGraph,
    openNativeWorkflow,
    getWorkflowSetup: () => workflowSetup,
    getActionMenu: () => actionMenu,
    getClipMenu: () => clipMenu,
    getCloseClipMenu: () => closeClipMenu,
    getShowActionMenu: () => showActionMenu,
    getPlaceMenu: () => placeMenu,
  });
  function chooseTake(clipId, id) {
    return clipToolsOwner.chooseTake(clipId, id);
  }
  function takeWorkflowCapture(clipId, takeId, name) {
    return clipToolsOwner.takeWorkflowCapture(clipId, takeId, name);
  }
  function addMediaClip(id, index = state.clips.length, start = Math.round(state.frame)) {
    return clipToolsOwner.addMediaClip(id, index, start);
  }
  function duplicate() {
    return clipToolsOwner.duplicate();
  }
  const { remove } = createRemovalActions({
    getState: () => state,
    selectionIds,
    edits,
    pause: () => pause(),
    editView,
    inputReplacements,
    setTimelineSelection,
    clamp,
    total,
    setStatus,
  });
  function split() {
    return clipToolsOwner.split();
  }
  const { timelineFrame, snapFrame, startClipDrag, cancelClipDrag, pointerBusy, startFadeDrag, startAudioDrag } =
    createTimelinePointer({
      getFps: () => fps,
      setInspectorTab: value => {
        inspectorTab = value;
      },
      isTimelineResizing: () => timelineDrag,
      getTimelinePan: () => timelinePan,
      setTimelinePan: value => {
        timelinePan = value;
      },
      setSelectedCut: value => {
        selectedCut = value;
      },
      setNudgeGroup: value => {
        nudgeGroup = value;
      },
      getState: () => state,
      setState: value => {
        state = value;
      },
      getPixelScale: () => ppf,
      getDrag: () => drag,
      setDrag: value => {
        drag = value;
      },
      setSelectionAnchor: value => {
        selectionAnchor = value;
      },
      setActiveTrack: value => {
        activeVideoTrack = value;
      },
      isTrackResizing: () => trackResize,
      isPanelDragging: () => panelDrag,
      areGestureHintsStale: () => gestureHintsStale,
      $: (...args) => $(...args),
      copy: (...args) => copy(...args),
      interruptions,
      held,
      review,
      history,
      projectData: (...args) => projectData(...args),
      trackAt: (...args) => trackAt(...args),
      selectionIds: (...args) => selectionIds(...args),
      setTimelineSelection: (...args) => setTimelineSelection(...args),
      selectTimelineItem: (...args) => selectTimelineItem(...args),
      total: (...args) => total(...args),
      layout: (...args) => layout(...args),
      editActions,
      rowFor: (...args) => rowFor(...args),
      clamp: (...args) => clamp(...args),
      tc: (...args) => tc(...args),
      editingSignature,
      save: (...args) => save(...args),
      toast: (...args) => toast(...args),
      setStatus: (...args) => setStatus(...args),
      buttons: (...args) => buttons(...args),
      preserveTakes: (...args) => preserveTakes(...args),
      render: (...args) => render(...args),
      renderInspector: (...args) => renderInspector(...args),
      renderTakes: (...args) => renderTakes(...args),
      editView: (...args) => editView(...args),
      renderTimeline,
      selectClip: (...args) => selectClip(...args),
      setFrame: (...args) => setFrame(...args),
      updateViewer: (...args) => updateViewer(...args),
      pause: (...args) => pause(...args),
      selectedAudio: (...args) => selectedAudio(...args),
      audioSettings: (...args) => audioSettings(...args),
      renderAudioTimeline: (...args) => renderAudioTimeline(...args),
      selectAudio: (...args) => selectAudio(...args),
      hideTrimPreview: (...args) => hideTrimPreview(...args),
      updateTrimPreview: (...args) => updateTrimPreview(...args),
      clipGesture: (...args) => clipGesture(...args),
      gestureCursor: (...args) => gestureCursor(...args),
      audioNeighbor: (...args) => audioNeighbor(...args),
      refreshGestureHints: (...args) => refreshGestureHints(...args),
    });
  let draggedTake = null;
  const takeDropPreview = document.createElement('div');
  takeDropPreview.className = 'take-drop-preview';
  takeDropPreview.hidden = true;
  $('timelineContent').append(takeDropPreview);
  let libraryDrag = null,
    libraryDragPoint = null,
    libraryScrollRAF = 0;
  const libraryDropPreview = document.createElement('div');
  libraryDropPreview.className = 'library-drop-preview';
  libraryDropPreview.hidden = true;
  libraryDropPreview.innerHTML =
    '<div class="library-drop-ghost"></div><div class="library-drop-marker"></div><div class="library-drop-label" role="status"></div>';
  $('timelineContent').append(libraryDropPreview);
  const timelineDropsOwner = createTimelineDrops({
    $,
    copy,
    request,
    getProductDefinitions: () => productDefinitions,
    projectKey,
    getFps: () => fps,
    getState: () => state,
    writeState: value => (state = value),
    getPpf: () => ppf,
    history,
    getSelectedTakeIds: () => selectedTakeIds,
    writeSelectedTakeIds: value => (selectedTakeIds = value),
    projectData,
    getActiveVideoTrack: () => activeVideoTrack,
    writeActiveVideoTrack: value => (activeVideoTrack = value),
    trackHeight,
    trackAt,
    setTimelineSelection,
    layout,
    rowFor,
    tc,
    saveHistory,
    editingSignature,
    save,
    toast,
    preserveTakes,
    render,
    projectMedia,
    libraryWorkflow,
    markTakesSeen,
    closeTakeComparison,
    editView,
    takeWorkflowCapture,
    timelineFrame,
    getDraggedTake: () => draggedTake,
    writeDraggedTake: value => (draggedTake = value),
    takeDropPreview,
    getLibraryDrag: () => libraryDrag,
    getLibraryDragPoint: () => libraryDragPoint,
    writeLibraryDragPoint: value => (libraryDragPoint = value),
    getLibraryScrollRAF: () => libraryScrollRAF,
    writeLibraryScrollRAF: value => (libraryScrollRAF = value),
    libraryDropPreview,
    getExternalDropDepth: () => externalDropDepth,
    writeExternalDropDepth: value => (externalDropDepth = value),
    getPause: () => pause,
    saveView,
    getProjectEdit: () => projectEdit,
    flushNative,
  });
  function clearLibraryDrop() {
    return timelineDropsOwner.clearLibraryDrop();
  }
  function libraryDrop(e, item) {
    return timelineDropsOwner.libraryDrop(e, item);
  }
  function paintLibraryDrop(e) {
    return timelineDropsOwner.paintLibraryDrop(e);
  }
  function scrollLibraryDrop() {
    return timelineDropsOwner.scrollLibraryDrop();
  }
  $('editor').addEventListener('dragstart', e => {
    try {
      libraryDrag = JSON.parse(e.dataTransfer.getData('application/spool'));
    } catch {
      libraryDrag = null;
    }
  });
  document.addEventListener('dragend', () => {
    libraryDrag = null;
    clearLibraryDrop();
    takeDropPreview.hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearLibraryDrop();
  });
  $('timelineScroll').ondragover = e => {
    e.preventDefault();
    const takeDrag = [...e.dataTransfer.types].includes('application/spool-take');
    e.dataTransfer.dropEffect = takeDrag ? 'move' : 'copy';
    if (takeDrag && draggedTake) {
      const track = trackAt(e),
        frame = Math.max(0, snapFrame(timelineFrame(e)));
      Object.assign(takeDropPreview.style, {
        left: frame * ppf + 'px',
        width: draggedTake.frames * ppf + 'px',
        top: 'var(--video-top-' + track + ')',
        height: 'var(--video-height-' + track + ')',
      });
      takeDropPreview.hidden = false;
    } else if (libraryDrag) {
      libraryDragPoint = { clientX: e.clientX, clientY: e.clientY };
      paintLibraryDrop(e);
      if (!libraryScrollRAF) libraryScrollRAF = requestAnimationFrame(scrollLibraryDrop);
    }
  };
  $('timelineScroll').ondragleave = e => {
    if (!$('timelineScroll').contains(e.relatedTarget)) {
      takeDropPreview.hidden = true;
      clearLibraryDrop();
    }
  };
  $('timelineScroll').ondrop = e => {
    e.preventDefault();
    takeDropPreview.hidden = true;
    clearLibraryDrop();
    libraryDrag = null;
    if ([...e.dataTransfer.types].includes('application/spool-take')) {
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/spool-take'));
        if (data.projectId !== projectKey) throw Error('Move takes within the same project.');
        void moveTakeToTimeline(data.clipId, data.takeId, Math.max(0, snapFrame(timelineFrame(e))), trackAt(e));
      } catch (error) {
        toast(error.message);
      }
      return;
    }
    activeVideoTrack = trackAt(e);
    state.frame = Math.max(0, Math.round(timelineFrame(e)));
    const audioOnly = !!e.target.closest('#audioLane,#musicLane');
    if (e.dataTransfer.files.length) {
      importFiles(
        e.dataTransfer.files,
        true,
        Math.max(0, Math.round(timelineFrame(e))),
        state.clips.length,
        audioOnly,
        e.target.closest('#audioLane') ? 'source' : 'music',
      );
      return;
    }
    try {
      const item = JSON.parse(e.dataTransfer.getData('application/spool')),
        f = timelineFrame(e),
        index = T.dropIndex(state, f);
      if (item.workflow || item.builtin) {
        const { clipId, placement } = libraryDrop(e, item);
        if (item.builtin) addBuiltinShot(item.builtin, index, clipId, placement);
        else addLibraryShot(item.workflow, index, clipId, false, placement);
      } else if (item.media) {
        if (audioOnly)
          addAudioClip(
            projectMedia().find(m => m.id === item.media),
            Math.max(0, Math.round(f)),
            e.target.closest('#audioLane') ? 'source' : 'music',
          );
        else addMediaClip(item.media, index, Math.max(0, Math.round(f)));
      }
    } catch (error) {
      toast('Drop a workflow or a media file onto the timeline.');
    }
  };
  function moveTakeToTimeline(clipId, takeId, start, track) {
    return timelineDropsOwner.moveTakeToTimeline(clipId, takeId, start, track);
  }
  let externalDropDepth = 0;
  const externalFileDrag = e =>
    Array.from(e.dataTransfer?.types || []).includes('Files') || !!e.dataTransfer?.files?.length;
  function clearExternalDrop() {
    return timelineDropsOwner.clearExternalDrop();
  }
  $('editor').addEventListener(
    'dragenter',
    e => {
      if (!externalFileDrag(e)) return;
      e.preventDefault();
      externalDropDepth++;
      $('externalDropHint').hidden = false;
    },
    true,
  );
  $('editor').addEventListener(
    'dragover',
    e => {
      if (e.target.closest('[data-image-input],[data-media-input]') || !externalFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      $('externalDropHint').hidden = false;
      $('externalDropTitle').textContent = e.target.closest('.timeline-shell')
        ? 'Add workflow or media to the edit'
        : 'Import workflow or media';
    },
    true,
  );
  $('editor').addEventListener(
    'dragleave',
    () => {
      externalDropDepth = Math.max(0, externalDropDepth - 1);
      if (!externalDropDepth) $('externalDropHint').hidden = true;
    },
    true,
  );
  $('editor').addEventListener(
    'drop',
    e => {
      if (e.target.closest('[data-image-input],[data-media-input]') || !externalFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearExternalDrop();
      const add = !!e.target.closest('.timeline-shell');
      if (add) activeVideoTrack = trackAt(e);
      const frame = add ? Math.max(0, Math.round(timelineFrame(e))) : Math.round(state.frame),
        index = add ? T.dropIndex(state, frame) : state.clips.length;
      if (add) state.frame = frame;
      importFiles(
        e.dataTransfer.files,
        add,
        frame,
        index,
        !!e.target.closest('#audioLane,#musicLane'),
        e.target.closest('#audioLane') ? 'source' : 'music',
      );
    },
    true,
  );
  window.addEventListener('dragend', clearExternalDrop);
  interruptions.on(clearExternalDrop);
  const audioEditorOwner = createAudioEditor({
    $,
    copy,
    esc,
    svg,
    url,
    getFps: () => fps,
    defaultAudioTracks,
    getInspectorTab: () => inspectorTab,
    writeInspectorTab: value => (inspectorTab = value),
    getState: () => state,
    getPpf: () => ppf,
    review,
    history,
    edits,
    selected,
    getActiveVideoTrack: () => activeVideoTrack,
    take,
    layout,
    clamp,
    seconds,
    tc,
    save,
    toast,
    buttons,
    draw,
    syncTimelineSelection,
    takeName,
    clipAttention,
    renderInspector,
    editView,
    startClipDrag,
    startFadeDrag,
    startAudioDrag,
    getViewer: () => viewer,
    getPause: () => pause,
    getSyncAudio: () => syncAudio,
    selectedAudio,
    getAudioSettings: () => audioSettings,
    getTrackAudible: () => trackAudible,
    selectAudio,
    refreshGestureHints,
  });
  function audioButtons() {
    return audioEditorOwner.audioButtons();
  }

  const viewer = createViewer({
    getState: () => state,
    getPixelScale: () => ppf,
    isTimelinePanning: () => !!timelinePan,
    resetProjectPoll: () => {
      projectSync.requestPoll();
    },
    refreshTrimPreview: () => {
      if (lastTrimEdit) updateTrimPreview(lastTrimEdit.d, lastTrimEdit.delta);
    },
    getSeekGuard: () => nativeVideoSeekGuard,
    $,
    review,
    thumbnails,
    clamp,
    total,
    resolution: () => resolution(),
    getFps: () => fps,
    draw,
    esc,
    svg,
    takeName,
    selectedAudio,
    selected,
    tc,
    seconds,
    take,
    applyViewerZoom,
    projectKey,
    request,
    flushNative,
    textStatus: setStatus,
    toast,
    diagnostics,
    hideTrimPreview,
    sourceLength,
    comparisonTakes,
    comparisonVideos,
    layout,
    save,
    saveView,
    trackAudible: track => trackAudible(track),
    audioEnvelope: (...args) => audioEnvelope(...args),
    fileUrl: url,
  });
  const {
    setFrame,
    viewerData,
    updateViewer,
    previewFile,
    renderPlaceholderState,
    reviewSource,
    videoTiming,
    videoSource,
    seekVideo,
    pause,
    play,
    skip,
    frameStep,
    ensureAudioContext,
    syncAudio,
    previews,
  } = viewer;

  function importFiles(
    files,
    add = false,
    start = Math.round(state.frame),
    index = state.clips.length,
    audioOnly = false,
    audioTrack = 'music',
    audioLane = activeVideoTrack,
  ) {
    return mediaImportOwner.importFiles(files, add, start, index, audioOnly, audioTrack, audioLane);
  }
  function pasteImages(images, destination) {
    return mediaImportOwner.pasteImages(images, destination);
  }
  function pasteClipboardImage(destination) {
    return mediaImportOwner.pasteClipboardImage(destination);
  }
  let pasteDestination = 'timeline';
  const textPasteTarget = target =>
    target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const rememberPasteDestination = e => {
    if (textPasteTarget(e.target)) return;
    const destination = e.target.closest('#mediaPanel')
      ? 'media'
      : e.target.closest('.timeline-shell,.timeline-toolbar')
        ? 'timeline'
        : null;
    if (destination) {
      pasteDestination = destination;
      if (e.type === 'pointerdown' && !e.target.closest('button,a')) $('editor').focus({ preventScroll: true });
    }
  };
  for (const event of ['pointerdown', 'focusin']) $('editor').addEventListener(event, rememberPasteDestination, true);
  document.addEventListener('paste', e => {
    if (textPasteTarget(e.target) || !$('modalOverlay').hidden || drag || workflowLocked || $('editor').inert) return;
    const files = Array.from(e.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!files.length)
      files.push(...Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith('image/')));
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    closeClipMenu(false);
    pasteImages(
      files,
      e.target.closest('#mediaPanel')
        ? 'media'
        : e.target.closest('.timeline-shell,.timeline-toolbar')
          ? 'timeline'
          : pasteDestination,
    );
  });
  const dialogs = createDialogs({
    $,
    esc,
    svg,
    pause,
    cancelCapture: () => projectEdit.cancelCapture(),
    stopDiagnostics: () => {
      clearInterval(diagnosticsTimer);
      diagnosticsTimer = 0;
    },
  });
  const { showModal, closeModal } = dialogs;
  processingButton.onclick = () => {
    showModal(
      'Processing and diagnostics',
      '<p id="diagnosticsCurrent"></p><p>Recent timings and errors are kept locally in this tab. Copy this log when an action takes too long.</p><textarea class="diagnostics-log" id="diagnosticsLog" readonly aria-label="Local diagnostic log"></textarea>',
      '<button class="outline" id="diagnosticsDownload">Download log</button><button class="primary" id="diagnosticsCopy">Copy diagnostics</button>',
    );
    const refresh = () => {
      const value = diagnostics.snapshot();
      $('diagnosticsCurrent').textContent =
        value.active.map(a => a.label + ' (' + (a.elapsedMs / 1000).toFixed(1) + 's)').join(' - ') || 'Ready';
      $('diagnosticsLog').value = JSON.stringify(
        { spoolVersion: productCapabilities.version, projectId: projectKey, revision: projectEdit.revision, ...value },
        null,
        2,
      );
    };
    refresh();
    clearInterval(diagnosticsTimer);
    diagnosticsTimer = setInterval(refresh, 500);
    $('diagnosticsCopy').onclick = async () => {
      const field = $('diagnosticsLog');
      try {
        await navigator.clipboard.writeText(field.value);
        $('diagnosticsCopy').textContent = 'Copied';
      } catch (error) {
        field.focus();
        field.select();
        $('diagnosticsCopy').textContent = keyText('Press Ctrl+C');
      }
    };
    $('diagnosticsDownload').onclick = () => {
      const blob = new Blob([$('diagnosticsLog').value], { type: 'application/json' }),
        a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'spool-diagnostics.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  };
  function importFootageDialog() {
    return mediaImportOwner.importFootageDialog();
  }

  const projectDialogsOwner = createProjectDialogs({
    $,
    copy,
    esc,
    svg,
    request,
    BOOT,
    productCapabilities,
    projectKey,
    getFps: () => fps,
    getWorkflowLibrary: () => workflowLibrary,
    getTemplateBrowser: () => templateBrowser,
    builtinPreparer,
    getState: () => state,
    history,
    edits,
    projectData,
    selected,
    take,
    toast,
    preparedWorkflows,
    workflowLoads,
    importFiles,
    showModal,
    closeModal,
    importFootageDialog,
    detectClipCuts,
    getResolution: () => resolution,
    getNativeRecipes: () => nativeRecipes,
    getBridge: () => bridge,
    withBridge,
    getProjectEdit: () => projectEdit,
    flushNative,
    getFocusViewId: () => focusViewId,
    getComfyConnection: () => comfyConnection,
    writeComfyConnection: value => (comfyConnection = value),
    renderConnection,
    ensureComfy,
    getExperimentRetry: () => experimentRetry,
    submitExperiment,
    getAddGraphButton: () => addGraphButton,
    renderInspector: () => renderInspector(),
  });
  function projectSettings() {
    return projectDialogsOwner.projectSettings();
  }
  function detectClipCuts(id) {
    return mediaImportOwner.detectClipCuts(id);
  }
  const exportsOwner = createExports({
    $,
    esc,
    api,
    request,
    projectKey,
    url,
    getFps: () => fps,
    getExportRangeDrag: () => exportRangeDrag,
    writeExportRangeDrag: value => (exportRangeDrag = value),
    getState: () => state,
    getPpf: () => ppf,
    edits,
    selectionIds,
    take,
    total,
    layout,
    clamp,
    tc,
    toast,
    setStatus,
    showModal,
    closeModal,
    getResolution: () => resolution,
    getExportRangeBar: () => exportRangeBar,
    getRangeSettings: () => rangeSettings,
    getExportData: () => exportData,
    getExportFormat: () => exportFormat,
    writeExportFormat: value => (exportFormat = value),
    getViewerExpanded: () => viewerExpanded,
    toggleViewerFullscreen,
    flushNative,
    downloadValue,
  });
  function exportViewerFrame(data) {
    return exportsOwner.exportViewerFrame(data);
  }
  const renderQueueOwner = createRenderQueue({
    $,
    edits,
    esc,
    svg,
    request,
    workflowStatus,
    productCapabilities,
    getProductDefinitions: () => productDefinitions,
    cloudDefinitions,
    definitionsFor,
    projectKey,
    url,
    workflows,
    getState: () => state,
    selected,
    selectionIds,
    save,
    toast,
    jobPercent,
    showModal,
    closeModal,
    selectedAudio,
    getNativeRecipes: () => nativeRecipes,
    getDecimal: () => decimal,
    getProjectEdit: () => projectEdit,
    flushNative,
    pollNative,
    getQueueClips: () => queueClips,
    getQueueSubmission: () => queueSubmission,
    getExperimentRetryKey: () => experimentRetryKey,
    getExperimentRetry: () => experimentRetry,
    writeExperimentRetry: value => (experimentRetry = value),
    getJobStatus: () => jobStatus,
  });
  function queueLabel() {
    return renderQueueOwner.queueLabel();
  }
  const resolution = () => state.resolution || { width: 960, height: 540 };
  const exportRangeBar = document.createElement('div');
  exportRangeBar.id = 'exportRangeBar';
  exportRangeBar.innerHTML =
    '<button data-export-edge="start" aria-label="Export start" role="slider" tabindex="0">Start</button><button data-export-edge="end" aria-label="Export end" role="slider" tabindex="0">End</button>';
  $('timelineContent').append(exportRangeBar);
  exportRangeBar.onpointerdown = e => {
    if (e.target === exportRangeBar) {
      e.stopPropagation();
      $('ruler').onpointerdown(e);
    }
  };
  const rangeSettings = document.createElement('button');
  rangeSettings.id = 'exportRangeSettings';
  rangeSettings.className = 'outline';
  rangeSettings.textContent = 'Range';
  rangeSettings.title = 'Export range · I sets start, O sets end at the timeline playhead';
  $('gestureHelp').after(rangeSettings);
  rangeSettings.onclick = () => exportVideo();
  function renderExportRange(range = T.exportRange(state)) {
    return exportsOwner.renderExportRange(range);
  }
  function setExportRange(range) {
    return exportsOwner.setExportRange(range);
  }
  function setExportEdge(edge, frame) {
    return exportsOwner.setExportEdge(edge, frame);
  }
  function cancelExportRange() {
    return exportsOwner.cancelExportRange();
  }
  for (const b of exportRangeBar.children) {
    b.onpointerdown = e => {
      if (e.button !== 0 || pointerBusy()) return;
      e.preventDefault();
      e.stopPropagation();
      pause();
      const range = T.exportRange(state);
      exportRangeDrag = { edge: b.dataset.exportEdge, range, scale: ppf };
      b.setPointerCapture(e.pointerId);
      b.focus({ preventScroll: true });
    };
    b.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        cancelExportRange();
        return;
      }
      const edge = b.dataset.exportEdge,
        range = T.exportRange(state),
        frame =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? total()
              : range[edge] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
      setExportEdge(edge, frame);
    };
  }
  window.addEventListener('pointermove', e => {
    if (!exportRangeDrag) return;
    const d = exportRangeDrag,
      r = $('timelineContent').getBoundingClientRect(),
      frame = state.snap
        ? T.snap(T.snapPoints(state), (e.clientX - r.left) / d.scale, T.SNAP_PIXELS / d.scale)
        : Math.round((e.clientX - r.left) / d.scale);
    d.range[d.edge] = clamp(
      frame,
      d.edge === 'start' ? 0 : d.range.start + 1,
      d.edge === 'start' ? d.range.end - 1 : total(),
    );
    renderExportRange(d.range);
  });
  window.addEventListener('pointerup', () => {
    if (!exportRangeDrag) return;
    const range = exportRangeDrag.range;
    exportRangeDrag = null;
    setExportRange(range);
  });
  window.addEventListener('pointercancel', cancelExportRange);
  interruptions.on(cancelExportRange);

  const exportData = () => ({
    ...T.exportPlan(state, T.exportRange(state)),
    fps,
    ...resolution(),
    projectId: projectKey,
  });
  let exportFormat = 'mp4';
  function exportVideo() {
    return exportsOwner.exportVideo();
  }

  function downloadProject() {
    return exportsOwner.downloadProject();
  }
  function setBinTab(tab) {
    return layoutControlsOwner.setBinTab(tab);
  }
  for (const button of document.querySelectorAll('[data-media-filter]'))
    button.onclick = () => {
      mediaFilter = button.dataset.mediaFilter;
      document.querySelectorAll('[data-media-filter]').forEach(b => {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-pressed', b === button);
      });
      renderBin();
    };
  document.querySelectorAll('[data-bin-tab]').forEach(b => (b.onclick = () => setBinTab(b.dataset.binTab)));
  $('pasteImageMedia').onclick = () => pasteClipboardImage('media');
  $('pasteImageTimeline').onclick = () => pasteClipboardImage('timeline');
  for (const id of ['pasteImageMedia', 'pasteImageTimeline', 'undo', 'redo']) $(id).title = keyText($(id).title);
  $('sourceTab').onclick = () => setViewMode('source');
  $('editTab').onclick = () => setViewMode('edit');
  $('useSource').onclick = useViewerTake;
  $('tryInEdit').onclick = tryInEdit;
  $('cancelAudition').onclick = cancelAudition;
  $('play').onclick = play;
  $('previous').onclick = () => skip(-1);
  $('next').onclick = () => skip(1);
  $('frameBack').onclick = () => frameStep(-1);
  $('frameForward').onclick = () => frameStep(1);
  $('seek').oninput = e => {
    hideTrimPreview();
    pause();
    setFrame(Number(e.target.value), true);
  };
  $('seek').onchange = save;
  $('loop').onclick = () => {
    state.loop = !state.loop;
    $('loop').classList.toggle('active', state.loop);
    save();
  };
  for (const id of ['monitorMute'])
    $(id).onclick = () => {
      ensureAudioContext();
      state.muted = !state.muted;
      audioButtons();
      save();
    };
  for (const [id, key] of [
    ['trackMute', 'sourceMuted'],
    ['trackSolo', 'sourceSolo'],
    ['musicMute', 'musicMuted'],
    ['musicSolo', 'musicSolo'],
  ])
    $(id).onclick = () => {
      edits.apply(
        'Change ' + (key.startsWith('source') ? 'clip audio' : 'soundtrack') + ' mix',
        () => {
          state.audioTracks = { ...defaultAudioTracks, ...state.audioTracks, [key]: !state.audioTracks?.[key] };
        },
        'audio',
      );
    };
  $('split').onclick = split;
  $('remove').onclick = () => remove();
  $('duplicate').onclick = duplicate;
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  $('inputsInspectorTab').onclick = () => {
    state.selectedAudio = null;
    inspectorTab = 'inputs';
    renderInspector();
    renderTimeline();
    save();
  };
  $('audioInspectorTab').onclick = () => {
    inspectorTab = 'audio';
    renderInspector();
  };
  $('importAudio').onclick = () => $('audioFiles').click();
  $('audioFiles').onchange = e => importFiles(e.target.files, true, Math.round(state.frame), state.clips.length, true);
  $('snap').onclick = () => {
    state.snap = !state.snap;
    $('snap').classList.toggle('active', state.snap);
    save();
    toast('Snapping ' + (state.snap ? 'on' : 'off'));
  };
  $('zoom').oninput = e => setTimelineZoom(Number(e.target.value));
  $('fit').onclick = fitTimeline;
  $('generate').onclick = () => queueClips(selectedVideos());
  $('export').onclick = exportVideo;
  $('saveProject').onclick = downloadProject;
  $('openProject').onclick = () => openProjectFolder();
  $('projectName').onchange = e => {
    edits.apply(
      'Rename project',
      () => {
        state.project = e.target.value.trim() || 'Untitled project';
        e.target.value = state.project;
      },
      'none',
    );
  };
  $('clipName').onchange = e => {
    const c = selectedAudio() || selected();
    if (!c) return;
    edits.apply(
      'Rename ' + c.name,
      () => {
        c.name = e.target.value.trim() || 'Untitled clip';
      },
      'timeline',
    );
  };
  $('reset').onclick = reset;
  $('toggleMedia').onclick = () => {
    if (window.innerWidth <= 1100) {
      $('mediaPanel').classList.toggle('open');
      $('inspector').classList.remove('open');
    } else if ($('workbench').classList.contains('hide-media') && $('mediaPanel').classList.contains('open'))
      closeMediaFlyout();
    else setMediaCollapsed(!$('workbench').classList.contains('hide-media'));
  };
  // On desktop a collapsed media pool leaves an icon rail whose buttons open the pool over the viewer.
  const mediaCollapsedKey = 'spool-media-collapsed',
    mediaRail = document.createElement('nav');
  mediaRail.className = 'media-rail';
  mediaRail.setAttribute('aria-label', 'Workflows and media');
  mediaRail.innerHTML =
    [
      ['workflows', 'nodes', 'Workflows'],
      ['media', 'bin', 'Media'],
    ]
      .map(
        ([tab, icon, label]) =>
          '<button type="button" class="iconbutton" data-rail-tab="' +
          tab +
          '" aria-pressed="false" title="' +
          label +
          '" aria-label="' +
          label +
          '">' +
          svg(icon) +
          '</button>',
      )
      .join('') +
    '<button type="button" class="iconbutton" id="dockMedia" title="Keep workflows and media open" aria-label="Keep workflows and media open">' +
    svg('sidebar') +
    '</button>';
  $('editor').append(mediaRail);
  function syncMediaRail() {
    return layoutControlsOwner.syncMediaRail();
  }
  function closeMediaFlyout() {
    return layoutControlsOwner.closeMediaFlyout();
  }
  function setMediaCollapsed(collapsed) {
    return layoutControlsOwner.setMediaCollapsed(collapsed);
  }
  mediaRail.querySelectorAll('[data-rail-tab]').forEach(
    b =>
      (b.onclick = () => {
        const panel = $('mediaPanel'),
          same = panel.classList.contains('open') && panel.dataset.tab === b.dataset.railTab;
        setBinTab(b.dataset.railTab);
        panel.classList.toggle('open', !same);
        syncMediaRail();
      }),
  );
  $('dockMedia').onclick = () => setMediaCollapsed(false);
  document.addEventListener(
    'pointerdown',
    e => {
      if (!e.target.closest('#mediaPanel,.media-rail,#modalOverlay,#native-clip-menu')) closeMediaFlyout();
    },
    true,
  );
  $('mediaPanel').addEventListener('dragend', closeMediaFlyout);
  try {
    if (window.innerWidth > 1100 && localStorage.getItem(mediaCollapsedKey) === '1')
      $('workbench').classList.add('hide-media');
  } catch (error) {}
  $('toggleInspector').onclick = () => {
    if (window.innerWidth <= 760) {
      $('inspector').classList.toggle('open');
      $('mediaPanel').classList.remove('open');
    } else {
      document.querySelector('.workbench').classList.toggle('hide-inspector');
    }
  };
  for (const id of ['importMedia', 'importTop']) $(id).onclick = () => pickImport();
  $('mediaFiles').onchange = e => importFiles(e.target.files);
  $('importWorkflow').onclick = () => pickImport(false, true);
  $('poolSearch').oninput = renderBin;
  $('addShot').onclick = showShotPicker;
  $('help').onclick = () =>
    showModal(
      'Edit by pointing',
      keyText(
        '<p>Click to select. Ctrl-click toggles clips; Shift-click selects a range on one track. Drag empty timeline space to box-select, or press Ctrl+A to select all. Drag selected clips to move them together; Alt-drag copies them at the drop position. Ctrl+D also duplicates the selection. Drag the clip to move it, a free edge to trim, or a shared cut to roll. The cursor shows what will happen. Your gesture stays fixed until you release it.</p><div class="shortcut-grid"><span>Enable / disable selected clips</span><kbd>Ctrl Shift D</kbd><span>Ripple an edge</span><kbd>Shift + drag</kbd><span>Slip source inside a clip</span><kbd>Hold S + drag</kbd><span>Slide between touching neighbors</span><kbd>Hold D + drag</kbd><span>Nudge held S/D, or selected cut</span><kbd>, / .</kbd><span>Five-frame nudge</span><kbd>Shift + , / .</kbd><span>Compare / single viewer during edit</span><kbd>C</kbd><span>Compare takes / close compare</span><kbd>C</kbd><span>Fullscreen viewer / fit picture</span><kbd>F / Shift F</kbd><span>Timeline zoom / fit</span><kbd>+ / − / Shift Z</kbd><span>Snap</span><kbd>N</kbd><span>Play / pause</span><kbd>Space</kbd><span>Previous / next frame</span><kbd>Left / Right</kbd><span>Previous / next take or edit</span><kbd>Up / Down</kbd><span>Review take 1–9</span><kbd>1–9</kbd><span>Use take</span><kbd>Enter</kbd><span>Source / Edit</span><kbd>Q</kbd><span>Cancel edit</span><kbd>Esc</kbd><span>Split at playhead</span><kbd>B</kbd><span>Delete, leaving space / close selected gap</span><kbd>Delete</kbd><span>Ripple delete</span><kbd>Shift + Delete</kbd><span>Undo / Redo</span><kbd>Ctrl Z / Ctrl Shift Z</kbd></div><p>Wheel over the viewer to zoom around the pointer, then drag to pan. Double-click the picture, click Fit, or press Shift+F to reset. F toggles fullscreen; Esc exits it. Compare opens two synchronized takes; select A or B, then click a take to replace that pane. Only the active pane plays audio. Enter uses its take. Timeline +/− or Ctrl+wheel zooms; Shift+Z fits.</p><p>A1 edits with its linked video; fade handles adjust fades. A2 moves and slips independently, and its shared cuts roll. A2 never ripples or slides with video edits.</p><p>Click a gap to select it, then Delete to close it. Drag dividers to resize panels or the timeline; double-click resets them.</p>',
      ),
    );
  let viewerExpanded = false,
    fullscreenPending = false,
    fullscreenWasNative = false;
  function setViewerExpanded(expanded) {
    return layoutControlsOwner.setViewerExpanded(expanded);
  }
  function toggleViewerFullscreen() {
    return layoutControlsOwner.toggleViewerFullscreen();
  }
  $('fullscreen').onclick = toggleViewerFullscreen;
  $('compareTakes').onclick = $('compareTakesStrip').onclick = toggleTakeComparison;
  for (let i = 0; i < 2; i++) {
    $('compareSelect' + i).onclick = () => selectComparisonPane(i);
    $('comparePane' + i).addEventListener('pointerdown', e => {
      if (e.button === 0 && !e.target.closest('button')) selectComparisonPane(i);
    });
    $('compareImage' + i).addEventListener('load', applyViewerZoom);
  }
  document.addEventListener('fullscreenchange', () => {
    finishViewerPan();
    const full = document.fullscreenElement === $('viewer');
    if (full && !viewerExpanded) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (!full && fullscreenWasNative) setViewerExpanded(false);
    fullscreenWasNative = full;
    applyViewerZoom();
  });
  $('editor').addEventListener('keydown', e => {
    if (workflowLocked) return;
    if (e.key === 'Escape' && viewerExpanded) {
      e.preventDefault();
      e.stopPropagation();
      toggleViewerFullscreen();
      return;
    }
    if (e.key === 'Escape' && viewerPan) {
      e.preventDefault();
      e.stopPropagation();
      finishViewerPan(true);
      return;
    }
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      e.stopPropagation();
      cancelClipDrag();
      return;
    }
    if ($('modalOverlay').hidden && $('rendersPanel').contains(e.target)) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRenders();
      }
      return;
    }
    if (dialogs.keydown(e)) return;
    if (
      e.target.closest(
        'input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]:not([contenteditable=false])',
      )
    ) {
      clearHeld();
      return;
    }
    if (e.key === 'Escape') {
      clearHeld();
      hideTrimPreview();
      if (!review.audition) {
        selectedCut = null;
        setTimelineSelection([]);
        render();
        save();
      }
      if (review.audition) cancelAudition();
      else setViewMode('edit');
      $('mediaPanel').classList.remove('open');
      syncMediaRail();
      $('inspector').classList.remove('open');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectedCut = null;
      pause();
      editView();
      setTimelineSelection([...state.clips, ...(state.audioClips || [])].map(c => c.id));
      selectionAnchor = state.selectedAudio || state.selected;
      render();
      save();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      e.stopPropagation();
      e.shiftKey ? toggleSelectedEnabled() : duplicate();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      ['s', 'd', 'shift'].includes(e.key.toLowerCase()) &&
      !e.target.closest('input[type=range]')
    ) {
      const key = e.key.toLowerCase();
      if (!e.repeat) {
        held[key] = true;
        refreshGestureHints(true);
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'c' && !$('trimViewButton').hidden) {
      e.preventDefault();
      e.stopPropagation();
      toggleTrimView();
      return;
    }
    if (drag) {
      if (e.key.toLowerCase() === 'c' && drag.moved) {
        e.preventDefault();
        toggleTrimView();
      } else if (e.key !== 'Shift') e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (['i', 'o'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      setExportEdge(e.key.toLowerCase() === 'i' ? 'start' : 'end', Math.round(state.frame));
      return;
    }
    if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) e.shiftKey ? resetViewerZoom() : toggleViewerFullscreen();
      return;
    }
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggleTakeComparison();
      return;
    }
    const key = editingKey(e);
    if (e.target.closest('input[type=range]') && !['.', ','].includes(key)) return;
    if (['+', '=', '-', '_'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();
      setTimelineZoom(state.zoom * (['+', '='].includes(key) ? 1.25 : 0.8));
      return;
    }
    if (key === 'z' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      fitTimeline();
      return;
    }
    if (key === ',' || key === '.') {
      e.preventDefault();
      e.stopPropagation();
      nudgeEdit((key === ',' ? -1 : 1) * (e.shiftKey ? 5 : 1));
      return;
    }
    if (key === 'n') {
      e.preventDefault();
      e.stopPropagation();
      $('snap').click();
      return;
    }
    if (
      ![
        ' ',
        'arrowleft',
        'arrowright',
        'arrowup',
        'arrowdown',
        'home',
        'end',
        'b',
        'delete',
        'backspace',
        'q',
        'enter',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
      ].includes(key)
    )
      return;
    if ((key === ' ' || key === 'enter') && e.target.closest('button,a,[data-clip]')) return;
    e.stopPropagation();
    if (key === ' ') {
      e.preventDefault();
      play();
    } else if (key === 'q') setViewMode(review.mode === 'source' ? 'edit' : 'source');
    else if (key === 'enter') useViewerTake();
    else if (/^[1-9]$/.test(key)) {
      const c = selectedAudio() ? null : selected(),
        t = T.realTakes(c)[Number(key) - 1];
      if (t) viewTake(t.id, c);
    } else if (key === 'arrowup' || key === 'arrowdown') {
      e.preventDefault();
      const step = key === 'arrowup' ? -1 : 1;
      review.mode === 'source' ? flipTake(step) : skip(step);
    } else if (key === 'arrowleft') {
      e.preventDefault();
      frameStep(-1);
    } else if (key === 'arrowright') {
      e.preventDefault();
      frameStep(1);
    } else if (key === 'home' || key === 'end') {
      e.preventDefault();
      pause();
      setFrame(key === 'home' ? 0 : review.mode === 'source' && review.source ? sourceLength() : total(), true);
      save();
    } else if (key === 'b') {
      split();
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      remove(e.shiftKey);
    }
  });
  // Zoom is local to this view. Source retains its crop while flipping takes.
  function freshViewerZoom() {
    return layoutControlsOwner.freshViewerZoom();
  }
  let viewerZoom = freshViewerZoom(),
    viewerPan = null,
    viewSaveTimer = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY))?.viewerZoom;
    for (const mode of ['edit', 'source'])
      if (saved?.[mode]) {
        const z = saved[mode];
        viewerZoom[mode] = { scale: clamp(Number(z.scale) || 1, 1, 6), x: Number(z.x) || 0, y: Number(z.y) || 0 };
      }
  } catch (error) {}
  function persistView() {
    return layoutControlsOwner.persistView();
  }
  function saveView() {
    return layoutControlsOwner.saveView();
  }
  function viewerImageBox(element) {
    return layoutControlsOwner.viewerImageBox(element);
  }
  function applyViewerZoom() {
    return layoutControlsOwner.applyViewerZoom();
  }

  function resetViewerZoom() {
    return layoutControlsOwner.resetViewerZoom();
  }
  function viewerZoomAt(scale, element, clientX, clientY) {
    return layoutControlsOwner.viewerZoomAt(scale, element, clientX, clientY);
  }
  function viewerHit(e) {
    return layoutControlsOwner.viewerHit(e);
  }
  // A failed preparation is retryable in place instead of for the rest of the session.
  $('viewerResolution').title = 'Click to retry a failed playback preparation';
  $('viewerResolution').addEventListener('click', () => {
    const m = viewerData()?.media;
    if (m && previews.retry(m)) {
      updateViewer(true);
      setStatus('Retrying playback preparation');
    }
  });
  $('viewerZoom').onclick = resetViewerZoom;
  for (const id of ['still', 'trimImage0', 'trimImage1', 'trimImage2', 'trimImage3'])
    $(id).addEventListener('load', applyViewerZoom);
  $('viewerStage').addEventListener(
    'wheel',
    e => {
      const element = viewerHit(e);
      if (!element) return;
      e.preventDefault();
      e.stopPropagation();
      finishViewerPan();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? $('viewerStage').clientHeight : 1;
      clearTimeout(trimPreviewTimer);
      viewerZoomAt(viewerZoom[review.mode].scale * Math.exp(-e.deltaY * unit * 0.0015), element, e.clientX, e.clientY);
    },
    { passive: false },
  );
  $('viewerStage').addEventListener('pointerdown', e => {
    const element = viewerHit(e),
      z = viewerZoom[review.mode];
    if (!element || e.button !== 0 || z.scale <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    $('editor').focus({ preventScroll: true });
    clearTimeout(trimPreviewTimer);
    viewerPan = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      original: copy(z),
      box: viewerImageBox(element),
      mode: review.mode,
    };
    $('viewerStage').setPointerCapture(e.pointerId);
    applyViewerZoom();
  });
  $('viewerStage').addEventListener('pointermove', e => {
    if (!viewerPan || viewerPan.pointerId !== e.pointerId) return;
    const p = viewerPan,
      z = viewerZoom[p.mode];
    z.x = p.original.x + (e.clientX - p.x) / p.box.width;
    z.y = p.original.y + (e.clientY - p.y) / p.box.height;
    applyViewerZoom();
  });
  function finishViewerPan(cancel = false) {
    return layoutControlsOwner.finishViewerPan(cancel);
  }
  for (const event of ['pointerup', 'lostpointercapture'])
    $('viewerStage').addEventListener(event, () => finishViewerPan());
  $('viewerStage').addEventListener('pointercancel', () => finishViewerPan(true));
  $('viewerStage').addEventListener('dblclick', e => {
    if (!viewerHit(e)) return;
    e.preventDefault();
    resetViewerZoom();
  });
  interruptions.on(() => finishViewerPan(true));
  const viewerObserver = new ResizeObserver(() => applyViewerZoom());
  viewerObserver.observe($('viewerStage'));
  function setTimelineZoom(value, anchor = state.frame, pixel = null) {
    return layoutControlsOwner.setTimelineZoom(value, anchor, pixel);
  }
  function fitTimeline() {
    return layoutControlsOwner.fitTimeline();
  }
  $('zoomOut').onclick = () => setTimelineZoom(state.zoom / 1.25);
  $('zoomIn').onclick = () => setTimelineZoom(state.zoom * 1.25);

  const resizeObserver = new ResizeObserver(() => {
    renderTimeline();
    updateViewer();
  });
  resizeObserver.observe($('timelineScroll'));
  $('editor').addEventListener('click', e => {
    if (
      e.detail &&
      e.target.closest('button') &&
      !e.target.closest('.modal,.topbar,[role=tablist]') &&
      $('modalOverlay').hidden
    )
      $('editor').focus({ preventScroll: true });
  });
  document.querySelectorAll('[role=tablist]').forEach(list =>
    list.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const tabs = [...list.querySelectorAll('[role=tab]:not(:disabled)')],
        index = tabs.indexOf(e.target),
        next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next?.click();
      next?.focus({ preventScroll: true });
    }),
  );
  for (const id of ['seek', 'zoom'])
    $(id).addEventListener('pointerup', () => $('editor').focus({ preventScroll: true }));
  $('editor').addEventListener('pointerdown', e => {
    if (!e.target.closest('button,a,input,textarea,select,[contenteditable]'))
      $('editor').focus({ preventScroll: true });
  });
  $('emptyStage').innerHTML =
    '<div class="welcome-empty"><span class="empty-symbol">' +
    svg('timeline') +
    '</span><strong>Build your first sequence</strong><p>Start with footage or a Comfy workflow.<br>Arrange clips, generate takes, and choose your edit.</p><div class="empty-actions"><button class="primary" id="emptyImport">' +
    svg('import') +
    'Import footage</button><button class="outline" id="emptyWorkflow">' +
    svg('plus') +
    'Add workflow</button></div><small>Or drop files onto the timeline</small></div><span class="gap-empty">No picture at the playhead</span>';
  $('emptyImport').onclick = () => pickImport(true);
  $('emptyWorkflow').onclick = () => pickImport(true, true);
  {
    $('editor').classList.add('full-editor');
    setBinTab('workflows');
    $('editor').append($('mediaPanel'));
    $('editor').classList.add('studio-sidebar');
    const settings = document.createElement('div');
    settings.className = 'viewer-settings';
    settings.append($('viewerZoom'));
    $('viewer').querySelector('.viewer-meta').prepend(settings, $('monitorMute'));
    document.querySelector('.tools').append(document.querySelector('.history-tools'));
  }
  const inspectorHeightKey = VIEW_KEY + ':inspector-height:full';
  let inspectorFull = true;
  try {
    inspectorFull = localStorage.getItem(inspectorHeightKey) !== 'viewer';
  } catch (error) {}
  const inspectorHeightButton = document.createElement('button');
  inspectorHeightButton.id = 'inspectorHeight';
  inspectorHeightButton.className = 'outline inspector-height';
  inspectorHeightButton.textContent = 'Full height';
  inspectorHeightButton.setAttribute('aria-label', 'Full height inspector');
  $('inspector').querySelector('.inspector-head').insertBefore(inspectorHeightButton, $('openWorkflow'));
  function applyInspectorHeight() {
    return layoutControlsOwner.applyInspectorHeight();
  }
  applyInspectorHeight();
  inspectorHeightButton.onclick = () => {
    inspectorFull = !inspectorFull;
    try {
      localStorage.setItem(inspectorHeightKey, inspectorFull ? 'full' : 'viewer');
    } catch (error) {}
    applyInspectorHeight();
    applyPanelWidths();
  };
  const panelWidths = { media: null, inspector: null };
  let panelDrag = null;
  const panelKey = name => VIEW_KEY + ':' + name + ':full';
  for (const name of Object.keys(panelWidths)) {
    try {
      const saved = Number(sessionStorage.getItem(panelKey(name)));
      if (Number.isFinite(saved) && saved > 0) panelWidths[name] = saved;
    } catch (error) {}
  }
  function panelBounds(name) {
    return layoutControlsOwner.panelBounds(name);
  }
  function applyPanelWidths() {
    return layoutControlsOwner.applyPanelWidths();
  }
  function storePanelWidth(name) {
    return layoutControlsOwner.storePanelWidth(name);
  }
  function endPanelResize(cancel = false) {
    return layoutControlsOwner.endPanelResize(cancel);
  }
  for (const name of Object.keys(panelWidths)) {
    const handle = $(name + 'Resize'),
      panel = $(name === 'media' ? 'mediaPanel' : 'inspector'),
      direction = name === 'media' ? 1 : -1;
    handle.onpointerdown = e => {
      if (e.button !== 0 || drag || trackResize) return;
      e.preventDefault();
      e.stopPropagation();
      handle.focus({ preventScroll: true });
      panelDrag = {
        name,
        x: e.clientX,
        width: panel.getBoundingClientRect().width,
        initial: panelWidths[name],
        ...panelBounds(name),
      };
      handle.setPointerCapture(e.pointerId);
      $('editor').classList.add('resizing-panels');
    };
    handle.onpointermove = e => {
      if (!panelDrag || panelDrag.name !== name) return;
      e.stopPropagation();
      panelWidths[name] = Math.round(
        clamp(panelDrag.width + (e.clientX - panelDrag.x) * direction, panelDrag.min, panelDrag.max),
      );
      applyPanelWidths();
    };
    handle.onpointerup = e => {
      e.stopPropagation();
      endPanelResize();
    };
    handle.onpointercancel = () => endPanelResize(true);
    handle.onlostpointercapture = () => endPanelResize();
    handle.ondblclick = e => {
      e.preventDefault();
      e.stopPropagation();
      panelWidths[name] = null;
      applyPanelWidths();
      storePanelWidth(name);
    };
    handle.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        endPanelResize(true);
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const bounds = panelBounds(name),
        width = panel.getBoundingClientRect().width;
      panelWidths[name] =
        e.key === 'Home'
          ? bounds.min
          : e.key === 'End'
            ? bounds.max
            : clamp(
                width + (e.key === 'ArrowRight' ? 1 : -1) * direction * (e.shiftKey ? 40 : 12),
                bounds.min,
                bounds.max,
              );
      applyPanelWidths();
      storePanelWidth(name);
    };
  }
  const panelObserver = new ResizeObserver(applyPanelWidths);
  panelObserver.observe($('workbench'));
  interruptions.on(() => endPanelResize(true));
  $('toggleMedia').addEventListener('click', applyPanelWidths);
  $('toggleInspector').addEventListener('click', applyPanelWidths);
  applyPanelWidths();

  function selectedAudio() {
    return (state.audioClips || []).find(c => c.id === state.selectedAudio);
  }
  const audioSettings = T.audioSettings;
  const trackAudible = track => T.trackAudible(state, track);
  const audioEnvelope = T.audioEnvelope;

  function renderAudioTimeline(rows, refresh = true) {
    return audioEditorOwner.renderAudioTimeline(rows, refresh);
  }
  function renderAudioInspector() {
    return audioEditorOwner.renderAudioInspector();
  }
  function selectAudio(id, modifiers = {}, preserve = false) {
    return clipSelectionOwner.selectAudio(id, modifiers, preserve);
  }
  function addAudioClip(m, start = Math.round(state.frame), track = 'music', lane = activeVideoTrack) {
    return audioEditorOwner.addAudioClip(m, start, track, lane);
  }
  function splitAudio() {
    return audioEditorOwner.splitAudio();
  }
  const trimPreviewOwner = createTrimPreview({
    $,
    copy,
    getFps: () => fps,
    getTrimPreviewTimer: () => trimPreviewTimer,
    writeTrimPreviewTimer: value => (trimPreviewTimer = value),
    held,
    getHoverTarget: () => hoverTarget,
    getSelectedCut: () => selectedCut,
    getNudgeGroup: () => nudgeGroup,
    writeNudgeGroup: value => (nudgeGroup = value),
    getTrimSingle: () => trimSingle,
    writeTrimSingle: value => (trimSingle = value),
    getState: () => state,
    getPpf: () => ppf,
    getDrag: () => drag,
    history,
    redoStack,
    selected,
    trackVariable,
    take,
    gapAfter,
    editActions,
    rowFor,
    tc,
    save,
    toast,
    setStatus,
    buttons,
    editView,
    renderTimeline,
    updateViewer,
    previewFile,
    videoTiming,
    videoSource,
    seekVideo,
    pause,
    frameStep,
    applyViewerZoom,
    selectedAudio,
    getClipGesture: () => clipGesture,
    getCursorCache: () => cursorCache,
    getAudioNeighbor: () => audioNeighbor,
    getGestureState: () => gestureState,
    writeGestureState: value => (gestureState = value),
    getGestureHintsStale: () => gestureHintsStale,
    writeGestureHintsStale: value => (gestureHintsStale = value),
    getLastTrimEdit: () => lastTrimEdit,
    writeLastTrimEdit: value => (lastTrimEdit = value),
  });
  function hideTrimPreview(keepViewer = false) {
    return trimPreviewOwner.hideTrimPreview(keepViewer);
  }

  function updateTrimPreview(d, delta) {
    return trimPreviewOwner.updateTrimPreview(d, delta);
  }
  function nudgeEdit(frames) {
    return trimPreviewOwner.nudgeEdit(frames);
  }
  // Gestures are chosen at the drag threshold; held keys never become saved tools.
  const clipGesture = (target, shift = held.shift, alt = held.alt) =>
    T.resolveGesture(state, target, { ...held, shift, alt });
  const cursorCache = {};
  function gestureCursor(a) {
    return trimPreviewOwner.gestureCursor(a);
  }
  const audioNeighbor = (c, edge) => T.audioNeighbor(state, c, edge);
  function hoverIdentity(node, edge) {
    return trimPreviewOwner.hoverIdentity(node, edge);
  }

  let gestureState = null,
    gestureHintsStale = false;
  function refreshGestureHints(all = false) {
    return trimPreviewOwner.refreshGestureHints(all);
  }
  let lastTrimEdit = null;
  function toggleTrimView() {
    return trimPreviewOwner.toggleTrimView();
  }
  function editingKey(e) {
    return trimPreviewOwner.editingKey(e);
  }
  function clearHeld() {
    return trimPreviewOwner.clearHeld();
  }
  $('trimViewButton').onclick = toggleTrimView;
  $('editor').addEventListener('keyup', e => {
    const key = editingKey(e);
    if (['s', 'd', 'shift'].includes(key)) {
      held[key] = false;
      nudgeGroup = null;
      refreshGestureHints(true);
      e.stopPropagation();
    }
    if ((key === ',' || key === '.') && !held.s && !held.d) nudgeGroup = null;
  });
  $('editor').addEventListener('focusin', e => {
    if (e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])')) clearHeld();
  });
  interruptions.on(clearHeld);
  $('timelineContent').addEventListener('pointermove', e => {
    if (drag) return;
    const n = e.target.closest('[data-clip],[data-audio],[data-linked-audio]'),
      h = e.target.closest('[data-trim],[data-audio-trim]');
    const target =
      n && !e.target.closest('[data-fade]') ? hoverIdentity(n, h?.dataset.trim || h?.dataset.audioTrim || null) : null;
    if (JSON.stringify(target) !== JSON.stringify(hoverTarget)) {
      hoverTarget = target;
      refreshGestureHints();
    }
  });
  $('timelineContent').addEventListener('pointerleave', () => {
    hoverTarget = null;
    if (!drag) refreshGestureHints();
  });

  const timelineHeightKey = VIEW_KEY + ':timeline-height:full';
  function timelineBounds() {
    return layoutControlsOwner.timelineBounds();
  }
  function setTimelineHeight(height) {
    return layoutControlsOwner.setTimelineHeight(height);
  }
  try {
    const height = Number(sessionStorage.getItem(timelineHeightKey));
    if (height) setTimelineHeight(height);
  } catch (error) {}
  $('timelineResize').onpointerdown = e => {
    if (e.button !== 0 || drag || panelDrag || trackResize) return;
    e.preventDefault();
    e.stopPropagation();
    timelineDrag = {
      y: e.clientY,
      height: document.querySelector('.timeline-shell').getBoundingClientRect().height,
      initial: $('editor').style.getPropertyValue('--timeline-height'),
    };
    $('timelineResize').setPointerCapture(e.pointerId);
    $('editor').classList.add('resizing-timeline');
  };
  $('timelineResize').onpointermove = e => {
    if (timelineDrag) setTimelineHeight(timelineDrag.height + timelineDrag.y - e.clientY);
  };
  function endTimelineResize(cancel = false) {
    return layoutControlsOwner.endTimelineResize(cancel);
  }
  $('timelineResize').onpointerup = () => endTimelineResize();
  $('timelineResize').onpointercancel = () => endTimelineResize(true);
  $('timelineResize').onlostpointercapture = () => endTimelineResize();
  $('timelineResize').ondblclick = () => {
    $('editor').style.removeProperty('--timeline-height');
    sessionStorage.removeItem(timelineHeightKey);
  };
  $('timelineResize').onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      endTimelineResize(true);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const b = timelineBounds(),
      height = document.querySelector('.timeline-shell').getBoundingClientRect().height;
    setTimelineHeight(
      e.key === 'Home'
        ? b.min
        : e.key === 'End'
          ? b.max
          : height + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 40 : 12),
    );
    sessionStorage.setItem(timelineHeightKey, document.querySelector('.timeline-shell').getBoundingClientRect().height);
  };
  interruptions.on(() => endTimelineResize(true));
  function endTrackResize(cancel = false) {
    return layoutControlsOwner.endTrackResize(cancel);
  }
  $('trackHeaders').addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-track-resize]');
    if (!handle || e.button !== 0 || pointerBusy()) return;
    e.preventDefault();
    e.stopPropagation();
    const key = handle.dataset.trackResize;
    trackResize = {
      key,
      y: e.clientY,
      height: preferredTrackHeight(key),
      fit: trackFit,
      initial: trackHeights[key],
      pointerId: e.pointerId,
      handle,
    };
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(e.pointerId);
    $('editor').classList.add('resizing-track');
  });
  window.addEventListener('pointermove', e => {
    if (!trackResize || e.pointerId !== trackResize.pointerId) return;
    const b = trackHeightBounds(trackResize.key);
    // A fitted track follows the pointer: its set height changes by the drag at full size.
    trackHeights[trackResize.key] = Math.round(
      clamp(trackResize.height + (e.clientY - trackResize.y) / trackResize.fit, b.min, b.max),
    );
    applyTrackHeights();
  });
  window.addEventListener('pointerup', e => {
    if (e.pointerId === trackResize?.pointerId) endTrackResize();
  });
  window.addEventListener('pointercancel', e => {
    if (e.pointerId === trackResize?.pointerId) endTrackResize(true);
  });
  $('trackHeaders').addEventListener('lostpointercapture', () => endTrackResize(true));
  $('trackHeaders').addEventListener('dblclick', e => {
    const handle = e.target.closest('[data-track-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    delete trackHeights[handle.dataset.trackResize];
    applyTrackHeights();
    storeTrackHeights();
  });
  $('trackHeaders').addEventListener('keydown', e => {
    const handle = e.target.closest('[data-track-resize]');
    if (!handle) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      endTrackResize(true);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const key = handle.dataset.trackResize,
      b = trackHeightBounds(key);
    trackHeights[key] =
      e.key === 'Home'
        ? b.min
        : e.key === 'End'
          ? b.max
          : clamp(preferredTrackHeight(key) + (e.key === 'ArrowDown' ? 1 : -1) * (e.shiftKey ? 32 : 8), b.min, b.max);
    applyTrackHeights();
    storeTrackHeights();
  });
  document.querySelector('.track-labels').addEventListener(
    'wheel',
    e => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      $('timelineScroll').scrollTop += e.deltaY;
    },
    { passive: false },
  );
  interruptions.on(() => endTrackResize(true));
  $('timelineScroll').addEventListener(
    'wheel',
    e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const sc = $('timelineScroll'),
        x = e.clientX - sc.getBoundingClientRect().left;
      setTimelineZoom(state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), (x + sc.scrollLeft) / ppf, x);
    },
    { passive: false },
  );

  // Recover a paused retained decoder only when a changed seek makes no frame progress.
  const nativeVideoSeekGuard = createVideoSeekGuard(
    v =>
      !v.hidden &&
      ((v === viewer.shownVideo && v.classList.contains('front')) ||
        (!$('takeCompare').hidden && comparisonVideos().includes(v))),
    () => viewer.playing,
  );
  const nativeRecipes = { ...BOOT.recipes },
    linkedSidecarHashes = new Map();
  let bridgeId = params.get('bridge'),
    bridge = bridgeId ? B.openChannel(bridgeId) : null,
    bridgeClient = bridge ? B.createClient(bridge) : null;
  let bridgeReady = null,
    stopWorkflowApply = null;
  const comfyConnectionOwner = createComfyConnection({
    getTopbar: () => topbar,
    request,
    productCapabilities,
    getProductDefinitions: () => productDefinitions,
    writeProductDefinitions: value => (productDefinitions = value),
    projectKey,
    getState: () => state,
    selected,
    getBridgeId: () => bridgeId,
    writeBridgeId: value => (bridgeId = value),
    getBridge: () => bridge,
    writeBridge: value => (bridge = value),
    getBridgeClient: () => bridgeClient,
    writeBridgeClient: value => (bridgeClient = value),
    getBridgeReady: () => bridgeReady,
    writeBridgeReady: value => (bridgeReady = value),
    getStopWorkflowApply: () => stopWorkflowApply,
    writeStopWorkflowApply: value => (stopWorkflowApply = value),
    getProjectEdit: () => projectEdit,
    flushNative,
    getFocusViewId: () => focusViewId,
    getComfyConnection: () => comfyConnection,
    writeComfyConnection: value => (comfyConnection = value),
    updateClipInputs,
  });
  function listenForWorkflowApply() {
    return comfyConnectionOwner.listenForWorkflowApply();
  }
  listenForWorkflowApply();
  if (bridgeClient) {
    const initial = bridgeClient;
    void initial
      .call(B.ACTIONS.ping, {}, { timeoutMs: 900 })
      .then(live => {
        if (bridgeClient === initial) bridgeReady = !!live.connected && !!live.workflowLinks;
      })
      .catch(error => {
        if (error.code === 'bridge_outdated') toast(error.message);
        if (bridgeClient === initial) bridgeReady = false;
      });
  }

  function host(action, values = {}, preparedTab = null) {
    return comfyConnectionOwner.host(action, values, preparedTab);
  }
  function withBridge(url) {
    return comfyConnectionOwner.withBridge(url);
  }
  const nativeDocument = () => L.authored(projectData());
  const exactInt = W.isExactInt,
    isInt = W.isIntegerValue,
    decimal = W.exactDecimal;
  function applyNativeProject(project, replace) {
    if (JSON.stringify(project.document.deletedTakeIds || []) !== JSON.stringify(state.deletedTakeIds || [])) {
      history.clear();
      thumbnails.stopScrub();
      pause();
      editView();
      review.clear();
      saveHistory();
    }
    Object.assign(nativeRecipes, project.recipes);
    if (replace) receiveProject(project.document);
    else {
      L.mergeArrivals(state, project.document);
      renderTakes();
      renderClipAttention();
      queueLabel();
      renderJobStatus();
      if ($('queueList')) renderQueueList();
    }
  }
  function showConflict() {
    return projectDialogsOwner.showConflict();
  }
  const projectEdit = createProjectEdit({
    project: BOOT,
    document: nativeDocument,
    apply: applyNativeProject,
    progress: jobs => {
      state.jobs = jobs;
      timelineRenderer.renderProgress();
      renderPendingTakes(selected());
      queueLabel();
      renderJobStatus();
      if ($('queueList')) renderQueueList();
    },
    request,
    blocked: operation =>
      isFailed() ||
      !!exportRangeDrag ||
      (operation === 'save' ? drag && drag.kind !== 'scrub' : !!drag) ||
      (operation === 'replace' ? nativeEditingField() : operation === 'navigation' ? !$('modalOverlay').hidden : false),
    notify: status => {
      latestSaveStatus = status;
      if (topbar) topbar.save(status);
      else $('saveStatus').textContent = status.kind === 'saving' ? 'Saving…' : 'Opening project…';
      if (status.kind === 'conflict' && status.error) showConflict();
      else if (status.kind === 'error') toast(status.message);
      else if (status.kind === 'connection') setStatus('Project connection: ' + status.message);
    },
  });
  async function flushNative() {
    saveView();
    saveHistory();
    await projectEdit.flush();
  }
  async function saveProjectNow(manual = true) {
    if (isFailed() || drag) {
      if (manual) toast('Finish the current gesture before saving.');
      return;
    }
    // Blur commits native change handlers, including text still being edited.
    const field = document.activeElement;
    if (
      $('editor').contains(field) &&
      !field.closest('.modal-overlay') &&
      field.matches('input:not([type=file]):not([type=checkbox]),textarea,select')
    ) {
      const id = field.id,
        start = field.selectionStart,
        end = field.selectionEnd;
      field.blur();
      const current = field.isConnected ? field : $(id);
      current?.focus({ preventScroll: true });
      if (start !== null && current?.setSelectionRange && current.type !== 'number')
        current.setSelectionRange(start, end);
    }
    try {
      await flushNative();
      if (manual) toast('Project saved');
    } catch (error) {
      if (manual) toast(error.message);
    }
  }
  function saveShortcut(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!workflowLocked && e.type === 'keydown' && !e.repeat) saveProjectNow();
    }
  }
  window.addEventListener('keydown', saveShortcut, true);
  window.addEventListener('keyup', saveShortcut, true);
  // Only edits and view history use browser storage; durable queue/result state is polled from SQLite.
  const nativeEditingField = () =>
    document.activeElement?.matches('input:not([type=range]):not([type=checkbox]):not([type=file]),textarea,select');
  let nativePolling = null;
  const focusViewId = crypto.randomUUID();
  let focusPoll = 0;
  const editorVisible = () =>
    !document.hidden && (!window.frameElement || window.frameElement.getClientRects().length > 0);
  const socketUrl = new URL('/ws', location.href);
  socketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const projectSync = createProjectSync({
    enabled: productCapabilities.projectUpdates === true,
    projectId: projectKey,
    url: socketUrl.href,
    refresh: () => {
      if (editorVisible() && !viewer.playing) pollNative(true);
    },
  });
  function pollNative(automatic = false) {
    if (nativePolling) return automatic ? nativePolling : nativePolling.then(() => pollNative());
    if (automatic && !editorVisible()) return Promise.resolve();
    nativePolling = pollProject(automatic).finally(() => {
      nativePolling = null;
    });
    return nativePolling;
  }
  async function pollProject(automatic) {
    const active = visibleJobs().some(j => !G.TERMINAL.includes(j.status));
    if (!automatic || (!viewer.playing && projectSync.due(active))) {
      const seen = projectSync.mark();
      projectSync.didPoll(await projectEdit.poll(), seen);
    }
    // Agent focus expires after 15 seconds; a small heartbeat keeps it current.
    if (Date.now() - focusPoll >= 10000 && editorVisible()) {
      focusPoll = Date.now();
      await request('projects/' + projectKey + '/focus/' + focusViewId, {
        clipId: state.selected,
        takeId: review.source?.takeId || selected()?.takeId,
        playhead: state.frame,
        mode: 'editor',
      }).catch(() => {});
    }
  }
  const connectionButton = document.createElement('button');
  connectionButton.className = 'outline';
  connectionButton.textContent = productCapabilities.connected
    ? 'Comfy connected'
    : productCapabilities.configuration
      ? 'Waiting for Comfy'
      : 'Pair Comfy';
  $('showQueue').before(connectionButton);
  connectionButton.id = 'comfyConnection';
  let comfyConnection = { state: productCapabilities.connected ? 'connected' : 'stopped' };
  function renderConnection() {
    return comfyConnectionOwner.renderConnection();
  }
  function connectComfy() {
    return comfyConnectionOwner.connectComfy();
  }
  function ensureComfy() {
    return comfyConnectionOwner.ensureComfy();
  }
  function comfySettings() {
    return projectDialogsOwner.comfySettings();
  }
  connectionButton.onclick = async () => {
    try {
      comfyConnection = await request('comfy');
      if (comfyConnection.state === 'stopped' && comfyConnection.settings.startupFile) {
        await ensureComfy();
        toast('Comfy connected');
      } else await comfySettings();
    } catch (error) {
      toast(error.message);
    }
  };
  const { queueClips, queueSubmission } = createQueueActions({
    storage: sessionStorage,
    retryKey: STORAGE_KEY + ':queue-request',
    getClips: () => state.clips,
    getRecipes: () => nativeRecipes,
    getCloudDefinitions: () => cloudDefinitions,
    getDefinitions: () => productDefinitions,
    isConnected: () => productCapabilities.connected,
    projectKey,
    projectEdit,
    request,
    edits,
    decimal,
    $,
    closeModal,
    queueReason,
    reviewGeneration,
    flushNative,
    toast,
    renderQueueList,
  });
  // Renders is a panel, not a modal: editing, playback and shortcuts continue while it is open.
  function closeRenders() {
    return renderQueueOwner.closeRenders();
  }
  function queueModal() {
    return renderQueueOwner.queueModal();
  }
  function visibleJobs() {
    return renderQueueOwner.visibleJobs();
  }

  $('showQueue').onclick = queueModal;
  function renderQueueList() {
    return renderQueueOwner.renderQueueList();
  }
  const rollKey = e => {
    if (workflowLocked) return;
    if (e.key !== 'Alt') return;
    if (e.type === 'keyup') {
      held.alt = false;
      refreshGestureHints(true);
      return;
    }
    if (
      !$('editor').contains(e.target) ||
      e.target.closest('input,textarea,select,[contenteditable]') ||
      !$('modalOverlay').hidden ||
      !clipMenu.hidden
    )
      return;
    held.alt = true;
    refreshGestureHints(true);
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', rollKey);
  window.addEventListener('keyup', rollKey, true);
  $('timelineScroll').addEventListener(
    'pointerdown',
    e => {
      held.alt = e.altKey;
    },
    true,
  );
  const rollPointer = e => {
    if (drag?.kind === 'pending' && held.alt !== e.altKey) {
      held.alt = e.altKey;
      refreshGestureHints(true);
    }
  };
  window.addEventListener('pointermove', rollPointer, true);
  window.addEventListener('pagehide', () => {
    window.removeEventListener('keydown', rollKey);
    window.removeEventListener('keyup', rollKey, true);
    window.removeEventListener('pointermove', rollPointer, true);
  });
  $('gestureHelp').onclick = async () => {
    const { shortcutSheet } = await import('/spool/ui/shortcuts.js');
    showModal('Keyboard shortcuts', shortcutSheet());
    $('modal').classList.add('shortcut-dialog');
  };
  const experimentRetryKey = STORAGE_KEY + ':experiment-request';
  let experimentRetry = null;
  try {
    experimentRetry = JSON.parse(sessionStorage.getItem(experimentRetryKey) || 'null');
  } catch (error) {}

  function generationSourceLabel(setting) {
    return renderQueueOwner.generationSourceLabel(setting);
  }
  function reviewGeneration(clips) {
    return renderQueueOwner.reviewGeneration(clips);
  }
  function renderJobStatus() {
    return renderQueueOwner.renderJobStatus();
  }
  function submitExperiment(data) {
    return renderQueueOwner.submitExperiment(data);
  }
  function showActivity() {
    return projectDialogsOwner.showActivity();
  }
  function queueReason(c) {
    return renderQueueOwner.queueReason(c);
  }

  const workflowControlsOwner = createWorkflowControls({
    $,
    copy,
    esc,
    svg,
    request,
    getProductDefinitions: () => productDefinitions,
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
    getImagePreviewTicket: () => imagePreviewTicket,
    writeImagePreviewTicket: value => (imagePreviewTicket = value),
    getReplaceInputImage: () => replaceInputImage,
    clipWorkflowLink,
  });
  function bindWorkflowControls(c, bindings) {
    return workflowControlsOwner.bindWorkflowControls(c, bindings);
  }
  // Media inputs are compact rows: a thumbnail, the label and chosen file, then their actions.

  function controlField(b, i, c) {
    return workflowControlsOwner.controlField(b, i, c);
  }
  let imagePreviewTicket = 0;
  function bindImageInputs(c) {
    return workflowControlsOwner.bindImageInputs(c);
  }
  const { useTimelineVideo, clearInput, replaceInputMedia, replaceInputImage } = createInputActions({
    getClips: () => state.clips,
    inputReplacements,
    take,
    edits,
    $,
    api,
    projectKey,
    flushNative,
    toast,
  });
  const countLabel = document.createElement('label');
  countLabel.className = 'native-count';
  countLabel.innerHTML =
    'Takes <input id="nativeCount" aria-label="Number of takes" type="number" min="1" max="16" value="1">';
  $('generate').before(countLabel);
  const jobStatus = document.createElement('span');
  jobStatus.className = 'native-job-status';
  $('generate').after(jobStatus);
  // Media evidence — the probe and the workflow Comfy embedded in a render — lives
  // outside the working document and is stored once per media id. The projection
  // keeps `media.evidence`, a list naming what exists, so enablement stays
  // synchronous; only the payload is fetched, and only when a surface opens it.
  const evidenceCache = new Map();
  const workflowDialogsOwner = createWorkflowDialogs({
    $,
    copy,
    esc,
    api,
    request,
    matchClipInputs,
    inputReplacements,
    getProductDefinitions: () => productDefinitions,
    definitionsFor,
    projectKey,
    getFps: () => fps,
    workflows,
    reusableBinding,
    registerWorkflowData,
    addImportedWorkflowClip,
    applyPreparedWorkflow,
    getState: () => state,
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
    getBridgeClient: () => bridgeClient,
    getBridgeReady: () => bridgeReady,
    host,
    exactInt,
    isInt,
    decimal,
    projectEdit,
    flushNative,
    focusViewId,
    evidenceCache,
    getWorkflowSetup: () => workflowSetup,
  });

  function mediaWorkflowData(m) {
    return workflowDialogsOwner.mediaWorkflowData(m);
  }
  // A take's editable graph may be a saved recipe, a snapshot frozen in the document,
  // or evidence embedded in the render. Answer whether one exists without fetching it.
  function editableGraph(c) {
    return workflowDialogsOwner.editableGraph(c);
  }

  function clipWorkflowLink(c) {
    return workflowDialogsOwner.clipWorkflowLink(c);
  }
  function openNativeWorkflow() {
    return workflowDialogsOwner.openNativeWorkflow();
  }
  function paintWorkflowSetup(question) {
    return workflowDialogsOwner.paintWorkflowSetup(question);
  }
  function saveWorkflowSetup({ session, capture, name, clipId, index, mode, keep, exact, automatic }) {
    return workflowDialogsOwner.saveWorkflowSetup({
      session: session,
      capture: capture,
      name: name,
      clipId: clipId,
      index: index,
      mode: mode,
      keep: keep,
      exact: exact,
      automatic: automatic,
    });
  }
  const workflowSetup = createWorkflowSetup({
    edit: projectEdit,
    flush: flushNative,
    clip: id => state.clips.find(c => c.id === id),
    save: saveWorkflowSetup,
    dialog: {
      show: paintWorkflowSetup,
      close: closeModal,
      error: error => toast(error.message),
      lock() {
        // Keep library navigation available while the committed capture owns the edit.
        const editor = $('editor'),
          panel = $('mediaPanel'),
          before = workflowLocked,
          focused = document.activeElement;
        const targets = [...editor.children]
          .filter(node => node !== panel)
          .concat(
            [...panel.children].filter(node => !node.classList.contains('panel-head')),
            $('importTop'),
          );
        const inert = targets.map(node => [node, node.inert]);
        workflowLocked = true;
        clearHeld();
        for (const [node] of inert) node.inert = true;
        return () => {
          for (const [node, value] of inert) node.inert = value;
          workflowLocked = before;
          if (document.activeElement === document.body)
            (focused?.isConnected && focused.getClientRects().length ? focused : editor).focus({ preventScroll: true });
        };
      },
    },
  });
  function configureCapture(origin, initial = null) {
    return workflowDialogsOwner.configureCapture(origin, initial);
  }

  function importWorkflowFile(file) {
    return workflowDialogsOwner.importWorkflowFile(file);
  }
  function reset() {
    return projectDialogsOwner.reset();
  }
  function openProjectFolder() {
    return projectDialogsOwner.openProjectFolder();
  }

  $('reset').title = 'New project';
  $('reset').textContent = 'New project';
  $('reset').onclick = reset;

  function downloadValue(value, suffix = '') {
    return projectDialogsOwner.downloadValue(value, suffix);
  }

  $('projectFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const project = await api.call('import-project', {
        method: 'POST',
        body: await file.text(),
        json: false,
        headers: { 'Content-Type': 'application/json' },
      });
      location.href = withBridge('/spool/?project=' + project.id);
    } catch (error) {
      toast(error.message);
    }
    e.target.value = '';
  };
  function captureInputs(capture, name, index = state.clips.length, clipId = null, automatic = false) {
    return workflowDialogsOwner.captureInputs(capture, name, index, clipId, automatic);
  }

  function prepareWorkflow(capture, name, index = state.clips.length, clipId = null) {
    return workflowDialogsOwner.prepareWorkflow(capture, name, index, clipId);
  }
  function updateClipInputs(id, expected = null) {
    return workflowDialogsOwner.updateClipInputs(id, expected);
  }
  function addNativeGraph(capture, name = capture.name || 'Current workflow', index = state.clips.length) {
    return workflowDialogsOwner.addNativeGraph(capture, name, index);
  }
  const actionMenu = createActionMenu({ $, esc, menuParent: () => (viewerExpanded ? $('viewer') : document.body) });
  const { clipMenu, closeClipMenu, showActionMenu, placeMenu } = actionMenu;

  function toggleSelectedEnabled() {
    return clipToolsOwner.toggleSelectedEnabled();
  }
  function enableAction() {
    return clipToolsOwner.enableAction();
  }
  $('addVideoTrack').onclick = () =>
    edits.apply('Add video track', () => {
      activeVideoTrack = T.addVideoTrack(state);
    });
  $('timelineScroll').addEventListener('scroll', () => {
    $('trackHeaders').style.transform = 'translateY(-' + $('timelineScroll').scrollTop + 'px)';
  });
  function selectionActions() {
    return clipToolsOwner.selectionActions();
  }
  function openClipMenu(id, x, y, origin, inspector = false) {
    return clipToolsOwner.openClipMenu(id, x, y, origin, inspector);
  }
  function showViewerMenu(picture, x, y) {
    return clipToolsOwner.showViewerMenu(picture, x, y);
  }
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!e.target.closest('#viewer,#timelineScroll')) closeClipMenu(false);
  });
  // Older hosts report no file manager name; they could only reveal in Explorer.
  const revealLabel = () =>
    productCapabilities.fileManager === 'file manager'
      ? 'Show in folder'
      : 'Reveal in ' + (productCapabilities.fileManager || 'Explorer');
  $('takeList').addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    const card = e.target.closest('[data-take]'),
      c = selected(),
      take = card && T.realTakes(c).find(t => t.id === card.dataset.take);
    if (!take) {
      closeClipMenu(false);
      return;
    }
    const path =
      'projects/' +
      encodeURIComponent(projectKey) +
      '/take-file/' +
      encodeURIComponent(c.id) +
      '/' +
      encodeURIComponent(take.id);
    showActionMenu(
      'Take file actions',
      [
        {
          label: revealLabel(),
          run: async () => {
            try {
              await request(path + '/reveal', {});
            } catch (error) {
              toast(error.message);
            }
          },
        },
        {
          label: 'Download',
          run: () => {
            const a = document.createElement('a');
            a.href = '/spool/api/' + path;
            a.download = '';
            document.body.append(a);
            a.click();
            a.remove();
          },
        },
      ],
      e.clientX,
      e.clientY,
      card,
    );
    clipMenu.classList.add('take-file-menu');
    placeMenu(e.clientX, e.clientY);
  });
  $('modalOverlay').addEventListener('contextmenu', e => e.preventDefault());
  $('viewer').addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    pause();
    const pane = e.target.closest('.compare-pane');
    if (pane) selectComparisonPane(Number(pane.id.replace('comparePane', '')));
    showViewerMenu(viewerData(), e.clientX, e.clientY);
  });
  $('trackHeaders').addEventListener('contextmenu', e => {
    const header = e.target.closest('.track-label'),
      key = header?.querySelector('[data-track-resize]')?.dataset.trackResize;
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const [kind, number] = key.split(':'),
      label = kind === 'video' ? 'V' + number : kind === 'source' ? 'A1 / V' + number : 'A2';
    showActionMenu(
      label + ' track',
      [
        {
          label: 'Delete track',
          reason: kind === 'video' && T.videoTracks(state) === 1 ? 'Keep at least one video track' : null,
          run: () => {
            pause();
            edits.apply('Delete ' + label + ' track', () => {
              T.removeTrack(state, key);
              setTimelineSelection(selectionIds());
              state.frame = clamp(state.frame, 0, total());
            });
            toast(label + ' track deleted. Undo restores it.');
          },
        },
      ],
      e.clientX,
      e.clientY,
      header,
    );
  });
  $('timelineScroll').addEventListener('contextmenu', e => {
    if (e.target.closest('input,textarea,[contenteditable]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target.closest('#ruler')) {
      closeClipMenu(false);
      return;
    }
    const clip = e.target.closest('[data-clip],[data-linked-audio]'),
      audio = e.target.closest('[data-audio]');
    if (clip) openClipMenu(clip.dataset.clip || clip.dataset.linkedAudio, e.clientX, e.clientY, clip);
    else if (audio) {
      selectAudio(audio.dataset.audio, {}, true);
      showActionMenu(
        selectionIds().length > 1 ? 'Selection actions' : 'Audio clip actions',
        selectionIds().length > 1
          ? selectionActions()
          : [
              enableAction(),
              { label: 'Split at playhead', run: splitAudio },
              { label: 'Delete', run: () => remove(false) },
            ],
        e.clientX,
        e.clientY,
        audio,
      );
    } else
      showActionMenu(
        'Timeline actions',
        [{ label: 'Paste image to timeline', run: () => pasteClipboardImage('timeline') }],
        e.clientX,
        e.clientY,
        $('editor'),
      );
  });
  $('mediaPanel').addEventListener('contextmenu', e => {
    const card = e.target.closest('[data-media]');
    if (textPasteTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (
      !card &&
      (binTab !== 'media' || e.target.closest('button,[role=separator],.panel-head,.pool-toolbar,.workflow-library'))
    ) {
      closeClipMenu(false);
      return;
    }
    const m = card && projectMedia().find(m => m.id === card.dataset.media);
    if (card && !m) {
      closeClipMenu(false);
      return;
    }
    const actions = m
      ? [
          { label: 'Remove from media pool', run: () => removeMedia(m.id) },
          { label: 'Add to timeline', run: () => addMediaClip(m.id) },
          ...(m.audio ? [{ label: 'Use audio only', run: () => addAudioClip(m) }] : []),
        ]
      : [{ label: 'Paste image to media pool', run: () => pasteClipboardImage('media') }];
    showActionMenu('Media actions', actions, e.clientX, e.clientY, card || $('editor'));
  });
  const workflowTabDrag = B.WORKFLOW_TAB_TYPE;
  $('timelineScroll').addEventListener(
    'dragover',
    e => {
      if ([...e.dataTransfer.types].includes(workflowTabDrag)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    true,
  );
  $('timelineScroll').addEventListener(
    'drop',
    async e => {
      if (![...e.dataTransfer.types].includes(workflowTabDrag)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      activeVideoTrack = trackAt(e);
      state.frame = Math.max(0, Math.round(timelineFrame(e)));
      try {
        const ref = JSON.parse(e.dataTransfer.getData(workflowTabDrag)),
          frame = timelineFrame(e),
          index = T.dropIndex(state, frame);
        if (typeof ref.token !== 'string' || typeof ref.path !== 'string')
          throw Error('Invalid workflow tab reference');
        const capture = await host(B.ACTIONS.workflowDrop, { token: ref.token, path: ref.path });
        await addNativeGraph(capture, capture.name, index);
      } catch (error) {
        toast(error.message);
      }
    },
    true,
  );
  const addGraphButton = document.createElement('button');
  addGraphButton.id = 'nativeAddGraph';
  addGraphButton.className = 'outline';
  addGraphButton.textContent = 'Add current graph';
  $('showQueue').parentElement.insertBefore(addGraphButton, $('showQueue'));
  addGraphButton.onclick = async () => {
    try {
      await addNativeGraph(await host(B.ACTIONS.capture));
    } catch (error) {
      toast(error.message);
    }
  };
  function showProjects() {
    return projectDialogsOwner.showProjects();
  }
  $('openWorkflow').textContent = '⋯';
  $('openWorkflow').setAttribute('aria-label', 'Clip actions');
  $('openWorkflow').title = 'Clip actions';
  $('openWorkflow').onclick = e => {
    const c = selected();
    if (c) {
      const rect = e.currentTarget.getBoundingClientRect();
      openClipMenu(c.id, rect.left, rect.bottom, e.currentTarget, true);
    }
  };

  const nativeApi = {
    projectKey,
    diagnostics: () => diagnostics.snapshot(),
    get dialogRoot() {
      return document;
    },
    get videoSeek() {
      return nativeVideoSeekGuard.status(viewer.shownVideo);
    },
    get revision() {
      return projectEdit.revision;
    },
    get state() {
      return state;
    },
    get laneDraws() {
      return laneDraws;
    },
    get laneNodes() {
      return timelineRenderer.laneNodes;
    },
    flush: flushNative,
    poll: pollNative,
    host,
    editWorkflow: openNativeWorkflow,
    applyWorkflow: updateClipInputs,
    configureCapture,
    queueClips,
    selectClip,
    undo,
    redo,
    setFrame,
    duplicate,
    split,
    chooseTake,
    viewTake,
    get dirty() {
      return projectEdit.dirty;
    },
    get drag() {
      return drag;
    },
    get view() {
      return viewState();
    },
  };

  if (params.has('clip') && state.clips.some(c => c.id === params.get('clip')))
    setTimelineSelection([params.get('clip')]);
  if (params.has('frame') && Number.isFinite(Number(params.get('frame'))))
    state.frame = clamp(Number(params.get('frame')), 0, total());
  if (params.has('clip') || params.has('frame')) {
    const address = new URL(location.href);
    address.searchParams.delete('clip');
    address.searchParams.delete('frame');
    window.history.replaceState(null, '', address);
  }
  if (
    (state.selected && !state.clips.some(c => c.id === state.selected)) ||
    (!Array.isArray(state.selection) && !state.selectedAudio && !state.selected)
  )
    state.selected = state.clips[0]?.id || null;
  state.frame = clamp(state.frame, 0, total());

  try {
    const saved = sessionStorage.getItem(VIEW_KEY + ':history'),
      parsed = saved ? JSON.parse(saved) : null;
    if (parsed?.project && editingSignature(JSON.parse(parsed.project)) === editingSignature(projectData()))
      history.load(saved);
  } catch (error) {}
  const { createTopbar } = await import('/spool/ui/topbar.js');
  const { createWorkflowLibrary } = await import('/spool/ui/workflow-library.js');
  workflowLibrary = createWorkflowLibrary({
    root: $('editor'),
    templates: () =>
      api.call('templates').catch(() => {
        throw Error('Studio templates unavailable. Restart Comfy to load the updated extension.');
      }),
    projectWorkflows: () => workflows,
    selectedWorkflow: () => selected()?.workflow,
    onProject: addLibraryShot,
    onBuiltin: addBuiltinShot,
    onSettings: comfySettings,
    hasApiKey: () => !!productCapabilities.hasApiKey,
    cloudReady: () => productCapabilities.cloudExecution !== false,
    onTemplates: browseComfyTemplates,
    onCurrent: async () => {
      try {
        await addNativeGraph(await host(B.ACTIONS.capture));
      } catch (error) {
        toast(error.message);
      }
    },
    onImport: () => pickImport(false, true),
    revealMedia() {
      setBinTab('workflows');
      if (innerWidth <= 1100) $('mediaPanel').classList.add('open');
      else $('workbench').classList.remove('hide-media');
    },
  });
  topbar = createTopbar($('editor'), {
    projects: showProjects,
    settings: projectSettings,
    activity: showActivity,
    connection: () => connectionButton.click(),
    workflows: () => workflowLibrary.toggle(),
    save: saveProjectNow,
    sync: () => pollNative(),
    conflict: showConflict,
  });
  topbar.save(latestSaveStatus);
  renderConnection();
  if (builtinCatalog.unavailable)
    toast('Built-in workflows could not load. Reload Spool to try again; your projects and own workflows still work.');
  const setupIssues = productCapabilities.requirements?.missing || [];
  if (setupIssues.length) {
    const setup = document.createElement('button');
    setup.id = 'setupWarning';
    setup.type = 'button';
    setup.className = 'setup-warning';
    setup.textContent = 'Setup needed';
    setup.title = setupIssues.join('\n');
    setup.onclick = () =>
      showModal(
        'Finish setting up Spool',
        '<ul class="setup-issues">' +
          setupIssues.map(issue => '<li>' + esc(issue) + '</li>').join('') +
          '</ul><p class="small">Restart ComfyUI after installing, then reload Spool.</p>',
      );
    $('workspaceMenu').before(setup);
  }
  icons();
  render();
  save();
  if (isFailed()) throw Error('Initialization cancelled');
  const generationClock = setInterval(() => {
    if (!editorVisible()) return;
    renderJobStatus();
    for (const el of document.querySelectorAll('[data-job-elapsed]')) {
      const job = state.jobs.find(j => j.id === el.dataset.jobElapsed);
      if (job) el.textContent = G.jobElapsed(job);
    }
  }, 1000);
  const pollTimer = setInterval(() => pollNative(true), 1200),
    saveTimer = setInterval(() => saveProjectNow(false), 60000);
  const resumeSync = () => {
    if (editorVisible() && !viewer.playing) pollNative();
  };
  projectSync.start();
  window.addEventListener('focus', resumeSync);
  document.addEventListener('visibilitychange', resumeSync);
  request('comfy')
    .then(value => {
      if (isFailed()) return;
      comfyConnection = value;
      renderConnection();
      if (value.settings.autoStart && value.state === 'stopped') ensureComfy().catch(error => toast(error.message));
    })
    .catch(() => {});
  window.addEventListener('pagehide', () => {
    builtinPreparer.dispose();
    templateBrowser?.dispose();
    clearInterval(diagnosticsTimer);
    clearInterval(pollTimer);
    projectSync.dispose();
    clearInterval(saveTimer);
    clearInterval(generationClock);
    clearTimeout(viewSaveTimer);
    inspectorNotes.dispose();
    window.removeEventListener('storage', seenStorage);
    persistView();
    resizeObserver.disconnect();
    panelObserver.disconnect();
    viewerObserver.disconnect();
    pause();
    window.removeEventListener('focus', resumeSync);
    document.removeEventListener('visibilitychange', resumeSync);
    interruptions.dispose();
    window.removeEventListener('keydown', saveShortcut, true);
    window.removeEventListener('keyup', saveShortcut, true);
    stopWorkflowApply?.();
    bridgeClient?.close();
  });
  return nativeApi;
}
