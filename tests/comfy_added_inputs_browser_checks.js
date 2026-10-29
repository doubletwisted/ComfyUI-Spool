(async()=>{
 const n=spoolNative,checks=[],popups=[],originalOpen=window.open,shot=()=>n.state.clips.find(c=>c.id==='shot');
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);},wait=async fn=>{const end=Date.now()+60000;while(!await fn()){if(Date.now()>end)throw Error('Added inputs: '+document.getElementById('toast').textContent);await new Promise(r=>setTimeout(r,70));}};
 const api=async path=>{const r=await fetch('/spool/api/'+path);if(!r.ok)throw Error(await r.text());return r.json();};
 const inputFields=()=>[...document.querySelectorAll('[data-image-input]')],field=label=>inputFields().find(f=>f.querySelector('.media-label').firstChild.textContent===label);
 window.open=function(...args){const tab=originalOpen.apply(window,args);if(tab)popups.push(tab);return tab;};
 try{
  n.selectClip('shot');if(!document.getElementById('inspector').getClientRects().length)document.getElementById('showRightPanel').click();await n.flush();
  const initialVersion=shot().workflowVersion,oldKey=shot().bindings[0].key,chosen=shot().takeId,trim=[shot().in,shot().out],originalTakes=shot().takes.map(t=>t.id);
  await n.editWorkflow();await wait(()=>popups[0]?.comfyAPI?.app?.app?.rootGraph.nodes.some(node=>node.type==='LoadImage'));
  const comfy=popups[0],app=comfy.comfyAPI.app.app,graph=app.rootGraph,base=graph.nodes.find(node=>node.type==='LoadImage'),saver=graph.nodes.find(node=>node.type==='SaveImage');
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle='#ff0000';context.fillRect(0,0,96,64);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),form=new FormData();form.append('image',blob,'added-reference-'+crypto.randomUUID()+'.png');
  const upload=await fetch('/upload/image',{method:'POST',body:form});if(!upload.ok)throw Error(await upload.text());const filename=(await upload.json()).name;
  const reference=comfy.LiteGraph.createNode('LoadImage'),blend=comfy.LiteGraph.createNode('ImageBlend');graph.add(reference);graph.add(blend);
  base.title='Base image';reference.title='Style reference';reference.widgets.find(w=>w.name==='image').value=filename;blend.widgets.find(w=>w.name==='blend_factor').value=1;
  base.connect(0,blend,blend.inputs.findIndex(i=>i.name==='image1'));reference.connect(0,blend,blend.inputs.findIndex(i=>i.name==='image2'));blend.connect(0,saver,saver.inputs.findIndex(i=>i.name==='images'));
  const apply=async()=>{app.extensionManager.workflow.activeWorkflow.changeTracker.captureCanvasState();await wait(()=>comfy.document.querySelector('#spool-workflow-toolbar button')&&!comfy.document.querySelector('#spool-workflow-toolbar button').disabled);await comfy.document.querySelector('#spool-workflow-toolbar button').onclick();await n.flush();};
  await apply();
  check('Adding and connecting a second Load Image applies directly without setup',shot().workflowVersion!==initialVersion&&!document.getElementById('modal').classList.contains('open')&&shot().bindings.filter(b=>b.asset).length===2);
  const referenceBinding=shot().bindings.find(b=>b.nodeId===String(reference.id)),sourceBinding=shot().bindings.find(b=>b.nodeId===String(base.id));
  check('Named nodes become separate visible Inspector image inputs',field('Base image')&&field('Style reference')&&sourceBinding.key===oldKey);
  const stored=shot().inputValues[referenceBinding.key],recipe=await api('workflows/'+shot().workflowVersion);
  check('The chosen image is retained in the project and the editable graph',stored.startsWith('spool-projects/'+n.projectKey+'/input/images/')&&recipe.prompt[reference.id].inputs.image===stored&&recipe.workflow.nodes.find(node=>String(node.id)===String(reference.id)).widgets_values[0]===stored);
  const file=await fetch('/spool/api/input/'+encodeURIComponent(stored));check('The retained image has exactly the uploaded bytes',file.ok&&new Uint8Array(await file.arrayBuffer()).join(',')===new Uint8Array(await blob.arrayBuffer()).join(','));
  const preview=field('Style reference').querySelector('img');await preview.decode();check('The new source displays its actual thumbnail and filename',preview.naturalWidth===96&&!preview.hidden&&field('Style reference').innerText.includes(stored.split('/').at(-1)));
  const appliedVersion=shot().workflowVersion;n.undo();await n.flush();check('Undo restores the previous graph and Inspector inputs',shot().workflowVersion===initialVersion&&shot().bindings.length===1);
  n.redo();await n.flush();check('Redo restores both inputs with the same identities and chosen files',shot().workflowVersion===appliedVersion&&shot().inputValues[referenceBinding.key]===stored&&!!field('Style reference'));
  reference.widgets.find(w=>w.name==='image').value='';await apply();
  check('An unchosen new image stays editable and blocks Generate with a source message',shot().inputValues[referenceBinding.key]===''&&document.getElementById('generate').disabled&&document.querySelector('.workflow-problem').textContent==='Style reference is empty. Choose it in the Inspector.'&&field('Style reference').innerText.includes('Choose image'));
  reference.widgets.find(w=>w.name==='image').value=filename;await apply();
  check('Selecting the file again restores readiness without changing input identity',!document.getElementById('generate').disabled&&shot().inputValues[referenceBinding.key]===stored);
  const oldTakes=new Set(shot().takes.map(t=>t.id));await n.queueClips([shot()]);await wait(async()=>{await n.poll();return shot().takes.some(t=>t.generated&&!oldTakes.has(t.id));});
  const generated=shot().takes.find(t=>t.generated&&!oldTakes.has(t.id)),image=new Image();image.src='/spool/media/'+n.projectKey+'/'+generated.media.file;await image.decode();context.drawImage(image,0,0);const pixel=context.getImageData(0,0,1,1).data;
  check('A real CPU generation uses the newly added image',pixel[0]>240&&pixel[1]<15&&pixel[2]<15);
  base.connect(0,saver,saver.inputs.findIndex(i=>i.name==='images'));graph.remove(blend);graph.remove(reference);await apply();
  check('Removing the node removes only its Inspector input',shot().bindings.filter(b=>b.asset).length===1&&shot().bindings.find(b=>b.asset).key===oldKey&&!field('Style reference'));
  n.undo();await n.flush();check('Removing an input can be undone with its file and binding intact',shot().inputValues[referenceBinding.key]===stored&&!!field('Style reference'));
  check('Graph edits preserve timeline trims and every original take',shot().takeId===chosen&&JSON.stringify([shot().in,shot().out])===JSON.stringify(trim)&&originalTakes.every(id=>shot().takes.some(t=>t.id===id)));
  return {checks};
 }finally{window.open=originalOpen;for(const tab of popups)if(!tab.closed)tab.close();}
})()
