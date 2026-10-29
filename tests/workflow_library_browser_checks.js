(async () => {
  const n = window.spoolNative,
    d = document,
    $ = id => d.getElementById(id) || n.dialogRoot.getElementById(id),
    checks = [];
  const check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    wait = async predicate => {
      const end = performance.now() + 15000;
      while (!predicate()) {
        if (performance.now() > end) throw Error('Workflow library timed out');
        await new Promise(r => setTimeout(r, 30));
      }
    };
  await n.flush();
  const compact = $('editor').classList.contains('compact');
  if (compact || innerWidth <= 1100) {
    $('workspaceMenu').click();
    $('workflowLibraryToggle').click();
  }
  check(
    'Project recipes remain visible without a duplicate catalogue',
    !!d.querySelector('[data-template]') && !d.querySelector('[data-catalog]'),
  );
  const revision = n.revision,
    count = n.state.clips.length,
    original = n.state.clips.map(c => ({ id: c.id, take: c.takeId, in: c.in, out: c.out }));
  $('workflowSearch').value = 'no-match';
  $('workflowSearch').dispatchEvent(new Event('input'));
  check(
    'Project workflow search explains empty results',
    d.querySelector('#workflowList').textContent.includes('No workflows match'),
  );
  $('workflowSearch').value = '';
  $('workflowSearch').dispatchEvent(new Event('input'));
  const originalOpen = window.open;
  let opened = 0;
  window.open = () => {
    opened++;
    return null;
  };
  const browse = async () => {
    $('browseComfyTemplates').focus();
    $('browseComfyTemplates').click();
    await wait(() => $('comfyTemplateBrowser')?.classList.contains('ready'));
    return $('comfyTemplateBrowser');
  };
  try {
    const first = await browse(),
      session = new URL(first.src).searchParams.get('spoolTemplateSession');
    check(
      'Comfy templates open inside Spool without a new tab',
      opened === 0 && $('modalOverlay').contains(first) && $('templateUse').disabled && !$('modalOverlay').hidden,
    );
    const box = $('modal').getBoundingClientRect();
    check(
      'Inline chooser fits the viewport',
      box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1,
    );
    const forged = {
      type: 'spool-template-state',
      session,
      viewId: new URL(first.src).searchParams.get('spoolTemplateView'),
      state: 'selected',
      name: 'Wrong workflow',
    };
    for (const options of [
      { origin: location.origin, source: window, data: forged },
      { origin: 'http://example.com', source: first.contentWindow, data: forged },
      { origin: location.origin, source: first.contentWindow, data: { ...forged, session: 'wrong' } },
    ])
      window.dispatchEvent(new MessageEvent('message', options));
    check('Wrong window, origin and session cannot select a workflow', $('templateUse').disabled);
    first.contentDocument.getElementById('selectTemplate').click();
    await wait(() => !$('templateUse').disabled);
    check(
      'Selection is explicit and browsing does not edit the project',
      n.revision === revision &&
        n.state.clips.length === count &&
        $('templateStatus').textContent === 'LTX-2.3 CPU template',
    );
    first.contentWindow.holdCapture = true;
    $('templateUse').click();
    await wait(() => typeof first.contentWindow.releaseCapture === 'function');
    $('templateCancel').click();
    check(
      'Cancel parks the browser and restores focus',
      first.isConnected &&
        first.parentElement.hidden &&
        !first.classList.contains('ready') &&
        $('modalOverlay').hidden &&
        d.activeElement === $('browseComfyTemplates'),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: location.origin,
        source: first.contentWindow,
        data: { ...forged, state: 'captured', requestId: 'late', capture: { workflow: { nodes: [] } } },
      }),
    );
    check(
      'Late messages after cancellation leave the project unchanged',
      n.revision === revision && n.state.clips.length === count,
    );
    let frame = await browse();
    check(
      'Warm reopening resets consent and rejects prior-view messages',
      frame === first && $('templateUse').disabled,
    );
    window.dispatchEvent(
      new MessageEvent('message', { origin: location.origin, source: first.contentWindow, data: forged }),
    );
    check('Prior opening cannot authorize the reused frame', $('templateUse').disabled);
    await new Promise(resolve => {
      const delivered = event => {
        if (event.source === first.contentWindow && event.data?.state === 'captured') {
          window.removeEventListener('message', delivered);
          resolve();
        }
      };
      window.addEventListener('message', delivered);
      first.contentWindow.releaseCapture();
      first.contentWindow.holdCapture = false;
    });
    check(
      'A real delayed capture cannot import into the next opening',
      n.revision === revision &&
        n.state.clips.length === count &&
        $('modal').classList.contains('template-dialog') &&
        $('templateUse').disabled,
    );
    frame.dispatchEvent(new Event('error'));
    check('Load errors offer a local retry', !$('templateRetry').hidden && $('templateUse').disabled);
    $('templateRetry').click();
    await wait(() => $('comfyTemplateBrowser') !== frame && $('comfyTemplateBrowser')?.classList.contains('ready'));
    check('Retry replaces the failed frame', !frame.isConnected);
    frame = $('comfyTemplateBrowser');
    frame.contentDocument.getElementById('selectTemplate').click();
    await wait(() => !$('templateUse').disabled);
    frame.contentWindow.captureError = true;
    $('templateUse').click();
    await wait(() => $('templateStatus').textContent === 'Controlled template capture error');
    check(
      'Capture errors keep the selected workflow available',
      !$('templateUse').disabled && n.state.clips.length === count,
    );
    frame.contentWindow.captureError = false;
    $('templateUse').click();
    await wait(() => !!$('keyCaptureCancel') && !$('modalOverlay').hidden);
    check(
      'Use workflow goes directly to existing setup and parks Comfy',
      frame.isConnected && frame.parentElement.hidden && !$('modal').classList.contains('template-dialog'),
    );
    $('keyCaptureCancel').click();
    check('Cancelling setup does not add a shot', n.state.clips.length === count && n.revision === revision);
    frame = await browse();
    frame.contentDocument.getElementById('selectTemplate').click();
    await wait(() => !$('templateUse').disabled);
    $('templateUse').click();
    await wait(() => !!$('keyCaptureSaved') && !$('modalOverlay').hidden);
    $('keyCaptureSaved').click();
    await wait(
      () =>
        n.state.clips.length === count + 1 &&
        !!n.state.clips.at(-1).workflowVersion &&
        $('modalOverlay').hidden &&
        !$('editor').inert,
    );
    await n.flush();
    const added = n.state.clips.at(-1),
      backup = await fetch('/spool/api/projects/' + n.projectKey + '/export').then(r => r.json());
    check(
      'Explicit setup saves a project-owned recipe with model version intact',
      !!added.workflowVersion &&
        n.state.importedWorkflows.some(w => w.id === added.workflow && w.name === 'LTX-2.3 CPU template'),
    );
    check(
      'Backup preserves the selected workflow graph',
      backup.document.importedWorkflows.some(w => w.name === 'LTX-2.3 CPU template' && w.data.workflow),
    );
    check(
      'Template setup preserves existing takes and trims',
      original.every(old => {
        const c = n.state.clips.find(c => c.id === old.id);
        return c.takeId === old.take && c.in === old.in && c.out === old.out;
      }),
    );
    check('Using templates never opens tabs or starts generation', opened === 0 && n.state.jobs.length === 0);
    if (compact) {
      $('closeWorkflowLibrary').click();
      check(
        'Compact drawer closes and returns focus',
        !$('workflowSearch').getClientRects().length && d.activeElement === $('workspaceMenu'),
      );
      $('workspaceMenu').click();
      $('workflowLibraryToggle').click();
    }
    const { createTemplateBrowser } = await import('/spool/ui/template-browser.js'),
      overlay = d.createElement('div');
    overlay.innerHTML = '<div id="probeMount"></div><span></span><button></button><button></button>';
    d.body.append(overlay);
    const probe = createTemplateBrowser({
        overlay,
        idleMs: 80,
        onUse() {
          throw Error('Unexpected probe capture');
        },
        onCancel() {},
      }),
      controls = {
        mount: overlay.children[0],
        status: overlay.children[1],
        useButton: overlay.children[2],
        retryButton: overlay.children[3],
      },
      url = location.origin + '/';
    try {
      probe.open(url, controls);
      await wait(() => overlay.querySelector('iframe.ready'));
      const old = overlay.querySelector('iframe');
      probe.open(url + '?changedHostConfiguration=1', controls);
      await wait(() => overlay.querySelector('iframe.ready'));
      check('Changing the configured address replaces cached Comfy', !old.isConnected);
      const cached = overlay.querySelector('iframe');
      probe.suspend();
      await wait(() => !cached.isConnected);
      check('Idle expiry releases the cached frontend', !probe.canReuse(url + '?changedHostConfiguration=1'));
      probe.open(url, controls);
      await wait(() => overlay.querySelector('iframe.ready'));
      probe.dispose();
      check(
        'Disposing a tab releases its frame and surface',
        !overlay.querySelector('iframe') && !overlay.querySelector('.template-frame-host'),
      );
    } finally {
      probe.dispose();
      overlay.remove();
    }
    await browse();
    return { checks, kind: 'Controlled embedded frame; real capture/persistence/backup routes' };
  } finally {
    window.open = originalOpen;
  }
})();
