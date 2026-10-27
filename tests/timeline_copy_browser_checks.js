// The runner first makes a trusted Alt-drag, releasing Alt before the drop.
// Further edit cases use pointer events against the same isolated project.
(async()=>{
 const n=spoolNative,w=window,d=document,T=await import('/spool/ui/timeline.js'),checks=[],$=id=>d.getElementById(id),copy=x=>JSON.parse(JSON.stringify(x));
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);},eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),initial=__copyOriginal,original=initial.clips[0],row=id=>T.rowFor(n.state,id),clip=id=>n.state.clips.find(c=>c.id===id);
 const duplicated=()=>n.state.clips.filter(c=>!initial.clips.some(o=>o.id===c.id)),audioCopies=()=>n.state.audioClips.filter(c=>!initial.audioClips.some(o=>o.id===c.id));
 check('Trusted Alt-drag makes exactly one new clip',duplicated().length===1&&n.state.clips.length===3);
 const result=copy(duplicated()[0]),resultId=result.id;
 check('The copy lands at the pointer position after Alt is released',row(resultId).start===72);
 check('The source and neighboring clip keep their positions and data',eq(clip('shot'),original)&&row('shot').start===0&&row('next').start===144);
 check('The copy retains its workflow, takes, chosen take and source trim',result.workflowVersion===original.workflowVersion&&result.workflow===original.workflow&&eq(result.takes,original.takes)&&result.takeId===original.takeId&&result.in===original.in&&result.out===original.out);
 check('The copy retains receipt lineage and is the selected clip',result.takeSourceIds.includes('shot')&&n.state.selected===resultId&&n.state.selection.length===1);
 check('One copy survives every drag frame',__drag.samples.every(s=>Object.keys(s.box).length===3));
 check('Releasing Alt does not change the locked gesture',__drag.samples.every(s=>s.drag.kind==='move'&&s.drag.ids===1));
 check('Drop clears the copy cursor and feedback',!n.drag&&!$('editor').classList.contains('copying-clip')&&!d.querySelector('.drag-ghost'));
 check('History labels the action as duplication',$('undo').title.startsWith('Undo Duplicate '));
 await n.flush();let saved=await(await fetch('/spool/api/projects/'+n.projectKey)).json();
 check('The saved project retains the copy and immutable workflow',saved.document.clips.some(c=>c.id===resultId&&c.workflowVersion===original.workflowVersion)&&!n.dirty);
 $('editor').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await n.flush();check('One Ctrl+Z restores the original edit and selection',eq(n.state.clips,initial.clips)&&n.state.selected==='shot');
 $('editor').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));await n.flush();check('One Ctrl+Shift+Z restores the same copy and placement',duplicated().length===1&&duplicated()[0].id===resultId&&row(resultId).start===72);
 n.undo();await n.flush();

 const sc=$('timelineScroll'),capture=sc.setPointerCapture;sc.setPointerCapture=()=>{};
 const node=id=>d.querySelector('[data-clip="'+id+'"],[data-audio="'+id+'"]'),key=(key,mods={})=>$('editor').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...mods}));
 const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const pointer=(target,type,x,y,alt)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:957,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,altKey:alt}));
 const gesture=async(id,frames,{alt=true,edge=null,cancel=null,target=null,linked=false}={})=>{
  const body=linked?d.querySelector('[data-linked-audio="'+id+'"]'):node(id),handle=edge?body.querySelector('[data-trim="'+edge+'"],[data-audio-trim="'+edge+'"]'):body,r=handle.getBoundingClientRect(),c=clip(id)||n.state.audioClips.find(c=>c.id===id),scale=node(id).getBoundingClientRect().width/(c.out-c.in),x=r.x+r.width/2,y=r.y+r.height/2,toY=target?d.querySelector('[data-video-track="'+target+'"]').getBoundingClientRect().top+20:y;
  pointer(handle,'pointerdown',x,y,alt);pointer(w,'pointermove',x+frames*scale,toY,alt);await frame();
  const during={count:n.state.clips.length,audio:n.state.audioClips.length,cursor:w.getComputedStyle($('editor')).cursor,ghost:d.querySelector('.drag-ghost')?.textContent};
  if(cancel==='escape')key('Escape');else if(cancel==='pointer')pointer(w,'pointercancel',x+frames*scale,toY,alt);else if(cancel==='blur')w.dispatchEvent(new Event('blur'));
  pointer(w,'pointerup',x+frames*scale,toY,alt);await n.flush();return during;
 };
 const undo=async()=>{n.undo();await n.flush();};
 try{
  const title=$('undo').title;await gesture('shot',0);
  check('Alt-click without dragging creates no copy or history step',n.state.clips.length===2&&$('undo').title===title);
  for(const cancel of ['escape','pointer','blur']){
   const during=await gesture('shot',72,{cancel});
   check(cancel+' cancellation removes the preview copy and preserves originals',during.count===3&&eq(n.state.clips,initial.clips)&&!n.drag&&!$('editor').classList.contains('copying-clip')&&$('undo').title===title);
   check(cancel+' preview shows the copy cursor and feedback',during.cursor==='copy'&&during.ghost?.startsWith('Copy 1 clip'));
  }
  await gesture('shot',72,{alt:false});check('Dragging without Alt still moves the original',n.state.clips.length===2&&row('shot').start===72);await undo();
  await gesture('shot',12,{edge:'out'});check('Alt on a free edge still trims without copying',n.state.clips.length===2&&clip('shot').out===72&&row('next').start===144);await undo();
  await gesture('next',-96,{alt:false});await gesture('shot',6,{edge:'out'});
  check('Alt at a shared cut still rolls both clips',n.state.clips.length===2&&clip('shot').out===66&&clip('next').in===6&&row('next').start===54);await undo();await undo();
  await gesture('shot',0,{target:2});
  check('Vertical Alt-drag copies onto another video track',duplicated().length===1&&T.videoTrack(duplicated()[0])===2&&row(duplicated()[0].id).start===0&&row('shot').start===0);await undo();
  n.selectClip('next');await gesture('next',96,{linked:true});
  const linked=duplicated()[0];
  check('Dragging linked sound copies its video with the same trim and audio',!!linked&&row(linked.id).start===240&&T.linkedAudio(linked)&&linked.in===clip('next').in&&linked.out===clip('next').out&&eq(T.audioSettings(linked),T.audioSettings(clip('next')))&&n.state.audioClips.length===1);await undo();
  await gesture('music',72);const sound=audioCopies()[0];
  check('Independent audio can be Alt-dragged with its source range, mix and fades',!!sound&&sound.start===72&&sound.in===6&&sound.out===42&&eq(sound.audio,initial.audioClips[0].audio)&&n.state.audioClips[0].start===0);await undo();
  n.selectClip('shot');const audio=node('music'),r=audio.getBoundingClientRect();audio.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,ctrlKey:true,clientX:r.x+15,clientY:r.y+15}));
  await gesture('shot',72);
  check('Alt-drag copies a mixed selection with aligned offsets',duplicated().length===1&&audioCopies().length===1&&row(duplicated()[0].id).start===72&&audioCopies()[0].start===72&&n.state.selection.length===2);
  await undo();check('One Undo removes the whole copied selection',eq(n.state.clips,initial.clips)&&eq(n.state.audioClips,initial.audioClips));
  n.selectClip('shot');n.selectClip('next',false,{ctrlKey:true});await gesture('shot',240);
  const group=duplicated();check('A video group copies once with its spacing and linked sound intact',group.length===2&&row(group[0].id).start===240&&row(group[1].id).start===384&&T.linkedAudio(group[1])&&n.state.selection.length===2&&row('next').start===144);await undo();
  n.selectClip('shot');await gesture('shot',72);const first=duplicated()[0];n.selectClip(first.id);await gesture(first.id,192);const second=duplicated().find(c=>c.id!==first.id);
  check('Copying a copy retains both receipt lineage sources',!!second&&second.takeSourceIds.includes(first.id)&&second.takeSourceIds.includes('shot'));
  check('All final timeline gaps are nonnegative',n.state.clips.every(c=>(c.gapBefore||0)>=0));
  check('Copying never starts generation',n.state.jobs.length===initial.jobs.length);
 }finally{sc.setPointerCapture=capture;}
 return {checks,kind:'Trusted Alt-drag plus video, linked sound, audio, mixed selection and cancellation regressions; no generation'};
})()
