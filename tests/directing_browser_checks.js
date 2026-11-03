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
  await wait('transition dialog', () => $('directSees')?.textContent);
  check(
    'The motion model is the default and the dialog says what it sees',
    d.querySelector('.direct-modal [data-direct-workflow="video_minimax_h3_bridge"]').getAttribute('aria-checked') ===
      'true' && /last second of Shot A and the first second of Shot B/.test($('directSees').textContent),
  );
  check('Style suggestions are plain text', !d.querySelector('.direct-modal img.fx-a, .direct-modal [data-preset]'));
  d.querySelector('.direct-modal [data-suggest*="whips"]').click();
  check('A suggestion adds its words to the prompt field', /whips sideways/.test($('directDetail').value));
  $('directAdd').click();
  await wait('transition clip', () => find('transition'));
  const transition = find('transition'),
    anchored = Math.round((22 * (n.state.fps || 24)) / 24);
  check(
    'The transition is inserted at the cut and the next shot moves later',
    clips().indexOf(transition) === 1 &&
      rows().find(r => r.id === 'shot-b').start === afterStart + transition.out - transition.in,
  );
  check(
    'It reads a second of the clips beside it, with their sound',
    JSON.stringify((transition.shotInputs || []).map(s => [s.source, !!s.audio])) ===
      '[["previous",true],["next",true]]',
  );
  check('It keeps the direction in its prompt', /whips sideways/.test(JSON.stringify(transition.inputValues)));
  check(
    'Its slot skips the anchored second of footage',
    transition.in === anchored && transition.direction.head === anchored,
  );
  check(
    'A transition clip carries a quiet label on the timeline',
    d.querySelector('[data-clip="' + transition.id + '"].directed-transition .direction-badge')?.textContent ===
      'Transition',
  );
  check('No cut offers a second transition beside it', d.querySelectorAll('.cut-transition').length === 1);
  await n.flush();
  n.selectClip(transition.id);
  await wait('direction card', () => $('inspectorContent').querySelector('.direction-card'));
  check(
    'The inspector card says the clip is anchored on footage',
    /Anchored on a second of footage/.test($('inspectorContent').querySelector('.direction-card').textContent),
  );
  d.querySelector('.cut-transition').click();
  await wait('second transition dialog', () => $('directSees')?.textContent);
  d.querySelector('.direct-modal [data-direct-workflow="api_minimax_h3_flf2v"]').click();
  check('A frame model says it sees single frames', /last frame of/.test($('directSees').textContent));
  $('directCancel').click();

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
    'Extend adds a clip after the shot that carries on from its last second',
    clips().indexOf(extension) === clips().findIndex(c => c.id === 'shot-c') + 1 &&
      JSON.stringify(extension.shotInputs.map(s => s.source)) === '["previous"]' &&
      extension.in === anchored &&
      /She waves/.test(JSON.stringify(extension.inputValues)),
  );
  check('The extension records the shot it continues', extension.direction.parent === 'shot-c');
  n.setFrame(rows().find(r => r.id === extension.id).start + 2, true);
  await wait('extension preview', () => !$('placeholderDirect').hidden);
  check(
    'An ungenerated extension shows the end of its shot in the viewer',
    $('placeholderDirect').querySelectorAll('img').length === 1 &&
      /Continues Shot C/.test($('placeholderDirect').textContent) &&
      $('placeholderTitle').textContent === 'Not generated yet',
  );
  await wait('attached extension', () => d.querySelector('[data-clip="' + extension.id + '"].attached'));
  check(
    'The shot and its extension draw joined, with a seam and no transition button between them',
    d.querySelector('[data-clip="shot-c"].extended') &&
      d.querySelector('.extension-seam[data-seam="' + extension.id + '"]') &&
      !d.querySelector('.cut-transition[data-cut-left="shot-c"]'),
  );
  await n.flush();
  n.selectClip(extension.id);
  await wait('extension card', () => $('inspectorContent').querySelector('.extension-card'));
  check(
    'The extension card names its shot and selecting the extension marks the shot',
    $('inspectorContent').querySelector('[data-parent-clip="shot-c"]') &&
      d.querySelector('[data-clip="shot-c"].family'),
  );
  n.selectClip('shot-c');
  press('e');
  await wait('chain toast', () => /continued first/.test($('toast')?.textContent || ''));
  check('Extending a shot again carries on from its last extension', $('modalOverlay').hidden);

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
  await wait('findings', () =>
    /masterpiece/.test($('inspectorContent').querySelector('.prompt-findings')?.textContent || ''),
  );
  check(
    'The prompt checks name the quality tag',
    /masterpiece/.test($('inspectorContent').querySelector('.prompt-findings').textContent),
  );
  check(
    'Without reference inputs a mention becomes its description',
    /@Nova/.test($('inspectorContent').querySelector('.prompt-mentions')?.textContent || ''),
  );
  check('Only one set of prompt tools is shown', $('inspectorContent').querySelectorAll('.prompt-tools').length === 1);

  // Extend lives on the timeline (its menu and E); the inspector has no tool buttons. Recast is a workflow.
  n.selectClip('shot-a');
  await wait('shot inspector', () => $('inspectorContent').textContent);
  check('The inspector offers no directing buttons', !$('inspectorContent').querySelector('[data-direct-tool]'));
  const closedBefore = $('modalOverlay').hidden;
  press('r');
  await new Promise(resolve => setTimeout(resolve, 150));
  check('R opens no directing dialog', closedBefore && $('modalOverlay').hidden);

  // Drafts exist only for a workflow that can refine a draft into its final.
  check('A workflow that cannot finish drafts offers no Draft', $('draftToggle').hidden);
  d.querySelector('[data-bin-tab="workflows"]')?.click();
  await wait('draft workflow in the library', () => d.querySelector('[data-builtin="video_minimax_h3_draft"]'));
  const count = clips().length;
  d.querySelector('[data-builtin="video_minimax_h3_draft"]').click();
  await wait('draft clip', () => clips().length === count + 1 && clips().at(-1).workflowVersion);
  await n.flush();
  n.selectClip(clips().at(-1).id);
  await wait('draft clip inspector', () => !$('draftToggle').hidden);
  check(
    'MiniMax H3 Draft and Final offers Draft and keeps its draft input out of the inspector',
    !$('draftToggle').hidden && !/Draft to finish/.test($('inspectorContent').textContent),
  );
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
