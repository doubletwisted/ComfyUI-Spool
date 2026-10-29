(async () => {
  const n = window.spoolNative,
    d = document,
    $ = id => d.getElementById(id) || n.dialogRoot.getElementById(id),
    checks = [];
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async predicate => {
      const end = performance.now() + 10000;
      while (!predicate()) {
        if (performance.now() > end) throw Error('Connection warning timed out');
        await new Promise(r => setTimeout(r, 30));
      }
    };
  await wait(() => !$('connectionWarning').hidden);
  const initial = JSON.stringify(n.state.clips),
    revision = n.revision,
    bar = d.querySelector('.topbar'),
    bounds = bar.getBoundingClientRect();
  check(
    'Comfy loss does not masquerade as a failed project save',
    $('saveStatus').textContent === '✓ All changes saved' && $('comfyConnection').textContent === 'Comfy offline',
  );
  check('Header controls fit the viewport', bar.scrollWidth <= bar.clientWidth + 1 && bounds.right <= innerWidth + 1);
  const compact = $('editor').classList.contains('compact');
  check(
    'Compact and narrow layouts keep the warning readable',
    !(compact || innerWidth <= 600) || $('connectionWarning').getClientRects().length > 0,
  );
  check(
    'Connection warning has its own row above the workbench',
    !(compact || innerWidth <= 600) || $('workbench').getBoundingClientRect().top >= bounds.bottom - 1,
  );
  $('projectMenu').click();
  const menu = $('projectCommands').getBoundingClientRect();
  check(
    'Project menu stays within narrow viewport',
    menu.left >= 0 && menu.right <= innerWidth + 1 && menu.bottom <= $('editor').getBoundingClientRect().bottom,
  );
  $('projectMenu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  $('workspaceMenu').click();
  $('topbarConnection').click();
  await wait(() => !!$('comfyAddress') && !$('modalOverlay').hidden);
  check('Connection settings remain reachable without starting Comfy', !!$('comfySaveSettings'));
  $('closeModal').click();
  check(
    'Viewing disconnected status preserves the authored edit',
    n.revision === revision && JSON.stringify(n.state.clips) === initial,
  );
  return { checks };
})();
