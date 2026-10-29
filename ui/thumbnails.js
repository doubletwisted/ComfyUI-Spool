// Read frames from review proxies with a decoder independent of viewer playback.
export function createThumbnails(
  resolve,
  diagnostics,
  scrubTarget,
  prepare = async media => ({ file: media.file, offset: 0 }),
) {
  const cache = new Map(),
    queue = [],
    video = document.createElement('video'),
    canvas = document.createElement('canvas');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  // Only visible, uncached images join the decoder queue, including in drawers.
  const pending = new Map();
  const observer = globalThis.IntersectionObserver
    ? new IntersectionObserver(entries => {
        for (const [img] of pending) if (!img.isConnected) release(img);
        for (const entry of entries) {
          const data = pending.get(entry.target);
          if (!data) continue;
          data.visible = entry.isIntersecting;
          if (data.visible) enqueue(entry.target, data);
        }
      })
    : null;
  function release(img) {
    observer?.unobserve(img);
    pending.delete(img);
  }
  let running = false,
    file = null;
  function wait(event, start) {
    return new Promise((done, fail) => {
      const finish = error => {
        clearTimeout(timer);
        video.removeEventListener(event, ready);
        video.removeEventListener('error', bad);
        error ? fail(error) : done();
      };
      const ready = () => finish(),
        bad = () => finish(Error('Thumbnail video unavailable'));
      const timer = setTimeout(() => finish(Error('Thumbnail decode timed out')), 10000);
      video.addEventListener(event, ready, { once: true });
      video.addEventListener('error', bad, { once: true });
      start();
    });
  }
  async function drain() {
    if (running) return;
    running = true;
    const finish = diagnostics?.start('Reading video thumbnails', { background: true });
    try {
      while (queue.length) {
        const entry = queue.shift();
        const current = () =>
          [...entry.images].filter(
            img =>
              img.isConnected && img.dataset.thumbnailKey === entry.key && (!observer || pending.get(img)?.visible),
          );
        if (!current().length) {
          cache.delete(entry.key);
          continue;
        }
        try {
          const source = await prepare(entry.media, entry.fps);
          entry.file = resolve(source.file);
          entry.frame += Math.round((source.offset || 0) * entry.fps);
          if (file !== entry.file) {
            file = entry.file;
            await wait('loadeddata', () => {
              video.src = file;
              video.load();
            });
          }
          const time = Math.min((entry.frame + 0.5) / entry.fps, Math.max(0, video.duration - 0.5 / entry.fps));
          if (Math.abs(video.currentTime - time) > 0.00001)
            await wait('seeked', () => {
              video.currentTime = time;
            });
          const images = current();
          if (!images.length) {
            cache.delete(entry.key);
            continue;
          }
          canvas.width = 320;
          canvas.height = Math.max(1, Math.round((320 * video.videoHeight) / video.videoWidth));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          entry.src = canvas.toDataURL('image/jpeg', 0.8);
          for (const img of images) {
            img.src = entry.src;
            release(img);
          }
        } catch (error) {
          file = null;
          diagnostics?.record('Thumbnail unavailable', 0, error, entry.file);
          for (const img of entry.images) release(img);
        }
        entry.images.clear();
        entry.done = true;
        while (cache.size > 400) {
          const oldest = [...cache].find(([, value]) => value.done);
          if (!oldest) break;
          cache.delete(oldest[0]);
        }
      }
    } finally {
      running = false;
      finish?.();
    }
  }
  function bind(img, media, frame, fps) {
    release(img);
    if (media.kind !== 'video') {
      img.removeAttribute('data-thumbnail-key');
      return;
    }
    // Native review files start at their own frame zero, including detected shots.
    const rate = fps,
      position = Math.floor(Math.max(0, Math.min(media.frames - 1, frame)));
    const source = resolve(media.file),
      key = source + '|' + rate + '|' + position;
    img.dataset.thumbnailKey = key;
    img.dataset.thumbnailFrame = String(frame);
    if (cache.get(key)?.src) {
      const entry = cache.get(key);
      cache.delete(key);
      cache.set(key, entry);
      img.src = entry.src;
      return;
    }
    const data = { key, file: source, fps: rate, frame: position, media, visible: !observer };
    if (observer) {
      pending.set(img, data);
      observer.observe(img);
    } else enqueue(img, data);
  }
  function enqueue(img, { key, file, fps, frame, media }) {
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      cache.set(key, entry);
      if (entry.src) {
        img.src = entry.src;
        release(img);
        return;
      }
      if (entry.done) {
        release(img);
        return;
      }
    } else {
      entry = { key, file, fps, frame, media, images: new Set() };
      cache.set(key, entry);
      queue.push(entry);
    }
    entry.images.add(img);
    void drain();
  }
  // Hover review has its own decoder: pointer movement never joins the static
  // filmstrip queue or encodes a JPEG. Only the newest requested frame is sought.
  const preview = document.createElement('video');
  preview.className = 'take-scrub-preview';
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = 'auto';
  preview.hidden = true;
  const still = document.createElement('img');
  still.className = 'take-scrub-preview';
  still.alt = 'Hovered take';
  still.hidden = true;
  let hover = null,
    hoverFile = null,
    hoverRAF = 0;
  function stopScrub(button) {
    if (button && hover?.button !== button) return;
    hover = null;
    cancelAnimationFrame(hoverRAF);
    hoverRAF = 0;
    preview.hidden = still.hidden = true;
    preview.remove();
    still.remove();
    scrubTarget.classList.remove('take-hover-active');
  }
  function seekHover() {
    hoverRAF = 0;
    if (!hover) return;
    if (!hover.button.isConnected) {
      stopScrub();
      return;
    }
    if (hover.kind !== 'video' || preview.readyState < 2 || preview.seeking) return;
    const target = Math.max(0, Math.min((hover.frame + 0.5) / hover.fps, preview.duration - 0.5 / hover.fps));
    if (Math.abs(preview.currentTime - target) > 0.5 / hover.fps) {
      preview.currentTime = target;
      return;
    }
    preview.hidden = false;
    scrubTarget.classList.add('take-hover-active');
  }
  preview.addEventListener('loadeddata', seekHover);
  preview.addEventListener('seeked', seekHover);
  preview.addEventListener('error', () => {
    diagnostics?.record('Take scrub unavailable', 0, Error('Take preview video unavailable'), hoverFile);
    if (hover?.kind === 'video') stopScrub();
    hoverFile = null;
  });
  const revealStill = () => {
    if (hover?.kind === 'image' && still.complete && still.naturalWidth) {
      still.hidden = false;
      scrubTarget.classList.add('take-hover-active');
    }
  };
  still.onload = revealStill;
  still.onerror = () => {
    if (hover?.kind === 'image') stopScrub();
  };
  async function scrub(button, media, frame, fps) {
    if (!['video', 'image'].includes(media.kind)) {
      stopScrub();
      return;
    }
    let source = resolve(media.file);
    const active = { button, kind: media.kind, frame: Math.max(0, Math.min(media.frames - 1, frame)), fps };
    hover = active;
    if (media.kind === 'image') {
      preview.hidden = true;
      preview.remove();
      if (still.dataset.file !== source) {
        still.hidden = true;
        scrubTarget.classList.remove('take-hover-active');
        still.dataset.file = source;
        still.src = source;
      }
      if (still.parentElement !== scrubTarget) scrubTarget.append(still);
      revealStill();
      return;
    }
    try {
      const prepared = await prepare(media, fps);
      if (hover !== active) return;
      source = resolve(prepared.file);
      hover.frame += Math.round((prepared.offset || 0) * fps);
    } catch (error) {
      diagnostics?.record('Take scrub unavailable', 0, error, source);
      if (hover === active) stopScrub();
      return;
    }
    still.hidden = true;
    still.remove();
    preview.dataset.scrubFrame = String(hover.frame);
    if (preview.parentElement !== scrubTarget) {
      preview.hidden = true;
      scrubTarget.append(preview);
    }
    if (hoverFile !== source) {
      preview.hidden = true;
      scrubTarget.classList.remove('take-hover-active');
      hoverFile = source;
      preview.src = source;
      preview.load();
    }
    if (!hoverRAF) hoverRAF = requestAnimationFrame(seekHover);
  }
  window.addEventListener('blur', () => stopScrub());
  window.addEventListener(
    'pagehide',
    () => {
      stopScrub();
      observer?.disconnect();
      pending.clear();
      queue.length = 0;
      cache.clear();
      for (const decoder of [video, preview]) {
        decoder.removeAttribute('src');
        decoder.load();
      }
    },
    { once: true },
  );
  return { bind, scrub, stopScrub };
}
