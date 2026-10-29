import * as T from './timeline.js';
import { keyText } from './keys.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createTrimPreview({
  $,
  copy,
  getFps,
  getTrimPreviewTimer,
  writeTrimPreviewTimer,
  held,
  getHoverTarget,
  getSelectedCut,
  getNudgeGroup,
  writeNudgeGroup,
  getTrimSingle,
  writeTrimSingle,
  getState,
  getPpf,
  getDrag,
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
  getClipGesture,
  getCursorCache,
  getAudioNeighbor,
  getGestureState,
  writeGestureState,
  getGestureHintsStale,
  writeGestureHintsStale,
  getLastTrimEdit,
  writeLastTrimEdit,
}) {
  function hideTrimPreview(keepViewer = false) {
    if (!keepViewer) writeLastTrimEdit(null);
    if (!keepViewer) $('trimViewButton').hidden = true;
    clearTimeout(getTrimPreviewTimer());
    $('trimPreview').hidden = true;
    if (!keepViewer) $('editor').classList.remove('trim-active');
    for (let i = 0; i < 4; i++) $('trimVideo' + i).pause();
  }
  function setTrimFrame(index, media, frame, label) {
    const v = $('trimVideo' + index),
      img = $('trimImage' + index),
      empty = $('trimEmpty' + index);
    $('trimLabel' + index).textContent = label;
    $('trimTime' + index).textContent = media ? tc(frame) : '';
    empty.hidden = !!media;
    img.hidden = true;
    v.hidden = media?.kind !== 'video';
    if (!media) {
      v.pause();
      return;
    }
    if (media.kind === 'video') {
      const file = previewFile(media);
      if (!file) {
        v.pause();
        v.hidden = true;
        return;
      }
      if (v.dataset.file !== file) {
        v.dataset.file = file;
        videoSource(v, media);
        v.muted = true;
        v.onloadedmetadata = () => {
          seekVideo(v, v.seekTarget || 0);
          applyViewerZoom();
        };
        v.onseeked = () => {
          if (v.seekPending) {
            v.seekPending = false;
            seekVideo(v, v.seekTarget);
          }
        };
      }
      videoTiming(v, media);
      seekVideo(v, frame / getFps());
    } else {
      const file = previewFile(media);
      img.hidden = !file;
      if (file) img.src = file;
    }
  }
  function updateTrimPreview(d, delta) {
    writeLastTrimEdit({ d, delta });
    $('trimViewButton').hidden = false;
    $('trimViewButton').textContent = getTrimSingle() ? 'Compare' : 'Single';
    $('editor').classList.add('trim-active');
    if (getTrimSingle()) {
      hideTrimPreview(true);
      return;
    }
    const index = getState().clips.findIndex(c => c.id === d.id),
      c = getState().clips[index];
    if (!c) {
      hideTrimPreview();
      return;
    }
    const clips = T.trackClips(getState(), T.videoTrack(c)),
      laneIndex = clips.indexOf(c),
      prev = laneIndex > 0 && !c.gapBefore ? clips[laneIndex - 1] : null,
      next = laneIndex + 1 < clips.length && !gapAfter(index) ? clips[laneIndex + 1] : null,
      four = ['slip', 'slide'].includes(d.kind);
    $('trimPreview').hidden = false;
    $('trimGrid').classList.toggle('two', !four);
    $('trimPreviewTitle').textContent = editActions[d.mode].name + ' · ' + c.name;
    $('trimDelta').textContent = (delta >= 0 ? '+' : '') + delta + 'f';
    for (let i = 0; i < 4; i++) $('trimFrame' + i).hidden = !four && i > 1;
    if (four) {
      setTrimFrame(0, take(c).media, c.in, 'In · ' + c.name);
      setTrimFrame(1, take(c).media, c.out - 1, 'Out · ' + c.name);
      setTrimFrame(
        2,
        prev && take(prev).media,
        prev ? prev.out - 1 : 0,
        prev ? 'Previous · ' + prev.name : 'Previous · Gap',
      );
      setTrimFrame(3, next && take(next).media, next ? next.in : 0, next ? 'Next · ' + next.name : 'Next · Gap');
    } else if (d.kind === 'in') {
      setTrimFrame(
        0,
        prev && take(prev).media,
        prev ? prev.out - 1 : 0,
        prev ? 'Outgoing · ' + prev.name : 'Outgoing · Gap',
      );
      setTrimFrame(1, take(c).media, c.in, 'Incoming · ' + c.name);
    } else {
      setTrimFrame(0, take(c).media, c.out - 1, 'Outgoing · ' + c.name);
      setTrimFrame(
        1,
        next && take(next).media,
        next ? next.in : 0,
        next ? 'Incoming · ' + next.name : 'Incoming · Gap',
      );
    }
    applyViewerZoom();
  }
  function nudgeEdit(frames) {
    const audio = selectedAudio(),
      c = audio || selected();
    if (!c || (!held.s && !held.d && !getSelectedCut())) {
      writeNudgeGroup(null);
      frameStep(frames);
      return;
    }
    const target = {
        id: c.id,
        audio: !!audio,
        edge: !held.s && !held.d ? getSelectedCut()?.edge : null,
        shared: !!getSelectedCut(),
      },
      a = getClipGesture()(target, false);
    if (a.blocked) {
      toast(a.blocked);
      return;
    }
    pause();
    editView();
    const d = T.beginEdit(getState(), {
        id: c.id,
        audio: !!audio,
        kind: a.kind,
        mode: a.mode,
        edge: target.edge,
        peer: audio && target.edge ? getAudioNeighbor()(c, target.edge) : null,
        snapEnabled: getState().snap,
        snapTolerance: T.SNAP_PIXELS / getPpf(),
      }),
      before = d.before;
    if (audio) {
      d.operation = a.mode === 'roll' ? 'roll' : a.kind;
      d.edge = target.edge;
      d.peer = target.edge && copy(getAudioNeighbor()(c, target.edge));
    }
    const delta = T.applyEdit(getState(), d, frames);
    if (!delta) {
      toast('Source limit reached');
      return;
    }
    const key = c.id + ':' + a.mode + ':' + a.kind;
    if (getNudgeGroup() !== key) {
      history.record(before, editActions[a.mode].name + ' ' + c.name);
      writeNudgeGroup(key);
    } else redoStack.length = 0;
    renderTimeline();
    updateViewer(true);
    if (!audio) {
      updateTrimPreview(d, delta);
      clearTimeout(getTrimPreviewTimer());
      writeTrimPreviewTimer(setTimeout(hideTrimPreview, 1500));
    }
    save();
    buttons();
    setStatus(editActions[a.mode].name + ' ' + (delta >= 0 ? '+' : '') + delta + 'f');
  }
  function gestureCursor(a) {
    if (a.blocked) return 'not-allowed';
    if (a.kind === 'move') return a.mode === 'copy' ? 'copy' : 'grab';
    const key = a.mode + ':' + a.kind;
    if (getCursorCache()[key]) return getCursorCache()[key];
    const shape =
      a.mode === 'roll'
        ? 'M10 5v14M14 5v14M6 9l-3 3 3 3M18 9l3 3-3 3M3 12h18'
        : a.mode === 'slip'
          ? 'M4 5v14M20 5v14M8 9l-3 3 3 3M16 9l3 3-3 3M5 12h14'
          : a.mode === 'slide'
            ? 'M8 5h8v14H8zM5 9l-3 3 3 3M19 9l3 3-3 3'
            : a.kind === 'in'
              ? 'M12 4H8v16h4M16 9l-3 3 3 3'
              : 'M12 4h4v16h-4M8 9l3 3-3 3';
    const ripple = a.mode === 'ripple' ? 'M3 3h3M3 21h3M18 3h3M18 21h3' : '';
    const body = '<path d="' + shape + ripple + '"/>';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
      body +
      '</g><g fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      body +
      '</g></svg>';
    return (getCursorCache()[key] = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 12 12, ew-resize');
  }
  function hoverIdentity(node, edge) {
    const audio = !!node.dataset.audio,
      id = node.dataset.audio || node.dataset.clip || node.dataset.linkedAudio,
      c = audio ? (getState().audioClips || []).find(c => c.id === id) : getState().clips.find(c => c.id === id),
      index = getState().clips.indexOf(c);
    return {
      id,
      audio,
      edge,
      shared: !!c && !!edge && (audio ? !!getAudioNeighbor()(c, edge) : T.isSharedEdge(getState(), index, edge)),
    };
  }
  function gestureLabel(target, a) {
    return keyText(gestureText(target, a));
  }
  function gestureText(target, a) {
    if (target.edge && !target.audio && !a.blocked)
      return a.mode === 'roll'
        ? 'Roll shared cut · Both sources need spare frames'
        : a.mode === 'ripple'
          ? 'Ripple trim · Following clips move'
          : 'Drag edge to trim · Shift ripple · Alt roll shared cut';
    return a.mode === 'copy'
      ? 'Alt-drag to duplicate'
      : a.blocked || a.mode === 'move'
        ? a.blocked || 'Drag to move · Alt-drag to duplicate · Hold S to slip'
        : a.mode === 'roll'
          ? 'Drag to roll cut · Shift to ripple'
          : a.mode === 'ripple'
            ? 'Ripple ' + (a.kind === 'in' ? 'start' : 'end') + ' · video stays fixed'
            : a.mode === 'trim'
              ? 'Trim ' +
                (a.kind === 'in' ? 'start' : 'end') +
                (target.audio ? ' · video stays fixed' : ' · Shift to ripple')
              : a.mode === 'slip'
                ? 'Slip source · , / . fine-tune'
                : 'Slide between neighbors · , / . fine-tune';
  }
  function refreshGestureHints(all = false) {
    writeGestureHintsStale(false);
    const key = JSON.stringify([held, getSelectedCut()]);
    if (key !== getGestureState()) {
      writeGestureState(key);
      all = true;
    }
    for (const node of $('timelineContent').querySelectorAll('[data-clip],[data-audio],[data-linked-audio]')) {
      if (
        !all &&
        node.dataset.gesture &&
        node.dataset.clip !== getHoverTarget()?.id &&
        node.dataset.audio !== getHoverTarget()?.id &&
        node.dataset.linkedAudio !== getHoverTarget()?.id
      )
        continue;
      const t = hoverIdentity(node, null),
        a = getClipGesture()(t);
      node.dataset.gesture = a.mode;
      node.style.cursor = gestureCursor(a);
      node.title = gestureLabel(t, a);
      for (const h of node.querySelectorAll('[data-trim],[data-audio-trim]')) {
        const edge = h.dataset.trim || h.dataset.audioTrim,
          target = hoverIdentity(node, edge),
          action = getClipGesture()(target);
        h.dataset.gesture = action.mode;
        h.style.cursor = gestureCursor(action);
        h.style.width = Math.min(target.audio ? (target.shared ? 6 : 8) : 12, parseFloat(node.style.width) / 3) + 'px';
        h.title = gestureLabel(target, action);
        h.classList.toggle('shared', target.shared);
        const cut = getSelectedCut();
        let selected = false;
        if (cut && cut.audio === target.audio) {
          if (cut.id === target.id) selected = cut.edge === target.edge;
          else if (target.audio) {
            const c = (getState().audioClips || []).find(c => c.id === cut.id);
            selected = getAudioNeighbor()(c, cut.edge)?.id === target.id && cut.edge !== target.edge;
          } else {
            const i = getState().clips.findIndex(c => c.id === cut.id);
            selected = getState().clips[i + (cut.edge === 'in' ? -1 : 1)]?.id === target.id && cut.edge !== target.edge;
          }
        }
        h.classList.toggle('cut-selected', selected);
      }
    }
    const a = getHoverTarget() && getClipGesture()(getHoverTarget());
    $('gestureHint').textContent = a ? gestureLabel(getHoverTarget(), a) : 'Drag clips or edges';
    $('timelineHint').textContent = keyText(
      'Alt-drag to duplicate · Drag edge to trim · Shift ripple · Alt roll shared cut · Hold S slip · Hold D slide · N snap',
    );
    $('remove').title = 'Delete clip (Delete); Shift+Delete ripple deletes';
    document.querySelectorAll('.hover-source-handles').forEach(n => n.remove());
    if (!getDrag() && getHoverTarget() && !getHoverTarget().edge && a?.mode === 'slip' && !a.blocked) {
      const t = getHoverTarget(),
        c = t.audio
          ? (getState().audioClips || []).find(c => c.id === t.id)
          : getState().clips.find(c => c.id === t.id),
        start = t.audio ? c.start : rowFor(c.id)?.start;
      if (c && start !== undefined) {
        const outline = document.createElement('div');
        outline.className = 'source-handles hover-source-handles';
        outline.style.left = (start - c.in) * getPpf() + 'px';
        outline.style.width = (t.audio ? c.media : take(c).media).frames * getPpf() + 'px';
        const lane = t.audio ? T.sourceLane(c) : T.videoTrack(c),
          kind = t.audio ? 'source' : 'video',
          music = t.audio && T.audioTrack(c) === 'music';
        outline.style.top = music ? '0px' : 'var(' + trackVariable(kind, lane, 'top') + ')';
        outline.style.height =
          'calc(' + (music ? 'var(--music-height)' : 'var(' + trackVariable(kind, lane, 'height') + ')') + ' - 2px)';
        $(t.audio ? (T.audioTrack(c) === 'source' ? 'audioLane' : 'musicLane') : 'clipLane').append(outline);
      }
    }
  }
  function toggleTrimView() {
    writeTrimSingle(!getTrimSingle());
    if (getLastTrimEdit()) updateTrimPreview(getLastTrimEdit().d, getLastTrimEdit().delta);
    save();
  }
  function editingKey(e) {
    const key = e.key.toLowerCase();
    return e.code === 'Comma' || key === '<' ? ',' : e.code === 'Period' || key === '>' ? '.' : key;
  }
  function clearHeld() {
    held.alt = false;
    held.s = false;
    held.d = false;
    held.shift = false;
    writeNudgeGroup(null);
    refreshGestureHints(true);
  }
  return {
    hideTrimPreview,
    updateTrimPreview,
    nudgeEdit,
    gestureCursor,
    hoverIdentity,
    refreshGestureHints,
    toggleTrimView,
    editingKey,
    clearHeld,
  };
}
