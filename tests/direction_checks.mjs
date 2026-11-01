import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as D from '../ui/direction.js';

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

// Prompts carry the frame instruction, the preset and the user's direction.
const smoke = D.TRANSITIONS.find(p => p.id === 'smoke');
assert.equal(
  D.transitionPrompt(smoke, 'red smoke'),
  'Use the provided start image as the first frame and the provided end image as the last frame. ' +
    smoke.prompt +
    ' red smoke. One smooth continuous motion over the whole clip, landing on the last frame only at the very end, with a soft whoosh of sound.',
);
const extended = D.extendPrompt('Use the provided start image as the first frame. A diver swims.', 'she waves');
assert.ok(extended.includes(' she waves.') && extended.endsWith('Earlier in this shot: A diver swims.'), extended);
assert.equal(D.toolFor('recast'), 'recast');
assert.equal(D.toolFor('effect'), 'rework');
assert.equal(D.toolFor('transition'), 'transition');
assert.equal(
  D.reworkPrompt('recast', null, '', { character: 'a knight', pictures: 2, place: 'riding through a forest.' }),
  'The character shown in <Picture 1> and <Picture 2> (a knight) is riding through a forest, performing exactly the movement of the pose guide. The plain background of the character pictures is not part of the scene. Natural ambient sound.',
);
assert.match(
  D.reworkPrompt('recast', null, '', { style: 'plain' }),
  /^The character shown in Image 1 performing exactly/,
);
assert.equal(
  D.placeFrom('Use the provided start image as the first frame. A diver swims in a cave. Bubbles rise.'),
  'A diver swims in a cave',
);
assert.equal(D.placeFrom(''), '');
assert.match(D.reworkPrompt('reangle', D.ANGLES[0]), /from a low angle/);
assert.match(D.reworkPrompt('effect', D.EFFECTS[0]), /^Add heavy rain.* in <Video 1>\./);
for (const list of [D.TRANSITIONS, D.ANGLES, D.EFFECTS]) assert.equal(new Set(list.map(p => p.id)).size, list.length);
assert.equal(D.directionLabel({ kind: 'transition', preset: 'smoke' }), 'Smoke');
assert.equal(D.directionLabel({ kind: 'extend' }), 'Extension');
assert.equal(D.directionLabel({ kind: 'unknown' }), '');
console.log('direction checks passed');
