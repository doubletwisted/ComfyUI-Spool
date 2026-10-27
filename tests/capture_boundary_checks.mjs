import assert from 'node:assert/strict';
import {createProjectEdit} from '../ui/project-edit.js';
import {createWorkflowSetup,workflowStatus} from '../ui/workflow-setup.js';

const copy=structuredClone,checks=[],check=(label,test)=>{assert.ok(test,label);checks.push(label);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const definitions={LoadImage:{input:{required:{image:[['source.png'],{image_upload:true}]}},output:['IMAGE','MASK']},SaveImage:{input:{required:{images:['IMAGE']}},output_node:true}};
const capture=()=>({prompt:{load:{class_type:'LoadImage',inputs:{image:'source.png'}},save:{class_type:'SaveImage',inputs:{images:['load',0],filename_prefix:'ordinary'}}},result:{nodeId:'save',group:'images',index:0}});
function fixture(options={}){
 const state={clips:[{id:'a',bindings:[],inputValues:{}},{id:'b',bindings:[],inputValues:{}}]},shown=[],errors=[],saved=[];
 let busy=false,question=null,gets=0;
 const edit=createProjectEdit({project:{id:'qa',revision:1,document:{jobs:[]}},document:()=>copy(state),blocked:()=>false,notify:()=>{},
  request:async()=>{gets++;return {revision:edit.revision+1,document:{...copy(state),jobs:[]}};},
  apply:(value,replace)=>{if(replace)Object.assign(state,value.document);}});
 const dialog={show:q=>{question=q;shown.push(q);},error:e=>errors.push(e),close:()=>edit.cancelCapture(),
  lock(){const before=busy;busy=true;return()=>busy=before;}};
 const setup=createWorkflowSetup({edit,flush:options.flush||(()=>Promise.resolve()),clip:id=>state.clips.find(c=>c.id===id),dialog,
  async save(args){saved.push(args);if(options.save)return options.save(args,edit,state);return edit.change(async()=>({revision:edit.revision+1,document:{...copy(state),jobs:[]}}));}});
 return {state,shown,errors,saved,edit,dialog,get question(){return question;},get busy(){return busy;},get gets(){return gets;},
  start:values=>setup.start({capture:capture(),name:'Workflow',clipId:'a',definitions,...values})};
}

const applying=fixture(),previous=capture();previous.bindings=[{key:'kept-source',nodeId:'load',input:'image',asset:true,role:'source',slot:'image'}];
const multiple=capture();multiple.prompt.preview={class_type:'SaveImage',inputs:{images:['load',0],filename_prefix:'preview'}};
await applying.start({capture:multiple,previous,automatic:true,replaceInputs:true});
check('Applying a multi-output graph reuses its explicit saved output without a new dialog',!applying.shown.length&&applying.saved[0].capture.result.nodeId==='save');
check('Apply retains still-valid mapped controls even when automatic graph traversal is ambiguous',applying.saved[0].capture.bindings.some(b=>b.nodeId==='load'&&b.input==='image'&&b.role==='source'));
const mediaDefs={...definitions,ImageSwitch:{input:{required:{image1:['IMAGE',{lazy:true}],image2:['IMAGE',{lazy:true}],select:['BOOLEAN']}},output:['IMAGE']}};
const extra=capture();extra.prompt.load._meta={title:'Subject'};extra.prompt.reference={class_type:'LoadImage',inputs:{image:'style.png'},_meta:{title:'Style reference'}};
extra.prompt.switch={class_type:'ImageSwitch',inputs:{image1:['load',0],image2:['reference',0],select:true}};extra.prompt.save.inputs.images=['switch',0];
extra.prompt.detached={class_type:'LoadImage',inputs:{image:'unused.png'}};
const added=fixture();added.state.clips[0].bindings=copy(previous.bindings);
await added.start({capture:extra,previous,definitions:mediaDefs,automatic:true,replaceInputs:true});
const addedSources=added.saved[0]?.capture.bindings.filter(b=>b.asset)||[];
check('Two explicit file sources behind a lazy switch apply without a mapping dialog',!added.shown.length&&addedSources.length===2&&addedSources.every(b=>b.slot==='image'&&!b.advanced&&!b.ambiguous));
check('Added sources use authored titles and retain the exact newly chosen image',addedSources.some(b=>b.nodeId==='reference'&&b.label==='Style reference')&&added.saved[0].capture.prompt.reference.inputs.image==='style.png');
check('Existing source identities survive profile enrichment and disconnected inputs stay out of the Inspector',addedSources.find(b=>b.nodeId==='load').key==='kept-source'&&!addedSources.some(b=>b.nodeId==='detached'));
const removed=fixture(),removedGraph=copy(extra);delete removedGraph.prompt.load;delete removedGraph.prompt.switch;removedGraph.prompt.save.inputs.images=['reference',0];
removed.state.clips[0].bindings=copy(addedSources);
await removed.start({capture:removedGraph,previous:added.saved[0].capture,definitions:mediaDefs,automatic:true,replaceInputs:true});
check('Removing a source removes its Inspector binding while retaining the other source key',removed.saved[0].capture.bindings.filter(b=>b.asset).length===1&&removed.saved[0].capture.bindings[0].key===addedSources.find(b=>b.nodeId==='reference').key);
const crowded=fixture(),crowdedGraph=capture();crowdedGraph.prompt.save.inputs.images=['join',0];crowdedGraph.prompt.join={class_type:'JoinImages',inputs:{}};
for(let i=0;i<8;i++){crowdedGraph.prompt['source'+i]={class_type:'LoadImage',inputs:{image:'same.png'},_meta:{title:'Reference'}};crowdedGraph.prompt.join.inputs['image'+i]=['source'+i,0];}
await crowded.start({capture:crowdedGraph,previous,definitions:{...definitions,JoinImages:{input:{required:Object.fromEntries(Array.from({length:8},(_,i)=>['image'+i,['IMAGE']]))},output:['IMAGE']}},automatic:true,replaceInputs:true});
const crowdedSources=crowded.saved[0]?.capture.bindings.filter(b=>b.asset)||[];
check('All eight image inputs remain visible and identically named nodes have distinct labels',!crowded.shown.length&&crowdedSources.length===8&&crowdedSources.every(b=>!b.advanced)&&new Set(crowdedSources.map(b=>b.label)).size===8);
check('A newly added empty source blocks Generate for ordinary workflows',!workflowStatus({workflowVersion:'saved',bindings:addedSources,inputValues:{[addedSources[0].key]:'source.png',[addedSources[1].key]:''}},null,added.saved[0].capture,mediaDefs).ready);
const flush=deferred(),reserved=fixture({flush:()=>flush.promise}),preparing=reserved.start();
await assert.rejects(reserved.start({clipId:'b'}),/Finish/);
await reserved.edit.poll();check('Preparation reserves ownership before flush and blocks polling',reserved.gets===0);
reserved.dialog.close();flush.resolve();await preparing;
check('Cancelled preparation never opens a late question',reserved.shown.length===0);

const failed=fixture({flush:()=>Promise.reject(Error('save failed'))});await assert.rejects(failed.start(),/save failed/);
const reservation=failed.edit.beginCapture({});reservation.cancel();check('Preparation failure releases its reservation',true);

const file=deferred(),loading=fixture(),filePreparing=loading.start({capture:()=>file.promise});await tick();loading.dialog.close();
file.resolve(capture());await filePreparing;check('Cancelled workflow loading never opens its question',loading.shown.length===0);

const response=deferred(),late=fixture({save:async(args,edit,state)=>edit.change(async()=>{await response.promise;return {revision:2,document:{...copy(state),jobs:[]}};})});
await late.start();const saving=late.question.confirm('saved');await tick();
await assert.rejects(late.start({clipId:'b'}),/Finish/);
check('Committed capture owns the editor lock after its dialog closes',late.busy);
late.state.clips[0].name='newer local edit';response.resolve();await saving;
check('Receipt preserves a newer draft and releases the lock',late.state.clips[0].name==='newer local edit'&&!late.busy);
await late.start({clipId:'b'});late.dialog.close();check('Next capture can start after completion',true);

const oldFlush=deferred(),newSave=deferred();let flushes=0;
const ownership=fixture({flush:()=>++flushes===2?oldFlush.promise:Promise.resolve(),save:()=>newSave.promise});
await ownership.start();const oldSaving=ownership.question.confirm('saved');await tick();ownership.dialog.close();
await ownership.start({clipId:'b'});const newSaving=ownership.question.confirm('saved');await tick();oldFlush.resolve();await oldSaving;
check('Cancelled old flush cannot release a newer editor lock',ownership.busy);
newSave.resolve();await newSaving;check('Only committed owner restores editor interactivity',!ownership.busy);

const multi=capture();multi.prompt.second=copy(multi.prompt.save);
const ambiguous=fixture();await ambiguous.start({capture:multi,automatic:true});
check('Multiple outputs still require an explicit choice',ambiguous.shown.length===1&&!ambiguous.question.result);
ambiguous.question.chooseOutput('1');await ambiguous.question.confirm('saved');
check('Chosen output is captured without changing graph edges',ambiguous.saved[0].capture.result.nodeId==='second'&&Array.isArray(ambiguous.saved[0].capture.prompt.save.inputs.images));

const auto=fixture();await auto.start({automatic:true});check('Prepared single-output workflow saves without another question',auto.shown.length===0&&auto.saved.length===1&&!auto.busy);
const continuation=fixture();await continuation.start({automatic:true,takeId:'take-04'});
check('Take adoption resets old input overrides',continuation.saved.length===1&&continuation.saved[0].keep===false&&continuation.saved[0].session.takeId==='take-04');
const linked=fixture();await linked.start({automatic:true,replaceInputs:true});check('Applying a Comfy graph takes its current inputs instead of old Spool overrides',linked.saved[0].keep===false&&linked.saved[0].session.replaceInputs);
const plain=fixture();await plain.start({automatic:true,takeId:'plain',capture:null});
check('A take without metadata still commits through the same editor owner',plain.saved.length===1&&plain.saved[0].capture===null&&!plain.busy);
const missing=fixture();await missing.start({automatic:true,takeId:'missing-node',capture:capture(),definitions:{}});
check('Missing nodes preserve a known take recipe without guessing controls',missing.saved.length===1&&!missing.saved[0].capture.bindings.length&&!missing.busy);
const graph=fixture();await graph.start({capture:{workflow:{nodes:[]}}});await graph.question.confirm('graph');
check('Graph-only preparation does not require an executable output',graph.saved[0].mode==='graph');

const exactCapture=capture();exactCapture.prompt.save.inputs.seed={__spool_int__:'18446744073709551615'};
const exact=fixture();await exact.start({capture:exactCapture,exact:true});
const seed=exact.question.candidates.findIndex(b=>b.input==='seed');
await exact.question.confirm('inputs',{bindings:[{index:seed,label:'Exact seed'}],result:{nodeId:'save',group:'images',index:0},keep:true});
check('Exact mapping keeps integer payload and explicit result',exact.saved[0].capture.prompt.save.inputs.seed.__spool_int__==='18446744073709551615'&&exact.saved[0].capture.bindings[0].label==='Exact seed'&&exact.saved[0].keep);

const gone=fixture();await gone.start();gone.state.clips=[];await gone.question.confirm('saved');
check('Removed target cannot be saved',gone.saved.length===0&&gone.errors[0].message==='This clip was removed.');gone.dialog.close();
const rejected=fixture({save:()=>Promise.reject(Error('capture failed'))});await rejected.start();await rejected.question.confirm('saved');
check('Failed committed capture releases reservation and interactivity',!rejected.busy&&rejected.errors[0].message==='capture failed');await rejected.start();rejected.dialog.close();

const ready=workflowStatus({workflowVersion:'saved'},null,{...capture(),provenance:{workflowName:'CPU image noise'}},definitions);
check('Captured workflow readiness does not depend on a library row',ready.ready&&ready.name==='CPU image noise'&&ready.note==='Ready to generate');
check('Missing recipe has an actionable persistent reason',!!workflowStatus({workflowVersion:'missing'},null,null).reason);
console.log(JSON.stringify({passed:checks.length,checks},null,2));
