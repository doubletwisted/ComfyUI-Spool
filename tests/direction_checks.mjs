import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../ui/direction.js';
import * as T from '../ui/timeline.js';

// The neighbour rule is shared with spool/requests.py (tests/test_queue_operations.py).
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/neighbours.json', import.meta.url), 'utf8'));
for (const c of fixture.cases) {
  const clip = fixture.clips.find(x => x.id === c.clip);
  for (const side of ['previous', 'next'])
    assert.equal(D.neighbor(fixture, clip, side)?.id ?? null, c[side], c.clip + ' ' + side);
}

// Cuts are touching neighbours; a gap or a transition on either side has none.
assert.deepEqual(D.cuts(fixture), [
  { left: 'a', right: 'b', track: 1 },
  { left: 'x', right: 'y', track: 2 },
]);
assert.deepEqual(D.cuts({ clips: [{ id: 'a' }, { id: 't', direction: { kind: 'transition' } }, { id: 'b' }] }), []);

// Lengths snap to what a workflow accepts.
assert.equal(D.fitSeconds({ min: 4, max: 15 }, 2), 4);
assert.equal(D.fitSeconds({ min: 1, max: 10 }, 2.4), 2);
assert.equal(D.fitSeconds({ options: [2, 3, 4, 5, 6, 8, 10] }, 7), 6);
assert.equal(D.durationValue('5', 3), '3');
assert.equal(D.durationValue(5, 3), 3);

// Aspect follows the source picture, keeping the size class of pixel lists.
const ratios = { options: ['1:1 (Square)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'] };
assert.equal(D.aspectValue(ratios, '1:1 (Square)', 1280, 720), '16:9 (Widescreen)');
assert.equal(D.aspectValue(ratios, '1:1 (Square)', 720, 1280), '9:16 (Portrait Widescreen)');
const sizes = { options: ['1280x720', '720x1280', '1920x1080', '1080x1920'] };
assert.equal(D.aspectValue(sizes, '1920x1080', 1080, 1920), '1080x1920');
assert.equal(D.aspectValue(sizes, '1280x720', 2048, 1152), '1280x720');
assert.equal(D.aspectValue(ratios, '1:1 (Square)', 0, 0), '1:1 (Square)');

// Bindings are found by slot and role.
const found = D.toolBindings([
  { key: 'f', asset: true, slot: 'firstFrame' },
  { key: 'l', asset: true, slot: 'lastFrame' },
  { key: 'r1', asset: true, slot: 'reference' },
  { key: 'r2', asset: true, slot: 'reference' },
  { key: 'p', role: 'positive' },
  { key: 'd', role: 'duration' },
  { key: 'a', role: 'resolution', options: ['16:9 (Widescreen)'] },
  { key: 'm', role: 'resolution' },
]);
assert.deepEqual(
  [
    found.first.key,
    found.last.key,
    found.references.map(b => b.key),
    found.prompt.key,
    found.duration.key,
    found.aspect.map(b => b.key),
  ],
  ['f', 'l', ['r1', 'r2'], 'p', 'd', ['a']],
);

// Prompts say how the clip is anchored and carry the user's direction.
assert.equal(
  D.transitionPrompt('red smoke'),
  'Use the provided start image as the first frame and the provided end image as the last frame. Red smoke. One smooth continuous motion over the whole clip, landing on the last frame only at the very end. Single continuous take: no cuts, no scene changes, no dissolves. The same people, place and light throughout. The sound carries on throughout.',
);
// A motion transition is a timeline around the footage it opens and closes on.
assert.equal(
  D.transitionPrompt('she keeps running', { motion: true, seconds: 141 / 24, middle: [22 / 24, 119 / 24] }),
  [
    'One continuous shot, filmed in a single take with one camera.',
    'Timeline:\n[0s-0.9s] Opens on the footage of the shot before; its movement carries straight on.\n[0.9s-5s] She keeps running.\n[5s-5.9s] Arrives exactly in the opening footage of the next shot.',
    'Single continuous take: no cuts, no scene changes, no dissolves. The same people, place and light throughout.',
    'Audio: the sound carries on throughout.',
  ].join('\n\n'),
);
assert.match(
  D.transitionPrompt('', { motion: true, seconds: 5, middle: [1, 4] }),
  /\[1s-4s\] The movement carries on and the camera travels naturally/,
);
const extended = D.extendPrompt('Use the provided start image as the first frame. A diver swims.', 'she waves');
assert.ok(extended.includes(' She waves.') && extended.endsWith('Earlier in this shot: A diver swims.'), extended);
assert.match(
  D.extendPrompt('', '', { motion: true }),
  /^Continue this shot from its opening frames in one unbroken take/,
);
assert.equal(
  D.recastPrompt('', { character: 'a knight', pictures: 2, place: 'riding through a forest.' }),
  'The character shown in <Picture 1> and <Picture 2> (a knight) is riding through a forest, performing exactly the movement of the pose guide. The plain background of the character pictures is not part of the scene. Natural ambient sound.',
);
assert.match(D.recastPrompt('', { style: 'plain' }), /^The character shown in Image 1 performing exactly/);
assert.equal(
  D.placeFrom('Use the provided start image as the first frame. A diver swims in a cave. Bubbles rise.'),
  'A diver swims in a cave',
);
assert.equal(D.placeFrom(''), '');
assert.equal(new Set(D.TRANSITIONS.map(p => p.id)).size, D.TRANSITIONS.length);
assert.deepEqual(Object.keys(D.KINDS), ['transition', 'extend', 'recast']);
assert.equal(D.directionLabel({ kind: 'transition', preset: 'smoke' }), 'Transition');
assert.equal(D.directionLabel({ kind: 'extend' }), 'Extension');
assert.equal(D.directionLabel({ kind: 'unknown' }), '');

// Motion inputs are found by the end of the clip they read.
const motion = D.toolBindings([
  { key: 'b', asset: true, slot: 'video', span: { edge: 'end', frames: 22 } },
  { key: 'a', asset: true, slot: 'video', span: { edge: 'start', frames: 22 } },
  { key: 'v', asset: true, slot: 'video' },
]);
assert.deepEqual([motion.before.key, motion.after.key, motion.video.key], ['b', 'a', 'v']);

// Use take starts a directed clip after its anchored frames, as spool/operations.py does.
const directed = JSON.parse(fs.readFileSync(new URL('./fixtures/directed_takes.json', import.meta.url), 'utf8'));
for (const c of directed.cases) {
  const clip = structuredClone(directed.clip),
    t = c.take;
  clip.takes = [
    { id: 'none', placeholder: true, media: { frames: clip.out } },
    {
      id: t.id,
      generated: t.generated,
      media: { frames: t.frames },
      ...(t.generated ? { summary: { workflowVersion: t.workflowVersion } } : {}),
    },
  ];
  clip.takeId = 'none';
  T.chooseTake({ clips: [clip] }, clip.id, t.id);
  assert.equal(clip.in, c.in, c.name);
}

// A motion workflow's take is 17k + 5 frames long, and shows its middle.
assert.deepEqual(D.motionLength(2, 22, 22), { total: 90, visible: 46, seconds: 90 / 24 });
assert.deepEqual(D.motionLength(5, 22, 0), { total: 141, visible: 119, seconds: 141 / 24 });
assert.equal(D.motionLength(0.1, 22, 22).visible >= 12, true);
console.log('direction checks passed');
