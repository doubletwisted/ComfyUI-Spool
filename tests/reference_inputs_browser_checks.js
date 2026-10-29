(async () => {
  // Spool's own MiniMax H3 Reference to Video: optional grouped inputs grow as they fill.
  const n = window.spoolNative,
    $ = id => document.getElementById(id),
    checks = [];
  const check = (label, ok) => {
    if (!ok) throw Error(label);
    checks.push(label);
  };
  const wait = async (predicate, label) => {
    const end = performance.now() + 60000;
    while (!predicate()) {
      if (performance.now() > end) throw Error('Timed out: ' + label + ' · ' + $('toast').textContent);
      await new Promise(r => setTimeout(r, 20));
    }
  };
  await wait(() => document.querySelector('[data-builtin="api_minimax_h3_r2v"]'), 'the library lists the workflow');
  await n.flush();
  document.querySelector('[data-builtin="api_minimax_h3_r2v"]').click();
  await wait(
    () => n.state.clips.length === 1 && n.state.clips[0].workflowVersion && !$('inspector').inert,
    'the shot is added',
  );
  await n.flush();
  const clip = () => n.state.clips[0],
    content = () => $('inspectorContent');
  const fields = () =>
    [...content().querySelectorAll('[data-image-input],[data-media-input]')].map(
      f => f.querySelector('.media-label').firstChild.textContent,
    );
  const problem = () => content().querySelector('.workflow-problem')?.textContent || null;
  check(
    'An empty Reference to Video shows one slot per group',
    JSON.stringify(fields()) === JSON.stringify(['Reference image 1', 'Reference video', 'Reference audio']),
  );
  check('Generate says a reference image or video is needed', problem() === 'Add a reference image or video.');
  check(
    'Empty slots say they are optional',
    [...content().querySelectorAll('[data-image-input],[data-media-input]')].every(
      f => f.querySelector('.media-label em')?.textContent === 'Optional',
    ),
  );
  check(
    'Media slots are compact rows',
    [...content().querySelectorAll('.media-row')].every(row => row.getBoundingClientRect().height <= 60),
  );
  check('Empty slots have no Remove', !content().querySelector('[data-clear-input]'));
  const image = async color => {
    const canvas = new OffscreenCanvas(32, 32),
      g = canvas.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 32, 32);
    return new File([await canvas.convertToBlob({ type: 'image/png' })], color + '.png', { type: 'image/png' });
  };
  const choose = async (position, file) => {
    const picker = content().querySelectorAll('[data-image-input]')[position].querySelector('input[type=file]'),
      files = new DataTransfer();
    files.items.add(file);
    picker.files = files.files;
    picker.dispatchEvent(new Event('change'));
  };
  await choose(0, await image('red'));
  await wait(() => clip().inputValues['3/image'], 'the first image uploads');
  await n.flush();
  check(
    'A chosen image offers the next slot',
    JSON.stringify(fields()) ===
      JSON.stringify(['Reference image 1', 'Reference image 2', 'Reference video', 'Reference audio']),
  );
  const first = content().querySelector('[data-image-input]');
  check(
    'A filled slot shows its thumbnail and drops the Optional tag',
    !!first.querySelector('img:not([hidden])') && !first.querySelector('.media-label em'),
  );
  check('One reference image satisfies the rule', problem() === null);
  check('A filled optional image offers Remove', !!content().querySelector('[data-image-input] [data-clear-input]'));
  await choose(1, await image('blue'));
  await wait(() => clip().inputValues['4/image'], 'the second image uploads');
  await n.flush();
  const red = clip().inputValues['3/image'],
    blue = clip().inputValues['4/image'];
  check('Two images offer a third slot', fields().filter(name => name.startsWith('Reference image')).length === 3);
  content().querySelector('[data-clear-input]').click();
  await n.flush();
  check(
    'Removing image 1 moves image 2 into its place',
    clip().inputValues['3/image'] === blue && clip().inputValues['4/image'] === '',
  );
  check('The inspector closes the gap', fields().filter(name => name.startsWith('Reference image')).length === 2);
  n.undo();
  await n.flush();
  check(
    'Undo restores both images in order',
    clip().inputValues['3/image'] === red && clip().inputValues['4/image'] === blue,
  );
  const project = await fetch('/spool/api/projects/' + n.projectKey).then(r => r.json()),
    recipe = project.recipes[clip().workflowVersion];
  check(
    'The saved recipe keeps its input rule',
    recipe.inputRules?.[0]?.anyOf?.join() === 'Reference images,Reference video',
  );
  check(
    'The saved recipe keeps grouped optional inputs',
    recipe.bindings.filter(b => b.group === 'Reference images' && b.optional).length === 4,
  );
  return { checks };
})();
