import { realTakes } from './timeline.js';

// Review intent is view-only. Choosing the authored take stays in timeline/history;
// playback and hover decoders consume this state without owning its transitions.
export function createTakeReview(clips) {
  let mode = 'edit',
    source = null,
    audition = null,
    frame = 0,
    comparison = null;
  const clip = id => clips().find(c => c.id === id);
  const comparisonTakes = () => {
    if (mode !== 'source' || !comparison || source?.clipId !== comparison.clipId) return null;
    const takes = comparison.ids.map(id => realTakes(clip(comparison.clipId)).find(t => t.id === id));
    return takes.every(Boolean) ? takes : null;
  };
  const length = () => {
    const takes = comparisonTakes();
    return takes ? Math.max(...takes.map(t => t.media.frames)) : source?.media.frames || 0;
  };
  function seek(value, end = true) {
    frame = Math.max(0, Math.min(value, Math.max(0, length() - (end ? 0 : 1))));
  }
  function closeComparison() {
    comparison = null;
  }
  function edit() {
    mode = 'edit';
    audition = null;
    closeComparison();
  }
  function clear() {
    edit();
    source = null;
    frame = 0;
  }
  function rememberMedia(media, position = 0) {
    source = { media };
    frame = position;
  }
  function openMedia(media, position = 0) {
    rememberMedia(media, position);
    mode = 'source';
    audition = null;
    closeComparison();
    seek(frame);
  }
  function reviewTake(clipId, takeId) {
    const c = clip(clipId),
      take = realTakes(c).find(t => t.id === takeId);
    if (!take) return false;
    if (!(mode === 'source' && source?.clipId === clipId)) frame = c.in;
    if (comparison?.clipId === clipId && mode === 'source') {
      const index = comparison.ids.indexOf(takeId);
      if (index >= 0) comparison.active = index;
      else comparison.ids[comparison.active] = takeId;
    } else closeComparison();
    source = { media: take.media, clipId, takeId };
    mode = 'source';
    audition = null;
    seek(frame, false);
    return true;
  }
  function compare(clipId) {
    const c = clip(clipId),
      takes = realTakes(c);
    if (takes.length < 2) return false;
    const first = takes.find(t => t.id === c.takeId) || takes[0],
      candidate = takes.find(t => t.id === source?.takeId && t.id !== first.id) || takes.find(t => t.id !== first.id);
    frame = mode === 'source' ? frame : c.in;
    mode = 'source';
    audition = null;
    comparison = { clipId, ids: [first.id, candidate.id], active: 1 };
    source = { media: candidate.media, clipId, takeId: candidate.id };
    seek(frame, false);
    return true;
  }
  function selectPane(index) {
    const take = comparisonTakes()?.[index];
    if (!take) return false;
    comparison.active = index;
    source = { media: take.media, clipId: comparison.clipId, takeId: take.id };
    return true;
  }
  function setMode(value) {
    if (value === 'source' && !source) return false;
    mode = value;
    audition = null;
    closeComparison();
    return true;
  }
  function tryInEdit() {
    const c = clip(source?.clipId);
    if (!c || !realTakes(c).some(t => t.id === source.takeId)) return null;
    mode = 'edit';
    closeComparison();
    audition = source.takeId === c.takeId ? null : { clipId: c.id, takeId: source.takeId };
    return c;
  }
  function cancelTrial() {
    audition = null;
  }
  function used(clipId) {
    if (audition?.clipId === clipId) cancelTrial();
  }
  function reconcile() {
    if (source?.clipId) {
      const take = realTakes(clip(source.clipId)).find(t => t.id === source.takeId);
      if (!take) {
        clear();
        return;
      }
      source = { ...source, media: take.media };
    }
    if (audition && !realTakes(clip(audition.clipId)).some(t => t.id === audition.takeId)) cancelTrial();
    if (comparison && !comparisonTakes()) closeComparison();
  }
  return {
    edit,
    clear,
    rememberMedia,
    openMedia,
    reviewTake,
    compare,
    selectPane,
    setMode,
    tryInEdit,
    cancelTrial,
    used,
    reconcile,
    seek,
    closeComparison,
    get mode() {
      return mode;
    },
    get source() {
      return source;
    },
    get audition() {
      return audition;
    },
    get frame() {
      return frame;
    },
    get comparison() {
      return comparison;
    },
    get length() {
      return length();
    },
    get takes() {
      return comparisonTakes();
    },
    get candidate() {
      return mode === 'source' ? source : audition;
    },
  };
}
