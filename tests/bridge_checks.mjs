import assert from 'node:assert/strict';
import {CHANNEL_PREFIX,ACTIONS,WORKFLOW_TAB_TYPE,HANDOFF_PARAM,TEMPLATE_PARAMS,TEMPLATE_MODES,TEMPLATE_MESSAGES,templateFrame,templateSession,openChannel,createClient,serve,hostBridgeId} from '../ui/bridge.js';
const checks=[],check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
assert.equal(CHANNEL_PREFIX,'spool-comfy-');assert.deepEqual(ACTIONS,{capture:'capture',workflowDrop:'workflowDrop',open:'open',ping:'ping'});
assert.equal(WORKFLOW_TAB_TYPE,'application/x-spool-workflow-tab');
assert.equal(HANDOFF_PARAM,'spoolHandoff');
assert.deepEqual(TEMPLATE_PARAMS,{mode:'spoolTemplates',session:'spoolTemplateSession',origin:'spoolTemplateOrigin',view:'spoolTemplateView'});
assert.deepEqual(TEMPLATE_MODES,{browse:'embedded',prepare:'prepare'});
assert.deepEqual(TEMPLATE_MESSAGES,{request:'spool-template-request',state:'spool-template-state',prepare:'spool-prepare-template',prepared:'spool-template-preparation'});
check('Wire literals are frozen',Object.isFrozen(TEMPLATE_PARAMS)&&Object.isFrozen(TEMPLATE_MODES)&&Object.isFrozen(TEMPLATE_MESSAGES));
const frameUrl=templateFrame(new URL('http://127.0.0.1:8188/?keep=1'),TEMPLATE_MODES.prepare,'session-1','http://127.0.0.1:8188');
check('A template document reads back the session the studio gave it',JSON.stringify(templateSession(frameUrl.search,TEMPLATE_MODES.prepare))==='{"session":"session-1","origin":"http://127.0.0.1:8188","view":null}'&&frameUrl.searchParams.get('keep')==='1');
check('A browsing document also reads back its view',templateSession(templateFrame(new URL('http://127.0.0.1:8188/'),TEMPLATE_MODES.browse,'s','o','view-1').search,TEMPLATE_MODES.browse).view==='view-1');
check('A template document opened in another mode has no session',templateSession(frameUrl.search,TEMPLATE_MODES.browse)===null&&templateSession('?other=1',TEMPLATE_MODES.prepare)===null);
const stored=new Map(),storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
const firstBridge=hostBridgeId(storage),reloaded=hostBridgeId(storage,{reload:true});
check('Reload retains the Comfy bridge identity',firstBridge===reloaded);
check('A newly opened tab gets a fresh bridge despite cloned session storage',hostBridgeId(storage)!==firstBridge);
const parent=stored.get('spool-comfy-bridge');
check('Embedded templates cannot inherit or overwrite the parent bridge',hostBridgeId(storage,{reload:true,embedded:true})!==parent&&stored.get('spool-comfy-bridge')===parent);
const realTimeout=globalThis.setTimeout,realClear=globalThis.clearTimeout,activeTimers=new Set();
globalThis.setTimeout=(fn,ms)=>{const timer=realTimeout(()=>{activeTimers.delete(timer);fn();},ms);activeTimers.add(timer);return timer;};
globalThis.clearTimeout=timer=>{activeTimers.delete(timer);realClear(timer);};
const delay=ms=>new Promise(resolve=>realTimeout(resolve,ms));
// A busy CI runner can take hundreds of milliseconds to deliver the first
// message; only the dedicated timeout client below is meant to time out.
const id=crypto.randomUUID(),server=openChannel(id),channel=openChannel(id),observer=openChannel(id),client=createClient(channel,{timeoutMs:5000});
const replies=[];observer.addEventListener('message',({data})=>{if('result' in data||'error' in data)replies.push(data);});
let received=0;
const stop=serve(server,{
 [ACTIONS.ping]:async data=>{received++;await delay(data.wait||0);return {value:data.value};},
 [ACTIONS.capture]:()=>{throw Error('Serializer changed');}
});
try{
 const [first,second]=await Promise.all([client.call(ACTIONS.ping,{value:'first',wait:20}),client.call(ACTIONS.ping,{value:'second'})]);
 check('Concurrent responses correlate despite reverse arrival order',first.value==='first'&&second.value==='second');
 await assert.rejects(client.call(ACTIONS.capture),{message:'Serializer changed'});check('Server errors preserve the rejection message',true);
 await delay(10);check('Response envelope keys are frozen',replies.every(r=>JSON.stringify(Object.keys(r).sort())===JSON.stringify(('error' in r?['error','requestId']:['requestId','result']).sort())));
 check('Responses clear all request timeouts',activeTimers.size===0);
 channel.postMessage({requestId:'unknown',action:'unsupported'});channel.postMessage({action:ACTIONS.ping});await delay(15);
 check('Unknown actions and missing requestId are ignored',received===2&&replies.length===3);
 const timeoutChannel=openChannel(crypto.randomUUID()),timeout=createClient(timeoutChannel,{timeoutMs:10});
 try{await assert.rejects(timeout.call(ACTIONS.ping),{message:'Comfy did not reply. Its workflow may still be loading. Try again.',code:'SPOOL_BRIDGE_TIMEOUT'});check('Timeout rejects and releases its timer',activeTimers.size===0);}finally{timeout.close();}
 const pending=client.call(ACTIONS.ping,{wait:30,value:'late'});await delay(5);client.close();
 await assert.rejects(pending,{message:'Editor closed'});check('Close rejects pending requests and clears timeouts',activeTimers.size===0);
 await delay(40);await assert.rejects(client.call(ACTIONS.ping),{message:'Editor closed'});check('Closed client ignores late responses and rejects new calls',activeTimers.size===0);
}finally{client.close();stop();server.close();observer.close();globalThis.setTimeout=realTimeout;globalThis.clearTimeout=realClear;}
console.log(JSON.stringify({passed:checks.length,checks},null,2));
