import assert from 'node:assert/strict';
import { keyInputs, resultChoices, profileIssue, reusableBinding } from '../ui/profile.js';
import { matchClipInputs } from '../ui/workflow-setup.js';
import { controlnetInputs, builtinBindings } from '../ui/builtin-workflows.js';
const d = {
  LoadImage: { input: { required: { image: [['a.png'], { image_upload: true }] } }, output: ['IMAGE', 'MASK'] },
  CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } }, output: ['CONDITIONING'] },
  KSampler: {
    input: {
      required: { seed: ['INT'], positive: ['CONDITIONING'], negative: ['CONDITIONING'], latent_image: ['LATENT'] },
    },
    output: ['LATENT'],
  },
  VAEDecode: { input: { required: { samples: ['LATENT'] } }, output: ['IMAGE'] },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } }, output_node: true },
  SaveVideo: { input: { required: { video: ['VIDEO'] } }, output_node: true },
  LoadVideo: { input: { required: { file: ['COMBO'] } }, output: ['VIDEO'] },
};
const p = {
  '194:45': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
  positive: { class_type: 'CLIPTextEncode', inputs: { text: 'good' } },
  negative: { class_type: 'CLIPTextEncode', inputs: { text: 'bad' } },
  sampler: {
    class_type: 'KSampler',
    inputs: { seed: { __spool_int__: '18446744073709551615' }, positive: ['positive', 0], negative: ['negative', 0] },
  },
  decode: { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0] } },
  save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'not a control' } },
};
const checks = [],
  check = (label, test) => {
    assert.ok(test, label);
    checks.push(label);
  };
let c = keyInputs(p, d, { nodeId: 'save' });
check(
  'Proven positive essential, negative/seed advanced; saver filename absent',
  c.length === 3 &&
    c.find(x => x.role === 'positive') &&
    !c.find(x => x.input === 'filename_prefix') &&
    c.filter(x => x.advanced).length === 2,
);
check(
  'Exact uint64 value and opaque address survive',
  c.find(x => x.role === 'seed').value.__spool_int__ === '18446744073709551615',
);
p.sampler.inputs.negative = ['positive', 0];
check(
  'Shared positive/negative never receives a misleading prompt role',
  !keyInputs(p, d, { nodeId: 'save' }).some(x => x.nodeId === 'positive'),
);
p.sampler.inputs.negative = ['negative', 0];
const candidate = keyInputs(p, d, { nodeId: 'save' }).find(x => x.role === 'positive');
check(
  'Verified contract reuses after canvas-only change',
  reusableBinding(candidate, { ...candidate, label: 'renamed' }),
);
p.sampler.inputs.positive = ['negative', 0];
p.sampler.inputs.negative = ['positive', 0];
check(
  'Role rewiring does not reuse old role',
  !keyInputs(p, d, { nodeId: 'save' }).some(x => reusableBinding(candidate, x)),
);
check(
  'SaveVideo explicitly collects images index0',
  resultChoices({ v: { class_type: 'SaveVideo', inputs: { video: ['load', 0] } } }, d)[0].group === 'images',
);
check(
  'Multiple savers remain choices',
  resultChoices({ ...p, second: { class_type: 'SaveImage', inputs: { images: ['194:45', 0] } } }, d).length === 2,
);
check('Unreachable loader is not exposed', !c.some(x => x.nodeId === '194:45'));
check(
  'Nested ID source bound by exact input',
  keyInputs({ ...p, second: { class_type: 'SaveImage', inputs: { images: ['194:45', 0] } } }, d, {
    nodeId: 'second',
  })[0].nodeId === '194:45',
);
check(
  'A missing node is named from the editor graph when Comfy omits its type',
  profileIssue({ '700:12': { inputs: {} } }, d, {
    nodes: [{ id: 700, type: 'Group' }],
    definitions: { subgraphs: [{ nodes: [{ id: 12, type: 'SDPoseKeypointExtractor' }] }] },
  }) === 'Install the missing node: SDPoseKeypointExtractor' &&
    profileIssue({ 7: { inputs: {} } }, d) === 'Install the missing node: unknown type (node 7)',
);
check(
  'Missing schema and launcher blocked without dispatch',
  !!profileIssue({ x: { class_type: 'Missing', inputs: {} } }, d) &&
    !!profileIssue({ x: { class_type: 'DeadlineSubmit', inputs: {} } }, d),
);
const linked = structuredClone(p);
linked['194:45'].inputs.image = ['positive', 0];
check(
  'Linked source is never replaced',
  !keyInputs({ ...linked, second: { class_type: 'SaveImage', inputs: { images: ['194:45', 0] } } }, d, {
    nodeId: 'second',
  }).some(x => x.input === 'image'),
);
const switched = {
  ...p,
  switch: { class_type: 'UnknownSwitch', inputs: { a: ['194:45', 0] } },
  second: { class_type: 'SaveImage', inputs: { images: ['switch', 0] } },
};
check(
  'Unreviewed switch preserves saved loader branches without exposing them',
  !keyInputs(
    switched,
    { ...d, UnknownSwitch: { input: { required: { a: ['IMAGE'] } }, output: ['IMAGE'] } },
    { nodeId: 'second' },
  ).some(x => x.role === 'source'),
);
const vd = {
  ...d,
  Resize: { input: { required: { image: ['IMAGE'] } }, output: ['IMAGE'] },
  VideoCondition: {
    input: {
      required: {
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        start_image: ['IMAGE'],
        end_image: ['IMAGE'],
        length: ['INT', { min: 1, max: 16384, step: 4, default: 81 }],
      },
    },
    output: ['CONDITIONING', 'CONDITIONING', 'LATENT'],
    output_name: ['positive', 'negative', 'latent'],
  },
  ConditioningPass: { input: { required: { conditioning: ['CONDITIONING'] } }, output: ['CONDITIONING'] },
  Guide: { input: { required: { positive: ['CONDITIONING'], negative: ['CONDITIONING'] } }, output: ['GUIDER'] },
  Noise: { input: { required: { noise_seed: ['INT'] } }, output: ['NOISE'] },
  CustomSample: {
    input: { required: { noise: ['NOISE'], guider: ['GUIDER'], latent_image: ['LATENT'] } },
    output: ['LATENT'],
  },
  CustomSeed: {
    input: {
      required: {
        noise_seed: ['INT'],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
      },
    },
    output: ['LATENT'],
  },
  IntValue: { input: { required: { value: ['INT'] } }, output: ['INT'] },
  Math: {
    input: {
      required: {
        expression: ['STRING'],
        values: [
          'COMFY_AUTOGROW_V3',
          { template: { names: ['a', 'b'], input: { required: { value: ['FLOAT,INT,BOOLEAN'] } } } },
        ],
      },
    },
    output: ['FLOAT', 'INT', 'BOOLEAN'],
  },
  Join: { input: { required: { image1: ['IMAGE'], image2: ['IMAGE'] } }, output: ['IMAGE'] },
  Lazy: {
    input: { required: { image1: ['IMAGE', { lazy: true }], image2: ['IMAGE', { lazy: true }] } },
    output: ['IMAGE'],
  },
  Selector: {
    input: { required: { switch: ['BOOLEAN'], on_true: ['IMAGE'], on_false: ['IMAGE'] } },
    output: ['IMAGE'],
  },
  CreateVideo: { input: { required: { images: ['IMAGE'] } }, output: ['VIDEO'] },
  VideoImages: { input: { required: { video: ['VIDEO'] } }, output: ['IMAGE'] },
};
const video = {
  first: { class_type: 'LoadImage', inputs: { image: 'last-frame.png' } },
  last: { class_type: 'LoadImage', inputs: { image: 'first-frame.png' } },
  resize: { class_type: 'Resize', inputs: { image: ['first', 0] } },
  pos: { class_type: 'CLIPTextEncode', inputs: { text: 'positive' } },
  neg: { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
  '129:98': {
    class_type: 'VideoCondition',
    inputs: {
      positive: ['pos', 0],
      negative: ['neg', 0],
      start_image: ['resize', 0],
      end_image: ['last', 0],
      length: 81,
    },
  },
  pass: { class_type: 'ConditioningPass', inputs: { conditioning: ['129:98', 0] } },
  guide: { class_type: 'Guide', inputs: { positive: ['pass', 0], negative: ['129:98', 1] } },
  noise: { class_type: 'Noise', inputs: { noise_seed: 42 } },
  sample: {
    class_type: 'CustomSample',
    inputs: { noise: ['noise', 0], guider: ['guide', 0], latent_image: ['129:98', 2] },
  },
  decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0] } },
  create: { class_type: 'CreateVideo', inputs: { images: ['decode', 0] } },
  save: { class_type: 'SaveVideo', inputs: { video: ['create', 0] } },
};
const profile = graph => keyInputs(graph, vd, { nodeId: 'save' });
let v = profile(video);
check(
  'Generic typed walk crosses resize and video conditioning to loaders',
  v.filter(x => x.role === 'source').length === 2,
);
check(
  'First/last frame roles follow input direction, never filenames',
  v.find(x => x.nodeId === 'first').slot === 'firstFrame' && v.find(x => x.nodeId === 'last').slot === 'lastFrame',
);
check(
  'Conditioning outputs and guider preserve positive/negative roles',
  v.find(x => x.nodeId === 'pos').role === 'positive' && v.find(x => x.nodeId === 'neg').role === 'negative',
);
check(
  'Noise generator seed reaches advanced sampler without class names',
  v.find(x => x.nodeId === 'noise').role === 'seed',
);
check(
  'Duration retains flattened node ID and target frame constraints',
  v.find(x => x.role === 'duration').nodeId === '129:98' &&
    v.find(x => x.role === 'duration').constraints[0].step === 4,
);
check(
  'Old direct prompt contract retains exact version and shape',
  JSON.stringify(candidate.contract) ===
    JSON.stringify({
      adapter: 'spool-key-inputs-1',
      classType: 'CLIPTextEncode',
      inputType: 'STRING',
      relationship: [{ nodeId: 'sampler', input: 'positive', slot: 0 }],
    }),
);
const directSource = keyInputs(
  {
    load: { class_type: 'LoadImage', inputs: { image: 'a.png' } },
    save: { class_type: 'SaveImage', inputs: { images: ['load', 0] } },
  },
  d,
  { nodeId: 'save' },
)[0];
check(
  'Old loader contract retains empty relationship and remains reusable',
  reusableBinding(directSource, {
    nodeId: 'load',
    input: 'image',
    contract: { adapter: 'spool-key-inputs-1', classType: 'LoadImage', inputType: 'COMBO', relationship: [] },
  }),
);
let changed = structuredClone(video);
changed['129:98'].inputs.negative = ['pos', 0];
check('Shared roles through conditioning receive no prompt role', !profile(changed).some(x => x.nodeId === 'pos'));
changed = structuredClone(video);
changed.unknown = { class_type: 'ConditioningPass', inputs: { conditioning: ['pass', 0] } };
check('Unclassified downstream conditioning use hides the prompt', !profile(changed).some(x => x.nodeId === 'pos'));
changed = structuredClone(video);
changed['129:98'].inputs.start_image = ['last', 0];
check(
  'One loader used as first and last is ambiguous and unchecked advanced',
  profile(changed).find(x => x.nodeId === 'last').ambiguous && profile(changed).find(x => x.nodeId === 'last').advanced,
);
changed = structuredClone(video);
changed.resize = { class_type: 'Join', inputs: { image1: ['first', 0], image2: ['last', 0] } };
delete changed['129:98'].inputs.end_image;
check(
  'A combined first frame never assigns all contributing loaders first-frame roles',
  profile(changed)
    .filter(x => x.role === 'source')
    .every(x => x.ambiguous),
);
for (const type of ['Lazy', 'Selector']) {
  changed = structuredClone(video);
  changed.resize = {
    class_type: type,
    inputs:
      type === 'Lazy'
        ? { image1: ['first', 0], image2: ['last', 0] }
        : { switch: true, on_true: ['first', 0], on_false: ['last', 0] },
  };
  delete changed['129:98'].inputs.end_image;
  check(type + ' keeps branch loaders in saved settings', !profile(changed).some(x => x.role === 'source'));
}
changed = structuredClone(video);
changed.resize.inputs.image = ['first', 1];
delete changed['129:98'].inputs.end_image;
check('Wrong output type does not produce a source mapping', !profile(changed).some(x => x.role === 'source'));
changed = structuredClone(video);
changed.clipFrames = { class_type: 'IntValue', inputs: { value: 81 } };
changed['129:98'].inputs.length = ['clipFrames', 0];
v = profile(changed);
const primitive = v.find(x => x.role === 'duration');
check(
  'Linked duration binds the editable primitive literal',
  primitive.nodeId === 'clipFrames' &&
    primitive.input === 'value' &&
    primitive.contract.relationship[0].nodeId === '129:98',
);
changed.math = { class_type: 'Math', inputs: { expression: 'a', 'values.a': ['clipFrames', 0] } };
changed['129:98'].inputs.length = ['math', 1];
v = profile(changed);
check(
  'Autogrow identity math follows the INT slot to the primitive',
  v.find(x => x.role === 'duration').nodeId === 'clipFrames' &&
    v.find(x => x.role === 'duration').contract.relationship.length === 2,
);
changed.math.inputs.expression = 'a * b + 1';
changed.math.inputs['values.b'] = 24;
check(
  'Seconds/fps or nonidentity math duration is left unresolved',
  !profile(changed).some(x => x.role === 'duration'),
);
changed.math.inputs.expression = 'a';
changed.math.inputs['values.b'] = ['noise', 0];
check(
  'Invalid unused math link cannot change identity duration',
  profile(changed).some(x => x.role === 'duration'),
);
changed = structuredClone(video);
changed.clipFrames = { class_type: 'IntValue', inputs: { value: ['clipFrames', 0] } };
changed['129:98'].inputs.length = ['clipFrames', 0];
check('Cyclic primitive duration terminates without a mapping', !profile(changed).some(x => x.role === 'duration'));
changed = structuredClone(video);
changed.sample = {
  class_type: 'CustomSeed',
  inputs: { noise_seed: 123, positive: ['pos', 0], negative: ['neg', 0], latent_image: ['129:98', 2] },
};
check(
  'Custom sampler noise_seed is recognised generically',
  profile(changed).some(x => x.nodeId === 'sample' && x.role === 'seed'),
);
changed = structuredClone(video);
changed.loadVideo = { class_type: 'LoadVideo', inputs: { file: 'input.mp4' } };
changed.resize = { class_type: 'VideoImages', inputs: { video: ['loadVideo', 0] } };
delete changed['129:98'].inputs.end_image;
check(
  'Source video traverses typed video-to-image processing',
  profile(changed).some(x => x.nodeId === 'loadVideo' && x.slot === 'video'),
);
changed = structuredClone(video);
for (let i = 0; i < 6; i++) {
  changed['noise' + i] = { class_type: 'Noise', inputs: { noise_seed: i } };
  changed['sample' + i] = {
    class_type: 'CustomSample',
    inputs: { noise: ['noise' + i, 0], guider: ['guide', 0], latent_image: [i ? 'sample' + (i - 1) : 'sample', 0] },
  };
}
changed.decode.inputs.samples = ['sample5', 0];
check('More than four advanced controls are retained', profile(changed).filter(x => x.role === 'seed').length === 7);
check(
  'Duplicate labels receive stable consecutive numbers',
  profile(changed)
    .filter(x => x.role === 'seed')
    .every((x, i) => x.label === 'Seed ' + (i + 1)),
);
vd.MatchResize = {
  input: {
    required: { input: ['COMFY_MATCHTYPE_V3', { template: { template_id: 'media', allowed_types: 'IMAGE,MASK' } }] },
  },
  output: ['COMFY_MATCHTYPE_V3'],
  output_matchtypes: ['media'],
};
changed = structuredClone(video);
changed.resize = { class_type: 'MatchResize', inputs: { input: ['first', 0] } };
check(
  'Schema match-type output follows the actual linked IMAGE through resize',
  profile(changed).find(x => x.nodeId === 'first').slot === 'firstFrame',
);
changed.resize.inputs.input = ['noise', 0];
check(
  'Match-type allowed types reject an incompatible noise source',
  !profile(changed).some(x => x.nodeId === 'first'),
);
changed.resize.inputs.input = ['resize', 0];
check('Cyclic match-type links terminate without a source mapping', !profile(changed).some(x => x.nodeId === 'first'));
vd.SplitCondition = { ...vd.VideoCondition, output_name: ['CONDITIONING', 'CONDITIONING', 'LATENT'] };
changed = structuredClone(video);
changed['129:98'].class_type = 'SplitCondition';
// The latent still consumes named positive/negative, but opaque conditioning
// outputs feeding the guider are unclassified uses, so neither text is exposed.
check(
  'Unnamed multi-conditioning outputs do not guess their prompt role',
  !profile(changed).some(x => ['positive', 'negative'].includes(x.role)),
);
changed = structuredClone(video);
changed.secondFrames = { class_type: 'VideoCondition', inputs: { length: 49 } };
changed.sample.inputs.latent_image = ['secondFrames', 2];
// Keep the first length reachable through the guider.
check(
  'Independent duration literals are marked ambiguous instead of silently selecting one',
  profile(changed)
    .filter(x => x.role === 'duration')
    .every(x => x.ambiguous && x.advanced),
);
const minimaxDefinitions = {
  ...vd,
  MiniMaxH3ImageToVideo: {
    input: {
      required: {
        prompt: ['STRING'],
        length: ['INT', { min: 5, step: 17 }],
        first_frame: ['IMAGE'],
        last_frame: ['IMAGE'],
      },
    },
    output: ['CONDITIONING', 'LATENT'],
    output_name: ['positive', 'LATENT'],
  },
  BasicGuider: { input: { required: { conditioning: ['CONDITIONING'] } }, output: ['GUIDER'] },
  DeadlineSeed: { input: { required: { seed: ['INT'] } }, output: ['INT'] },
  PrimitiveFloat: { input: { required: { value: ['FLOAT'] } }, output: ['FLOAT'] },
  ComfyMathExpression: vd.Math,
};
const minimax = {
  image: { class_type: 'LoadImage', inputs: { image: 'worker/S15_v01.png' } },
  '105:104': {
    class_type: 'MiniMaxH3ImageToVideo',
    inputs: { prompt: 'MiniMax direct prompt', first_frame: ['image', 0], length: ['105:107', 1] },
  },
  '105:107': {
    class_type: 'ComfyMathExpression',
    inputs: {
      expression: 'max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17',
      'values.a': ['seconds', 0],
    },
  },
  seconds: { class_type: 'PrimitiveFloat', inputs: { value: 5 } },
  deadline: {
    class_type: 'DeadlineSeed',
    inputs: { seed: { __spool_int__: '18446744073709551615' }, batch_mode: false },
  },
  noise: { class_type: 'Noise', inputs: { noise_seed: ['deadline', 0] } },
  guide: { class_type: 'BasicGuider', inputs: { conditioning: ['105:104', 0] } },
  sample: {
    class_type: 'CustomSample',
    inputs: { noise: ['noise', 0], guider: ['guide', 0], latent_image: ['105:104', 1] },
  },
  decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0] } },
  save: { class_type: 'SaveImage', inputs: { images: ['decode', 0] } },
};
const minimaxProfile = p => keyInputs(p, minimaxDefinitions, { nodeId: 'save' });
v = minimaxProfile(minimax);
check(
  'MiniMax exposes frame, direct prompt, authored seconds and linked Deadline seed',
  v.length === 4 &&
    v.every(c => !c.advanced) &&
    v.find(c => c.role === 'positive').input === 'prompt' &&
    v.find(c => c.role === 'duration').unit === 'seconds' &&
    v.find(c => c.role === 'seed').value.__spool_int__ === '18446744073709551615',
);
check(
  'Duration keeps the seconds primitive and full model-grid relationship',
  v.find(c => c.role === 'duration').nodeId === 'seconds' &&
    v.find(c => c.role === 'duration').contract.relationship.length === 2,
);
check(
  'Linked seed binds the Deadline literal without replacing the noise edge',
  v.find(c => c.role === 'seed').nodeId === 'deadline' &&
    v.find(c => c.role === 'seed').input === 'seed' &&
    minimax.noise.inputs.noise_seed[0] === 'deadline',
);
changed = structuredClone(minimax);
changed['105:104'].inputs.last_frame = changed['105:104'].inputs.first_frame;
delete changed['105:104'].inputs.first_frame;
check(
  'MiniMax ending anchors are labelled Last frame',
  minimaxProfile(changed).find(c => c.role === 'source').slot === 'lastFrame',
);
for (const flag of ['batch_mode', 'is_worker']) {
  changed = structuredClone(minimax);
  changed.deadline.inputs[flag] = true;
  check(
    'Deadline ' + flag + ' does not imply a passthrough seed',
    !minimaxProfile(changed).some(c => c.role === 'seed'),
  );
}
for (const expression of ['a*24', null, 'max(5, round(a * 30)) + (5 - (max(5, round(a * 30)) % 17)) % 17']) {
  changed = structuredClone(minimax);
  changed['105:107'].inputs.expression = expression;
  check(
    'Unrecognized MiniMax conversion is not guessed: ' + expression,
    !minimaxProfile(changed).some(c => c.role === 'duration'),
  );
}
changed = structuredClone(minimax);
changed['105:107'].inputs['values.b'] = 24;
check(
  'Extra formula inputs prevent an inferred seconds binding',
  !minimaxProfile(changed).some(c => c.role === 'duration'),
);
changed = structuredClone(minimax);
changed['105:104'].inputs.length = 124;
check(
  'A literal MiniMax duration remains a frame count',
  minimaxProfile(changed).find(c => c.role === 'duration').label === 'Duration (frames)',
);
const defs = {
    Settings: {
      input: {
        required: {
          aspect_ratio: [['16:9', '1:1', '9:16']],
          megapixels: ['FLOAT'],
          seconds: ['FLOAT', { min: { __spool_int__: '2' }, max: 10, step: 1 }],
          prompt: ['STRING'],
          seed: ['INT', { min: 0, max: { __spool_int__: '18446744073709551615' } }],
        },
      },
    },
  },
  recipe = {
    prompt: {
      settings: {
        class_type: 'Settings',
        inputs: { aspect_ratio: '16:9', megapixels: 0.4, seconds: 5, prompt: 'Default', seed: 0 },
      },
    },
  };
const bindings = [
  ...['firstFrame', 'lastFrame', 'reference', 'reference', 'video', 'audio'].map((slot, i) => ({
    key: 'source' + i,
    nodeId: 'settings',
    input: 'asset' + i,
    asset: true,
    slot,
  })),
  ...['aspect_ratio', 'megapixels', 'seconds', 'prompt', 'seed'].map((input, i) => ({
    key: input,
    nodeId: 'settings',
    input,
    role: ['resolution', 'resolution', 'duration', 'positive', 'seed'][i],
    ...(input === 'seconds' ? { unit: 'seconds' } : {}),
  })),
];
const source = {
  takeId: 'current',
  takes: [{ id: 'current', media: { kind: 'image', width: 1080, height: 1920 } }],
  in: 24,
  out: 108,
  bindings: [
    { key: 'oldPrompt', role: 'positive' },
    { key: 'oldSeed', role: 'seed' },
  ],
  inputValues: { oldPrompt: 'Keep this prompt', oldSeed: { __spool_int__: '18446744073709551615' } },
};
const target = () => ({
  bindings: structuredClone(bindings),
  inputValues: structuredClone(recipe.prompt.settings.inputs),
  shotInputs: [],
});
let applied = target();
matchClipInputs(applied, source, recipe, defs, 24);
check(
  'Image replacement binds first, last and one reference but no video/audio',
  applied.shotInputs.length === 3 &&
    applied.shotInputs.find(s => s.key === 'source1').frame === 'last' &&
    !applied.shotInputs.some(s => s.key === 'source3'),
);
check(
  'Portrait aspect and trimmed seconds match without changing resolution',
  applied.inputValues.aspect_ratio === '9:16' &&
    applied.inputValues.seconds === 4 &&
    applied.inputValues.megapixels === 0.4,
);
check(
  'Compatible prompts and exact uint64 seeds survive workflow replacement',
  applied.inputValues.prompt === 'Keep this prompt' &&
    applied.inputValues.seed.__spool_int__ === '18446744073709551615',
);
const videoSource = structuredClone(source);
videoSource.takes[0].media.kind = 'video';
videoSource.takes[0].media.audio = true;
videoSource.out = 24 + 24 * 20;
applied = target();
matchClipInputs(applied, videoSource, recipe, defs, 24);
check(
  'Video replacement supplies video, audio and sampled first/last frames',
  applied.shotInputs.length === 5 &&
    applied.shotInputs.some(s => s.key === 'source4') &&
    applied.shotInputs.some(s => s.key === 'source5'),
);
check('Duration respects the target node maximum', applied.inputValues.seconds === 10);
const placeholder = structuredClone(source);
placeholder.takes[0].placeholder = true;
applied = target();
const defaults = JSON.stringify(applied);
matchClipInputs(applied, placeholder, recipe, defs, 24);
check('Ungenerated placeholders retain empty sources and template defaults', JSON.stringify(applied) === defaults);
const controlPrompt = {
  patch: { class_type: 'MiniMaxH3FunControlNetApply', inputs: { strength: 1, start_percent: 0, end_percent: 1 } },
  pose: { class_type: 'SDPoseDrawKeypoints', inputs: { draw_hands: true, score_threshold: 0.51 } },
  detector: { class_type: 'RTDETR_detect', inputs: { max_detections: 2 } },
};
const controlDefs = {
  MiniMaxH3FunControlNetApply: {
    input: { required: { strength: ['FLOAT'], start_percent: ['FLOAT'], end_percent: ['FLOAT'] } },
  },
  SDPoseDrawKeypoints: { input: { required: { draw_hands: ['BOOLEAN'], score_threshold: ['FLOAT'] } } },
  RTDETR_detect: { input: { required: { max_detections: ['INT'] } } },
};
const controlInputs = controlnetInputs(controlPrompt, controlDefs);
check(
  'ControlNet profiles retain FLOAT contracts for whole-number defaults',
  controlInputs.length === 6 &&
    controlInputs.find(b => b.input === 'strength').contract.inputType === 'FLOAT' &&
    controlInputs.find(b => b.input === 'strength').value === 1,
);
check(
  'Pose profiles expose only controls wired into the actual prompt',
  controlInputs.some(b => b.input === 'draw_hands' && b.role === 'pose') &&
    !controlInputs.some(b => b.input === 'draw_face' || b.slot === 'reference'),
);
const held = { nodeId: 'patch', input: 'strength', key: 'existing-custom-key', role: 'controlnet' },
  heldBindings = [held],
  legacyControl = {
    provenance: { builtinTemplate: 'video_minimax_h3_fun_controlnet_union' },
    prompt: controlPrompt,
    bindings: heldBindings,
  };
const expandedControl = builtinBindings(legacyControl, controlDefs);
check(
  'Expanded built-ins keep existing addresses and keys without mutating saved captures',
  expandedControl.length === 6 &&
    expandedControl[0] === held &&
    heldBindings.length === 1 &&
    expandedControl.some(b => b.key === 'pose/draw_hands'),
);
const unrelatedControl = { ...legacyControl, provenance: { builtinTemplate: 'other' } };
check(
  'Unrelated built-ins and graphs without a Union node gain no controls',
  builtinBindings(unrelatedControl, controlDefs) === heldBindings &&
    !controlnetInputs({ pose: controlPrompt.pose }, controlDefs).length,
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
