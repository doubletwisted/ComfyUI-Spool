import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createTimelineDrops({
  $,
  copy,
  request,
  getProductDefinitions,
  projectKey,
  getFps,
  getState,
  writeState,
  getPpf,
  history,
  getSelectedTakeIds,
  writeSelectedTakeIds,
  projectData,
  getActiveVideoTrack,
  writeActiveVideoTrack,
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
  getDraggedTake,
  writeDraggedTake,
  takeDropPreview,
  getLibraryDrag,
  getLibraryDragPoint,
  writeLibraryDragPoint,
  getLibraryScrollRAF,
  writeLibraryScrollRAF,
  libraryDropPreview,
  getExternalDropDepth,
  writeExternalDropDepth,
  getPause,
  saveView,
  getProjectEdit,
  flushNative,
}) {
  function clearLibraryDrop() {
    libraryDropPreview.hidden = true;
    writeLibraryDragPoint(null);
    cancelAnimationFrame(getLibraryScrollRAF());
    writeLibraryScrollRAF(0);
  }
  function libraryDrop(e, item) {
    const track = trackAt(e),
      frame = Math.max(0, Math.round(timelineFrame(e))),
      workflow = !!(item.workflow || item.builtin),
      media = item.media && projectMedia().find(m => m.id === item.media);
    if (!workflow && !media) return null;
    const { w, source } = workflow ? libraryWorkflow(item.builtin || item.workflow, !!item.builtin) : {},
      duration = source?.data.bindings?.find(b => b.role === 'duration'),
      seconds = duration?.unit === 'seconds' ? Number(source.data.prompt[duration.nodeId].inputs[duration.input]) : 5;
    const frames = workflow ? Math.max(1, Math.round((seconds || 5) * getFps())) : media.frames,
      label = workflow ? (item.builtin ? w?.family + ' · ' + w?.name : w?.name) : media.name;
    const audio = !workflow && (media.kind === 'audio' || !!e.target.closest('#audioLane,#musicLane'));
    let clipId = null,
      start = frame;
    if (workflow) {
      const hit = e.target.closest('[data-clip]'),
        rect = hit?.getBoundingClientRect(),
        margin = rect ? Math.min(8, rect.width / 4) : 0;
      clipId = hit && e.clientX > rect.left + margin && e.clientX < rect.right - margin ? hit.dataset.clip : null;
      if (hit && !clipId) {
        const cut = rowFor(hit.dataset.clip);
        start = e.clientX < rect.left + rect.width / 2 ? cut.start : cut.end;
      } else if (!hit && getState().snap) {
        const points = layout()
            .filter(r => T.videoTrack(r.clip) === track)
            .flatMap(r => [r.start, r.end]),
          nearest = points.sort((a, b) => Math.abs(a - frame) - Math.abs(b - frame))[0];
        if (Math.abs(nearest - frame) * getPpf() <= T.SNAP_PIXELS) start = nearest;
      }
    } else if (!audio) {
      // Ask the same placement algorithm used by footage insertion where it fits.
      const geometry = {
          ...getState(),
          clips: getState().clips.map(c => ({
            id: c.id,
            in: c.in,
            out: c.out,
            gapBefore: c.gapBefore,
            videoTrack: c.videoTrack,
          })),
        },
        probe = { id: 'drop-preview', in: 0, out: frames };
      T.insertClip(geometry, probe, T.dropIndex(getState(), frame), {
        track,
        start: T.videoTracks(getState()) > 1 ? frame : null,
      });
      start = T.rowFor(geometry, probe.id).start;
    }
    return {
      track,
      clipId,
      placement: { track, start: Math.max(0, start) },
      frames,
      label,
      index: T.dropIndex(getState(), start),
      mode: clipId ? 'replace' : 'insert',
      lane: audio ? (e.target.closest('#audioLane') ? 'audioLane' : 'musicLane') : 'clipLane',
    };
  }
  function paintLibraryDrop(e) {
    const drop = getLibraryDrag() && libraryDrop(e, getLibraryDrag());
    if (!drop) {
      libraryDropPreview.hidden = true;
      return;
    }
    const row = drop.clipId && rowFor(drop.clipId),
      start = row ? row.start : drop.placement.start,
      frames = row ? row.end - row.start : drop.frames;
    const lane = $(drop.lane),
      top =
        lane.offsetTop +
        (drop.lane === 'musicLane'
          ? 0
          : parseFloat(
              $('editor').style.getPropertyValue(
                '--' + (drop.lane === 'audioLane' ? 'source' : 'video') + '-top-' + drop.track,
              ),
            ) || 0),
      height =
        drop.lane === 'musicLane'
          ? trackHeight('music')
          : trackHeight((drop.lane === 'audioLane' ? 'source:' : 'video:') + drop.track);
    const left = start * getPpf(),
      width = Math.max(14, frames * getPpf()),
      ghost = libraryDropPreview.querySelector('.library-drop-ghost'),
      marker = libraryDropPreview.querySelector('.library-drop-marker'),
      label = libraryDropPreview.querySelector('.library-drop-label'),
      sc = $('timelineScroll');
    libraryDropPreview.dataset.mode = drop.mode;
    Object.assign(ghost.style, {
      left: left + 'px',
      width: width + 'px',
      top: top + 5 + 'px',
      height: height - 10 + 'px',
    });
    Object.assign(marker.style, { left: left + 'px', top: top + 'px', height: height + 'px' });
    marker.hidden = drop.mode === 'replace';
    label.textContent =
      (drop.mode === 'replace'
        ? 'Replace workflow'
        : 'Insert on ' + (drop.lane === 'clipLane' ? 'V' + drop.track : drop.lane === 'audioLane' ? 'A1' : 'A2')) +
      ' · ' +
      (drop.label || 'Workflow') +
      ' · ' +
      tc(start);
    Object.assign(label.style, {
      left: Math.max(sc.scrollLeft + 4, Math.min(left + 8, sc.scrollLeft + sc.clientWidth - 260)) + 'px',
      top: Math.max(0, top - 25) + 'px',
      maxWidth: Math.max(80, sc.clientWidth - 16) + 'px',
    });
    libraryDropPreview.hidden = false;
  }
  function scrollLibraryDrop() {
    writeLibraryScrollRAF(0);
    if (!getLibraryDragPoint() || !getLibraryDrag()) return;
    const sc = $('timelineScroll'),
      rect = sc.getBoundingClientRect(),
      x = getLibraryDragPoint().clientX,
      edge = 48;
    const speed =
      x > rect.right - edge
        ? Math.min(18, (x - rect.right + edge) / 3)
        : x < rect.left + edge
          ? -Math.min(18, (rect.left + edge - x) / 3)
          : 0;
    if (speed) {
      const before = sc.scrollLeft;
      sc.scrollLeft = Math.max(0, Math.min($('timelineContent').clientWidth - sc.clientWidth, before + speed));
      if (sc.scrollLeft !== before) {
        paintLibraryDrop({
          ...getLibraryDragPoint(),
          target: document.elementFromPoint(x, getLibraryDragPoint().clientY) || sc,
        });
        writeLibraryScrollRAF(requestAnimationFrame(scrollLibraryDrop));
      }
    }
  }
  async function moveTakeToTimeline(clipId, takeId, start, track) {
    const source = getState().clips.find(c => c.id === clipId),
      candidate = T.realTakes(source).find(t => t.id === takeId);
    if (!candidate) return;
    let before,
      mutated = false;
    const inert = $('editor').inert;
    $('editor').inert = true;
    try {
      await flushNative();
      before = copy(getState());
      const signature = editingSignature(projectData()),
        fallback = source.takeId === takeId ? T.realTakes(source).find(t => t.id !== takeId) : null;
      const captureFor = id => takeWorkflowCapture(clipId, id, source.name);
      const [capture, fallbackCapture, P] = await Promise.all([
        captureFor(takeId),
        fallback ? captureFor(fallback.id) : null,
        import('./profile.js'),
      ]);
      if (editingSignature(projectData()) !== signature)
        throw Error('The clip changed while its take was being prepared. Drop it again.');
      getPause()();
      editView();
      const moved = T.moveTake(getState(), clipId, takeId, start, track, () => 'clip-' + crypto.randomUUID());
      if (!moved) throw Error('This take is no longer available.');
      mutated = true;
      setTimelineSelection([moved.id]);
      writeActiveVideoTrack(track);
      getState().frame = rowFor(moved.id).start;
      save();
      await flushNative();
      const adopt = async (id, take, capture) => {
        const current = getState().clips.find(c => c.id === id);
        if (!current) return;
        if (capture?.prompt) {
          const choices = P.resultChoices(capture.prompt, getProductDefinitions()),
            result =
              choices.find(r => r.nodeId === capture.result?.nodeId && r.group === capture.result?.group) ||
              (choices.length === 1 ? choices[0] : null);
          if (result) {
            capture.result = { nodeId: result.nodeId, group: result.group, index: result.index };
            capture.bindings = P.keyInputs(capture.prompt, getProductDefinitions(), result)
              .filter(b => !b.ambiguous)
              .map(({ value, ...b }) => ({ ...b, key: crypto.randomUUID() }));
            await getProjectEdit().change(revision =>
              request('projects/' + projectKey + '/capture/' + id, { revision, capture, resetInputs: true }),
            );
          }
        }
        const c = getState().clips.find(c => c.id === id);
        c.generationBase = capture?.provenance?.takeBase || { takeId: take.id, source: 'No executable metadata' };
        save();
        await flushNative();
      };
      await adopt(moved.id, candidate, capture);
      if (fallback) await adopt(clipId, fallback, fallbackCapture);
      history.record(before, 'Move take to timeline');
      markTakesSeen([takeId]);
      writeSelectedTakeIds([]);
      closeTakeComparison();
      render();
      saveHistory();
      saveView();
      toast('Take moved to its own clip');
    } catch (error) {
      if (mutated) {
        writeState(preserveTakes(before));
        render();
        save();
        try {
          await flushNative();
        } catch {}
      }
      toast(error.message);
    } finally {
      $('editor').inert = inert;
      takeDropPreview.hidden = true;
      writeDraggedTake(null);
    }
  }
  function clearExternalDrop() {
    writeExternalDropDepth(0);
    $('externalDropHint').hidden = true;
  }
  return { clearLibraryDrop, libraryDrop, paintLibraryDrop, scrollLibraryDrop, moveTakeToTimeline, clearExternalDrop };
}
