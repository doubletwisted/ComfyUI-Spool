(async () => {
  const n = spoolNative,
    d = document,
    $ = id => d.getElementById(id),
    checks = [],
    check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    };
  const wait = async fn => {
    const end = Date.now() + 15000;
    while (!fn()) {
      if (Date.now() > end) throw Error('Full-take hover: ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  n.selectClip('shot');
  await n.flush();
  n.viewTake('long');
  n.setFrame(7, true);
  const shot = n.state.clips[0],
    before = JSON.stringify(shot),
    frame = n.state.frame,
    context = $('viewerContext').innerHTML,
    time = $('viewerTime').textContent;
  check(
    'Fixture has different take lengths and a trimmed timeline clip',
    shot.takes[0].media.frames === 36 && shot.takes[1].media.frames === 72 && shot.in === 12 && shot.out === 24,
  );
  const pixel = video => {
    const canvas = d.createElement('canvas');
    canvas.width = canvas.height = 1;
    canvas.getContext('2d').drawImage(video, 0, 0, 1, 1);
    return canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  };
  for (const take of shot.takes) {
    const thumb = d.querySelector('[data-view="' + take.id + '"]'),
      card = thumb.closest('.take-card'),
      image = thumb.querySelector('img');
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // The whole tile scrubs across its width, not only the thumbnail.
    const r = card.getBoundingClientRect();
    await wait(() => image.src.startsWith('data:image/jpeg') && image.complete && image.naturalWidth);
    const staticImage = image.src;
    const move = async (x, channel, event = 'pointermove') => {
      card.dispatchEvent(
        new PointerEvent(event, { bubbles: true, clientX: r.left + x * r.width, clientY: r.top + r.height / 2 }),
      );
      const expected = Math.min(take.media.frames - 1, Math.floor(Math.max(0, Math.min(1, x)) * take.media.frames));
      await wait(() => {
        const video = d.querySelector('video.take-scrub-preview');
        return (
          video &&
          !video.hidden &&
          !video.seeking &&
          Number(video.dataset.scrubFrame) === expected &&
          Math.abs(video.currentTime - (expected + 0.5) / n.state.fps) < 1 / n.state.fps &&
          pixel(video)[channel] > 200
        );
      });
      return expected;
    };
    check(
      take.id + ': entering near the right edge immediately shows the end of the full take',
      (await move(0.99, 2, 'pointerenter')) > shot.out,
    );
    check(take.id + ': the left edge decodes frame zero before the timeline in-point', (await move(0, 0)) === 0);
    check(
      take.id + ': the middle decodes the full-take midpoint',
      (await move(0.5, 1)) === Math.floor(take.media.frames / 2),
    );
    check(
      take.id + ': the right edge decodes the final frame after the timeline out-point',
      (await move(1, 2)) === take.media.frames - 1,
    );
    await move(-0.2, 0);
    await move(1.2, 2);
    checks.push(take.id + ': pointer positions outside the tile clamp to the first and last frames');
    check(
      take.id + ': hover keeps the card image static and uses a muted paused viewer overlay',
      image.src === staticImage &&
        d.querySelector('video.take-scrub-preview').muted &&
        d.querySelector('video.take-scrub-preview').paused &&
        !thumb.querySelector('video'),
    );
    card.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    check(
      take.id + ': leaving restores Source context, time and playhead',
      !d.querySelector('.take-scrub-preview') &&
        $('viewerContext').innerHTML === context &&
        $('viewerTime').textContent === time &&
        n.state.frame === frame,
    );
  }
  check('Full-take hover preserves the selected take, trims and authored shot', JSON.stringify(shot) === before);
  check('Hover submits no generation jobs', !n.state.jobs.length);
  return { checks };
})();
