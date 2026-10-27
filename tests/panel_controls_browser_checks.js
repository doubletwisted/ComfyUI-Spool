(async()=>{
 const n=spoolNative,d=document,$=id=>d.getElementById(id),checks=[],check=(label,value)=>{if(!value)throw Error(label);checks.push(label);},frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 await n.flush();const before=JSON.stringify(n.state.clips),revision=n.revision,visible=el=>!!el.getClientRects().length;
 check('Panel controls have been removed from the topbar',!d.querySelector('.topbar .panel-toggle'));
 for(const side of ['Left','Right']){
  const control=$('toggle'+side+'Panel'),opener=$('show'+side+'Panel'),panel=$(side==='Left'?'mediaPanel':'inspector');
  check(side+' collapse button belongs to its panel header',control.parentElement===panel.querySelector(side==='Left'?'.panel-head':'.inspector-head')&&control.getAttribute('aria-controls')===panel.id);
  check(side+' reopening arrow is on the viewer edge',opener.parentElement===$('viewer').querySelector('.viewer-head')&&(side==='Left'?opener===opener.parentElement.firstElementChild:opener===opener.parentElement.lastElementChild));
  if(!visible(panel)){check(side+' hidden panel has a visible reopening arrow',visible(opener));opener.click();await frame();}
  check(side+' expanded panel has a small visible collapse button',visible(panel)&&visible(control)&&control.offsetWidth<=28&&control.offsetHeight<=28&&opener.hidden);
  control.click();await frame();
  check(side+' header button hides its panel and exposes the reopening arrow',!visible(panel)&&visible(opener)&&control.getAttribute('aria-expanded')==='false');
  check(side+' keyboard focus moves to the reopening arrow',d.activeElement===opener);
  opener.click();await frame();
  check(side+' reopening arrow restores the panel and returns focus to its header',visible(panel)&&opener.hidden&&d.activeElement===control&&control.getAttribute('aria-expanded')==='true');
  const viewer=$('viewer').getBoundingClientRect(),button=control.getBoundingClientRect();check(side+' panel button stays out of the viewer',button.right<=viewer.left||button.left>=viewer.right||innerWidth<=1100);
 }
 // Hide both panels together, including after switching to viewer-height Inspector.
 for(const height of ['full','viewer']){
  if(height==='viewer'){$('inspectorHeight').click();await frame();}
  for(const side of ['Left','Right'])if(visible($(side==='Left'?'mediaPanel':'inspector'))){$('toggle'+side+'Panel').click();await frame();}
  check(height+': both hidden panels can be reopened',visible($('showLeftPanel'))&&visible($('showRightPanel')));
  if(innerWidth>1100){const viewer=$('viewer').getBoundingClientRect(),editor=$('editor').getBoundingClientRect(),takes=$('takes').getBoundingClientRect(),rail=Math.abs(takes.top-viewer.top)<2?takes.width:0,icons=d.querySelector('.media-rail')?.getBoundingClientRect().width||0;check(height+': hiding both panels releases the workspace width',icons<=40&&viewer.width+rail+icons>editor.width-40);}
  $('showLeftPanel').click();await frame();$('showRightPanel').click();await frame();
  check(height+': arrows work repeatedly as panels open and close',visible($('inspector'))&&(visible($('mediaPanel'))||innerWidth<=760));
 }
 if(!$('editor').classList.contains('inspector-full')){$('inspectorHeight').click();await frame();}
 $('workspaceMenu').click();$('toggleInspector').click();await frame();
 check('The View menu stays synchronized with the panel controls',visible($('showRightPanel'))&&$('toggleInspector').getAttribute('aria-checked')==='false');
 $('showRightPanel').click();await frame();
 if(innerWidth>1100){
  $('toggleLeftPanel').click();await frame();const rail=d.querySelector('.media-rail'),viewer=$('viewer').getBoundingClientRect();
  check('A hidden media pool leaves an icon rail',visible(rail)&&rail.getBoundingClientRect().width<=40&&!visible($('mediaPanel')));
  rail.querySelector('[data-rail-tab="media"]').click();await frame();const pool=$('mediaPanel').getBoundingClientRect();
  check('The icon rail opens the pool over the viewer without moving it',visible($('mediaPanel'))&&$('mediaPanel').dataset.tab==='media'&&pool.right>viewer.left&&$('viewer').getBoundingClientRect().left===viewer.left);
  d.querySelector('.timeline-shell').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await frame();
  check('Clicking elsewhere closes the floating pool',!visible($('mediaPanel'))&&visible(rail));
  $('dockMedia').click();await frame();d.querySelector('[data-bin-tab="workflows"]').click();await frame();
  check('The rail can dock the pool again',visible($('mediaPanel'))&&!visible(rail)&&localStorage.getItem('spool-media-collapsed')==='0');
 }
 await n.flush();check('Panel controls do not change the project or its revision',JSON.stringify(n.state.clips)===before&&n.revision===revision);
 check('Panel controls fit within the viewport',d.documentElement.scrollWidth<=innerWidth);
 return {checks};
})()
