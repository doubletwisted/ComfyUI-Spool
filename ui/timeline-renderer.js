import * as T from './timeline.js';

// Retains timeline DOM and its geometry-only repaint path during gestures.
export function createTimelineRenderer({
  $,
  getState,
  getActiveTrack,
  setActiveTrack,
  getPixelScale,
  setPixelScale,
  getDrag,
  getCurrentClip,
  invalidateLane,
  markGestureHintsStale,
  layout,
  total,
  setStyle,
  seconds,
  draw,
  svg,
  trackResizeHandle,
  edits,
  pause,
  saveView,
  renderAudioTrackHeaders,
  getFps,
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
  startClipDrag,
  selectClip,
  renderAudioTimeline,
  applyTrackHeights,
  selectionIds,
  refreshGestureHints,
}) {
  // Geometry during a getDrag(): the clip set and its content are unchanged, so positions
  // are written to the nodes that are already there instead of rebuilding the lane and
  // re-binding every handler and filmstrip. The full renderer runs again when the
  // gesture ends, which is also when filmstrip frames and labels catch up — deferring
  // them avoids re-decoding thumbnails on every getDrag() frame.
  let laneNodes = new Map(),
    laneOrder = [],
    laneDrawn = false;
  function applyClipGeometry(rows) {
    const sharedIn = new Set(),
      sharedOut = new Set(),
      previous = new Map();
    for (const { clip: c } of rows) {
      const track = T.videoTrack(c),
        prev = previous.get(track);
      if (prev && !c.gapBefore) {
        sharedIn.add(c.id);
        sharedOut.add(prev.id);
      }
      previous.set(track, c);
    }
    for (const { clip: c, start } of rows) {
      const node = laneNodes.get(c.id);
      if (!node) return false;
      setStyle(node, 'left', start * getPixelScale() + 'px');
      setStyle(node, 'width', Math.max(14, (c.out - c.in) * getPixelScale()) + 'px');
      setStyle(node, 'top', 'calc(var(--video-top-' + T.videoTrack(c) + ') + 6px)');
      setStyle(node, 'height', 'calc(var(--video-height-' + T.videoTrack(c) + ') - 12px)');
      const meta = node.querySelector('.clip-meta span:last-child'),
        duration = seconds(c.out - c.in);
      if (meta && meta.textContent !== duration) meta.textContent = duration;
      node.querySelector('[data-trim="in"]')?.classList.toggle('shared', sharedIn.has(c.id));
      node.querySelector('[data-trim="out"]')?.classList.toggle('shared', sharedOut.has(c.id));
    }
    // The memo still holds the pre-gesture markup, so the next full render must write:
    // otherwise returning to exactly the starting getState() would short-circuit and leave the
    // styles this pass wrote in place.
    invalidateLane();
    return true;
  }
  function renderTimeline() {
    const rows = layout(),
      length = total(),
      viewport = $('timelineScroll').clientWidth,
      count = T.videoTracks(getState()),
      sharedIn = new Set(),
      sharedOut = new Set(),
      previous = new Map();
    for (const { clip: c } of rows) {
      const track = T.videoTrack(c),
        prev = previous.get(track);
      if (prev && !c.gapBefore) {
        sharedIn.add(c.id);
        sharedOut.add(prev.id);
      }
      previous.set(track, c);
    }
    setActiveTrack(Math.min(getActiveTrack(), count));
    draw(
      'videoTrackLabels',
      Array.from({ length: count }, (_, i) => {
        const track = count - i;
        return (
          '<div class="track-label' +
          (!T.videoTrackEnabled(getState(), track) ? ' disabled-track' : '') +
          '" style="height:var(--video-height-' +
          track +
          ')"><button class="track-toggle video-track-toggle" data-toggle-video-track="' +
          track +
          '" aria-label="' +
          (T.videoTrackEnabled(getState(), track) ? 'Disable' : 'Enable') +
          ' video track V' +
          track +
          '" aria-pressed="' +
          T.videoTrackEnabled(getState(), track) +
          '" title="' +
          (T.videoTrackEnabled(getState(), track) ? 'Disable' : 'Enable') +
          ' V' +
          track +
          ' picture and linked audio">' +
          svg(T.videoTrackEnabled(getState(), track) ? 'eye' : 'eyeOff') +
          '</button><button class="track-select' +
          (track === getActiveTrack() ? ' active' : '') +
          '" data-select-track="' +
          track +
          '" aria-pressed="' +
          (track === getActiveTrack()) +
          '" title="Add new clips to V' +
          track +
          '">V' +
          track +
          '</button>' +
          trackResizeHandle('video:' + track, 'video track V' + track) +
          '</div>'
        );
      }).join(''),
    );
    $('videoTrackLabels')
      .querySelectorAll('[data-select-track]')
      .forEach(
        b =>
          (b.onclick = () => {
            setActiveTrack(Number(b.dataset.selectTrack));
            renderTimeline();
            saveView();
            $('editor').focus({ preventScroll: true });
          }),
      );
    $('videoTrackLabels')
      .querySelectorAll('[data-toggle-video-track]')
      .forEach(
        b =>
          (b.onclick = () => {
            const track = Number(b.dataset.toggleVideoTrack),
              value = !T.videoTrackEnabled(getState(), track);
            edits.apply((value ? 'Enable' : 'Disable') + ' video track V' + track, () => {
              pause();
              T.setVideoTrackEnabled(getState(), track, value);
            });
            $('videoTrackLabels')
              .querySelector('[data-toggle-video-track="' + track + '"]')
              ?.focus({ preventScroll: true });
          }),
      );
    renderAudioTrackHeaders(count);
    const empty = !getState().clips.length && !(getState().audioClips || []).length,
      extra = empty ? 160 : 0,
      usable = Math.max(1, viewport - extra);
    setPixelScale(
      getDrag()?.scale || (Math.max(0.0001, usable / Math.max(length, getFps() * 5)) * getState().zoom) / 100,
    );
    const width = Math.max(viewport, Math.ceil(Math.max(length, 120) * getPixelScale()) + extra);
    $('timelineContent').style.width = width + 'px';
    $('zoomValue').textContent = getState().zoom + '%';
    const second = Math.round(getFps()),
      interval =
        [
          1,
          2,
          5,
          Math.round(second / 4),
          Math.round(second / 2),
          ...[1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 2400].map(n => n * second),
        ]
          .filter(n => n > 0)
          .sort((a, b) => a - b)
          .find(n => n * getPixelScale() >= 96) || Math.ceil(96 / getPixelScale()),
      ticks = [];
    for (let f = 0; f < width / getPixelScale(); f += interval) {
      const seconds = Math.floor(f / second),
        frames = f % second,
        label = frames
          ? seconds + 's ' + frames + 'f'
          : seconds < 60
            ? seconds + 's'
            : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      ticks.push(
        '<span class="tick" title="' + tc(f) + '" style="left:' + f * getPixelScale() + 'px">' + label + '</span>',
      );
      if (interval > 1)
        ticks.push('<span class="tick minor" style="left:' + (f + interval / 2) * getPixelScale() + 'px"></span>');
    }
    draw('ruler', ticks.join(''));
    renderExportRange();
    const sourceHandles =
      getDrag() && ['slip', 'slide'].includes(getDrag().kind)
        ? (() => {
            const c = getState().clips.find(c => c.id === getDrag().id),
              r = rowFor(c.id);
            return (
              '<div class="source-handles" style="top:var(--video-top-' +
              T.videoTrack(c) +
              ');height:calc(var(--video-height-' +
              T.videoTrack(c) +
              ') - 2px);left:' +
              (r.start - c.in) * getPixelScale() +
              'px;width:' +
              take(c).media.frames * getPixelScale() +
              'px"></div>'
            );
          })()
        : '';
    const order = rows.map(({ clip: c }) => c.id);
    // Slip and slide draw the source-handle overlay inside the lane string, so they keep
    // the full path; every other gesture changes geometry only.
    if (!(
      laneDrawn &&
      getDrag() &&
      getDrag().kind !== 'slip' &&
      getDrag().kind !== 'slide' &&
      order.length === laneOrder.length &&
      order.every((id, index) => laneOrder[index] === id) &&
      applyClipGeometry(rows)
    )) {
      const lane =
        Array.from(
          { length: count },
          (_, i) =>
            '<div class="video-track-lane" data-video-track="' +
            (count - i) +
            '" style="position:absolute;top:var(--video-top-' +
            (count - i) +
            ');height:var(--video-height-' +
            (count - i) +
            ');width:100%"></div>',
        ).join('') +
        sourceHandles +
        rows
          .map(({ clip: c, start }, index) => {
            const t = take(c),
              trial = review.audition?.clipId === c.id ? c.takes.find(t => t.id === review.audition.takeId) : null,
              width = (c.out - c.in) * getPixelScale(),
              frames = t.media.kind === 'video' ? [c.in, Math.max(c.in, Math.min(c.out, t.media.frames) - 1)] : [c.in];
            const film = frames
              .map(frame => '<img src="' + esc(url(t.media.poster)) + '" data-frame="' + frame + '" alt="">')
              .join('');
            const pending = pendingJobs(c).length,
              takeCount = T.realTakes(c).length;
            return (
              '<div class="timeline-clip ' +
              (trial ? ' audition' : t.placeholder ? ' no-take' : '') +
              (!T.videoEnabled(getState(), c) ? ' disabled-clip' : '') +
              '" data-clip="' +
              c.id +
              '" data-workflow="' +
              c.workflow +
              '" style="top:calc(var(--video-top-' +
              T.videoTrack(c) +
              ') + 6px);height:calc(var(--video-height-' +
              T.videoTrack(c) +
              ') - 12px);left:' +
              start * getPixelScale() +
              'px;width:' +
              Math.max(14, width) +
              'px" tabindex="0" role="button" aria-pressed="false" aria-label="' +
              esc(c.name) +
              (!T.videoEnabled(getState(), c) ? ' disabled' : '') +
              ' timeline clip"><div class="filmstrip">' +
              film +
              '</div><div class="clip-label"><span class="clip-type">' +
              (workflows[c.workflow]?.short || 'MEDIA') +
              '</span><strong>' +
              esc(c.name) +
              '</strong>' +
              clipAttention(c) +
              '</div><div class="clip-meta"><span>' +
              (trial
                ? 'T' + String(trial.number).padStart(2, '0') + ' trial'
                : t.placeholder
                  ? 'No take'
                  : 'T' + String(t.number).padStart(2, '0')) +
              '</span><span class="clip-takes-status' +
              (pending ? ' busy' : '') +
              '">' +
              (takeCount ? takeCount + ' ' + (takeCount === 1 ? 'take' : 'takes') : '') +
              (pending ? ' · ' + pending + ' pending' : '') +
              '</span><span>' +
              seconds(c.out - c.in) +
              '</span></div><div class="trim-handle in' +
              (sharedIn.has(c.id) ? ' shared' : '') +
              '" data-trim="in" title="Start edge"></div><div class="trim-handle out' +
              (sharedOut.has(c.id) ? ' shared' : '') +
              '" data-trim="out" title="End edge"></div></div>'
            );
          })
          .join('') +
        (length ? '' : '<div class="timeline-empty">Drop a workflow or media here to begin.</div>');
      if (draw('clipLane', lane)) {
        laneNodes = new Map();
        $('clipLane')
          .querySelectorAll('[data-clip]')
          .forEach(node => {
            laneNodes.set(node.dataset.clip, node);
            const c = getState().clips.find(c => c.id === node.dataset.clip);
            node
              .querySelectorAll('.filmstrip img')
              .forEach(img => thumbnails.bind(img, take(c).media, Number(img.dataset.frame), getFps()));
            node.classList.toggle('current', node.dataset.clip === getCurrentClip());
            node.onpointerdown = e => startClipDrag(e, node.dataset.clip);
            node.onkeydown = e => {
              if (e.key === 'Enter') {
                selectClip(node.dataset.clip, true, e);
                e.preventDefault();
              }
            };
          });
      }
      laneOrder = order;
      laneDrawn = true;
    }
    $('addShot').style.left =
      T.trackClips(getState(), getActiveTrack()).reduce((n, c) => n + (c.gapBefore || 0) + c.out - c.in, 0) *
        getPixelScale() +
      8 +
      'px';
    $('addShot').style.top = 'calc(var(--video-top-' + getActiveTrack() + ') + 34px)';
    $('addShot').style.height = 'calc(var(--video-height-' + getActiveTrack() + ') - 12px)';
    $('addShot').hidden = getState().clips.length > 0 || (getState().audioClips || []).length > 0;
    renderAudioTimeline(rows, false);
    applyTrackHeights();
    $('sequenceStats').textContent =
      getState().clips.length +
      ' ' +
      (getState().clips.length === 1 ? 'clip' : 'clips') +
      ' · ' +
      tc(length) +
      (selectionIds().length > 1 ? ' / ' + selectionIds().length + ' selected' : '');
    // Gesture hints depend on the held modifiers and the selected cut, neither of which
    // changes while a pointer getDrag() is running; resolving them for every node on every
    // frame was the hottest entry in the getDrag() profile. They refresh when the getDrag() ends.
    if (getDrag()) markGestureHintsStale();
    else refreshGestureHints();
    $('seek').max = length;
  }
  return {
    renderTimeline,
    get laneNodes() {
      return laneNodes;
    },
  };
}
