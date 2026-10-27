(async()=>{
 const n=spoolNative,$=selector=>document.querySelector(selector),checks=[],shot=()=>n.state.clips.find(c=>c.id==='shot'),B=await import('/spool/ui/bridge.js');
 const check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const field=label=>[...document.querySelectorAll('.field')].find(f=>f.firstElementChild?.textContent===label)?.querySelector('[data-native-control]');
 n.selectClip('shot');await n.flush();if(!$('#inspector').getClientRects().length)$('#showRightPanel').click();
 const version=shot().workflowVersion,revision=n.revision,clip=JSON.stringify({takeId:shot().takeId,takes:shot().takes,in:shot().in,out:shot().out,shotInputs:shot().shotInputs});
 check('Legacy six-binding recipes show ControlNet strength and interval immediately',shot().bindings.length===6&&field('Control strength').value==='1'&&field('Control start').value==='0'&&field('Control end').value==='1');
 check('Pose extraction exposes the actual wired body, face, hand, feet and detector controls',field('Draw hands').value==='true'&&field('Draw body')&&field('Draw face')&&field('Draw feet')&&field('Draw head')&&field('Pose confidence').value==='0.51'&&field('Maximum people').value==='2');
 check('Viewing extra controls does not rewrite or dirty an existing project',n.revision===revision&&shot().workflowVersion===version&&!n.dirty);
 const set=async(label,value)=>{field(label).value=value;field(label).dispatchEvent(new Event('change',{bubbles:true}));await n.flush();};
 await set('Control strength','0.65');const expanded=shot().workflowVersion;
 check('The first edit publishes a new immutable recipe with the new bindings',expanded!==version&&shot().bindings.some(b=>b.nodeId==='172'&&b.input==='strength')&&field('Control strength').value==='0.65');
 const old=await fetch('/spool/api/workflows/'+version).then(r=>r.json());check('The previous recipe retains its original bindings and defaults',old.bindings.length===6&&old.prompt['172'].inputs.strength===1);
 n.undo();await n.flush();check('Undo restores the old recipe and the visible control value',shot().workflowVersion===version&&shot().bindings.length===6&&field('Control strength').value==='1');
 n.redo();await n.flush();check('Redo restores the expanded recipe and exact control edit',shot().workflowVersion===expanded&&field('Control strength').value==='0.65');
 await set('Draw hands','false');await set('Pose confidence','0.7');await set('Maximum people','1');
 const saved=await fetch('/spool/api/projects/'+n.projectKey).then(r=>r.json()),c=saved.document.clips.find(c=>c.id==='shot');
 check('Saved controls include boolean and numeric pose inputs',c.bindings.filter(b=>['draw_hands','score_threshold','max_detections'].includes(b.input)).every(b=>c.inputValues[b.key]===({draw_hands:false,score_threshold:.7,max_detections:1})[b.input]));
 check('Editing controls preserves the chosen footage, source route and timeline trim',JSON.stringify({takeId:shot().takeId,takes:shot().takes,in:shot().in,out:shot().out,shotInputs:shot().shotInputs})===clip);
 const channel=B.openChannel('controlnet-controls-qa'),opened=[],stop=B.serve(channel,{ping:()=>({connected:true,workflowLinks:true}),open:data=>{opened.push(data);return {opened:true};}});
 try{
  await n.editWorkflow();const payload=opened.at(-1);
  check('Edit in Comfy sends the authored graph with its notes and pose subgraph',payload?.workflow.nodes.length===old.workflow.nodes.length&&payload.workflow.nodes.some(n=>n.type==='MarkdownNote')&&payload.workflow.definitions.subgraphs.length===old.workflow.definitions.subgraphs.length&&payload.preferWorkflow);
  check('The Comfy input controls contain the current ControlNet and pose values',payload.controls.some(b=>b.nodeId==='172'&&b.input==='strength'&&b.value===.65)&&payload.controls.some(b=>b.nodeId==='700:672'&&b.input==='draw_hands'&&b.value===false));
  check('The editable graph receives the prepared video filename rather than an empty placeholder',payload.controls.some(b=>b.nodeId==='174'&&b.input==='file'&&b.value.endsWith('.mp4')&&b.value===payload.prompt['174'].inputs.file));
 }finally{stop();channel.close();}
 check('Inspecting and editing controls submits no render jobs',!n.state.jobs.length);
 return {checks};
})()
