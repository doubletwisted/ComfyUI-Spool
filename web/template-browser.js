import {TEMPLATE_MESSAGES,TEMPLATE_MODES,templateSession} from '/spool/ui/bridge.js';

// Keep Comfy's native chooser in its own document; never reparent Vue-owned nodes.
export function createEmbeddedTemplates(app,capture,browse){
 const {session,origin,view}=templateSession(location.search,TEMPLATE_MODES.browse)||{};
 if(parent===window||!session||!origin)return null;
 let address;try{address=new URL(origin);}catch{return null;}
 if(!['http:','https:'].includes(address.protocol)||!['127.0.0.1','localhost','[::1]'].includes(address.hostname))return null;
 let active=true,ready=false,selected=false,viewId=view;
 const send=value=>{if(active&&viewId)parent.postMessage({type:TEMPLATE_MESSAGES.state,session,viewId,...value},address.origin);};
 const style=document.createElement('style');style.textContent=`
 #vue-app{visibility:hidden;pointer-events:none}body{background:var(--bg-color,#18191b)}
 [aria-labelledby="global-workflow-template-selector"]{inset:0!important;transform:none!important;translate:none!important;scale:none!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important}
 [aria-labelledby="global-workflow-template-selector"]>div{width:100%!important;height:100%!important;max-width:none!important;border-radius:0!important}
 [aria-labelledby="global-workflow-template-selector"] button[aria-label="Close dialog"]{display:none}
 #spool-template-choice{position:fixed;inset:0;display:grid;place-content:center;gap:14px;text-align:center;padding:24px;color:var(--fg-color,#ddd);font:14px system-ui}
 #spool-template-choice p{margin:0;overflow-wrap:anywhere}#spool-template-choice button{padding:9px 14px;border:1px solid #555;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
 body:has([aria-labelledby="global-workflow-template-selector"]) #spool-template-choice{display:none}
 `;document.head.append(style);
 const choice=document.createElement('div');choice.id='spool-template-choice';const label=document.createElement('p');label.textContent='Choose a template to continue.';const button=document.createElement('button');button.textContent='Browse templates';button.onclick=browse;choice.append(label,button);document.body.append(choice);
 async function settled(){const end=Date.now()+120000;while(active&&app.extensionManager.spinner){if(Date.now()>end)throw Error('Comfy is still loading. Retry when it is ready.');await new Promise(resolve=>setTimeout(resolve,50));}return active;}
 async function activate(id){
  viewId=id;ready=false;selected=false;label.textContent='Choose a template to continue.';button.textContent='Browse templates';
  try{if(!await settled()||viewId!==id)return;if(!document.querySelector('[aria-labelledby="global-workflow-template-selector"]'))await browse();if(viewId!==id)return;ready=true;send({state:'ready'});}
  catch(error){send({state:'error',viewId:id,message:error.message});}
 }
 const receive=async event=>{
  const value=event.data;
  if(event.source!==parent)return;
  if(event.origin!==address.origin||value?.type!==TEMPLATE_MESSAGES.request||value.session!==session)return;
  if(value.action==='activate'&&typeof value.viewId==='string'){void activate(value.viewId);return;}
  if(value.viewId!==viewId)return;
  if(value.action==='suspend'){viewId=null;ready=false;selected=false;document.querySelectorAll('video,audio').forEach(media=>media.pause());return;}
  if(value.action!=='capture'||!selected)return;
  try{const result=await capture();send({state:'captured',viewId:value.viewId,requestId:value.requestId,capture:result});}
  catch(error){send({state:'error',viewId:value.viewId,requestId:value.requestId,message:error.message});}
 };
 const escape=event=>{
  if(event.key!=='Escape')return;
  const chooser=document.querySelector('[aria-labelledby="global-workflow-template-selector"]');
  if(chooser&&!chooser.contains(event.target)||[...document.querySelectorAll('[role="dialog"]')].some(dialog=>dialog!==chooser&&dialog.getClientRects().length&&getComputedStyle(dialog).visibility!=='hidden'))return;
  event.preventDefault();event.stopImmediatePropagation();send({state:'cancel'});
 };
 window.addEventListener('message',receive);
 window.addEventListener('keydown',escape,true);
 void activate(viewId);
 return {
  selected(){if(!ready)return;const id=viewId;void(async()=>{try{if(!await settled()||viewId!==id||!ready)return;selected=true;const name=app.extensionManager.workflow.activeWorkflow?.filename||'Selected workflow';label.textContent=name;button.textContent='Choose another template';send({state:'selected',name});}catch(error){send({state:'error',viewId:id,message:error.message});}})();},
  dispose(){active=false;window.removeEventListener('message',receive);window.removeEventListener('keydown',escape,true);choice.remove();style.remove();}
 };
}
