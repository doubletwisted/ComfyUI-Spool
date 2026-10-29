import fs from 'node:fs';
import assert from 'node:assert/strict';
const { createProjectSync } = await import(
  'data:text/javascript;base64,' + Buffer.from(fs.readFileSync('ui/project-sync.js', 'utf8')).toString('base64')
);
const contract = JSON.parse(fs.readFileSync('tests/fixtures/project_updates.json', 'utf8'));

function fixture(enabled = true) {
  let time = 0,
    refreshes = 0;
  const sockets = [];
  const sync = createProjectSync({
    enabled,
    projectId: 'open-project',
    url: 'ws://localhost/ws',
    now: () => time,
    refresh: () => refreshes++,
    open: url => {
      const socket = {
        url,
        close() {
          this.closed = true;
        },
      };
      sockets.push(socket);
      return socket;
    },
  });
  return { sync, sockets, advance: ms => (time += ms), refreshes: () => refreshes };
}

for (const enabled of [false, true]) {
  const f = fixture(enabled);
  f.sync.start();
  assert.equal(f.sockets.length, Number(enabled));
  f.advance(1199);
  assert.equal(f.sync.due(true), false);
  f.advance(1);
  assert.equal(f.sync.due(true), true, 'Absent/unconnected sockets keep the active cadence');
  f.sync.didPoll();
  f.advance(14999);
  assert.equal(f.sync.due(false), false);
  f.advance(1);
  assert.equal(f.sync.due(false), true, 'Absent/unconnected sockets keep the idle cadence');
  f.sync.dispose();
}

const f = fixture();
f.sync.start();
const socket = f.sockets[0];
socket.onopen();
assert.equal(f.refreshes(), 1, 'Connection immediately recovers missed changes');
assert.equal(f.sync.due(false), true);
f.sync.didPoll();
f.advance(15000);
assert.equal(f.sync.due(false), false);
assert.equal(f.sync.due(true), false);
f.advance(15000);
assert.equal(f.sync.due(false), true, 'Connected sockets retain a 30 second fallback even idle');
f.sync.didPoll();
for (const data of [
  new ArrayBuffer(4),
  '{',
  'null',
  JSON.stringify({ type: 'progress', data: {} }),
  JSON.stringify({ type: 'spool.project', data: { projectId: 'other-project' } }),
])
  socket.onmessage({ data });
assert.equal(f.refreshes(), 1, 'Only matching project hints wake this editor');
socket.onmessage({
  data: JSON.stringify({ ...contract, data: { ...contract.data, projectId: 'open-project' } }),
});
assert.equal(f.refreshes(), 2, 'Matching invalidations wake the existing guarded poll');
assert.equal(f.sync.due(false), true, 'A busy or hidden editor retains the hint until it can poll');
f.sync.didPoll();
socket.onclose();
assert.equal(socket.closed, true);
assert.equal(f.refreshes(), 3);
f.sync.didPoll();
f.advance(1200);
assert.equal(f.sync.due(true), true, 'Disconnect immediately restores active polling');
assert.equal(f.sockets.length, 1, 'Reconnect attempts are bounded');
f.advance(3800);
f.sync.due(true);
assert.equal(f.sockets.length, 2);
f.sockets[1].onopen();
assert.equal(f.refreshes(), 4, 'Reconnect triggers a recovery poll');
f.sync.dispose();
assert.equal(f.sockets[1].closed, true);
assert.equal(f.sockets[1].onmessage, null);
f.advance(30000);
f.sync.due(true);
assert.equal(f.sockets.length, 2, 'Unload never reconnects');

const broken = createProjectSync({
  enabled: true,
  projectId: 'p',
  url: '/ws',
  refresh() {},
  open() {
    throw Error('Unavailable');
  },
});
assert.doesNotThrow(() => broken.start());
broken.dispose();

// Hints use the real draft/adoption boundary, including its asynchronous guards.
const { createProjectEdit } = await import(
  'data:text/javascript;base64,' + Buffer.from(fs.readFileSync('ui/project-edit.js', 'utf8')).toString('base64')
);
let reads = 0,
  gesture = false,
  focused = false,
  latest;
let authored = { project: 'local', clips: [] };
let remote = { id: 'p', revision: 1, recipes: {}, document: { ...authored, jobs: [] } };
const edit = createProjectEdit({
  project: structuredClone(remote),
  document: () => authored,
  apply(value, replace) {
    if (replace) {
      const { jobs, ...document } = value.document;
      authored = document;
    }
  },
  blocked: operation => gesture || (operation === 'replace' && focused),
  notify() {},
  request: async () => {
    reads++;
    return structuredClone(remote);
  },
});
const fake = { close() {} };
const guarded = createProjectSync({
  enabled: true,
  projectId: 'p',
  url: '/ws',
  open: () => fake,
  refresh: () => {
    latest = edit.poll();
  },
});
guarded.start();
const push = async () => {
  fake.onmessage({ data: JSON.stringify({ ...contract, data: { ...contract.data, projectId: 'p' } }) });
  await latest;
};
gesture = true;
await push();
assert.equal(reads, 0, 'Push cannot poll through a gesture');
gesture = false;
const capture = edit.beginCapture({});
await push();
assert.equal(reads, 0, 'Push cannot poll through a capture reservation');
edit.cancelCapture();
capture.finish();
remote.revision = 2;
remote.document.project = 'remote';
focused = true;
await push();
assert.equal(authored.project, 'local', 'Push cannot replace a focused field with a remote edit');
focused = false;
await push();
assert.equal(authored.project, 'remote', 'The next hint adopts once the field is released');
const beforeDraft = reads;
authored.project = 'unsaved draft';
await push();
assert.equal(reads, beforeDraft, 'Push cannot overwrite an unsaved draft');
guarded.dispose();
console.log(
  'PASS project socket scope, fallback cadences, missed hints, reconnect, binary frames and cleanup (fake socket; no sleeps)',
);
