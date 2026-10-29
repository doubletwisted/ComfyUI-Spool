import * as T from './timeline.js';
import * as L from './ledger.js';

// Pointer thresholds, gesture application, cancellation and release ordering.
export function createTimelinePointer({
  getFps,
  setInspectorTab,
  isTimelineResizing,
  getTimelinePan,
  setTimelinePan,
  setSelectedCut,
  setNudgeGroup,
  getState,
  setState,
  getPixelScale,
  getDrag,
  setDrag,
  setSelectionAnchor,
  setActiveTrack,
  isTrackResizing,
  isPanelDragging,
  areGestureHintsStale,
  $,
  copy,
  interruptions,
  held,
  review,
  history,
  projectData,
  trackAt,
  selectionIds,
  setTimelineSelection,
  selectTimelineItem,
  total,
  layout,
  editActions,
  rowFor,
  clamp,
  tc,
  editingSignature,
  save,
  toast,
  setStatus,
  buttons,
  preserveTakes,
  render,
  renderInspector,
  renderTakes,
  editView,
  renderTimeline,
  selectClip,
  setFrame,
  updateViewer,
  pause,
  selectedAudio,
  audioSettings,
  renderAudioTimeline,
  selectAudio,
  hideTrimPreview,
  updateTrimPreview,
  clipGesture,
  gestureCursor,
  audioNeighbor,
  refreshGestureHints,
}) {
  let pendingClipMove = null,
    clipMoveRAF = 0;
  function timelineFrame(e) {
    const rect = $('timelineScroll').getBoundingClientRect();
    return (e.clientX - rect.left + $('timelineScroll').scrollLeft) / getPixelScale();
  }
  function snapFrame(frame, ignore) {
    if (!getState().snap) return Math.round(frame);
    return T.snap(T.snapPoints(getState(), ignore), frame, T.SNAP_PIXELS / getPixelScale());
  }
  function startClipDrag(e, id) {
    if (e.button !== 0 || pointerBusy()) return;
    hideTrimPreview();
    const c = getState().clips.find(c => c.id === id),
      index = getState().clips.indexOf(c),
      edge = e.target.closest('[data-trim]')?.dataset.trim || null,
      linked = !!e.currentTarget?.dataset.linkedAudio;
    if (!edge && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      $('editor').focus({ preventScroll: true });
      selectClip(id, false, e);
      return;
    }
    const collapseSelection = !edge && selectionIds().includes(id) && selectionIds().length > 1;
    selectTimelineItem(id, {}, !edge);
    setActiveTrack(T.videoTrack(c));
    const shared = T.isSharedEdge(getState(), index, edge);
    e.preventDefault();
    $('editor').focus({ preventScroll: true });
    pause();
    editView();
    setSelectedCut(shared ? { id, edge, audio: false } : null);
    setNudgeGroup(null);
    if (linked) setInspectorTab('audio');
    const ids = selectionIds().slice();
    setDrag({
      ...T.beginEdit(getState(), {
        id,
        kind: 'pending',
        edge,
        snapEnabled: getState().snap,
        snapTolerance: T.SNAP_PIXELS / getPixelScale(),
      }),
      ids,
      group: ids.length > 1,
      collapseSelection,
      shared,
      linked,
      startX: e.clientX,
      startY: e.clientY,
      scale: getPixelScale(),
      moved: false,
      targetIndex: index,
    });
    if (getDrag().group) getDrag().snapPoints = T.snapPoints(getState(), ids);
    $('timelineScroll').setPointerCapture(e.pointerId);
    renderInspector();
    renderTimeline();
    updateViewer(true);
    buttons();
  }
  function lockClipGesture(e) {
    const d = getDrag(),
      action = clipGesture(
        { id: d.id, edge: d.edge, shared: d.shared },
        e.shiftKey || held.shift,
        e.altKey || held.alt,
      );
    if (action.blocked) {
      toast(action.blocked);
      cancelClipDrag();
      return false;
    }
    if (d.group && action.kind !== 'move') {
      setTimelineSelection([d.id]);
      d.group = false;
      renderInspector();
    }
    d.kind = action.kind;
    d.mode = action.mode;
    d.overwrite = d.kind === 'move' && d.mode !== 'copy' && d.ids.every(id => getState().clips.some(c => c.id === id));
    if (d.mode === 'copy') copyDragSelection();
    d.moved = true;
    $('editor').style.setProperty('--active-edit-cursor', gestureCursor(action));
    if (d.kind !== 'move') $('editor').classList.add('editing-clip');
    return true;
  }
  function copyDragSelection() {
    const d = getDrag();
    d.copies = {};
    for (const c of [...getState().clips, ...(getState().audioClips || [])].filter(c => d.ids.includes(c.id))) {
      const audio = (getState().audioClips || []).includes(c),
        next = copy(c);
      next.id = (audio ? 'audio-' : 'clip-') + crypto.randomUUID();
      next.name += ' copy';
      if (!audio) L.inheritLineage(c, next);
      (audio ? getState().audioClips : getState().clips).push(next);
      d.copies[c.id] = next.id;
    }
    $('editor').classList.add('copying-clip');
    d.id = d.copies[d.id];
    d.ids = Object.values(d.copies);
    d.snapPoints = T.snapPoints(d.before);
    setTimelineSelection(d.ids);
    renderInspector();
  }
  function moveSelectedGroup(e) {
    const d = getDrag(),
      rawDelta = (e.clientX - d.startX) / d.scale,
      delta = d.snapEnabled
        ? T.snapMove(d.before, d.copies ? Object.keys(d.copies) : d.ids, rawDelta, d.snapTolerance, d.snapPoints)
        : Math.round(rawDelta);
    const rect = $('clipLane').getBoundingClientRect(),
      targetTrack =
        !d.group && getState().clips.some(c => c.id === d.id) && e.clientY >= rect.top && e.clientY < rect.bottom
          ? trackAt(e)
          : undefined,
      applied = T.moveGroup(getState(), d.before, d.ids, delta, targetTrack, {
        overwrite: d.overwrite,
        copies: d.copies,
      });
    d.applied = applied;
    d.targetTrack = targetTrack;
    if (targetTrack) setActiveTrack(targetTrack);
    if (getState().clips.some(c => c.id === d.id)) getState().frame = rowFor(d.id).start;
    else getState().frame = clamp(d.before.frame, 0, total());
    renderTimeline();
    updateViewer(true);
    if (!d.ghost) {
      d.ghost = document.createElement('div');
      d.ghost.className = 'drag-ghost';
      document.body.append(d.ghost);
    }
    d.ghost.textContent =
      (d.copies ? 'Copy ' : d.overwrite ? 'Overwrite ' : 'Move ') +
      d.ids.length +
      ' ' +
      (d.ids.length === 1 ? 'clip' : 'clips') +
      ' ' +
      (applied >= 0 ? '+' : '') +
      applied +
      'f';
    d.ghost.style.left = Math.max(8, Math.min(e.clientX + 12, innerWidth - d.ghost.offsetWidth - 8)) + 'px';
    d.ghost.style.top = Math.max(8, Math.min(e.clientY - 20, innerHeight - d.ghost.offsetHeight - 8)) + 'px';
    setStatus(d.ghost.textContent + (applied !== delta ? ' - occupied track or start limit' : ''));
  }
  function moveMarquee(e) {
    const d = getDrag(),
      rect = $('timelineContent').getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top,
      left = Math.min(d.x, x),
      top = Math.min(d.y, y),
      right = Math.max(d.x, x),
      bottom = Math.max(d.y, y);
    if (!d.moved && Math.abs(x - d.x) < 4 && Math.abs(y - d.y) < 4) return;
    d.moved = true;
    d.ghost.hidden = false;
    Object.assign(d.ghost.style, {
      left: left + 'px',
      top: top + 'px',
      width: right - left + 'px',
      height: bottom - top + 'px',
    });
    const ids = d.regions
      .filter(r => r.left < right && r.right > left && r.top < bottom && r.bottom > top)
      .map(r => r.id);
    setTimelineSelection([...d.base, ...ids]);
    renderTimeline();
    renderInspector();
    buttons();
  }
  $('timelineScroll').addEventListener('pointerdown', e => {
    if (
      e.button !== 0 ||
      pointerBusy() ||
      e.target.closest('button,input,[data-clip],[data-linked-audio],[data-audio],#ruler')
    )
      return;
    e.preventDefault();
    $('editor').focus({ preventScroll: true });
    pause();
    editView();
    hideTrimPreview();
    setSelectedCut(null);
    const rect = $('timelineContent').getBoundingClientRect(),
      before = copy(getState()),
      base = e.ctrlKey || e.metaKey ? selectionIds().slice() : [],
      regions = [
        ...$('timelineContent').querySelectorAll('[data-clip],[data-audio],[data-linked-audio]:not(.no-audio)'),
      ].map(node => {
        const r = node.getBoundingClientRect();
        return {
          id: node.dataset.clip || node.dataset.audio || node.dataset.linkedAudio,
          left: r.left - rect.left,
          right: r.right - rect.left,
          top: r.top - rect.top,
          bottom: r.bottom - rect.top,
        };
      });
    setTimelineSelection(base);
    const ghost = document.createElement('div');
    ghost.className = 'selection-marquee';
    ghost.hidden = true;
    $('timelineContent').append(ghost);
    setDrag({
      kind: 'marquee',
      before,
      base,
      regions,
      ghost,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      moved: false,
    });
    $('timelineScroll').setPointerCapture(e.pointerId);
    renderInspector();
    renderTimeline();
    buttons();
  });

  function clearClipDrag() {
    cancelAnimationFrame(clipMoveRAF);
    clipMoveRAF = 0;
    pendingClipMove = null;
    hideTrimPreview();
    getDrag()?.ghost?.remove();
    for (const node of $('timelineContent').querySelectorAll('[data-clip]')) node.style.opacity = '';
    $('editor').style.removeProperty('--active-edit-cursor');
    $('dropLine').hidden = true;
    $('editor').classList.remove('dragging-clip', 'editing-clip', 'copying-clip', 'scrubbing');
  }
  // A clip drag, panel or timeline resize, or track resize owns the pointer until it ends.
  function pointerBusy() {
    return !!(getDrag() || isPanelDragging() || isTimelineResizing() || isTrackResizing());
  }
  function cancelClipDrag() {
    if (!getDrag()) return;
    const before = getDrag().before;
    clearClipDrag();
    setDrag(null);
    if (areGestureHintsStale()) refreshGestureHints();
    if (before) setState(preserveTakes(before));
    render();
    save();
    setStatus('Edit cancelled');
  }
  function handleClipPointerMove(e) {
    if (!getDrag()) return;
    if (getDrag().kind === 'marquee') {
      moveMarquee(e);
      return;
    }
    if (getDrag().kind === 'fade') {
      moveFadeDrag(e);
      return;
    }
    if (getDrag().kind === 'audio') {
      moveAudioDrag(e);
      return;
    }
    if (getDrag().kind === 'pending') {
      if (Math.abs(e.clientX - getDrag().startX) < 4 && Math.abs(e.clientY - getDrag().startY) < 4) return;
      if (!lockClipGesture(e)) return;
    }
    if (getDrag().kind === 'scrub') {
      setFrame(snapFrame(timelineFrame(e)), true);
      return;
    }
    if (getDrag().kind === 'move') {
      moveSelectedGroup(e);
      return;
    }
    const c = getState().clips.find(c => c.id === getDrag().id);
    if (!c) return;
    const dx = e.clientX - getDrag().startX;
    $('editor').classList.add('editing-clip');
    let delta = Math.round(dx / getDrag().scale);
    if (getState().snap && getDrag().kind !== 'slip') {
      const original =
          getDrag().start + (getDrag().kind === 'out' ? getDrag().original.out - getDrag().original.in : 0),
        position = original + delta,
        near = T.snap(getDrag().snapPoints, position, T.SNAP_PIXELS / getDrag().scale);
      delta = near - original;
    }
    const applied = T.applyEdit(getState(), getDrag(), delta),
      row = rowFor(c.id);
    getDrag().applied = applied;
    getState().frame = ['slip', 'slide'].includes(getDrag().kind)
      ? clamp(getDrag().before.frame, row.start, row.end - 1)
      : getDrag().kind === 'in'
        ? row.start
        : row.end - 1;
    renderTimeline();
    updateViewer(true);
    updateTrimPreview(getDrag(), applied);
    if (!getDrag().ghost) {
      getDrag().ghost = document.createElement('div');
      getDrag().ghost.className = 'drag-ghost edit-feedback';
      document.body.append(getDrag().ghost);
    }
    getDrag().ghost.textContent =
      editActions[getDrag().mode].name +
      ' ' +
      (applied >= 0 ? '+' : '') +
      applied +
      'f | ' +
      tc(c.in) +
      ' - ' +
      tc(c.out);
    getDrag().ghost.style.left =
      Math.max(8, Math.min(e.clientX + 14, innerWidth - getDrag().ghost.offsetWidth - 8)) + 'px';
    getDrag().ghost.style.top =
      Math.max(8, Math.min(e.clientY - 34, innerHeight - getDrag().ghost.offsetHeight - 8)) + 'px';
    setStatus(
      editActions[getDrag().mode].name +
        ' ' +
        (applied >= 0 ? '+' : '') +
        applied +
        ' frames' +
        (applied !== delta ? ' - limit reached' : ''),
    );
  }
  function flushClipPointerMove() {
    cancelAnimationFrame(clipMoveRAF);
    clipMoveRAF = 0;
    if (pendingClipMove) {
      const move = pendingClipMove;
      pendingClipMove = null;
      handleClipPointerMove(move);
    }
  }
  window.addEventListener('pointermove', e => {
    if (!getDrag()) return;
    pendingClipMove = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey };
    if (!clipMoveRAF) clipMoveRAF = requestAnimationFrame(flushClipPointerMove);
  });
  window.addEventListener('pointerup', () => {
    if (!getDrag()) return;
    flushClipPointerMove();
    const done = getDrag();
    clearClipDrag();
    setDrag(null);
    if (areGestureHintsStale()) refreshGestureHints();
    if (done.kind === 'scrub') {
      save();
      return;
    }
    if (done.kind === 'marquee') {
      setSelectionAnchor(getState().selectedAudio || getState().selected);
      renderInspector();
      renderTimeline();
      buttons();
      save();
      return;
    }
    if (done.kind === 'pending') {
      if (done.collapseSelection) selectTimelineItem(done.id);
      renderTimeline();
      renderInspector();
      save();
      buttons();
      return;
    }
    if (done.kind === 'audio' && !done.moved && done.collapseSelection) {
      selectTimelineItem(done.id);
      renderInspector();
    }
    if (
      done.kind === 'move' &&
      done.overwrite &&
      done.applied !== undefined &&
      (done.applied !== 0 || (done.targetTrack && done.targetTrack !== T.videoTrack(done.original)))
    ) {
      T.overwriteMove(
        getState(),
        done.before,
        done.ids,
        done.applied,
        done.targetTrack,
        () => 'clip-' + crypto.randomUUID(),
      );
      getState().frame = rowFor(done.id).start;
      setStatus('Clip placed - covered footage overwritten');
    }
    if (editingSignature(projectData()) !== editingSignature(done.before)) {
      history.record(
        done.before,
        done.copies
          ? 'Duplicate ' + (done.group ? done.ids.length + ' clips' : done.original.name)
          : done.group
            ? 'Move ' + done.ids.length + ' clips'
            : done.kind === 'fade'
              ? 'Fade ' + done.side + ' ' + done.original.name
              : done.kind === 'audio'
                ? (editActions[done.mode]?.name || 'Edit') + ' audio ' + done.original.name
                : done.kind === 'move'
                  ? 'Move ' + done.original.name
                  : editActions[done.mode].name +
                    ' ' +
                    done.original.name +
                    (done.applied ? ' ' + (done.applied > 0 ? '+' : '') + done.applied + 'f' : ''),
      );
    }
    renderTimeline();
    renderInspector();
    updateViewer(true);
    save();
    buttons();
  });
  window.addEventListener('pointercancel', cancelClipDrag);
  interruptions.on(cancelClipDrag);
  $('timelineScroll').addEventListener('lostpointercapture', cancelClipDrag);
  $('timelineScroll').addEventListener(
    'pointerdown',
    e => {
      if (
        e.button !== 1 ||
        getDrag() ||
        getTimelinePan() ||
        isPanelDragging() ||
        isTimelineResizing() ||
        isTrackResizing()
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const sc = $('timelineScroll');
      setTimelinePan({ pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop });
      sc.setPointerCapture(e.pointerId);
      $('editor').classList.add('timeline-grabbing');
    },
    true,
  );
  window.addEventListener('pointermove', e => {
    if (!getTimelinePan() || e.pointerId !== getTimelinePan().pointerId) return;
    const sc = $('timelineScroll');
    sc.scrollLeft = getTimelinePan().left + getTimelinePan().x - e.clientX;
    sc.scrollTop = getTimelinePan().top + getTimelinePan().y - e.clientY;
  });
  function finishTimelinePan(cancel = false) {
    if (!getTimelinePan()) return;
    const p = getTimelinePan(),
      sc = $('timelineScroll');
    setTimelinePan(null);
    if (cancel) {
      sc.scrollLeft = p.left;
      sc.scrollTop = p.top;
    }
    if (sc.hasPointerCapture(p.pointerId)) sc.releasePointerCapture(p.pointerId);
    $('editor').classList.remove('timeline-grabbing');
  }
  window.addEventListener('pointerup', () => finishTimelinePan());
  window.addEventListener('pointercancel', () => finishTimelinePan());
  interruptions.on(() => finishTimelinePan());
  $('timelineScroll').addEventListener('lostpointercapture', () => finishTimelinePan());
  window.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape' && getTimelinePan()) {
        e.preventDefault();
        e.stopPropagation();
        finishTimelinePan(true);
      }
    },
    true,
  );
  $('timelineScroll').addEventListener('auxclick', e => {
    if (e.button === 1) e.preventDefault();
  });
  $('ruler').onpointerdown = e => {
    if (e.button !== 0 || isPanelDragging() || isTimelineResizing() || isTrackResizing() || getDrag()) return;
    hideTrimPreview();
    e.preventDefault();
    $('editor').focus({ preventScroll: true });
    pause();
    if (review.mode !== 'edit' || review.audition) {
      editView();
      renderTakes();
      renderTimeline();
    }
    setDrag({ kind: 'scrub' });
    $('timelineScroll').setPointerCapture(e.pointerId);
    $('editor').classList.add('scrubbing');
    setFrame(snapFrame(timelineFrame(e)), true);
  };
  function startFadeDrag(e, id, bed) {
    if (e.button !== 0 || pointerBusy()) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      bed ? selectAudio(id, e) : selectClip(id, false, e);
      return;
    }
    setTimelineSelection([id]);
    setSelectedCut(null);
    setNudgeGroup(null);
    hideTrimPreview();
    e.preventDefault();
    e.stopPropagation();
    pause();
    editView();
    const c = (bed ? getState().audioClips : getState().clips).find(x => x.id === id);
    if (!c) return;
    setInspectorTab('audio');
    setDrag({
      kind: 'fade',
      side: e.target.closest('[data-fade]').dataset.fade,
      id,
      bed,
      startX: e.clientX,
      before: copy(getState()),
      original: copy(c),
      scale: getPixelScale(),
      moved: false,
    });
    $('timelineScroll').setPointerCapture(e.pointerId);
    $('editor').style.setProperty('--active-edit-cursor', 'ew-resize');
    $('editor').classList.add('editing-clip');
    $('editor').focus({ preventScroll: true });
    renderInspector();
    renderTimeline();
  }
  function moveFadeDrag(e) {
    const d = getDrag(),
      c = (d.bed ? getState().audioClips : getState().clips).find(x => x.id === d.id),
      a = audioSettings(d.original),
      key = d.side === 'in' ? 'fadeIn' : 'fadeOut';
    if (Math.abs(e.clientX - d.startX) < 4 && !d.moved) return;
    d.moved = true;
    const value = clamp(
      a[key] + Math.round((e.clientX - d.startX) / d.scale) * (d.side === 'in' ? 1 : -1),
      0,
      Math.floor((c.out - c.in) / 2),
    );
    if (value !== audioSettings(c)[key]) c.audio = { ...audioSettings(c), [key]: value };
    renderAudioTimeline(layout());
    const field = $(d.side === 'in' ? 'audioFadeIn' : 'audioFadeOut');
    if (field) field.value = (value / getFps()).toFixed(2);
    setStatus('Fade ' + d.side + ' ' + (value / getFps()).toFixed(2) + 's');
  }
  function startAudioDrag(e, id) {
    if (e.button !== 0 || pointerBusy()) return;
    const edge = e.target.closest('[data-audio-trim]')?.dataset.audioTrim || null;
    if (!edge && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      $('editor').focus({ preventScroll: true });
      selectAudio(id, e);
      return;
    }
    const collapseSelection = !edge && selectionIds().includes(id) && selectionIds().length > 1;
    selectTimelineItem(id, {}, !edge);
    hideTrimPreview();
    e.preventDefault();
    $('editor').focus({ preventScroll: true });
    pause();
    editView();
    setNudgeGroup(null);
    setInspectorTab('audio');
    const c = selectedAudio(),
      peer = edge && audioNeighbor(c, edge);
    setSelectedCut(peer ? { id, edge, audio: true } : null);
    const ids = selectionIds().slice();
    setDrag({
      ...T.beginEdit(getState(), {
        id,
        audio: true,
        kind: 'audio',
        edge,
        peer,
        snapEnabled: getState().snap,
        snapTolerance: T.SNAP_PIXELS / getPixelScale(),
      }),
      ids,
      group: ids.length > 1,
      collapseSelection,
      shared: !!peer,
      startX: e.clientX,
      scale: getPixelScale(),
      moved: false,
    });
    if (getDrag().group) getDrag().snapPoints = T.snapPoints(getState(), ids);
    $('timelineScroll').setPointerCapture(e.pointerId);
    renderInspector();
    renderTimeline();
    buttons();
  }

  function moveAudioDrag(e) {
    const d = getDrag();
    if (d.operation === 'pending') {
      if (Math.abs(e.clientX - d.startX) < 4) return;
      const a = clipGesture(
        { id: d.id, audio: true, edge: d.edge, shared: d.shared },
        e.shiftKey || held.shift,
        e.altKey || held.alt,
      );
      if (a.blocked) {
        toast(a.blocked);
        cancelClipDrag();
        return;
      }
      d.operation = a.mode === 'roll' ? 'roll' : a.kind;
      d.mode = a.mode;
      d.moved = true;
      if (a.mode === 'copy') {
        d.kind = 'move';
        copyDragSelection();
        moveSelectedGroup(e);
        return;
      }
      $('editor').style.setProperty('--active-edit-cursor', a.kind === 'move' ? 'grabbing' : gestureCursor(a));
      $('editor').classList.add('editing-clip');
    }
    if (d.group && d.operation === 'move') {
      moveSelectedGroup(e);
      return;
    }
    if (d.group) {
      setTimelineSelection([d.id]);
      d.group = false;
      renderInspector();
    }
    const delta = Math.round((e.clientX - d.startX) / d.scale),
      applied = T.applyEdit(getState(), d, delta);
    d.applied = applied;
    renderTimeline();
    updateViewer(true);
    setStatus(
      editActions[d.mode].name +
        ' audio ' +
        (applied >= 0 ? '+' : '') +
        applied +
        'f · video stays fixed' +
        (applied !== delta ? ' · limit reached' : ''),
    );
  }

  return { timelineFrame, snapFrame, startClipDrag, cancelClipDrag, pointerBusy, startFadeDrag, startAudioDrag };
}
