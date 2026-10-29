// A ripple trim (Shift on the out edge) shortens the clip and pulls the following
// clips left. The geometry layer must write every affected node, not just the trimmed
// clip's, and must not rebuild the lane while the gesture runs. A trim is clamped by
// the minimum clip length, so positions are compared against where the gesture started.
(async () => {
  const n = window.spoolNative,
    d = document,
    drag = window.__drag;
  if (location.port !== '8195' || !n || !drag) throw Error('Use the owned timeline-drag QA project on 8195');
  const checks = [],
    check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    };
  const samples = drag.samples,
    left = (sample, id) => sample.box[id].left,
    start = id => drag.before.box[id].left,
    width = id => drag.before.box[id].width;

  check('The ripple trim produced frames to inspect', samples.length >= 4);
  const tokens = samples[0].tokens;
  check(
    'The lane was not rebuilt on any ripple frame',
    samples.every(sample => sample.draws === drag.before.draws),
  );
  check(
    'Every clip node survived every ripple frame',
    samples.every(sample => sample.tokens.every((token, index) => token === tokens[index])),
  );

  const widths = samples.map(sample => sample.box['drag-clip-1'].width);
  check(
    'The trimmed clip shortened from where it started',
    widths.every(value => value <= width('drag-clip-1')) && widths.some(value => value < width('drag-clip-1')),
  );
  check(
    'The trimmed clip kept its start',
    samples.every(sample => left(sample, 'drag-clip-1') === start('drag-clip-1')),
  );

  for (const id of ['drag-clip-2', 'drag-clip-3']) {
    const values = samples.map(sample => left(sample, id));
    check(
      'The following clip moved left from where it started (' + id + ')',
      values.every(value => value <= start(id)) && values.some(value => value < start(id)),
    );
  }
  check(
    'Following clips never overlapped or reordered',
    samples.every(sample => sample.box['drag-clip-3'].left > sample.box['drag-clip-2'].left),
  );
  check(
    'Clips before the trimmed clip stayed put',
    ['drag-clip-0'].every(id => drag.after.box[id].left === start(id)),
  );
  check('The lane was rebuilt once when the gesture ended', drag.after.draws === drag.before.draws + 1);

  const clip = n.state.clips.find(c => c.id === 'drag-clip-1');
  check('The ripple changed the saved timing', clip.out < 48);
  check('The trimmed clip keeps a minimum length', clip.out - clip.in >= 6);
  check('No clip was lost', n.state.clips.length === 12);
  check(
    'The ripple introduced no gaps between following clips',
    ['drag-clip-2', 'drag-clip-3'].every(id => (n.state.clips.find(c => c.id === id).gapBefore || 0) === 0),
  );
  await n.flush();
  check('The ripple saved without a conflict', !n.dirty);
  return {
    checks,
    frames: samples.length,
    drawsBefore: drag.before.draws,
    drawsAfter: drag.after.draws,
    kind: 'Installed editor, trusted CDP ripple trim with Shift held',
  };
})();
