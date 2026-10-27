import {isExactInt as exact} from './wire.js';
// Advisory UI profiles over Comfy's API prompt, never editor widget positions.
// Dispatch, dependency freezing and accepted-output validation remain backend-owned.
export const loaderInputs={LoadImage:'image',LoadImageMask:'image',LoadAudio:'audio',LoadVideo:'file',VHS_LoadVideo:'video'};
const saverContracts={SaveImage:['images','IMAGE','images'],PreviewImage:['images','IMAGE','images'],SaveVideo:['video','VIDEO','images'],VHS_VideoCombine:['images','IMAGE','gifs']};
export const inputSchema=(definitions,type,name)=>{
 const inputs=definitions[type]?.input,schema=inputs?.required?.[name]||inputs?.optional?.[name];
 if(schema)return schema;
 const [group,member]=name.split('.'),grown=inputs?.required?.[group]?.[1]?.template;
 return grown?.names?.includes(member)?grown.input?.required?.value:null;
};
const literal=value=>['string','number','boolean'].includes(typeof value)||exact(value);
// Comfy's serializer omits class_type for uninstalled nodes; the editor graph still names them.
function graphType(workflow,id){
 const local=String(id).split(':').at(-1);
 for(const nodes of [workflow?.nodes||[],...(workflow?.definitions?.subgraphs||[]).map(s=>s.nodes||[])]){const node=nodes.find(n=>String(n.id)===local);if(node?.type)return node.type;}
 return null;
}
export function profileIssue(prompt,definitions,workflow=null){
 if(!prompt||Array.isArray(prompt.nodes))return 'Open this workflow in Comfy, then Apply to clip.';
 for(const [id,node] of Object.entries(prompt)){
  if(node.class_type==='VHS_BatchManager'||node.inputs?.meta_batch!=null)return 'Use an unbatched workflow; video batch continuation is not supported here.';
  if(!definitions[node.class_type])return 'Install the missing node: '+(node.class_type||graphType(workflow,id)||'unknown type (node '+id+')');
  if(node.class_type.includes('Load')&&!loaderInputs[node.class_type]&&['image','video','audio','file','path'].some(k=>k in node.inputs))return 'This source loader needs a supported file adapter: '+node.class_type;
  if(node.class_type==='VHS_VideoCombine'&&!String(node.inputs.format||'').startsWith('video/'))return 'Choose a video format in Comfy before capturing.';
 }
 return null;
}
export function resultChoices(prompt,definitions){
 return Object.entries(prompt||{}).flatMap(([nodeId,node])=>{
  const contract=saverContracts[node.class_type],schema=contract&&inputSchema(definitions,node.class_type,contract[0]);
  if(!contract||!definitions[node.class_type]?.output_node||schema?.[0]!==contract[1])return [];
  return [{nodeId,group:contract[2],index:0,label:node._meta?.title||definitions[node.class_type].display_name||node.class_type}];
 });
}
// A selected filename is explicit even when a switch or multiple images prevents
// inferring first/last/reference roles. Follow connections without choosing a branch.
export function sourceInputs(prompt,definitions,result){
 const connected=new Set();
 function visit(id){
  if(connected.has(id)||!prompt[id])return;connected.add(id);
  for(const value of Object.values(prompt[id].inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]))visit(value[0]);
 }
 visit(result?.nodeId);
 return [...connected].flatMap(nodeId=>{
  const node=prompt[nodeId],input=loaderInputs[node.class_type],schema=input&&inputSchema(definitions,node.class_type,input),value=node.inputs[input];
  if(!schema||typeof value!=='string')return [];
  const slot=node.class_type==='LoadImageMask'?'mask':input==='image'?'image':input==='audio'?'audio':'video';
  return [{nodeId,input,value,slot,role:'source',asset:true,advanced:false,label:node._meta?.title||'Source '+slot,
   contract:{adapter:'spool-key-inputs-1',classType:node.class_type,inputType:Array.isArray(schema[0])?'COMBO':schema[0],relationship:[]}}];
 });
}
export function keyInputs(prompt,definitions,result){
 const definition=id=>definitions[prompt[id]?.class_type];
 const accepts=(schema,type)=>typeof schema?.[0]==='string'&&(schema[0]==='*'||schema[0].split(',').includes(type)||schema[0]==='COMFY_MATCHTYPE_V3'&&(!schema[1]?.template?.allowed_types||schema[1].template.allowed_types.split(',').includes(type)));
 function outputType(id,slot,seen=new Set()){
  const d=definition(id),type=d?.output?.[slot],key=JSON.stringify([id,slot]);
  if(type!=='COMFY_MATCHTYPE_V3')return type;
  if(seen.has(key))return null;seen.add(key);
  const template=d.output_matchtypes?.[slot],types=[];
  if(!template)return null;
  for(const [name,value] of Object.entries(prompt[id].inputs)){
   const schema=inputSchema(definitions,prompt[id].class_type,name);
   if(schema?.[1]?.template?.template_id!==template)continue;
   if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!Number.isInteger(value[1]))return null;
   const actual=outputType(value[0],value[1],new Set(seen));if(!actual||!accepts(schema,actual))return null;types.push(actual);
  }
  return types.length&&new Set(types).size===1?types[0]:null;
 }
 const links=(nodeId,name)=>{
  const value=prompt[nodeId]?.inputs[name],schema=inputSchema(definitions,prompt[nodeId]?.class_type,name);
  if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!Number.isInteger(value[1])||value[1]<0||!schema)return null;
  const output=outputType(value[0],value[1]);
  return output&&accepts(schema,output)?value:null;
 };
 const edges=id=>Object.keys(prompt[id]?.inputs||{}).flatMap(input=>{const link=links(id,input);return link?[{nodeId:id,input,slot:link[1],from:link[0],type:outputType(link[0],link[1])}]:[];});
 // Lazy branches, selectors and unnamed data alternatives do not identify the
 // active source. Numeric a/b inputs on math nodes are not media alternatives.
 const opaque=id=>Object.keys(prompt[id]?.inputs||{}).some(name=>inputSchema(definitions,prompt[id].class_type,name)?.[1]?.lazy||/^(switch|select|selector|choice|which|branch|on_true|on_false)(_|$)/.test(name))||edges(id).some(e=>['IMAGE','VIDEO','LATENT','CONDITIONING','*'].includes(e.type)&&/^(a|b|input_?\d+|option_?\d+)$/.test(e.input));
 const reachable=new Set();
 function visit(id){if(reachable.has(id)||!prompt[id])return;reachable.add(id);if(!opaque(id))for(const e of edges(id))visit(e.from);}
 visit(result?.nodeId);
 const roles=new Map(),usedEdges=new Set();
 const edgeKey=e=>JSON.stringify([e.nodeId,e.input,e.slot]);
 const relationship=path=>path.map(({nodeId,input,slot})=>({nodeId,input,slot}));
 function conditioning(edge,role,path,seen){
  const id=edge.from,key=id+':'+edge.slot;if(seen.has(key)||opaque(id))return;
  const next=new Set(seen).add(key),node=prompt[id],d=definition(id),chain=[edge,...path];
  const textInputs=['text','prompt'].filter(input=>inputSchema(definitions,node.class_type,input)?.[0]==='STRING'&&literal(node.inputs[input]));
  if(textInputs.length===1&&d.output[edge.slot]==='CONDITIONING'){
   const entry=roles.get(id)||{roles:new Set(),paths:[],input:textInputs[0]};entry.roles.add(role);entry.paths.push(chain);roles.set(id,entry);
   for(const e of chain)usedEdges.add(edgeKey(e));return;
  }
  const incoming=edges(id).filter(e=>e.type==='CONDITIONING'),outputRole=d.output_name?.[edge.slot];
  let selected;
  if(['positive','negative'].includes(outputRole))selected=incoming.filter(e=>e.input===outputRole);
  else if(d.output.filter(t=>t==='CONDITIONING').length===1)selected=incoming;
  else if(incoming.length===1)selected=incoming;
  else return;
  for(const e of selected)conditioning(e,role,chain,next);
 }
 for(const id of Object.keys(prompt)){
  if(opaque(id)||!definition(id)?.output?.some(t=>['LATENT','GUIDER'].includes(t)))continue;
  for(const e of edges(id).filter(e=>e.type==='CONDITIONING')){
   const role=['positive','negative'].includes(e.input)?e.input:e.input==='conditioning'&&definition(id).output.includes('GUIDER')?'positive':null;
   if(role)conditioning(e,role,[],new Set());
  }
 }
 const sources=new Map(),mediaTypes=new Set(['IMAGE','MASK','VIDEO','AUDIO','LATENT','CONDITIONING','GUIDER','NOISE','CLIP_VISION_OUTPUT']);
 const frameRole=name=>/^(start_image|first_image|first_frame)$/.test(name)?'firstFrame':/^(end_image|last_image|last_frame)$/.test(name)?'lastFrame':/^(reference_image|reference_images|ref_image|ref_pad_image)$/.test(name)?'reference':null;
 function visitSource(id,slot=null,seen=new Set()){
  const key=JSON.stringify([id,slot]);if(seen.has(key)||!prompt[id]||opaque(id))return;seen.add(key);
  if(loaderInputs[prompt[id].class_type]){const uses=sources.get(id)||new Set();uses.add(slot);sources.set(id,uses);return;}
  const incoming=edges(id).filter(e=>mediaTypes.has(e.type)),images=incoming.filter(e=>e.type==='IMAGE');
  for(const e of incoming){const explicit=frameRole(e.input);visitSource(e.from,explicit||(e.type==='IMAGE'?(images.length>1&&slot?'ambiguous':slot):null),seen);}
 }
 visitSource(result?.nodeId);
 const controls=[];
 function add(nodeId,input,label,role,advanced=false,relationship=[]){
  const node=prompt[nodeId],schema=inputSchema(definitions,node.class_type,input),value=node.inputs[input];
  if(!schema||!literal(value))return;
  const control={nodeId,input,label,role,advanced,asset:loaderInputs[node.class_type]===input,
   contract:{adapter:'spool-key-inputs-1',classType:node.class_type,inputType:Array.isArray(schema[0])?'COMBO':schema[0],relationship},value};
  controls.push(control);return control;
 }
 for(const [id,uses] of sources){const node=prompt[id],input=loaderInputs[node.class_type];
  if(typeof node.inputs[input]!=='string')continue;
  const image=input==='image'&&definition(id)?.output?.includes('IMAGE'),explicit=[...uses].filter(Boolean),slot=image?(explicit.length===1?explicit[0]:explicit.length?'ambiguous':'image'):input==='audio'?'audio':input==='image'?'mask':'video';
  const label={firstFrame:'First frame',lastFrame:'Last frame',reference:'Reference image',image:'Source image',ambiguous:'Image (ambiguous)',mask:'Source mask',audio:'Source audio',video:'Source video'}[slot];
  const c=add(id,input,label,'source');if(c)c.slot=slot;
 }
 const images=controls.filter(c=>c.slot==='image');
 if(images.length>1)for(const c of images){c.slot='ambiguous';c.label='Image (ambiguous)';}
 for(const [id,entry]of roles){
  if(!reachable.has(id))continue;
  // Shared positive/negative or unknown conditioning uses are not isolated roles.
  const pathIds=new Set(entry.paths.flatMap(p=>p.flatMap(e=>[e.from,...(definition(e.nodeId)?.output?.includes('CONDITIONING')?[e.nodeId]:[])])));
  const otherUse=Object.keys(prompt).some(consumer=>edges(consumer).some(e=>e.type==='CONDITIONING'&&pathIds.has(e.from)&&!usedEdges.has(edgeKey(e))));
  if(entry.roles.size!==1||otherUse)continue;
  const uses=[...new Map(entry.paths.flatMap(relationship).map(e=>[edgeKey(e),e])).values()],role=[...entry.roles][0];
  add(id,entry.input,role==='negative'?'Negative prompt':'Prompt',role,role==='negative',uses);
 }
 function durationLiteral(id,input,path=[],seen=new Set()){
  const key=JSON.stringify([id,input]);if(seen.has(key))return null;seen.add(key);
  if(inputSchema(definitions,prompt[id].class_type,input)?.[0]!=='INT')return null;
  const value=prompt[id].inputs[input];
  if(Number.isInteger(value)||exact(value))return {nodeId:id,input,path};
  const link=links(id,input);if(!link||opaque(link[0]))return null;
  const upstream=prompt[link[0]],incoming=edges(link[0]),chain=[...path,{nodeId:id,input,slot:link[1]}];
  if(definition(link[0]).output[link[1]]!=='INT')return null;
  if(inputSchema(definitions,upstream.class_type,'value')?.[0]==='INT'&&Object.keys(upstream.inputs).length===1)return durationLiteral(link[0],'value',chain,seen);
  // Only identity math preserves frame units and the target's min/step. A formula
  // with seconds, fps or multiple variables needs an explicit authored mapping.
  if(typeof upstream.inputs.expression==='string'&&incoming.length===1&&upstream.inputs.expression.trim()===incoming[0].input.split('.').at(-1)){
   return durationLiteral(incoming[0].from,'value',[...chain,{nodeId:link[0],input:incoming[0].input,slot:incoming[0].slot}],seen);
  }
  return null;
 }
 for(const id of reachable){
  if(opaque(id))continue;
  const node=prompt[id],outputs=definition(id)?.output||[];
  if(outputs.some(t=>['LATENT','NOISE'].includes(t)))for(const name of ['seed','noise_seed'])if(inputSchema(definitions,node.class_type,name)?.[0]==='INT'){
   if(literal(node.inputs[name]))add(id,name,'Seed','seed',true);
   else{
    const link=links(id,name),source=link&&prompt[link[0]];
    if(source?.class_type==='DeadlineSeed'&&!source.inputs.batch_mode&&!source.inputs.is_worker&&inputSchema(definitions,source.class_type,'seed')?.[0]==='INT'&&outputType(link[0],link[1])==='INT')add(link[0],'seed','Seed','seed',false,[{nodeId:id,input:name,slot:link[1]}]);
   }
  }
  if(!outputs.some(t=>['LATENT','CONDITIONING'].includes(t)))continue;
  for(const name of ['length','num_frames','frames_number','frame_count','video_length']){
   const target=durationLiteral(id,name);
   if(!target){
    // This MiniMax template authors seconds, then snaps frames to the 17k+5 grid.
    // Recognize its exact conversion rather than evaluating arbitrary math.
    const link=links(id,name),math=link&&prompt[link[0]],seconds=math&&links(link[0],'values.a'),source=seconds&&prompt[seconds[0]];
    if(node.class_type==='MiniMaxH3ImageToVideo'&&name==='length'&&link?.[1]===1&&math?.class_type==='ComfyMathExpression'&&typeof math.inputs.expression==='string'&&math.inputs.expression.replace(/\s/g,'')==='max(5,round(a*24))+(5-(max(5,round(a*24))%17))%17'&&Object.keys(math.inputs).length===2&&source?.class_type==='PrimitiveFloat'&&outputType(seconds[0],seconds[1])==='FLOAT'&&inputSchema(definitions,source.class_type,'value')?.[0]==='FLOAT'){
     const c=add(seconds[0],'value','Duration (seconds)','duration',false,[{nodeId:link[0],input:'values.a',slot:seconds[1]},{nodeId:id,input:name,slot:link[1]}]);if(c)c.unit='seconds';
    }
    continue;
   }
   const c=controls.find(c=>c.role==='duration'&&c.nodeId===target.nodeId&&c.input===target.input)||add(target.nodeId,target.input,'Duration (frames)','duration',false,target.path);
   if(c){const options=inputSchema(definitions,node.class_type,name)[1]||{};c.constraints=c.constraints||[];c.constraints.push({nodeId:id,input:name,...Object.fromEntries(['min','max','step','default'].filter(k=>options[k]!=null).map(k=>[k,options[k]]))});}
  }
 }
 for(const slot of ['firstFrame','lastFrame']){const same=controls.filter(c=>c.slot===slot);if(same.length>1)for(const c of same){c.slot='ambiguous';c.label='Image (ambiguous)';}}
 for(const role of ['positive','negative','duration']){const same=controls.filter(c=>c.role===role);if(same.length>1)for(const c of same)c.ambiguous=true;}
 for(const c of controls)if(c.slot==='ambiguous'||c.ambiguous){c.ambiguous=true;c.advanced=true;}
 // Keep the compact inspector small, but retain every discovered control under
 // Advanced rather than silently truncating multi-stage workflows.
 const essential=controls.filter(c=>!c.advanced).slice(0,6),advanced=controls.filter(c=>!essential.includes(c));
 for(const c of advanced)c.advanced=true;
 const resultControls=[...essential,...advanced];
 const labels=new Map();for(const c of resultControls){const same=labels.get(c.label)||[];same.push(c);labels.set(c.label,same);}
 for(const same of labels.values())if(same.length>1)same.forEach((c,i)=>c.label+=' '+(i+1));
 return resultControls;
}
export function reusableBinding(old,candidate){
 return old.nodeId===candidate.nodeId&&old.input===candidate.input&&JSON.stringify(old.contract)===JSON.stringify(candidate.contract);
}
