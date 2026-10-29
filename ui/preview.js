// Viewer playback preparation: which size a media needs, which preparation is in
// flight, what failed and how a failure is retried.
//
// The viewer used to own this as a cache of half-built entries plus a null return
// value, and a failure wrote `entry.error` permanently: the only recovery was to
// change preview resolution, which happened to clear the cache. Preparing also
// saved the whole project so the server could read two numbers from the document;
// the caller now states the size it wants.
export const QUALITY = { full: 1, half: 2, quarter: 4 };

export function createPreviews({ target, request, changed }) {
  const entries = new Map();

  const keyFor = media => {
    const size = target();
    return [media.originalFile || media.file, size.width, size.height, size.fps, size.quality].join('|');
  };

  // Returns the current entry and starts preparing on first use.
  function status(media) {
    if (!media?.id || !['video', 'image'].includes(media.kind)) return { state: 'direct' };
    const key = keyFor(media),
      held = entries.get(key);
    if (held) return held;
    const entry = { state: 'preparing' };
    entries.set(key, entry);
    (async () => {
      const size = target();
      try {
        Object.assign(
          entry,
          await request(media, {
            divisor: QUALITY[size.quality],
            width: size.width,
            height: size.height,
            fps: size.fps,
          }),
        );
        entry.state = 'ready';
      } catch (error) {
        entry.state = 'failed';
        entry.error = error.message;
      }
      changed(media, entry);
    })();
    return entry;
  }

  function retry(media) {
    const key = keyFor(media);
    if (entries.get(key)?.state !== 'failed') return false;
    entries.delete(key);
    status(media);
    return true;
  }

  function clear() {
    entries.clear();
  }

  return {
    status,
    retry,
    clear,
    get size() {
      return entries.size;
    },
  };
}
