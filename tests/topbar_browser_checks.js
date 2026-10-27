(async()=>{
 const n=window.spoolNative,d=document,$=id=>d.getElementById(id)||n.dialogRoot.getElementById(id),checks=[],compact=$('editor').classList.contains('compact');
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);},wait=async predicate=>{const end=performance.now()+15000;while(!predicate()){if(performance.now()>end)throw Error('Topbar check timed out: '+$('saveStatus').textContent+' / '+$('comfyConnection').getAttribute('aria-label'));await new Promise(r=>setTimeout(r,30));}},key=(el,value)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
 n.selectClip('shot');await n.flush();await wait(()=>$('saveStatus').textContent.endsWith('All changes saved')&&$('comfyConnection').getAttribute('aria-label')==='Comfy connected');const initial=JSON.stringify(n.state.clips),revision=n.revision;
 check('Top bar separates saved state from connection and renders',$('saveStatus').textContent==='✓ All changes saved'&&$('comfyConnection').getAttribute('aria-label')==='Comfy connected'&&$('queueLabel').textContent==='Renders');
 await wait(()=>!$('processingStatus').getClientRects().length);check('Idle processing does not compete with project status',!$('processingStatus').getClientRects().length);
 $('projectMenu').focus();key($('projectMenu'),'ArrowDown');
 check('Project menu opens from keyboard with a focused command',!$('projectCommands').hidden&&d.activeElement===$('reset'));
 key(d.activeElement,'End');check('Menu keyboard navigation reaches Activity',d.activeElement===$('projectActivity'));
 key(d.activeElement,'Escape');check('Escape closes the menu and restores its trigger',$('projectCommands').hidden&&d.activeElement===$('projectMenu'));
 $('projectMenu').click();$('renameProject').click();check('Rename retains the inline project field',d.activeElement===$('projectName')&&$('projectName').selectionEnd===$('projectName').value.length);
 $('projectName').blur();$('projectMenu').click();$('openProjects').click();await wait(()=>!$('modalOverlay').hidden&&!!$('newNativeProject'));check('Projects command opens the existing project manager',!!$('projectOpenFile'));$('closeModal').click();
 $('projectMenu').click();$('topbarProjectSettings').click();await wait(()=>!$('modalOverlay').hidden&&!!$('settingsSave'));check('Project settings stay reachable from the project name',!!$('settingsWidth'));$('closeModal').click();
 $('workspaceMenu').click();check('View exposes panel state',!!$('toggleInspector').getAttribute('aria-checked')&&$('inspectorHeight').getAttribute('aria-checked')==='true');
 $('toggleInspector').click();check('View can hide the inspector',$('workbench').classList.contains('hide-inspector')&&!$('inspector').getClientRects().length);
 $('workspaceMenu').click();$('toggleInspector').click();check('View restores the inspector',$('inspector').getClientRects().length>0);
 $('workspaceMenu').click();$('toggleMedia').click();
 check('Media panel works in the chosen mode',compact?$('mediaPanel').classList.contains('open')&&$('mediaPanel').getClientRects().length>0:$('workbench').classList.contains('hide-media'));
 $('workspaceMenu').click();$('toggleMedia').click();
 $('workspaceMenu').click();$('topbarDiagnostics').click();await wait(()=>!!$('diagnosticsLog')&&!$('modalOverlay').hidden);check('View retains real local diagnostics',JSON.parse($('diagnosticsLog').value).projectId===n.projectKey);$('closeModal').click();
 $('showQueue').click();check('Renders opens the existing queue without blocking the studio',!!$('queueList')&&$('modalOverlay').hidden);$('closeRenders').click();
 $('export').click();check('Export remains the sequence action',!!$('renderExport')&&!$('modalOverlay').hidden);
 $('exportFormat').value='otio';$('exportFormat').dispatchEvent(new Event('change'));check('OpenTimelineIO format relabels the export',$('renderExport').textContent==='Export timeline'&&$('exportAudioLabel').textContent==='Include audio tracks');
 $('renderExport').click();await wait(()=>/complete|failed|missing|Error/i.test($('exportResult').textContent));
 const timeline=await fetch($('exportResult').querySelector('a')?.href).then(r=>r.json()).catch(()=>null);
 check('Timeline export downloads OpenTimelineIO with the clip on V1: '+$('exportResult').textContent,timeline?.OTIO_SCHEMA==='Timeline.1'&&timeline.tracks.children[0].name==='V1'&&timeline.tracks.children[0].children.some(c=>c.OTIO_SCHEMA==='Clip.1'&&c.metadata.spool.id==='shot'));
 $('closeModal').click();$('export').click();check('Export keeps the chosen format',$('exportFormat').value==='otio');$('exportFormat').value='mp4';$('exportFormat').dispatchEvent(new Event('change'));check('MP4 format restores the video export',$('renderExport').textContent==='Export video');$('closeModal').click();
 await n.flush();check('Topbar navigation does not change clips or revision',JSON.stringify(n.state.clips)===initial&&n.revision===revision);
 const original=window.fetch,path='/spool/api/projects/'+n.projectKey,name='Topbar saved retry QA '+(compact?'compact':'full');let fail=true;
 window.fetch=async(input,options)=>{if(fail&&String(input)===path&&options?.method==='PUT')throw Error('Controlled topbar save failure');return original(input,options);};
 try{
  $('projectName').value=name;$('projectName').dispatchEvent(new Event('change',{bubbles:true}));try{await n.flush();}catch{}
  check('Failed save exposes an explicit retry without a revision number',$('saveStatus').textContent==='Save failed · Retry'&&$('saveIndicator').title.includes('Controlled topbar save failure')&&n.dirty);
  fail=false;$('saveIndicator').click();await wait(()=>!n.dirty&&$('saveStatus').textContent==='✓ All changes saved');
  check('Save retry durably stores the retained project name',(await original(path).then(r=>r.json())).document.project===name);
 }finally{window.fetch=original;}
 await n.flush();check('Saving a project title preserves clip contents',JSON.stringify(n.state.clips)===initial);
 let offline=true;window.fetch=async(input,options)=>{if(offline&&String(input)===path&&options?.method==='GET')throw Error('Controlled project connection loss');return original(input,options);};
 try{await n.poll();check('Project synchronization failure is distinct from Comfy status',$('saveStatus').textContent==='Sync unavailable · Retry'&&$('comfyConnection').textContent==='Comfy');offline=false;$('saveIndicator').click();await wait(()=>$('saveStatus').textContent==='✓ All changes saved');check('Retry clears project connection loss after an unchanged read',!n.dirty);}finally{window.fetch=original;}
 return {checks};
})()
