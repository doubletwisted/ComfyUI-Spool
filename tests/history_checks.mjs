// Undo/redo ownership: entry shape, take archive, bounding, persistence, reload.
// node tests/history_checks.mjs [REAL_PROJECT_DOCUMENT_JSON]
import fs from 'node:fs';
import { createHistory, sameStacks, LIMIT, BUDGET } from '../ui/history.js';

const checks = [];
const check = (label, ok) => {
  if (!ok) throw Error(label);
  checks.push(label);
};

const media = id => ({
  id,
  kind: 'video',
  name: id + '.mp4',
  file: 'uploads/' + id + '.mp4',
  poster: 'p.jpg',
  frames: 240,
  width: 1920,
  height: 1080,
  audio: true,
});
const take = (id, extra = {}) => ({
  id,
  number: 1,
  revision: 1,
  media: media('media-' + id),
  importedExecution: { capture: { prompt: { 1: { class_type: 'KSampler', inputs: { seed: 1 } } } } },
  ...extra,
});
const document = (clipCount = 8, takesPerClip = 3) => ({
  project: 'History QA',
  fps: 24,
  resolution: { width: 960, height: 540 },
  brief: '',
  tailGap: 0,
  media: [media('pool-1')],
  importedWorkflows: [
    { id: 'wf-1', name: 'wf', data: { workflow: { nodes: [] }, provenance: { originalText: 'x'.repeat(500) } } },
  ],
  audioClips: [
    {
      id: 'audio-1',
      start: 0,
      in: 0,
      out: 240,
      media: media('audio-media'),
      audio: { gainDb: 0, fadeIn: 0, fadeOut: 0 },
    },
  ],
  jobs: [{ id: 'job-1', status: 'complete' }],
  recoverableResults: [{ takeId: 'x' }],
  selected: 'clip-0',
  selectedAudio: null,
  selection: ['clip-0'],
  frame: 12,
  zoom: 100,
  snap: true,
  muted: true,
  loop: false,
  clips: Array.from({ length: clipCount }, (_, index) => ({
    id: 'clip-' + index,
    name: 'Shot ' + index,
    in: 0,
    out: 240,
    count: 1,
    revision: 1,
    workflow: null,
    sources: [],
    takeId: 'take-' + index + '-0',
    takes: Array.from({ length: takesPerClip }, (_, slot) => take('take-' + index + '-' + slot, { number: slot + 1 })),
  })),
});

// --- what a step carries ----------------------------------------------------
{
  const history = createHistory();
  const before = document();
  const entry = history.remember(before, 'Trim clip');
  check(
    'A step names takes instead of copying them',
    entry.clips.every(clip => clip.takes.every(id => typeof id === 'string')),
  );
  check('A step carries the label', entry._label === 'Trim clip');
  check(
    'A step omits the media pool, workflow library and jobs',
    !('media' in entry) && !('importedWorkflows' in entry) && !('jobs' in entry) && !('recoverableResults' in entry),
  );
  check(
    'A step omits view keys the editor re-applies',
    ['zoom', 'snap', 'muted', 'loop', 'previewQuality'].every(key => !(key in entry)),
  );
  check(
    'A step keeps selection and playhead',
    entry.selected === 'clip-0' && entry.frame === 12 && entry.selection[0] === 'clip-0',
  );
  check('A step keeps audio clips with their media', entry.audioClips[0].media.id === 'audio-media');
  const entrySize = JSON.stringify(entry).length,
    documentSize = JSON.stringify(before).length;
  check('A step is much smaller than the document', entrySize * 4 < documentSize);
  const restored = history.hydrate(entry);
  check('Hydration restores the same clips and takes', JSON.stringify(restored.clips) === JSON.stringify(before.clips));
  check(
    'Hydration restores the audio clips',
    JSON.stringify(restored.audioClips) === JSON.stringify(before.audioClips),
  );
  check(
    'Hydration does not invent the shared collections',
    !('media' in restored) && !('importedWorkflows' in restored),
  );
}

// --- take immutability: the archive is shared, not copied -------------------
{
  const history = createHistory();
  const before = document();
  history.remember(before);
  const entries = Array.from({ length: 20 }, (_, index) => history.remember(before, 'Edit ' + index));
  check('Twenty steps share one archive of takes', history.size.takes === 24);
  check('Twenty steps keep twenty entries', history.undo.length === 0 && entries.length === 20);
}

// --- bounding --------------------------------------------------------------
{
  const history = createHistory();
  const before = document();
  for (let index = 0; index < LIMIT + 12; index++) history.record(before, 'Edit ' + index);
  check('The undo stack is bounded', history.undo.length === LIMIT);
  check('The oldest steps are dropped first', history.undo[0]._label === 'Edit 12');
  check('The newest step is retained', history.undo.at(-1)._label === 'Edit ' + (LIMIT + 11));
}

// --- an oversized stack keeps its newest suffix -----------------------------
{
  const history = createHistory({ budget: 4000 });
  const before = document(4, 2);
  for (let index = 0; index < 12; index++) history.record(before, 'Edit ' + index);
  const text = history.serialize('small');
  check('A small budget is respected', text.length <= 4000);
  const parsed = JSON.parse(text);
  check('Only a suffix of the stack is kept', parsed.undo.length >= 1 && parsed.undo.length < 12);
  check('The kept suffix is the newest steps', parsed.undo.at(-1)._label === 'Edit 11');
  check(
    'The archive holds only what the kept steps reference',
    Object.keys(parsed.takes).length <= 4 * 2 &&
      Object.keys(parsed.takes).length >= parsed.undo.at(-1).clips.length * 2,
  );
  const reloaded = createHistory();
  check('The trimmed chain still reloads', reloaded.load(text) === parsed.undo.length);
  check('The trimmed chain hydrates', !!reloaded.hydrate(reloaded.undo.at(-1)));
}

// --- the budget is enforced, never exceeded ---------------------------------
{
  const huge = createHistory({ budget: 1000 });
  const before = document(6, 4);
  huge.record(before, 'Only step');
  const text = huge.serialize('tiny');
  check('An oversized single step produces a blob inside the budget', text.length <= 1000);
  check('An oversized step is dropped rather than persisted', JSON.parse(text).undo.length === 0);
  const reloaded = createHistory();
  check('An empty chain reloads as no steps', reloaded.load(text) === 0);

  // Redo-only payloads must be charged to the same budget. This fixture keeps takes
  // light and clips numerous, which is the ratio the real project has: the shared
  // archive is one payload per take, and a step is its clip list.
  const light = (clips, takes) => ({
    project: 'P',
    fps: 24,
    resolution: { width: 960, height: 540 },
    media: [media('pool')],
    importedWorkflows: [],
    audioClips: [],
    clips: Array.from({ length: clips }, (_, index) => ({
      id: 'clip-' + index,
      name: 'Shot ' + index,
      in: 0,
      out: 240,
      takeId: 'take-' + index + '-0',
      takes: Array.from({ length: takes }, (_, slot) => ({
        id: 'take-' + index + '-' + slot,
        number: slot + 1,
        media: media('media-' + index + '-' + slot),
      })),
    })),
  });
  const shared = createHistory({ budget: 30000 });
  const base = light(20, 3);
  for (let index = 0; index < 6; index++) shared.record(base, 'Edit ' + index);
  for (let index = 0; index < 3; index++) shared.step(shared.undo, shared.redo, base);
  check('Undo and redo both hold steps', shared.undo.length === 3 && shared.redo.length === 3);
  const both = shared.serialize('redo');
  check('Undo and redo share one budget', both.length <= 30000);
  const parsed = JSON.parse(both);
  check('Redo survives persistence alongside undo', parsed.redo.length >= 1 && parsed.undo.length >= 1);
  check(
    'The shared archive is written once, not per step',
    Object.keys(parsed.takes).length <= 20 * 3 &&
      Object.keys(parsed.takes).length >= parsed.undo.at(-1).clips.length * 3,
  );
  const rehydrated = createHistory();
  check('A blob with redo reloads', rehydrated.load(both) === parsed.undo.length + parsed.redo.length);
  check('A reloaded redo step hydrates', !!rehydrated.hydrate(rehydrated.redo.at(-1)));
}

// --- the archive is pruned with the steps -----------------------------------
{
  const history = createHistory({ limit: 2 });
  for (let index = 0; index < 6; index++) history.record(document(4, 2), 'Edit ' + index);
  check('Expiring steps prune their takes from the archive', history.size.takes <= 4 * 2 * 2);
  history.record(document(4, 2), 'Edit 7');
  check('Redo clearing does not grow the archive', history.size.takes <= 4 * 2 * 2);
  history.clear();
  check(
    'Clearing the history empties the archive',
    history.size.takes === 0 && history.undo.length === 0 && history.redo.length === 0,
  );
}

// --- record, undo and redo -------------------------------------------------
{
  const history = createHistory();
  const before = document();
  history.record(before, 'Trim clip');
  check('Recording clears redo', history.redo.length === 0);
  const after = document();
  after.clips[0].out = 120;
  const step = history.step(history.undo, history.redo, after);
  check(
    'Undo returns the earlier edit and its label',
    step.label === 'Trim clip' && step.restored.clips[0].out === 240,
  );
  check('Undo moves the current state onto redo', history.redo.length === 1);
  const back = history.step(history.redo, history.undo, step.restored);
  check('Redo returns the later edit', back.restored.clips[0].out === 120);
  check('Redo moves it back onto undo', history.undo.length === 1 && history.redo.length === 0);
  check('An empty stack yields no step', history.step([], history.redo, before) === null);
}

// --- persistence and reload -------------------------------------------------
{
  const history = createHistory();
  const before = document(24, 6);
  for (let index = 0; index < 30; index++) {
    before.clips[index % before.clips.length].out = 240 - index;
    history.record(JSON.parse(JSON.stringify(before)), 'Edit ' + index);
  }
  const signature = 'signature-1';
  const text = history.serialize(signature);
  check('The persisted blob fits the budget', text.length <= BUDGET);
  const parsed = JSON.parse(text);
  check('The persisted blob carries its signature', parsed.project === signature);
  check(
    'The persisted blob carries one archive of takes',
    Object.keys(parsed.takes).length > 0 && Object.keys(parsed.takes).length <= 24 * 6,
  );
  check('The persisted blob keeps several steps', parsed.undo.length > 1);
  check('The persisted blob keeps the newest step last', parsed.undo.at(-1)._label === 'Edit 29');
  const kept = parsed.undo.length;

  const reloaded = createHistory();
  const restored = reloaded.load(text);
  check('Reload adopts the persisted chain', restored === kept);
  check('Reload restores the same step count', reloaded.undo.length === kept);
  const newest = reloaded.hydrate(reloaded.undo.at(-1));
  check(
    'A reloaded step hydrates complete takes',
    newest.clips.every(clip => clip.takes.length === 6 && clip.takes.every(t => t.media && t.importedExecution)),
  );
  check('A reloaded step hydrates the edited timing', newest.clips[29 % 24].out === 240 - 29);
  const usable = reloaded.step(reloaded.undo, reloaded.redo, document(24, 6));
  check('A reloaded step can be undone', usable && usable.restored.clips.length === 24);
}

// --- an incomplete chain is refused, never half-applied --------------------
{
  const history = createHistory();
  history.record(document(), 'Edit');
  const text = history.serialize('signature-2');
  const broken = JSON.parse(text);
  delete broken.takes[Object.keys(broken.takes)[0]];
  const reloaded = createHistory();
  check('A blob missing an archived take is refused', reloaded.load(JSON.stringify(broken)) === 0);
  check('A refused blob leaves no steps', reloaded.undo.length === 0 && reloaded.redo.length === 0);
  check('A corrupt blob is refused', reloaded.load('{"undo":[1,') === 0);
  check('A blob without stacks is refused', reloaded.load('{"project":"x"}') === 0);
}

// --- unchanged detection ----------------------------------------------------
{
  const history = createHistory();
  history.record(document(), 'Edit');
  const snapshot = { undo: history.undo.slice(), redo: history.redo.slice() };
  check('An unchanged stack is recognised', sameStacks(snapshot, history.undo, history.redo));
  history.record(document(), 'Edit 2');
  check('A changed stack is not recognised', !sameStacks(snapshot, history.undo, history.redo));
}

// --- the real project document, when supplied -------------------------------
if (process.argv[2] && fs.existsSync(process.argv[2])) {
  const real = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const history = createHistory();
  const started = performance.now();
  for (let index = 0; index < 40; index++) {
    real.clips[index % real.clips.length].out = Math.max(12, real.clips[index % real.clips.length].out - 1);
    history.record(real, 'Edit ' + index);
  }
  const recordMs = (performance.now() - started) / 40;
  const heap = JSON.stringify(history.undo).length;
  const text = history.serialize('real-signature');
  const reloaded = createHistory();
  const adopted = reloaded.load(text);
  check('The real project keeps many steps after reload', adopted >= 8);
  check('The real project blob fits the budget', text.length <= BUDGET);
  const hydrated = reloaded.hydrate(reloaded.undo.at(-1));
  check(
    'The real project hydrates every take',
    hydrated.clips.every(clip => clip.takes.every(t => t && t.media)),
  );
  console.log(
    'real document: 40 steps in ' +
      recordMs.toFixed(2) +
      ' ms/step, ' +
      (heap / 1e6).toFixed(2) +
      ' MB of entries, blob ' +
      (text.length / 1e6).toFixed(2) +
      ' MB, ' +
      adopted +
      ' steps after reload',
  );
}

console.log(
  'History: entry shape, shared take archive, bounding, record/undo/redo, persistence, reload and refusal passed',
);
console.log(checks.length + ' checks');
