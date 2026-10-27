(async()=>{
 const n=window.spoolNative,checks=[],mappings=[],check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async(predicate,label,timeout=120000)=>{const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw Error(label+': '+document.getElementById('toast')?.textContent);await new Promise(r=>setTimeout(r,40));}};
 // Bindings built in the browser and read back from a saved recipe differ only in key order.
 const canonical=value=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
 const $=selector=>document.querySelector(selector),click=selector=>{const b=$(selector);if(!b)throw Error('Missing '+selector);b.click();};
 await wait(()=>document.querySelectorAll('[data-builtin]').length===23,'Curated templates');
 check('Compact URL opens the full studio',!$('#editor').classList.contains('compact')&&!new URL(location.href).searchParams.has('mode'));
 check('Workflows is the primary sidebar tab',$('#mediaPanel').dataset.tab==='workflows');
 const catalog=await (await fetch('/spool/api/templates')).json();
 check('Catalog has nine local and fourteen cloud workflows',catalog.filter(t=>t.section==='local').length===9&&catalog.filter(t=>t.section==='cloud').length===14);
 if(innerWidth<=1100)click('#workflowLibraryToggle');
 else{const panel=$('#mediaPanel').getBoundingClientRect(),timeline=$('.timeline-shell').getBoundingClientRect();check('One sidebar spans viewer and timeline',Math.abs(panel.bottom-timeline.bottom)<3);}
 click('[data-workflow-task="flf"]');check('First/Last filter includes both execution locations',document.querySelectorAll('[data-builtin]').length===4);
 click('[data-workflow-task="all"]');
 click('[data-workflow-view="list"]');check('Workflow display persists locally',localStorage.getItem('spool-workflow-view')==='list'&&$('.workflow-library').dataset.view==='list');
 click('[data-workflow-view="grid"]');
 const search=$('#workflowSearch');search.value='Turbo';search.dispatchEvent(new Event('input'));check('Search finds Turbo workflows',document.querySelectorAll('[data-builtin]').length===2);search.value='';search.dispatchEvent(new Event('input'));
 for(const t of catalog){
  const before=n.state.clips.length;click('[data-builtin="'+t.id+'"]');
  await wait(()=>n.state.clips.length===before+1&&n.state.clips.at(-1).workflowVersion,'Prepare '+t.id);
  const c=n.state.clips.at(-1);await n.flush();
  const recipe=await (await fetch('/spool/api/workflows/'+c.workflowVersion)).json(),bindings=c.bindings;
  check(t.id+' appends an automatically bound shot',bindings.filter(b=>b.role==='positive').length===1&&bindings.filter(b=>b.role==='duration').length===1&&bindings.filter(b=>b.role==='seed').length===1&&bindings.some(b=>b.role==='resolution')&&$('#modalOverlay').hidden);
  const saves=Object.entries(recipe.prompt).filter(([,p])=>p.class_type==='SaveVideo');
  check(t.id+' selects only the final SaveVideo',recipe.result.nodeId===saves.at(-1)[0]&&recipe.resultOnly===true);
  check(t.id+' exposes aspect ratio',!!$('#inspectorContent').querySelector('[data-resolution-ratio]')||bindings.some(b=>b.label==='Aspect ratio'));
  mappings.push({id:t.id,result:recipe.result,bindings:bindings.map(b=>({nodeId:b.nodeId,input:b.input,label:b.label,role:b.role,slot:b.slot}))});
  click('[data-builtin="'+t.id+'"]');
  await wait(()=>n.state.clips.length===before+2&&n.state.clips.at(-1).workflowVersion&&!$('#inspector').inert,'Reuse '+t.id);await n.flush();
  const repeated=n.state.clips.at(-1);
  check(t.id+' reuses its verified output and bindings',repeated.workflowVersion===c.workflowVersion&&repeated.id!==c.id&&repeated.takeId!==c.takeId&&canonical(repeated.bindings)===canonical(c.bindings));
 }
 const beforeRapid=n.state.clips.length;click('[data-builtin="video_minimax_h3_t2v"]');click('[data-builtin="video_minimax_h3_t2v"]');
 await wait(()=>n.state.clips.length===beforeRapid+2&&n.state.clips.at(-1).workflowVersion,'Repeated clicks append twice');
 check('Repeated card clicks each append a new shot',n.state.clips.length===beforeRapid+2);
 const target=n.state.clips[0],takeId=target.takeId,timing=[target.in,target.out],version=target.workflowVersion,count=n.state.clips.length;
 const drop=(element,builtin,x)=>{const r=element.getBoundingClientRect(),dataTransfer=new DataTransfer();dataTransfer.setData('application/spool',JSON.stringify({builtin}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX:x??r.left+r.width/2,clientY:r.top+r.height/2}));};
 drop($('[data-clip="'+target.id+'"]'),'api_minimax_h3_t2v');
 await wait(()=>n.state.clips.find(c=>c.id===target.id)?.workflowVersion!==version,'Replace workflow');
 check('Dropping on a clip replaces workflow and preserves take/timing',n.state.clips.length===count&&target.takeId===takeId&&JSON.stringify([target.in,target.out])===JSON.stringify(timing));
 check('Replacing a workflow adopts its execution target',n.state.clips.find(c=>c.id===target.id).executionTarget==='cloud');
 const T=await import('/spool/ui/timeline.js'),cut=T.rowFor(n.state,n.state.clips[1].id).start,oldIds=new Set(n.state.clips.map(c=>c.id));
 const edge=$('[data-clip="'+n.state.clips[1].id+'"]');drop(edge,'video_minimax_h3_t2v',edge.getBoundingClientRect().left+1);
 await wait(()=>n.state.clips.length===count+1&&n.state.clips.every(c=>c.workflowVersion),'Insert at cut');
 check('Dropping at a cut inserts a shot at that exact frame',n.state.clips.length===count+1&&T.rowFor(n.state,n.state.clips.find(c=>!oldIds.has(c.id)).id).start===cut);
 click('[data-bin-tab="media"]');check('Media has All/Video/Image/Audio filters',document.querySelectorAll('[data-media-filter]').length===4&&getComputedStyle($('.workflow-library')).display==='none');
 click('[data-media-filter="audio"]');check('Audio filter is selected',$('[data-media-filter="audio"]').getAttribute('aria-pressed')==='true');
 click('[data-bin-tab="workflows"]');
 click('[data-cloud-settings]');await wait(()=>!$('#modalOverlay').hidden&&!!$('#comfyApiKey'),'Cloud settings');
 check('Cloud key input never reveals the saved value',$('#comfyApiKey').type==='password'&&!$('#comfyApiKey').value);
 $('#comfyApiKey').value='comfyui-studio-browser-fixture';click('#comfySaveSettings');await wait(()=>$('#modalOverlay').hidden,'Save key');
 check('Cloud key badge confirms configuration',$('[data-cloud-settings]').textContent.includes('API Key ✓'));
 const status=await (await fetch('/spool/api/comfy')).json();await n.flush();
 const exported=await (await fetch('/spool/api/projects/'+n.projectKey+'/export')).json();
 check('Settings and portable project never contain the key',status.hasApiKey&&!JSON.stringify(status).includes('comfyui-studio-browser-fixture')&&!JSON.stringify(exported).includes('comfyui-studio-browser-fixture'));
 click('[data-cloud-settings]');await wait(()=>!$('#modalOverlay').hidden&&!!$('#comfyClearApiKey'),'Remove key');$('#comfyClearApiKey').checked=true;click('#comfySaveSettings');await wait(()=>$('#modalOverlay').hidden,'Key removed');
 check('Removing the key updates its badge',$('[data-cloud-settings]').textContent==='Set API Key');
 check('Browsing and setup never execute a workflow',!n.state.jobs?.length);
 n.selectClip(n.state.clips.find(c=>c.name.includes('MiniMax H3')&&c.name.includes('Image to Video')).id);
 if(innerWidth<=1100)$('#mediaPanel').classList.remove('open');
 return {checks,mappings};
})()
