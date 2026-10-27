(async()=>{
 const n=window.spoolNative,checks=[],check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async predicate=>{const end=Date.now()+20000;while(!predicate()){if(Date.now()>end)throw Error('Cloud setup timed out: '+document.getElementById('toast')?.textContent);await new Promise(r=>setTimeout(r,30));}};
 await wait(()=>document.querySelector('[data-builtin="api_ltx2_5_t2v"]'));
 for(const id of ['api_ltx2_5_t2v','api_minimax_h3_max_i2v','api_minimax_h3_max_r2v','api_bfl_flux3_i2v','api_bfl_flux3_t2v']){
  const count=n.state.clips.length;document.querySelector('[data-builtin="'+id+'"]').click();
  await wait(()=>n.state.clips.length===count+1&&n.state.clips.at(-1).workflowVersion);
  check(id+' prepares without local Comfy',!document.querySelector('iframe')&&document.getElementById('modalOverlay').hidden);
  check(id+' defaults to SDK Cloud execution',document.getElementById('clipExecutionTarget').value==='cloud');
 }
 const target=document.getElementById('clipExecutionTarget');target.value='local';target.dispatchEvent(new Event('change'));check('Local Partner Nodes remain selectable',n.state.clips.at(-1).executionTarget==='local');
 const next=document.getElementById('clipExecutionTarget');next.value='cloud';next.dispatchEvent(new Event('change'));await n.flush();
 const project=await (await fetch('/spool/api/projects/'+n.projectKey)).json();
 check('Execution choice persists on the clip',project.document.clips.at(-1).executionTarget==='cloud');
 check('No generation or local model execution occurred',!n.state.jobs.length&&!performance.getEntriesByType('resource').some(r=>r.name.includes('/comfy/start')||r.name.includes('/object_info')));
 return {checks};
})()
