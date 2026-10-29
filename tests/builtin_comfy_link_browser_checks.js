// Every Spool workflow through Edit in Comfy and Apply to clip. Needs a host with Partner Nodes.
(async () => {
  const n = spoolNative,
    $ = id => document.getElementById(id),
    checks = [],
    popups = [],
    originalOpen = window.open;
  const check = (label, ok) => {
      if (!ok) throw Error(label);
      checks.push(label);
    },
    wait = async (fn, label) => {
      const end = Date.now() + 90000;
      while (!(await fn())) {
        if (Date.now() > end) throw Error('Timed out: ' + label + ' · ' + $('toast').textContent);
        await new Promise(r => setTimeout(r, 80));
      }
    };
  const links = prompt =>
    JSON.stringify(
      Object.entries(prompt)
        .map(([id, node]) => [
          id,
          node.class_type,
          Object.entries(node.inputs)
            .filter(([, v]) => Array.isArray(v))
            .sort(),
        ])
        .sort(),
    );
  const removal = b => JSON.stringify([b.label, b.group || null, !!b.optional, b.omit || null, b.bypass || null]);
  window.open = function (...args) {
    const tab = originalOpen.apply(window, args);
    if (tab && !popups.includes(tab)) popups.push(tab);
    return tab;
  };
  try {
    const own = Object.keys((await (await fetch('/spool/api/builtin-workflows')).json()).templates);
    check('Spool lists its own workflows', own.length >= 6);
    for (const id of own) {
      await wait(() => document.querySelector('[data-builtin="' + id + '"]'), id + ' is in the library');
      await n.flush();
      const count = n.state.clips.length;
      document.querySelector('[data-builtin="' + id + '"]').click();
      await wait(
        () => n.state.clips.length === count + 1 && n.state.clips.at(-1).workflowVersion && !$('inspector').inert,
        id + ' is added',
      );
      await n.flush();
      const clipId = n.state.clips.at(-1).id,
        shot = () => n.state.clips.find(c => c.id === clipId),
        version = shot().workflowVersion;
      n.selectClip(clipId);
      await n.flush();
      // A chosen image is written into its loader when the graph opens in Comfy.
      const picker = $('inspectorContent').querySelector('[data-image-input] input[type=file]'),
        canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d').fillRect(0, 0, 32, 32);
      const imageKey = shot().bindings.find(b => b.asset && b.contract?.classType === 'LoadImage')?.key;
      if (picker) {
        const files = new DataTransfer();
        files.items.add(
          new File([await canvas.convertToBlob({ type: 'image/png' })], 'subject.png', { type: 'image/png' }),
        );
        picker.files = files.files;
        picker.dispatchEvent(new Event('change'));
        await wait(() => shot().inputValues[imageKey], id + ' takes an image');
        await n.flush();
      }
      const recipe = await (await fetch('/spool/api/workflows/' + shot().workflowVersion)).json();
      await n.editWorkflow();
      await wait(
        () => popups.length && popups.at(-1).comfyAPI?.app?.app?.extensionManager?.workflow?.activeWorkflow,
        id + ' opens in Comfy',
      );
      const comfy = popups.at(-1),
        app = comfy.comfyAPI.app.app;
      let opened;
      await wait(async () => {
        opened = (await app.graphToPrompt()).output;
        return links(opened) === links(recipe.prompt);
      }, id + ': Comfy reopens every connection');
      check(id + ': Comfy reopens every connection', true);
      if (picker) {
        const b = recipe.bindings.find(b => b.key === imageKey);
        check(
          id + ': the chosen image is written into its loader',
          opened[b.nodeId].inputs[b.input] === shot().inputValues[imageKey],
        );
      }
      const toolbar = () => comfy.document.querySelector('#spool-workflow-toolbar');
      await wait(
        () => toolbar() && toolbar().textContent.includes(shot().name) && !toolbar().querySelector('button').disabled,
        id + ': Apply is ready',
      );
      await toolbar().querySelector('button').onclick();
      await n.flush();
      check(id + ': Apply creates a new workflow version', shot().workflowVersion !== version);
      const applied = await (await fetch('/spool/api/workflows/' + shot().workflowVersion)).json();
      check(id + ': Apply keeps every connection', links(applied.prompt) === links(recipe.prompt));
      check(
        id + ': Apply keeps labels, groups and what an empty input leaves out',
        JSON.stringify(applied.bindings.filter(b => b.asset).map(removal)) ===
          JSON.stringify(recipe.bindings.filter(b => b.asset).map(removal)),
      );
      check(
        id + ': Apply keeps every control',
        JSON.stringify(applied.bindings.map(b => b.key).sort()) ===
          JSON.stringify(recipe.bindings.map(b => b.key).sort()),
      );
      check(
        id + ': Apply keeps the input rules',
        JSON.stringify(applied.inputRules || []) === JSON.stringify(recipe.inputRules || []),
      );
    }
    check('Opening and applying the workflows submit no generation', !n.state.jobs.length);
    return { checks, kind: 'Every Spool workflow through the real Comfy graph and Apply bridge; no generation' };
  } finally {
    window.open = originalOpen;
    for (const tab of popups) if (!tab.closed) tab.close();
  }
})();
