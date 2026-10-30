// Tracks share the timeline's height, so it scrolls vertically only once every track is at its minimum.
(async () => {
  const n = window.spoolNative,
    d = document,
    $ = id => d.getElementById(id),
    checks = [],
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await n.flush();
  const scroll = $('timelineScroll'),
    height = track => parseFloat(getComputedStyle($('editor')).getPropertyValue('--video-height-' + track)),
    overflows = () => scroll.scrollHeight > scroll.clientHeight + 1;
  await frame();
  check('One track keeps the height it is set to', height(1) === 72 && !overflows());
  $('addVideoTrack').click();
  $('addVideoTrack').click();
  await frame();
  check(
    'Three video tracks with their audio shrink together to fit, with no vertical scrollbar',
    !overflows() && height(1) < 72 && height(1) >= 36 && height(1) === height(3),
  );
  check(
    'The timeline reserves no blank gutter for a scrollbar it does not show',
    getComputedStyle(scroll).scrollbarGutter !== 'stable',
  );
  for (let i = 0; i < 6; i++) $('addVideoTrack').click();
  await frame();
  check('With more tracks than fit at their minimum, the timeline scrolls', height(1) === 36 && overflows());
  // Growing the timeline until they fit hides the scrollbar while the resize is
  // being handled; that must not surface as an error, which stops Spool loading.
  const errors = [],
    record = e => errors.push(e.message);
  addEventListener('error', record, true);
  scroll.style.minHeight = scroll.scrollHeight + 40 + 'px';
  for (let i = 0; i < 4; i++) await frame();
  removeEventListener('error', record, true);
  const fitted = !overflows();
  scroll.style.minHeight = '';
  check('Lanes that start fitting while the timeline resizes raise no ResizeObserver error', fitted && !errors.length);
  return { checks };
})();
