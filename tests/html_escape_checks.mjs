// Identity and number fields from a project reach HTML only through esc().
//
// A project is data from whoever made it: an imported export or a shared project
// folder keeps clip, take and media IDs, take numbers and track numbers exactly as
// written. Joined raw into markup they ran script when the project was opened.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Linter } from 'eslint';

const FIELDS = new Set(['id', 'number', 'workflow', 'videoTrack', 'sourceLane']);
const CALLS = new Set(['videoTrack', 'sourceLane', 'takeName']);
const markup = node =>
  (node.type === 'Literal' && typeof node.value === 'string' && /[<>]|="/.test(node.value)) ||
  (node.type === 'TemplateLiteral' && node.quasis.some(q => /[<>]|="/.test(q.value.raw)));
const parts = (node, out = []) => {
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    parts(node.left, out);
    parts(node.right, out);
  } else out.push(node);
  return out;
};
const name = node =>
  node.type === 'Identifier' ? node.name : node.type === 'MemberExpression' ? node.property.name : '';
function raw(node) {
  switch (node.type) {
    case 'MemberExpression':
      return !node.computed && FIELDS.has(node.property.name);
    case 'CallExpression': {
      const callee = name(node.callee);
      if (CALLS.has(callee)) return true;
      if (callee === 'String') return node.arguments.some(raw);
      if (node.callee.type === 'MemberExpression' && ['padStart', 'toString'].includes(callee))
        return raw(node.callee.object);
      return false;
    }
    case 'ConditionalExpression':
      return raw(node.consequent) || raw(node.alternate);
    case 'LogicalExpression':
      return raw(node.left) || raw(node.right);
    case 'BinaryExpression':
      return node.operator === '+' && parts(node).some(raw);
    case 'TemplateLiteral':
      return node.expressions.some(raw);
    default:
      return false;
  }
}
const rule = {
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '+' || (node.parent.type === 'BinaryExpression' && node.parent.operator === '+')) return;
        const all = parts(node);
        if (!all.some(markup)) return;
        for (const part of all) if (raw(part)) context.report({ node: part, message: 'Escape with esc()' });
      },
      TemplateLiteral(node) {
        if (!markup(node)) return;
        for (const part of node.expressions)
          if (raw(part)) context.report({ node: part, message: 'Escape with esc()' });
      },
    };
  },
};

const linter = new Linter();
const config = {
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: { spool: { rules: { 'escape-fields': rule } } },
  rules: { 'spool/escape-fields': 'error' },
};
const check = source => linter.verify(source, config).map(m => m.line + ':' + m.column + ' ' + m.message);

// The check itself finds the shapes that were unescaped.
assert.equal(check(`h.innerHTML = '<div data-clip="' + c.id + '">';`).length, 1);
assert.equal(check(`h.innerHTML = '<b>' + 'T' + String(t.number).padStart(2, '0') + '</b>';`).length, 1);
assert.equal(check(`h.innerHTML = '<i style="top:var(--v-' + T.videoTrack(c) + ')">';`).length, 1);
assert.equal(check(`h.innerHTML = '<p>' + (x ? takeName(t) : 'None') + '</p>';`).length, 1);
assert.equal(check('h.innerHTML = `<p>${m.id}</p>`;').length, 1);
assert.deepEqual(check(`h.innerHTML = '<div data-clip="' + esc(c.id) + '">' + (a.id === b.id ? ' on' : '');`), []);
assert.deepEqual(check(`label.textContent = 'Take ' + t.number;`), []);

const problems = [];
for (const folder of ['ui', 'web'])
  for (const file of readdirSync(folder).filter(f => f.endsWith('.js')))
    for (const problem of check(readFileSync(folder + '/' + file, 'utf8')))
      problems.push(folder + '/' + file + ':' + problem);
assert.deepEqual(problems, [], 'Unescaped project fields in HTML:\n' + problems.join('\n'));
console.log('html escape checks passed');
