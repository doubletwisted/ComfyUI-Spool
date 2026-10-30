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
    'Three video tracks with their audio shrink together to fit, with no vertical scrollbar' +
      ' DEBUG ' +
      [
        height(1),
        height(3),
        scroll.scrollHeight,
        scroll.clientHeight,
        $('ruler').offsetHeight,
        $('clipLane').style.height,
        $('audioLane').style.height,
        $('musicLane').style.height,
      ].join(','),
    !overflows() && height(1) < 72 && height(1) >= 36 && height(1) === height(3),
  );
  check(
    'The timeline reserves no blank gutter for a scrollbar it does not show',
    getComputedStyle(scroll).scrollbarGutter !== 'stable',
  );
  for (let i = 0; i < 6; i++) $('addVideoTrack').click();
  await frame();
  check('With more tracks than fit at their minimum, the timeline scrolls', height(1) === 36 && overflows());
  return { checks };
})();
