// Directing tools: transitions, extensions, retakes and reworks of a shot.
// Pure data and rules; ui/directing.js owns the dialogs and edits.
import { tag } from './cast.js';

/** @typedef {{ id: string, name: string, prompt: string, seconds?: number, colors: string[] }} Preset */

/** @type {Preset[]} */
export const TRANSITIONS = [
  {
    id: 'morph',
    name: 'Morph',
    prompt:
      'One continuous shot. The first image transforms fluidly into the second: shapes, colors and light flow and reshape without a cut.',
    colors: ['#7c5cff', '#21d4fd'],
  },
  {
    id: 'smoke',
    name: 'Smoke',
    prompt:
      'Thick billowing smoke rolls across the frame and fully hides the first scene, then drifts apart to reveal the second scene.',
    seconds: 3,
    colors: ['#3a3f47', '#c9ced6'],
  },
  {
    id: 'whip-pan',
    name: 'Whip pan',
    prompt:
      'The camera whips sideways very fast with strong horizontal motion blur, then settles precisely on the second scene.',
    colors: ['#ff8a00', '#e52e71'],
  },
  {
    id: 'zoom-through',
    name: 'Zoom through',
    prompt:
      'The camera pushes rapidly forward into the first scene, flies through it and emerges into the second scene.',
    colors: ['#00c6ff', '#0072ff'],
  },
  {
    id: 'light-flash',
    name: 'Light flash',
    prompt:
      'A burst of warm light flares across the lens and floods the frame to white, then fades down onto the second scene.',
    colors: ['#fff6b7', '#f6416c'],
  },
  {
    id: 'ink',
    name: 'Ink bloom',
    prompt:
      'Black ink blooms and spreads across the frame like ink in water, covering the first scene, then recedes to reveal the second scene.',
    seconds: 3,
    colors: ['#0f0c29', '#6a6a8a'],
  },
  {
    id: 'water',
    name: 'Water wave',
    prompt:
      'A wave of clear water washes across the frame, refracting the first scene, and as it passes the second scene is revealed.',
    seconds: 3,
    colors: ['#43cea2', '#185a9d'],
  },
  {
    id: 'glitch',
    name: 'Glitch',
    prompt:
      'Digital glitch: the first scene tears into RGB-shifted bands and datamosh blocks, then snaps cleanly into the second scene.',
    colors: ['#f953c6', '#00f2fe'],
  },
  {
    id: 'dissolve',
    name: 'Dissolve',
    prompt: 'A slow, soft cinematic cross dissolve from the first scene to the second scene.',
    colors: ['#bdc3c7', '#2c3e50'],
  },
];

/** @type {Preset[]} */
export const ANGLES = [
  {
    id: 'low',
    name: 'Low angle',
    prompt: 'a low angle close to the ground, looking up',
    colors: ['#f7971e', '#ffd200'],
  },
  { id: 'high', name: 'High angle', prompt: 'a high angle, looking down from above', colors: ['#56ccf2', '#2f80ed'] },
  { id: 'close', name: 'Close-up', prompt: 'a tight close-up on the main subject', colors: ['#ee0979', '#ff6a00'] },
  { id: 'wide', name: 'Wide shot', prompt: 'a wide shot that shows the whole scene', colors: ['#11998e', '#38ef7d'] },
  {
    id: 'side',
    name: 'Side profile',
    prompt: 'the side, ninety degrees from the original camera',
    colors: ['#8e2de2', '#4a00e0'],
  },
  {
    id: 'over-shoulder',
    name: 'Over the shoulder',
    prompt: 'over the shoulder of the main subject',
    colors: ['#c94b4b', '#4b134f'],
  },
  {
    id: 'orbit',
    name: 'Slow orbit',
    prompt: 'a camera slowly orbiting around the main subject',
    colors: ['#00b4db', '#0083b0'],
  },
  {
    id: 'top-down',
    name: 'Top down',
    prompt: 'directly overhead, looking straight down',
    colors: ['#a8c0ff', '#3f2b96'],
  },
];

/** @type {Preset[]} */
export const EFFECTS = [
  {
    id: 'rain',
    name: 'Heavy rain',
    prompt: 'Add heavy rain falling through the scene, with wet reflective surfaces',
    colors: ['#4b6cb7', '#182848'],
  },
  {
    id: 'snow',
    name: 'Snowfall',
    prompt: 'Add soft snow falling through the scene and settling on surfaces',
    colors: ['#e0eafc', '#cfdef3'],
  },
  {
    id: 'night',
    name: 'Neon night',
    prompt: 'Turn the scene into night lit by colourful neon signs',
    colors: ['#fc466b', '#3f5efb'],
  },
  {
    id: 'golden',
    name: 'Golden hour',
    prompt: 'Relight the scene with low warm golden-hour sunlight and long shadows',
    colors: ['#f12711', '#f5af19'],
  },
  {
    id: 'fire',
    name: 'Fire',
    prompt: 'Add roaring flames and drifting embers burning in the background of the scene',
    colors: ['#ff416c', '#ff4b2b'],
  },
  {
    id: 'fog',
    name: 'Fog',
    prompt: 'Fill the scene with thick drifting fog and soft volumetric light beams',
    colors: ['#757f9a', '#d7dde8'],
  },
  {
    id: 'sparks',
    name: 'Magic sparks',
    prompt: 'Add glowing magical sparks and particles swirling around the main subject',
    colors: ['#da22ff', '#9733ee'],
  },
  {
    id: 'disintegrate',
    name: 'Disintegrate',
    prompt: 'Make the main subject slowly disintegrate into drifting dust particles',
    colors: ['#614385', '#516395'],
  },
];

export const REWORKS = {
  recast: { name: 'Recast', verb: 'Recast', presets: [] },
  reangle: { name: 'Re-angle', verb: 'Re-angle', presets: ANGLES },
  effect: { name: 'Effect', verb: 'Add effect to', presets: EFFECTS },
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
 * lists the only lengths a workflow accepts.
 * @type {Record<string, { id: string, label: string, target: string, min?: number, max?: number, options?: number[] }[]>}
 */
export const WORKFLOWS = {
  transition: [
    { id: 'video_ltx2_5_flf2v', label: 'LTX 2.5 · Local', target: 'local', min: 1, max: 10 },
    { id: 'api_minimax_h3_flf2v', label: 'MiniMax H3 · Cloud', target: 'cloud', min: 4, max: 15 },
    { id: 'api_ltx2_5_flf2v', label: 'LTX 2.5 · Cloud', target: 'cloud', options: [2, 3, 4, 5, 6, 8, 10] },
  ],
  extend: [
    { id: 'video_minimax_h3_i2v', label: 'MiniMax H3 · Local', target: 'local', min: 2, max: 15 },
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

/** Bindings a directing tool fills, found by slot and role. */
export function toolBindings(bindings = []) {
  const find = test => bindings.find(test);
  return {
    first: find(b => b.asset && b.slot === 'firstFrame') || find(b => b.asset && b.slot === 'image'),
    last: find(b => b.asset && b.slot === 'lastFrame'),
    video: find(b => b.asset && b.slot === 'video'),
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

const sentence = text => {
  const value = String(text || '').trim();
  return !value ? '' : /[.!?]$/.test(value) ? value : value + '.';
};

export function transitionPrompt(preset, detail = '') {
  return [
    'Use the provided start image as the first frame and the provided end image as the last frame.',
    preset.prompt,
    sentence(detail),
    'One smooth continuous motion over the whole clip, landing on the last frame only at the very end, with a soft whoosh of sound.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function extendPrompt(sourcePrompt = '', detail = '') {
  const action = sentence(detail);
  return [
    'Use the provided start image as the first frame.',
    'Continue the same shot from this exact moment: the same people, place, lighting and camera style.',
    action || 'The action carries on naturally from where it was.',
    'The ambient sound carries on.',
    sourcePrompt ? 'Earlier in this shot: ' + sentence(stripFramePhrases(sourcePrompt)) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function retakePrompt(sourcePrompt = '', detail = '') {
  return [
    'Use the provided start image as the first frame and the provided end image as the last frame.',
    'Keep the same people, place, lighting and camera; join both frames in one continuous motion.',
    sentence(detail),
    'The ambient sound carries on.',
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
  preset,
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
      'Re-film the exact same moment as ' + video + ' from ' + (preset?.prompt || 'a new camera angle') + '.',
      'Same people, clothing, set, lighting, action and timing; only the camera position changes.',
      sentence(detail),
      keep,
    ]
      .filter(Boolean)
      .join(' ');
  return [
    sentence((preset?.prompt || 'Change the scene') + ' in ' + video),
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

function presetFor(direction) {
  const list = direction?.kind === 'transition' ? TRANSITIONS : REWORKS[direction?.kind]?.presets || [];
  return list.find(p => p.id === direction?.preset) || null;
}

/** Short label for a directed clip on the timeline and in the inspector. */
export function directionLabel(direction) {
  if (!direction?.kind || !KINDS[direction.kind]) return '';
  return presetFor(direction)?.name || KINDS[direction.kind].name;
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
