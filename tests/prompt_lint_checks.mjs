import assert from 'node:assert/strict';
import { lintPrompt } from '../ui/prompt-lint.js';

const messages = (text, context) => lintPrompt(text, context).map(f => f.level + ': ' + f.message);
assert.deepEqual(messages('   '), ['warn: The prompt is empty.']);
assert.deepEqual(messages('A diver swims past the reef while bubbles rise.', { audio: true }), []);
const cast = [{ id: 'm', name: 'Mara', images: ['m.png'] }];
assert.match(messages('@Mara meets @Otto.', { cast })[0], /@Otto is not in the cast/);
assert.match(
  messages('<Picture 3> walks into <Video 1>.', { references: true, pictures: 2, videos: 0 }).join('\n'),
  /picture 3 but only 2 are set[\s\S]*video 1 but no reference video/,
);
assert.deepEqual(messages('Image 1 walks.', { references: false }), []);
assert.match(messages('masterpiece, 8k, a cat', {})[0], /“masterpiece”, “8k”/);
assert.match(messages('A street with no cars', {})[0], /“no cars”/);
assert.deepEqual(messages('A street with no cars', { negative: true }), []);
// Editing instructions are followed, so they pass; a thing named after them still warns.
assert.deepEqual(messages('One take: no cuts, no dissolves. She waves to the sound of waves.', {}), []);
assert.match(messages('No cuts, no cars.', {})[0], /“no cars”/);
assert.match(messages('CUT 1: a door. CUT 2: a hall. CUT 3: a room.', { seconds: 5 })[0], /4 shots in 5 s/);
assert.match(messages('The camera pans, then tilts, then orbits and dollies.', {})[0], /Several camera moves/);
assert.match(messages('A quiet empty hall.', { audio: true }).join(''), /^$/);
assert.match(messages('An empty hall.', { audio: true })[0], /Say what we hear/);
assert.ok(messages(Array(230).fill('word').join(' '))[0].startsWith('warn: 230 words'));
console.log('prompt lint checks passed');
