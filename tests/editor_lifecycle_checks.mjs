import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as G from '../ui/generation.js';
import {createInputReplacements} from '../ui/input-replacement.js';
import {compactGroups} from '../ui/input-groups.js';
import {createApi} from '../ui/api.js';

// Exercise the production event handlers with deferred transport/decoder dependencies.
const source=readFileSync(new URL('../ui/editor.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const failure=status=>Object.assign(Error(status?'HTTP '+status:'Connection lost'),status?{status}:{});
const exact=value=>({__spool_int__:String(value)});
const clip=()=>({id:'shot',name:'Shot',workflowVersion:'recipe',count:1,seedMode:'increment',inputValues:{seed:exact(4)},bindings:[{key:'seed',role:'seed',nodeId:'noise',input:'seed'}],revision:1,takeId:'chosen'});
function queueFixture(extra={}){
 const sent=[],messages=[],sessionStorage=storage(),state={clips:[clip()]};
 const context={G,state,sessionStorage,STORAGE_KEY:'project',crypto,bridgeClient:null,B:{ACTIONS:{ping:'ping'}},projectKey:'p',
  cloudDefinitions:{},productDefinitions:{Noise:{input:{required:{seed:['INT',{min:0,max:100}]}}}},nativeRecipes:{recipe:{prompt:{noise:{class_type:'Noise'}}}},
  productCapabilities:{connected:true},projectEdit:{revision:1,change:send=>send()},
  request:async(path,body)=>{sent.push(body);},queueReason:()=>null,flushNative:async()=>{},reviewGeneration:async()=>{},
  edits:{apply:(label,change)=>change()},save(){},renderInspector(){},decimal:value=>String(value?.__spool_int__??value),$:()=>null,toast:message=>messages.push(message),...extra};
 const api=vm.runInNewContext(section('const queueRetryKey=','function queueModal()')+'\n({queueClips,queueSubmission})',context);
 return {...api,context,sent,messages,state,sessionStorage};
}

for(const dependency of ['bridge','flush']){
 const gate=deferred(),f=queueFixture(dependency==='bridge'?{bridgeClient:{call:()=>gate.promise}}:{flushNative:()=>gate.promise});
 const first=f.queueClips(f.state.clips),second=f.queueClips(f.state.clips);
 assert.equal(f.queueSubmission.sending,true);
 await second;assert.equal(f.sent.length,0);assert.match(f.messages[0],/already in progress/);
 gate.resolve();await first;
 assert.equal(f.sent.length,1,dependency+' permits one operation');
 assert.equal(f.state.clips[0].inputValues.seed.__spool_int__,'5');
 assert.equal(f.state.clips[0].takeId,'chosen');
 assert.equal(f.queueSubmission.pending,null);assert.equal(f.queueSubmission.sending,false);
 await f.queueClips(f.state.clips);
 assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].operationId,f.sent[1].operationId);
 assert.equal(f.state.clips[0].inputValues.seed.__spool_int__,'6');
}
for(const preflight of ['empty','invalid','flush','review']){
 const f=queueFixture();
 if(preflight==='invalid')f.context.queueReason=()=> 'Not ready';
 if(preflight==='flush')f.context.flushNative=async()=>{throw Error('Cannot save');};
 if(preflight==='review')f.state.clips[0].count=2;
 await f.queueClips(preflight==='empty'?[]:f.state.clips);
 assert.equal(f.sent.length,0);assert.equal(f.queueSubmission.sending,false);assert.equal(f.queueSubmission.pending,null);
 f.context.queueReason=()=>null;f.context.flushNative=async()=>{};
 const reviewed=preflight==='review'?G.generationItems(f.state.clips,f.context.productDefinitions,f.context.nativeRecipes):null;
 await f.queueClips(f.state.clips,reviewed);
 assert.equal(f.sent.length,1);if(reviewed)assert.deepEqual(f.sent[0].items,reviewed);
}

for(const status of [400,403,409,422]){
 // Initial and retry rejections must release both memory and persisted ownership.
 const f=queueFixture({request:async()=>{throw failure(status);}});
 await f.queueClips(f.state.clips);
 assert.equal(f.queueSubmission.pending,null);assert.equal(f.sessionStorage.getItem('project:queue-request'),null);
 f.context.request=async()=>{throw failure();};
 await f.queueClips(f.state.clips);
 const body=f.queueSubmission.pending;assert.ok(body);
 assert.equal(f.state.clips[0].inputValues.seed.__spool_int__,'4');
 let retried;
 const reloaded=G.createQueueSubmission({storage:f.sessionStorage,key:'project:queue-request',submit:async value=>{retried=value;throw failure(status);}});
 await assert.rejects(reloaded.retry(),error=>error.status===status);
 assert.deepEqual(retried,JSON.parse(JSON.stringify(body)));
 assert.equal(reloaded.pending,null);assert.equal(f.sessionStorage.getItem('project:queue-request'),null);
 const next=G.createQueueSubmission({storage:f.sessionStorage,key:'project:queue-request',submit:async value=>{retried=value;}});
 await next.start(async()=>({revision:2,operationId:'new operation',items:body.items}));
 assert.equal(retried.revision,2);
}
for(const status of [undefined,500,503]){
 const f=queueFixture({request:async()=>{throw failure(status);}});
 await f.queueClips(f.state.clips);
 const frozen=JSON.parse(f.sessionStorage.getItem('project:queue-request'));
 assert.ok(frozen.operationId);await f.queueClips(f.state.clips);
 assert.match(f.messages.at(-1),/pending submission/);
 const gate=deferred(),sent=[],reloaded=G.createQueueSubmission({storage:f.sessionStorage,key:'project:queue-request',submit:async value=>{sent.push(value);await gate.promise;}});
 const first=reloaded.retry();await assert.rejects(reloaded.retry(),/already in progress/);
 assert.deepEqual(sent,[frozen]);gate.resolve();await first;
 assert.equal(reloaded.pending,null);assert.equal(f.sessionStorage.getItem('project:queue-request'),null);
}
{
 const f=queueFixture(),gate=deferred();let body;
 f.context.request=async(path,value)=>{body=value;throw failure();};
 await f.queueClips(f.state.clips);assert.equal(f.state.clips[0].inputValues.seed.__spool_int__,'4');
 f.context.request=async(path,value)=>{assert.deepEqual(value,body);await gate.promise;};
 const retry=f.queueSubmission.retry();assert.equal(f.state.clips[0].inputValues.seed.__spool_int__,'4');
 gate.resolve();await retry;assert.equal(f.state.clips[0].inputValues.seed.__spool_int__,'5');
 assert.equal(f.state.clips[0].takeId,'chosen');
}

const uploadResponse=file=>({ok:true,json:async()=>({file})});
function inputFixture(slot='video'){
 const c={id:'shot',workflowVersion:'recipe',inputValues:{source:'old'},bindings:[{key:'source',slot,label:'Source'}],shotInputs:[{key:'source',source:'selected'}],revision:1},history=[];
 const context={state:{clips:[c]},inputReplacements:createInputReplacements(),compactGroups,api:createApi({diagnostics:{run:(label,run)=>run()},project:()=>'p',recipes:()=>new Map(),send:(...args)=>context.fetch(...args)}),take:()=>({media:{kind:'video'}}),edits:{apply:(label,change)=>{history.push(label);return change();}},save(){},renderInspector(){},flushNative:async()=>{},toast(){},projectKey:'p',$:()=>({querySelector:()=>null}),createImageBitmap:async()=>({close(){}})};
 const api=vm.runInNewContext(section('function useTimelineVideo(','const countLabel=')+'\n({useTimelineVideo,replaceInputMedia,replaceInputImage,clearInput})',context);
 return {c,context,history,...api};
}
{
 const f=inputFixture(),gate=deferred();f.context.fetch=()=>gate.promise;
 const pending=f.replaceInputMedia(f.c,0,{name:'late.mp4'});
 f.useTimelineVideo('shot',0);gate.resolve(uploadResponse('late.mp4'));
 await assert.rejects(pending,/changed while uploading/);
 assert.equal(f.c.inputValues.source,'old');assert.equal(f.c.shotInputs[0].source,'selected');
 assert.equal(f.history.length,0,'Reaffirming timeline invalidates upload without creating an undo step');
}
for(const slot of ['video','image']){
 const f=inputFixture(slot),older=deferred(),newer=deferred(),file=name=>slot==='image'?{name,type:'image/png',size:4}:{name:name+'.mp4'};
 f.context.fetch=(path,options)=>options.headers['X-Filename'].startsWith('first')?older.promise:newer.promise;
 const replace=slot==='image'?f.replaceInputImage:f.replaceInputMedia;
 const first=replace(f.c,0,file('first')),second=replace(f.c,0,file('second'));
 older.resolve(uploadResponse('first'));await assert.rejects(first,/changed while uploading/);
 newer.resolve(uploadResponse('second'));await second;
 assert.equal(f.c.inputValues.source,'second');assert.equal(f.c.shotInputs.length,0);assert.equal(f.history.length,1);
}
for(const change of ['workflow','input','sources','remove','undo']){
 const f=inputFixture('image'),gate=deferred();f.context.fetch=()=>gate.promise;
 const pending=f.replaceInputImage(f.c,0,{name:'image.png',type:'image/png',size:4});
 if(change==='workflow')f.c.workflowVersion='another';
 if(change==='input')f.c.inputValues.source='changed';
 if(change==='sources')f.c.shotInputs=[];
 if(change==='remove')f.context.state.clips=[];
 if(change==='undo')f.context.inputReplacements.invalidate();
 gate.resolve(uploadResponse('late.png'));await assert.rejects(pending,/changed while uploading/);
 assert.notEqual(f.c.inputValues.source,'late.png');assert.equal(f.history.length,0);
}
for(const action of ['undo','remove','workflow']){
 const f=inputFixture(),gate=deferred(),original=structuredClone(f.c);f.context.fetch=()=>gate.promise;
 const pending=f.replaceInputMedia(f.c,0,{name:'late.mp4'}),noop=()=>{};
 Object.assign(f.context,{pause:noop,editView:noop,render:noop,setStatus:noop});
 if(action==='undo'){
  Object.assign(f.context,{drag:null,viewState:()=>({}),history:{step:()=>({restored:{clips:[structuredClone(original)]},label:'edit'})},preserveTakes:value=>value,review:{reconcile:noop},document:{activeElement:{}},buttons:noop});
  vm.runInNewContext(section('function restoreHistory(','function undo(')+'\nrestoreHistory([{}],[],"Undid");',f.context);
 }else if(action==='remove'){
  Object.assign(f.context,{selectionIds:()=>['shot'],setTimelineSelection:noop,clamp:()=>0,total:()=>0,T:{removeClip:state=>{state.clips=[];}}});
  vm.runInNewContext(section('function remove(ripple=','function split(')+'\nremove();',f.context);
  f.context.state.clips=[structuredClone(original)];
 }else{
  Object.assign(f.context,{copy:structuredClone,nativeRecipes:{recipe:{bindings:[{...original.bindings[0],nodeId:'loader',input:'file'}],prompt:{loader:{inputs:{file:'old'}}}}},definitionsFor:()=>({}),matchClipInputs:noop,fps:24});
  vm.runInNewContext(section('function applyPreparedWorkflow(','const INITIAL=')+'\napplyPreparedWorkflow(state.clips[0],"workflow","recipe");',f.context);
  Object.assign(f.c,original);
 }
 gate.resolve(uploadResponse('late.mp4'));await assert.rejects(pending,/changed while uploading/);
 assert.equal(f.context.state.clips[0].inputValues.source,'old',action+' invalidates even if the prior input values return');
}
{
 const f=inputFixture('image'),decode=deferred();f.context.createImageBitmap=()=>decode.promise;f.context.fetch=async()=>uploadResponse('late.png');
 const pending=f.replaceInputImage(f.c,0,{name:'image.png',type:'image/png',size:4});
 f.context.inputReplacements.invalidate('shot');decode.resolve({close(){}});
 await assert.rejects(pending,/changed while uploading/);
}
{
 // Remove moves a group's later inputs up; required inputs have no Remove.
 const f=inputFixture('reference'),group=(key,label,extra={})=>({key,slot:'reference',label,optional:true,group:'Reference images',...extra});
 f.c.bindings=[group('a','Reference image 1'),group('b','Reference image 2'),{key:'c',slot:'video',label:'Reference video 1',optional:true,group:'Reference videos'},{key:'d',slot:'image',label:'First frame'}];
 f.c.inputValues={a:'one.png',b:'two.png',c:'',d:'first.png'};f.c.shotInputs=[{key:'c',source:'selected'}];
 f.clearInput(f.c,0);
 assert.deepEqual(f.c.inputValues,{a:'two.png',b:'',c:'',d:'first.png'});assert.deepEqual(f.c.shotInputs,[{key:'c',source:'selected'}]);assert.deepEqual(f.history,['Remove Reference image 1']);
 f.clearInput(f.c,3);assert.equal(f.c.inputValues.d,'first.png');assert.equal(f.history.length,1);
 // A file chosen for a later empty slot lands in the first free one.
 f.context.fetch=async()=>uploadResponse('three.png');
 await f.replaceInputImage(f.c,1,{name:'three.png',type:'image/png',size:4});
 assert.deepEqual([f.c.inputValues.a,f.c.inputValues.b],['two.png','three.png']);
 f.c.inputValues.a='';f.c.inputValues.b='';await f.replaceInputImage(f.c,1,{name:'three.png',type:'image/png',size:4});
 assert.deepEqual([f.c.inputValues.a,f.c.inputValues.b],['three.png','']);
}
{
 // A reference video taken from the timeline keeps its soundtrack.
 const f=inputFixture('video');f.c.bindings[0].audio=true;f.c.shotInputs=[];f.useTimelineVideo('shot',0);
 assert.equal(JSON.stringify(f.c.shotInputs),JSON.stringify([{key:'source',source:'selected',audio:true}]));
}
console.log('Editor submission and input replacement lifecycles passed (deferred production handlers; no host or execution).');
