// Edit in Comfy and Apply to clip with Spool's own Reference to Video. Needs a host with Partner Nodes.
(async()=>{
 const n=spoolNative,$=id=>document.getElementById(id),checks=[],popups=[],originalOpen=window.open;
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);},wait=async(fn,label)=>{const end=Date.now()+60000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+label+' · '+$('toast').textContent);await new Promise(r=>setTimeout(r,60));}};
 window.open=function(...args){const tab=originalOpen.apply(window,args);if(tab)popups.push(tab);return tab;};
 try{
  await wait(()=>document.querySelector('[data-builtin="api_minimax_h3_r2v"]'),'the library lists the workflow');await n.flush();
  document.querySelector('[data-builtin="api_minimax_h3_r2v"]').click();
  await wait(()=>n.state.clips.length===1&&n.state.clips[0].workflowVersion&&!$('inspector').inert,'the shot is added');await n.flush();
  const shot=()=>n.state.clips[0],version=shot().workflowVersion;
  const canvas=new OffscreenCanvas(32,32);canvas.getContext('2d').fillRect(0,0,32,32);
  const picker=$('inspectorContent').querySelector('[data-image-input] input[type=file]'),files=new DataTransfer();
  files.items.add(new File([await canvas.convertToBlob({type:'image/png'})],'subject.png',{type:'image/png'}));picker.files=files.files;picker.dispatchEvent(new Event('change'));
  await wait(()=>shot().inputValues['3/image'],'the reference image uploads');await n.flush();
  const recipe=await(await fetch('/spool/api/workflows/'+version)).json();
  await n.editWorkflow();check('Edit in Comfy opens a Comfy tab',popups.length===1&&!popups[0].closed);
  const comfy=popups[0];await wait(()=>comfy.comfyAPI?.app?.app?.extensionManager?.workflow?.activeWorkflow,'Comfy opens the workflow');
  const app=comfy.comfyAPI.app.app,opened=(await app.graphToPrompt()).output;
  const links=prompt=>JSON.stringify(Object.entries(prompt).map(([id,node])=>[id,node.class_type,Object.entries(node.inputs).filter(([,v])=>Array.isArray(v)).sort()]).sort());
  check('Comfy reopens every connection of the workflow',links(opened)===links(recipe.prompt));
  check('The chosen reference image is written into its loader',opened['3'].inputs.image===shot().inputValues['3/image']&&opened['4'].inputs.image==='');
  const toolbar=comfy.document.querySelector('#spool-workflow-toolbar');await wait(()=>toolbar&&!toolbar.querySelector('button').disabled,'the Apply action is ready');
  await toolbar.querySelector('button').onclick();await n.flush();
  check('Apply creates a new workflow version',shot().workflowVersion!==version);
  const applied=await(await fetch('/spool/api/workflows/'+shot().workflowVersion)).json();
  check('Apply keeps every connection',links(applied.prompt)===links(recipe.prompt));
  const groups=applied.bindings.filter(b=>b.optional).map(b=>[b.label,b.group].join(' · '));
  check('Apply keeps the optional grouped inputs and their labels',JSON.stringify(groups)===JSON.stringify(['Reference image 1 · Reference images','Reference image 2 · Reference images','Reference image 3 · Reference images','Reference image 4 · Reference images','Reference video · Reference video','Reference audio · Reference audio']));
  check('Apply keeps the input rule',applied.inputRules?.[0]?.anyOf?.join()==='Reference images,Reference video');
  check('Apply keeps the chosen image',shot().inputValues['3/image']&&!$('inspectorContent').querySelector('.workflow-problem'));
  check('Opening and applying the workflow submit no generation',!n.state.jobs.length);
  return {checks,kind:'Spool workflow through the real Comfy graph and Apply bridge; no generation'};
 }finally{window.open=originalOpen;for(const tab of popups)if(!tab.closed)tab.close();}
})()
