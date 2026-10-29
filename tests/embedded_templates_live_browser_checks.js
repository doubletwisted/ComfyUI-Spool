// Real installed Comfy chooser and LTX graph, no generation or downloads.
(async () => {
  const w = window,
    d = w.document,
    n = w.spoolNative,
    $ = id => d.getElementById(id) || n.dialogRoot.getElementById(id),
    checks = [];
  const searchLtx = frame => {
    const input = frame.contentDocument.querySelector('[aria-labelledby="global-workflow-template-selector"] input');
    input.value = 'LTX';
    input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  };
  const check = (label, value) => {
      if (!value) throw Error(label);
      checks.push(label);
    },
    wait = async predicate => {
      const end = Date.now() + 45000;
      while (!(await predicate())) {
        if (Date.now() > end) throw Error('Native inline templates timed out: ' + $('templateStatus')?.textContent);
        await new Promise(r => setTimeout(r, 60));
      }
    };
  await n.flush();
  const count = n.state.clips.length,
    revision = n.revision,
    compact = d.getElementById('editor').classList.contains('compact');
  const outerApp = compact ? (await import('/scripts/app.js')).app : null,
    originalGraph = outerApp ? JSON.stringify(outerApp.rootGraph.serialize()) : null;
  if (compact) {
    $('workspaceMenu').click();
    $('workflowLibraryToggle').click();
  }
  $('browseComfyTemplates').click();
  await wait(() => $('comfyTemplateBrowser')?.classList.contains('ready'));
  const frame = $('comfyTemplateBrowser');
  await wait(() =>
    frame.contentDocument.querySelector('[aria-labelledby="global-workflow-template-selector"] h3[title]'),
  );
  const native = frame.contentDocument.querySelector('[aria-labelledby="global-workflow-template-selector"]');
  const bounds = native.getBoundingClientRect();
  check(
    'Native picker fills its frame without cropping',
    Math.abs(bounds.x) < 1 &&
      Math.abs(bounds.y) < 1 &&
      bounds.width <= frame.clientWidth + 1 &&
      bounds.height <= frame.clientHeight + 1,
  );
  const outerBounds = frame.getBoundingClientRect(),
    mountBounds = $('templateMount').getBoundingClientRect();
  check(
    'Stable frame host follows the modal body',
    Math.abs(outerBounds.x - mountBounds.x) < 1 &&
      Math.abs(outerBounds.y - mountBounds.y) < 1 &&
      Math.abs(outerBounds.height - mountBounds.height) < 1 &&
      Math.abs(outerBounds.width - mountBounds.width) < 1,
  );
  check(
    'Fallback controls stay hidden behind the native chooser',
    frame.contentWindow.getComputedStyle(frame.contentDocument.getElementById('spool-template-choice')).display ===
      'none',
  );
  check(
    'Real native chooser runs inside the Spool dialog',
    $('modalOverlay').contains(frame) && !!native.querySelector('h3[title]'),
  );
  check(
    'Restored Comfy graphs cannot be captured before selecting a template',
    $('templateUse').disabled && !frame.contentWindow.spoolDock,
  );
  // The native chooser virtualizes its cards; search rather than assuming LTX
  // appears in the first screen of an evolving installed template catalog.
  searchLtx(frame);
  await wait(() => native.querySelector('h3[title="LTX-2.3: Image to Video"]'));
  const selected = native.querySelector('h3[title="LTX-2.3: Image to Video"]');
  check('Installed LTX template is available', !!selected);
  selected.click();
  await wait(() => !$('templateUse').disabled);
  check('Native selection does not import automatically', n.state.clips.length === count && n.revision === revision);
  const { app } = await frame.contentWindow.Function('return import("/scripts/app.js")')();
  const image = app.rootGraph.nodes.find(node => node.type === 'LoadImage'),
    available = await fetch('/object_info/LoadImage').then(r => r.json()),
    source = available.LoadImage.input.required.image[0].find(name => name === 'spool-template-browser-qa.png');
  if (!source) throw Error('QA image spool-template-browser-qa.png missing');
  image.widgets.find(widget => widget.name === 'image').value = source;
  $('templateUse').click();
  await wait(() => {
    if ($('templateStatus')?.textContent.includes('changed during capture'))
      throw Error($('templateStatus').textContent);
    return !!$('keyCaptureSaved') && !$('modalOverlay').hidden;
  });
  check(
    'Use workflow opens explicit capture and parks its frame',
    frame.isConnected && frame.parentElement.hidden && !$('modal').classList.contains('template-dialog'),
  );
  $('keyCaptureSaved').click();
  await wait(
    () => n.state.clips.length === count + 1 && !!n.state.clips.at(-1).workflowVersion && $('modalOverlay').hidden,
  );
  await n.flush();
  const version = n.state.clips.at(-1).workflowVersion,
    recipe = await fetch('/spool/api/workflows/' + version).then(r => r.json()),
    backup = await fetch('/spool/api/projects/' + n.projectKey + '/export').then(r => r.json());
  check(
    'Actual LTX graph and executable prompt are captured',
    recipe.workflow.nodes.length > 0 &&
      Object.keys(recipe.prompt).length > 10 &&
      backup.document.importedWorkflows.some(w => w.data.workflow.nodes?.length),
  );
  check('No generation is queued', n.state.jobs.length === 0);
  if (outerApp)
    check(
      'The active parent Comfy graph is unchanged',
      JSON.stringify(outerApp.rootGraph.serialize()) === originalGraph,
    );
  $('browseComfyTemplates').click();
  await wait(() => $('comfyTemplateBrowser')?.classList.contains('ready'));
  const reopened = $('comfyTemplateBrowser');
  check(
    'Native warm reopen reuses Comfy with fresh selection consent',
    reopened === frame && $('templateUse').disabled,
  );
  const media = reopened.contentDocument.createElement('video');
  let paused = false;
  media.pause = () => {
    paused = true;
  };
  reopened.contentDocument.body.append(media);
  reopened.contentDocument
    .querySelector('[aria-labelledby="global-workflow-template-selector"] input')
    .dispatchEvent(new reopened.contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(() => $('modalOverlay').hidden);
  check(
    'Escape in the native picker cancels without editing',
    n.state.clips.length === count + 1 && reopened.parentElement.hidden,
  );
  await wait(() => paused);
  check('Closing pauses retained media previews', paused);
  media.remove();
  $('browseComfyTemplates').click();
  await wait(() => $('comfyTemplateBrowser')?.classList.contains('ready'));
  searchLtx($('comfyTemplateBrowser'));
  await wait(() => $('comfyTemplateBrowser').contentDocument.querySelector('h3[title="LTX-2.3: Image to Video"]'));
  return {
    checks,
    kind: 'Real installed template chooser/LTX capture; uploaded QA image selected; no generation',
    project: n.projectKey,
    version,
    promptNodes: Object.keys(recipe.prompt).length,
  };
})();
