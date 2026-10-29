import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createClipSelection({
  $,
  getInspectorTab,
  writeInspectorTab,
  getSelectedCut,
  writeSelectedCut,
  getNudgeGroup,
  writeNudgeGroup,
  getState,
  review,
  getSelectionAnchor,
  writeSelectionAnchor,
  getActiveVideoTrack,
  writeActiveVideoTrack,
  getSelectedVideos,
  getRowFor,
  buttons,
  getRenderBin,
  getRenderInspector,
  editView,
  getRenderTimeline,
  getUpdateViewer,
  getPause,
  saveView,
  selectedAudio,
  hideTrimPreview,
  queueReason,
}) {
  function selectionIds() {
    const available = new Set([...getState().clips, ...(getState().audioClips || [])].map(c => c.id));
    if (getState().selectedAudio && !available.has(getState().selectedAudio)) getState().selectedAudio = null;
    const active = getState().selectedAudio || getState().selected;
    if (!Array.isArray(getState().selection) || (active && !getState().selection.includes(active)))
      getState().selection = active && available.has(active) ? [active] : [];
    getState().selection = getState().selection.filter(id => available.has(id));
    return getState().selection;
  }
  function setTimelineSelection(ids, primary = ids.at(-1)) {
    const available = new Set([...getState().clips, ...(getState().audioClips || [])].map(c => c.id));
    getState().selection = [...new Set(ids)].filter(id => available.has(id));
    if (!getState().selection.includes(primary)) primary = getState().selection.at(-1);
    const audio = (getState().audioClips || []).find(c => c.id === primary);
    getState().selectedAudio = audio?.id || null;
    if (!audio) getState().selected = primary || null;
  }
  function selectTimelineItem(id, modifiers = {}, preserve = false) {
    const current = selectionIds().slice(),
      toggle = modifiers?.ctrlKey || modifiers?.metaKey;
    if (modifiers?.shiftKey) {
      const audio = (getState().audioClips || []).find(c => c.id === id),
        lane = audio
          ? (getState().audioClips || [])
              .filter(
                c =>
                  T.audioTrack(c) === T.audioTrack(audio) &&
                  (T.audioTrack(c) !== 'source' || T.sourceLane(c) === T.sourceLane(audio)),
              )
              .sort((a, b) => a.start - b.start)
          : T.trackClips(getState(), T.videoTrack(getState().clips.find(c => c.id === id)));
      const a = lane.findIndex(c => c.id === (getSelectionAnchor() || getState().selectedAudio || getState().selected)),
        b = lane.findIndex(c => c.id === id),
        range = a < 0 ? [id] : lane.slice(Math.min(a, b), Math.max(a, b) + 1).map(c => c.id);
      setTimelineSelection(toggle ? [...current, ...range] : range, id);
    } else if (toggle) {
      setTimelineSelection(current.includes(id) ? current.filter(x => x !== id) : [...current, id], id);
      writeSelectionAnchor(id);
    } else {
      setTimelineSelection(preserve && current.includes(id) ? current : [id], id);
      if (!preserve || !current.includes(id) || !getSelectionAnchor()) writeSelectionAnchor(id);
    }
  }
  function selectionQueueReason() {
    const clips = getSelectedVideos()();
    return !clips.length ? 'Select a video clip.' : clips.map(queueReason).find(Boolean) || null;
  }
  function selectClip(id, seekTo = false, modifiers = {}, preserve = false) {
    const clip = getState().clips.find(c => c.id === id);
    if (clip) writeActiveVideoTrack(T.videoTrack(clip));
    writeSelectedCut(null);
    writeNudgeGroup(null);
    hideTrimPreview();
    getPause()();
    editView();
    selectTimelineItem(id, modifiers, preserve);
    if (seekTo) {
      const row = getRowFor()(id);
      if (row) getState().frame = row.start;
    }
    getRenderBin()();
    getRenderInspector()();
    getRenderTimeline()();
    getUpdateViewer()(true);
    buttons();
    $('editor').focus({ preventScroll: true });
    saveView();
  }
  function selectAudio(id, modifiers = {}, preserve = false) {
    hideTrimPreview();
    writeSelectedCut(null);
    writeNudgeGroup(null);
    getPause()();
    editView();
    selectTimelineItem(id, modifiers, preserve);
    const c = selectedAudio();
    if (c) {
      review.rememberMedia(c.media, c.in);
      writeInspectorTab('audio');
    }
    getRenderInspector()();
    getRenderTimeline()();
    buttons();
    $('editor').focus({ preventScroll: true });
    saveView();
  }
  return { selectionIds, setTimelineSelection, selectTimelineItem, selectionQueueReason, selectClip, selectAudio };
}
