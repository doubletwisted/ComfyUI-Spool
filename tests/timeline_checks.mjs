import assert from 'node:assert/strict';
import * as T from '../ui/timeline.js';
const checks = [],
  check = (label, test) => {
    test();
    checks.push(label);
  };
const copy = v => JSON.parse(JSON.stringify(v));
const clip = (id, inside = 12, out = 60, frames = 96) => ({
  id,
  name: id,
  in: inside,
  out,
  takeId: id + '-take',
  takes: [{ id: id + '-take', media: { file: id + '.mp4', frames, audio: true } }],
});
const doc = () => ({ project: 'QA', clips: [clip('a'), clip('b'), clip('c')], tailGap: 0, audioClips: [] });
const edit = (d, id, kind, mode, delta, options = {}) =>
  T.applyEdit(d, T.beginEdit(d, { id, kind, mode, ...options }), delta);
check('Out trim preserves following position with a gap', () => {
  const d = doc(),
    start = T.rowFor(d, 'b').start;
  assert.equal(edit(d, 'a', 'out', 'trim', -15), -15);
  assert.equal(d.clips[0].out, 45);
  assert.equal(d.clips[1].gapBefore, 15);
  assert.equal(T.rowFor(d, 'b').start, start);
});
check('In trim converts removed frames into gapBefore', () => {
  const d = doc();
  edit(d, 'b', 'in', 'trim', 10);
  assert.equal(d.clips[1].in, 22);
  assert.equal(d.clips[1].gapBefore, 10);
  assert.equal(T.rowFor(d, 'c').start, 96);
});
check('Trim extension stops at the initial following gap', () => {
  const d = doc();
  d.clips[1].gapBefore = 8;
  const s = T.beginEdit(d, { id: 'a', kind: 'out', mode: 'trim' });
  assert.equal(T.applyEdit(d, s, 30), 8);
  assert.equal(T.applyEdit(d, s, 20), 8);
  assert.equal(d.clips[0].out, 68);
  assert.equal(d.clips[1].gapBefore, 0);
});
check('Trim extension stops at source frames', () => {
  const d = doc();
  d.clips[1].gapBefore = 90;
  assert.equal(edit(d, 'a', 'out', 'trim', 100), 36);
  assert.equal(d.clips[0].out, 96);
  assert.equal(d.clips[1].gapBefore, 54);
});
check('Tail trim leaves no new gap unless tail gap already exists', () => {
  const d = doc();
  edit(d, 'c', 'out', 'trim', -12);
  assert.equal(d.tailGap, 0);
  d.tailGap = 10;
  edit(d, 'c', 'out', 'trim', -4);
  assert.equal(d.tailGap, 14);
});
check('Ripple trim moves following clips without leaving a gap', () => {
  const d = doc();
  edit(d, 'a', 'out', 'ripple', -12);
  assert.equal(T.rowFor(d, 'b').start, 36);
  assert.equal(T.gapAfter(d, 0), 0);
});
check('In trim cannot extend across a preceding touching clip', () => {
  const d = doc();
  assert.equal(Math.abs(edit(d, 'b', 'in', 'trim', -8)), 0);
  d.clips[1].gapBefore = 5;
  assert.equal(edit(d, 'b', 'in', 'trim', -8), -5);
});
check('Alt roll requires a shared edge; otherwise it is a trim', () => {
  const d = doc();
  assert.equal(T.resolveGesture(d, { id: 'a', edge: 'out', shared: true }, { alt: true }).mode, 'roll');
  assert.equal(T.resolveGesture(d, { id: 'a', edge: 'out', shared: false }, { alt: true }).mode, 'trim');
  assert.equal(T.resolveGesture(d, { id: 'a', edge: 'out', shared: true }, { alt: true, shift: true }).mode, 'ripple');
});
check('Alt copies clip bodies while source-edit modifiers retain precedence', () => {
  const d = doc();
  assert.deepEqual(T.resolveGesture(d, { id: 'a' }, { alt: true }), { kind: 'move', mode: 'copy' });
  assert.equal(T.resolveGesture(d, { id: 'a' }, { alt: true, s: true }).mode, 'slip');
  assert.equal(T.resolveGesture(d, { id: 'b' }, { alt: true, d: true }).mode, 'slide');
  d.audioClips = [{ id: 'sound' }];
  assert.equal(T.resolveGesture(d, { id: 'sound', audio: true }, { alt: true }).mode, 'copy');
});
check('Roll preserves total duration and changes both source edges', () => {
  const d = doc(),
    length = T.total(d);
  assert.equal(edit(d, 'a', 'out', 'roll', 8), 8);
  assert.equal(d.clips[0].out, 68);
  assert.equal(d.clips[1].in, 20);
  assert.equal(T.total(d), length);
});
check('Roll respects six-frame minimum on both sides', () => {
  const d = doc();
  assert.equal(edit(d, 'a', 'out', 'roll', 100), 36);
  assert.equal(d.clips[1].out - d.clips[1].in, 12);
  const d2 = doc();
  assert.equal(edit(d2, 'b', 'in', 'roll', -100), -12);
  assert.equal(d2.clips[1].in, 0);
});
check('Roll is blocked by missing spare source frames', () => {
  const d = doc();
  d.clips[1].in = 0;
  assert.equal(Math.abs(edit(d, 'a', 'out', 'roll', -20)), 0);
});
check('Slip clamps to both source boundaries', () => {
  const d = doc();
  assert.equal(edit(d, 'b', 'slip', 'slip', -100), -12);
  assert.equal(d.clips[1].in, 0);
  assert.equal(edit(d, 'b', 'slip', 'slip', 100), 48);
  assert.equal(d.clips[1].out, 96);
});
check('Slide requires touching neighbors and keeps exact blocked message', () => {
  const d = doc();
  assert.equal(T.resolveGesture(d, { id: 'a' }, { d: true }).blocked, 'Slide needs touching clips on both sides.');
  d.clips[1].gapBefore = 1;
  assert.equal(T.resolveGesture(d, { id: 'b' }, { d: true }).blocked, 'Slide needs touching clips on both sides.');
});
check('Slide clamps by both neighbor source ranges', () => {
  const d = doc(),
    length = T.total(d);
  assert.equal(edit(d, 'b', 'slide', 'slide', 100), 36);
  assert.equal(d.clips[0].out, 96);
  assert.equal(d.clips[2].in, 48);
  assert.equal(T.total(d), length);
});
check('Split rejects a cut fewer than six frames from an edge', () => {
  const d = doc();
  assert.ok(T.splitClip(d, 5, 'new').error);
  assert.ok(T.splitClip(d, 43, 'new').error);
  assert.equal(d.clips.length, 3);
});
check('Split follows playhead source, preserves lineage and resets linked fades', () => {
  const d = doc();
  d.clips[1].takeSourceIds = ['ancestor'];
  d.clips[1].takeOwnerId = 'owner';
  d.clips[1].audio = { fadeIn: 4, fadeOut: 5 };
  const { clip: c } = T.splitClip(d, 60, 'new');
  assert.deepEqual(c.takeSourceIds, ['b', 'ancestor', 'owner']);
  assert.equal(c.in, 24);
  assert.equal(d.clips[1].out, 24);
  assert.equal(c.audio.fadeIn, 0);
  assert.equal(d.clips[1].audio.fadeOut, 0);
});
check('Duplicate of duplicate carries every lineage source', () => {
  const d = doc();
  d.clips[0].takeSourceIds = ['root'];
  d.clips[0].takeOwnerId = 'owner';
  const c = T.duplicateClip(d, 'a', 'copy');
  const next = T.duplicateClip(d, c.id, 'copy2');
  assert.deepEqual(next.takeSourceIds, ['copy', 'a', 'root', 'owner']);
  assert.equal(next.gapBefore, 0);
});
check('Normal delete preserves space and returns next selection', () => {
  const d = doc();
  d.clips[1].gapBefore = 3;
  assert.equal(T.removeClip(d, 'b'), 'c');
  assert.equal(d.clips[1].gapBefore, 51);
  assert.equal(T.rowFor(d, 'c').start, 99);
});
check('Ripple delete closes duration while preserving pre-existing gap', () => {
  const d = doc();
  d.clips[1].gapBefore = 3;
  T.removeClip(d, 'b', { ripple: true });
  assert.equal(d.clips[1].gapBefore, 3);
  assert.equal(T.rowFor(d, 'c').start, 51);
});
check('Close gap handles inner and tail gaps with no-op result', () => {
  const d = doc();
  d.clips[1].gapBefore = 8;
  d.tailGap = 12;
  assert.equal(T.closeGap(d, 1), true);
  assert.equal(T.closeGap(d, 3), true);
  assert.equal(T.closeGap(d, 3), false);
});
check('Shorter chosen take clamps trims and compensates following gap', () => {
  const d = doc();
  d.clips[0].takes.push({ id: 'short', media: { frames: 20 } });
  assert.deepEqual(T.chooseTake(d, 'a', 'short'), { changed: true, addedGap: 28 });
  assert.deepEqual([d.clips[0].in, d.clips[0].out, d.clips[1].gapBefore], [0, 20, 28]);
  assert.equal(T.chooseTake(d, 'a', 'short').changed, false);
});
check('Clip placement and first-match snapping preserve existing order', () => {
  const d = doc();
  assert.equal(T.dropIndex(d, 30), 1);
  assert.equal(T.dropIndex(d, 90, 'b'), 1);
  assert.equal(T.snap([10, 12], 11, 2), 10);
  assert.equal(T.snap([10], 12, 2), 12);
  T.moveClip(d, 'a', 2);
  assert.deepEqual(
    d.clips.map(c => c.id),
    ['b', 'c', 'a'],
  );
});
const bed = (id, start, inside = 12, out = 60) => ({
  id,
  name: id,
  start,
  in: inside,
  out,
  media: { frames: 96, file: id + '.wav' },
});
check('Nearest free soundtrack placement avoids overlaps', () => {
  const d = doc();
  d.audioClips = [bed('music', 20, 0, 30)];
  assert.equal(T.freeAudioStart(d, 25, 10), 10);
  assert.equal(T.freeAudioStart(d, 45, 10), 50);
  assert.equal(T.freeAudioStart(d, 25, 10, 'music'), 25);
});
check('Soundtrack roll moves neighbor start and retains its end', () => {
  const d = doc();
  d.audioClips = [bed('x', 0), bed('y', 48)];
  const peer = T.audioNeighbor(d, d.audioClips[0], 'out');
  assert.equal(edit(d, 'x', 'out', 'roll', 8, { audio: true, edge: 'out', peer }), 8);
  assert.equal(d.audioClips[1].start, 56);
  assert.equal(d.audioClips[1].in, 20);
  assert.equal(T.total(d), 144);
});
check('Soundtrack in trim is bounded by previous clip', () => {
  const d = doc();
  d.audioClips = [bed('x', 0, 0, 20), bed('y', 24)];
  assert.equal(edit(d, 'y', 'in', 'trim', -10, { audio: true }), -4);
  assert.equal(d.audioClips[1].start, 20);
});
check('Soundtrack snapping uses captured frame tolerance', () => {
  const d = doc();
  d.audioClips = [bed('x', 60, 0, 10)];
  assert.equal(edit(d, 'x', 'move', 'move', -11, { audio: true, snapEnabled: true, snapTolerance: 2 }), -12);
  assert.equal(d.audioClips[0].start, 48);
});
check('Soundtrack add, split, duplicate and remove preserve source ranges', () => {
  const d = doc(),
    c = T.addAudioClip(d, { name: 'song.wav', file: 'song.wav', frames: 240 }, 0, 'song');
  assert.equal(c.out, 144);
  const split = T.splitAudio(d, 24, 'part', 'song');
  assert.equal(split.in, 24);
  assert.equal(split.start, 24);
  const dup = T.duplicateAudio(d, 'song', 'copy');
  assert.equal(dup.start, 144);
  T.removeAudio(d, 'copy');
  assert.equal(d.audioClips.length, 2);
});
check('Soundtrack gestures remain independent', () => {
  const d = doc();
  d.audioClips = [bed('x', 0)];
  assert.equal(
    T.resolveGesture(d, { id: 'x', audio: true }, { d: true }).blocked,
    'Soundtrack stays independent. Move or slip it directly.',
  );
});
check('Export fills video gaps and soundtrack tail with black frames', () => {
  const d = doc();
  d.clips[1].gapBefore = 9;
  d.tailGap = 7;
  d.audioClips = [bed('music', 170, 0, 30)];
  const p = T.exportPlan(d);
  assert.deepEqual(
    p.clips.filter(c => c.file === 'assets/black.png').map(c => c.out),
    [9, 47],
  );
  assert.equal(p.audio, true);
});
check('Export drops muted clips and respects track mute and solo', () => {
  const d = doc();
  d.clips[0].audio = { muted: true };
  d.audioClips = [bed('music', 0)];
  assert.equal(T.exportPlan(d).audioClips.length, 3);
  d.audioTracks = { musicSolo: true };
  assert.deepEqual(
    T.exportPlan(d).audioClips.map(c => c.file),
    ['music.wav'],
  );
  d.audioTracks = { musicMuted: true };
  assert.deepEqual(
    T.exportPlan(d).audioClips.map(c => c.file),
    ['b.mp4', 'c.mp4'],
  );
});
check('Audio fade envelope and take readers retain defaults', () => {
  const c = clip('a');
  c.audio = { fadeIn: 12, fadeOut: 12, gainDb: 0 };
  assert.equal(T.audioEnvelope(c, 6), 0.5);
  assert.equal(T.audioEnvelope(c, 42), 0.5);
  c.takes.unshift({ id: 'placeholder', placeholder: true });
  assert.equal(T.takeOf(c).id, 'a-take');
  assert.equal(T.realTakes(c).length, 1);
});
check('Edit session owns an independent initial snapshot', () => {
  const d = doc(),
    s = T.beginEdit(d, { id: 'a', kind: 'out', mode: 'trim' }),
    before = copy(s.before);
  T.applyEdit(d, s, -10);
  assert.deepEqual(s.before, before);
  assert.equal(s.original.out, 60);
});
check('Unlink preserves exact mix, source range, level and fades without changing the take', () => {
  const d = doc(),
    c = d.clips[1];
  c.gapBefore = 9;
  c.audio = { gainDb: -3, muted: false, fadeIn: 6, fadeOut: 8 };
  const before = copy(T.exportPlan(d)),
    takes = copy(c.takes);
  const a = T.unlinkAudio(d, 'b', 'detached');
  assert.equal(a.track, 'source');
  assert.deepEqual([a.start, a.in, a.out], [57, 12, 60]);
  assert.deepEqual(a.audio, c.audio);
  assert.equal(a.media.kind, 'audio');
  assert.deepEqual(c.takes, takes);
  assert.equal(c.audioDetached, true);
  const sort = p => p.audioClips.sort((a, b) => a.start - b.start);
  assert.deepEqual(sort(T.exportPlan(d)), sort(before));
  assert.equal(T.unlinkAudio(d, 'b', 'repeat'), null);
  assert.equal(d.audioClips.length, 1);
});
check('Detached audio survives video edits, take changes, splits, duplication and deletion', () => {
  const d = doc(),
    a = T.unlinkAudio(d, 'a', 'detached'),
    before = copy(a);
  edit(d, 'a', 'slip', 'slip', 10);
  edit(d, 'a', 'out', 'ripple', -12);
  d.clips[0].takes.push({ id: 'different', media: { frames: 96, file: 'different.mp4', audio: true } });
  T.chooseTake(d, 'a', 'different');
  T.splitClip(d, 18, 'split');
  const c = T.duplicateClip(d, 'a', 'dup');
  assert.equal(c.audioDetached, true);
  T.removeClip(d, 'a', { ripple: true });
  assert.deepEqual(a, before);
  assert.deepEqual(
    T.exportPlan(d)
      .audioClips.filter(c => ['a.mp4', 'different.mp4'].includes(c.file))
      .map(c => c.file),
    ['a.mp4'],
  );
});
check('Audio tracks have separate placement, trim and roll neighbors', () => {
  const d = doc();
  d.audioClips = [bed('music', 0, 0, 144)];
  const a = T.unlinkAudio(d, 'a', 'detached');
  assert.equal(T.freeAudioStart(d, 0, 48, 'detached', 'source'), 0);
  assert.equal(T.audioNeighbor(d, a, 'out'), undefined);
  assert.equal(edit(d, 'detached', 'out', 'trim', 20, { audio: true }), 0);
  assert.equal(edit(d, 'detached', 'in', 'trim', 10, { audio: true }), 10);
  assert.equal(edit(d, 'detached', 'move', 'move', -10, { audio: true }), -10);
  const dup = T.duplicateAudio(d, 'detached', 'copy');
  assert.equal(dup.track, 'source');
  assert.equal(dup.start, 144);
  assert.deepEqual(d.audioClips[0], bed('music', 0, 0, 144));
});
check('Detached A1 audio respects source track mute and solo, separately from A2', () => {
  const d = doc();
  T.unlinkAudio(d, 'a', 'detached');
  d.audioClips.push(bed('music', 0));
  d.audioTracks = { sourceMuted: true };
  assert.deepEqual(
    T.exportPlan(d).audioClips.map(c => c.file),
    ['music.wav'],
  );
  d.audioTracks = { sourceSolo: true };
  assert.deepEqual(
    T.exportPlan(d)
      .audioClips.map(c => c.file)
      .sort(),
    ['a.mp4', 'b.mp4', 'c.mp4'],
  );
  d.audioTracks = { musicSolo: true };
  assert.deepEqual(
    T.exportPlan(d).audioClips.map(c => c.file),
    ['music.wav'],
  );
});
check('Use audio only creates independent full-length sound from video; silent video is rejected', () => {
  const d = doc(),
    m = { kind: 'video', audio: true, name: 'video.mp4', file: 'video.mp4', frames: 240, wave: 'wave.png' },
    before = copy(m),
    a = T.addAudioClip(d, m, 0, 'sound', { fullLength: true });
  assert.equal(a.media.kind, 'audio');
  assert.deepEqual(m, before);
  assert.equal(a.out, 240);
  assert.equal(a.media.file, m.file);
  assert.equal(d.clips.length, 3);
  assert.equal(T.addAudioClip(d, { ...m, audio: false }, 0, 'silent'), null);
  assert.equal(d.audioClips.length, 1);
  const separate = doc();
  T.unlinkAudio(separate, 'a', 'detached');
  assert.equal(T.addAudioClip(separate, m, 0, 'source', { track: 'source', fullLength: true }).start, 144);
});
check('Unlink rejects silent, missing and placeholder clips', () => {
  const d = doc();
  d.clips[0].takes[0].media.audio = false;
  d.clips[1].takes[0].placeholder = true;
  assert.equal(T.unlinkAudio(d, 'a', 'silent'), null);
  assert.equal(T.unlinkAudio(d, 'b', 'placeholder'), null);
  assert.equal(T.unlinkAudio(d, 'missing', 'missing'), null);
  assert.equal(d.audioClips.length, 0);
});
check('Group move preserves spacing, source ranges and unselected positions', () => {
  const d = doc(),
    before = copy(d),
    geometry = d.clips.map(c => [c.id, c.in, c.out, c.takeId]);
  assert.equal(T.moveGroup(d, before, ['a', 'c'], 200), 200);
  assert.equal(T.rowFor(d, 'a').start, 200);
  assert.equal(T.rowFor(d, 'c').start, 296);
  assert.equal(T.rowFor(d, 'b').start, 48);
  assert.deepEqual(d.clips.map(c => [c.id, c.in, c.out, c.takeId]).sort(), geometry.sort());
  assert.equal(T.total(d), 344);
  assert.deepEqual(before, doc());
});
check('Group move stops at occupied track and timeline start', () => {
  const d = doc(),
    before = copy(d);
  assert.equal(T.moveGroup(d, before, ['a', 'b'], 12), 0);
  assert.deepEqual(d, before);
  assert.equal(T.moveGroup(d, before, ['a', 'b'], -100), 0);
  assert.deepEqual(d, before);
  assert.equal(T.moveGroup(d, before, ['a', 'b'], 100), 144);
  assert.equal(T.rowFor(d, 'c').start, 96);
});
check('Repeated group move uses the initial snapshot and preserves arriving takes', () => {
  const d = doc(),
    before = copy(d);
  d.clips[0].takes.push({ id: 'arrival', generated: true, media: { frames: 96 } });
  T.moveGroup(d, before, ['a', 'c'], 200);
  T.moveGroup(d, before, ['a', 'c'], 0);
  assert.deepEqual(
    T.layout(d).map(r => [r.clip.id, r.start]),
    [
      ['a', 0],
      ['b', 48],
      ['c', 96],
    ],
  );
  assert.equal(d.clips[0].takes[1].id, 'arrival');
});
check('Audio group move keeps relative offsets and avoids same-track collisions', () => {
  const d = doc();
  d.audioClips = [bed('x', 20, 0, 12), bed('fixed', 50, 0, 12), bed('y', 80, 0, 12)];
  const before = copy(d);
  assert.equal(T.moveGroup(d, before, ['x', 'y'], 10), 10);
  assert.deepEqual(
    d.audioClips.map(c => c.start),
    [30, 50, 90],
  );
  assert.equal(T.moveGroup(d, before, ['x', 'y'], 35), 42);
  assert.deepEqual(
    d.audioClips.map(c => c.start),
    [62, 50, 122],
  );
  assert.deepEqual(d.clips, before.clips);
});
check('Mixed video/audio group remains aligned while A2 stays fixed', () => {
  const d = doc();
  T.unlinkAudio(d, 'a', 'detached');
  d.audioClips.push(bed('music', 0, 0, 96));
  const before = copy(d);
  assert.equal(T.moveGroup(d, before, ['a', 'detached'], 200), 200);
  assert.equal(T.rowFor(d, 'a').start, 200);
  assert.equal(d.audioClips[0].start, 200);
  assert.equal(d.audioClips[1].start, 0);
  assert.equal(T.rowFor(d, 'b').start, 48);
  T.moveGroup(d, before, ['a', 'detached'], 0);
  assert.deepEqual(d, before);
});
check('Group movement includes linked A1 sound in occupied-track checks', () => {
  const d = doc();
  d.audioClips = [{ ...bed('fixed', 160, 0, 48), track: 'source' }];
  const before = copy(d);
  assert.equal(T.moveGroup(d, before, ['a', 'b'], 160), 208);
  assert.equal(T.rowFor(d, 'a').start, 208);
  assert.equal(d.audioClips[0].start, 160);
});
check('Dragged copies retain original geometry and use the captured position on every frame', () => {
  const d = doc(),
    before = copy(d);
  d.clips.push({ ...copy(d.clips[0]), id: 'copy' });
  const options = { copies: { a: 'copy' } };
  assert.equal(T.moveGroup(d, before, ['copy'], 200, 1, options), 200);
  assert.equal(T.rowFor(d, 'copy').start, 200);
  assert.deepEqual(
    d.clips.filter(c => c.id !== 'copy'),
    before.clips,
  );
  assert.equal(T.moveGroup(d, before, ['copy'], 0, 1, options), 144);
  assert.equal(T.rowFor(d, 'copy').start, 144);
  assert.deepEqual(
    d.clips.filter(c => c.id !== 'copy'),
    before.clips,
  );
  assert.ok(d.clips.every(c => (c.gapBefore || 0) >= 0));
  assert.deepEqual(before, doc());
});
check('A copy follows destination track collisions without changing its source track', () => {
  const d = doc();
  d.videoTracks = 2;
  d.clips.push({ ...clip('upper'), videoTrack: 2, gapBefore: 24 });
  const before = copy(d);
  d.clips.push({ ...copy(d.clips[0]), id: 'copy' });
  const options = { copies: { a: 'copy' } };
  assert.equal(T.moveGroup(d, before, ['copy'], 0, 2, options), 72);
  assert.equal(T.videoTrack(T.rowFor(d, 'copy').clip), 2);
  assert.equal(T.rowFor(d, 'upper').start, 24);
  T.moveGroup(d, before, ['copy'], 200, 1, options);
  assert.equal(T.rowFor(d, 'copy').start, 200);
  assert.equal(T.videoTrack(T.rowFor(d, 'copy').clip), 1);
  assert.deepEqual(
    d.clips.filter(c => c.id !== 'copy'),
    before.clips,
  );
});
check('Mixed copies keep video and detached audio aligned without moving music or originals', () => {
  const d = doc();
  T.unlinkAudio(d, 'a', 'sound');
  d.audioClips.push(bed('music', 0, 0, 300));
  const before = copy(d);
  d.clips.push({ ...copy(d.clips[0]), id: 'picture-copy' });
  d.audioClips.push({ ...copy(d.audioClips[0]), id: 'sound-copy' });
  const options = { copies: { a: 'picture-copy', sound: 'sound-copy' } };
  assert.equal(T.moveGroup(d, before, ['picture-copy', 'sound-copy'], 200, undefined, options), 200);
  assert.equal(T.rowFor(d, 'picture-copy').start, 200);
  assert.equal(d.audioClips.find(c => c.id === 'sound-copy').start, 200);
  assert.deepEqual(
    d.clips.filter(c => c.id !== 'picture-copy'),
    before.clips,
  );
  assert.deepEqual(
    d.audioClips.filter(c => c.id !== 'sound-copy'),
    before.audioClips,
  );
  T.moveGroup(d, before, ['picture-copy', 'sound-copy'], 0, undefined, options);
  assert.equal(T.rowFor(d, 'picture-copy').start, 144);
  assert.equal(d.audioClips.find(c => c.id === 'sound-copy').start, 144);
});
check('Snapping excludes every selected video in a group', () => {
  assert.deepEqual(T.snapPoints(doc(), ['a', 'c']), [0, 48, 96]);
});
check('Moving either edge snaps to the nearest stationary cut before overwriting', () => {
  const d = doc();
  d.clips[1].gapBefore = 48;
  assert.equal(T.snapMove(d, ['a'], 50, 7), 48);
  assert.equal(T.snapMove(d, ['c'], -2, 7), 0);
  assert.equal(T.snapMove(d, ['a'], 55, 7), 55);
});
check('Move snapping chooses the closest cut rather than the first in tolerance', () => {
  assert.equal(T.snapMove(doc(), ['a'], 11, 7, [62, 60]), 12);
});
check('Moving groups snap from every selected edge without snapping to themselves', () => {
  const d = doc();
  d.clips[1].gapBefore = 100;
  assert.equal(T.snapMove(d, ['a', 'c'], 102, 7), 100);
  assert.equal(T.snapMove({ clips: [clip('only')], audioClips: [] }, ['only'], 4, 7), 0);
  assert.equal(T.snapMove({ clips: [clip('only')], audioClips: [] }, ['only'], 10, 7), 10);
});
check('Move snapping uses subframe pointer distance at high zoom', () => {
  assert.equal(T.snapMove(doc(), ['a'], 48.6, 0.7), 48);
  assert.equal(T.snapMove(doc(), ['a'], 48.8, 0.7), 49);
});
check('Overwrite splits covered footage at exact source frames and leaves other tracks and music unchanged', () => {
  const d = doc();
  d.clips = [
    clip('cover', 10, 110, 150),
    { ...clip('moving', 0, 20), gapBefore: 20 },
    { ...clip('upper', 0, 60), videoTrack: 2 },
  ];
  d.videoTracks = 2;
  d.audioClips = [{ id: 'music', start: 0, in: 0, out: 160 }];
  d.clips[0].audio = { fadeIn: 4, fadeOut: 5 };
  const before = copy(d),
    upper = copy(d.clips[2]);
  let serial = 0;
  T.moveGroup(d, before, ['moving'], -80, 1, { overwrite: true });
  assert.equal(T.rowFor(d, 'moving').start, 40);
  assert.equal(d.clips.length, 3);
  T.overwriteMove(d, before, ['moving'], -80, 1, () => 'fragment-' + ++serial);
  assert.deepEqual(
    T.layout(d)
      .filter(r => T.videoTrack(r.clip) === 1)
      .map(r => [r.clip.id, r.start, r.end, r.clip.in, r.clip.out]),
    [
      ['cover', 0, 40, 10, 50],
      ['moving', 40, 60, 0, 20],
      ['fragment-1', 60, 100, 70, 110],
    ],
  );
  assert.equal(d.clips.find(c => c.id === 'cover').audio.fadeOut, 0);
  assert.equal(d.clips.find(c => c.id === 'fragment-1').audio.fadeIn, 0);
  assert.equal(d.clips.find(c => c.id === 'fragment-1').audio.fadeOut, 5);
  assert.deepEqual(
    d.clips.find(c => c.id === 'upper'),
    { ...upper, gapBefore: 0 },
  );
  assert.deepEqual(d.audioClips, before.audioClips);
  assert.ok(d.clips.every(c => c.gapBefore >= 0));
  assert.deepEqual(d.clips.find(c => c.id === 'fragment-1').takeSourceIds, ['cover']);
});
check('Overwrite trims across several destination clips without shifting following edits', () => {
  const d = doc();
  d.clips.push({ ...clip('move', 0, 70), gapBefore: 48 });
  const before = copy(d),
    old = T.rowFor(d, 'move').start;
  let id = 0;
  T.moveGroup(d, before, ['move'], 30 - old, 1, { overwrite: true });
  T.overwriteMove(d, before, ['move'], 30 - old, 1, () => 'cut-' + ++id);
  assert.deepEqual(
    T.layout(d).map(r => [r.clip.id, r.start, r.end, r.clip.in, r.clip.out]),
    [
      ['a', 0, 30, 12, 42],
      ['move', 30, 100, 0, 70],
      ['c', 100, 144, 16, 60],
    ],
  );
  assert.equal(T.total(d), T.total(before));
});
check('A partial overwrite after removing the head keeps the surviving tail offset', () => {
  const d = { clips: [clip('long', 10, 110)], audioClips: [] };
  T.overwriteInsert(d, clip('new', 0, 30), 0, 1, () => 'cut');
  assert.deepEqual(
    T.layout(d).map(r => [r.clip.id, r.start, r.end, r.clip.in, r.clip.out]),
    [
      ['new', 0, 30, 0, 30],
      ['long', 30, 100, 40, 110],
    ],
  );
});
check('Cross-track overwrite cuts only the destination lane and leaves a gap at the original position', () => {
  const d = doc();
  d.clips.push({ ...clip('upper', 5, 125, 150), videoTrack: 2 });
  d.videoTracks = 2;
  const before = copy(d);
  let serial = 0;
  T.moveGroup(d, before, ['b'], 0, 2, { overwrite: true });
  T.overwriteMove(d, before, ['b'], 0, 2, () => 'cut-' + ++serial);
  assert.equal(T.rowFor(d, 'b').start, 48);
  assert.equal(T.videoTrack(T.rowFor(d, 'b').clip), 2);
  assert.equal(T.rowFor(d, 'c').start, 96);
  assert.deepEqual(
    T.layout(d)
      .filter(r => T.videoTrack(r.clip) === 2)
      .map(r => [r.start, r.end, r.clip.in, r.clip.out]),
    [
      [0, 48, 5, 53],
      [48, 96, 12, 60],
      [96, 120, 101, 125],
    ],
  );
});
check('Moving a reviewed take gives it its full range, hides it at the source and adopts only its own receipts', () => {
  const d = doc(),
    source = d.clips[0],
    t = {
      id: 'candidate',
      number: 2,
      generated: true,
      request: { attemptId: 'receipt' },
      media: { frames: 75, file: 'candidate.mp4' },
    };
  source.takes.push(t);
  let id = 0;
  const c = T.moveTake(d, 'a', 'candidate', 144, 2, () => 'new-' + ++id);
  assert.deepEqual([c.in, c.out, c.takeId], [0, 75, 'candidate']);
  assert.deepEqual(c.takeSourceTakeIds, ['candidate']);
  assert.deepEqual(c.takes, [t]);
  assert.deepEqual(
    T.realTakes(source).map(t => t.id),
    ['a-take'],
  );
  assert.equal(source.takeId, 'a-take');
  assert.equal(T.rowFor(d, c.id).start, 144);
  assert.equal(c.workflowVersion, undefined);
});
check(
  'Moving the active take selects a fallback and leaves no stale workflow; moving the final take leaves a gap',
  () => {
    const d = doc(),
      source = d.clips[0];
    source.workflowVersion = 'old';
    source.takes.push({ id: 'fallback', number: 2, media: { frames: 120 } });
    let serial = 0;
    T.moveTake(d, 'a', 'a-take', 200, 1, () => 'new-' + ++serial);
    assert.equal(source.takeId, 'fallback');
    assert.equal(source.workflowVersion, undefined);
    assert.deepEqual(
      T.realTakes(source).map(t => t.id),
      ['fallback'],
    );
    const bStart = T.rowFor(d, 'b').start;
    T.moveTake(d, 'b', 'b-take', 300, 1, () => 'new-' + ++serial);
    assert.equal(
      d.clips.some(c => c.id === 'b'),
      false,
    );
    assert.equal(T.rowFor(d, 'c').start, 96);
    assert.equal(bStart, 48);
  },
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
