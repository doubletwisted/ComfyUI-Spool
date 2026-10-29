// Shared playback preparation for the viewer, review audio and thumbnails.
export function createPreviews({
  target,
  request,
  changed,
  wait = () => new Promise(resolve => setTimeout(resolve, 250)),
}) {
  const entries = new Map();
  const keyFor = media => {
    const size = target();
    return [media.originalFile || media.file, size.width, size.height, size.fps].join('|');
  };

  function status(media) {
    if (!media?.id || !['video', 'image', 'audio'].includes(media.kind)) return { state: 'direct' };
    const key = keyFor(media),
      held = entries.get(key);
    if (held) return held;
    const entry = { state: 'preparing', file: undefined, error: undefined, pending: null };
    entries.set(key, entry);
    const size = target();
    entry.pending = (async () => {
      try {
        while (entries.get(key) === entry) {
          const result = await request(media, { width: size.width, height: size.height, fps: size.fps });
          if (entries.get(key) !== entry) return;
          if (result.state === 'preparing') {
            await wait();
            continue;
          }
          Object.assign(entry, result);
          entry.state = 'ready';
          break;
        }
      } catch (error) {
        entry.state = 'failed';
        entry.error = error.message;
      }
      entry.pending = null;
      if (entries.get(key) === entry) changed(media, entry);
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
