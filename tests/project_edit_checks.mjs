// The actual production module, with controlled transport and editor adapters.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {createProjectEdit}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('ui/project-edit.js','utf8')).toString('base64'));
const copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const checks=[];
const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);};
const captureRejected=edit=>{assert.throws(()=>edit.beginCapture({}),/Finish/);return true;};
function fixture(){
 const state={project:'initial',jobs:[],clips:[{id:'clip',takeId:'placeholder',takes:[{id:'placeholder'}]}],frame:20,selected:'clip'};
 const calls=[],events=[],applied=[];let remoteRevision=1,hold=null,blocked=false,focused=false,reads=0;
 const document=()=>{reads++;return copy({project:state.project,clips:state.clips.map(c=>({...c,takes:c.takes.filter(t=>!t.generated)}))});};
 const receipt=(revision=remoteRevision,name=state.project,jobs=[])=>({id:'qa',revision,recipes:{},document:{...document(),project:name,jobs}});
 const edit=createProjectEdit({project:receipt(),document,blocked:operation=>blocked||operation==='replace'&&focused,
  apply:(project,replace)=>{remoteRevision=Math.max(remoteRevision,project.revision);applied.push({project,replace});if(replace){state.project=project.document.project;state.clips=copy(project.document.clips);}state.jobs=copy(project.document.jobs);},
  request:async(path,body,method,headers)=>{calls.push({path,body,method,headers});if(hold)return await hold(path,body,method,headers);if(method==='PUT'){remoteRevision++;return {...receipt(),document:{...copy(body.document),jobs:[]}};}return receipt();},
  notify:event=>events.push(event)
 });
 return {edit,state,calls,events,applied,receipt,get reads(){return reads;},setHold:value=>hold=value,setBlocked:value=>blocked=value,setFocused:value=>focused=value};
}

const snapshot=fixture(),reads=snapshot.reads;snapshot.state.project='one snapshot';snapshot.edit.save();
check('Save captures one detached document for comparison and transport',snapshot.reads===reads+1);
snapshot.state.project='later unsaved value';await tick();
check('The queued save remains detached from later local edits',snapshot.calls[0].body.document.project==='one snapshot');

const saving=fixture(),first=deferred();let puts=0;
saving.setHold(async(path,body,method)=>{assert.equal(method,'PUT');if(++puts===1)await first.promise;return {...saving.receipt(puts+1),document:{...copy(body.document),jobs:[]}};});
saving.state.project='first';saving.edit.save();await tick();
saving.state.project='second';saving.edit.save();saving.state.project='latest';saving.edit.save();
first.resolve();await saving.edit.flush();
check('Held PUT coalesces later edits and advances revisions in order',puts===2&&saving.calls[1].body.document.project==='latest'&&saving.calls[1].body.revision===2&&saving.edit.revision===3&&!saving.edit.dirty);

const undoing=fixture(),heldPut=deferred();let undoPuts=0;
undoing.setHold(async(path,body)=>{if(++undoPuts===1)await heldPut.promise;return {...undoing.receipt(undoPuts+1),document:{...copy(body.document),jobs:[]}};});
undoing.state.project='in flight';undoing.edit.save();await tick();undoing.state.project='initial';undoing.edit.save();heldPut.resolve();await undoing.edit.flush();
check('Undo during an in-flight PUT persists the reverted edit',undoPuts===2&&undoing.calls[1].body.document.project==='initial'&&!undoing.edit.dirty);

const reverted=fixture();reverted.state.clips[0].gapBefore=0;await reverted.edit.flush();
const beforeRevert=reverted.calls.length;
reverted.state.project='pending edit';reverted.edit.save();reverted.state.project='initial';reverted.edit.save();await reverted.edit.flush();
check('Same-tick revert cancels a PUT that has not started, retaining explicit zero gaps',reverted.calls.length===beforeRevert&&!reverted.edit.dirty&&reverted.state.clips[0].gapBefore===0);

const gesture=fixture();gesture.setBlocked(true);gesture.state.project='uncommitted gesture';gesture.edit.save();await assert.rejects(gesture.edit.flush(),/Resolve/);
check('Blocked editing gesture cannot be persisted through flush',gesture.calls.length===0&&gesture.edit.dirty);
gesture.setBlocked(false);await gesture.edit.flush();check('Completed gesture can save through the same interface',!gesture.edit.dirty);

const failed=fixture();failed.setHold(()=>{throw Error('network down');});failed.state.project='unsaved';
await assert.rejects(failed.edit.flush(),/Resolve/);const requests=failed.calls.length;await failed.edit.poll();
check('Failed PUT retains draft/error and blocks result-arrival GET',failed.edit.dirty&&failed.state.project==='unsaved'&&failed.calls.length===requests&&failed.events.some(e=>e.kind==='error'));
failed.setHold(null);await failed.edit.flush();check('Explicit retry saves retained draft and clears error',!failed.edit.dirty&&failed.edit.revision===2);

const failedRevert=fixture();failedRevert.setHold(()=>{throw Error('lost response');});failedRevert.state.project='uncertain edit';await assert.rejects(failedRevert.edit.flush(),/Resolve/);
failedRevert.state.project='initial';failedRevert.setHold(null);await failedRevert.edit.flush();
check('Reverting after a lost PUT response writes the final draft explicitly',failedRevert.calls.at(-1).body.document.project==='initial'&&!failedRevert.edit.dirty);

for(const cause of ['edit','focused field','drag','failed startup','capture']){
 const f=fixture(),get=deferred();f.setHold(()=>get.promise);const polling=f.edit.poll();
 if(cause==='edit')f.state.project='local draft';else if(cause==='capture')f.edit.beginCapture({name:'new capture'});else f.setBlocked(true);
 get.resolve(f.receipt(2,'remote edit',[{id:'arrival',status:'complete'}]));await polling;
 check('GET begun before '+cause+' cannot replace changed revision/ledger',f.applied.length===0&&f.edit.revision===1&&f.state.jobs.length===0);
}
const reserved=fixture(),reservation=reserved.edit.beginCapture({name:'file'});await reserved.edit.poll();
check('Reserved capture preparation blocks a new GET',reserved.calls.length===0);
reservation.cancel();const next=reserved.edit.beginCapture({name:'next'});next.commit();reserved.edit.cancelCapture();
check('Committed capture stays owned after its question closes',captureRejected(reserved.edit));
check('Canceled old preparation cannot release newer save ownership',!reservation.finish()&&captureRejected(reserved.edit));
check('Only committed owner can finish and unblock the next capture',next.finish(true)&&await next.completed===true);
const following=reserved.edit.beginCapture({name:'following'});check('A late old finish cannot dismiss the next session',!next.finish()&&following.owns());following.cancel();
check('Cancel settles the question without adding a clip',await following.completed===false&&reserved.state.clips.length===1);

const changed=fixture(),captureReply=deferred();
const savingCapture=changed.edit.change(()=>captureReply.promise);changed.state.project='newer local edit';
await changed.edit.poll();check('An awaited project mutation blocks polling',changed.calls.length===0);
captureReply.resolve(changed.receipt(2,'captured baseline',[{id:'captured'}]));const result=await savingCapture;await changed.edit.flush();
check('Late capture receipt keeps newer authored edit and merges ledger',!result.adopted&&changed.state.project==='newer local edit'&&changed.applied[0].replace===false&&changed.applied[0].project.document.jobs[0].id==='captured'&&changed.edit.revision===3&&!changed.edit.dirty);

const imported=fixture(),importReply=deferred();const raw='{"seed":18446744073709551615}';let sent;
const importing=imported.edit.change(revision=>{sent={revision,raw};return importReply.promise;},true);imported.state.project='local during raw import';
importReply.resolve({project:imported.receipt(2,'imported library'),workflow:{id:'raw'}});const importedResult=await importing;
check('Raw import preserves bytes and rejects changed local draft without adoption',sent.raw===raw&&sent.revision===1&&!importedResult.adopted&&imported.applied.length===0&&imported.edit.revision===1&&imported.edit.dirty);

const conflict=fixture();conflict.setHold(()=>{throw Object.assign(Error('changed'),{status:409});});conflict.state.project='kept draft';await assert.rejects(conflict.edit.flush(),/Resolve/);
const count=conflict.calls.length;await conflict.edit.poll();
check('Conflict preserves exportable draft and blocks automatic reload',conflict.state.project==='kept draft'&&conflict.edit.dirty&&conflict.calls.length===count&&conflict.events.some(e=>e.kind==='conflict'&&e.error));
conflict.setHold(()=>Promise.resolve(conflict.receipt(4,'explicit saved reload')));await conflict.edit.reload();
check('Explicit reload clears conflict and adopts authoritative project',conflict.state.project==='explicit saved reload'&&conflict.edit.revision===4&&!conflict.edit.dirty);

const ledger=fixture();ledger.setHold(()=>Promise.resolve(ledger.receipt(1,'initial',[{id:'new result'}])));await ledger.edit.poll();await ledger.edit.poll();
check('Same-revision ledger arrival is accepted once with local view retained',ledger.applied.length===1&&ledger.state.jobs[0].id==='new result'&&ledger.state.frame===20&&ledger.state.selected==='clip'&&!ledger.edit.dirty);
ledger.setHold(()=>Promise.resolve(ledger.receipt(0,'stale')));await ledger.edit.poll();check('Older project response cannot roll revision backward',ledger.applied.length===1&&ledger.edit.revision===1);

const focused=fixture();focused.setFocused(true);focused.setHold(()=>Promise.resolve(focused.receipt(1,'initial',[{id:'focused arrival',status:'complete'}])));await focused.edit.poll();await focused.edit.poll();
check('Focused field permits one ledger merge without replacing authored state',focused.applied.length===1&&focused.applied[0].replace===false&&focused.state.jobs[0].id==='focused arrival'&&!focused.edit.dirty);
focused.setHold(()=>Promise.resolve(focused.receipt(2,'remote authored edit',[{id:'newer revision'}])));await focused.edit.poll();
check('Focused field defers a newer authored revision',focused.applied.length===1&&focused.edit.revision===1&&focused.state.project==='initial');
focused.setFocused(false);await focused.edit.poll();
check('Blur permits the deferred authored revision to apply',focused.applied.length===2&&focused.applied[1].replace===true&&focused.edit.revision===2&&focused.state.project==='remote authored edit');

const lateFocus=fixture(),focusReply=deferred();lateFocus.setHold(()=>focusReply.promise);const focusPoll=lateFocus.edit.poll();lateFocus.setFocused(true);focusReply.resolve(lateFocus.receipt(1,'initial',[{id:'late focused arrival'}]));await focusPoll;
check('Field focused during GET receives arrivals without a full replacement',lateFocus.applied.length===1&&lateFocus.applied[0].replace===false&&lateFocus.state.jobs[0].id==='late focused arrival');

const navigation=fixture(),navCapture=navigation.edit.beginCapture({});await assert.rejects(navigation.edit.prepareNavigation(),/Finish/);navCapture.cancel();
navigation.setBlocked(true);await assert.rejects(navigation.edit.prepareNavigation(),/Finish/);navigation.setBlocked(false);
navigation.state.project='saved before navigation';const put=deferred();navigation.setHold(()=>put.promise);const leaving=navigation.edit.prepareNavigation();await tick();const lateCapture=navigation.edit.beginCapture({});put.resolve(navigation.receipt(2));await assert.rejects(leaving,/Finish/);lateCapture.cancel();
navigation.setHold(null);await navigation.edit.prepareNavigation();check('Navigation flushes edits and rechecks ownership after awaited save',navigation.edit.revision===2&&!navigation.edit.dirty);

const epoch=fixture(),oldGet=deferred();epoch.setHold(()=>oldGet.promise);const oldPoll=epoch.edit.poll();const transient=epoch.edit.beginCapture({});transient.cancel();oldGet.resolve(epoch.receipt(2,'old response'));await oldPoll;
check('A capture that starts and ends during GET still invalidates its ownership',epoch.applied.length===0);
const reconnect=fixture();reconnect.setHold(()=>Promise.reject(Error('offline')));await reconnect.edit.poll();
check('Failed project polling reports connection loss',reconnect.events.at(-1).kind==='connection');
reconnect.setHold(null);await reconnect.edit.poll();
check('An unchanged successful poll clears connection loss without saving',reconnect.events.at(-1).kind==='saved'&&reconnect.applied.length===0&&reconnect.calls.every(c=>c.method!=='PUT'));
const sync=fixture();
sync.setHold(()=>Promise.resolve({...sync.receipt(1,'initial',[{id:'render',status:'queued',name:'Kept shot',seed:42}]),syncToken:'durable-1'}));await sync.edit.poll();
sync.setHold((path,body,method,headers)=>{assert.equal(headers['X-Spool-Since'],'durable-1');return Promise.resolve({revision:1,syncToken:'durable-1',jobs:[{id:'render',status:'running',nodeProgress:[{id:'sampler',value:2,max:10}]}]});});
await sync.edit.poll();
check('Lightweight sync retains shot metadata and updates live node progress',sync.state.jobs[0].name==='Kept shot'&&sync.state.jobs[0].seed===42&&sync.state.jobs[0].nodeProgress[0].value===2&&sync.state.project==='initial'&&!sync.edit.dirty);
const syncApplies=sync.applied.length;await sync.edit.poll();
check('Unchanged lightweight progress does not replace the edit again',sync.applied.length===syncApplies);
sync.setHold(()=>Promise.resolve({revision:1,syncToken:'durable-1',jobs:[{id:'render',status:'queued'}]}));await sync.edit.poll();
check('Progress reset removes obsolete node and worker observations',!sync.state.jobs[0].nodeProgress&&!sync.state.jobs[0].farmProgress&&sync.state.jobs[0].status==='queued');
sync.setFocused(true);sync.setHold((path,body,method,headers)=>{assert.equal(headers['X-Spool-Since'],'durable-1');return Promise.resolve({...sync.receipt(2,'remote revision'),syncToken:'durable-2'});});await sync.edit.poll();
sync.setFocused(false);await sync.edit.poll();
check('A deferred remote edit is not acknowledged until it can be adopted',sync.edit.revision===2&&sync.state.project==='remote revision');
sync.state.project='saved local';sync.setHold(null);await sync.edit.flush();
sync.setHold((path,body,method,headers)=>{assert.equal(headers['X-Spool-Since'],undefined);return Promise.resolve({...sync.receipt(),syncToken:'after-save'});});await sync.edit.poll();
check('Saving invalidates the previous sync token before reading arrivals',!sync.edit.dirty);
const syncEpoch=fixture(),syncReply=deferred();syncEpoch.setHold(()=>syncReply.promise);const pendingSync=syncEpoch.edit.poll();syncEpoch.edit.beginCapture({}).cancel();syncReply.resolve({...syncEpoch.receipt(2,'stale sync'),syncToken:'stale'});await pendingSync;
syncEpoch.setHold((path,body,method,headers)=>{assert.equal(headers['X-Spool-Since'],undefined);return Promise.resolve(syncEpoch.receipt());});await syncEpoch.edit.poll();
check('A stale in-flight response cannot acknowledge a newer sync token',syncEpoch.applied.length===0);
console.log(JSON.stringify({passed:checks.length,checks},null,2));
