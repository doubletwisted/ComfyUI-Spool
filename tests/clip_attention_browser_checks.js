(async()=>{
 const w=window,n=w.spoolNative,d=w.document,$=id=>d.getElementById(id),checks=[];
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);},clip=()=>n.state.clips.find(c=>c.id==='shot'),node=()=>d.querySelector('[data-clip="shot"]'),badge=type=>node().querySelector('[data-'+type+']'),count=type=>Number(badge(type)?.dataset[type==='open-notes'?'openNotes':'unseenTakes']||0);
 const api=async(path,data)=>{const r=await w.fetch('/spool/api/'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});if(!r.ok)throw Error((await r.json()).error);return r.json();};
 const wait=async fn=>{const end=Date.now()+30000;while(!await fn()){if(Date.now()>end)throw Error('Attention wait timed out: '+$('toast').textContent);await new Promise(r=>setTimeout(r,100));}};
 n.selectClip('shot');if(!$('editor').classList.contains('compact')&&w.innerWidth<=760)$('toggleInspector').click();await n.flush();
 check('Existing footage starts seen; only open Notes count',count('open-notes')===2&&count('unseen-takes')===0);
 check('Independent audio shows its own open-note badge',d.querySelector('[data-audio="music"] [data-open-notes="1"]'));
 const jobCount=n.state.jobs.length;
 $('clipNotesSection').querySelector('[data-address="motion"]').click();await n.flush();
 check('Addressing a note updates the timeline immediately',count('open-notes')===1&&n.state.jobs.length===jobCount);
 n.undo();await n.flush();check('Undo restores the open-note badge',count('open-notes')===2);
 $('clipNotes').blur();const before=new Set(clip().takes.map(t=>t.id));
 await api('projects/'+n.projectKey+'/queue',{revision:n.revision,items:[{clipId:'shot',count:3}]});
 await wait(async()=>{await n.poll();return clip().takes.filter(t=>!before.has(t.id)&&t.generated).length===3;});
 const fresh=clip().takes.filter(t=>!before.has(t.id)&&t.generated);
 check('Three real CPU arrivals appear as unseen without selecting the clip',count('unseen-takes')===3);
 const freshCards=()=>fresh.map(t=>d.querySelector('[data-take="'+t.id+'"]'));
 check('Each new arrival is marked on its own take card',freshCards().every(card=>card.querySelector('.take-badge.new')?.textContent==='New'));
 const hover=freshCards()[0].querySelector('[data-view]');hover.dispatchEvent(new w.PointerEvent('pointerenter'));hover.dispatchEvent(new w.PointerEvent('pointerleave'));
 check('Hovering leaves the take card New marker intact',freshCards().every(card=>card.querySelector('.take-badge.new'))&&count('unseen-takes')===3);
 const chosen=clip().takeId,version=clip().workflowVersion,compactTake=fresh[0],snapshot=compactTake.workflowSnapshot;
 delete compactTake.workflowSnapshot;clip().takeId=compactTake.id;delete clip().workflowVersion;n.selectClip('shot');
 check('A compact generated take resolves its editable workflow from request.capture',!!compactTake.request?.capture&&!$('editClipWorkflow').disabled);
 clip().takeId=chosen;clip().workflowVersion=version;if(snapshot)compactTake.workflowSnapshot=snapshot;
 n.selectClip('shot');await n.flush();check('Selection and visible thumbnails do not mark takes seen',count('unseen-takes')===3);
 const revision=n.revision,candidate=clip().takes.find(t=>!t.placeholder&&t.id!==clip().takeId&&!clip().hiddenTakeIds?.includes(t.id));
 $('compareTakes').click();
 check('Compare acknowledges both displayed takes',count('unseen-takes')===fresh.filter(t=>t.id!==candidate.id).length);
 for(const t of fresh)n.viewTake(t.id);
 check('Explicit Source or Compare review clears the unseen badge',count('unseen-takes')===0&&!badge('unseen-takes'));
 check('Reviewed take cards lose their New markers',freshCards().every(card=>!card.querySelector('.take-badge.new')));
 await n.flush();check('Review tracking creates no project revisions or edit Undo steps',n.revision===revision);
 const {createTakeSeen}=await import('/spool/ui/take-seen.js'),seen=createTakeSeen(n.projectKey,n.state.clips,w.localStorage);
 check('Seen status survives reloading the tracker',seen.unseen(clip()).length===0);
 const last=fresh.at(-1),externalId='external-'+crypto.randomUUID();clip().takes.push({...last,id:externalId,number:99});n.selectClip('shot');
 check('A later result remains new after earlier results were reviewed',count('unseen-takes')===1);
 check('Only the later result is marked New in the take strip',d.querySelectorAll('#takeList .take-badge.new').length===1&&d.querySelector('[data-take="'+externalId+'"] .take-badge.new'));
 const values=JSON.parse(w.localStorage.getItem(seen.key));values.push(externalId);w.localStorage.setItem(seen.key,JSON.stringify(values));w.dispatchEvent(new w.StorageEvent('storage',{key:seen.key}));
 check('Another view’s acknowledgement updates the badge',count('unseen-takes')===0);
 check('Another view’s acknowledgement clears the take card marker',!d.querySelector('[data-take="'+externalId+'"] .take-badge.new'));
 clip().takes.pop();
 const folderId='folder-'+crypto.randomUUID(),folderTake={id:folderId,number:99,media:structuredClone(last.media)};
 const heldFetch=w.fetch;
 w.fetch=async(url,options)=>{
  const projectGet=String(url)==='/spool/api/projects/'+n.projectKey&&(!options?.method||options.method==='GET');
  // A sync token asks for a compact reply; this fixture rewrites the full document.
  if(projectGet&&options?.headers){const {'X-Spool-Since':token,...headers}=options.headers;options={...options,headers};}
  const response=await heldFetch.call(w,url,options);
  if(projectGet){
   const project=await response.json();project.revision++;project.document.clips.find(c=>c.id==='shot').takes.push(folderTake);
   return new w.Response(JSON.stringify(project),{status:response.status,headers:{'Content-Type':'application/json'}});
  }
  return response;
 };
 try{await wait(async()=>{await n.poll();return clip().takes.some(t=>t.id===folderId);});}finally{w.fetch=heldFetch;}
 check('Polling shows a folder-discovered take when its count repeats an earlier cleared badge',clip().takes.some(t=>t.id===folderId&&!t.generated)&&count('unseen-takes')===1);
 check('Unread folder arrivals survive reopening the tracker',createTakeSeen(n.projectKey,n.state.clips,w.localStorage).unseen(clip()).some(t=>t.id===folderId));
 const beforeReview=n.revision;n.viewTake(folderId);await n.flush();
 check('Reviewing a folder take clears its badge without saving an edit',count('unseen-takes')===0&&n.revision===beforeReview);
 clip().takes.pop();clip().takes.push({...last,id:'screenshot-'+crypto.randomUUID(),number:100});n.selectClip('shot');
 const attention=node().querySelector('.clip-attention'),rect=attention.getBoundingClientRect(),clipRect=node().getBoundingClientRect();
 check('Badges sit in the upper-right header and fit full/native/narrow clips',rect.right<=clipRect.right&&rect.top<clipRect.top+25&&rect.left>=clipRect.left);
 check('Badges have distinct icons and accessible descriptions',badge('open-notes').querySelector('svg')&&badge('open-notes').getAttribute('aria-label')==='2 open notes');
 const takes=$('takes').getBoundingClientRect(),viewer=d.querySelector('.viewer').getBoundingClientRect(),groups=[...$('takeList').querySelectorAll('.take-group')];
 if(w.innerWidth>1100)check('Takes sit in a rail beside the viewer',Math.abs(takes.top-viewer.top)<2&&takes.left>=viewer.right-1&&takes.height>viewer.height-2);
 check('Imported and generated takes start separate batches',groups.length===2&&groups[0].textContent.startsWith('Imported')&&groups.every(g=>/\d+ takes?$/.test(g.textContent)));
 return {checks};
})()
