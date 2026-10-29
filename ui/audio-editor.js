import * as T from './timeline.js';

// Live getters and narrow actions keep this owner independent of editor initialization.
export function createAudioEditor({
  $,
  copy,
  esc,
  svg,
  url,
  getFps,
  defaultAudioTracks,
  getInspectorTab,
  writeInspectorTab,
  getState,
  getPpf,
  review,
  history,
  edits,
  selected,
  getActiveVideoTrack,
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
  getViewer,
  getPause,
  getSyncAudio,
  selectedAudio,
  getAudioSettings,
  getTrackAudible,
  selectAudio,
  refreshGestureHints,
}) {
  function audioButtons() {
    for (const id of ['monitorMute']) {
      $(id).innerHTML = svg(getState().muted ? 'mute' : 'volume') + '<span>Monitor</span>';
      $(id).classList.toggle('active', getState().muted);
      $(id).setAttribute('aria-pressed', getState().muted);
      $(id).setAttribute('aria-label', getState().muted ? 'Unmute monitor' : 'Mute monitor');
      $(id).title = (getState().muted ? 'Unmute' : 'Mute') + ' monitor (export mix unchanged)';
    }
    const tracks = getState().audioTracks || defaultAudioTracks;
    for (const [id, key] of [
      ['trackMute', 'sourceMuted'],
      ['trackSolo', 'sourceSolo'],
      ['musicMute', 'musicMuted'],
      ['musicSolo', 'musicSolo'],
    ]) {
      $(id).classList.toggle('active', !!tracks[key]);
      $(id).setAttribute('aria-pressed', !!tracks[key]);
    }
    getViewer().updateMonitor();
    getSyncAudio()();
  }
  function audioWave(c, m) {
    const length = c.out - c.in,
      a = getAudioSettings()(c),
      level = clamp((a.gainDb + 60) / 66, 0, 1);
    return (
      (m.wave
        ? '<img src="' +
          esc(url(m.wave)) +
          '" alt="" style="width:' +
          (m.frames / length) * 100 +
          '%;left:' +
          (-c.in / length) * 100 +
          '%">'
        : '') +
      '<span class="audio-gain-line" style="top:' +
      (100 - level * 75) +
      '%"></span><svg class="audio-fade" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 100L' +
      (a.fadeIn / length) * 100 +
      ' 0M' +
      (100 - (a.fadeOut / length) * 100) +
      ' 0L100 100" stroke="#a7e4be" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/></svg><div class="audio-fade-handle in" data-fade="in" style="left:' +
      (a.fadeIn / length) * 100 +
      '%" title="Drag fade in"></div><div class="audio-fade-handle out" data-fade="out" style="right:' +
      (a.fadeOut / length) * 100 +
      '%" title="Drag fade out"></div>'
    );
  }
  function renderAudioTimeline(rows, refresh = true) {
    const independent = track =>
      (getState().audioClips || [])
        .filter(
          c => T.audioTrack(c) === track && (track !== 'source' || !T.sourceTrackHidden(getState(), T.sourceLane(c))),
        )
        .map(
          c =>
            '<div class="audio-clip music-clip' +
            (!T.enabled(c) || getAudioSettings()(c).muted || !getTrackAudible()(track) ? ' muted' : '') +
            '" data-audio="' +
            c.id +
            '" style="top:calc(' +
            (track === 'source' ? 'var(--source-top-' + T.sourceLane(c) + ')' : '0px') +
            ' + 5px);height:calc(' +
            (track === 'source' ? 'var(--source-height-' + T.sourceLane(c) + ')' : 'var(--music-height)') +
            ' - 10px);left:' +
            c.start * getPpf() +
            'px;width:' +
            (c.out - c.in) * getPpf() +
            'px" tabindex="0" role="button" aria-pressed="false" aria-label="' +
            esc(c.name) +
            ' independent audio clip" title="Independent audio: drag to move; drag edges to trim">' +
            audioWave(c, c.media) +
            '<span class="audio-name"><span class="audio-title">' +
            esc(c.name) +
            '</span>' +
            clipAttention(c, false) +
            '</span><div class="trim-handle in" data-audio-trim="in"></div><div class="trim-handle out" data-audio-trim="out"></div></div>',
        )
        .join('');
    draw(
      'audioLane',
      Array.from({ length: T.videoTracks(getState()) }, (_, i) => {
        const track = T.videoTracks(getState()) - i;
        return (
          '<div class="audio-track-lane" style="top:var(--source-top-' +
          track +
          ');height:var(--source-height-' +
          track +
          ')"></div>'
        );
      }).join('') +
        rows
          .filter(r => !r.clip.audioDetached && !T.sourceTrackHidden(getState(), T.videoTrack(r.clip)))
          .map(({ clip: c, start }) => {
            const m = take(c).media,
              muted = !T.videoEnabled(getState(), c) || getAudioSettings()(c).muted || !getTrackAudible()('source');
            return (
              '<div class="audio-clip ' +
              (!m.audio ? 'no-audio' : '') +
              (muted ? ' muted' : '') +
              '" data-linked-audio="' +
              c.id +
              '" style="top:calc(var(--source-top-' +
              T.videoTrack(c) +
              ') + 5px);height:calc(var(--source-height-' +
              T.videoTrack(c) +
              ') - 10px);left:' +
              start * getPpf() +
              'px;width:' +
              (c.out - c.in) * getPpf() +
              'px" title="' +
              esc(c.name) +
              ' - audio linked to video">' +
              (m.audio
                ? audioWave(c, m) + '<span class="audio-name">' + svg('link') + ' ' + esc(c.name) + '</span>'
                : '<span class="no-audio-label">No audio</span>') +
              '</div>'
            );
          })
          .join('') +
        independent('source'),
    );
    $('audioLane')
      .querySelectorAll('[data-linked-audio]')
      .forEach(n => {
        if (n.classList.contains('no-audio')) return;
        if (!n.querySelector('[data-trim]'))
          n.insertAdjacentHTML(
            'beforeend',
            '<div class="trim-handle in" data-trim="in"></div><div class="trim-handle out" data-trim="out"></div>',
          );
        n.onpointerdown = e =>
          e.target.closest('[data-fade]')
            ? startFadeDrag(e, n.dataset.linkedAudio, false)
            : startClipDrag(e, n.dataset.linkedAudio);
      });
    draw(
      'musicLane',
      independent('music') ||
        '<button class="music-empty" id="musicEmpty">+ Add audio - or drop an audio or video file here</button>',
    );
    for (const lane of ['audioLane', 'musicLane'])
      $(lane)
        .querySelectorAll('[data-audio]')
        .forEach(n => {
          n.onpointerdown = e =>
            e.target.closest('[data-fade]')
              ? startFadeDrag(e, n.dataset.audio, true)
              : startAudioDrag(e, n.dataset.audio);
          n.onkeydown = e => {
            if (e.key === 'Enter') {
              selectAudio(n.dataset.audio, e);
              e.preventDefault();
            }
          };
        });
    if ($('musicEmpty')) $('musicEmpty').onclick = () => $('audioFiles').click();
    syncTimelineSelection();
    if (refresh) refreshGestureHints();
  }
  function renderAudioInspector() {
    const c = selectedAudio() || selected(),
      bed = !!selectedAudio();
    $('clipName').value = c?.name || 'Audio';
    $('generateLabel').textContent = selected() ? 'Generate ' + selected().count + ' takes' : 'Generate takes';
    if (!c) {
      draw(
        'inspectorContent',
        '<p class="audio-note">Import music or voiceover to A2. Audio follows the sequence clock, independently of the video edit.</p>',
      );
      return;
    }
    if (!bed && c.audioDetached) {
      draw(
        'inspectorContent',
        '<div class="group-label">Video only</div><p class="audio-note">Audio has been unlinked. Select its separate clip on A1 to adjust it.</p>',
      );
      return;
    }
    const m = bed ? c.media : take(c).media,
      a = getAudioSettings()(c),
      max = (c.out - c.in) / getFps() / 2;
    const html =
      '<div class="group-label">' +
      (bed ? (T.audioTrack(c) === 'source' ? 'Independent clip audio' : 'Soundtrack') : 'Linked clip audio') +
      '<span>' +
      svg(bed ? 'audio' : 'link') +
      '</span></div><p class="audio-summary">' +
      seconds(c.out - c.in) +
      ' · ' +
      (bed ? 'at ' + tc(c.start) : takeName(take(c))) +
      '</p>' +
      (m.audio
        ? '<div class="audio-controls"><div><label class="field"><span class="audio-level-head">Level <input id="audioGainNumber" type="number" min="-60" max="6" step="1" value="' +
          a.gainDb +
          '" aria-label="Audio level in decibels"></span><input id="audioGain" type="range" min="-60" max="6" step="1" value="' +
          a.gainDb +
          '" aria-label="Audio level"><span class="small">dB · double-click slider to reset</span></label><button class="outline' +
          (a.muted ? ' active' : '') +
          '" id="clipAudioMute" aria-pressed="' +
          a.muted +
          '">' +
          svg(a.muted ? 'mute' : 'volume') +
          (a.muted ? 'Clip muted' : 'Mute this clip') +
          '</button></div><div class="two-fields"><label class="field"><span>Fade in (s)</span><input id="audioFadeIn" type="number" min="0" max="' +
          max +
          '" step=".1" value="' +
          (a.fadeIn / getFps()).toFixed(2) +
          '"></label><label class="field"><span>Fade out (s)</span><input id="audioFadeOut" type="number" min="0" max="' +
          max +
          '" step=".1" value="' +
          (a.fadeOut / getFps()).toFixed(2) +
          '"></label></div><div><p class="audio-note">' +
          (bed
            ? 'Audio stays at its timeline position when the video edit ripples. Trim or move this clip directly on its audio track.'
            : "This is the chosen take's audio. Video trims, rolls, and slips keep it in sync. Unlink audio and video to edit them independently.") +
          '</p><p class="audio-note">Track M/S buttons change the saved mix. Monitor mute only changes what you hear.</p></div></div>'
        : '<p class="audio-note">This take has no audio. Import music or voiceover to the soundtrack lane.</p><button class="outline" id="audioAdd">' +
          svg('import') +
          ' Import audio</button>');
    if (!draw('inspectorContent', html)) return;
    if ($('audioAdd')) $('audioAdd').onclick = () => $('audioFiles').click();
    if (!m.audio) return;
    const commit = (key, value, label) => {
      const clip = selectedAudio() || selected(),
        current = getAudioSettings()(clip);
      if (current[key] === value) return;
      edits.apply(
        label,
        () => {
          clip.audio = { ...current, [key]: value };
        },
        'audio',
      );
    };
    const gain = $('audioGain');
    gain.onpointerup = () => $('editor').focus({ preventScroll: true });
    let before = null;
    gain.oninput = () => {
      const clip = selectedAudio() || selected();
      if (!clip) return;
      if (!before) before = copy(getState());
      clip.audio = { ...getAudioSettings()(clip), gainDb: Number(gain.value) };
      $('audioGainNumber').value = gain.value;
      getSyncAudio()();
    };
    gain.onchange = () => {
      const clip = selectedAudio() || selected(),
        original = clip && [...(before?.audioClips || []), ...(before?.clips || [])].find(x => x.id === clip.id);
      if (original && getAudioSettings()(original).gainDb !== Number(gain.value))
        history.record(before, 'Adjust ' + clip.name + ' audio level');
      before = null;
      renderAudioTimeline(layout());
      save();
      buttons();
    };
    gain.ondblclick = () => {
      commit('gainDb', 0, 'Reset audio level');
      renderInspector();
    };
    $('audioGainNumber').onchange = e => {
      const value = Number(e.target.value);
      if (!Number.isFinite(value)) {
        renderInspector();
        return;
      }
      commit('gainDb', clamp(value, -60, 6), 'Adjust audio level');
      renderInspector();
    };
    for (const [id, key] of [
      ['audioFadeIn', 'fadeIn'],
      ['audioFadeOut', 'fadeOut'],
    ])
      $(id).onchange = e => {
        const value = Number(e.target.value);
        if (!Number.isFinite(value)) {
          renderInspector();
          return;
        }
        commit(
          key,
          clamp(Math.round(value * getFps()), 0, Math.floor((c.out - c.in) / 2)),
          'Adjust ' + (key === 'fadeIn' ? 'fade in' : 'fade out'),
        );
        renderInspector();
      };
    $('clipAudioMute').onclick = () => {
      const clip = selectedAudio() || selected();
      if (!clip) return;
      commit(
        'muted',
        !getAudioSettings()(clip).muted,
        (getAudioSettings()(clip).muted ? 'Unmute ' : 'Mute ') + clip.name,
      );
      renderInspector();
    };
  }
  function addAudioClip(m, start = Math.round(getState().frame), track = 'music', lane = getActiveVideoTrack()) {
    if (!m || !m.audio) {
      toast('This file has no audio stream');
      return;
    }
    getPause()();
    edits.apply('Add ' + m.name + ' audio', () => {
      const c = T.addAudioClip(getState(), m, start, 'audio-' + crypto.randomUUID(), { track, fullLength: true, lane });
      getState().selectedAudio = c.id;
      review.rememberMedia(c.media, c.in);
      writeInspectorTab('audio');
      editView();
    });
    toast('Audio added to ' + (track === 'source' ? 'A1' : 'A2') + ' · unmute the monitor to listen');
  }
  function splitAudio() {
    const c = selectedAudio(),
      offset = Math.round(getState().frame - c.start);
    if (!c || offset < 6 || offset > c.out - c.in - 6) {
      toast('Place the playhead inside the audio clip, away from its edges');
      return;
    }
    edits.apply('Split audio', () => {
      getPause()();
      const d = T.splitAudio(getState(), getState().frame, 'audio-' + crypto.randomUUID(), c.id);
      getState().selectedAudio = d.id;
    });
  }
  return { audioButtons, renderAudioTimeline, renderAudioInspector, addAudioClip, splitAudio };
}
