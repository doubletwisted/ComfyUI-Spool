// Arrange existing editor commands without taking ownership of project operations.
export function createTopbar(root,actions){
 root.classList.add('project-topbar');
 const $=id=>root.querySelector('#'+id),bar=root.querySelector('.topbar'),left=bar.querySelector('.bar-left'),right=bar.querySelector('.bar-right');
 const button=(id,label,run)=>{const node=document.createElement('button');node.id=id;node.type='button';node.textContent=label;if(run)node.onclick=run;return node;};
 const name=$('projectName'),oldSave=$('saveStatus').parentElement,saveLabel=$('saveStatus'),processing=$('processingStatus');
 const identity=document.createElement('div');identity.className='project-identity';
 const title=document.createElement('div');title.className='project-title';name.title='Rename project';
 const project=button('projectMenu','▾');project.setAttribute('aria-label','Project menu');project.title='Projects, files and settings';
 title.append(name,project);
 const save=button('saveIndicator','');save.className='project-save';saveLabel.setAttribute('role','status');save.append(saveLabel);oldSave.remove();identity.append(title);
 const projectMenu=document.createElement('div'),viewMenu=document.createElement('div');
 for(const [node,id,label] of [[projectMenu,'projectCommands','Project'],[viewMenu,'viewCommands','View and connection']]){node.id=id;node.className='topbar-menu';node.hidden=true;node.setAttribute('role','menu');node.setAttribute('aria-label',label);}
 const item=(menu,node,label,checked)=>{node.className='topbar-menu-item';node.textContent=label;node.removeAttribute('aria-label');node.setAttribute('role',checked?'menuitemcheckbox':'menuitem');if(checked)node.dataset.checked=checked;menu.append(node);return node;};
 const separator=menu=>{const line=document.createElement('hr');line.setAttribute('role','separator');menu.append(line);};
 item(projectMenu,$('reset'),'New project');item(projectMenu,button('openProjects','',actions.projects),'Open / recent projects…');item(projectMenu,$('openProject'),'Open project file…');
 item(projectMenu,button('renameProject','',()=>{name.focus();name.select();}),'Rename project');item(projectMenu,$('nativeAddGraph'),'Add current workflow');separator(projectMenu);
 item(projectMenu,$('saveProject'),'Download project');item(projectMenu,button('topbarProjectSettings','',actions.settings),'Project settings…');separator(projectMenu);
 item(projectMenu,button('projectActivity','',actions.activity),'Activity log');
 item(viewMenu,$('toggleMedia'),'Media pool','media');item(viewMenu,$('toggleInspector'),'Inspector','inspector');item(viewMenu,$('inspectorHeight'),'Full-height inspector','height');separator(viewMenu);
 item(viewMenu,button('workflowLibraryToggle','',actions.workflows),'Workflow library');
 item(viewMenu,button('topbarShortcuts','',()=>$('gestureHelp').click()),'Keyboard shortcuts');item(viewMenu,button('topbarDiagnostics','',()=>processing.click()),'Diagnostics');separator(viewMenu);
 item(viewMenu,button('topbarConnection','',actions.connection),'Comfy connection settings…');
 const view=button('workspaceMenu','View ▾');view.className='workspace-menu';view.setAttribute('aria-label','View and connection');
 const connection=$('comfyConnection');connection.className='topbar-connection';
 const renders=$('showQueue');renders.title='Review generation queue and results';$('queueLabel').textContent='Renders';
 const badge=document.createElement('span');badge.id='renderCount';badge.className='render-count';badge.setAttribute('aria-live','polite');renders.append(badge);
 const warning=button('connectionWarning','',actions.connection);warning.className='connection-warning';warning.hidden=true;
 // Buttons in the menus retain their existing click handlers and view listeners.
 const panelButtons=['media','inspector'].map((panel,index)=>{
  const side=index?'Right':'Left',target=$(index?'inspector':'mediaPanel'),name=index?'Inspector':'Workflows and Media';
  const control=button('toggle'+side+'Panel','',()=>{$(index?'toggleInspector':'toggleMedia').click();checks();opener.focus({preventScroll:true});});
  const opener=button('show'+side+'Panel','',()=>{$(index?'toggleInspector':'toggleMedia').click();checks();control.focus({preventScroll:true});});
  for(const [node,show]of [[control,false],[opener,true]]){node.className='panel-toggle iconbutton'+(show?' panel-reopen':'');node.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(index!==Number(show)?'M9 6l6 6-6 6':'M15 6l-6 6 6 6')+'"/></svg>';node.setAttribute('aria-controls',target.id);node.setAttribute('aria-label',(show?'Show ':'Hide ')+name);node.title=(show?'Show ':'Hide ')+name;}
  const head=target.querySelector(index?'.inspector-head':'.panel-head'),viewer=root.querySelector('.viewer-head');
  if(index){head.prepend(control);viewer.append(opener);}else{head.append(control);viewer.prepend(opener);}
  return {control,opener};
 });
 left.replaceChildren(bar.querySelector('.brand'),identity,processing);right.replaceChildren(view,renders,$('export'));
 // Save state and the Comfy connection report status, so they live in the status bar.
 $('help').before(save,connection);
 bar.append(projectMenu,viewMenu,warning);
 let open=null,trigger=null,saveState='saved';
 function close(focus=false){if(!open)return;open.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();open=trigger=null;}
 function checks(){for(const menu of [projectMenu,viewMenu])for(const node of menu.querySelectorAll('[data-checked]')){
  const key=node.dataset.checked,work=root.querySelector('.workbench'),narrow=key==='media'?innerWidth<=1100:innerWidth<=760;
  const on=key==='height'?root.classList.contains('inspector-full'):narrow?$(key==='media'?'mediaPanel':'inspector').classList.contains('open'):!work.classList.contains('hide-'+key);
  node.setAttribute('aria-checked',String(on));
 }for(const [index,{control,opener}] of panelButtons.entries()){const key=index?'inspector':'media',work=root.querySelector('.workbench'),narrow=index?innerWidth<=760:innerWidth<=1100,on=narrow?$(index?'inspector':'mediaPanel').classList.contains('open'):!work.classList.contains('hide-'+key);control.setAttribute('aria-pressed',String(on));control.setAttribute('aria-expanded',String(on));opener.setAttribute('aria-expanded',String(on));opener.hidden=on;}}
 function show(menu,control){if(open===menu){close(true);return;}close();checks();open=menu;trigger=control;menu.hidden=false;control.setAttribute('aria-expanded','true');
  menu.style.left=Math.max(6,Math.min(control.getBoundingClientRect().left-bar.getBoundingClientRect().left,bar.clientWidth-menu.offsetWidth-6))+'px';
  menu.querySelector('button:not(:disabled)')?.focus();
 }
 for(const [control,menu] of [[project,projectMenu],[view,viewMenu]]){control.setAttribute('aria-haspopup','menu');control.setAttribute('aria-controls',menu.id);control.setAttribute('aria-expanded','false');control.onclick=()=>show(menu,control);control.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();e.stopPropagation();show(menu,control);if(e.key==='ArrowUp')[...menu.querySelectorAll('button:not(:disabled)')].at(-1)?.focus();}};}
 for(const menu of [projectMenu,viewMenu]){
  menu.addEventListener('click',e=>{if(e.target.closest('button'))close(menu.contains(document.activeElement));});
  menu.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const rows=[...menu.querySelectorAll('button:not(:disabled)')],index=rows.indexOf(document.activeElement);rows[e.key==='Home'?0:e.key==='End'?rows.length-1:(index+(e.key==='ArrowDown'?1:rows.length-1))%rows.length]?.focus();});
 }
 const outside=e=>{if(open&&!open.contains(e.target)&&!trigger.contains(e.target))close();},escape=e=>{if(open&&e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(open&&e.key==='Tab')close(true);};
 document.addEventListener('pointerdown',outside);bar.addEventListener('keydown',escape);
 const resize=()=>{close();checks();};window.addEventListener('resize',resize);
 save.onclick=()=>saveState==='conflict'?actions.conflict():saveState==='connection'?actions.sync():actions.save();
 const panelObserver=new MutationObserver(checks);for(const target of [root,root.querySelector('.workbench'),$('mediaPanel'),$('inspector')])panelObserver.observe(target,{attributes:true,attributeFilter:['class']});checks();
 window.addEventListener('pagehide',()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);panelObserver.disconnect();},{once:true});
 return {
  save(status){saveState=status.kind;save.dataset.state=status.kind;const label=({saving:'Saving…',saved:'✓ All changes saved',error:'Save failed · Retry',conflict:'Conflict · Resolve',connection:'Sync unavailable · Retry'})[status.kind]||'All changes saved';if(saveLabel.textContent!==label)saveLabel.textContent=label;save.title=status.message||'Edits save automatically. Click to save now.';},
  connection(state){const kind=state.state,healthy=kind==='connected',starting=kind==='starting';connection.dataset.state=kind;connection.textContent=healthy?'Comfy':starting?'Starting Comfy…':'Comfy offline';connection.title=healthy?'Comfy connected — connection settings':state.error||'Check the Comfy connection';connection.setAttribute('aria-label',healthy?'Comfy connected':connection.textContent);warning.hidden=healthy||starting;warning.textContent=(state.error?'Comfy connection needs attention':'Comfy offline')+' · Reconnect to generate';warning.title=state.error||'Open Comfy connection settings';},
 };
}
