// Viewer playback preparation: sizing, in-flight sharing, failure and retry.
import { createPreviews } from '../ui/preview.js';

const checks = [];
const check = (label, ok) => {
  if (!ok) throw Error(label);
  checks.push(label);
};
const media = (id, kind = 'video') => ({
  id,
  kind,
  file: 'uploads/' + id + '.mp4',
  originalFile: 'C:/originals/' + id + '.mp4',
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// --- sizing ----------------------------------------------------------------
{
  const asked = [];
  let target = { width: 960, height: 540, fps: 24 };
  const previews = createPreviews({
    target: () => target,
    request: async (m, size) => {
      asked.push([m.id, size]);
      return { file: 'previews/' + m.id + '.mp4' };
    },
    changed: () => {},
  });
  check('An image or video needs preparing', previews.status(media('a')).state === 'preparing');
  check(
    'The size the caller wants is what is requested',
    asked[0][1].width === 960 && asked[0][1].height === 540 && asked[0][1].fps === 24,
  );
  await tick();
  check(
    'A prepared media reports its file',
    previews.status(media('a')).state === 'ready' && previews.status(media('a')).file === 'previews/a.mp4',
  );
  check('The same media is not prepared twice', asked.length === 1);
  target = { width: 480, height: 270, fps: 24 };
  check('A different playback size is prepared separately', previews.status(media('a')).state === 'preparing');
  await tick();
  check('Both sizes are remembered', asked.length === 2 && previews.size === 2);
  check(
    'A media without an id or a media kind is used directly',
    previews.status({ file: 'x.mp4', kind: 'audio' }).state === 'direct' &&
      previews.status(undefined).state === 'direct',
  );
  check(
    'A media keyed by its original file shares the preparation',
    previews.status(media('a')).file === 'previews/a.mp4',
  );
}

// --- failure and retry -----------------------------------------------------
{
  let fail = true,
    calls = 0;
  const changes = [];
  const previews = createPreviews({
    target: () => ({ width: 960, height: 540, fps: 24 }),
    request: async m => {
      calls++;
      if (fail) throw Error('ffmpeg is unavailable');
      return { file: 'previews/' + m.id + '.mp4' };
    },
    changed: (m, entry) => changes.push(entry.state),
  });
  check('A failure starts as preparing', previews.status(media('b')).state === 'preparing');
  await tick();
  const failed = previews.status(media('b'));
  check(
    'A failure is recorded with its message',
    failed.state === 'failed' && failed.error === 'ffmpeg is unavailable',
  );
  check('A failure notifies the viewer', changes.at(-1) === 'failed');
  check('A failed preparation is not retried implicitly', calls === 1);
  fail = false;
  check('Retrying a failed preparation is accepted', previews.retry(media('b')) === true);
  check('Retrying prepares again', previews.status(media('b')).state === 'preparing' && calls === 2);
  await tick();
  check('The retry succeeds', previews.status(media('b')).state === 'ready');
  check('A ready preparation is not retried', previews.retry(media('b')) === false && calls === 2);
  check('Completion notifies the viewer', changes.at(-1) === 'ready');
}

// --- sharing between concurrent viewers ------------------------------------
{
  let release = null;
  const previews = createPreviews({
    target: () => ({ width: 960, height: 540, fps: 24 }),
    request: () =>
      new Promise(resolve => {
        release = () => resolve({ file: 'previews/shared.mp4' });
      }),
    changed: () => {},
  });
  const first = previews.status(media('shared')),
    second = previews.status(media('shared'));
  check('A preparation in flight is shared, not repeated', first === second);
  release();
  await tick();
  check('A shared preparation completes once', previews.status(media('shared')).file === 'previews/shared.mp4');
}

// --- clearing a project ------------------------------------------
{
  let calls = 0;
  const previews = createPreviews({
    target: () => ({ width: 960, height: 540, fps: 24 }),
    request: async m => {
      calls++;
      return { file: 'previews/' + m.id + '.mp4' };
    },
    changed: () => {},
  });
  previews.status(media('c'));
  await tick();
  previews.clear();
  check('Clearing forgets every preparation', previews.size === 0);
  check('A cleared media is prepared again', previews.status(media('c')).state === 'preparing' && calls === 2);
}

// Polling remains preparing until the server exposes the completed file.
{
  let release,
    calls = 0;
  const changes = [];
  const previews = createPreviews({
    target: () => ({ width: 960, height: 540, fps: 24 }),
    request: async () => (++calls === 1 ? { state: 'preparing' } : { state: 'ready', file: '_playback/done.mp4' }),
    wait: () =>
      new Promise(resolve => {
        release = resolve;
      }),
    changed: (_, entry) => changes.push(entry.state),
  });
  const entry = previews.status(media('poll'));
  await Promise.resolve();
  check('A queued response is still preparing', entry.state === 'preparing' && calls === 1);
  const pending = entry.pending;
  release();
  await pending;
  check(
    'Polling discovers the ready copy',
    entry.state === 'ready' && entry.file === '_playback/done.mp4' && calls === 2,
  );
  check('Completion notifies once', changes.join() === 'ready');
}

console.log('Previews: sizing, sharing, failure, retry and clearing passed');
console.log(checks.length + ' checks');
