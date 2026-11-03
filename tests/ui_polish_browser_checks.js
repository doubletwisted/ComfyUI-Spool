(async () => {
  const n = window.spoolNative,
    d = document,
    $ = id => n.dialogRoot.querySelector('#' + id) || d.getElementById(id),
    checks = [];
  const check = (label, value) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const wait = async predicate => {
    const end = performance.now() + 15000;
    while (!predicate()) {
      if (performance.now() > end) throw Error('UI polish timed out');
      await new Promise(r => setTimeout(r, 30));
    }
  };
  n.selectClip('shot');
  await n.flush();
  const revision = n.revision;
  check('Both inspector modes show one workflow action', !!$('editClipWorkflow') && !$('clipWorkflow'));
  check(
    'Saved recipe can be edited without a readiness banner',
    !$('editClipWorkflow').disabled && !$('inspectorContent').querySelector('.workflow-readiness'),
  );
  const edit = $('editClipWorkflow');
  edit.focus();
  check(
    'Keyboard focus has a visible ring',
    getComputedStyle(edit).outlineStyle !== 'none' && parseFloat(getComputedStyle(edit).outlineWidth) >= 2,
  );
  const box = d.querySelector('.take-select');
  box?.focus();
  await wait(() => !!box && getComputedStyle(box).opacity === '1');
  check('Take selection remains available to keyboard users', d.activeElement === box);
  check(
    'Take count is readable',
    getComputedStyle($('takeCount')).display !== 'none' && $('takeCount').textContent === '3',
  );
  check('View-only focus and selection leave project untouched', n.revision === revision);
  n.selectClip('shot');
  await n.flush();
  // The same kind of control looks the same in every panel.
  const font = node => {
      const s = getComputedStyle(node);
      return [s.fontFamily, s.fontSize].join(' ');
    },
    same = nodes => nodes.length > 1 && new Set(nodes.map(font)).size === 1,
    shown = selector => [...d.querySelectorAll(selector)].filter(node => node.getClientRects().length);
  check(
    'Track names share one type, video and audio alike',
    same([...shown('.track-select'), ...shown('#trackHeaders .track-title b')]),
  );
  check(
    'Tab bars share one size',
    same([
      ...shown('.media-panel > .panel-head .seg button'),
      ...shown('.viewer-tabs button'),
      ...shown('.inspector-tabs button'),
    ]),
  );
  check(
    'Track toggles share one size',
    new Set(shown('#trackHeaders .track-toggle').map(node => node.getBoundingClientRect().height)).size === 1,
  );
  const mediaFilter = d.querySelector('.media-filters button'),
    locationFilter = d.querySelector('.workflow-location button');
  check(
    'Single-choice filters share one control',
    !!mediaFilter &&
      !!locationFilter &&
      getComputedStyle(mediaFilter).borderRadius === getComputedStyle(locationFilter).borderRadius &&
      getComputedStyle(mediaFilter).fontSize === getComputedStyle(locationFilter).fontSize,
  );
  check(
    'Media and workflow display toggles are both icons',
    !!$('mediaViewgrid').querySelector('svg') && !!d.querySelector('[data-workflow-view] svg'),
  );
  return { checks };
})();
