// Media inputs a recipe may leave empty, mirroring spool/workflow_inputs.py.
// tests/fixtures/optional_inputs.json pins both. Bindings with `optional` are left
// out of the request when empty; bindings sharing a `group` fill in order.
export const inputFilled=(b,values,settings)=>settings.some(s=>s.key===b.key)||!!values[b.key];

// Move a group's filled inputs to its first slots, keeping their order.
export function compactGroups(bindings,values,settings){
 values={...values};settings=settings.map(s=>({...s}));
 const groups=new Map();
 for(const b of bindings)if(b.group){const members=groups.get(b.group)||[];members.push(b);groups.set(b.group,members);}
 for(const members of groups.values()){
  const chosen=members.filter(b=>inputFilled(b,values,settings)),moved=new Map(chosen.map((old,i)=>[old.key,members[i].key]));
  const contents=new Map(chosen.map(b=>[b.key,values[b.key]??'']));
  for(const b of members)values[b.key]='';
  for(const [old,key] of moved)values[key]=contents.get(old);
  settings=settings.map(s=>moved.has(s.key)?{...s,key:moved.get(s.key)}:s);
 }
 return {values,settings};
}

// The first missing media input, or null when the recipe can run.
export function inputProblem(bindings,values,settings,rules=[]){
 const missing=bindings.find(b=>b.asset&&!b.optional&&!inputFilled(b,values,settings));
 if(missing)return (missing.label||missing.input)+' is empty. Choose it in the Inspector.';
 return rules.find(rule=>!bindings.some(b=>rule.anyOf.includes(b.group)&&inputFilled(b,values,settings)))?.message||null;
}

// A group shows its filled inputs and one empty slot for the next.
export function visibleInputs(bindings,values,settings){
 const offered=new Set();
 return bindings.filter(b=>{
  if(!b.group||inputFilled(b,values,settings))return true;
  if(offered.has(b.group))return false;
  offered.add(b.group);return true;
 });
}
