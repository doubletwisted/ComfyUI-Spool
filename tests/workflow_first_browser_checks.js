(async()=>{
 const n=spoolNative,$=id=>document.getElementById(id),checks=[],timings=[],requests=[],added=[];
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const wait=async predicate=>{const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error('First add timed out: '+$('toast').textContent);await new Promise(r=>setTimeout(r,10));}};
 await wait(()=>document.querySelector('[data-builtin="video_ltx2_5_i2v"]'));await n.flush();
 for(const id of ['missing-0','missing-1']){n.selectClip(id);check(id+' renders no src for a known missing legacy example',[...$('inspectorContent').querySelectorAll('.native-source-preview')].every(img=>!img.hasAttribute('src')));}
 const original=window.fetch;let release,holding=false;
 window.fetch=async(input,options)=>{
  const row={path:String(input),method:options?.method||'GET'};requests.push(row);
  if(row.method==='PUT'&&!holding){holding=true;await new Promise(resolve=>release=resolve);}
  const response=await original(input,options);row.status=response.status;return response;
 };
 try{
  for(const id of ['video_ltx2_5_i2v','video_minimax_h3_i2v','api_minimax_h3_max_i2v']){
   const count=n.state.clips.length,start=performance.now();document.querySelector('[data-builtin="'+id+'"]').click();
   await wait(()=>n.state.clips.length===count+1&&n.state.clips.at(-1).workflowVersion);
   const ms=Math.round(performance.now()-start);timings.push({id,ms});check(id+' first use appears within 1 second',ms<1000);
   added.push(n.state.clips.at(-1).id);
   check(id+' keeps Inspector and timeline interactive',!$('inspector').inert&&!$('timelineScroll').inert);
   check(id+' starts with empty source controls and no image request',[...$('inspectorContent').querySelectorAll('.native-source-preview')].every(img=>!img.hasAttribute('src')));
  }
  check('A cold workflow add needs no hidden Comfy page',!document.querySelector('iframe'));
  check('Cold additions do not call template serialization or capture routes',!requests.some(r=>r.path.includes('/templates/')||r.path.includes('/capture/')));
  const count=n.state.clips.length;$('editor').focus();$('editor').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));
  check('Undo works while the first shot save is pending',n.state.clips.length===count-1);
  $('editor').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}));check('Redo restores that complete cold workflow',n.state.clips.length===count&&!!n.state.clips.at(-1).workflowVersion);
 }finally{release?.();window.fetch=original;}
 await n.flush();const saved=await (await original('/spool/api/projects/'+n.projectKey)).json();
 check('All first-use recipes persist with their exact clip versions',saved.document.clips.every(c=>saved.recipes[c.workflowVersion]&&c.bindings.length));
 check('Unchosen source images keep Generate disabled',$('generate').disabled);
 const count=n.state.clips.length;let rejected=false;
 window.fetch=async(input,options)=>options?.method==='PUT'?(rejected=true,new Response(JSON.stringify({error:'Controlled save failure'}),{status:503,headers:{'Content-Type':'application/json'}})):original(input,options);
 try{
  document.querySelector('[data-builtin="api_ltx2_5_t2v"]').click();await wait(()=>n.state.clips.length===count+1&&rejected);
  let failed=false;try{await n.flush();}catch{failed=true;}
  check('A failed first save retains the complete new shot for retry',failed&&n.state.clips.length===count+1&&!!n.state.clips.at(-1).workflowVersion);
 }finally{window.fetch=original;}
 await n.flush();const retry=await (await original('/spool/api/projects/'+n.projectKey)).json();
 check('Retry persists the original immutable recipe ID',retry.document.clips.at(-1).workflowVersion===n.state.clips.at(-1).workflowVersion&&!!retry.recipes[n.state.clips.at(-1).workflowVersion]);
 n.selectClip(added[0]);
 const shot=n.state.clips.find(c=>c.id===added[0]),binding=shot.bindings.find(b=>b.asset),canvas=document.createElement('canvas');canvas.width=canvas.height=16;canvas.getContext('2d').fillRect(0,0,16,16);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),files=new DataTransfer();files.items.add(new File([blob],'chosen-source.png',{type:'image/png'}));
 const picker=$('inspectorContent').querySelector('[data-image-file]');picker.files=files.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>!!n.state.clips.find(c=>c.id===added[0]).inputValues[binding.key]);await n.flush();
 await wait(()=>{const image=$('inspectorContent').querySelector('.native-source-preview');return image&&!image.hidden&&image.complete&&image.naturalWidth===16;});
 check('Choosing an actual source uploads and previews it successfully',!$('generate').disabled);
 n.undo();await n.flush();check('Undoing source selection restores the empty chooser without a bad image request',$('generate').disabled&&!$('inspectorContent').querySelector('.native-source-preview').hasAttribute('src'));
 n.redo();await n.flush();check('Redo restores the selected source',!!n.state.clips.find(c=>c.id===added[0]).inputValues[binding.key]);
 check('No generation was submitted',!n.state.jobs.length);
 return {checks,timings,requests};
})()
