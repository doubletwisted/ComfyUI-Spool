(async () => {
  const w = window,
    n = w.spoolNative,
    d = w.document,
    $ = id => d.getElementById(id),
    checks = [];
  const check = (label, ok) => {
    if (!ok) throw Error(label);
    checks.push(label);
  };
  const wait = async (label, fn) => {
    const end = Date.now() + 15000;
    while (!(await fn())) {
      if (Date.now() > end) throw Error('Timed out: ' + label + ' · ' + ($('toast')?.textContent || ''));
      await new Promise(r => setTimeout(r, 50));
    }
  };
  const clips = () => n.state.clips,
    find = kind => clips().find(c => c.direction?.kind === kind),
    rows = () => {
      let at = 0;
      return clips().map(c => ((at += c.gapBefore || 0), { id: c.id, start: (at += c.out - c.in) - (c.out - c.in) }));
    };
  const press = key => d.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  // Transitions sit on cuts between touching shots.
  await wait('cut buttons', () => d.querySelectorAll('.cut-transition').length === 2);
  check('Every touching cut offers a transition', d.querySelectorAll('.cut-transition').length === 2);
  const afterStart = rows().find(r => r.id === 'shot-b').start;
  d.querySelector('.cut-transition[data-cut-left="shot-a"]').click();
  await wait('transition dialog', () => d.querySelector('.direct-modal .preset-grid'));
  check('The dialog shows nine styles', d.querySelectorAll('.direct-modal [data-preset]').length === 9);
  check(
    'Style tiles preview the two frames around the cut',
    d.querySelectorAll('.direct-modal .preset-swatch img.fx-a').length === 9 &&
      d.querySelectorAll('.direct-modal .preset-swatch img.fx-b').length === 9,
  );
  d.querySelector('.direct-modal [data-preset="whip-pan"]').click();
  check(
    'Choosing a style marks it',
    d.querySelector('.direct-modal [data-preset="whip-pan"]').getAttribute('aria-checked') === 'true',
  );
  $('directAdd').click();
  await wait('transition clip', () => find('transition'));
  const transition = find('transition');
  check(
    'The transition is inserted at the cut and the next shot moves later',
    clips().indexOf(transition) === 1 &&
      rows().find(r => r.id === 'shot-b').start === afterStart + transition.out - transition.in,
  );
  check(
    'Its first and last frames read the clips beside it',
    JSON.stringify((transition.shotInputs || []).map(s => s.source)) === '["previous","next"]',
  );
  check(
    'It remembers its style',
    transition.direction.preset === 'whip-pan' && /whips/.test(JSON.stringify(transition.inputValues)),
  );
  check('Its slot skips the repeated first frame', transition.in === 1);
  check(
    'A transition clip is marked on the timeline',
    d.querySelector('[data-clip="' + transition.id + '"].directed-transition .direction-badge'),
  );
  check('No cut offers a second transition beside it', d.querySelectorAll('.cut-transition').length === 1);
  await n.flush();
  n.selectClip(transition.id);
  await wait('direction card', () => $('inspectorContent').querySelector('.direction-card'));
  $('inspectorContent').querySelector('[data-direction-preset="dissolve"]').click();
  await wait('style change', () => find('transition').direction.preset === 'dissolve');
  check(
    'The inspector card changes the style and its prompt',
    /cross dissolve/.test(JSON.stringify(find('transition').inputValues)) &&
      find('transition').name === 'Dissolve transition',
  );

  // Extend adds the next moment after a shot.
  n.selectClip('shot-c');
  press('e');
  await wait('extend dialog', () => $('modalTitle')?.textContent === 'Extend shot');
  $('directDetail').value = 'she waves';
  $('directDetail').dispatchEvent(new Event('input'));
  $('directAdd').click();
  await wait('extension', () => find('extend'));
  const extension = find('extend');
  check(
    'Extend adds a clip after the shot that starts on its last frame',
    clips().indexOf(extension) === clips().findIndex(c => c.id === 'shot-c') + 1 &&
      extension.shotInputs?.[0]?.source === 'previous' &&
      /she waves/.test(JSON.stringify(extension.inputValues)),
  );

  // Cast members come from pictures and are mentioned with @Name.
  d.querySelector('[data-bin-tab="cast"]').click();
  await wait('cast panel', () => $('castNewFile'));
  const canvas = d.createElement('canvas');
  canvas.width = canvas.height = 8;
  canvas.getContext('2d').fillRect(0, 0, 8, 8);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png')),
    files = new DataTransfer();
  files.items.add(new File([blob], 'Nova-portrait.png', { type: 'image/png' }));
  $('castNewFile').files = files.files;
  $('castNewFile').dispatchEvent(new Event('change'));
  await wait('cast member', () => (n.state.cast || []).length === 1);
  check(
    'A cast member takes its name from the picture',
    n.state.cast[0].name === 'Nova' && n.state.cast[0].images.length === 1,
  );
  const name = d.querySelector('[data-cast-name]');
  name.value = 'Nova';
  name.dispatchEvent(new Event('change'));
  check('Renaming a member to its own name keeps it', n.state.cast[0].name === 'Nova');

  n.selectClip(extension.id);
  await wait('prompt tools', () => $('inspectorContent').querySelector('.prompt-tools'));
  const prompt = $('inspectorContent').querySelector('.binding-positive textarea');
  prompt.focus();
  prompt.value = 'masterpiece, @No';
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait('mention menu', () => d.querySelector('.mention-menu [data-mention="Nova"]'));
  check('Typing @ suggests cast members', true);
  prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait('mention inserted', () => prompt.value === 'masterpiece, @Nova ');
  check('Enter inserts the mention', true);
  await wait('findings', () => $('inspectorContent').querySelector('.prompt-findings'));
  check(
    'The prompt checks name the quality tag',
    /masterpiece/.test($('inspectorContent').querySelector('.prompt-findings').textContent),
  );
  check(
    'Without reference inputs a mention becomes its description',
    /@Nova/.test($('inspectorContent').querySelector('.prompt-mentions')?.textContent || ''),
  );
  check('Only one set of prompt tools is shown', $('inspectorContent').querySelectorAll('.prompt-tools').length === 1);

  // Retake splits a shot and renders a new middle between its frames.
  const before = clips().length;
  n.selectClip('shot-a');
  press('r');
  await wait('retake dialog', () => $('retakeRange'));
  $('directAdd').click();
  await wait('retake', () => find('retake'));
  const retake = find('retake');
  check(
    'Retake splits the shot into three and links the middle to both sides',
    clips().length === before + 2 &&
      JSON.stringify(retake.shotInputs.map(s => s.source)) === '["previous","next"]' &&
      retake.takes.some(t => !t.placeholder),
  );

  // Draft mode is a view preference shown on Generate.
  $('draftToggle').click();
  check(
    'Draft mode marks the toggle and Generate',
    $('draftToggle').getAttribute('aria-pressed') === 'true' && $('generateLabel').textContent === 'Generate drafts',
  );
  $('draftToggle').click();
  check('Draft mode turns off again', $('generateLabel').textContent === 'Generate');
  await n.flush();
  return { checks };
})();
