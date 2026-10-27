// Local, bounded timing evidence. Request bodies and workflow contents are never recorded.
export function createDiagnostics(changed,storage=globalThis.sessionStorage){
 const key='spool-diagnostics-v1',active=new Map();let recent=[],persistTimer=0,sequence=0;
 try{recent=JSON.parse(storage.getItem(key)||'[]').slice(-120);}catch(error){}
 function snapshot(){return {version:1,capturedAt:new Date().toISOString(),active:[...active.values()].map(({start,...entry})=>({...entry,elapsedMs:Math.round(performance.now()-start)})),recent:recent.slice()};}
 function update(){changed(snapshot());}
 function persist(){clearTimeout(persistTimer);try{storage.setItem(key,JSON.stringify(recent));}catch(error){}}
 function record(label,elapsedMs,error=null,detail=''){
  recent.push({at:new Date().toISOString(),label,elapsedMs:Math.round(elapsedMs),...(detail?{detail}:{}),...(error?{error:String(error.message||error).slice(0,500),...(error.stack?{stack:error.stack.slice(0,1500)}:{})}:{})});
  recent=recent.slice(-120);clearTimeout(persistTimer);persistTimer=setTimeout(persist,250);update();
 }
 function start(label,{background=false,quiet=false,detail=''}={}){
  const id=++sequence,started=performance.now();if(!quiet){active.set(id,{label,detail,background,start:started});update();}let done=false;
  return error=>{if(done)return;done=true;active.delete(id);const elapsed=performance.now()-started;if(!quiet||error||elapsed>=1000)record(label,elapsed,error,detail);};
 }
 async function run(label,task,options){const finish=start(label,options);try{const value=await task();finish();return value;}catch(error){finish(error);throw error;}}
 const timer=setInterval(()=>{if(active.size)update();},250);
 let observer=null;
 if(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){
  observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record('UI busy',entry.duration);});observer.observe({type:'longtask'});
 }
 const onError=event=>record('Browser error',0,event.error||event.reason||event.message||'Unhandled error');
 globalThis.addEventListener?.('error',onError);globalThis.addEventListener?.('unhandledrejection',onError);
 function dispose(){clearInterval(timer);observer?.disconnect();persist();globalThis.removeEventListener?.('error',onError);globalThis.removeEventListener?.('unhandledrejection',onError);}
 globalThis.addEventListener?.('pagehide',dispose,{once:true});
 update();return {start,run,record,snapshot,dispose};
}
