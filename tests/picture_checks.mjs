// What the viewer shows at a frame, without a browser or decoders.
// node tests/picture_checks.mjs
import {pictureAt} from '../ui/picture.js';

const checks = [];
const check = (label, ok) => { if (!ok) throw Error(label); checks.push(label); };
const take = (id, frames) => ({id, media: {id: id + '-media', kind: 'video', frames}});
const clip = (id, extra = {}) => ({id, in: 10, out: 34, takes: [take(id + '-a', 100), take(id + '-b', 15)], takeId: id + '-a', ...extra});
const edit = {mode: 'edit', source: null, audition: null};

{
  const doc = {clips: [clip('one'), clip('two', {gapBefore: 6})], audioClips: []};
  const first = pictureAt(doc, edit, 5);
  check('A clip shows its chosen take at its trimmed source frame', first.clipId === 'one' && first.take.id === 'one-a' && first.frame === 15 && first.length === 54);
  check('The next clip is known for transition hints', first.next.clip.id === 'two');
  const gap = pictureAt(doc, edit, 26);
  check('A gap shows no take and names the next clip', gap.gap && gap.media.kind === 'gap' && gap.next.clip.id === 'two');
  check('A frame past the end shows the last frame', pictureAt(doc, edit, 999).frame === 33 && pictureAt(doc, edit, 999).clipId === 'two');
  check('An empty sequence shows nothing', pictureAt({clips: [], audioClips: []}, edit, 0) === null);
}

{
  const doc = {clips: [clip('base'), clip('cover', {videoTrack: 2})], audioClips: []};
  check('A higher video track covers a lower one', pictureAt(doc, edit, 3).clipId === 'cover');
  check('A disabled track reveals the clip below', pictureAt({...doc, disabledVideoTracks: [2]}, edit, 3).clipId === 'base');
  doc.clips[1].enabled = false;
  check('A disabled clip reveals the clip below', pictureAt(doc, edit, 3).clipId === 'base');
}

{
  const doc = {clips: [clip('one')], audioClips: []};
  const trying = pictureAt(doc, {mode: 'edit', audition: {clipId: 'one', takeId: 'one-b'}}, 20);
  check('Trying a take in the edit replaces the chosen take only in the viewer', trying.take.id === 'one-b' && doc.clips[0].takeId === 'one-a');
  check('A shorter take clamps the source frame to its last frame', trying.frame === 14);
  const media = {id: 'loose', kind: 'image', frames: 1};
  const source = pictureAt(doc, {mode: 'source', source: {media: doc.clips[0].takes[0].media, clipId: 'one', takeId: 'one-a'}, frame: 500, length: 100}, 0);
  check('Source shows the reviewed take with its own playhead', source.take.id === 'one-a' && source.clip.id === 'one' && source.frame === 99 && source.length === 100);
  const loose = pictureAt(doc, {mode: 'source', source: {media}, frame: 0, length: 1}, 0);
  check('Source can show media that belongs to no clip', loose.media === media && loose.clip === null);
}

console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
