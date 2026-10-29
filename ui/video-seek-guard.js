export function videoFrameCount(v) {
  if (typeof v.getVideoPlaybackQuality !== 'function') return null;
  const q = v.getVideoPlaybackQuality();
  return Number.isFinite(q.totalVideoFrames) &&
    Number.isFinite(q.droppedVideoFrames) &&
    q.droppedVideoFrames >= 0 &&
    q.totalVideoFrames >= q.droppedVideoFrames
    ? q.totalVideoFrames - q.droppedVideoFrames
    : null;
}
export function createVideoSeekGuard(isActive, isPlaying) {
  const watches = new WeakMap();
  function cancel(v) {
    const w = watches.get(v);
    if (w) {
      clearTimeout(w.timer);
      clearTimeout(w.recoveryTimer);
      w.timer = w.recoveryTimer = null;
      w.waiting = w.recovering = w.starting = false;
      w.serial++;
    }
  }
  function observe(v, time, previousTime, count) {
    if (count === null) {
      cancel(v);
      return;
    }
    let w = watches.get(v);
    if (!w) {
      w = {
        serial: 0,
        timer: null,
        recoveryTimer: null,
        waiting: false,
        recovering: false,
        starting: false,
        retried: false,
        recoveries: 0,
      };
      watches.set(v, w);
      v.addEventListener('play', () => cancel(v));
      v.addEventListener('error', () => cancel(v));
      v.addEventListener('abort', () => {
        if (w.recovering && w.starting) w.starting = false;
        else cancel(v);
      });
      v.addEventListener('loadstart', () => {
        w.starting = false;
      });
      v.addEventListener('emptied', () => {
        if (!w.recovering || v.src !== w.source) cancel(v);
      });
      v.addEventListener('seeked', () => {
        if (v.seeking) return;
        if (w.recovering) {
          clearTimeout(w.recoveryTimer);
          w.recoveryTimer = null;
          w.recovering = w.starting = false;
        } else if (w.waiting) w.completed();
      });
    }
    if (w.recovering) return;
    if (w.source !== v.currentSrc || w.time !== time) {
      cancel(v);
      w.source = v.currentSrc;
      w.time = time;
      w.retried = false;
    }
    const target = v.decodeTarget;
    if (!Number.isFinite(target) || !v.paused || isPlaying() || !isActive(v)) {
      cancel(v);
      return;
    }
    if (Math.abs(previousTime - target) < 0.00001 || w.retried) return;
    clearTimeout(w.timer);
    w.timer = null;
    const serial = ++w.serial,
      source = v.currentSrc;
    w.completed = () => {
      if (w.serial !== serial) return;
      w.waiting = false;
      w.timer = setTimeout(() => {
        if (w.serial !== serial) return;
        w.timer = null;
        if (
          w.retried ||
          !v.isConnected ||
          v.hidden ||
          !isActive(v) ||
          isPlaying() ||
          !v.paused ||
          v.seeking ||
          v.readyState < 2 ||
          v.currentSrc !== source ||
          v.seekTarget !== time ||
          v.decodeTarget !== target ||
          Math.abs(v.currentTime - target) > 0.00001 ||
          videoFrameCount(v) !== count
        )
          return;
        w.retried = true;
        w.recovering = w.starting = true;
        w.recoveries++;
        w.recoveryTimer = setTimeout(() => {
          if (w.serial === serial) cancel(v);
        }, 8000);
        v.load();
      }, 500);
    };
    w.waiting = true;
    if (!v.seeking) w.completed();
  }
  function status(v) {
    const w = watches.get(v);
    return {
      pending: !!w && (w.waiting || w.timer !== null || w.recovering),
      recovering: !!w?.recovering,
      retried: !!w?.retried,
      recoveries: w?.recoveries || 0,
      time: w?.time,
    };
  }
  return { observe, cancel, status };
}
