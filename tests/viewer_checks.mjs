import assert from 'node:assert/strict';
import { createViewer } from '../ui/viewer.js';

// Exercise preparation and audio ownership without a host or actual decoders.
const originalDocument = globalThis.document,
  originalAudioContext = globalThis.AudioContext;
const nodes = new Map();
const element = () => ({ after() {}, setAttribute() {}, textContent: '' });
globalThis.document = { createElement: element };
let resumed = 0;
const connectable = () => ({ connect() {}, gain: { value: 0 } });
globalThis.AudioContext = class {
  state = 'suspended';
  createGain = connectable;
  createAnalyser = connectable;
  createDynamicsCompressor() {
    return Object.assign(
      connectable(),
      Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(k => [k, { value: 0 }])),
    );
  }
  resume() {
    resumed++;
    return Promise.resolve();
  }
};
try {
  let state = { previewQuality: 'half', muted: true },
    fps = 24;
  const requests = [];
  const viewer = createViewer({
    $: id => {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    svg: () => '',
    getState: () => state,
    getFps: () => fps,
    resolution: () => ({ width: 960, height: 540 }),
    projectKey: 'test',
    fileUrl: file => file,
    request: (path, size) => {
      requests.push({ path, size });
      return new Promise(() => {});
    },
  });
  const media = { id: 'movie', kind: 'video', file: 'movie.mp4' };
  assert.equal(viewer.previewFile(media), null);
  assert.deepEqual(requests[0].size, { width: 960, height: 540, fps: 24 });
  assert.equal(nodes.get('viewerResolution').textContent, 'Preparing\u2026');
  // A replaced project and changed frame rate must be read at request time.
  state = { previewQuality: 'quarter', muted: false };
  fps = 30;
  viewer.previewFile(media);
  assert.deepEqual(requests[1].size, { width: 960, height: 540, fps: 30 });
  viewer.ensureAudioContext();
  assert.equal(resumed, 1, 'A suspended audio context resumes using its native state property');
} finally {
  globalThis.document = originalDocument;
  globalThis.AudioContext = originalAudioContext;
}
console.log('Viewer preparation and audio ownership passed (mocked elements and audio context).');
