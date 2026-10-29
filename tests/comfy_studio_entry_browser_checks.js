(async () => {
  const checks = [],
    check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    };
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:200';
  frame.src = '/';
  document.body.append(frame);
  try {
    const end = Date.now() + 120000;
    while (!frame.contentDocument?.querySelector('#spool-open-studio')) {
      if (Date.now() > end) throw Error('Comfy topbar did not load');
      await new Promise(r => setTimeout(r, 100));
    }
    const win = frame.contentWindow,
      doc = frame.contentDocument;
    check(
      'Comfy exposes Open Spool in its native action bar',
      doc.querySelector('#spool-open-studio').textContent === 'Open Spool ↗',
    );
    check('The bottom dock is retired', !doc.querySelector('#spool-dock') && !win.spoolDock);
    let assigned,
      focuses = 0,
      opens = 0;
    const tab = {
      closed: false,
      location: {
        href: 'about:blank',
        assign(value) {
          assigned = value;
          this.href = value;
        },
      },
      focus() {
        focuses++;
      },
    };
    win.open = () => {
      opens++;
      return tab;
    };
    doc.querySelector('#spool-open-studio').click();
    doc.querySelector('#spool-open-studio').click();
    check(
      'Repeated clicks focus the same studio',
      opens === 1 &&
        focuses === 2 &&
        new URL(assigned).pathname === '/spool/' &&
        !new URL(assigned).searchParams.has('mode'),
    );
    check('Studio entry carries its BroadcastChannel identity', !!new URL(assigned).searchParams.get('bridge'));
    check(
      'Unlinked Comfy graphs hide Apply to clip',
      doc.querySelector('#spool-workflow-toolbar').style.display === 'none',
    );
    return { checks };
  } finally {
    frame.remove();
  }
})();
