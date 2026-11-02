// Directing tools: transitions and extensions.
// Pure data and rules; ui/directing.js owns the dialogs and edits.

/**
 * Optional wording a dialog offers next to its prompt field. Choosing one adds its
 * phrase to the field, where it can be edited like anything else the user writes.
 * @typedef {{ id: string, name: string, prompt: string }} Suggestion
 */

/** @type {Suggestion[]} */
export const TRANSITIONS = [
  {
    id: 'camera',
    name: 'Camera move',
    prompt: 'The camera travels on in one move from the first place to the second.',
  },
  {
    id: 'match',
    name: 'Match the motion',
    prompt: 'A movement in the first shot carries straight into the same movement in the second.',
  },
  {
    id: 'push',
    name: 'Push through',
    prompt: 'The camera pushes forward through the first scene and comes out in the second.',
  },
  {
    id: 'whip-pan',
    name: 'Whip pan',
    prompt: 'The camera whips sideways with motion blur and settles on the second scene.',
  },
  { id: 'morph', name: 'Morph', prompt: 'The first scene reshapes into the second without a cut.' },
];

export const KINDS = {
  transition: { name: 'Transition', icon: 'transition' },
  extend: { name: 'Extension', icon: 'extend' },
};

/**
 * Workflows each tool can use, best first. Only MiniMax H3: it reads a direction
 * through a language model and holds one take where the others cut or dissolve.
 * `min`/`max` are whole seconds; `options` lists the only lengths a workflow accepts.
 * `motion` workflows anchor the frames on each side of the gap as clips, so movement
 * carries through instead of starting again from one still frame.
 * @type {Record<string, { id: string, label: string, target: string, min?: number, max?: number, options?: number[], motion?: boolean }[]>}
 */
export const WORKFLOWS = {
  transition: [
    { id: 'video_minimax_h3_bridge', label: 'MiniMax H3 · Local', target: 'local', min: 1, max: 10, motion: true },
    { id: 'api_minimax_h3_flf2v', label: 'MiniMax H3 · Cloud', target: 'cloud', min: 4, max: 15 },
  ],
  extend: [
    { id: 'video_minimax_h3_bridge', label: 'MiniMax H3 · Local', target: 'local', min: 1, max: 12, motion: true },
    { id: 'video_minimax_h3_i2v', label: 'MiniMax H3 · From last frame', target: 'local', min: 2, max: 15 },
    { id: 'api_minimax_h3_max_i2v', label: 'MiniMax H3 Max · Cloud', target: 'cloud', min: 4, max: 15 },
  ],
};

/** The nearest length a workflow accepts, in whole seconds. */
export function fitSeconds(choice, seconds) {
  const wanted = Math.max(1, Math.round(Number(seconds) || 1));
  if (choice.options?.length)
    return choice.options.reduce((best, n) => (Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best));
  return Math.min(choice.max ?? wanted, Math.max(choice.min ?? 1, wanted));
}

/** A duration in the literal type the workflow saved (number or option string). */
export function durationValue(original, seconds) {
  if (typeof original === 'string') return String(seconds);
  return seconds;
}

/** MiniMax H3 renders 24 frames a second in lengths of 17k + 5 frames. */
const H3_FPS = 24;

/**
 * Lengths for a workflow that anchors `head` frames of the clip before and `tail`
 * frames of the clip after (both at 24 fps). The take repeats those frames, so the
 * clip shows only the new middle: `visible` frames, close to `seconds`.
 */
export function motionLength(seconds, head = 0, tail = 0) {
  const anchored = head + tail,
    wanted = Math.round(Math.max(0.5, Number(seconds) || 1) * H3_FPS) + anchored,
    lengths = k => 17 * k + 5;
  let k = Math.max(0, Math.round((wanted - 5) / 17));
  while (lengths(k) - anchored < 12) k++;
  const total = lengths(k);
  return { total, visible: total - anchored, seconds: total / H3_FPS };
}

/** Bindings a directing tool fills, found by slot and role. */
export function toolBindings(bindings = []) {
  const find = test => bindings.find(test);
  return {
    first: find(b => b.asset && b.slot === 'firstFrame') || find(b => b.asset && b.slot === 'image'),
    last: find(b => b.asset && b.slot === 'lastFrame'),
    // Motion inputs read a few frames at the end of the clip before and the start of the clip after.
    before: find(b => b.asset && b.slot === 'video' && b.span?.edge === 'end'),
    after: find(b => b.asset && b.slot === 'video' && b.span?.edge === 'start'),
    video: find(b => b.asset && b.slot === 'video' && !b.span),
    references: bindings.filter(b => b.asset && b.slot === 'reference'),
    prompt: find(b => b.role === 'positive'),
    duration: find(b => b.role === 'duration'),
    aspect: bindings.filter(b => b.role === 'resolution' && b.options?.some(o => ratioOf(o))),
  };
}

function ratioOf(option) {
  const m = String(option).match(/(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)/);
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
}

/** The option of an aspect or size list closest to a picture's shape; among equals, the current size. */
export function aspectValue(binding, current, width, height) {
  if (!width || !height || !binding?.options?.length) return current;
  const wanted = Math.log(width / height),
    area = option => {
      const m = String(option).match(/^(\d+)x(\d+)$/);
      return m ? Number(m[1]) * Number(m[2]) : 0;
    },
    score = option => {
      const r = ratioOf(option);
      return r ? [Math.abs(Math.log(r) - wanted), Math.abs(area(option) - area(current))] : [Infinity, 0];
    };
  return binding.options.reduce((best, option) => {
    const [a, b] = score(option),
      [c, d] = score(best);
    return a < c - 1e-6 || (Math.abs(a - c) <= 1e-6 && b < d) ? option : best;
  }, current);
}

/** The user's words as a sentence: capitalised and closed. */
const sentence = text => {
  const value = String(text || '').trim();
  if (!value) return '';
  const capital = value[0].toUpperCase() + value.slice(1);
  return /[.!?]$/.test(capital) ? capital : capital + '.';
};

const sound = 'The sound carries on throughout.';

const oneTake =
  'Single continuous take: no cuts, no scene changes, no dissolves. The same people, place and light throughout.';
const at = value => Math.round(value * 10) / 10 + 's';

/**
 * A transition is one take from the shot before to the shot after. With `motion`,
 * the take opens and closes on footage of both shots and `middle` says, in seconds,
 * where the new part lies; the timeline tells the model what happens when.
 * MiniMax H3 reads plain instructions such as "no cuts" through its language model.
 */
export function transitionPrompt(detail = '', { motion = false, seconds = 0, middle = null } = {}) {
  const action =
    sentence(detail) || 'The movement carries on and the camera travels naturally to where the next shot begins.';
  if (motion && middle && seconds)
    return [
      'One continuous shot, filmed in a single take with one camera.',
      'Timeline:\n' +
        [
          '[0s-' + at(middle[0]) + '] Opens on the footage of the shot before; its movement carries straight on.',
          '[' + at(middle[0]) + '-' + at(middle[1]) + '] ' + action,
          '[' + at(middle[1]) + '-' + at(seconds) + '] Arrives exactly in the opening footage of the next shot.',
        ].join('\n'),
      oneTake,
      'Audio: ' + sound.toLowerCase(),
    ].join('\n\n');
  return [
    'Use the provided start image as the first frame and the provided end image as the last frame.',
    action,
    'One smooth continuous motion over the whole clip, landing on the last frame only at the very end.',
    oneTake,
    sound,
  ].join(' ');
}

export function extendPrompt(sourcePrompt = '', detail = '', { motion = false } = {}) {
  const action = sentence(detail);
  return [
    motion
      ? 'Continue this shot from its opening frames in one unbroken take: the same people, place, lighting and camera style, and every movement carries on at the same speed.'
      : 'Use the provided start image as the first frame. Continue the same shot from this exact moment: the same people, place, lighting and camera style.',
    action || 'The action carries on naturally from where it was.',
    sound,
    sourcePrompt ? 'Earlier in this shot: ' + sentence(stripFramePhrases(sourcePrompt)) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function stripFramePhrases(text) {
  return String(text)
    .replace(
      /Use the provided (start|end) image as the (first|last|final) frame( anchor)?( and the provided end image as the (last|final) frame( anchor)?)?\.?/gi,
      '',
    )
    .replace(/Use Image \d as the (first|last) frame( and Image \d as the (first|last) frame)?\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

/** Short label for a directed clip on the timeline and in the inspector. */
export function directionLabel(direction) {
  return (direction?.kind && KINDS[direction.kind]?.name) || '';
}

/** The clip beside a clip on its video track, as spool/requests.py:neighbor reads it. */
export function neighbor(doc, clip, side) {
  const track = clip.videoTrack || 1,
    row = doc.clips.filter(c => (c.videoTrack || 1) === track),
    index = row.indexOf(clip) + (side === 'previous' ? -1 : 1);
  return row[index] || null;
}

/** Clip pairs that touch on a track: where a transition can go. */
export function cuts(doc) {
  const result = [],
    last = new Map();
  for (const c of doc.clips) {
    const track = c.videoTrack || 1,
      previous = last.get(track);
    if (previous && !c.gapBefore && previous.direction?.kind !== 'transition' && c.direction?.kind !== 'transition')
      result.push({ left: previous.id, right: c.id, track });
    last.set(track, c);
  }
  return result;
}
