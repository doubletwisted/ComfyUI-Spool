import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compactGroups,inputProblem,visibleInputs,inputFilled} from '../ui/input-groups.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/optional_inputs.json',import.meta.url),'utf8'));
const {bindings,rules}=fixture;
for(const c of fixture.cases){
 assert.deepEqual(compactGroups(bindings,c.values,c.settings),c.compacted,c.name);
 assert.equal(inputProblem(bindings,c.compacted.values,c.compacted.settings,rules),c.problem,c.name);
 assert.deepEqual(visibleInputs(bindings,c.values,c.settings).map(b=>b.key),c.visible,c.name);
 assert.deepEqual(bindings.filter(b=>b.optional&&!inputFilled(b,c.compacted.values,c.compacted.settings)).map(b=>b.key),c.omitted,c.name);
}
// Compaction copies; the caller's draft changes only when it assigns the result.
const values={ref1:'',ref2:'b.png'},settings=[{key:'ref2',source:'selected'}];
compactGroups(bindings,values,settings);
assert.deepEqual(values,{ref1:'',ref2:'b.png'});assert.deepEqual(settings,[{key:'ref2',source:'selected'}]);
// Recipes without groups or rules behave as before: every media input is required.
const legacy=[{key:'frame',nodeId:'1',input:'image',label:'Source image',asset:true}];
assert.equal(inputProblem(legacy,{frame:''},[]),'Source image is empty. Choose it in the Inspector.');
assert.equal(inputProblem(legacy,{frame:''},[{key:'frame',source:'selected'}]),null);
assert.deepEqual(visibleInputs(legacy,{frame:''},[]),legacy);
console.log(JSON.stringify({passed:fixture.cases.length*4+6,kind:'Shared Python/browser optional and grouped media inputs'},null,2));
