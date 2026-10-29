(async () => {
  const n = window.spoolNative,
    d = document,
    $ = id => d.getElementById(id),
    checks = [];
  const check = (label, value) => {
    if (!value) throw Error(label);
    checks.push(label);
  };
  const visible = node => !!node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const wait = async predicate => {
    const end = performance.now() + 10000;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Clip folder timed out');
      await new Promise(r => setTimeout(r, 20));
    }
  };
  let opened = [],
    pending,
    fail = false;
  const originalFetch = window.fetch;
  window.fetch = async (url, options) => {
    if (String(url).includes('/clip-folder/')) {
      opened.push({ url, options });
      await new Promise(resolve => (pending = resolve));
      return new Response(JSON.stringify(fail ? { error: 'Folder unavailable' } : { ok: true }), {
        status: fail ? 400 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(url, options);
  };
  try {
    n.selectClip('drag-clip-0');
    await n.flush();
    const before = JSON.stringify(n.state),
      revision = n.revision,
      button = $('openClipFolder');
    check(
      'Open clip folder is available beside the takes',
      visible(button) && !button.disabled && button.textContent === 'Open clip folder' && button.closest('.takes-head'),
    );
    const manager = navigator.platform === 'MacIntel' ? 'Finder' : 'Explorer';
    check(
      'The folder button names the host file manager, ' + manager,
      button.title.startsWith('Open in ' + manager + '.'),
    );
    const bounds = button.getBoundingClientRect();
    check(
      'Folder button stays inside narrow and desktop layouts',
      bounds.left >= 0 && bounds.right <= innerWidth && bounds.height >= 22,
    );
    button.click();
    await wait(() => opened.length === 1);
    check(
      'Opening uses the selected clip identity without a client filesystem path',
      opened[0].url.endsWith('/projects/' + n.projectKey + '/clip-folder/drag-clip-0/reveal') &&
        opened[0].options.method === 'POST' &&
        opened[0].options.body === '{}',
    );
    check('Repeated click cannot launch duplicate requests', button.disabled);
    button.click();
    pending();
    await wait(() => !button.disabled);
    check(
      'Opening preserves edit, trims, selection and project revision',
      JSON.stringify(n.state) === before && n.revision === revision && opened.length === 1,
    );
    n.selectClip('empty-shot');
    await n.flush();
    check(
      'Ungenerated clip exposes the folder and explains how to add takes',
      visible($('takes')) &&
        visible(button) &&
        !button.disabled &&
        $('takeList').textContent.includes('Copy videos or images') &&
        !$('takeList').querySelector('[data-take]'),
    );
    check(
      'Empty takes strip leaves room for the viewer',
      $('takes').getBoundingClientRect().height < 120 &&
        d.querySelector('.viewer').getBoundingClientRect().height > 100,
    );
    button.click();
    await wait(() => opened.length === 2);
    n.selectClip('drag-clip-0');
    check(
      'Selection changes do not redirect an in-flight folder request',
      opened[1].url.endsWith('/clip-folder/empty-shot/reveal'),
    );
    pending();
    await wait(() => !button.disabled);
    fail = true;
    button.click();
    await wait(() => opened.length === 3);
    pending();
    await wait(() => !button.disabled);
    check(
      'Folder errors are visible and leave the action retryable',
      d.body.textContent.includes('Folder unavailable') && !button.disabled,
    );
    const originalTake = n.state.clips[0].takeId,
      trim = [n.state.clips[0].in, n.state.clips[0].out];
    for (let i = 0; i < 2; i++) {
      const response = await fetch('/spool/api/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      check('External media scan ' + (i + 1) + ' succeeds', response.ok);
    }
    await n.poll();
    await wait(() => n.state.clips[0].takes.length === 2);
    const clip = n.state.clips[0],
      external = clip.takes.find(t => t.id !== originalTake);
    check(
      'Copied video is discovered once with its full frame count',
      external.media.originalFile.endsWith('/external-take.mp4') && external.media.frames === 24,
    );
    check(
      'External take leaves chosen footage and trims unchanged',
      clip.takeId === originalTake && JSON.stringify([clip.in, clip.out]) === JSON.stringify(trim),
    );
    check(
      'External take appears with New badges in Takes and on the clip',
      !!$('takeList').querySelector('[data-take="' + external.id + '"] .take-badge.new') &&
        !!d.querySelector('#clipLane [data-clip="' + clip.id + '"] [data-unseen-takes]'),
    );
    check(
      'Wrapping header actions leave thumbnails visible',
      $('takeList').querySelector('.take-thumb').getBoundingClientRect().height >= 24,
    );
  } finally {
    window.fetch = originalFetch;
    pending?.();
  }
  return { checks };
})();
