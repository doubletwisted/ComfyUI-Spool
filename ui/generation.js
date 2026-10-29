import { exactDecimal, isIntegerValue } from './wire.js';

export function createQueueSubmission({ storage, key, submit }) {
  let pending = null,
    sending = false;
  try {
    pending = JSON.parse(storage.getItem(key) || 'null');
  } catch (error) {}
  function clear() {
    pending = null;
    storage.removeItem(key);
  }
  async function run(prepare) {
    if (sending) throw Error('A generation submission is already in progress.');
    if (prepare && pending) throw Error('Retry the pending submission from Queue before starting another batch.');
    sending = true;
    try {
      if (prepare) {
        const body = await prepare();
        if (!body) return;
        storage.setItem(key, JSON.stringify(body));
        pending = body;
      }
      if (!pending) return;
      try {
        await submit(pending);
      } catch (error) {
        if (error.status >= 400 && error.status < 500) clear();
        throw error;
      }
      clear();
    } finally {
      sending = false;
    }
  }
  return {
    start: prepare => run(prepare),
    retry: () => run(),
    get pending() {
      return pending;
    },
    get sending() {
      return sending;
    },
  };
}

export const seedControls = clip =>
  (clip.bindings || []).filter(b => b.role === 'seed' && !b.asset && isIntegerValue(clip.inputValues?.[b.key]));
export function reviewSignature(project, ids) {
  const selected = new Set(ids),
    fields = [
      'workflowVersion',
      'executionTarget',
      'inputValues',
      'shotInputs',
      'generationBase',
      'count',
      'seedMode',
      'seedKey',
    ];
  return JSON.stringify(
    {
      fps: project.fps,
      resolution: project.resolution,
      clips: project.clips.map(c => ({
        id: c.id,
        takeId: c.takeId,
        in: c.in,
        out: c.out,
        gapBefore: c.gapBefore || 0,
        videoTrack: c.videoTrack || 1,
        enabled: c.enabled !== false,
        audio: c.audio,
        audioDetached: c.audioDetached,
        ...(selected.has(c.id) ? Object.fromEntries(fields.map(key => [key, c[key]])) : {}),
      })),
      audioClips: project.audioClips || [],
      audioTracks: project.audioTracks,
    },
    (key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map(key => [key, value[key]]),
          )
        : value,
  );
}
export function generationItems(clips, definitions, recipes) {
  return clips.flatMap(c => {
    const count = c.count || 1,
      mode = c.seedMode === 'different' ? 'increment' : c.seedMode || 'same';
    if (mode === 'same') return [{ clipId: c.id, count }];
    const controls = seedControls(c),
      b = controls.find(b => b.key === c.seedKey) || (controls.length === 1 ? controls[0] : null);
    if (!b) throw Error(c.name + ': choose the seed control to vary.');
    const node = recipes[c.workflowVersion]?.prompt?.[b.nodeId],
      inputs = definitions[node?.class_type]?.input,
      schema = inputs?.required?.[b.input] || inputs?.optional?.[b.input];
    if (schema?.[0] !== 'INT') throw Error(c.name + ': reload the seed definition before varying takes.');
    const integer = value => {
      if (!isIntegerValue(value) || (typeof value === 'number' && !Number.isSafeInteger(value)))
        throw Error('Seed limits must be exact integers. Reload Spool.');
      return BigInt(exactDecimal(value));
    };
    const min = integer(schema[1]?.min ?? 0),
      max = integer(schema[1]?.max ?? Number.MAX_SAFE_INTEGER),
      base = integer(c.inputValues[b.key]),
      range = max - min + 1n;
    if (base < min || base > max || range < BigInt(count))
      throw Error(c.name + ': seed range cannot supply ' + count + ' distinct takes.');
    if (!['increment', 'decrement', 'randomize'].includes(mode)) throw Error('Choose a supported seed behavior.');
    const used = new Set();
    return Array.from({ length: count }, (_, i) => {
      let value;
      if (mode === 'randomize') {
        const bits = range.toString(2).length,
          words = new Uint32Array(Math.ceil(bits / 32)),
          mask = (1n << BigInt(bits)) - 1n;
        do {
          crypto.getRandomValues(words);
          value = words.reduce((n, w) => (n << 32n) | BigInt(w), 0n) & mask;
        } while (value >= range || used.has(String(value)));
        used.add(String(value));
        value += min;
      } else
        value =
          min + ((((base - min + (mode === 'decrement' ? -BigInt(i + 1) : BigInt(i + 1))) % range) + range) % range);
      return { clipId: c.id, count: 1, values: { [b.key]: { __spool_int__: String(value) } } };
    });
  });
}
// Client-side continuation is persisted with a retry, while execution gets frozen values.
export function seedUpdates(clips, items) {
  return clips.flatMap(c => {
    if (!['different', 'increment', 'decrement', 'randomize'].includes(c.seedMode)) return [];
    const last = items.findLast(item => item.clipId === c.id),
      key = Object.keys(last?.values || {})[0];
    return key
      ? [
          {
            clipId: c.id,
            workflowVersion: c.workflowVersion,
            key,
            before: c.inputValues[key],
            after: last.values[key],
            mode: c.seedMode,
            seedKey: c.seedKey,
          },
        ]
      : [];
  });
}

const stages = {
  waiting_for_host: 'Waiting for Comfy',
  intent: 'Waiting for dispatch',
  dispatching: 'Validating workflow',
  queued: 'Waiting in Comfy queue',
  running: 'Generating',
  submitting: 'Submitting to Deadline',
  submission_uncertain: 'Submission needs checking',
  farm_queued: 'Waiting for farm worker',
  farm_running: 'Generating on farm',
  farm_attention: 'Farm needs attention',
  cancel_requested: 'Cancellation requested',
  collecting: 'Preparing take preview',
  collection_pending: 'Collection needs retry',
  complete: 'Ready',
  failed: 'Generation failed',
  cancelled: 'Cancelled',
  uncertain: 'Execution needs checking',
};
export const jobStage = job => stages[job.status] || job.status;
// Pinned to spool/attempts.py by tests/fixtures/attempt_statuses.json.
export const PENDING = Object.freeze([
  'submitting',
  'submission_uncertain',
  'farm_queued',
  'farm_running',
  'farm_attention',
  'cancel_requested',
  'intent',
  'waiting_for_host',
  'dispatching',
  'queued',
  'running',
  'collecting',
  'collection_pending',
  'uncertain',
]);
export const TERMINAL = Object.freeze(['complete', 'failed', 'cancelled']);
// A verified late receipt can recover any attempt that has no accepted result.
export const RECOVERY = Object.freeze([...PENDING, 'failed', 'cancelled']);
// Uncertain attempts stay pending but are not counted as work in progress.
export const ACTIVE = Object.freeze(PENDING.filter(status => status !== 'uncertain'));
// Mirrors attempts.cancel_action: 'cancelled' at once, 'requested' from the target, or 'refused'.
export function cancelAction(job) {
  const target = job.target || 'local';
  if (TERMINAL.includes(job.status)) return 'refused';
  if (['intent', 'waiting_for_host'].includes(job.status) || (target === 'local' && job.status === 'uncertain'))
    return 'cancelled';
  return target === 'cloud' || (target === 'deadline' && !!job.submission?.external_id) ? 'requested' : 'refused';
}
export const finishedRender = job => TERMINAL.includes(job.status);
export const clearableRender = job => finishedRender(job) || job.status === 'cancel_requested';
export function visibleRenderJobs(jobs, cleared = []) {
  const hidden = new Set(cleared);
  return jobs.filter(j => !hidden.has(j.id) || !clearableRender(j));
}
export function jobElapsed(job, now = Date.now() / 1000) {
  if (!job.createdAt || (TERMINAL.includes(job.status) && !job.finishedAt)) return '';
  const seconds = Math.max(0, Math.floor((job.finishedAt || now) - job.createdAt));
  return seconds < 60
    ? seconds + 's'
    : seconds < 3600
      ? Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'
      : Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}
