import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExactInt, exactDecimal, isIntegerValue, containsExactInt } from '../ui/wire.js';
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/wire_cases.json', import.meta.url), 'utf8'));
for (const c of cases) {
  assert.equal(exactDecimal(c.wire), c.decimal);
  assert.equal(isIntegerValue(c.wire), true);
  assert.equal(isExactInt(c.wire), typeof c.wire === 'object');
  assert.equal(containsExactInt({ nested: [c.wire] }), typeof c.wire === 'object');
}
assert.equal(containsExactInt({ text: '"__spool_int__"', empty: null }), false);
assert.equal(containsExactInt({ nested: [{}, [{ __spool_int__: '9223372036854775807' }]] }), true);
for (const value of [null, undefined, 1.5, '42', { __spool_int__: 42 }]) assert.equal(isIntegerValue(value), false);
console.log(
  JSON.stringify(
    { passed: cases.length + 3, kind: 'Shared Python/browser decimal wire plus structural traversal' },
    null,
    2,
  ),
);
