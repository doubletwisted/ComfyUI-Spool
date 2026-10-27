// Own readiness before any runtime, project or dependency can await.
const editor=document.getElementById('editor'),notice=document.createElement('div');
editor.inert=true;notice.id='spool-loading';notice.setAttribute('role','status');
notice.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;background:#111e;color:#eee;font:14px sans-serif;padding:24px';
notice.textContent='Loading Spool…';document.body.append(notice);
document.getElementById('saveStatus').textContent='Loading project…';
const events=['keydown','keyup','click','pointerdown','dragstart','dragover','drop','paste','storage'];
const block=e=>{e.preventDefault();e.stopImmediatePropagation();};
for(const event of events)window.addEventListener(event,block,true);
let failed=false,timer;
function fail(error){
 failed=true;editor.inert=true;
 notice.textContent='Spool could not load. Reload this page to retry. '+(error.message||'Initialization failed');
 document.getElementById('saveStatus').textContent='Not loaded';
}
const onError=e=>fail(e.error||Error(e.message));
window.addEventListener('error',onError);
try{
 const api=await Promise.race([
  import('/spool/ui/editor.js').then(module=>module.initializeEditor(()=>failed)),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Loading timed out')),30000);})
 ]);
 if(!failed){
  window.spoolNative=api;
  for(const event of events)window.removeEventListener(event,block,true);
  window.removeEventListener('error',onError);notice.remove();editor.inert=false;
 }
}catch(error){fail(error);}
finally{clearTimeout(timer);}
