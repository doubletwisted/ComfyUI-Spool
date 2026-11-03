// What the viewer shows at a frame, without a browser or decoders.
// node tests/picture_checks.mjs
import { pictureAt } from '../ui/picture.js';
import { exportPlan, timelinePlan } from '../ui/timeline.js';

const checks = [];
const check = (label, ok) => {
  if (!ok) throw Error(label);
  checks.push(label);
};
const take = (id, frames) => ({ id, media: { id: id + '-media', kind: 'video', frames } });
const clip = (id, extra = {}) => ({
  id,
  in: 10,
  out: 34,
  takes: [take(id + '-a', 100), take(id + '-b', 15)],
  takeId: id + '-a',
  ...extra,
});
const edit = { mode: 'edit', source: null, audition: null };

{
  const doc = { clips: [clip('one'), clip('two', { gapBefore: 6 })], audioClips: [] };
  const first = pictureAt(doc, edit, 5);
  check(
    'A clip shows its chosen take at its trimmed source frame',
    first.clipId === 'one' && first.take.id === 'one-a' && first.frame === 15 && first.length === 54,
  );
  check('The next clip is known for transition hints', first.next.clip.id === 'two');
  const gap = pictureAt(doc, edit, 26);
  check(
    'A gap shows no take and names the next clip',
    gap.gap && gap.media.kind === 'gap' && gap.next.clip.id === 'two',
  );
  check(
    'A frame past the end shows the last frame',
    pictureAt(doc, edit, 999).frame === 33 && pictureAt(doc, edit, 999).clipId === 'two',
  );
  check('An empty sequence shows nothing', pictureAt({ clips: [], audioClips: [] }, edit, 0) === null);
}

{
  const doc = { clips: [clip('base'), clip('cover', { videoTrack: 2 })], audioClips: [] };
  check('A higher video track covers a lower one', pictureAt(doc, edit, 3).clipId === 'cover');
  check(
    'A disabled track reveals the clip below',
    pictureAt({ ...doc, disabledVideoTracks: [2] }, edit, 3).clipId === 'base',
  );
  doc.clips[1].enabled = false;
  check('A disabled clip reveals the clip below', pictureAt(doc, edit, 3).clipId === 'base');
}

{
  const doc = { clips: [clip('one')], audioClips: [] };
  const trying = pictureAt(doc, { mode: 'edit', audition: { clipId: 'one', takeId: 'one-b' } }, 20);
  check(
    'Trying a take in the edit replaces the chosen take only in the viewer',
    trying.take.id === 'one-b' && doc.clips[0].takeId === 'one-a',
  );
  check('A shorter take clamps the source frame to its last frame', trying.frame === 14);
  const media = { id: 'loose', kind: 'image', frames: 1 };
  const source = pictureAt(
    doc,
    {
      mode: 'source',
      source: { media: doc.clips[0].takes[0].media, clipId: 'one', takeId: 'one-a' },
      frame: 500,
      length: 100,
    },
    0,
  );
  check(
    'Source shows the reviewed take with its own playhead',
    source.take.id === 'one-a' && source.clip.id === 'one' && source.frame === 99 && source.length === 100,
  );
  const loose = pictureAt(doc, { mode: 'source', source: { media }, frame: 0, length: 1 }, 0);
  check('Source can show media that belongs to no clip', loose.media === media && loose.clip === null);
}

{
  // An extension's joined copy (spool/joins.py) takes over its shot's last `blend` frames.
  const joined = () => ({
    id: 'joined',
    kind: 'video',
    file: 'joined.mp4',
    frames: 60,
    overlap: 22,
    blend: 2,
    drift: 1,
    parent: { clipId: 'shot', takeId: 'shot-a', in: 0, out: 50 },
  });
  const make = () => ({
    clips: [
      {
        id: 'shot',
        in: 0,
        out: 50,
        takeId: 'shot-a',
        takes: [{ id: 'shot-a', media: { id: 's', kind: 'video', file: 'shot.mp4', frames: 50 } }],
      },
      {
        id: 'more',
        in: 22,
        out: 60,
        takeId: 'more-a',
        direction: { kind: 'extend', parent: 'shot', head: 22 },
        takes: [
          {
            id: 'more-a',
            generated: true,
            media: { id: 'm', kind: 'video', file: 'more.mp4', frames: 60, join: joined() },
          },
        ],
      },
    ],
    audioClips: [],
  });
  const doc = make(),
    at = f => pictureAt(doc, edit, f);
  check('The shot plays until its last frames', at(47).clipId === 'shot' && at(47).frame === 47);
  check(
    'Its last frames come from the joined copy, which dissolves out of them',
    at(48).clipId === 'more' && at(48).media.file === 'joined.mp4' && at(48).frame === 20 && at(49).frame === 21,
  );
  check('The extension then plays its joined copy', at(50).media.file === 'joined.mp4' && at(50).frame === 22);
  check(
    'The MP4 export cuts to the joined copy at the same frame',
    JSON.stringify(exportPlan(doc).clips) ===
      JSON.stringify([
        { file: 'shot.mp4', in: 0, out: 48 },
        { file: 'joined.mp4', in: 20, out: 60 },
      ]),
  );
  const [v1] = timelinePlan(doc).tracks;
  check(
    'The editable export starts the joined copy over the end of its shot',
    v1.clips[0].out === 48 &&
      v1.clips[1].start === 48 &&
      v1.clips[1].in === 20 &&
      v1.clips[1].out === 60 &&
      v1.clips[1].file === 'joined.mp4',
  );
  const trimmed = make();
  trimmed.clips[0].out = 49;
  check(
    'A shot trimmed since the extension was made gets a plain cut to the take as rendered',
    pictureAt(trimmed, edit, 47).clipId === 'shot' && pictureAt(trimmed, edit, 49).media.file === 'more.mp4',
  );
  const retrimmed = make();
  retrimmed.clips[1].in = 24;
  check(
    'An extension trimmed past its join plays as rendered',
    pictureAt(retrimmed, edit, 50).media.file === 'more.mp4',
  );
  const moved = make();
  moved.clips[1].gapBefore = 4;
  check('A detached extension plays as rendered', pictureAt(moved, edit, 54).media.file === 'more.mp4');
}

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
