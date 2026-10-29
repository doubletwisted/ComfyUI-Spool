import assert from 'node:assert/strict';
import { createDiagnostics } from '../ui/diagnostics.js';
const values = new Map(),
  storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
  updates = [];
const log = createDiagnostics(value => updates.push(value), storage);
try {
  const finish = log.start('Reading clipboard'),
    background = log.start('Checking Comfy', { background: true });
  assert.equal(log.snapshot().active.length, 2);
  assert.equal(log.snapshot().active[0].label, 'Reading clipboard');
  finish();
  finish();
  background();
  assert.equal(log.snapshot().recent.filter(e => e.label === 'Reading clipboard').length, 1);
  const quiet = log.start('Routine project refresh', { quiet: true });
  assert.equal(log.snapshot().active.length, 0);
  quiet();
  assert.ok(!log.snapshot().recent.some(e => e.label === 'Routine project refresh'));
  await assert.rejects(
    log.run(
      'Routine refresh failed',
      async () => {
        throw Error('Offline');
      },
      { quiet: true },
    ),
    /Offline/,
  );
  assert.equal(log.snapshot().recent.at(-1).error, 'Offline');
  const realNow = performance.now.bind(performance);
  let clock = realNow();
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
  try {
    const slow = log.start('Slow project refresh', { quiet: true });
    clock += 1100;
    slow();
    assert.equal(log.snapshot().recent.at(-1).elapsedMs, 1100);
    assert.equal(log.snapshot().active.length, 0);
  } finally {
    delete performance.now;
  }
  assert.equal(await log.run('Saving project', async () => 42, { detail: 'PUT /spool/api/projects/qa' }), 42);
  const failure = Error('Connection lost');
  await assert.rejects(
    log.run('Importing image', async () => {
      throw failure;
    }),
    error => error === failure,
  );
  assert.equal(log.snapshot().active.length, 0);
  assert.equal(log.snapshot().recent.at(-1).error, 'Connection lost');
  for (let i = 0; i < 200; i++) log.record('Request ' + i, i);
  assert.equal(log.snapshot().recent.length, 120);
  assert.equal(log.snapshot().recent.at(-1).label, 'Request 199');
  log.dispose();
  assert.equal(JSON.parse(values.get('spool-diagnostics-v1')).length, 120);
  const restored = createDiagnostics(() => {}, storage);
  assert.equal(restored.snapshot().recent.length, 120);
  assert.equal(restored.snapshot().active.length, 0);
  restored.dispose();
  assert.ok(updates.length > 0);
  console.log('Diagnostics: active stages, idempotent finish, errors, bounded local persistence and reload passed');
} finally {
  log.dispose();
}
