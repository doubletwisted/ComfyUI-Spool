// Isolated Layout controls QA. Source/keyboard gestures are synthetic here.
(async()=>{
 const w=window,d=w.document,n=w.spoolNative,$=id=>d.getElementById(id),checks=[],compact=$('editor').classList.contains('compact');
 if(n.state.project!=='Layout controls QA')throw Error('Use Layout controls QA');
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);},rect=selector=>d.querySelector(selector).getBoundingClientRect(),settle=()=>new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r))),key=(el,key)=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})),read=()=>w.fetch('/spool/api/projects/'+n.projectKey).then(r=>r.json());
 n.selectClip('layout');await n.flush();await settle();const before=await read();
 $('projectMenu').click();await settle();check(rect('#projectCommands').bottom<=rect('#editor').bottom&&rect('#projectCommands').right<=rect('#editor').right,'Project menu fits inside the full editor and native dock');key(d.activeElement,'Escape');
 check($('inspectorHeight').getAttribute('aria-pressed')==='true','Inspector defaults to full height');
 check(Math.abs(rect('#inspector').top-rect('#workbench').top)<2&&Math.abs(rect('#inspector').bottom-rect('.timeline-shell').bottom)<2,'Inspector spans viewer and timeline without covering them');
 check(rect('.timeline-shell').right<=rect('#inspector').left+1,'Timeline stays beside the inspector');
 check($('addShot').hidden,'Populated timeline has no trailing Add shot tile');
 check($('inspectorContent').scrollWidth<=$('inspectorContent').clientWidth,'Inspector controls fit without horizontal overflow');
 check([...d.querySelectorAll('.timeline-toolbar button')].filter(b=>b.getBoundingClientRect().width).every(b=>b.getBoundingClientRect().right<=rect('.timeline-toolbar').right+1),'Timeline toolbar buttons fit beside the full-height inspector');
 const source=d.querySelector('.native-source-preview');check(source.getBoundingClientRect().width<=73&&source.getBoundingClientRect().height<=45,'Source preview uses a small thumbnail beside its filename');
 if(!compact)check(rect('.shot-preview').width<=65&&rect('.shot-preview').height<=40,'Selected-shot preview is compact beside workflow selection');
 check(!!$('generate').getBoundingClientRect().height&&rect('#generate').bottom<=rect('#inspector').bottom,'Generate stays visible at the panel bottom');
 const node=d.querySelector('[data-clip="layout"]');n.selectClip('other');n.selectClip('layout',false,{ctrlKey:true});
 check(node===d.querySelector('[data-clip="layout"]')&&d.querySelectorAll('.timeline-clip[aria-pressed="true"]').length===2,'Selection retains timeline nodes and accessible multi-selection');n.selectClip('layout');
 const h=d.querySelector('[data-clip="layout"] [data-trim="out"]');key($('editor'),'Shift');check(h.dataset.gesture==='ripple','Shift updates retained trim handles to ripple mode');$('editor').dispatchEvent(new w.KeyboardEvent('keyup',{key:'Shift',bubbles:true}));check(h.dataset.gesture==='trim','Releasing Shift restores trim cursors');
 const width=rect('#inspector').width;key($('inspectorResize'),'ArrowLeft');await settle();check(rect('#inspector').width>width,'Inspector width still resizes in full-height mode');$('inspectorResize').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));await settle();
 $('inspectorHeight').click();await settle();check($('inspector').parentElement===$('workbench')&&Math.abs(rect('#inspector').bottom-rect('#workbench').bottom)<2,'Toggle restores viewer-only inspector height');
 check(rect('.timeline-shell').width>rect('#workbench').width-2,'Viewer-height mode restores full-width timeline');
 await n.flush();check(JSON.stringify(await read())===JSON.stringify(before),'Layout, resizing and selection leave project contents and revision unchanged');
 const field=d.querySelector('[data-native-control="'+n.state.clips[0].bindings.findIndex(b=>b.key==='prompt')+'"]');field.value='Edited prompt remains saved';field.dispatchEvent(new w.Event('change',{bubbles:true}));n.selectClip('other');await n.flush();check((await read()).document.clips[0].inputValues.prompt==='Edited prompt remains saved','View-only selection preserves pending authored input saves');
 n.selectClip('layout');const count=n.state.clips.length;n.duplicate();await n.flush();check(n.state.clips.length===count+1,'Duplicate remains a saved edit');n.undo();await n.flush();check(n.state.clips.length===count,'Undo restores the edit after retained-node selection');n.redo();await n.flush();check(n.state.clips.length===count+1,'Redo restores the duplicate');n.undo();await n.flush();n.selectClip('layout');
 const actions=$('inspectorContent').querySelectorAll('.creative-action');check([...actions].every(b=>b.title&&w.getComputedStyle(b.querySelector('small')).display==='none'),'Compact actions retain explanations as tooltips');
 return {compact,checks,project:n.projectKey,viewerHeight:true};
})()
