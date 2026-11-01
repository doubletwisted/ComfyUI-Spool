import * as T from './timeline.js';
import * as D from './direction.js';
import { resolveMentions, tag, tagStyle } from './cast.js';
import { inputFilled } from './input-groups.js';
import { lintPrompt } from './prompt-lint.js';

// Directing tools: transitions at cuts, extensions, retakes, reworks and the cast.
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
}) {
  const remembered = { transition: 'smoke', reangle: 'low', effect: 'rain' };
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
  /** Style tiles; with `frames` each tile plays its effect between the two real frames. */
  function presetGrid(presets, current, frames = null) {
    const still = (clip, frame, cls) =>
      clip
        ? '<img class="' + cls + '" data-direct-thumb="' + esc(clip.id) + '" data-frame="' + frame + '" alt="">'
        : '';
    return (
      '<div class="preset-grid' +
      (frames ? ' with-preview' : '') +
      '" role="radiogroup" aria-label="Style">' +
      presets
        .map(
          p =>
            '<button type="button" role="radio" class="preset-tile" data-preset="' +
            esc(p.id) +
            '" aria-checked="' +
            (p.id === current) +
            '" style="--a:' +
            p.colors[0] +
            ';--b:' +
            p.colors[1] +
            '"><span class="preset-swatch fx-' +
            esc(p.id) +
            '" aria-hidden="true">' +
            (frames
              ? still(frames.left, frames.leftFrame, 'fx-a') +
                still(frames.right, frames.rightFrame, 'fx-b') +
                '<i></i>'
              : '') +
            '</span><span class="preset-name">' +
            esc(p.name) +
            '</span></button>',
        )
        .join('') +
      '</div>'
    );
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
      root
        .querySelectorAll('[data-preset]')
        .forEach(b => b.setAttribute('aria-checked', b.dataset.preset === state.preset));
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
    root.querySelectorAll('[data-preset]').forEach(
      b =>
        (b.onclick = () => {
          state.preset = b.dataset.preset;
          const preset = state.presets?.find(p => p.id === state.preset);
          if (preset?.seconds && !state.lengthTouched) state.seconds = preset.seconds;
          refresh();
        }),
    );
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
          state.lengthTouched = true;
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
    (root.querySelector('[aria-checked="true"][data-preset]') || detail || $('directGenerate'))?.focus();
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
    if (b.duration && seconds) c.inputValues[b.duration.key] = D.durationValue(c.inputValues[b.duration.key], seconds);
    c.shotInputs = links.filter(link => link.key);
    images.forEach((file, i) => {
      if (b.references[i]) c.inputValues[b.references[i].key] = file;
    });
    if (frames) {
      // A generated take repeats the anchored frames; the slot skips them, so the
      // clip joins its neighbours without a held frame.
      const t = c.takes.find(t => t.id === c.takeId);
      if (t?.placeholder) {
        t.media.frames = frames + trimHead + trimTail;
        c.in = trimHead;
        c.out = trimHead + frames;
      }
    }
    c.seedMode = 'randomize';
    c.revision++;
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
    if (generate) await queueClips(clips);
  }

  // ---- transitions -------------------------------------------------------------------
  function transitionDialog(leftId, rightId, existing = null) {
    const doc = getState(),
      left = doc.clips.find(c => c.id === leftId),
      right = doc.clips.find(c => c.id === rightId);
    if (!left || !right) return;
    const list = choices('transition');
    if (!list.length) {
      toast('No first and last frame workflow is available.');
      return;
    }
    const preset = D.TRANSITIONS.find(p => p.id === remembered.transition) || D.TRANSITIONS[0];
    const state = {
      presets: D.TRANSITIONS,
      preset: preset.id,
      detail: '',
      seconds: preset.seconds || 2,
      workflow: list[0].id,
    };
    openDialog(
      'Add transition',
      '<div class="direct-hero">' +
        frameThumb(left, 'last', 'Leaves from') +
        '<span class="direct-bridge" aria-hidden="true">' +
        svg('transition') +
        '</span>' +
        frameThumb(right, 'first', 'Lands on') +
        '</div><p class="direct-lede">A video model renders the move between the last frame of one shot and the first frame of the next. Each take is a clip of its own; the shots around it stay as they are.</p><h3 class="direct-heading">Style</h3>' +
        presetGrid(D.TRANSITIONS, state.preset, {
          left: take(left).placeholder ? null : left,
          leftFrame: Math.max(left.in, left.out - 1),
          right: take(right).placeholder ? null : right,
          rightFrame: right.in,
        }) +
        '<label class="direct-field"><span>Direction <em>optional</em></span><input id="directDetail" type="text" placeholder="e.g. the smoke is red; keep the camera low"></label><div class="direct-row">' +
        lengthField(state.seconds, list[0]) +
        workflowPicker('transition', state.workflow) +
        '</div>',
      'Add transition',
      state,
      (s, generate) => addTransition(leftId, rightId, s, generate),
      { kind: 'transition' },
    );
  }
  async function addTransition(leftId, rightId, options, generate = false) {
    const doc = getState(),
      left = doc.clips.find(c => c.id === leftId),
      right = doc.clips.find(c => c.id === rightId);
    if (!left || !right) throw Error('Both shots must still be on the timeline.');
    const preset = D.TRANSITIONS.find(p => p.id === options.preset) || D.TRANSITIONS[0],
      choice = choices('transition').find(c => c.id === options.workflow) || choices('transition')[0],
      seconds = D.fitSeconds(choice, options.seconds),
      row = rowFor(left.id);
    remembered.transition = preset.id;
    const clip = await place(
      'transition',
      choice.id,
      { index: doc.clips.indexOf(right), placement: { track: T.videoTrack(left), start: row.end } },
      c => {
        const b = D.toolBindings(c.bindings);
        c.name = preset.name + ' transition';
        c.direction = { kind: 'transition', preset: preset.id, detail: options.detail || '' };
        fill(c, {
          prompt: D.transitionPrompt(preset, options.detail),
          seconds,
          links: [
            { key: b.first?.key, source: 'previous' },
            { key: b.last?.key, source: 'next' },
          ],
          frames: Math.round(seconds * getFps()),
          trimHead: 1,
          trimTail: 1,
          shape: left,
        });
      },
    );
    await finish([clip], generate, preset.name + ' transition added');
  }

  // ---- extend ------------------------------------------------------------------------
  function sourcePrompt(c) {
    const b = D.toolBindings(c.bindings || []);
    return b.prompt ? String(c.inputValues?.[b.prompt.key] || '') : '';
  }
  function extendDialog(clipId) {
    const c = getState().clips.find(c => c.id === clipId);
    if (!c) return;
    if (take(c).placeholder) {
      toast('Generate or choose a take for this shot first.');
      return;
    }
    const list = choices('extend');
    if (!list.length) {
      toast('No image to video workflow is available.');
      return;
    }
    const state = { detail: '', seconds: 5, workflow: list[0].id };
    openDialog(
      'Extend shot',
      '<div class="direct-hero single">' +
        frameThumb(c, 'last', 'Continues from') +
        '<span class="direct-bridge" aria-hidden="true">' +
        svg('extend') +
        '</span><figure class="direct-frame next"><span>' +
        svg('spark') +
        '</span><figcaption>New shot<small>Added after ' +
        esc(c.name) +
        '</small></figcaption></figure></div><p class="direct-lede">The new clip starts on this shot’s last frame, as it is trimmed in the edit, so the cut is seamless.</p><label class="direct-field"><span>What happens next</span><textarea id="directDetail" rows="3" placeholder="e.g. she turns to the window and the camera pushes in slowly"></textarea></label><div class="direct-row">' +
        lengthField(state.seconds, list[0]) +
        workflowPicker('extend', state.workflow) +
        '</div>',
      'Extend shot',
      state,
      (s, generate) => extendClip(clipId, s, generate),
      { kind: 'extend' },
    );
  }
  async function extendClip(clipId, options, generate = false) {
    const doc = getState(),
      source = doc.clips.find(c => c.id === clipId);
    if (!source) throw Error('This shot was removed.');
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
        const b = D.toolBindings(c.bindings);
        c.name = source.name + ' · continued';
        c.direction = { kind: 'extend', detail: options.detail || '' };
        fill(c, {
          prompt: D.extendPrompt(sourcePrompt(source), options.detail),
          seconds,
          links: [{ key: b.first?.key, source: 'previous' }],
          frames: Math.round(seconds * getFps()),
          trimHead: 1,
          shape: source,
        });
      },
    );
    await finish([clip], generate, 'Extension added after ' + source.name);
  }

  // ---- retake part of a shot ------------------------------------------------------------
  function retakeDialog(clipId) {
    const c = getState().clips.find(c => c.id === clipId);
    if (!c) return;
    const t = take(c);
    if (t.placeholder) {
      toast('Generate or choose a take for this shot first.');
      return;
    }
    const list = choices('retake'),
      fps = getFps(),
      length = c.out - c.in,
      row = rowFor(c.id);
    if (length < fps * 2) {
      toast('Retake needs a shot of at least 2 seconds.');
      return;
    }
    const playhead = Math.round(getState().frame) - row.start,
      seconds = Math.max(1, Math.min(3, Math.floor(length / fps) - 1)),
      span = seconds * fps,
      start = Math.max(
        6,
        Math.min(length - span - 6, (playhead > 0 && playhead < length ? playhead : length / 2) - span / 2),
      );
    const state = { detail: '', seconds, workflow: list[0]?.id, start: Math.round(start) };
    const strip = Array.from({ length: 8 }, (_, i) => {
      const frame = Math.round(c.in + ((i + 0.5) / 8) * length);
      return '<img data-direct-thumb="' + esc(c.id) + '" data-frame="' + Math.min(c.out - 1, frame) + '" alt="">';
    }).join('');
    openDialog(
      'Retake part of ' + c.name,
      '<div class="retake-strip" id="retakeStrip"><div class="retake-film">' +
        strip +
        '</div><div class="retake-range" id="retakeRange" role="slider" tabindex="0" aria-label="Part to retake"><span class="retake-label" id="retakeLabel"></span></div></div><p class="direct-lede">Drag the highlighted part. Spool splits the shot there and renders a new middle that starts and ends on the frames around it. The original stays as a take you can switch back to.</p><label class="direct-field"><span>What should change</span><textarea id="directDetail" rows="2" placeholder="e.g. he smiles instead of frowning"></textarea></label><div class="direct-row">' +
        lengthField(state.seconds, list[0], 'Part length') +
        workflowPicker('retake', state.workflow) +
        '</div>',
      'Retake part',
      state,
      (s, generate) => retakeRange(clipId, s.start, s.start + s.seconds * fps, s, generate),
      {
        kind: 'retake',
        onChange: s => {
          const span = s.seconds * fps;
          s.start = Math.max(6, Math.min(length - span - 6, s.start));
          const range = $('retakeRange');
          if (!range) return;
          range.style.left = (s.start / length) * 100 + '%';
          range.style.width = (span / length) * 100 + '%';
          $('retakeLabel').textContent = (s.start / fps).toFixed(1) + '–' + ((s.start + span) / fps).toFixed(1) + ' s';
          s.problem = () => (span > length - 12 ? 'Choose a shorter part; keep a few frames on both sides.' : null);
        },
      },
    );
    const range = $('retakeRange'),
      track = $('retakeStrip');
    range.onpointerdown = e => {
      e.preventDefault();
      range.setPointerCapture(e.pointerId);
      const origin = e.clientX,
        first = state.start,
        width = track.getBoundingClientRect().width;
      range.onpointermove = move => {
        state.start = Math.round(first + ((move.clientX - origin) / width) * length);
        const span = state.seconds * fps;
        state.start = Math.max(6, Math.min(length - span - 6, state.start));
        range.style.left = (state.start / length) * 100 + '%';
        $('retakeLabel').textContent =
          (state.start / fps).toFixed(1) + '–' + ((state.start + span) / fps).toFixed(1) + ' s';
      };
      range.onpointerup = () => (range.onpointermove = null);
    };
    range.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const span = state.seconds * fps;
      state.start = Math.max(
        6,
        Math.min(length - span - 6, state.start + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? fps : 4)),
      );
      range.style.left = (state.start / length) * 100 + '%';
      $('retakeLabel').textContent =
        (state.start / fps).toFixed(1) + '–' + ((state.start + span) / fps).toFixed(1) + ' s';
    };
  }
  async function retakeRange(clipId, start, end, options, generate = false) {
    const doc = getState(),
      c = doc.clips.find(c => c.id === clipId);
    if (!c) throw Error('This shot was removed.');
    const choice = choices('retake').find(x => x.id === options.workflow) || choices('retake')[0],
      prompt = sourcePrompt(c),
      row = rowFor(c.id);
    let middleId = null;
    edits.apply('Split ' + c.name + ' for a retake', () => {
      pause();
      editView();
      const first = T.splitClip(getState(), row.start + end, 'clip-' + crypto.randomUUID(), c.id);
      if (first.error) throw Error(first.error);
      const second = T.splitClip(getState(), row.start + start, 'clip-' + crypto.randomUUID(), c.id);
      if (second.error) throw Error(second.error);
      const middle = getState().clips[getState().clips.indexOf(c) + 1];
      middle.name = c.name + ' · retake';
      middleId = middle.id;
    });
    if (!middleId) return;
    const seconds = D.fitSeconds(choice, (end - start) / getFps());
    const clip = await place('retake', choice.id, { clipId: middleId }, m => {
      const b = D.toolBindings(m.bindings);
      m.direction = { kind: 'retake', detail: options.detail || '' };
      fill(m, {
        prompt: D.retakePrompt(prompt, options.detail),
        seconds,
        links: [
          { key: b.first?.key, source: 'previous' },
          { key: b.last?.key, source: 'next' },
        ],
        shape: m,
      });
    });
    await finish([clip], generate, 'Retake ready on ' + c.name);
  }

  // ---- rework: recast, re-angle, effect ----------------------------------------------------
  function castList() {
    return getState().cast || [];
  }
  function castImage(file) {
    return '/spool/api/input/' + encodeURIComponent(file);
  }
  function reworkDialog(ids, kind = 'recast') {
    const clips = ids.map(id => getState().clips.find(c => c.id === id)).filter(c => c && !take(c).placeholder);
    if (!clips.length) {
      toast('Choose shots with footage or a generated take.');
      return;
    }
    if (clips.some(c => take(c).media.kind !== 'video')) {
      toast('Rework needs video shots.');
      return;
    }
    const list = choices('rework');
    if (!list.length) {
      toast('No reference to video workflow is available.');
      return;
    }
    const state = {
      kind,
      preset: remembered[kind] || null,
      detail: '',
      workflow: list[0].id,
      castId: castList()[0]?.id || null,
      problem: () => (state.kind === 'recast' && !state.castId ? 'Add a cast member to recast with.' : null),
    };
    const tabs = Object.entries(D.REWORKS)
      .map(
        ([id, r]) =>
          '<button type="button" role="tab" data-rework-kind="' +
          id +
          '" aria-selected="' +
          (id === kind) +
          '" class="' +
          (id === kind ? 'active' : '') +
          '">' +
          svg(D.KINDS[id].icon) +
          esc(r.name) +
          '</button>',
      )
      .join('');
    const strip = clips
      .slice(0, 6)
      .map((c, i) => frameThumb(c, 'first', 'Shot ' + (i + 1)))
      .join('');
    const body =
      '<div class="seg rework-tabs" role="tablist">' +
      tabs +
      '</div><div class="rework-shots">' +
      strip +
      (clips.length > 6 ? '<span class="rework-more">+' + (clips.length - 6) + '</span>' : '') +
      '</div><div id="reworkBody"></div><label class="direct-field"><span>Direction <em>optional</em></span><input id="directDetail" type="text" placeholder="e.g. keep her red scarf"></label><div class="direct-row">' +
      workflowPicker('rework', state.workflow) +
      '</div>';
    const title = n => D.REWORKS[state.kind].verb + ' ' + (n === 1 ? clips[0].name : n + ' shots');
    openDialog(
      title(clips.length),
      body,
      D.REWORKS[kind].name,
      state,
      (s, generate) =>
        rework(
          clips.map(c => c.id),
          s,
          generate,
        ),
      { kind: 'rework' },
    );
    const renderBody = () => {
      $('modalTitle').textContent = title(clips.length);
      $('modal')
        .querySelectorAll('[data-rework-kind]')
        .forEach(b => {
          const on = b.dataset.reworkKind === state.kind;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on);
        });
      const presets = D.REWORKS[state.kind].presets;
      if (state.kind === 'recast') {
        $('reworkBody').innerHTML =
          '<h3 class="direct-heading">Character</h3><div class="cast-pick" role="radiogroup">' +
          castList()
            .map(
              m =>
                '<button type="button" role="radio" class="cast-pick-card" data-cast-pick="' +
                esc(m.id) +
                '" aria-checked="' +
                (m.id === state.castId) +
                '"><img src="' +
                esc(castImage(m.images[0])) +
                '" alt=""><span>' +
                esc(m.name) +
                '</span></button>',
            )
            .join('') +
          '<label class="cast-pick-card add" title="Add a cast member from a picture"><input type="file" accept="image/*" hidden id="reworkCastFile"><span>' +
          svg('plus') +
          '</span><span>New from picture</span></label></div><p class="direct-lede">The main person in each shot becomes this character. Camera, motion, set and sound stay.</p>';
        $('reworkBody')
          .querySelectorAll('[data-cast-pick]')
          .forEach(
            b =>
              (b.onclick = () => {
                state.castId = b.dataset.castPick;
                renderBody();
              }),
          );
        $('reworkCastFile').onchange = async e => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const member = await addCastMember(file.name.replace(/\.[^.]+$/, ''), [file]);
            state.castId = member.id;
            renderBody();
          } catch (error) {
            toast(error.message);
          }
        };
      } else {
        state.preset = presets.some(p => p.id === state.preset) ? state.preset : presets[0].id;
        $('reworkBody').innerHTML =
          '<h3 class="direct-heading">' +
          (state.kind === 'reangle' ? 'New camera' : 'Effect') +
          '</h3>' +
          presetGrid(presets, state.preset) +
          '<p class="direct-lede">' +
          (state.kind === 'reangle'
            ? 'The same moment, filmed again from another camera position. Performance and sound stay.'
            : 'The effect is added to the shot; people, camera and timing stay as they are.') +
          '</p>';
        $('reworkBody')
          .querySelectorAll('[data-preset]')
          .forEach(
            b =>
              (b.onclick = () => {
                state.preset = b.dataset.preset;
                remembered[state.kind] = state.preset;
                renderBody();
              }),
          );
      }
      bindThumbs($('reworkBody'));
      $('directAdd').textContent = D.REWORKS[state.kind].name;
      $('directGenerate').innerHTML = svg('play') + esc(D.REWORKS[state.kind].name) + ' and generate';
    };
    $('modal')
      .querySelectorAll('[data-rework-kind]')
      .forEach(
        b =>
          (b.onclick = () => {
            state.kind = b.dataset.reworkKind;
            state.preset = remembered[state.kind] || null;
            renderBody();
          }),
      );
    renderBody();
  }
  async function rework(ids, options, generate = false) {
    const kind = options.kind,
      choice = choices('rework').find(c => c.id === options.workflow) || choices('rework')[0],
      member = kind === 'recast' ? castList().find(m => m.id === options.castId) : null,
      preset = D.REWORKS[kind].presets.find(p => p.id === options.preset) || null;
    if (kind === 'recast' && !member) throw Error('Choose a cast member to recast with.');
    const done = [];
    for (const id of ids) {
      const source = getState().clips.find(c => c.id === id);
      if (!source) continue;
      const original = (source.takes || []).some(t => !t.generated && !t.placeholder) ? 'original' : 'selected',
        seconds = D.fitSeconds(choice, (source.out - source.in) / getFps());
      done.push(
        await place(kind, choice.id, { clipId: id }, c => {
          const b = D.toolBindings(c.bindings);
          c.direction = { kind, preset: preset?.id, detail: options.detail || '', castId: member?.id };
          fill(c, {
            prompt: D.reworkPrompt(kind, preset, options.detail, { character: member?.description || '' }),
            seconds,
            links: [{ key: b.video?.key, source: original, ...(b.video?.audio ? { audio: true } : {}) }],
            images: member ? member.images.slice(0, Math.max(1, b.references.length)) : [],
            shape: source,
          });
        }),
      );
    }
    await finish(done, generate, D.REWORKS[kind].name + ': ' + done.length + (done.length === 1 ? ' shot' : ' shots'));
  }

  // ---- cast ------------------------------------------------------------------------------
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
    const presets = d.kind === 'transition' ? D.TRANSITIONS : D.REWORKS[d.kind]?.presets || [];
    const member = d.castId && castList().find(m => m.id === d.castId);
    return (
      '<section class="direction-card kind-' +
      esc(d.kind) +
      '"><div class="direction-head">' +
      svg(D.KINDS[d.kind].icon) +
      '<strong>' +
      esc(D.KINDS[d.kind].name) +
      '</strong><span>' +
      esc(D.directionLabel(d) !== D.KINDS[d.kind].name ? D.directionLabel(d) : '') +
      '</span></div>' +
      (frames ? '<div class="direction-frames">' + frames + '</div>' : '') +
      (member
        ? '<div class="direction-cast"><img src="' +
          esc(castImage(member.images[0])) +
          '" alt=""><span>@' +
          esc(member.name) +
          '</span></div>'
        : '') +
      (presets.length
        ? '<div class="direction-presets" role="radiogroup" aria-label="Style">' +
          presets
            .map(
              p =>
                '<button type="button" role="radio" data-direction-preset="' +
                esc(p.id) +
                '" aria-checked="' +
                (p.id === d.preset) +
                '" style="--a:' +
                p.colors[0] +
                ';--b:' +
                p.colors[1] +
                '">' +
                esc(p.name) +
                '</button>',
            )
            .join('') +
          '</div>'
        : '') +
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
      mentionMenu.querySelectorAll('[data-mention]').forEach(
        button =>
          (button.onmousedown = e => {
            e.preventDefault();
            const start = field.selectionStart - match[1].length,
              insert = button.dataset.mention + ' ';
            field.setRangeText(insert, start, field.selectionStart, 'end');
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
            closeMentions();
            field.focus();
          }),
      );
    }
  }

  function bindDirectionCard(c) {
    const card = $('inspectorContent').querySelector('.direction-card');
    if (!card) return;
    bindThumbs(card);
    card.querySelectorAll('[data-direction-preset]').forEach(
      b =>
        (b.onclick = () => {
          const d = c.direction,
            presets = d.kind === 'transition' ? D.TRANSITIONS : D.REWORKS[d.kind].presets,
            preset = presets.find(p => p.id === b.dataset.directionPreset),
            member = d.castId && castList().find(m => m.id === d.castId),
            bindings = D.toolBindings(c.bindings);
          if (!preset || preset.id === d.preset) return;
          edits.apply(
            'Change ' + D.KINDS[d.kind].name.toLowerCase(),
            () => {
              d.preset = preset.id;
              if (d.kind === 'transition') c.name = preset.name + ' transition';
              if (bindings.prompt)
                c.inputValues[bindings.prompt.key] =
                  d.kind === 'transition'
                    ? D.transitionPrompt(preset, d.detail)
                    : D.reworkPrompt(d.kind, preset, d.detail, { character: member?.description || '' });
              c.revision++;
            },
            'inspector',
          );
        }),
    );
  }

  // ---- entry points ---------------------------------------------------------------------------
  function touching(c, side) {
    const other = D.neighbor(getState(), c, side);
    if (!other) return null;
    const a = side === 'previous' ? other : c,
      b = side === 'previous' ? c : other;
    if (b.gapBefore || a.direction?.kind === 'transition' || b.direction?.kind === 'transition') return null;
    return [a.id, b.id];
  }
  function clipActions(c) {
    const t = take(c),
      video = !t.placeholder && t.media.kind === 'video',
      before = touching(c, 'previous'),
      after = touching(c, 'next');
    return [
      ...(before ? [{ label: 'Add transition before…', run: () => transitionDialog(...before) }] : []),
      ...(after ? [{ label: 'Add transition after…', run: () => transitionDialog(...after) }] : []),
      {
        label: 'Extend shot…',
        reason: t.placeholder ? 'Needs a take first.' : null,
        run: () => extendDialog(c.id),
      },
      {
        label: 'Retake part…',
        reason: t.placeholder ? 'Needs a take first.' : c.out - c.in < getFps() * 2 ? 'Needs 2 seconds or more.' : null,
        run: () => retakeDialog(c.id),
      },
      ...(video
        ? [
            { label: 'Recast…', run: () => reworkDialog([c.id], 'recast') },
            { label: 'Re-angle…', run: () => reworkDialog([c.id], 'reangle') },
            { label: 'Add effect…', run: () => reworkDialog([c.id], 'effect') },
          ]
        : []),
    ];
  }
  function selectionActions(clips) {
    const videos = clips.filter(c => !take(c).placeholder && take(c).media.kind === 'video');
    if (!videos.length) return [];
    const ids = videos.map(c => c.id),
      n = ids.length + ' shots';
    return [
      { label: 'Recast ' + n + '…', run: () => reworkDialog(ids, 'recast') },
      { label: 'Re-angle ' + n + '…', run: () => reworkDialog(ids, 'reangle') },
      { label: 'Add effect to ' + n + '…', run: () => reworkDialog(ids, 'effect') },
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
    retakeDialog,
    retakeRange,
    reworkDialog,
    rework,
    addCastMember,
    renderCast,
    directionCard,
    bindDirectionCard,
    bindPromptTools,
    promptReport,
    clipActions,
    selectionActions,
    transitionAtPlayhead,
  };
}
