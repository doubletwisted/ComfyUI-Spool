import * as T from './timeline.js';
import { pictureAt } from './picture.js';
import { createPreviews, QUALITY } from './preview.js';
import { videoFrameCount } from './video-seek-guard.js';

// Owns viewer presentation, media elements, seeking and the playback clock.
export function createViewer({
  getState,
  getPixelScale,
  isTimelinePanning,
  resetProjectPoll,
  refreshTrimPreview,
  getSeekGuard,
  $,
  review,
  thumbnails,
  clamp,
  total,
  resolution,
  getFps,
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
  textStatus,
  toast,
  diagnostics,
  hideTrimPreview,
  sourceLength,
  comparisonTakes,
  comparisonVideos,
  layout,
  save,
  saveView,
  trackAudible,
  audioEnvelope,
  fileUrl,
}) {
  const setStatus = textStatus;
  const url = fileUrl;
  const pool = new Map(),
    audioPlayers = new Map();
  let shownVideo = null,
    playing = false,
    raf = 0,
    previousTime = 0;
  let audioContext = null,
    masterGain = null,
    audioAnalyser = null;
  function setFrame(frame, force = false) {
    if (!playing) thumbnails.stopScrub();
    if (review.mode === 'source' && review.source) review.seek(frame);
    else getState().frame = clamp(frame, 0, total());
    updateViewer(force);
  }
  function viewerData() {
    return pictureAt(getState(), review, getState().frame);
  }
  function text(id, value) {
    if ($(id).textContent !== value) $(id).textContent = value;
  }
  const placeholderState = document.createElement('div');
  placeholderState.id = 'placeholderState';
  placeholderState.className = 'empty-stage';
  placeholderState.hidden = true;
  placeholderState.setAttribute('role', 'status');
  placeholderState.innerHTML =
    '<span class="empty-symbol">' +
    svg('nodes') +
    '</span><strong id="placeholderTitle"></strong><p id="placeholderHint"></p>';
  $('emptyStage').after(placeholderState);
  function renderPlaceholderState(d = viewerData()) {
    placeholderState.hidden = !d?.take?.placeholder;
    if (!placeholderState.hidden) {
      const available = T.realTakes(d.clip).length > 0;
      text('placeholderTitle', available ? 'Choose a take' : 'Not generated yet');
      text(
        'placeholderHint',
        available
          ? 'Generated takes are ready in Takes. Use a take to add it to the edit.'
          : 'Generate a take to preview this clip.',
      );
    }
  }
  function viewerHead(d) {
    $('previewQuality').value = previewQuality();
    const size = resolution();
    for (const option of $('previewQuality').options) {
      const divisor = { full: 1, half: 2, quarter: 4 }[option.value],
        label =
          (divisor === 1 ? 'Full' : divisor === 2 ? '1/2' : '1/4') +
          ' · ' +
          previewDimension(size.width, divisor) +
          ' × ' +
          previewDimension(size.height, divisor);
      if (option.textContent !== label) option.textContent = label;
    }
    const src = review.mode === 'source',
      c = d?.clip,
      t = d?.take,
      tried = review.audition && getState().clips.find(c => c.id === review.audition.clipId),
      trial = tried?.takes.find(t => t.id === review.audition.takeId);
    $('viewer').classList.toggle('source-mode', src);
    $('viewer').classList.toggle('audition', !src && !!trial);
    $('sourceTab').classList.toggle('active', src);
    $('editTab').classList.toggle('active', !src);
    $('sourceTab').setAttribute('aria-selected', src);
    $('editTab').setAttribute('aria-selected', !src);
    $('sourceTab').disabled = !review.source && !getState().clips.length;
    draw(
      'viewerContext',
      src
        ? c
          ? '<b>' +
            esc(c.name) +
            '</b> · ' +
            takeName(t) +
            ' · ' +
            (t.id === c.takeId
              ? '<span class="in-edit">in edit</span>'
              : '<span class="not-in-edit">not in edit</span>')
          : '<b>Media</b> · ' + esc(review.source?.media.name || '')
        : trial
          ? '<span class="not-in-edit">Trying ' +
            takeName(trial) +
            ' in ' +
            esc(tried.name) +
            '</span> · not saved until you use it'
          : '<b>Sequence 01</b> · ' +
            getState().clips.length +
            ' ' +
            (getState().clips.length === 1 ? 'clip' : 'clips'),
    );
    const usable = src ? c && t.id !== c.takeId && t : trial;
    $('useSource').hidden = !usable;
    if (usable) text('useSource', 'Use ' + takeName(usable));
    $('tryInEdit').hidden = !(src && c);
    if (src && c)
      $('tryInEdit').querySelector('.label').textContent = t.id === c.takeId ? 'Watch in edit' : 'Try in edit';
    $('cancelAudition').hidden = src || !trial;
    const compare = !!comparisonTakes(),
      canCompare = !selectedAudio() && selected()?.takes.length > 1;
    for (const id of ['compareTakes', 'compareTakesStrip']) {
      $(id).hidden = !canCompare;
      $(id).setAttribute('aria-pressed', compare);
      text(id, compare ? 'Close compare' : 'Compare');
    }
    $('editor').classList.toggle('compare-active', compare);

    if (T.realTakes(selected()).length < 2) for (const id of ['compareTakes', 'compareTakesStrip']) $(id).hidden = true;
  }
  let currentClip = null;
  function updateViewer(force = false) {
    const d = viewerData(),
      src = review.mode === 'source';
    $('emptyStage').hidden = !!d;
    $('emptyStage').classList.toggle('in-gap', !!(getState().clips.length || getState().audioClips?.length));
    renderPlaceholderState(d);
    viewerHead(d);
    if (!d) {
      showMedia(null);
      draw('viewerOverlay', '');
      text('timelineTime', tc(getState().frame));
      text('viewerTime', tc(0));
      text('viewerDuration', tc(0));
      $('seek').max = 0;
      $('scrubBand').hidden = true;
      return;
    }
    const pos = src ? review.frame : getState().frame;
    text('timelineTime', tc(getState().frame));
    text('viewerTime', tc(pos));
    text('viewerDuration', tc(d.length));
    $('seek').max = d.length;
    $('seek').value = pos;
    const band = $('scrubBand');
    band.hidden = !(src && d.clip);
    if (src && d.clip) {
      band.style.left = (d.clip.in / d.length) * 100 + '%';
      band.style.width = ((Math.min(d.clip.out, d.length) - d.clip.in) / d.length) * 100 + '%';
    }
    $('viewerDuration').title = src ? 'Full source duration' : 'Timeline duration';
    $('seek').title =
      src && d.clip
        ? 'Full source · amber bar shows the current shot trim (' + seconds(d.clip.out - d.clip.in) + ')'
        : '';
    $('playhead').style.left = getState().frame * getPixelScale() + 'px';
    const trial = !src && !d.gap && review.audition?.takeId === d.take.id;
    draw(
      'viewerOverlay',
      src
        ? ''
        : d.gap
          ? '<span>Gap</span>'
          : '<span>' +
            esc(d.clip.name) +
            '</span><span class="' +
            (trial ? 'preview-only' : 'in-edit') +
            '">' +
            (d.take.placeholder ? 'No take in edit' : takeName(d.take)) +
            (trial ? ' · trial' : '') +
            '</span>',
    );
    if (!src && d.clipId !== currentClip) {
      currentClip = d.clipId;
      $('clipLane')
        .querySelectorAll('[data-clip]')
        .forEach(n => n.classList.toggle('current', n.dataset.clip === currentClip));
    }
    if (comparisonTakes()) showTakeComparison(force);
    else {
      $('takeCompare').hidden = true;
      showMedia(d.take?.placeholder ? null : d.media, d.frame, force);
    }
    if (!playing || force) applyViewerZoom();
    syncAudio(d);
    if (!src && d.next) {
      const n = d.next.clip,
        m = ((review.audition?.clipId === n.id && n.takes.find(t => t.id === review.audition.takeId)) || take(n)).media;
      if (m.kind === 'video') {
        const v = videoFor(m);
        if (v && v !== shownVideo) {
          videoTiming(v, m);
          seekVideo(v, n.in / getFps());
        }
      }
    }
    if (playing && !src && !isTimelinePanning()) {
      const x = getState().frame * getPixelScale(),
        sc = $('timelineScroll');
      if (x - sc.scrollLeft > sc.clientWidth - 35) sc.scrollLeft = x - sc.clientWidth + 80;
    }
  }
  function showTakeComparison(force = false) {
    const takes = comparisonTakes(),
      stage = $('takeCompare');
    stage.hidden = false;
    $('still').hidden = true;
    const videos = takes.map((t, i) => {
      const pane = $('comparePane' + i),
        v = t.media.kind === 'video' ? videoFor(t.media, 'compare:' + i + ':' + t.media.file) : null,
        img = $('compareImage' + i),
        end = review.frame >= t.media.frames;
      pane.classList.toggle('active', i === review.comparison.active);
      $('compareSelect' + i).setAttribute('aria-pressed', i === review.comparison.active);
      text('compareName' + i, takeName(t));
      text(
        'compareBadge' + i,
        [t.id === selected()?.takeId ? 'In edit' : '', i === review.comparison.active ? 'Audio' : '']
          .filter(Boolean)
          .join(' · '),
      );
      $('compareBadge' + i).classList.toggle('used', t.id === selected()?.takeId);
      text('compareTime' + i, tc(Math.min(review.frame, t.media.frames - 1)));
      text('compareEnd' + i, end ? 'End of take' : '');
      img.hidden = t.media.kind !== 'image';
      const file = previewFile(t.media);
      if (!file) img.hidden = true;
      else if (!img.hidden && img.dataset.file !== file) {
        img.dataset.file = file;
        img.src = file;
      }
      if (v) {
        const picture = $('comparePicture' + i);
        if (v.parentElement !== picture) picture.prepend(v);
        videoTiming(v, t.media);
        v.hidden = false;
        const frame = Math.min(review.frame, t.media.frames - 1);
        if (force || !playing || end || Math.abs(videoTime(v) - frame / getFps()) > 0.075)
          seekVideo(v, frame / getFps());
        if (playing && !end && v.paused) v.play().catch(() => {});
        if (end && !v.paused) v.pause();
      }
      return v;
    });
    for (const v of pool.values())
      if (!videos.includes(v)) {
        v.hidden = true;
        v.classList.remove('front');
        if (!v.paused) v.pause();
      }
    const lead = takes[0].media.frames >= takes[1].media.frames ? 0 : 1;
    shownVideo = videos[lead];
    if (shownVideo?.videoWidth) text('viewerResolution', shownVideo.videoWidth + ' × ' + shownVideo.videoHeight);
  }
  function previewQuality() {
    return ['full', 'half', 'quarter'].includes(getState().previewQuality) ? getState().previewQuality : 'full';
  }
  function previewDimension(value, divisor) {
    return Math.max(2, Math.round(value / divisor / 2) * 2);
  }
  function previewTarget() {
    const size = resolution(),
      quality = previewQuality(),
      divisor = QUALITY[quality];
    return {
      width: previewDimension(size.width, divisor),
      height: previewDimension(size.height, divisor),
      fps: getFps(),
      quality,
    };
  }
  // Preparing a preview states the size it wants, so it never has to save the project
  // for the server to read one from the document.
  const previews = createPreviews({
    target: previewTarget,
    request: async (m, size) => {
      try {
        return await request('projects/' + projectKey + '/media/' + encodeURIComponent(m.id) + '/preview', size);
      } catch (error) {
        // Media added in this session is not on the server until the next save; register
        // it, then retry once. Routine preparation stays save-free.
        if (error.status !== 400 && error.status !== 404) throw error;
        await flushNative();
        return request('projects/' + projectKey + '/media/' + encodeURIComponent(m.id) + '/preview', size);
      }
    },
    changed: (m, entry) => {
      if (entry.getState() === 'failed') {
        text('viewerResolution', 'Preview unavailable');
        setStatus('Playback preparation failed');
        toast(entry.error);
        return;
      }
      updateViewer();
      refreshTrimPreview();
    },
  });
  function previewFile(m) {
    if (!m.id || !['video', 'image'].includes(m.kind)) return url(m.file);
    const entry = previews.status(m);
    if (entry.getState() === 'failed') {
      text('viewerResolution', 'Preview unavailable');
      return m.kind === 'image' ? url(m.file) : null;
    }
    if (entry.getState() === 'preparing') {
      text(
        'viewerResolution',
        'Preparing ' + (previewQuality() === 'full' ? 'Full' : previewQuality() === 'half' ? '1/2' : '1/4') + '…',
      );
      return m.kind === 'image' ? url(m.file) : null;
    }
    return entry.file ? url(entry.file) : m.kind === 'image' ? url(m.file) : null;
  }
  function videoTime(v) {
    return Math.max(0, v.currentTime - Number(v.dataset.sourceOffset || 0));
  }
  const reviewSources = new Map();
  function reviewSource(m, rate = getFps()) {
    if (m.frameRateMode !== 'interpret' || (m.review?.frameRateMode === 'interpret' && m.sequenceFps === rate))
      return { file: m.file, offset: 0 };
    const key = (m.originalFile || m.file) + '|' + rate;
    let entry = reviewSources.get(key);
    if (!entry) {
      entry = {};
      reviewSources.set(key, entry);
      entry.pending = request('projects/' + projectKey + '/media/' + encodeURIComponent(m.id) + '/preview', {
        divisor: 4,
        width: 320,
        height: 180,
        fps: rate,
      })
        .then(result => {
          entry.file = result.file;
          entry.pending = null;
          updateViewer();
        })
        .catch(error => {
          reviewSources.delete(key);
          throw error;
        });
    }
    return { ...entry, offset: (m.sourceRange?.start || 0) / rate };
  }
  function videoTiming(v, m) {
    v.dataset.sourceOffset = (m.sourceRange?.start || 0) / getFps();
    v.dataset.frames = m.frames;
  }
  function videoSource(v, m) {
    videoTiming(v, m);
    v.src = previewFile(m);
  }
  function videoFor(m, key) {
    const file = previewFile(m);
    if (!file) return null;
    key = (key || file) + '|' + previewQuality() + '|' + file;
    let v = pool.get(key);
    if (v) {
      pool.delete(key);
      pool.set(key, v);
      return v;
    }
    v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.playsInline = true;
    v.muted = getState().muted;
    v.hidden = true;
    v.onloadedmetadata = () => {
      if (v.seekTarget !== undefined) seekVideo(v, v.seekTarget);
      if (v === shownVideo) text('viewerResolution', v.videoWidth + ' × ' + v.videoHeight);
      applyViewerZoom();
    };
    v.onseeked = () => {
      if (v.seekPending) {
        v.seekPending = false;
        seekVideo(v, v.seekTarget);
      } else if (v === shownVideo) reveal(v);
    };
    v.onloadeddata = () => {
      if (v === shownVideo && !v.seeking) reveal(v);
    };
    v.oncanplay = () => {
      if (
        playing &&
        v.paused &&
        (v === shownVideo || comparisonVideos().includes(v)) &&
        (!v.closest('.compare-pane') || review.frame < Number(v.dataset.frames))
      )
        v.play().catch(() => {});
    };
    v.onerror = () => {
      const message = 'Playback unavailable · check the saved source or import it again';
      setStatus(message);
      toast(message);
    };
    videoSource(v, m);
    $('viewerStage').insertBefore(v, $('still'));
    pool.set(key, v);
    for (const [file, old] of pool) {
      if (pool.size <= 6) break;
      if (old !== shownVideo && old !== v && !comparisonVideos().includes(old)) {
        releaseMedia(old);
        pool.delete(file);
      }
    }
    return v;
  }
  function seekVideo(v, time) {
    const previous = v.currentTime,
      count = v.tagName === 'VIDEO' ? videoFrameCount(v) : null;
    try {
      v.seekTarget = time;
      if (v.readyState < 1 || v.seeking) {
        v.seekPending = v.seeking;
        return;
      }
      // Boundary timestamps can decode the previous frame. Audio keeps its exact clock.
      const video = v.tagName === 'VIDEO',
        precise = video ? (Math.floor(Math.max(0, time) * getFps() + 1e-7) + 0.5) / getFps() : time;
      const offset = Number(v.dataset.sourceOffset || 0),
        end = video ? Math.min(v.duration, offset + Number(v.dataset.frames) / getFps()) : v.duration;
      const target = clamp(precise + offset, offset, Math.max(offset, end - (video ? 0.5 / getFps() : 0)));
      v.decodeTarget = target;
      if (Math.abs(v.currentTime - target) > 1e-5) v.currentTime = target;
      else if (v === shownVideo && v.readyState >= 2) reveal(v);
    } finally {
      if (v.tagName === 'VIDEO') getSeekGuard().observe(v, time, previous, count);
    }
  }
  function reveal(v) {
    if (v.closest('.compare-pane') || v !== shownVideo || v.classList.contains('front')) return;
    for (const other of pool.values())
      if (other !== v) {
        other.hidden = true;
        other.classList.remove('front');
        if (!other.paused) other.pause();
      }
    v.classList.add('front');
  }
  let finishStill = null;
  function loadStill(img, file) {
    finishStill?.();
    const finish = diagnostics.start('Decoding image', { background: true });
    finishStill = finish;
    img.onload = () => {
      if (finishStill === finish) {
        finish();
        finishStill = null;
      }
    };
    img.onerror = () => {
      if (finishStill === finish) {
        finish(Error('Image could not be decoded'));
        finishStill = null;
      }
    };
    img.dataset.file = file;
    img.src = file;
  }
  function showMedia(m, frame, force) {
    if (m?.kind === 'audio') {
      if (shownVideo) {
        shownVideo.pause();
        shownVideo = null;
      }
      for (const v of pool.values()) {
        v.hidden = true;
        v.classList.remove('front');
      }
      const a = audioFor('source:' + m.file, m);
      if (a && (force || !playing || Math.abs(videoTime(a) - frame / getFps()) > 0.2)) seekVideo(a, frame / getFps());
      const img = $('still'),
        file = m.wave || m.poster;
      img.hidden = !file;
      if (file && img.dataset.file !== file) {
        img.dataset.file = file;
        img.src = url(file);
      }
      if (playing && a?.paused) a.play().catch(() => {});
      return;
    }
    const still = $('still'),
      v = m?.kind === 'video' ? videoFor(m) : null;
    if (v !== shownVideo) {
      shownVideo?.pause();
      shownVideo = v;
      force = true;
      if (v) v.hidden = false;
      else
        for (const other of pool.values()) {
          other.hidden = true;
          other.classList.remove('front');
        }
    }
    if (v) videoTiming(v, m);
    if (force) applyViewerZoom();
    still.hidden = m?.kind !== 'image';
    if (!still.hidden) {
      const file = previewFile(m);
      if (!file) still.hidden = true;
      else if (still.dataset.file !== file) {
        loadStill(still, file);
      }
    }
    if (!v) return;
    if (v.videoWidth) text('viewerResolution', v.videoWidth + ' × ' + v.videoHeight);
    if (force || !playing || Math.abs(videoTime(v) - frame / getFps()) > 0.25) seekVideo(v, frame / getFps());
    if (!v.seeking && v.readyState >= 2) reveal(v);
    if (playing && v.paused) v.play().catch(() => {});
  }
  function pause() {
    if (playing) resetProjectPoll();
    playing = false;
    $('mixLevel').style.height = '0%';
    $('mixMeter').classList.remove('clipping');
    $('mixMeter').title = 'Monitor peak: silent';
    for (const a of audioPlayers.values()) a.pause();
    cancelAnimationFrame(raf);
    for (const v of pool.values()) if (!v.paused) v.pause();
    $('play').innerHTML = svg('play');
    $('play').setAttribute('aria-label', 'Play');
  }
  function play() {
    thumbnails.stopScrub();
    hideTrimPreview();
    if (!viewerData()) return;
    ensureAudioContext();
    if (playing) {
      pause();
      save();
      return;
    }
    const src = review.mode === 'source',
      len = src ? sourceLength() : total();
    if ((src ? review.frame : getState().frame) >= len - 1) setFrame(0, true);
    playing = true;
    previousTime = performance.now();
    $('play').innerHTML = svg('pause');
    $('play').setAttribute('aria-label', 'Pause');
    updateViewer();
    raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!playing) return;
    const d = viewerData(),
      src = review.mode === 'source',
      pos = src ? review.frame : getState().frame,
      v = comparisonTakes()
        ? shownVideo
        : d.media.kind === 'video'
          ? shownVideo
          : d.media.kind === 'audio'
            ? audioFor('source:' + d.media.file, d.media)
            : null;
    if (
      (['video', 'audio'].includes(d.media.kind) && !v) ||
      (d.media.kind === 'image' && !comparisonTakes() && ($('still').hidden || !$('still').complete))
    ) {
      previousTime = now;
      raf = requestAnimationFrame(tick);
      return;
    }
    let value = pos;
    if (!v) value += Math.min((now - previousTime) / 1000, 0.25) * getFps();
    else if (v.ended || (!v.paused && !v.seeking && v.readyState >= 3)) {
      const frame = v.ended ? Infinity : videoTime(v) * getFps();
      value = src ? Math.min(frame, d.length) : Math.max(pos, Math.min(d.row.end, d.row.start + frame - d.clip.in));
    }
    previousTime = now;
    if (value >= d.length) {
      if (src || getState().loop) setFrame(0, true);
      else {
        setFrame(d.length, true);
        pause();
        save();
        return;
      }
    } else setFrame(value);
    raf = requestAnimationFrame(tick);
  }
  function skip(direction) {
    pause();
    if (review.mode === 'source' && review.source) {
      setFrame(direction < 0 ? 0 : sourceLength(), true);
      return;
    }
    const points = [0, ...layout().map(r => r.start), total()].sort((a, b) => a - b);
    const target =
      direction < 0 ? points.filter(p => p < getState().frame - 1).at(-1) : points.find(p => p > getState().frame + 1);
    setFrame(target === undefined ? (direction < 0 ? 0 : total()) : target, true);
    save();
  }
  function frameStep(delta) {
    hideTrimPreview();
    pause();
    const src = review.mode === 'source' && review.source,
      length = src ? sourceLength() : total(),
      frame = Math.floor((src ? review.frame : getState().frame) + 1e-7) + delta;
    setFrame(clamp(frame, 0, Math.max(0, length - 1)), true);
    saveView();
  }
  function ensureAudioContext() {
    if (!audioContext) {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
      masterGain.connect(audioAnalyser);
      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.005;
      limiter.release.value = 0.05;
      audioAnalyser.connect(limiter);
      limiter.connect(audioContext.destination);
      masterGain.gain.value = getState().muted ? 0 : 1;
    }
    if (audioContext.getState() === 'suspended') audioContext.resume().catch(() => {});
  }
  function setAudioGain(element, gain) {
    if (audioContext) {
      if (!element.mixGain) {
        element.mixGain = audioContext.createGain();
        element.mixSource = audioContext.createMediaElementSource(element);
        element.mixSource.connect(element.mixGain);
        element.mixGain.connect(masterGain);
      }
      element.muted = getState().muted || !gain;
      element.volume = 1;
      element.mixGain.gain.value = gain;
    } else {
      element.muted = getState().muted || !gain;
      element.volume = clamp(gain, 0, 1);
    }
  }
  function releaseMedia(element) {
    element.pause();
    element.onloadedmetadata = element.onseeked = element.onloadeddata = element.oncanplay = element.onerror = null;
    element.mixSource?.disconnect();
    element.mixGain?.disconnect();
    element.removeAttribute('src');
    element.load();
    element.remove();
  }
  function audioFor(id, m) {
    const source = m.fps ? reviewSource(m) : { file: m.file, offset: 0 };
    if (source.pending) {
      void source.pending.catch(error => toast(error.message));
      return null;
    }
    let a = audioPlayers.get(id);
    if (a && a.dataset.file === source.file) {
      a.dataset.sourceOffset = source.offset;
      return a;
    }
    if (a) releaseMedia(a);
    a = document.createElement('audio');
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    a.src = url(source.file);
    a.dataset.file = source.file;
    a.dataset.sourceOffset = source.offset;
    a.onloadedmetadata = () => {
      if (a.seekTarget !== undefined) seekVideo(a, a.seekTarget);
    };
    a.onseeked = () => {
      if (a.seekPending) {
        a.seekPending = false;
        seekVideo(a, a.seekTarget);
      }
    };
    audioPlayers.set(id, a);
    return a;
  }
  function syncAudio(d = viewerData()) {
    const compared = comparisonTakes(),
      monitor = compared
        ? $('comparePane' + review.comparison.active).querySelector('video:not([hidden])')
        : shownVideo;
    const waitingImage = d?.media.kind === 'image' && !compared && ($('still').hidden || !$('still').complete);
    const running =
      playing &&
      !waitingImage &&
      (d?.media.kind !== 'video' ||
        (shownVideo && !shownVideo.paused && !shownVideo.seeking && shownVideo.readyState >= 3));
    for (const v of pool.values()) if (v !== monitor) setAudioGain(v, 0);
    if (monitor) {
      const gain =
        compared && review.frame >= compared[review.comparison.active].media.frames
          ? 0
          : review.mode === 'source'
            ? 1
            : 0;
      setAudioGain(monitor, d?.media.audio ? gain : 0);
    }
    const active = new Set();
    if (d && review.mode === 'source' && d.media.kind === 'audio') {
      const key = 'source:' + d.media.file,
        a = audioFor(key, d.media);
      if (a) {
        active.add(key);
        setAudioGain(a, 1);
      }
    }
    if (review.mode === 'edit')
      for (const c of [
        ...(getState().audioClips || []),
        ...layout()
          .filter(r => T.videoEnabled(getState(), r.clip) && T.linkedAudio(r.clip))
          .map(r => ({
            ...r.clip,
            id: 'linked:' + r.clip.id,
            media: (review.audition?.clipId === r.clip.id
              ? r.clip.takes.find(t => t.id === review.audition.takeId)
              : take(r.clip)
            ).media,
            start: r.start,
            track: 'source',
          })),
      ]) {
        const elapsed = getState().frame - c.start,
          key = c.id;
        if (!T.enabled(c) || elapsed < 0 || elapsed >= c.out - c.in) continue;
        const a = audioFor(key, c.media);
        if (!a) continue;
        active.add(key);
        setAudioGain(a, trackAudible(T.audioTrack(c)) ? audioEnvelope(c, elapsed) : 0);
        const time = (c.in + elapsed) / getFps();
        if (!running || Math.abs(videoTime(a) - time) > 0.12) seekVideo(a, time);
        if (running && a.paused) a.play().catch(() => {});
        else if (!running && !a.paused) a.pause();
      }
    for (const [id, a] of audioPlayers)
      if (!active.has(id)) {
        a.pause();
        if (a.mixGain) a.mixGain.gain.value = 0;
        else a.muted = true;
        if (
          (!id.startsWith('source:') && !(getState().audioClips || []).some(c => c.id === id)) ||
          audioPlayers.size > 12
        ) {
          releaseMedia(a);
          audioPlayers.delete(id);
        }
      }
    if (audioAnalyser && playing) {
      const samples = new Float32Array(audioAnalyser.fftSize);
      audioAnalyser.getFloatTimeDomainData(samples);
      const peak = samples.reduce((n, v) => Math.max(n, Math.abs(v)), 0),
        db = peak ? 20 * Math.log10(peak) : -60;
      $('mixLevel').style.height = clamp((db + 60) / 60, 0, 1) * 100 + '%';
      $('mixMeter').classList.toggle('clipping', peak >= 0.99);
      $('mixMeter').title =
        'Monitor peak: ' + (peak ? db.toFixed(1) + ' dBFS' : 'silent') + (getState().muted ? ' · monitor muted' : '');
    }
  }

  function setPreviewQuality(quality) {
    const resume = playing;
    pause();
    hideTrimPreview();
    getState().previewQuality = quality;
    previews.clear();
    shownVideo = null;
    for (const v of pool.values()) releaseMedia(v);
    pool.clear();
    updateViewer(true);
    saveView();
    setStatus('Preview ' + (quality === 'full' ? 'Full' : quality === 'half' ? '1/2' : '1/4'));
    if (resume) play();
  }
  return {
    renderPlaceholderState,
    get currentClip() {
      return currentClip;
    },
    setFrame,
    viewerData,
    text,
    updateViewer,
    previewQuality,
    previewDimension,
    previewFile,
    videoTime,
    reviewSource,
    videoTiming,
    videoSource,
    videoFor,
    seekVideo,
    loadStill,
    showMedia,
    pause,
    play,
    skip,
    frameStep,
    ensureAudioContext,
    setAudioGain,
    releaseMedia,
    audioFor,
    syncAudio,
    setPreviewQuality,
    previews,
    get playing() {
      return playing;
    },
    get shownVideo() {
      return shownVideo;
    },
    updateMonitor() {
      if (masterGain) masterGain.gain.value = getState().muted ? 0 : 1;
    },
    clearVideos() {
      for (const video of pool.values()) releaseMedia(video);
      pool.clear();
      shownVideo = null;
    },
  };
}
