(async()=>{
 const n=window.spoolNative,d=document,$=id=>d.getElementById(id),checks=[];
 const check=(label,value)=>{if(!value)throw Error(label);checks.push(label);};
 const visible=node=>!!node?.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
 const wait=async predicate=>{const end=performance.now()+15000;while(!predicate()){if(performance.now()>end)throw Error('Empty UI timed out');await new Promise(r=>setTimeout(r,30));}};
 check('Empty viewer explains how to start',visible($('emptyImport'))&&visible($('emptyWorkflow'))&&$('emptyStage').textContent.includes('Build your first sequence'));
 check('Empty inspector explains selection without a dead generation button',!!$('inspectorContent').querySelector('.selection-empty')&&!visible($('generate')));
 const revision=n.revision,input=$('mediaFiles'),click=input.click,picks=[];
 // Keep the system picker closed; exercise the real upload path with a generated File below.
 input.click=()=>picks.push({accept:input.accept,handler:typeof input.onchange});
 try{
  $('emptyWorkflow').click();check('Workflow shortcut opens the workflow file picker',picks.at(-1).accept==='.json'&&picks.at(-1).handler==='function');
  $('emptyImport').click();check('Footage shortcut accepts supported media',picks.at(-1).accept.includes('video/*')&&picks.at(-1).accept.includes('image/*'));
  if(!d.getElementById('editor').classList.contains('compact')){
   check('Empty media pool offers a useful import action',!!d.querySelector('[data-pool-import]'));
   $('importWorkflow').click();check('Empty library has a working workflow picker',picks.at(-1).accept==='.json');
   d.querySelector('[data-bin-tab="media"]').click();
   const search=$('poolSearch');search.value='no-such-ui-footage';search.dispatchEvent(new Event('input',{bubbles:true}));
   check('Unmatched search explains the result',d.querySelector('.pool-empty strong').textContent==='No matching media');
   d.querySelector('[data-clear-search]').click();check('Clear search restores the empty import action and focus',search.value===''&&d.activeElement===search&&!!d.querySelector('[data-pool-import]'));
  }
  check('Browsing empty states does not save the project',n.revision===revision&&n.state.clips.length===0);
  $('emptyImport').click();const bytes=await fetch('/spool/media/'+n.projectKey+'/assets/black.png').then(r=>r.blob()),files=new DataTransfer();files.items.add(new File([bytes],'UI-import.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>n.state.clips.length>0);await n.flush();
  check('Import shortcut uploads actual media and adds a timeline clip',n.state.clips[0].takes[0].media.kind==='image'&&n.revision>revision);
  check('Imported shot replaces welcome with working inspector controls',$('emptyStage').hidden&&visible($('editClipWorkflow'))&&visible($('generate')));
  const count=n.state.clips.length;n.undo();await n.flush();
  check('Import through the welcome screen remains undoable',count>0&&n.state.clips.length===0&&!$('emptyStage').hidden);
 }finally{input.click=click;}
 return {checks};
})()
