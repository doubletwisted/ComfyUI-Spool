// What the viewer shows, decided apart from playback. In Source it is the take under
// review; otherwise the picture at a sequence frame: the topmost enabled clip's take
// and source frame (a take being tried in the edit replaces the chosen one), or a
// gap with the next clip for its hint. Decoders, the clock and audio stay in the editor.
import { layout, visibleRow, videoEnabled, total, takeOf } from './timeline.js';

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

export function pictureAt(doc, review, sequenceFrame) {
  if (review.mode === 'source' && review.source) {
    const c = review.source.clipId && doc.clips.find(c => c.id === review.source.clipId),
      t = c && c.takes.find(t => t.id === review.source.takeId);
    return {
      media: review.source.media,
      frame: Math.min(review.frame, review.source.media.frames - 1),
      clip: t ? c : null,
      take: t,
      length: review.length,
    };
  }
  const length = total(doc),
    frame = Math.min(sequenceFrame, Math.max(0, length - 1)),
    row = visibleRow(doc, frame);
  const next = () =>
    layout(doc)
      .filter(n => videoEnabled(doc, n.clip) && n.start > frame)
      .sort((a, b) => a.start - b.start)[0];
  if (!row) return length ? { gap: true, media: { kind: 'gap' }, length, next: next() } : null;
  const c = row.clip,
    t = (review.audition?.clipId === c.id && c.takes.find(t => t.id === review.audition.takeId)) || takeOf(c);
  return {
    media: t.media,
    frame: clamp(c.in + frame - row.start, c.in, Math.min(c.out, t.media.frames) - 1),
    row,
    next: next(),
    clipId: c.id,
    clip: c,
    take: t,
    length,
  };
}
