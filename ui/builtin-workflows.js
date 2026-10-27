import {inputSchema,loaderInputs} from './profile.js';
import {TEMPLATE_MESSAGES,TEMPLATE_MODES,templateFrame} from './bridge.js';

export function controlnetInputs(prompt,definitions){
 if(!Object.values(prompt).some(n=>n.class_type==='MiniMaxH3FunControlNetApply'))return [];
 const fields={
  MiniMaxH3FunControlNetApply:[['strength','Control strength'],['start_percent','Control start'],['end_percent','Control end']],
  SDPoseDrawKeypoints:[['draw_body','Draw body'],['draw_hands','Draw hands'],['draw_face','Draw face'],['draw_feet','Draw feet'],['draw_head','Draw head'],['score_threshold','Pose confidence'],['stick_width','Skeleton line width'],['face_point_size','Face point size']],
  RTDETR_detect:[['threshold','Person detection threshold'],['max_detections','Maximum people']]
 };
 return Object.entries(prompt).flatMap(([nodeId,node])=>(fields[node.class_type]||[]).flatMap(([input,label])=>{
  const value=node.inputs[input],schema=inputSchema(definitions,node.class_type,input);
  if(!schema||!['number','boolean'].includes(typeof value))return [];
  return [{nodeId,input,label,value,role:node.class_type==='MiniMaxH3FunControlNetApply'?'controlnet':'pose',asset:false,advanced:false,
   contract:{adapter:'spool-key-inputs-1',classType:node.class_type,inputType:schema[0],relationship:[]}}];
 }));
}

export function builtinBindings(capture,definitions,bindings=capture.bindings||[]){
 if(capture.provenance?.builtinTemplate!=='video_minimax_h3_fun_controlnet_union')return bindings;
 const extra=controlnetInputs(capture.prompt,definitions).filter(b=>!bindings.some(old=>old.nodeId===b.nodeId&&old.input===b.input));
 return [...bindings,...extra.map(({value,...b})=>({...b,key:b.nodeId+'/'+b.input}))];
}

export function prepareBuiltinGraph(template,workflow){
 const graph=structuredClone(workflow);
 // This template exposes width/height instead of the selector used by the
 // other local templates. Wire the same native selector to those ports.
 if(template.id==='video_ltx2_5_flf2v'){
  const target=graph.nodes.find(n=>n.inputs?.some(i=>i.label==='width'));
  if(!target)throw Error('The first/last template changed. Update its studio mapping.');
  const id=Math.max(...graph.nodes.map(n=>Number(n.id)))+1,links=[];
  for(const [slot,label] of ['width','height'].entries()){
   const index=target.inputs.findIndex(i=>i.label===label),link=++graph.last_link_id;
   target.inputs[index].link=link;graph.links.push([link,id,slot,target.id,index,'INT']);links.push(link);
  }
  graph.nodes.push({id,type:'ResolutionSelector',pos:[target.pos[0]-300,target.pos[1]+300],size:[260,160],flags:{},order:0,mode:0,inputs:[],outputs:[{name:'width',type:'INT',links:[links[0]]},{name:'height',type:'INT',links:[links[1]]}],properties:{'Node name for S&R':'ResolutionSelector'},widgets_values:['16:9 (Widescreen)',0.9,32]});
  graph.last_node_id=id;
 }
 // MiniMax's frame APIs inherit their ratio from the first image. A native
 // resize makes that ratio an explicit, editable part of these studio graphs.
 if(template.id.startsWith('api_minimax_')&&['i2v','flf'].includes(template.task)){
  const target=graph.nodes.find(n=>n.type==='MinimaxHailuo03FirstLastFrameNode');
  if(!target)throw Error('The frame template changed. Update its studio mapping.');
  let id=Math.max(...graph.nodes.map(n=>Number(n.id))),linkId=graph.last_link_id;
  const selector={id:++id,type:'ResolutionSelector',pos:[target.pos[0]-640,target.pos[1]],size:[260,160],flags:{},order:0,mode:0,inputs:[],outputs:[{name:'width',type:'INT',links:[]},{name:'height',type:'INT',links:[]}],properties:{'Node name for S&R':'ResolutionSelector'},widgets_values:['16:9 (Widescreen)',0.9,32]};
  graph.nodes.push(selector);
  for(const [slot,port] of target.inputs.entries()){
   if(!['first_frame','last_frame'].includes(port.name)||port.link==null)continue;
   const incoming=graph.links.find(l=>l[0]===port.link),resize={id:++id,type:'ImageScale',pos:[target.pos[0]-320,target.pos[1]+slot*180],size:[260,150],flags:{},order:0,mode:0,inputs:[{name:'image',type:'IMAGE',link:incoming[0]},{name:'width',type:'INT',widget:{name:'width'},link:++linkId},{name:'height',type:'INT',widget:{name:'height'},link:++linkId}],outputs:[{name:'IMAGE',type:'IMAGE',links:[++linkId]}],properties:{'Node name for S&R':'ImageScale'},widgets_values:['bicubic',1280,720,'center']};
   incoming[3]=resize.id;incoming[4]=0;
   for(const [dimension,output] of selector.outputs.entries()){
    const link=resize.inputs[dimension+1].link;output.links.push(link);graph.links.push([link,selector.id,dimension,resize.id,dimension+1,'INT']);
   }
   port.link=resize.outputs[0].links[0];graph.links.push([port.link,resize.id,0,target.id,slot,'IMAGE']);graph.nodes.push(resize);
  }
  graph.last_node_id=id;graph.last_link_id=linkId;
 }
 return graph;
}

export function builtinInputs(capture,definitions,result,template){
 const prompt=capture.prompt,controls=[],seen=new Set();
 const link=value=>Array.isArray(value)&&value.length===2&&prompt[value[0]];
 function scalar(id,input,visited=new Set()){
  const key=id+'\0'+input;if(visited.has(key))return null;visited.add(key);
  const node=prompt[id],value=node?.inputs[input];
  if(value==null)return null;
  if(!link(value))return {nodeId:id,input,value};
  const next=prompt[value[0]];
  if(next.class_type==='ComfySwitchNode'){
   const choice=scalar(value[0],'switch',visited)?.value;
   return typeof choice==='boolean'?scalar(value[0],choice?'on_true':'on_false',visited):null;
  }
  if(next.class_type.startsWith('Primitive'))return scalar(value[0],'value',visited);
  return null;
 }
 function visit(id){
  if(seen.has(id)||!prompt[id])return;seen.add(id);
  const node=prompt[id],choice=node.class_type==='ComfySwitchNode'?scalar(id,'switch')?.value:null;
  const values=typeof choice==='boolean'?[node.inputs.switch,node.inputs[choice?'on_true':'on_false']]:Object.values(node.inputs);
  for(const value of values)if(link(value))visit(value[0]);
 }
 visit(result.nodeId);
 const schema=(id,input)=>inputSchema(definitions,prompt[id].class_type,input)||dynamicSchema(definitions[prompt[id].class_type]?.input,input,prompt[id].inputs);
 function add(target,label,role,extra={}){
  if(!target||controls.some(c=>c.nodeId===target.nodeId&&c.input===target.input))return;
  const {nodeId,input,value}=target,s= schema(nodeId,input);
  if(!s)throw Error('Update the node definition for '+prompt[nodeId].class_type+' · '+input);
  controls.push({nodeId,input,value,label,role,advanced:false,asset:loaderInputs[prompt[nodeId].class_type]===input,
   contract:{adapter:'spool-key-inputs-1',classType:prompt[nodeId].class_type,inputType:Array.isArray(s[0])?'COMBO':s[0],relationship:[]},
   ...(Array.isArray(s[0])||s[1]?.options?{options:Array.isArray(s[0])?s[0]:s[1].options}:{}),...extra});
 }
 const nodes=[...seen].map(id=>[id,prompt[id]]);
 const sources=nodes.filter(([,n])=>loaderInputs[n.class_type]);
 for(const [i,[id,n]] of sources.entries()){
  const input=loaderInputs[n.class_type],slot=input==='image'?(template.task==='flf'?(i===0?'firstFrame':'lastFrame'):template.task==='ref'?'reference':'firstFrame'):input==='audio'?'audio':'video';
  add(scalar(id,input),{firstFrame:'First frame',lastFrame:'Last frame',reference:'Reference',audio:'Source audio',video:'Source video'}[slot]+(slot==='reference'&&sources.length>1?' '+(i+1):''),'source',{slot});
 }
 const generators=nodes.filter(([,n])=>/^(MiniMaxH3|MinimaxHailuo03|LtxApi25|Flux3)/.test(n.class_type));
 let positive;
 for(const [id,n] of generators)for(const input of Object.keys(n.inputs).filter(k=>k==='prompt'||k==='model.prompt'))positive??=scalar(id,input);
 if(!positive)for(const [id,n] of nodes)if(n.class_type==='CLIPTextEncode'&&link(n.inputs.text))positive??=scalar(id,'text');
 add(positive,'Prompt','positive');
 for(const [id,n] of nodes){
  if(n.class_type==='ResolutionSelector'){
   add(scalar(id,'aspect_ratio'),'Aspect ratio','resolution');if(template.section!=='cloud')add(scalar(id,'megapixels'),'Resolution (megapixels)','resolution');
  }
 }
 for(const [id,n] of generators)for(const input of Object.keys(n.inputs)){
  const name=input.split('.').at(-1);
  if(['resolution','ratio','aspect_ratio'].includes(name))add(scalar(id,input),name==='resolution'?'Resolution':'Aspect ratio','resolution');
 }
 // The template's promoted duration widget is already in seconds. Its API
 // address survives subgraph expansion through the captured widget bindings.
 for(const [id,n] of nodes)if(n.class_type==='PrimitiveInt'||n.class_type==='PrimitiveFloat'){
  const widget=capture.widgetBindings?.find(b=>b.nodeId===id&&b.input==='value');
  const root=capture.workflow.nodes.find(n=>String(n.id)===widget?.widgetNodeId);
  const port=root?.inputs?.find(i=>i.name===widget?.widgetName);
  if(/duration/i.test(port?.label||''))add(scalar(id,'value'),'Duration (seconds)','duration',{unit:'seconds'});
 }
 for(const [id,n] of nodes)if(n.class_type==='ComfyMathExpression'&&typeof n.inputs.expression==='string'&&n.inputs.expression.replace(/\s/g,'')==='max(5,round(a*24))+(5-(max(5,round(a*24))%17))%17')add(scalar(id,'values.a'),'Duration (seconds)','duration',{unit:'seconds'});
 for(const [id,n] of generators)for(const input of Object.keys(n.inputs))if(input.split('.').at(-1)==='duration')add(scalar(id,input),'Duration (seconds)','duration',{unit:'seconds'});
 const noises=nodes.filter(([,n])=>n.class_type==='RandomNoise');
 const primaryNoise=noises.find(([id])=>capture.widgetBindings?.some(b=>b.nodeId===id&&b.input==='noise_seed'&&b.widgetNodeId!==id))||noises[0];
 if(primaryNoise)add(scalar(primaryNoise[0],'noise_seed'),'Seed','seed');
 for(const [id,n] of generators)if('seed' in n.inputs)add(scalar(id,'seed'),'Seed','seed');
 if(template.id==='video_minimax_h3_fun_controlnet_union')controls.push(...controlnetInputs(prompt,definitions));
 if(!controls.some(c=>c.role==='positive')||!controls.some(c=>c.role==='duration'))throw Error('This template changed. Update its studio input mapping.');
 return controls;
}

export function pixelResolution(value){
 const [width,height]=value.split('x').map(Number),gcd=(a,b)=>b?gcd(b,a%b):a;
 const divisor=gcd(width,height);return {size:Math.min(width,height),ratio:width/divisor+':'+height/divisor};
}

// Partner nodes expose model-specific widgets inside a DynamicCombo schema.
export function dynamicSchema(inputs,name,values){
 const [group,...parts]=name.split('.');if(!parts.length)return null;
 const base=inputs?.required?.[group]||inputs?.optional?.[group],options=base?.[1]?.options;
 if(!Array.isArray(options))return null;
 const selected=options.find(o=>o.key===values[group]||o.name===values[group]||o.value===values[group]);
 for(const option of selected?[selected]:options){
  const nested=option.inputs||option.input;
  const found=nested?.required?.[parts.join('.')]||nested?.optional?.[parts.join('.')]||nested?.[parts.join('.')];
  if(found)return found;
 }
 return null;
}

export function createBuiltinPreparer(){
 let frame,session,ready,pending,origin,disposed=false;
 const receive=event=>{
  const data=event.data;
  if(event.source!==frame?.contentWindow||event.origin!==origin||data?.type!==TEMPLATE_MESSAGES.prepared||data.session!==session)return;
  if(data.ready)ready?.resolve();
  if(pending&&data.requestId===pending.id){data.error?pending.reject(Error(data.error)):pending.resolve(data.capture);pending=null;}
 };
 window.addEventListener('message',receive);
 function reset(){frame?.remove();frame=null;ready?.reject(Error('Template preparation closed'));pending?.reject(Error('Template preparation closed'));ready=pending=null;}
 return {async capture(comfyUrl,workflow){
  if(disposed)throw Error('Studio closed');
  const target=new URL(comfyUrl);
  if(target.origin!==location.origin)throw Error('Open Spool from the paired Comfy address to add built-in workflows.');
  try{
   if(!frame){
    origin=target.origin;session=crypto.randomUUID();let resolve,reject;
    const promise=new Promise((a,b)=>{resolve=a;reject=b;});ready={promise,resolve,reject};
    templateFrame(target,TEMPLATE_MODES.prepare,session,location.origin);
    frame=document.createElement('iframe');frame.hidden=true;frame.title='Preparing Comfy workflow';frame.src=target.href;document.body.append(frame);
   }
   return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Comfy template preparation timed out. Retry when Comfy is ready.')),120000);
    ready.promise.then(()=>{pending={id:crypto.randomUUID(),resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};frame.contentWindow.postMessage({type:TEMPLATE_MESSAGES.prepare,session,requestId:pending.id,workflow},origin);},error=>{clearTimeout(timer);reject(error);});
   });
  }catch(error){reset();throw error;}
 },reset,dispose(){disposed=true;reset();window.removeEventListener('message',receive);}};
}
