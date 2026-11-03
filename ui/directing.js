import * as T from './timeline.js';
import * as D from './direction.js';
import { resolveMentions, tag, tagStyle } from './cast.js';
import { inputFilled } from './input-groups.js';
import { lintPrompt } from './prompt-lint.js';

// Directing tools: transitions at cuts, extensions and the cast.
// Every tool makes or changes ordinary clips with ordinary workflows; the clip's
// `direction` only remembers how it was made so the inspector can offer the same
// choices again.
export function createDirecting({
  $,
  esc,
  svg,
  api,
  projectKey,
  getState,
  edits,
  getFps,
  thumbnails,
  take,
  rowFor,
  addBuiltinShot,
  getTemplate,
  getTemplateBindings,
  queueClips,
  showModal,
  closeModal,
  toast,
  setStatus,
  selectClip,
  editView,
  pause,
  render,
  getBinTab,
  getRecipe,
  flush,
}) {
  const choices = kind => (D.WORKFLOWS[kind] || []).filter(choice => getTemplate(choice.id));

  // ---- shared dialog parts -------------------------------------------------------
  function frameThumb(clip, edge, caption) {
    const t = clip && take(clip);
    if (!t || t.placeholder)
      return (
        '<figure class="direct-frame empty"><span>' +
        svg('image') +
        '</span><figcaption>' +
        esc(caption) +
        '<small>No take yet</small></figcaption></figure>'
      );
    const frame = edge === 'last' ? Math.max(clip.in, clip.out - 1) : clip.in;
    return (
      '<figure class="direct-frame"><img data-direct-thumb="' +
      esc(clip.id) +
      '" data-frame="' +
      frame +
      '" alt=""><figcaption>' +
      esc(caption) +
      '<small>' +
      esc(clip.name) +
      '</small></figcaption></figure>'
    );
  }
  function bindThumbs(root) {
    root.querySelectorAll('[data-direct-thumb]').forEach(img => {
      const c = getState().clips.find(c => c.id === img.dataset.directThumb);
      if (c) thumbnails.bind(img, take(c).media, Number(img.dataset.frame), getFps());
    });
  }
  /** Optional wording for the prompt field: each adds its phrase to `#directDetail`. */
  function suggestions(list) {
    return list.length
      ? '<div class="direct-suggestions"><span>Suggestions</span>' +
          list
            .map(
              p =>
                '<button type="button" data-suggest="' +
                esc(p.prompt) +
                '" title="' +
                esc(p.prompt) +
                '">' +
                esc(p.name) +
                '</button>',
            )
            .join('') +
          '</div>'
      : '';
  }
  function workflowPicker(kind, current) {
    const list = choices(kind);
    return (
      '<div class="direct-field"><span>Model</span><div class="seg direct-models" role="radiogroup">' +
      list
        .map(
          choice =>
            '<button type="button" role="radio" data-direct-workflow="' +
            esc(choice.id) +
            '" aria-checked="' +
            (choice.id === current) +
            '" class="' +
            (choice.id === current ? 'active' : '') +
            '">' +
            svg(choice.target === 'cloud' ? 'nodes' : 'spark') +
            esc(choice.label) +
            '</button>',
        )
        .join('') +
      '</div></div>'
    );
  }
  function lengthField(seconds, choice, label = 'Length') {
    return (
      '<label class="direct-field direct-length"><span>' +
      esc(label) +
      '</span><span class="direct-stepper"><button type="button" data-step="-1" aria-label="Shorter">−</button><output id="directSeconds">' +
      D.fitSeconds(choice, seconds) +
      ' s</output><button type="button" data-step="1" aria-label="Longer">+</button></span></label>'
    );
  }
  function footer(primary) {
    return (
      '<button class="outline" id="directCancel">Cancel</button><button class="outline" id="directAdd">' +
      esc(primary) +
      '</button><button class="primary" id="directGenerate">' +
      svg('play') +
      esc(primary) +
      ' and generate</button>'
    );
  }
  /**
   * Opens a directing dialog and wires the shared controls. `state` holds the live
   * choices; `apply(state, generate)` performs the edit.
   */
  function openDialog(title, body, primary, state, apply, { onChange = () => {}, kind } = {}) {
    pause();
    showModal(title, '<div class="direct-dialog">' + body + '</div>', footer(primary));
    $('modal').classList.add('direct-modal');
    const root = $('modal');
    bindThumbs(root);
    const refresh = () => {
      root.querySelectorAll('[data-direct-workflow]').forEach(b => {
        const on = b.dataset.directWorkflow === state.workflow;
        b.setAttribute('aria-checked', on);
        b.classList.toggle('active', on);
      });
      const choice = choices(kind).find(c => c.id === state.workflow);
      if (choice && $('directSeconds')) {
        state.seconds = D.fitSeconds(choice, state.seconds);
        $('directSeconds').textContent = state.seconds + ' s';
      }
      onChange(state, root);
    };
    // Delegated, so suggestions in a body drawn again later still work.
    root.querySelector('.direct-dialog').addEventListener('click', e => {
      const b = e.target.closest('[data-suggest]'),
        field = $('directDetail');
      if (!b || !field) return;
      const before = field.value.trim();
      field.value = (before ? before.replace(/[.!?]?$/, '. ') : '') + b.dataset.suggest;
      state.detail = field.value;
      field.focus();
    });
    root.querySelectorAll('[data-direct-workflow]').forEach(
      b =>
        (b.onclick = () => {
          state.workflow = b.dataset.directWorkflow;
          refresh();
        }),
    );
    root.querySelectorAll('[data-step]').forEach(
      b =>
        (b.onclick = () => {
          const choice = choices(kind).find(c => c.id === state.workflow);
          if (choice?.options) {
            const at = choice.options.indexOf(D.fitSeconds(choice, state.seconds));
            state.seconds =
              choice.options[Math.max(0, Math.min(choice.options.length - 1, at + Number(b.dataset.step)))];
          } else state.seconds = (state.seconds || 1) + Number(b.dataset.step);
          refresh();
        }),
    );
    const detail = $('directDetail');
    if (detail) detail.oninput = () => (state.detail = detail.value);
    $('directCancel').onclick = closeModal;
    const run = generate => async () => {
      try {
        const problem = state.problem?.();
        if (problem) {
          toast(problem);
          return;
        }
        closeModal();
        await apply(state, generate);
      } catch (error) {
        toast(error.message);
      }
    };
    $('directAdd').onclick = run(false);
    $('directGenerate').onclick = run(true);
    refresh();
    (detail || $('directGenerate'))?.focus();
  }

  // ---- building a directed clip ----------------------------------------------------
  /** Fills a freshly assigned workflow from a directing choice. Runs inside the edit. */
  function fill(c, { prompt, seconds, links = [], images = [], frames, trimHead = 0, trimTail = 0, shape = null }) {
    const b = D.toolBindings(c.bindings);
    if (b.prompt) c.inputValues[b.prompt.key] = prompt;
    // Match the picture it joins, so a square default never meets widescreen footage.
    const media = shape && take(shape)?.media;
    if (media?.width && media?.height)
      for (const binding of b.aspect)
        c.inputValues[binding.key] = D.aspectValue(binding, c.inputValues[binding.key], media.width, media.height);
    // And its sharpness, so the join does not soften.
    if (media?.width && media?.height && b.megapixels)
      c.inputValues[b.megapixels.key] = D.megapixelsValue(c.inputValues[b.megapixels.key], media.width, media.height);
    if (b.duration && seconds) c.inputValues[b.duration.key] = D.durationValue(c.inputValues[b.duration.key], seconds);
    c.shotInputs = links.filter(link => link.key);
    images.forEach((file, i) => {
      if (b.references[i]) c.inputValues[b.references[i].key] = file;
    });
    if (frames) {
      // A generated take repeats the anchored frames; the slot skips them, so the
      // clip joins its neighbours without a held frame or a repeated movement.
      const t = c.takes.find(t => t.id === c.takeId);
      if (t?.placeholder) {
        t.media.frames = frames + trimHead + trimTail;
        c.in = trimHead;
        c.out = trimHead + frames;
      }
      if (c.direction) c.direction.head = trimHead;
    }
    c.seedMode = 'randomize';
    c.revision++;
  }
  /**
   * Links and lengths for a clip between `previous` and/or `next`. A motion workflow
   * reads the last second of the clip before and the first second of the clip after;
   * others read one frame on each side.
   */
  function joining(b, seconds, { previous = false, next = false }) {
    const fps = getFps(),
      motion = !!((!previous || b.before) && (!next || b.after) && (b.before || b.after));
    if (motion) {
      const head = previous ? b.before.span.frames : 0,
        tail = next ? b.after.span.frames : 0,
        length = D.motionLength(seconds, head, tail),
        scale = fps / 24,
        link = (binding, source) => ({ key: binding.key, source, ...(binding.audio ? { audio: true } : {}) });
      return {
        motion,
        seconds: length.seconds,
        // Where the new part starts and ends in the take, in seconds; the prompt's timeline uses them.
        middle: [head / 24, (length.total - tail) / 24],
        frames: Math.round(length.visible * scale),
        trimHead: Math.round(head * scale),
        trimTail: Math.round(tail * scale),
        links: [...(previous ? [link(b.before, 'previous')] : []), ...(next ? [link(b.after, 'next')] : [])],
      };
    }
    return {
      motion,
      seconds,
      frames: Math.round(seconds * fps),
      trimHead: previous ? 1 : 0,
      trimTail: next ? 1 : 0,
      links: [
        ...(previous ? [{ key: b.first?.key, source: 'previous' }] : []),
        ...(next ? [{ key: b.last?.key, source: 'next' }] : []),
      ],
    };
  }
  async function place(kind, workflow, target, setup) {
    let made = null;
    await addBuiltinShot(workflow, target.index ?? null, target.clipId ?? null, target.placement ?? null, {
      setup: c => {
        setup(c);
        made = c.id;
      },
    });
    if (!made) throw Error('The ' + D.KINDS[kind].name.toLowerCase() + ' was not added.');
    return getState().clips.find(c => c.id === made);
  }
  async function finish(clips, generate, message) {
    clips = clips.filter(Boolean);
    if (!clips.length) return;
    if (clips.length === 1) selectClip(clips[0].id, true);
    render();
    setStatus(message);
    if (!generate) return;
    // The new clip's edits may still be saving; a revision conflict is retried once they settle.
    const ids = clips.map(c => c.id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await flush().catch(() => {});
      const fresh = ids.map(id => getState().clips.find(c => c.id === id)).filter(Boolean),
        result = await queueClips(fresh);
      if (result === true || result?.status !== 409) return;
      await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    }
    toast('The project was still saving. Press Generate to queue the new clip.');
  }

  // ---- transitions -------------------------------------------------------------------
  /** One line under the frames saying what the chosen model sees. */
  function seesLine(choice, before, after) {
    const name = c => '<strong>' + esc(c.name) + '</strong>';
    if (choice?.motion)
      return (
        'The model sees ' +
        [before && 'the last second of ' + name(before), after && 'the first second of ' + name(after)]
          .filter(Boolean)
          .join(' and ') +
        (before && after ? ', with their sound,' : ', with its sound,') +
        ' so movement carries through the new clip.'
      );
    return (
      'The model sees ' +
      [before && 'the last frame of ' + name(before), after && 'the first frame of ' + name(after)]
        .filter(Boolean)
        .join(' and ') +
      '. Movement starts again from a still frame.'
    );
  }
  function transitionDialog(leftId, rightId) {
    const doc = getState(),
      left = doc.clips.find(c => c.id === leftId),
      right = doc.clips.find(c => c.id === rightId);
    if (!left || !right) return;
    const list = choices('transition');
    if (!list.length) {
      toast('No first and last frame workflow is available.');
      return;
    }
    const state = { detail: '', seconds: 4, workflow: list[0].id };
    openDialog(
      'Add transition',
      '<div class="direct-hero">' +
        frameThumb(left, 'last', 'Out of') +
        '<span class="direct-bridge" aria-hidden="true">' +
        svg('transition') +
        '</span>' +
        frameThumb(right, 'first', 'Into') +
        '</div><p class="direct-lede" id="directSees"></p><label class="direct-field"><span>What happens in between</span><textarea id="directDetail" rows="4" placeholder="How the camera and the people get from the last frame to the first frame of the next shot, and what comes into view. e.g. she slows, sinks and turns upright; the camera eases back and the statue comes in on the right"></textarea></label>' +
        suggestions(D.TRANSITIONS) +
        '<div class="direct-row">' +
        lengthField(state.seconds, list[0]) +
        workflowPicker('transition', state.workflow) +
        '</div>',
      'Add transition',
      state,
      (s, generate) => addTransition(leftId, rightId, s, generate),
      {
        kind: 'transition',
        onChange: s =>
          ($('directSees').innerHTML = seesLine(
            list.find(c => c.id === s.workflow),
            left,
            right,
          )),
      },
    );
  }
  async function addTransition(leftId, rightId, options, generate = false) {
    const doc = getState(),
      left = doc.clips.find(c => c.id === leftId),
      right = doc.clips.find(c => c.id === rightId);
    if (!left || !right) throw Error('Both shots must still be on the timeline.');
    const choice = choices('transition').find(c => c.id === options.workflow) || choices('transition')[0],
      row = rowFor(left.id);
    const clip = await place(
      'transition',
      choice.id,
      { index: doc.clips.indexOf(right), placement: { track: T.videoTrack(left), start: row.end } },
      c => {
        const b = D.toolBindings(c.bindings),
          join = joining(b, D.fitSeconds(choice, options.seconds), { previous: true, next: true });
        c.name = 'Transition';
        c.direction = { kind: 'transition', detail: options.detail || '' };
        fill(c, { ...join, prompt: D.transitionPrompt(options.detail, join), shape: left });
      },
    );
    await finish([clip], generate, 'Transition added');
  }

  // ---- extend ------------------------------------------------------------------------
  function sourcePrompt(c) {
    const b = D.toolBindings(c.bindings || []);
    return b.prompt ? String(c.inputValues?.[b.prompt.key] || '') : '';
  }
  /** A shot that already has extensions carries on from the end of the last one. */
  function chainOf(doc, shot) {
    let root = shot,
      source = shot;
    while (D.attachedParent(doc, root)) root = D.attachedParent(doc, root);
    for (let next; (next = doc.clips.find(c => D.attachedParent(doc, c) === source));) source = next;
    return { root, source };
  }
  function extendDialog(clipId) {
    const shot = getState().clips.find(c => c.id === clipId);
    if (!shot) return;
    const c = chainOf(getState(), shot).source;
    if (take(c).placeholder) {
      toast('Generate or choose a take for ' + c.name + ' first.');
      return;
    }
    const list = choices('extend');
    if (!list.length) {
      toast('No image to video workflow is available.');
      return;
    }
    const state = { detail: '', seconds: 4, workflow: list[0].id };
    openDialog(
      'Extend shot',
      '<div class="direct-hero single">' +
        frameThumb(c, 'last', 'Continues from') +
        '<span class="direct-bridge" aria-hidden="true">' +
        svg('extend') +
        '</span><figure class="direct-frame next"><span>' +
        svg('spark') +
        '</span><figcaption>Extension<small>Attached after ' +
        esc(c.name) +
        '</small></figcaption></figure></div><p class="direct-lede" id="directSees"></p><label class="direct-field"><span>What happens next</span><textarea id="directDetail" rows="3" placeholder="e.g. she turns to the window and the camera pushes in slowly"></textarea></label><div class="direct-row">' +
        lengthField(state.seconds, list[0]) +
        workflowPicker('extend', state.workflow) +
        '</div>',
      'Extend shot',
      state,
      (s, generate) => extendClip(clipId, s, generate),
      {
        kind: 'extend',
        onChange: s =>
          ($('directSees').innerHTML = seesLine(
            list.find(x => x.id === s.workflow),
            c,
            null,
          )),
      },
    );
  }
  async function extendClip(clipId, options, generate = false) {
    const doc = getState(),
      shot = doc.clips.find(c => c.id === clipId);
    if (!shot) throw Error('This shot was removed.');
    const { source, root } = chainOf(doc, shot),
      named = root.name + ' · continued',
      taken = doc.clips.filter(c => c.name === named || c.name.startsWith(named + ' ')).length;
    const choice = choices('extend').find(c => c.id === options.workflow) || choices('extend')[0],
      seconds = D.fitSeconds(choice, options.seconds),
      row = rowFor(source.id),
      next = doc.clips[doc.clips.indexOf(source) + 1];
    const clip = await place(
      'extend',
      choice.id,
      {
        index: next ? doc.clips.indexOf(next) : doc.clips.length,
        placement: { track: T.videoTrack(source), start: row.end },
      },
      c => {
        const join = joining(D.toolBindings(c.bindings), seconds, { previous: true });
        c.name = named + (taken ? ' ' + (taken + 1) : '');
        c.direction = { kind: 'extend', detail: options.detail || '', parent: source.id };
        fill(c, { ...join, prompt: D.extendPrompt(sourcePrompt(source), options.detail, join), shape: source });
      },
    );
    await finish([clip], generate, 'Extension added after ' + source.name);
  }

  // ---- cast ------------------------------------------------------------------------------
  function castList() {
    return getState().cast || [];
  }
  function castImage(file) {
    return '/spool/api/input/' + encodeURIComponent(file);
  }
  async function uploadImage(file) {
    if (!file.type.startsWith('image/')) throw Error('Choose an image file.');
    const uploaded = await api.upload('projects/' + projectKey + '/input', file, file.name || 'cast.png', {
      fallback: 'Could not save this picture.',
    });
    return uploaded.file;
  }
  async function addCastMember(name, files) {
    const images = [];
    for (const file of files) images.push(await uploadImage(file));
    const member = {
      id: 'cast-' + crypto.randomUUID(),
      name: uniqueName(name || 'Character'),
      description: '',
      images,
    };
    edits.apply('Add ' + member.name + ' to the cast', () => {
      (getState().cast ??= []).push(member);
    });
    renderCast();
    return member;
  }
  function uniqueName(name, self = null) {
    const clean =
        String(name)
          .replace(/[^\p{L}\p{N}_ -]/gu, '')
          .trim()
          .replace(/\s+/g, '') || 'Character',
      taken = new Set(
        castList()
          .filter(m => m.id !== self)
          .map(m => m.name.toLowerCase()),
      );
    let candidate = clean,
      n = 2;
    while (taken.has(candidate.toLowerCase())) candidate = clean + n++;
    return candidate;
  }
  function renderCast() {
    const panel = $('castPanel');
    if (!panel || getBinTab() !== 'cast') return;
    const cast = castList();
    panel.innerHTML =
      '<div class="cast-intro"><strong>Cast</strong><p>Characters, props and places you reuse. Write <code>@Name</code> in a prompt and Spool passes their pictures to the workflow as references.</p></div><div class="cast-list">' +
      cast
        .map(
          m =>
            '<article class="cast-card" data-cast="' +
            esc(m.id) +
            '"><div class="cast-images">' +
            m.images
              .map(
                (file, i) =>
                  '<span class="cast-image"><img src="' +
                  esc(castImage(file)) +
                  '" alt=""><button type="button" data-cast-remove-image="' +
                  i +
                  '" aria-label="Remove picture" title="Remove picture">' +
                  svg('close') +
                  '</button></span>',
              )
              .join('') +
            (m.images.length < 4
              ? '<label class="cast-image add" title="Add a picture"><input type="file" accept="image/*" multiple hidden data-cast-add-image>' +
                svg('plus') +
                '</label>'
              : '') +
            '</div><div class="cast-fields"><label><span class="cast-at">@</span><input data-cast-name value="' +
            esc(m.name) +
            '" aria-label="Name" spellcheck="false"></label><input data-cast-description value="' +
            esc(m.description || '') +
            '" placeholder="Short description, e.g. woman in a red coat" aria-label="Description"></div><button type="button" class="iconbutton cast-delete" data-cast-delete title="Remove from cast" aria-label="Remove ' +
            esc(m.name) +
            ' from cast">' +
            svg('trash') +
            '</button></article>',
        )
        .join('') +
      '</div><label class="cast-drop" id="castDrop"><input type="file" accept="image/*" multiple hidden id="castNewFile">' +
      svg('plus') +
      '<span>New cast member<small>Drop or choose pictures of one character</small></span></label>';
    $('castNewFile').onchange = e => void newFrom([...e.target.files]);
    const drop = $('castDrop');
    drop.ondragover = e => {
      e.preventDefault();
      drop.classList.add('drag-over');
    };
    drop.ondragleave = () => drop.classList.remove('drag-over');
    drop.ondrop = e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      void newFrom([...e.dataTransfer.files]);
    };
    panel.querySelectorAll('[data-cast]').forEach(card => {
      const id = card.dataset.cast,
        member = () => castList().find(m => m.id === id);
      const change = (label, fn) => {
        if (!member()) return;
        edits.apply(label, () => fn(member()), 'none');
        renderCast();
      };
      card.querySelector('[data-cast-name]').onchange = e => {
        const value = uniqueName(e.target.value, id);
        if (value === member()?.name) return;
        change('Rename cast member', m => (m.name = value));
      };
      card.querySelector('[data-cast-description]').onchange = e =>
        change('Describe ' + member()?.name, m => (m.description = e.target.value.trim()));
      card.querySelector('[data-cast-delete]').onclick = () => {
        edits.apply('Remove ' + member()?.name + ' from the cast', () => {
          getState().cast = castList().filter(m => m.id !== id);
        });
        renderCast();
      };
      card.querySelectorAll('[data-cast-remove-image]').forEach(
        b =>
          (b.onclick = () => {
            if (member().images.length === 1) {
              toast('A cast member keeps at least one picture.');
              return;
            }
            change('Remove a picture', m => m.images.splice(Number(b.dataset.castRemoveImage), 1));
          }),
      );
      const add = card.querySelector('[data-cast-add-image]');
      if (add)
        add.onchange = async e => {
          try {
            const files = [...e.target.files].slice(0, 4 - member().images.length);
            const uploaded = [];
            for (const file of files) uploaded.push(await uploadImage(file));
            change('Add pictures to ' + member().name, m => m.images.push(...uploaded));
          } catch (error) {
            toast(error.message);
          }
        };
    });
  }
  async function newFrom(files) {
    const images = files.filter(f => f.type.startsWith('image/')).slice(0, 4);
    if (!images.length) {
      toast('Choose pictures of the character.');
      return;
    }
    try {
      await addCastMember(images[0].name.replace(/\.[^.]+$/, '').split(/[-_ .]+/)[0], images);
    } catch (error) {
      toast(error.message);
    }
  }

  // ---- inspector card -------------------------------------------------------------------------
  function directionCard(c) {
    const d = c.direction;
    if (!d?.kind || !D.KINDS[d.kind] || !c.workflowVersion) return '';
    if (d.kind === 'extend') return extensionCard(c);
    const doc = getState(),
      previous = D.neighbor(doc, c, 'previous'),
      next = D.neighbor(doc, c, 'next'),
      links = (c.shotInputs || []).map(s => s.source),
      frames =
        (links.includes('previous') ? frameThumb(previous, 'last', 'From') : '') +
        (links.includes('previous') && links.includes('next')
          ? '<span class="direct-bridge" aria-hidden="true">' + svg(D.KINDS[d.kind].icon) + '</span>'
          : '') +
        (links.includes('next') ? frameThumb(next, 'first', 'To') : '');
    const bindings = D.toolBindings(c.bindings),
      motion = (bindings.before || bindings.after) && links.some(l => l === 'previous' || l === 'next');
    return (
      '<section class="direction-card"><div class="direction-head">' +
      svg(D.KINDS[d.kind].icon) +
      '<strong>' +
      esc(D.KINDS[d.kind].name) +
      '</strong>' +
      (motion ? '<span>Anchored on a second of footage each side</span>' : '') +
      '</div>' +
      (frames ? '<div class="direction-frames">' + frames + '</div>' : '') +
      '</section>'
    );
  }
  /** An extension names the shot it carries on from; that shot is one click away. */
  function extensionCard(c) {
    const doc = getState(),
      parent = D.attachedParent(doc, c),
      away = D.detachedParent(doc, c);
    return (
      '<section class="direction-card extension-card"><div class="direction-head">' +
      svg(D.KINDS.extend.icon) +
      '<strong>Extension</strong></div>' +
      (parent
        ? '<div class="extension-from">' +
          frameThumb(parent, 'last', 'Last frame') +
          '<p class="direction-note">Carries on from the last second of <button type="button" class="extension-parent" data-parent-clip="' +
          esc(parent.id) +
          '">' +
          esc(parent.name) +
          '</button>. Moving that shot takes this extension with it.</p></div>'
        : '<p class="direction-note warn">' +
          (away
            ? esc(away.name) + ' is no longer right before this extension. Put it back to continue from it.'
            : 'The shot this extension continues from was removed.') +
          '</p>') +
      '</section>'
    );
  }
  // ---- prompt tools: @ autocomplete, mention chips and checks ----------------------------------
  let mentionMenu = null;
  function closeMentions() {
    mentionMenu?.remove();
    mentionMenu = null;
  }
  function promptReport(c, text) {
    const recipe = getRecipe(c),
      bindings = c.bindings || [],
      b = D.toolBindings(bindings),
      original = b.prompt && recipe?.prompt?.[b.prompt.nodeId]?.inputs?.[b.prompt.input],
      style = tagStyle(original),
      values = { ...(c.inputValues || {}), ...(b.prompt ? { [b.prompt.key]: text } : {}) },
      settings = c.shotInputs || [],
      resolved = resolveMentions(castList(), bindings, values, settings, style),
      filledCount = slot =>
        bindings.filter(x => x.asset && x.slot === slot && inputFilled(x, resolved.values, settings)).length,
      name = recipe?.provenance?.workflowName || recipe?.provenance?.builtinTemplate || '',
      seconds = Number(b.duration && c.inputValues?.[b.duration.key]) || (c.out - c.in) / getFps();
    return {
      report: resolved.report,
      style,
      findings: lintPrompt(text, {
        cast: castList(),
        pictures: filledCount('reference'),
        videos: filledCount('video'),
        audios:
          filledCount('audio') +
          bindings.filter(x => x.slot === 'video' && x.audio && inputFilled(x, resolved.values, settings)).length,
        seconds: Math.round(seconds),
        audio: /minimax|ltx/i.test(name),
        references: bindings.some(x => x.asset && x.slot === 'reference'),
        negative: bindings.some(x => x.role === 'negative'),
      }),
    };
  }
  function promptTools(c, text) {
    const { report, findings, style } = promptReport(c, text),
      members = castList();
    return (
      (report.length
        ? '<div class="prompt-mentions">' +
          report
            .map(r => {
              const m = members.find(m => m.id === r.id);
              return (
                '<span class="mention-chip">' +
                (m?.images[0] ? '<img src="' + esc(castImage(m.images[0])) + '" alt="">' : '') +
                '@' +
                esc(r.name) +
                '<small>' +
                esc(r.pictures.length ? r.pictures.map(n => tag(style, 'Image', n)).join(' ') : 'description') +
                '</small></span>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      (findings.length
        ? '<ul class="prompt-findings">' +
          findings
            .map(
              f =>
                '<li class="' +
                f.level +
                '">' +
                svg(f.level === 'warn' ? 'warning' : 'spark') +
                '<span>' +
                esc(f.message) +
                '</span></li>',
            )
            .join('') +
          '</ul>'
        : '')
    );
  }
  function bindPromptTools(c) {
    closeMentions();
    const b = D.toolBindings(c.bindings || []).prompt;
    if (!b) return;
    const index = (c.bindings || []).indexOf(b),
      field = $('inspectorContent').querySelector('textarea[data-native-control="' + index + '"]');
    if (!field) return;
    $('inspectorContent')
      .querySelectorAll('.prompt-tools')
      .forEach(node => node.remove());
    const holder = document.createElement('div');
    holder.className = 'prompt-tools';
    field.closest('.field')?.after(holder);
    let timer = 0;
    const refresh = () => (holder.innerHTML = promptTools(c, field.value));
    refresh();
    field.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 180);
      suggest();
    });
    field.addEventListener('blur', () => setTimeout(closeMentions, 150));
    field.addEventListener('keydown', e => {
      if (!mentionMenu) return;
      const items = [...mentionMenu.querySelectorAll('button')],
        at = items.findIndex(i => i.classList.contains('active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        items[at]?.classList.remove('active');
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].classList.add('active');
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        items[Math.max(0, at)]?.click();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closeMentions();
      }
    });
    function suggest() {
      const before = field.value.slice(0, field.selectionStart),
        match = before.match(/(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]*)$/u),
        choices = match ? castList().filter(m => m.name.toLowerCase().startsWith(match[1].toLowerCase())) : [];
      if (!choices.length) {
        closeMentions();
        return;
      }
      if (!mentionMenu) {
        mentionMenu = document.createElement('div');
        mentionMenu.className = 'mention-menu';
        mentionMenu.setAttribute('role', 'listbox');
        $('editor').append(mentionMenu);
      }
      mentionMenu.innerHTML = choices
        .map(
          (m, i) =>
            '<button type="button" role="option" class="' +
            (i ? '' : 'active') +
            '" data-mention="' +
            esc(m.name) +
            '"><img src="' +
            esc(castImage(m.images[0])) +
            '" alt=""><span>@' +
            esc(m.name) +
            (m.description ? '<small>' + esc(m.description) + '</small>' : '') +
            '</span></button>',
        )
        .join('');
      const rect = field.getBoundingClientRect(),
        host = $('editor').getBoundingClientRect();
      mentionMenu.style.left = rect.left - host.left + 'px';
      mentionMenu.style.top = rect.bottom - host.top + 4 + 'px';
      mentionMenu.style.width = Math.min(rect.width, 280) + 'px';
      mentionMenu.querySelectorAll('[data-mention]').forEach(button => {
        // Keep the caret in the prompt; Enter, Tab and a click all insert.
        button.onmousedown = e => e.preventDefault();
        button.onclick = () => {
          const start = field.selectionStart - match[1].length,
            insert = button.dataset.mention + ' ';
          field.setRangeText(insert, start, field.selectionStart, 'end');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          closeMentions();
          field.focus();
        };
      });
    }
  }

  function bindDirectionCard() {
    $('inspectorContent')
      .querySelectorAll('[data-parent-clip]')
      .forEach(b => (b.onclick = () => selectClip(b.dataset.parentClip, true)));
    const card = $('inspectorContent').querySelector('.direction-card');
    if (card) bindThumbs(card);
  }

  // ---- entry points ---------------------------------------------------------------------------
  function touching(c, side) {
    const other = D.neighbor(getState(), c, side);
    if (!other) return null;
    const a = side === 'previous' ? other : c,
      b = side === 'previous' ? c : other;
    if (b.gapBefore || a.direction?.kind === 'transition' || b.direction?.kind === 'transition') return null;
    // A shot and its extension are one take; nothing goes between them.
    if (D.attachedParent(getState(), b) === a) return null;
    return [a.id, b.id];
  }
  function clipActions(c) {
    const t = take(c),
      before = touching(c, 'previous'),
      after = touching(c, 'next');
    return [
      ...(before ? [{ label: 'Add transition before…', run: () => transitionDialog(...before) }] : []),
      ...(after ? [{ label: 'Add transition after…', run: () => transitionDialog(...after) }] : []),
      {
        label: 'Extend…',
        reason: t.placeholder ? 'Needs a take first.' : null,
        run: () => extendDialog(c.id),
      },
    ];
  }
  /** T: the cut nearest the playhead on the active track. */
  function transitionAtPlayhead(track) {
    const frame = Math.round(getState().frame),
      near = D.cuts(getState())
        .filter(cut => cut.track === track)
        .map(cut => ({ cut, distance: Math.abs(rowFor(cut.left).end - frame) }))
        .sort((a, b) => a.distance - b.distance)[0];
    if (!near) {
      toast('Place two shots side by side to add a transition between them.');
      return;
    }
    transitionDialog(near.cut.left, near.cut.right);
  }

  return {
    transitionDialog,
    addTransition,
    extendDialog,
    extendClip,
    addCastMember,
    renderCast,
    directionCard,
    bindDirectionCard,
    bindPromptTools,
    promptReport,
    clipActions,
    transitionAtPlayhead,
  };
}
