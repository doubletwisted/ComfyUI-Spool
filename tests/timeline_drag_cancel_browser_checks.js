// Cancelling a trim with Escape must restore every clip's geometry, not just the one
// the pointer was holding.
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
  check('The cancelled trim produced frames to inspect', drag.samples.length >= 4);
  const tokens = drag.samples[0].tokens;
  check(
    'The lane was not rebuilt while the cancelled trim ran',
    drag.samples.every(sample => sample.draws === drag.before.draws),
  );
  check(
    'Every clip node survived the cancelled trim',
    drag.samples.every(sample => sample.tokens.every((token, index) => token === tokens[index])),
  );
  check(
    'The trim shortened the clip before cancelling',
    drag.samples.at(-1).box['drag-clip-1'].width < drag.before.box['drag-clip-1'].width,
  );
  check(
    'Cancelling restored every clip position',
    Object.keys(drag.before.box).every(id => drag.after.box[id].left === drag.before.box[id].left),
  );
  check(
    'Cancelling restored every clip width',
    Object.keys(drag.before.box).every(id => drag.after.box[id].width === drag.before.box[id].width),
  );
  check('Cancelling rebuilt the lane once', drag.after.draws === drag.before.draws + 1);
  check('The document kept the original timing', n.state.clips.find(c => c.id === 'drag-clip-1').out === 48);
  check('The timeline has no clip left mid-gesture', !n.drag);
  await n.flush();
  check('Cancelling saved nothing new', !n.dirty);
  return {
    checks,
    frames: drag.samples.length,
    drawsBefore: drag.before.draws,
    drawsAfter: drag.after.draws,
    kind: 'Installed editor, trusted CDP trim cancelled with Escape',
  };
})();
