import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createTrackLayout({
  $,
  getState,
  trackHeightsKey,
  trackHeights,
  trackHeightBounds,
  trackHeight,
  preferredTrackHeight,
  setTrackFit,
  trackVariable,
  draw,
}) {
  function trackAt(e) {
    const kind = e.target?.closest?.('#audioLane') ? 'source' : 'video',
      rect = $(kind === 'source' ? 'audioLane' : 'clipLane').getBoundingClientRect(),
      y = e.clientY - rect.top;
    let end = 0;
    for (let track = T.videoTracks(getState()); track > 0; track--) {
      if (kind === 'source' && T.sourceTrackHidden(getState(), track)) continue;
      end += trackHeight(kind + ':' + track);
      if (y < end) return track;
    }
    return 1;
  }
  function trackResizeHandle(key, label) {
    return (
      '<div class="track-resize" data-track-resize="' +
      key +
      '" role="separator" aria-orientation="horizontal" aria-label="Resize ' +
      label +
      '" tabindex="0" title="Drag to resize ' +
      label +
      '; double-click to reset"></div>'
    );
  }
  function setStyle(node, key, value) {
    if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value);
  }
  // Tracks share the timeline's height in proportion to the heights they are set to.
  function fitTracks(count) {
    const keys = [];
    for (let track = count; track > 0; track--) {
      keys.push('video:' + track);
      if (!T.sourceTrackHidden(getState(), track)) keys.push('source:' + track);
    }
    if (!getState().audioTracks?.musicHidden) keys.push('music');
    const wanted = keys.reduce((sum, key) => sum + preferredTrackHeight(key), 0),
      room = $('timelineScroll').clientHeight - $('ruler').offsetHeight;
    const fit = room > 0 && wanted > room ? room / wanted : 1;
    setTrackFit(fit);
    $('editor').classList.toggle('tracks-fitted', fit < 1);
  }
  function applyTrackHeights() {
    const editor = $('editor'),
      count = T.videoTracks(getState());
    fitTracks(count);
    for (const kind of ['video', 'source']) {
      let top = 0;
      for (let track = count; track > 0; track--) {
        const height =
          kind === 'source' && T.sourceTrackHidden(getState(), track) ? 0 : trackHeight(kind + ':' + track);
        setStyle(editor, trackVariable(kind, track, 'top'), top + 'px');
        setStyle(editor, trackVariable(kind, track, 'height'), height + 'px');
        top += height;
      }
      $(kind === 'video' ? 'clipLane' : 'audioLane').style.height = top + 'px';
    }
    $('musicLane').hidden = $('musicTrackHeader').hidden = !!getState().audioTracks?.musicHidden;
    setStyle(editor, '--music-height', trackHeight('music') + 'px');
    $('musicLane').style.height = trackHeight('music') + 'px';
    for (const handle of $('trackHeaders').querySelectorAll('[data-track-resize]')) {
      const key = handle.dataset.trackResize,
        b = trackHeightBounds(key);
      handle.setAttribute('aria-valuemin', b.min);
      handle.setAttribute('aria-valuemax', b.max);
      handle.setAttribute('aria-valuenow', Math.round(trackHeight(key)));
      handle.setAttribute('aria-valuetext', Math.round(trackHeight(key)) + ' pixels');
    }
    $('trackHeaders').style.transform = 'translateY(-' + $('timelineScroll').scrollTop + 'px)';
  }
  function storeTrackHeights() {
    try {
      localStorage.setItem(trackHeightsKey, JSON.stringify(trackHeights));
    } catch (error) {}
  }
  function renderAudioTrackHeaders(count) {
    const header = $('sourceTrackHeader'),
      key = 'source:' + count;
    header.hidden = T.sourceTrackHidden(getState(), count);
    header.style.height = 'var(--source-height-' + count + ')';
    header.querySelector('.track-title b').textContent = count > 1 ? 'A1 / V' + count : 'A1';
    header.title = 'Clip audio from V' + count + '. M/S controls affect all A1 clip audio.';
    if (header.querySelector('[data-track-resize]')?.dataset.trackResize !== key) {
      header.querySelector('[data-track-resize]')?.remove();
      header.insertAdjacentHTML('beforeend', trackResizeHandle(key, 'A1 clip audio from V' + count));
    }
    draw(
      'sourceExtraTrackLabels',
      Array.from({ length: count - 1 }, (_, i) => {
        const track = count - i - 1;
        if (T.sourceTrackHidden(getState(), track)) return '';
        return (
          '<div class="track-label audio source-track-label" style="height:var(--source-height-' +
          track +
          ')"><span class="track-title"><b>A1 / V' +
          track +
          '</b><small>Clip audio</small></span>' +
          trackResizeHandle('source:' + track, 'A1 clip audio from V' + track) +
          '</div>'
        );
      }).join(''),
    );
    const music = $('musicTrackHeader');
    music.style.height = 'var(--music-height)';
    if (!music.querySelector('[data-track-resize]'))
      music.insertAdjacentHTML('beforeend', trackResizeHandle('music', 'A2 soundtrack'));
  }
  return { trackAt, trackResizeHandle, setStyle, applyTrackHeights, storeTrackHeights, renderAudioTrackHeaders };
}
