(async () => {
  const n = window.spoolNative,
    d = document,
    checks = [],
    initial = JSON.stringify(n.state.clips),
    $ = id => d.getElementById(id);
  const check = (label, value) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const images = () => [...d.querySelectorAll('#clipLane .filmstrip img')];
  const visible = () => {
    const area = $('timelineScroll').getBoundingClientRect();
    return images().filter(img => {
      const r = img.getBoundingClientRect();
      return (
        r.width && r.height && r.right > area.left && r.left < area.right && r.bottom > area.top && r.top < area.bottom
      );
    });
  };
  const ready = img => img.src.startsWith('data:image/jpeg') && img.complete && img.naturalWidth;
  const wait = async predicate => {
    const end = performance.now() + 20000;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Thumbnail work timed out');
      await new Promise(r => setTimeout(r, 30));
    }
  };
  const idle = () => !n.diagnostics().active.some(e => e.label === 'Reading video thumbnails');
  await wait(() => visible().length && visible().every(ready));
  const visibleReadyMs = performance.now();
  await wait(idle);
  await new Promise(r => setTimeout(r, 150));
  await wait(idle);
  const first = {
    ...window.__thumbnailProfile,
    ready: images().filter(ready).length,
    visible: visible().length,
    visibleReadyMs,
  };
  check('Visible timeline thumbnails decode actual frames', visible().every(ready));
  check('Timeline has offscreen thumbnail work to defer', first.visible < images().length / 2);
  if (!window.__thumbnailBaseline)
    check('Offscreen frames are not decoded eagerly', first.encoded < images().length / 2);
  const pixel = img => {
    const c = d.createElement('canvas');
    c.width = c.height = 1;
    c.getContext('2d').drawImage(img, 0, 0, 1, 1);
    return [...c.getContext('2d').getImageData(0, 0, 1, 1).data];
  };
  check('First visible shot shows its red source frame', pixel(visible()[0])[0] > 200);
  const scrollStart = performance.now(),
    area = $('timelineScroll').getBoundingClientRect(),
    last = d.querySelector('#clipLane [data-clip="thumb-79"]').getBoundingClientRect();
  $('timelineScroll').scrollLeft += last.right - area.right + 8;
  await wait(() => visible().length && visible().every(ready));
  await wait(idle);
  const end = {
    ...window.__thumbnailProfile,
    ready: images().filter(ready).length,
    scrollReadyMs: performance.now() - scrollStart,
  };
  check('Scrolling decodes the newly visible blue source frames', pixel(visible().at(-1))[2] > 200);
  check(
    'Filmstrips keep exact trimmed endpoint requests',
    images().every(img => {
      const c = n.state.clips.find(c => c.id === img.closest('[data-clip]').dataset.clip);
      return [c.in, c.out - 1].includes(Number(img.dataset.thumbnailFrame));
    }),
  );
  const count = window.__thumbnailProfile.encoded;
  $('timelineScroll').scrollLeft = 0;
  await wait(() => visible().every(ready));
  await new Promise(r => setTimeout(r, 150));
  check('Returning to decoded frames reuses thumbnails', window.__thumbnailProfile.encoded === count);
  check('Thumbnail work preserves authored clips and take choices', JSON.stringify(n.state.clips) === initial);
  // Exercise bindings independently of the editor's render cycle with real decoders.
  const { createThumbnails } = await import('/spool/ui/thumbnails.js'),
    host = d.createElement('div');
  host.style.cssText = 'position:fixed;left:10px;top:10px;width:160px;height:100px;z-index:99999';
  d.body.append(host);
  const media = n.state.clips[0].takes[0].media,
    resolve = file => '/spool/media/' + n.projectKey + '/' + file,
    thumbs = createThumbnails(resolve, null, host);
  const image = () => {
    const img = d.createElement('img');
    img.style.cssText = 'width:40px;height:30px';
    host.append(img);
    return img;
  };
  const rebound = image();
  thumbs.bind(rebound, media, 0, 24);
  thumbs.bind(rebound, media, media.frames - 1, 24);
  await wait(() => ready(rebound));
  check('A rebound image receives the latest blue frame', pixel(rebound)[2] > 200);
  thumbs.bind(rebound, media, 0, 24);
  await wait(() => ready(rebound) && pixel(rebound)[0] > 200);
  check('Rebinding a decoded image shows its new red frame', pixel(rebound)[0] > 200);
  const detached = image();
  thumbs.bind(detached, media, 100, 24);
  detached.remove();
  await new Promise(r => setTimeout(r, 100));
  check('Disconnected pending images are not decoded', !detached.src);
  const button = d.createElement('button');
  host.append(button);
  thumbs.scrub(button, media, media.frames - 1, 24);
  await wait(() => !!host.querySelector('video:not([hidden])'));
  const hover = host.querySelector('video');
  check(
    'Hover review keeps an independent accurate blue decoder',
    pixel(hover)[2] > 200 && rebound.src.startsWith('data:image/jpeg'),
  );
  thumbs.stopScrub();
  check('Stopping hover removes its decoder', !host.querySelector('video'));
  const originalObserver = globalThis.IntersectionObserver;
  let fallback;
  try {
    globalThis.IntersectionObserver = undefined;
    fallback = createThumbnails(resolve, null, host);
  } finally {
    globalThis.IntersectionObserver = originalObserver;
  }
  const hidden = image();
  hidden.style.position = 'fixed';
  hidden.style.left = '-3000px';
  fallback.bind(hidden, media, 0, 24);
  await wait(() => ready(hidden));
  check('Browsers without visibility observation still decode frames', pixel(hidden)[0] > 200);
  host.remove();
  return { checks, first, end, totalImages: images().length, baseline: window.__thumbnailBaseline };
})();
