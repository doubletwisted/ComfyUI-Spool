(async()=>{
 const n=window.spoolNative,T=await import('/spool/ui/timeline.js'),$=id=>document.getElementById(id),checks=[];
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const wait=async predicate=>{const end=performance.now()+30000;while(!predicate()){if(performance.now()>end)throw Error('Drop check timed out: '+$('toast').textContent);await new Promise(r=>setTimeout(r,20));}};
 const id='api_ltx2_5_t2v',card=()=>document.querySelector('[data-builtin="'+id+'"]');
 await wait(card);card().click();await wait(()=>n.state.clips.at(-1).workflowVersion&&!$('inspector').inert);await n.flush();
 const version=n.state.clips.at(-1).workflowVersion,preview=document.querySelector('.library-drop-preview');
 const drag=()=>{const dataTransfer=new DataTransfer();card().dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));return dataTransfer;};
 const over=(node,x,y,dataTransfer)=>node.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer,clientX:x,clientY:y}));
 const end=dataTransfer=>document.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
 const first=n.state.clips[0],node=()=>document.querySelector('[data-clip="'+first.id+'"]'),r=node().getBoundingClientRect(),dataTransfer=drag();
 const before=JSON.stringify(n.state.clips),revision=n.revision;
 over(node(),r.left+r.width/2,r.top+r.height/2,dataTransfer);
 check('Workflow body hover shows replacement highlight',!preview.hidden&&preview.dataset.mode==='replace'&&!preview.querySelector('.library-drop-ghost').hidden);
 check('Replacement feedback names the workflow and action',preview.textContent.includes('Replace workflow')&&preview.textContent.includes('LTX 2.5'));
 check('Hover does not edit or save the timeline',JSON.stringify(n.state.clips)===before&&n.revision===revision);
 over(node(),r.right-1,r.top+r.height/2,dataTransfer);
 check('Clip edge hover changes to insertion marker',preview.dataset.mode==='insert'&&!preview.querySelector('.library-drop-marker').hidden);
 check('Insertion feedback names the video track',preview.textContent.includes('Insert on V1'));
 const lane=$('clipLane'),lr=lane.getBoundingClientRect(),upper=document.querySelector('[data-video-track="2"]');
 over(upper,lr.left+lr.width*.8,lr.top+10,dataTransfer);
 check('Empty upper track shows insertion on V2',!preview.hidden&&preview.textContent.includes('Insert on V2'));
 lane.dispatchEvent(new DragEvent('dragleave',{bubbles:true,relatedTarget:$('viewerStage'),dataTransfer}));
 check('Leaving the timeline clears drag feedback',preview.hidden);
 over(node(),r.left+r.width/2,r.top+r.height/2,dataTransfer);end(dataTransfer);
 check('Cancelling the drag clears its highlight',preview.hidden);
 // Drop at the same edge used by the preview and compare actual geometry.
 const dt=drag(),edge=node().getBoundingClientRect(),cut=T.rowFor(n.state,first.id).end;
 over(node(),edge.right-1,edge.top+edge.height/2,dt);
 const marker=parseFloat(preview.querySelector('.library-drop-marker').style.left),scale=edge.width/(first.out-first.in),count=n.state.clips.length;
 node().dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:edge.right-1,clientY:edge.top+edge.height/2}));end(dt);
 await wait(()=>n.state.clips.length===count+1);const inserted=n.state.clips.find(c=>c.id===n.state.selected);
 check('Drop clears the preview',preview.hidden);
 check('Drop inserts at the previewed cut on V1',T.rowFor(n.state,inserted.id).start===cut&&T.videoTrack(inserted)===1&&Math.abs(marker-cut*scale)<2);
 check('Prepared drop is immediately ready while save is pending',inserted.workflowVersion===version&&!$('inspector').inert);
 // Keep a save pending to prove another edit and Undo do not wait for it.
 await n.flush();const original=window.fetch;let release,entered=false;
 window.fetch=async(input,options)=>{if(options?.method==='PUT'&&!entered){entered=true;await new Promise(resolve=>release=resolve);}return original(input,options);};
 try{
  const before=n.state.clips.length;card().click();await wait(()=>n.state.clips.length===before+1&&entered);
  check('Pending save leaves Inspector and library interactive',!$('inspector').inert&&!$('workflowList').inert);
  const second=n.state.clips.at(-1).id;card().click();await wait(()=>n.state.clips.length===before+2);
  check('A second workflow addition does not wait for a pending save',n.state.clips.at(-2).id===second&&!$('inspector').inert);
  $('editor').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));
  check('Ctrl+Z works before the background save completes',n.state.clips.length===before+1);
 }finally{release?.();window.fetch=original;await n.flush();}
 const foot=document.querySelector('[data-media="drop-footage"]');
 // Media can be in the hidden secondary tab; its drag payload still shares the preview.
 const mediaTransfer=new DataTransfer();mediaTransfer.setData('application/spool',JSON.stringify({media:'drop-footage'}));
 (foot||$('editor')).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:mediaTransfer}));over(lane,lr.left+50,lr.top+10,mediaTransfer);
 check('Media drags also show a named timeline ghost',!preview.hidden&&preview.textContent.includes('drop-footage'));end(mediaTransfer);
 check('No generation was submitted',!n.state.jobs.length);
 return {checks};
})()
