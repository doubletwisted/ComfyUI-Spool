import {loaderInputs, profileIssue, resultChoices, keyInputs, sourceInputs, reusableBinding, inputSchema} from './profile.js';
import {isExactInt} from './wire.js';
import {builtinInputs,controlnetInputs,dynamicSchema} from './builtin-workflows.js';

export function matchClipInputs(target,source,recipe,definitions,fps){
 const take=source.takes.find(t=>t.id===source.takeId);if(!take||take.placeholder)return;
 const media=take.media,seconds=(source.out-source.in)/fps,settings=[],number=value=>Number(isExactInt(value)?value.__spool_int__:value),integer=value=>BigInt(isExactInt(value)?value.__spool_int__:value);let reference=false;
 for(const b of target.bindings){
  const node=recipe.prompt[b.nodeId],definition=definitions[node.class_type],schema=inputSchema(definitions,node.class_type,b.input)||dynamicSchema(definition?.input,b.input,node.inputs),options=b.options||(Array.isArray(schema?.[0])?schema[0]:schema?.[1]?.options);
  if(b.asset){
   const image=['image','firstFrame','lastFrame','reference'].includes(b.slot)&&['image','video'].includes(media.kind),video=b.slot==='video'&&media.kind==='video',audio=b.slot==='audio'&&(media.audio||media.kind==='audio');
   if(!(image||video||audio)||b.slot==='reference'&&reference)continue;
   if(b.slot==='reference')reference=true;settings.push({key:b.key,source:'selected',...(image?{frame:b.slot==='lastFrame'?'last':'first'}:{})});continue;
  }
  let value;
  if(b.role==='resolution'&&['ratio','aspect_ratio'].includes(b.input.split('.').at(-1))&&media.width&&media.height){
   const ratios=(options||[]).flatMap(value=>{const m=String(value).match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);return m?[{value,distance:Math.abs(Math.log((Number(m[1])/Number(m[2]))/(media.width/media.height)))}]:[];});value=ratios.sort((a,b)=>a.distance-b.distance)[0]?.value;
  }else if(b.role==='duration'&&b.unit==='seconds')value=seconds;
  else if(['positive','negative','seed'].includes(b.role)){const old=(source.bindings||[]).filter(old=>old.role===b.role);if(old.length===1)value=source.inputValues?.[old[0].key];else if(b.role==='positive'&&source.prompt)value=source.prompt;}
  if(value===undefined)continue;
  if(typeof value==='number'&&b.role==='duration'){const limits=schema?.[1]||{},step=number(limits.step)||(b.contract?.inputType==='INT'?1:0);if(step)value=Math.round(value/step)*step;value=Math.max(number(limits.min??-Infinity),Math.min(number(limits.max??Infinity),value));if(options?.length)value=options.filter(v=>Number.isFinite(Number(v))).sort((a,b)=>Math.abs(Number(a)-value)-Math.abs(Number(b)-value))[0]??value;}
  if(b.role==='seed'){if(!isExactInt(value)&&!Number.isSafeInteger(value))continue;const seed=integer(value),limits=schema?.[1]||{};if(limits.min!=null&&seed<integer(limits.min)||limits.max!=null&&seed>integer(limits.max))continue;}
  if(options?.length&&!options.includes(value)||!isExactInt(value)&&typeof value!==typeof recipe.prompt[b.nodeId].inputs[b.input])continue;
  target.inputValues[b.key]=value;
 }
 if(settings.length)target.shotInputs=settings;
}

export function workflowStatus(clip, workflow, recipe, definitions={}, embedded=false) {
 const name=recipe?.provenance?.workflowName||workflow?.name||(clip?.workflowVersion?'Saved workflow':'Imported footage');
 const missing=recipe&&(clip.bindings||[]).some(b=>b.asset&&!(clip.shotInputs||[]).some(s=>s.key===b.key)&&(!clip.inputValues?.[b.key]||recipe.inputRecovery?.missing?.some(m=>b.nodeId===m.nodeId&&b.input===m.input&&m.sources.includes(clip.inputValues?.[b.key]))));
 const reason=clip?.generationBase&&clip.generationBase.takeId!==clip.takeId?'Use the take again to update generation settings.':!clip?.workflowVersion?(clip?.generationBase?'This take has no executable metadata. Choose a workflow from the library.':'Capture an executable workflow first.'):!recipe?'Reopen the saved recipe before queueing.':
  (Object.keys(definitions).length?profileIssue(recipe.prompt,definitions,recipe.workflow):null)||(!recipe.result?'Choose the clip output first.':null)||(missing?'Choose source media in the Inspector.':null);
 return {name,reason,ready:!reason,problem:!!reason&&!!(clip?.generationBase||clip?.workflowVersion),note:!reason?'Ready to generate':clip?.generationBase||clip?.workflowVersion?reason:embedded?'Use this take to set up generation':workflow?'Prepare this workflow to generate':'Use a take or choose a workflow from the library'};
}

// Project-edit owns reservations and revisions; this module owns capture decisions
// and completion. The dialog paints questions; save applies editor-owned mutations.
export function createWorkflowSetup({edit, flush, clip, dialog, save}) {
 async function start({capture,name,clipId=null,index,automatic=false,exact=false,definitions={},previous=null,takeId=null,replaceInputs=false,builtin=null,replaceWorkflow=false,placement=null,preparedVersion=null}) {
  const session=edit.beginCapture({capture,name,index,clipId,takeId,replaceInputs,preparedVersion});
  try {
   await flush();
   if(!session.owns())return;
   if(typeof capture==='function')capture=await capture();
   if(!session.owns())return;
   if(takeId&&capture===null){
    if(!session.commit())return;
    const unlock=dialog.lock();
    try{await save({session,capture:null,name,clipId,index,mode:'take'});}
    finally{session.finish();unlock();}
    return session;
   }
   session.workflowId=capture.importedWorkflowId;delete capture.importedWorkflowId;
   session.capture=capture;
   session.replaceWorkflow=replaceWorkflow;session.placement=placement;
   const target=clipId?clip(clipId):null;
   if(clipId&&!target)throw Error('This clip was removed.');
   definitions=capture.definitions||definitions;
   const choices=capture.prompt?resultChoices(capture.prompt,definitions):[];
   const issue=profileIssue(capture.prompt,definitions,capture.workflow)||(!choices.length?'No supported output found. Open in Comfy and choose a supported saver.':null);
   let result=(takeId?capture:previous)?.result;
   result=choices.find(r=>r.nodeId===result?.nodeId&&r.group===result?.group)||(choices.length===1?choices[0]:null);
   if(takeId&&!result&&capture.result&&capture.prompt?.[capture.result.nodeId])result=capture.result;
   if(builtin){result=preparedVersion?choices.find(r=>r.nodeId===capture.result.nodeId&&r.group===capture.result.group):choices.filter(r=>capture.prompt[r.nodeId].class_type==='SaveVideo').at(-1);if(issue||!result)throw Error(issue||'This template needs a final SaveVideo output.');capture.resultOnly=true;}
   const candidates=[];
   if(exact) {
    for(const [nodeId,node] of Object.entries(capture.prompt))for(const [input,value] of Object.entries(node.inputs)) {
     if(['string','number','boolean'].includes(typeof value)||isExactInt(value))candidates.push({nodeId,input,value,old:(capture.bindings||[]).find(b=>b.nodeId===nodeId&&b.input===input)});
    }
   }
   const savers=exact?Object.entries(capture.prompt).filter(([,node])=>definitions[node.class_type]?.output_node):[];
   if(exact&&!savers.length)throw Error('This prompt has no installed output node');
   const controls=()=>{
    if(!result||issue)return [];
    if(builtin)return preparedVersion?capture.bindings.map(b=>({...b,value:capture.prompt[b.nodeId].inputs[b.input]})):builtinInputs(capture,definitions,result,builtin);
    const held=replaceInputs?(previous?.bindings||[]).flatMap(b=>{
     const node=capture.prompt[b.nodeId],value=node?.inputs[b.input];
     return node?.class_type===previous.prompt[b.nodeId]?.class_type&&(['string','number','boolean'].includes(typeof value)||isExactInt(value))?[{...b,value}]:[];
    }):[];
    let inputs=[...held,...keyInputs(capture.prompt,definitions,result).filter(b=>!held.some(old=>old.nodeId===b.nodeId&&old.input===b.input))];
    if(replaceInputs){
     const sources=sourceInputs(capture.prompt,definitions,result).map(source=>{
      const mapped=inputs.find(b=>b.nodeId===source.nodeId&&b.input===source.input),node=capture.prompt[source.nodeId];
      const title=node._meta?.title,label=title||(!mapped?.ambiguous&&mapped?.slot!=='ambiguous'?mapped?.label:null)||source.label;
      return {...mapped,...source,label,...(mapped?.slot&&mapped.slot!=='ambiguous'?{slot:mapped.slot}:{}),ambiguous:false};
     });
     const labels=new Map();for(const b of sources){const same=labels.get(b.label)||[];same.push(b);labels.set(b.label,same);}
     for(const same of labels.values())if(same.length>1)for(const b of same)b.label+=' · '+b.nodeId;
     inputs=[...sources,...inputs.filter(b=>!b.asset)];
    }
    return [...inputs,...controlnetInputs(capture.prompt,definitions).filter(b=>!inputs.some(old=>old.nodeId===b.nodeId&&old.input===b.input))];
   };
   function paint() {
    const inputs=controls();
    Object.assign(session,{definitions,choices,result,issue});
    dialog.show({session,capture,name,target,exact,candidates,savers,choices,result,issue,
     essential:inputs.filter(b=>!b.advanced),optional:inputs.filter(b=>b.advanced),
     chooseOutput(index){if(!session.owns())return;result=index===''?null:choices[Number(index)];paint();},confirm});
   }
   async function confirm(mode, selection={}) {
    if(!session.owns()||session.saving)return;
    session.saving=true;let unlock;
    try {
     if(clipId&&!clip(clipId))throw Error('This clip was removed.');
     if(exact) {
      capture.bindings=(selection.bindings||[]).map(({index,label})=>{
       const b=candidates[index];
       return {key:b.old?.key||crypto.randomUUID(),nodeId:b.nodeId,input:b.input,label,asset:loaderInputs[capture.prompt[b.nodeId].class_type]===b.input};
      });
      capture.result=selection.result;
      capture.provenance={...capture.provenance,configuredAt:new Date().toISOString()};
     } else {
      const inputs=controls(),essential=inputs.filter(b=>!b.advanced),optional=inputs.filter(b=>b.advanced);
      if(mode!=='graph'&&((issue&&!takeId)||!result))throw Error(issue||'Choose the clip output first.');
      const chosen=mode==='inputs'?(automatic?(takeId||replaceInputs?inputs.filter(b=>!b.ambiguous):essential):[...(selection.essential||[]).map(i=>essential[i]),...(selection.optional||[]).map(i=>optional[i])]):[];
      capture.bindings=chosen.map(({value,...b})=>({...b,key:target?.bindings?.find(old=>replaceInputs?old.nodeId===b.nodeId&&old.input===b.input&&previous?.prompt[old.nodeId]?.class_type===capture.prompt[b.nodeId]?.class_type:reusableBinding(old,b))?.key||crypto.randomUUID()}));
      capture.result=result&&{nodeId:result.nodeId,group:result.group,index:result.index};
      capture.provenance={...capture.provenance,keyInputProfile:'spool-key-inputs-1',workflowName:name,...(builtin?{builtinTemplate:builtin.id,builtinTask:builtin.task}:{})};
     }
     delete capture.definitions;
     await flush();
     if(clipId&&!clip(clipId))throw Error('This clip was removed.');
     if(!session.commit())return;
     unlock=dialog.lock();dialog.close();
     await save({session,capture,name,clipId,index,mode,keep:!takeId&&!replaceInputs&&(automatic||selection.keep),exact,automatic});
    } catch(error) {
     session.saving=false;session.error=error;
     if(error.status!==409)dialog.error(error);
     if(builtin)throw error;
    } finally {
     if(session.finish(!!session.added))unlock?.();
    }
   }
   if(builtin||automatic&&!exact&&(!issue||takeId&&result)&&(choices.length===1||result&&(takeId||replaceInputs&&previous?.result))&&!controls().some(b=>b.slot==='ambiguous'))await confirm('inputs');
   else {automatic=false;paint();}
   return session;
  } catch(error) {session.cancel();throw error;}
 }
 return {start};
}
