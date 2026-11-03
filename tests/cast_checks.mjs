import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveMentions, tagStyle, unknownMentions } from '../ui/cast.js';

// Shared with spool/cast.py (tests/test_cast.py).
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/cast_mentions.json', import.meta.url), 'utf8'));
for (const c of fixture.cases)
  assert.deepEqual(resolveMentions(fixture.cast, fixture.bindings, c.values, c.settings, c.style), c.expected, c.name);
for (const s of fixture.styles) assert.equal(tagStyle(s.text), s.style, s.text);
assert.deepEqual(unknownMentions(fixture.cast, '@Mara meets @Nobody and @nobody; a@b.c'), ['Nobody', 'nobody']);
console.log('cast checks passed');
