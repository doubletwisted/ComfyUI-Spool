import assert from 'node:assert/strict';
import { createTakeReview } from '../ui/take-review.js';
import { createTakeSeen } from '../ui/take-seen.js';

const checks = [],
  check = (label, test) => {
    assert.ok(test, label);
    checks.push(label);
  };
const media = (id, frames = 120) => ({ id, kind: 'video', file: id + '.mp4', frames });
const first = {
  id: 'shot',
  in: 12,
  out: 60,
  takeId: 'one',
  takes: [
    { id: 'one', media: media('one') },
    { id: 'two', media: media('two', 60) },
    { id: 'three', media: media('three') },
    { id: 'placeholder', placeholder: true, media: media('empty') },
  ],
};
let clips = [
  first,
  { id: 'other', in: 5, out: 40, takeId: 'other-take', takes: [{ id: 'other-take', media: media('other') }] },
];
const review = createTakeReview(() => clips);
check(
  'Initial review shows the authored edit',
  review.mode === 'edit' && review.source === null && review.candidate === null,
);
check('Placeholder takes cannot enter review', !review.reviewTake('shot', 'placeholder'));
review.reviewTake('shot', 'two');
review.seek(35);
check(
  'Source has an independent playhead without choosing the take',
  review.mode === 'source' && review.frame === 35 && first.takeId === 'one',
);
review.reviewTake('shot', 'three');
check('Flipping takes in the same shot preserves source time', review.frame === 35);
review.reviewTake('other', 'other-take');
check('Changing shots starts at the new shot in point', review.frame === 5);
review.reviewTake('shot', 'two');
review.seek(1000);
check('Source seeking clamps to media duration', review.frame === 60);
review.reviewTake('shot', 'two');
check('Entering a shorter take clamps to a real frame', review.frame === 59);
review.compare('shot');
check(
  'Comparison starts with authored take and candidate',
  review.comparison.ids.join(',') === 'one,two' && review.length === 120,
);
review.selectPane(0);
review.reviewTake('shot', 'three');
check(
  'Take replacement affects only the active comparison pane',
  review.comparison.ids.join(',') === 'three,two' && review.source.takeId === 'three',
);
const frame = review.frame;
review.selectPane(1);
check('Changing comparison focus preserves source time', review.frame === frame && review.source.takeId === 'two');
const tried = review.tryInEdit();
check(
  'Try in edit is view-only and closes comparison',
  tried.id === 'shot' &&
    review.mode === 'edit' &&
    review.audition.takeId === 'two' &&
    review.comparison === null &&
    first.takeId === 'one',
);
review.cancelTrial();
check('Cancelling trial returns to the authored take', review.audition === null && first.takeId === 'one');
review.setMode('source');
check('Returning to Source restores its playhead', review.frame === frame && review.source.takeId === 'two');
review.tryInEdit();
review.used('other');
check('Committing a different shot leaves the trial intact', review.audition.takeId === 'two');
review.used('shot');
check('Using the reviewed shot ends its trial', review.audition === null);
review.reviewTake('shot', 'one');
review.tryInEdit();
check('Trying the take already in the edit does not create a trial', review.audition === null);
review.openMedia(media('pool'), 17);
review.edit();
review.setMode('source');
check('Media review survives returning to the edit', review.source.media.id === 'pool' && review.frame === 17);
review.reviewTake('shot', 'two');
review.tryInEdit();
first.takes.push({ id: 'arrival', media: media('arrival') });
review.reconcile();
check(
  'New result arrival keeps the review candidate and authored choice',
  review.audition.takeId === 'two' && first.takeId === 'one',
);
first.hiddenTakeIds = ['two'];
review.reconcile();
check(
  'A removed review candidate restores the edit',
  review.mode === 'edit' && review.source === null && review.audition === null,
);
review.reviewTake('shot', 'three');
clips = [];
review.reconcile();
check('Removing the shot clears stale review references', review.source === null && review.mode === 'edit');
check('Empty review cannot enter Source or trial', !review.setMode('source') && review.tryInEdit() === null);
const saved = new Map(),
  storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
const shot = {
  id: 'seen-shot',
  takeId: 'old',
  takes: [
    { id: 'old', generated: true },
    { id: 'older', generated: true },
    { id: 'pending', generated: true, placeholder: true },
  ],
};
const seen = createTakeSeen('project', [shot], storage);
check('First use baselines existing footage without flagging unknown past views', seen.unseen(shot).length === 0);
shot.takes.push({ id: 'new', generated: true }, { id: 'imported' }, { id: 'archived', generated: true });
shot.hiddenTakeIds = ['archived'];
check(
  'Complete folder-discovered and queued arrivals both count as new',
  seen
    .unseen(shot)
    .map(t => t.id)
    .join(',') === 'new,imported',
);
check(
  'Reloading preserves unread arrivals instead of rebaselining them',
  createTakeSeen('project', [shot], storage).unseen(shot).length === 2,
);
const other = createTakeSeen('project', [shot], storage);
seen.mark(['new', 'imported']);
other.mark(['pending']);
seen.refresh();
check(
  'Full/native acknowledgements merge without losing another view’s marks',
  JSON.parse(storage.getItem(seen.key)).includes('new') &&
    JSON.parse(storage.getItem(seen.key)).includes('pending') &&
    seen.unseen(shot).length === 0,
);
shot.hiddenTakeIds = [];
check(
  'Archived unread takes stay unread when restored',
  seen.unseen(shot).some(t => t.id === 'archived'),
);
shot.takeId = 'archived';
check('The authored take is never advertised as unseen', seen.unseen(shot).length === 0);
check('Review tracking never adds authored fields to clips', !('seenTakeIds' in shot) && !('seen' in shot.takes[0]));
const offlineStorage = new Map(),
  offline = {
    getItem: key => offlineStorage.get(key) ?? null,
    setItem: (key, value) => offlineStorage.set(key, value),
  },
  offlineShot = { id: 'offline-shot', takeId: 'chosen', takes: [{ id: 'chosen' }, { id: 'reviewed' }] };
const beforeClose = createTakeSeen('offline-project', [offlineShot], offline);
beforeClose.mark(['reviewed']);
offlineShot.takes.push(
  { id: 'farm-result', generated: true },
  { id: 'folder-result' },
  { id: 'unfinished', generated: true, placeholder: true },
);
const reopened = createTakeSeen('offline-project', [offlineShot], offline);
check(
  'Takes completed while the editor is closed remain unread after opening',
  reopened
    .unseen(offlineShot)
    .map(t => t.id)
    .join(',') === 'farm-result,folder-result',
);
reopened.mark(['farm-result']);
check(
  'Refreshing keeps explicit reviews seen and other offline arrivals unread',
  createTakeSeen('offline-project', [offlineShot], offline)
    .unseen(offlineShot)
    .map(t => t.id)
    .join(',') === 'folder-result',
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
