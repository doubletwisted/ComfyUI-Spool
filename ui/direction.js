// Directing tools: transitions, extensions, retakes and reworks of a shot.
// Pure data and rules; ui/directing.js owns the dialogs and edits.
import { tag } from './cast.js';

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

/** @type {Suggestion[]} */
export const ANGLES = [
  { id: 'low', name: 'Low angle', prompt: 'a low angle close to the ground, looking up' },
  { id: 'high', name: 'High angle', prompt: 'a high angle, looking down from above' },
  { id: 'close', name: 'Close-up', prompt: 'a tight close-up on the main subject' },
  { id: 'wide', name: 'Wide', prompt: 'a wide shot that shows the whole scene' },
  { id: 'side', name: 'Side', prompt: 'the side, ninety degrees from the original camera' },
  { id: 'over-shoulder', name: 'Over the shoulder', prompt: 'over the shoulder of the main subject' },
];

/** @type {Suggestion[]} */
export const EFFECTS = [
  { id: 'rain', name: 'Rain', prompt: 'heavy rain falls through the scene and the surfaces are wet' },
  { id: 'snow', name: 'Snow', prompt: 'soft snow falls through the scene and settles on surfaces' },
  { id: 'fog', name: 'Fog', prompt: 'thin fog drifts through the scene' },
  { id: 'night', name: 'Night', prompt: 'it is night, lit by the practical lights in the scene' },
  { id: 'golden', name: 'Golden hour', prompt: 'low warm evening sunlight with long shadows' },
];

export const REWORKS = {
  recast: { name: 'Recast', verb: 'Recast', suggestions: [] },
  reangle: { name: 'Re-angle', verb: 'Re-angle', suggestions: ANGLES },
  effect: { name: 'Effect', verb: 'Change', suggestions: EFFECTS },
};

export const KINDS = {
  transition: { name: 'Transition', icon: 'transition' },
  extend: { name: 'Extension', icon: 'extend' },
  retake: { name: 'Retake', icon: 'retake' },
  recast: { name: 'Recast', icon: 'recast' },
  reangle: { name: 'Re-angle', icon: 'reangle' },
  effect: { name: 'Effect', icon: 'effect' },
};

/**
 * Workflows each tool can use, best first. `min`/`max` are whole seconds; `options`
 * lists the only lengths a workflow accepts. `motion` workflows anchor the frames on
 * each side of the gap as clips, so movement carries through instead of starting
 * again from one still frame.
 * @type {Record<string, { id: string, label: string, target: string, min?: number, max?: number, options?: number[], motion?: boolean }[]>}
 */
export const WORKFLOWS = {
  transition: [
    { id: 'video_minimax_h3_bridge', label: 'MiniMax H3 · Local', target: 'local', min: 1, max: 10, motion: true },
    { id: 'video_ltx2_5_flf2v', label: 'LTX 2.5 · Local', target: 'local', min: 1, max: 10 },
    { id: 'api_minimax_h3_flf2v', label: 'MiniMax H3 · Cloud', target: 'cloud', min: 4, max: 15 },
    { id: 'api_ltx2_5_flf2v', label: 'LTX 2.5 · Cloud', target: 'cloud', options: [2, 3, 4, 5, 6, 8, 10] },
  ],
  extend: [
    { id: 'video_minimax_h3_bridge', label: 'MiniMax H3 · Local', target: 'local', min: 1, max: 12, motion: true },
    { id: 'video_minimax_h3_i2v', label: 'MiniMax H3 · From last frame', target: 'local', min: 2, max: 15 },
    { id: 'video_ltx2_5_i2v', label: 'LTX 2.5 · Local', target: 'local', min: 1, max: 10 },
    { id: 'api_minimax_h3_max_i2v', label: 'MiniMax H3 Max · Cloud', target: 'cloud', min: 4, max: 15 },
    { id: 'api_ltx2_5_i2v', label: 'LTX 2.5 · Cloud', target: 'cloud', options: [2, 3, 4, 5, 6, 8, 10] },
  ],
  rework: [
    { id: 'video_minimax_h3_r2v', label: 'MiniMax H3 · Local', target: 'local', min: 2, max: 15 },
    { id: 'api_minimax_h3_r2v', label: 'MiniMax H3 · Cloud', target: 'cloud', min: 4, max: 15 },
  ],
  // Recast transfers the shot's motion through pose control, which only runs locally.
  recast: [
    {
      id: 'video_minimax_h3_fun_controlnet_union',
      label: 'MiniMax H3 ControlNet · Local',
      target: 'local',
      min: 2,
      max: 15,
    },
  ],
};

/** The workflow list a kind of directed clip chooses from. */
export const toolFor = kind => (kind === 'recast' ? 'recast' : ['reangle', 'effect'].includes(kind) ? 'rework' : kind);
WORKFLOWS.retake = WORKFLOWS.transition;

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

/** With `motion`, the clips on both sides are anchored as moving footage; otherwise as single frames. */
export function transitionPrompt(detail = '', { motion = false } = {}) {
  return [
    motion
      ? 'One continuous shot. It opens with the movement of the first scene, carries that movement on in one unbroken take and arrives naturally in the closing frames of the second scene.'
      : 'Use the provided start image as the first frame and the provided end image as the last frame.',
    sentence(detail),
    motion
      ? sound
      : 'One smooth continuous motion over the whole clip, landing on the last frame only at the very end. ' + sound,
  ]
    .filter(Boolean)
    .join(' ');
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

export function retakePrompt(sourcePrompt = '', detail = '', { motion = false } = {}) {
  return [
    motion
      ? 'Keep the same people, place, lighting and camera. The movement of the opening frames carries on and arrives at the closing frames in one unbroken take.'
      : 'Use the provided start image as the first frame and the provided end image as the last frame. Keep the same people, place, lighting and camera; join both frames in one continuous motion.',
    sentence(detail),
    sound,
    sourcePrompt ? 'Context: ' + sentence(stripFramePhrases(sourcePrompt)) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * MiniMax H3 numbers references by type: <Picture i> for images and <Video k> for
 * videos, with a video's soundtrack labelled <Audio j>.
 */
export function reworkPrompt(
  kind,
  change = '',
  detail = '',
  { character = '', pictures = 1, style = 'angle', audio = true, place = '' } = {},
) {
  const video = tag(style, 'Video', 1),
    keep = audio ? 'Keep ' + tag(style, 'Audio', 1) + ' exactly as it is.' : '';
  if (kind === 'recast') {
    const shown = Array.from({ length: Math.max(1, pictures) }, (_, i) => tag(style, 'Image', i + 1)).join(' and ');
    // A frame of the shot as a reference brings back its old actor, so the place is described in words.
    const where = String(place || '')
      .trim()
      .replace(/[.!?]+$/, '');
    return [
      'The character shown in ' +
        shown +
        (character ? ' (' + character + ')' : '') +
        (where ? ' is ' + where + ',' : '') +
        ' performing exactly the movement of the pose guide.',
      'The plain background of the character pictures is not part of the scene.',
      sentence(detail),
      'Natural ambient sound.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (kind === 'reangle')
    return [
      'Re-film the exact same moment as ' + video + '.',
      'New camera: ' + sentence(change || 'a new camera angle'),
      'Same people, clothing, set, lighting, action and timing; only the camera position changes.',
      sentence(detail),
      keep,
    ]
      .filter(Boolean)
      .join(' ');
  return [
    'Change ' + video + ': ' + sentence(change || 'the light and weather of the scene'),
    'Keep everything else in ' + video + ' unchanged: the people, their performance, the camera, framing and timing.',
    sentence(detail),
    keep,
  ]
    .filter(Boolean)
    .join(' ');
}

/** A place to recast into, taken from a shot's prompt: its first sentence without frame instructions. */
export function placeFrom(prompt = '') {
  const text = stripFramePhrases(prompt);
  return text
    ? text
        .split(/(?<=[.!?])\s/)[0]
        .replace(/[.!?]$/, '')
        .slice(0, 200)
    : '';
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
