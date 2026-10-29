import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../ui/timeline.js';
for (const item of JSON.parse(fs.readFileSync(new URL('./fixtures/clip_trims.json', import.meta.url)))) {
  const doc = item.document,
    c = doc.clips.find(c => c.id === item.clipId);
  const session = T.beginEdit(doc, { id: c.id, kind: item.edge, mode: 'trim' });
  T.applyEdit(doc, session, item.frame - c[item.edge]);
  const actual = {
    clips: doc.clips.map(c => Object.fromEntries(['id', 'in', 'out', 'gapBefore'].map(k => [k, c[k] ?? 0]))),
    tailGap: doc.tailGap || 0,
    videoTailGaps: doc.videoTailGaps || {},
  };
  assert.deepEqual(actual, item.expected, item.name);
}
console.log('Scoped edge trims match the production timeline in 10 shared cases.');
