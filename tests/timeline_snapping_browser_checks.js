(async () => {
  const g = __snapping,
    checks = [],
    check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    row = (state, id) => state.rows.find(r => r.id === id);
  check(
    'Dragging the trailing edge a few pixels over a cut snaps beside the fixed clip',
    row(g.trailing, 'moving').end === 96 &&
      row(g.trailing, 'fixed').start === 96 &&
      row(g.trailing, 'fixed').out - row(g.trailing, 'fixed').in === 48,
  );
  check(
    'Dragging the leading edge near a cut snaps to its exact end',
    row(g.leading, 'moving').start === 144 && row(g.leading, 'fixed').end === 144,
  );
  check(
    'Snapping off permits the intended overlap',
    row(g.disabled, 'moving').end > 96 && row(g.disabled, 'fixed').start === row(g.disabled, 'moving').end,
  );
  check(
    'A deliberate move beyond the snap distance can still overwrite',
    row(g.deliberate, 'moving').end > 96 && row(g.deliberate, 'fixed').start === row(g.deliberate, 'moving').end,
  );
  check(
    'Start and End labels are hidden away from the yellow bar',
    g.hidden.labels.every(value => value === '0'),
  );
  check(
    'Hovering the yellow bar reveals both range labels',
    g.visible.labels.every(value => value === '1'),
  );
  check(
    'Leaving the yellow bar hides the labels again',
    g.left.labels.every(value => value === '0'),
  );
  check(
    'Clicking the yellow bar still scrubs the ruler',
    g.clicked.frame !== g.visible.frame && JSON.stringify(g.clicked.range) === JSON.stringify(g.visible.range),
  );
  check(
    'Range handles remain draggable after revealing the labels',
    g.adjusted.range.start > 0 && g.adjusted.range.end === g.initial.range.end,
  );
  check(
    'Range editing leaves timeline clips and trims unchanged',
    JSON.stringify(g.adjusted.rows) === JSON.stringify(g.initial.rows),
  );
  return { checks };
})();
