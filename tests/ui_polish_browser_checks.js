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
  return { checks };
})();
