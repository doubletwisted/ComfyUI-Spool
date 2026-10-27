import {createInputReplacements} from './input-replacement.js';
// Native editor runtime. Demo source is not loaded or transformed.
let initialization;
export function initializeEditor(isFailed){return initialization??=startEditor(isFailed);}
async function startEditor(isFailed){

'use strict';
const ICONS={
eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
eyeOff:'<path d="m3 3 18 18M9 5c8-2 13 7 13 7s-2 4-6 6M6 6c-3 2-4 6-4 6s4 7 10 7l3-1"/>',
pointer:'<path d="M5 3v17l4-5 4 7 3-2-4-7 7-1z"/>',
trim:'<path d="M9 4H5v16h4M15 4h4v16h-4M9 12h6"/>',
roll:'<path d="M10 4v16M14 4v16M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
slip:'<path d="M5 4v16M19 4v16M8 7h8v10H8zM1 12h4M19 12h4"/>',
slide:'<path d="M2 7h4v10H2zM9 7h6v10H9zM18 7h4v10h-4M9 3h6M9 21h6"/>',
audio:'<path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 5v14M23 10v4"/>',
link:'<path d="m10 14 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
logo:'<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="2.5"/><path d="M11 20h11"/>',
folder:'<path d="M3 7h6l2 2h10v11H3z"/><path d="M3 7V4h7l2 3"/>',
save:'<path d="M4 3h14l3 3v15H3V3z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
queue:'<path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 4v2M3 11v2M3 18v2"/>',
export:'<path d="M12 15V3m-4 4 4-4 4 4M4 13v8h16v-8"/>',
bin:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/>',
sidebar:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
plus:'<path d="M12 4v16M4 12h16"/>',
import:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
clipboard:'<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h6"/>',
sliders:'<path d="M4 7h8m4 0h4M4 17h3m4 0h9"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
 settings:'<path d="m10 3-1 3-3 1-3 3 2 2-2 2 3 3 3 1 1 3h4l1-3 3-1 3-3-2-2 2-2-3-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
expand:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
previous:'<path d="M5 5v14M19 5l-10 7 10 7z"/>',
next:'<path d="M19 5v14M5 5l10 7-10 7z"/>',
frameback:'<path d="M6 5v14M17 7l-7 5 7 5z"/>',
frameforward:'<path d="M18 5v14M7 7l7 5-7 5z"/>',
play:'<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/>',
pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
loop:'<path d="M4 8a7 7 0 0 1 12-3l3 3M19 3v5h-5M20 16a7 7 0 0 1-12 3l-3-3M5 21v-5h5"/>',
mute:'<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6"/>',
volume:'<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
nodes:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h9v9M6 9v9h9"/>',
spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
timeline:'<path d="M3 4h18M3 9h7v5H3zM12 9h9v5h-9zM3 17h18"/>',
cursor:'<path d="m5 3 14 10-7 1-3 7z"/>',
scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
copy:'<rect x="8" y="8" width="13" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
magnet:'<path d="M4 4h5v9a3 3 0 0 0 6 0V4h5v9a8 8 0 0 1-16 0zM4 8h5M15 8h5"/>',
undo:'<path d="M9 5 3 10l6 5M3 10h10a7 7 0 0 1 0 14" transform="translate(0 -3)"/>',
redo:'<path d="m15 5 6 5-6 5M21 10H11a7 7 0 0 0 0 14" transform="translate(0 -3)"/>',
fit:'<path d="M8 4H4v16h4M16 4h4v16h-4M8 12h8"/>',
keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1M7 16h10"/>',
close:'<path d="m6 6 12 12M18 6 6 18"/>',
check:'<path d="m5 12 4 4L20 5"/>'
};
let diagnosticsTimer=0;
const $=id=>document.getElementById(id);
const copy=x=>JSON.parse(JSON.stringify(x));
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=name=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+(ICONS[name]||ICONS.plus)+'</svg>';
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=svg(el.dataset.icon));}

const processingButton=document.createElement('button');processingButton.id='processingStatus';processingButton.className='processing-status';processingButton.title='Processing details and local diagnostics';processingButton.setAttribute('aria-label','Processing status and diagnostics');processingButton.setAttribute('aria-haspopup','dialog');
let topbar=null,latestSaveStatus={kind:'saved'};
processingButton.innerHTML='<span class="processing-dot" aria-hidden="true"></span><span id="processingLabel" role="status" aria-live="polite">Ready</span><span id="processingElapsed" aria-hidden="true"></span>';
$('saveStatus').parentElement.before(processingButton);
const {createDiagnostics}=await import('/spool/ui/diagnostics.js');
const diagnostics=createDiagnostics(value=>{
 const current=value.active.find(a=>!a.background),label=current?.label||'Ready',elapsed=current?(current.elapsedMs/1000).toFixed(1)+'s':'';
 if($('processingLabel').textContent!==label)$('processingLabel').textContent=label;$('processingElapsed').textContent=elapsed;
 processingButton.classList.toggle('busy',!!current);processingButton.title=current?(current.detail?current.detail+' - ':'')+label+' - '+elapsed:'Processing details and local diagnostics';
 const loading=$('spool-loading');if(loading?.textContent.startsWith('Loading Spool'))loading.textContent='Loading Spool... '+(current?label+' ('+elapsed+')':'');
});
const bootParams=new URLSearchParams(location.search);
let bootId=bootParams.get('project');
const {createApi}=await import('/spool/ui/api.js'),{createInterruptions}=await import('/spool/ui/pointer.js'),{pictureAt}=await import('/spool/ui/picture.js');
const interruptions=createInterruptions();
const api=createApi({diagnostics,project:()=>bootId,recipes:()=>unsavedRecipes}),request=api.request;
if(!bootId){const projects=await api.call('projects');bootId=projects[0]?.id;if(!bootId){const created=await api.call('projects',{method:'POST',body:{}});bootId=created.id;}const address=new URL(location.href);address.searchParams.set('project',bootId);window.history.replaceState(null,'',address);}
const BOOT=await diagnostics.run('Opening project',()=>api.call('projects/'+encodeURIComponent(bootId),{headers:{'X-Spool-View':'editor'},fallback:'Project unavailable'}));
const [{createWorkflowSetup,workflowStatus,matchClipInputs},{createProjectEdit},{createHistory,sameStacks},{createEditSession},{createPreviews,QUALITY},T,L,B,W,{videoFrameCount,createVideoSeekGuard},productCapabilities,{createThumbnails},G,{createTakeReview},builtinCatalog]=await Promise.all([
 import('/spool/ui/workflow-setup.js'),import('/spool/ui/project-edit.js'),import('/spool/ui/history.js'),import('/spool/ui/edit-session.js'),import('/spool/ui/preview.js'),import('/spool/ui/timeline.js'),import('/spool/ui/ledger.js'),import('/spool/ui/bridge.js'),import('/spool/ui/wire.js'),import('/spool/ui/video-seek-guard.js'),
 diagnostics.run('Loading Comfy node definitions',()=>api.call('capabilities',{fallback:'Comfy node definitions unavailable'})).catch(()=>({definitions:{}})),import('/spool/ui/thumbnails.js'),import('/spool/ui/generation.js'),import('/spool/ui/take-review.js'),fetch('/spool/ui/builtin-captures.json').then(r=>{if(!r.ok)throw Error('Built-in workflows unavailable');return r.json();}).catch(()=>({templates:{},cloudDefinitions:{},unavailable:true}))
]);
const inputReplacements=createInputReplacements();
let productDefinitions=productCapabilities.definitions||{};
const builtinCaptures=builtinCatalog.templates;
const cloudDefinitions={...builtinCatalog.cloudDefinitions,...productCapabilities.cloudDefinitions};
function definitionsFor(c){return (c?.executionTarget||nativeRecipes[c?.workflowVersion]?.executionTarget)==='cloud'?{...productDefinitions,...cloudDefinitions}:productDefinitions;}
if(isFailed())throw Error('Initialization cancelled');
const BASE='/spool/media/'+encodeURIComponent(BOOT.id)+'/';
const params=new URLSearchParams(location.search);
if(params.has('mode')){const address=new URL(location.href);address.searchParams.delete('mode');window.history.replaceState(null,'',address);}
const projectKey=BOOT.id,STORAGE_KEY='spool-native-'+projectKey,VIEW_KEY=STORAGE_KEY+':view';
const url=path=>path.startsWith('api/')?'/spool/'+path:path.startsWith('/')||path.startsWith('data:')?path:BASE+path;
const thumbnails=createThumbnails(url,diagnostics,$('viewerStage'),async(m,rate)=>{const entry=reviewSource(m,rate);if(entry.pending)await entry.pending;return reviewSource(m,rate);});
const takeHoverLabel=document.createElement('span');takeHoverLabel.className='take-hover-label';$('viewerStage').append(takeHoverLabel);
let fps=BOOT.document.fps||24;
const workflows={};
let workflowLibrary=null,templateBrowser=null;
const {createBuiltinPreparer,pixelResolution,builtinBindings}=await import('/spool/ui/builtin-workflows.js');
const {reusableBinding,resultChoices}=await import('/spool/ui/profile.js');
const builtinPreparer=createBuiltinPreparer();
let workflowAdds=Promise.resolve();
const importedWorkflowPoster='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#18181b"/><g transform="translate(224 84) scale(8)" fill="none" stroke="#ff9f5a" stroke-width="1.3">'+ICONS.nodes+'</g></svg>');
function isWorkflowDocument(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&(Array.isArray(value.nodes)?value.nodes.every(n=>n&&n.id!==undefined&&typeof n.type==='string'):Object.keys(value).length>0&&Object.values(value).every(n=>n&&typeof n.class_type==='string'&&n.inputs&&typeof n.inputs==='object'&&!Array.isArray(n.inputs)));}
function decodeWorkflowValue(value){for(let i=0;i<3&&typeof value==='string';i++)value=JSON.parse(value.trim());return value;}
function readWorkflowData(value){value=decodeWorkflowValue(value);if(isWorkflowDocument(value))return {workflow:copy(value),prompt:Array.isArray(value.nodes)?null:copy(value)};if(value&&typeof value==='object'){const graph=decodeWorkflowValue(value.workflow??value.prompt);if(isWorkflowDocument(graph)){let prompt=null;try{prompt=decodeWorkflowValue(value.prompt??null);}catch(error){}return {workflow:copy(graph),prompt:isWorkflowDocument(prompt)?copy(prompt):null};}}throw Error('This JSON is not a ComfyUI workflow. Use Open project for Spool projects.');}
function syncImportedWorkflows(){for(const [id,w] of Object.entries(workflows))if(w.imported)delete workflows[id];for(const saved of state.importedWorkflows||[])workflows[saved.id]={...saved,imported:true,short:'WF',poster:url(saved.poster||importedWorkflowPoster),sources:[],prompt:'',media:null};}
function registerWorkflowData(data,name,poster){const key=JSON.stringify(data),existing=(state.importedWorkflows||[]).find(w=>JSON.stringify(w.data)===key);if(existing)return existing;const w={id:'workflow-'+crypto.randomUUID(),name:name.replace(/\.(json|png|webp|jpe?g|mp4|mov|mkv|webm|gif)$/i,''),data:copy(data),poster:poster||importedWorkflowPoster};(state.importedWorkflows??=[]).push(w);syncImportedWorkflows();return w;}
function addImportedWorkflowClip(workflow,index=state.clips.length,m=null,placement=null,workflowVersion=null){
 const w=workflows[workflow];if(!w?.imported)return;edits.apply('Add '+w.name,()=>{pause();editView();clearHeld();
 const duration=w.data?.bindings?.find(b=>b.role==='duration'),seconds=duration?.unit==='seconds'?Number(w.data.prompt[duration.nodeId].inputs[duration.input]):5;
 const asset=m?copy(m):{id:'empty-'+crypto.randomUUID(),name:'Not generated',kind:'image',file:'assets/black.png',poster:importedWorkflowPoster,frames:Math.max(1,Math.round((seconds||5)*fps)),audio:false};
 const t={id:'take-'+crypto.randomUUID(),number:m?1:0,seed:null,revision:1,media:asset,sample:false,placeholder:!m,workflowSnapshot:copy(w.data)};
 const c={id:'clip-'+crypto.randomUUID(),name:m?m.name.replace(/\.[^.]+$/,''):w.name,workflow:w.id,...(w.data.executionTarget?{executionTarget:w.data.executionTarget}:{}),prompt:'',sources:[],seed:0,duration:asset.frames/fps,count:1,strength:.75,revision:1,takes:[t],takeId:t.id,in:0,out:asset.frames};
 if(workflowVersion)applyPreparedWorkflow(c,workflow,workflowVersion);
 T.insertClip(state,c,index,placement?{...placement,ripple:true}:{track:activeVideoTrack,start:T.videoTracks(state)>1?Math.round(state.frame):null});state.selected=c.id;state.selectedAudio=null;state.frame=rowFor(c.id).start;});setStatus(m?'Video and workflow added to the edit':'Workflow added · no generated take yet');
}
function applyPreparedWorkflow(c,workflow,version){
 inputReplacements.invalidate(c.id);
 const source=copy(c),recipe=nativeRecipes[version];c.workflow=workflow;c.workflowVersion=version;c.bindings=copy(recipe.bindings);
 c.inputValues=Object.fromEntries(recipe.bindings.map(b=>[b.key,recipe.provenance?.builtinTemplate&&b.asset?'':copy(recipe.prompt[b.nodeId].inputs[b.input])]));c.executionTarget=recipe.executionTarget||'local';
 delete c.generationBase;delete c.shotInputs;delete c.seedKey;c.seedMode='same';c.revision++;matchClipInputs(c,source,recipe,definitionsFor(c),fps);
}
const INITIAL={...BOOT.document,selected:null,frame:0,zoom:100,snap:true,muted:true,loop:false};
const defaultAudioTracks={sourceMuted:false,sourceSolo:false,musicMuted:false,musicSolo:false};
const pool=new Map(),drawn={};
let pendingClipMove=null,clipMoveRAF=0;
let inspectorTab='inputs',trimPreviewTimer=0,savedHistory=null,audioContext=null,masterGain=null,audioAnalyser=null,timelineDrag=null,timelinePan=null;
const audioPlayers=new Map();
const held={s:false,d:false,shift:false,alt:false};let hoverTarget=null,selectedCut=null,nudgeGroup=null,trimSingle=false;
let exportRangeDrag=null;
let state=copy(INITIAL),binTab='workflows',workflowLocked=false,playing=false,ppf=1,drag=null,shownVideo=null,toastTimer,raf=0,previousTime=0,modalReturnFocus=null,modalCleanup=null;
const review=createTakeReview(()=>state.clips);
const {createTakeSeen}=await import('/spool/ui/take-seen.js');
const takeSeen=createTakeSeen(projectKey,state.clips,localStorage);
const history=createHistory(),undoStack=history.undo,redoStack=history.redo;
const edits=createEditSession({history,current:()=>state,reset:()=>{selectedCut=null;nudgeGroup=null;},recorded:()=>buttons(),save:()=>save(),repaint:scope=>({all:()=>render(),inspector:renderInspector,timeline:()=>{renderTimeline();updateViewer();},audio:()=>{renderAudioTimeline(layout());audioButtons();},range:renderExportRange,none:()=>{}})[scope]()});
try{const view=JSON.parse(sessionStorage.getItem(VIEW_KEY));if(view){Object.assign(state,view);trimSingle=!!view.trimSingle;}}catch(error){}
let selectedTakeClip=state.takeSelection?.clipId||null,selectedTakeIds=state.takeSelection?.ids||[],takeSelectionAnchor=state.takeSelection?.anchor||null;
function viewState(){return {takeSelection:{clipId:selectedTakeClip,ids:selectedTakeIds,anchor:takeSelectionAnchor},selected:state.selected,selectedAudio:state.selectedAudio,selection:selectionIds(),frame:state.frame,zoom:state.zoom,snap:state.snap,muted:state.muted,loop:state.loop,previewQuality:previewQuality(),trimSingle,viewerZoom,activeVideoTrack};}
function projectData(){return L.savedDocument(state);}
const selected=()=>state.clips.find(c=>c.id===state.selected);
let selectionAnchor=null,activeVideoTrack=state.activeVideoTrack||T.videoTrack(state.clips.find(c=>c.id===state.selected)||{});
const trackHeightsKey=STORAGE_KEY+':track-heights:full';
const trackHeights={};let trackResize=null;
try{const saved=JSON.parse(localStorage.getItem(trackHeightsKey));for(const [key,value] of Object.entries(saved||{}))if(/^(video:[1-9]\d*|source:[1-9]\d*|music)$/.test(key)&&Number.isFinite(value))trackHeights[key]=value;}catch(error){}
const trackHeightBounds=key=>({min:key.startsWith('video:')?48:24,max:key.startsWith('video:')?480:320});
const defaultTrackHeight=key=>key.startsWith('video:')?96:48;
const trackHeight=key=>{const b=trackHeightBounds(key);return Math.min(b.max,Math.max(b.min,trackHeights[key]??defaultTrackHeight(key)));};
const videoLaneHeight=track=>trackHeight('video:'+track);
const trackVariable=(kind,track,part)=>'--'+kind+'-'+part+'-'+track;
function trackAt(e){const kind=e.target?.closest?.('#audioLane')?'source':'video',rect=$(kind==='source'?'audioLane':'clipLane').getBoundingClientRect(),y=e.clientY-rect.top;let end=0;for(let track=T.videoTracks(state);track>0;track--){if(kind==='source'&&T.sourceTrackHidden(state,track))continue;end+=trackHeight(kind+':'+track);if(y<end)return track;}return 1;}
function trackResizeHandle(key,label){return '<div class="track-resize" data-track-resize="'+key+'" role="separator" aria-orientation="horizontal" aria-label="Resize '+label+'" tabindex="0" title="Drag to resize '+label+'; double-click to reset"></div>';}
function setStyle(node,key,value){if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);}
function applyTrackHeights(){
 const editor=$('editor'),count=T.videoTracks(state);
 for(const kind of ['video','source']){let top=0;for(let track=count;track>0;track--){const height=kind==='source'&&T.sourceTrackHidden(state,track)?0:trackHeight(kind+':'+track);setStyle(editor,trackVariable(kind,track,'top'),top+'px');setStyle(editor,trackVariable(kind,track,'height'),height+'px');top+=height;}$(kind==='video'?'clipLane':'audioLane').style.height=top+'px';}
 $('musicLane').hidden=$('musicTrackHeader').hidden=!!state.audioTracks?.musicHidden;
 setStyle(editor,'--music-height',trackHeight('music')+'px');
 $('musicLane').style.height=trackHeight('music')+'px';
 for(const handle of $('trackHeaders').querySelectorAll('[data-track-resize]')){const key=handle.dataset.trackResize,b=trackHeightBounds(key);handle.setAttribute('aria-valuemin',b.min);handle.setAttribute('aria-valuemax',b.max);handle.setAttribute('aria-valuenow',Math.round(trackHeight(key)));handle.setAttribute('aria-valuetext',Math.round(trackHeight(key))+' pixels');}
 $('trackHeaders').style.transform='translateY(-'+$('timelineScroll').scrollTop+'px)';
}
function storeTrackHeights(){try{localStorage.setItem(trackHeightsKey,JSON.stringify(trackHeights));}catch(error){}}
function renderAudioTrackHeaders(count){
 const header=$('sourceTrackHeader'),key='source:'+count;
 header.hidden=T.sourceTrackHidden(state,count);header.style.height='var(--source-height-'+count+')';header.querySelector('.track-title b').textContent=count>1?'A1 / V'+count:'A1';header.title='Clip audio from V'+count+'. M/S controls affect all A1 clip audio.';
 if(header.querySelector('[data-track-resize]')?.dataset.trackResize!==key){header.querySelector('[data-track-resize]')?.remove();header.insertAdjacentHTML('beforeend',trackResizeHandle(key,'A1 clip audio from V'+count));}
 draw('sourceExtraTrackLabels',Array.from({length:count-1},(_,i)=>{const track=count-i-1;if(T.sourceTrackHidden(state,track))return '';return '<div class="track-label audio source-track-label" style="height:var(--source-height-'+track+')"><span class="track-title"><b>A1 / V'+track+'</b><small>Clip audio</small></span>'+trackResizeHandle('source:'+track,'A1 clip audio from V'+track)+'</div>';}).join(''));
 const music=$('musicTrackHeader');music.style.height='var(--music-height)';if(!music.querySelector('[data-track-resize]'))music.insertAdjacentHTML('beforeend',trackResizeHandle('music','A2 soundtrack'));
}
function selectionIds(){const available=new Set([...state.clips,...state.audioClips||[]].map(c=>c.id));if(state.selectedAudio&&!available.has(state.selectedAudio))state.selectedAudio=null;const active=state.selectedAudio||state.selected;if(!Array.isArray(state.selection)||active&&!state.selection.includes(active))state.selection=active&&available.has(active)?[active]:[];state.selection=state.selection.filter(id=>available.has(id));return state.selection;}
function setTimelineSelection(ids,primary=ids.at(-1)){const available=new Set([...state.clips,...state.audioClips||[]].map(c=>c.id));state.selection=[...new Set(ids)].filter(id=>available.has(id));if(!state.selection.includes(primary))primary=state.selection.at(-1);const audio=(state.audioClips||[]).find(c=>c.id===primary);state.selectedAudio=audio?.id||null;if(!audio)state.selected=primary||null;}
function selectTimelineItem(id,modifiers={},preserve=false){const current=selectionIds().slice(),toggle=modifiers?.ctrlKey||modifiers?.metaKey;
 if(modifiers?.shiftKey){const audio=(state.audioClips||[]).find(c=>c.id===id),lane=audio?(state.audioClips||[]).filter(c=>T.audioTrack(c)===T.audioTrack(audio)&&(T.audioTrack(c)!=='source'||T.sourceLane(c)===T.sourceLane(audio))).sort((a,b)=>a.start-b.start):T.trackClips(state,T.videoTrack(state.clips.find(c=>c.id===id)));const a=lane.findIndex(c=>c.id===(selectionAnchor||state.selectedAudio||state.selected)),b=lane.findIndex(c=>c.id===id),range=a<0?[id]:lane.slice(Math.min(a,b),Math.max(a,b)+1).map(c=>c.id);setTimelineSelection(toggle?[...current,...range]:range,id);}
 else if(toggle){setTimelineSelection(current.includes(id)?current.filter(x=>x!==id):[...current,id],id);selectionAnchor=id;}
 else{setTimelineSelection(preserve&&current.includes(id)?current:[id],id);if(!preserve||!current.includes(id)||!selectionAnchor)selectionAnchor=id;}
}
const selectedVideos=()=>{const ids=new Set(selectionIds());return state.clips.filter(c=>ids.has(c.id));};
function selectionQueueReason(){const clips=selectedVideos();return !clips.length?'Select a video clip.':clips.map(queueReason).find(Boolean)||null;}
const take=T.takeOf;
const videoTotal=()=>T.videoTotal(state);
const total=()=>T.total(state);
const layout=()=>T.layout(state);
const gapAfter=index=>T.gapAfter(state,index);
const editActions={move:{name:'Move'},trim:{name:'Trim'},ripple:{name:'Ripple trim'},roll:{name:'Roll'},slip:{name:'Slip'},slide:{name:'Slide'}};
const rowFor=id=>T.rowFor(state,id);
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
// Positions read as timecode; durations read as seconds with two decimals.
function seconds(frames){return (frames/fps).toFixed(2)+'s';}
function tc(frames){frames=Math.max(0,Math.floor(frames));return [Math.floor(frames/(fps*3600)),Math.floor(frames/(fps*60))%60,Math.floor(frames/fps)%60,frames%fps].map(n=>String(n).padStart(2,'0')).join(':');}
function saveHistory(){try{
 const project=editingSignature(projectData());
 if(savedHistory?.project===project&&sameStacks(savedHistory,undoStack,redoStack))return;
 const started=performance.now();sessionStorage.setItem(VIEW_KEY+':history',history.serialize(project));if(performance.now()-started>50)diagnostics.record('Saving undo history',performance.now()-started);
 savedHistory={project,undo:undoStack.slice(),redo:redoStack.slice()};
}catch(error){}}
const editingSignature=L.editSignature;

function save(){if(drag&&drag.kind!=='scrub')return;saveView();saveHistory();projectEdit.save();}
function receiveProject(saved){
 evidenceCache.clear();
 if(drag&&drag.before&&editingSignature(saved)===editingSignature(drag.before)){L.mergeArrivals(state,saved);renderTakes();return;}
 if(editingSignature(saved)!==editingSignature(projectData())){inputReplacements.invalidate();selectedCut=null;nudgeGroup=null;if(drag)cancelClipDrag();if(!workflowLocked)history.clear();}
 const view=viewState(),active=document.activeElement,clipId=state.selected;
 const draft=active&&$('editor').contains(active)&&active.matches('input:not([type=range]),textarea,select')?{id:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd}:null;
 state={...copy(INITIAL),...saved,...view};fps=state.fps||24;
 if(state.selected&&!state.clips.some(c=>c.id===state.selected))state.selected=state.clips[0]?.id||null;
 state.frame=clamp(state.frame,0,total());
 review.reconcile();
 render(false);
 if(draft&&(clipId===state.selected||draft.id==='projectName')){const field=$(draft.id);if(field){field.value=draft.value;field.focus({preventScroll:true});if(draft.start!==null&&field.setSelectionRange&&field.type!=='number')field.setSelectionRange(draft.start,draft.end);}}
 if($('queueList'))renderQueueList();
}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
function setStatus(text){$('status').textContent=text;}
function buttons(){const audio=selectedAudio(),count=selectionIds().length;$('split').disabled=count>1||review.mode==='source'||(audio?state.frame<=audio.start+5||state.frame>=audio.start+audio.out-audio.in-5:!T.splitTarget(state,state.frame,selected()?.id));for(const [id,stack,shortcut] of [['undo',undoStack,'Ctrl+Z'],['redo',redoStack,'Ctrl+Shift+Z / Ctrl+Y']]){$(id).disabled=!stack.length||!!drag;$(id).title=stack.length?id[0].toUpperCase()+id.slice(1)+' '+(stack.at(-1)._label||'edit')+' ('+shortcut+')':'Nothing to '+id+' ('+shortcut+')';}$('remove').disabled=!count;$('duplicate').title=count>1?'Duplicate '+count+' selected clips':'Duplicate selected clip';$('remove').title=count>1?'Delete '+count+' selected clips (Delete)':'Delete selected clip (Delete)';$('duplicate').disabled=!count;$('clipName').disabled=!count||count>1;for(const id of ['generate','openWorkflow'])$(id).disabled=!selected()||!!audio;$('snap').setAttribute('aria-pressed',state.snap);$('loop').setAttribute('aria-pressed',state.loop);
 if(count>1)$('generate').disabled=!!selectionQueueReason();else if(selected()&&!selectedAudio())$('generate').disabled=!!queueReason(selected());
 const generateReason=selectedAudio()||!selected()?'':count>1?selectionQueueReason():queueReason(selected());$('generateReason').textContent=generateReason||'';$('generateReason').hidden=!generateReason;
}

const preserveTakes=restored=>L.preserveArrivals(restored,state);
function restoreHistory(from,to,verb){selectedCut=null;if(drag){cancelClipDrag();return;}if(!from.length)return;pause();editView();const view=viewState(),step=history.step(from,to,state);if(!step){buttons();setStatus('That edit is no longer available');return;}inputReplacements.invalidate();state=preserveTakes(step.restored);review.reconcile();selectionAnchor=state.selectedAudio||state.selected;for(const key of ['zoom','snap','muted','loop','previewQuality'])state[key]=view[key];render();save();setStatus(verb+' '+(step.label||'edit'));if(!document.activeElement||document.activeElement===document.body)$('editor').focus({preventScroll:true});}
function undo(){nudgeGroup=null;restoreHistory(undoStack,redoStack,'Undid');}
function redo(){nudgeGroup=null;restoreHistory(redoStack,undoStack,'Redid');}

let laneDraws=0;
function draw(id,html){if(drawn[id]===html)return false;drawn[id]=html;if(id==='clipLane')laneDraws++;$(id).innerHTML=html;return true;}
function syncTimelineSelection(){
 const ids=new Set(selectionIds());for(const node of $('timelineContent').querySelectorAll('[data-clip],[data-audio],[data-linked-audio]')){const on=ids.has(node.dataset.clip||node.dataset.audio||node.dataset.linkedAudio);node.classList.toggle('selected',on);if(node.hasAttribute('aria-pressed'))node.setAttribute('aria-pressed',on);}
}
function render(force=true){fps=state.fps||24;document.querySelectorAll('.project-fps').forEach(e=>e.textContent=Math.round(fps*1000)/1000);renderBin();renderInspector();renderTimeline();updateViewer(force);$('projectName').value=state.project;$('zoom').value=state.zoom;$('zoomValue').textContent=state.zoom+'%';$('snap').classList.toggle('active',state.snap);$('loop').classList.toggle('active',state.loop);audioButtons();buttons();queueLabel();}
let mediaView='grid',mediaFilter='all';
try{mediaView=sessionStorage.getItem(VIEW_KEY+':media-view')==='list'?'list':'grid';}catch(error){}
function applyMediaView(){
 $('mediaPanel').dataset.tab=binTab;
 for(const button of $('mediaPanel').querySelectorAll('[data-bin-tab]')){const active=button.dataset.binTab===binTab;button.classList.toggle('active',active);button.setAttribute('aria-selected',active);}
 const active=binTab==='media';
 $('binGrid').classList.toggle('media-list',active&&mediaView==='list');
 for(const view of ['grid','list']){$('mediaView'+view).setAttribute('aria-pressed',mediaView===view);$('mediaView'+view).classList.toggle('active',mediaView===view);}
 $('mediaViewControls').hidden=!active;
}
for(const view of ['grid','list'])$('mediaView'+view).onclick=()=>{mediaView=view;try{sessionStorage.setItem(VIEW_KEY+':media-view',view);}catch(error){}renderBin();};
function renderBin(){
 applyMediaView();syncImportedWorkflows();workflowLibrary?.render();renderFullLibrary();
}
function mediaRemoveButton(m){return '<button class="remove-media" data-remove-media="'+esc(m.id)+'" title="Remove from media pool" aria-label="Remove '+esc(m.name)+' from media pool">'+svg('trash')+'</button>';}
function takeFacts(t){
 if(!t||t.placeholder)return '';
 const m=t.media||{},source=String(m.originalFile||m.name||'').split('/').at(-1);
 const rows=[['Selected take',(t.original?'Original clip':'T'+String(t.number).padStart(2,'0'))+(t.generated?' · generated':'')],['Source',source],['Length',m.frames?seconds(m.frames)+' · '+m.frames+' frames':''],['Size',m.width&&m.height?m.width+' × '+m.height:''],['Frame rate',m.fps?String(m.fps).replace(/\/1$/,'')+' fps':''],['Audio',m.kind==='video'?(m.audio?'Yes':'No'):''],['Seed',t.seed!=null?decimal(t.seed):'']].filter(([,value])=>value);
 return '<dl class="take-facts">'+rows.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd title="'+esc(value)+'">'+esc(value)+'</dd>').join('')+'</dl>';
}
function mediaOwners(){const owners=new Map();for(const c of state.clips)for(const t of c.takes||[])if(t.media?.id&&!owners.has(t.media.id))owners.set(t.media.id,{clip:c,take:t});return owners;}
function mediaLabel(m,owner){return owner?owner.clip.name:m.name;}
function mediaTake(owner){return owner?(owner.take.original?'Original':'Take '+owner.take.number)+' / ':'';}
function mediaCard(m,owner){const label=mediaLabel(m,owner);return '<div class="bin-card'+(review.source?.media.id===m.id?' active':'')+'" draggable="true" tabindex="0" role="button" aria-label="Preview '+esc(label)+'" data-media="'+m.id+'"><img src="'+esc(url(m.poster))+'" alt=""><span class="bin-tag">'+(owner&&!owner.take.original?'T'+String(owner.take.number).padStart(2,'0')+' · ':'')+(m.kind==='image'?'Image':m.kind==='audio'?'Audio':seconds(m.frames))+'</span><button class="add" data-add-media="'+m.id+'" title="Add to timeline" aria-label="Add '+esc(m.name)+' to timeline">'+svg('plus')+'</button>'+mediaRemoveButton(m)+'<div class="bin-text"><strong title="'+esc(m.name)+'">'+esc(label)+'</strong><span class="media-detail">'+esc(mediaTake(owner))+esc(m.kind)+(m.kind==='image'?'': ' / '+seconds(m.frames))+(m.width&&m.height?' / '+m.width+' x '+m.height:'')+'</span></div></div>';}
function projectMedia(){const items=new Map((state.media||[]).map(m=>[m.id,m]));for(const c of state.clips)for(const t of T.realTakes(c))if(!t.generated&&!items.has(t.media.id))items.set(t.media.id,t.media);const hidden=new Set(state.hiddenMediaIds||[]);return [...items.values()].filter(m=>!hidden.has(m.id));}
function renderFullLibrary(){
 const query=$('poolSearch').value.trim().toLowerCase(),items=projectMedia().filter(m=>(mediaFilter==='all'||m.kind===mediaFilter)&&m.name.toLowerCase().includes(query));
 $('binTitle').textContent=items.length+' '+(items.length===1?'item':'items');
 const empty=query?'<div class="pool-empty"><strong>No matching media</strong><p>Try another name or clear your search.</p><button class="outline" data-clear-search>Clear search</button></div>':'<div class="pool-empty"><span class="empty-symbol">'+svg(binTab==='workflows'?'audio':'import')+'</span><strong>'+(binTab==='workflows'?'Add your soundtrack':'Bring your media in')+'</strong><p>'+(binTab==='workflows'?'Import audio or a video with sound.':'Video, images and audio, ready to edit.')+'</p><button class="outline" data-pool-import>'+svg('plus')+'Import media</button><small>You can also drop files here</small></div>';
 if(draw('binGrid',items.length?(owners=>items.map(m=>mediaCard(m,owners.get(m.id))).join(''))(mediaOwners()):empty)){
  const clear=$('binGrid').querySelector('[data-clear-search]'),add=$('binGrid').querySelector('[data-pool-import]');
  if(clear)clear.onclick=()=>{$('poolSearch').value='';renderBin();$('poolSearch').focus();};
  if(add)add.onclick=()=>pickImport();
  $('binGrid').querySelectorAll('[data-add-media]').forEach(b=>b.onclick=e=>{e.stopPropagation();addMediaClip(b.dataset.addMedia);});
  $('binGrid').querySelectorAll('[data-media]').forEach(b=>{const m=projectMedia().find(m=>m.id===b.dataset.media);thumbnails.bind(b.querySelector('img'),m,m.frames/2,fps);b.onclick=e=>{if(e.target.closest('button'))return;const m=projectMedia().find(m=>m.id===b.dataset.media);pause();finishViewerPan();closeTakeComparison();review.openMedia(m);renderBin();renderTakes();updateViewer(true);$('binGrid').querySelector('[data-media="'+CSS.escape(m.id)+'"]')?.focus({preventScroll:true});};b.ondragstart=e=>e.dataTransfer.setData('application/spool',JSON.stringify({media:b.dataset.media}));});
 }
}
async function browseComfyTemplates(){
 const {createTemplateBrowser}=await import('/spool/ui/template-browser.js');
 showModal('Workflow templates','<div id="templateMount" class="template-mount"><div class="template-loading">Loading Comfy templates...</div></div>','<span id="templateStatus" role="status">Connecting to Comfy...</span><button class="outline" id="templateRetry" hidden>Retry</button><button class="outline" id="templateCancel">Cancel</button><button class="primary" id="templateUse" disabled>Use workflow</button>');
 $('modal').classList.add('template-dialog');
 const mount=$('templateMount'),status=$('templateStatus'),retryButton=$('templateRetry');
 const browser=templateBrowser??=createTemplateBrowser({overlay:$('modalOverlay'),onCancel:closeModal,onUse:async capture=>{closeModal();try{await captureInputs(capture,capture.name||'Comfy template');}catch(error){toast(error.message);}}});
 modalCleanup=browser.suspend;$('templateCancel').onclick=closeModal;retryButton.onclick=()=>{browser.reset();void browseComfyTemplates();};
 try{
  await flushNative();
  if(!browser.canReuse(productCapabilities.configuration?.comfyUrl)){
   await connectComfy();const {definitions,...metadata}=await request('capabilities?types=');Object.assign(productCapabilities,metadata);
  }
  if(mount.isConnected&&!$('modalOverlay').hidden)browser.open(productCapabilities.configuration.comfyUrl,{mount,status,useButton:$('templateUse'),retryButton});
 }catch(error){if(mount.isConnected){status.textContent=error.message;retryButton.hidden=false;}}
}
function removeMedia(id){
 const items=projectMedia(),index=items.findIndex(m=>m.id===id);if(index<0)return;
 edits.apply('Remove '+items[index].name+' from media pool',()=>{
 state.hiddenMediaIds=[...new Set([...state.hiddenMediaIds||[],id])];
 if(review.source?.media.id===id){pause();editView();review.clear();}
 });setStatus('Removed from media pool');
 const next=projectMedia()[Math.min(index,projectMedia().length-1)];
 ($('binGrid').querySelector('[data-media="'+CSS.escape(next?.id||'')+'"]')||$('editor')).focus({preventScroll:true});
}
$('binGrid').addEventListener('click',e=>{const button=e.target.closest('[data-remove-media]');if(!button)return;e.preventDefault();e.stopPropagation();removeMedia(button.dataset.removeMedia);},true);
$('binGrid').addEventListener('keydown',e=>{const card=e.target.closest('[data-media]');if(!card||e.target.closest('button'))return;if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();removeMedia(card.dataset.media);}else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();card.click();}});
const preparedWorkflows=new Map();
const workflowLoads=new Map();
const unsavedRecipes=new Map();
const workflowSignatures=new WeakMap();
function workflowSourceKey(data){if(!workflowSignatures.has(data))workflowSignatures.set(data,JSON.stringify([data.workflow,data.prompt,data.bindings,data.result,data.resultOnly,data.widgetBindings,data.executionTarget||'local']));return workflowSignatures.get(data);}
function libraryWorkflow(id,builtin){
 const w=builtin?workflowLibrary.template(id):workflows[id];if(!w)return {};
 const sources=builtin?Object.values(workflows).filter(w=>w.data?.prompt&&w.data.provenance?.builtinTemplate===id&&workflowSourceKey(w.data)===workflowSourceKey(builtinCaptures[id])):[w],source=sources[0];
 const key=(builtin?'builtin:':'project:')+id;
 let prepared=preparedWorkflows.get(key);
 if(!prepared)for(const candidate of sources.filter(w=>w?.data.prompt)){
  const signature=workflowSourceKey(candidate.data),entry=Object.entries(nativeRecipes).find(([,recipe])=>workflowSourceKey(recipe)===signature);
  if(entry){prepared={workflow:candidate.id,version:entry[0],definitions:productDefinitions};preparedWorkflows.set(key,prepared);break;}
 }
 return {w,source,key,prepared};
}
function loadProjectWorkflow(id){
 const {w,source,key}=libraryWorkflow(id,false);if(!w)return;
 if(workflowLoads.has(key))return workflowLoads.get(key);
 const promise=(async()=>{
  if(source?.data.prompt)return {...copy(source.data),importedWorkflowId:source.id};
  if(!productCapabilities.connected)await connectComfy();
  const graph=w.data?.workflow;
  const captured=await builtinPreparer.capture(productCapabilities.configuration.comfyUrl,copy(graph));
  return {...captured,importedWorkflowId:id};
 })();
 workflowLoads.set(key,promise);promise.catch(()=>workflowLoads.delete(key));return promise;
}
function addLibraryShot(id,index=null,clipId=null,builtin=false,placement=null){
 workflowAdds=workflowAdds.catch(()=>{}).then(async()=>{
  const {w,key,prepared:existing}=libraryWorkflow(id,builtin);if(!w)return;
  let prepared=existing;
  const target=clipId&&state.clips.find(c=>c.id===clipId);if(clipId&&!target)throw Error('This clip was removed.');
  if(index===null){index=state.clips.length;placement={track:1,start:total()};}
  const name=builtin?w.family+' · '+w.name:w.name;
  const profileTemplate=builtin?w:workflowLibrary.template(w.data?.provenance?.builtinTemplate);
  if(!prepared&&builtin){
   const capture=copy(builtinCaptures[id]);
   capture.bindings=builtinBindings(capture,productDefinitions);
   const workflow=registerWorkflowData(capture,name),version=crypto.randomUUID();
   nativeRecipes[version]=capture;unsavedRecipes.set(version,capture);
   prepared={workflow:workflow.id,version,definitions:w.section==='cloud'?{...productDefinitions,...cloudDefinitions}:productDefinitions};preparedWorkflows.set(key,prepared);
  }
  // The new shot and its recipe share the ordinary save queue. Neither graph
  // capture nor NAS publication should block the edit.
  if(prepared&&(profileTemplate||resultChoices(nativeRecipes[prepared.version].prompt,prepared.definitions).length===1)){
   if(target)edits.apply('Replace workflow',()=>applyPreparedWorkflow(target,prepared.workflow,prepared.version));
   else addImportedWorkflowClip(prepared.workflow,index,null,placement,prepared.version);
   $('editor').focus({preventScroll:true});setStatus('Workflow added');return;
  }
  setStatus('Preparing '+name+'…');
  let definitions;
  const capture=async()=>{const value=prepared?{...copy(nativeRecipes[prepared.version]),definitions:prepared.definitions,importedWorkflowId:prepared.workflow}:copy(await loadProjectWorkflow(id));definitions=value.definitions||productDefinitions;return value;};
  const session=await workflowSetup.start({capture,name,index,clipId,automatic:true,builtin:profileTemplate,replaceWorkflow:!!clipId,placement,preparedVersion:prepared?.version,definitions:productDefinitions,previous:!clipId&&profileTemplate?w.data:null});
  if(session){await session.completed;const saved=state.clips.find(c=>c.id===session.savedClipId);if(saved?.workflowVersion)preparedWorkflows.set(key,{workflow:saved.workflow,version:saved.workflowVersion,definitions});}
 }).catch(error=>{toast(error.message);setStatus('Workflow was not added');});
 return workflowAdds;
}
function addBuiltinShot(id,index=null,clipId=null,placement=null){return addLibraryShot(id,index,clipId,true,placement);}
function showShotPicker(){
 pause();showModal('Add shot','<div class="shot-picker"><section><h3>Workflows</h3><div class="shot-workflows">'+Object.entries(workflows).map(([id,w])=>'<button class="workflow-row" data-shot-workflow="'+id+'">'+esc(w.name)+'</button>').join('')+'</div><button class="outline" id="shotImportWorkflow">'+svg('plus')+'Import workflow</button></section><section><h3>Media</h3><div class="shot-media">'+projectMedia().filter(m=>m.kind!=='audio').map(m=>'<button class="shot-media-item" data-shot-media="'+m.id+'"><img src="'+esc(url(m.poster))+'" alt=""><span>'+esc(m.name)+'</span></button>').join('')+'</div><button class="outline" id="shotImportMedia">'+svg('import')+'Import media</button></section></div>','<button class="outline" id="shotCancel">Cancel</button>');
 $('shotCancel').onclick=closeModal;
 $('modal').querySelectorAll('[data-shot-media]').forEach(b=>{const m=projectMedia().find(m=>m.id===b.dataset.shotMedia);thumbnails.bind(b.querySelector('img'),m,m.frames/2,fps);});
 $('modal').querySelectorAll('[data-shot-workflow]').forEach(b=>b.onclick=()=>{const id=b.dataset.shotWorkflow;closeModal();addLibraryShot(id);});
 $('modal').querySelectorAll('[data-shot-media]').forEach(b=>b.onclick=()=>{const id=b.dataset.shotMedia;closeModal();addMediaClip(id,state.clips.length,videoTotal());});
 $('shotImportWorkflow').onclick=()=>{closeModal();pickImport(true,true);};$('shotImportMedia').onclick=()=>{closeModal();pickImport(true);};
}
function pickImport(add=false,workflowOnly=false){$('mediaFiles').accept=workflowOnly?'.json':'.json,video/*,image/*,audio/*';$('mediaFiles').onchange=e=>importFiles(e.target.files,add,videoTotal());$('mediaFiles').click();}
const takeName=t=>t.placeholder?'Not generated':t.original?'Original clip':'Take '+String(t.number).padStart(2,'0');
const pendingJobs=c=>visibleJobs().filter(j=>j.clipId===c.id&&G.PENDING.includes(j.status));
function renderNonVideoInspector(){
 const audio=selectedAudio();$('inputsInspectorTab').classList.toggle('active',inspectorTab==='inputs'&&!audio);$('audioInspectorTab').classList.toggle('active',inspectorTab==='audio'||!!audio);$('inputsInspectorTab').setAttribute('aria-selected',inspectorTab==='inputs'&&!audio);$('audioInspectorTab').setAttribute('aria-selected',inspectorTab==='audio'||!!audio);$('generate').hidden=!!audio;$('inspector').classList.toggle('audio-selected',!!audio);if(inspectorTab==='audio'||audio){renderAudioInspector();renderTakes();return;}

 $('clipName').value='No clip selected';draw('inspectorContent','<div class="selection-empty"><span class="empty-symbol">'+svg('cursor')+'</span><strong>Select a clip</strong><p>Choose a timeline clip to adjust its workflow, inputs and sound.</p><small>Ctrl-click to select more than one</small></div>');renderTakes();
}
function renderSelectionInspector(){const ids=selectionIds(),videos=selectedVideos(),audio=ids.length-videos.length;
 $('inspector').classList.remove('audio-selected');$('inspector').classList.add('multi-selected');$('clipName').value=ids.length+' clips selected';countLabel.hidden=true;jobStatus.textContent='';$('generate').hidden=!videos.length;$('generateLabel').textContent='Generate '+videos.length+' clips';$('generate').title=selectionQueueReason()||'Generate takes for the selected clips';
 draw('inspectorContent','<div class="group-label">Selection</div><p class="audio-summary">'+videos.length+' video '+(videos.length===1?'clip':'clips')+' / '+audio+' audio '+(audio===1?'clip':'clips')+'</p><p class="audio-note">Drag a selected clip to move the selection together. Ctrl-click toggles clips; Shift-click selects a range on one track.</p>');
 renderTakes();buttons();
}
const {clipNotes,createNotes}=await import('/spool/ui/notes.js');
const inspectorNotes=createNotes($('clipNotesSection'),{selected:()=>selectionIds().length===1?(selectedAudio()||selected()):null,record:edits.record,save:()=>{save();renderClipAttention();},notify:toast});
function clipAttentionCounts(c,video){return [clipNotes(c).filter(n=>n.status==='open').length,video?takeSeen.unseen(c).length:0];}
function clipAttention(c,video=true){
 const [notes,fresh]=clipAttentionCounts(c,video);
 return '<span class="clip-attention" data-counts="'+notes+':'+fresh+'"'+(!notes&&!fresh?' hidden':'')+'>'+(notes?'<span class="clip-attention-badge notes" data-open-notes="'+notes+'" title="'+notes+' open '+(notes===1?'note':'notes')+'" aria-label="'+notes+' open '+(notes===1?'note':'notes')+'">'+svg('clipboard')+notes+'</span>':'')+(fresh?'<span class="clip-attention-badge takes" data-unseen-takes="'+fresh+'" title="'+fresh+' unseen '+(fresh===1?'take':'takes')+'" aria-label="'+fresh+' unseen '+(fresh===1?'take':'takes')+'">'+'New'+(fresh>1?' <span class="new-take-count">'+fresh+'</span>':'')+'</span>':'')+'</span>';
}
function renderClipAttention(){
 for(const node of $('timelineContent').querySelectorAll('[data-clip],[data-audio]')){const video=!!node.dataset.clip,c=(video?state.clips:state.audioClips||[]).find(c=>c.id===(node.dataset.clip||node.dataset.audio)),badge=node.querySelector('.clip-attention');if(c&&badge&&badge.dataset.counts!==clipAttentionCounts(c,video).join(':')){
  badge.outerHTML=clipAttention(c,video);
  // A direct badge patch changes the lane DOM outside draw()'s cached string.
  drawn[node.parentElement.id]=null;
 }}
}
function markTakesSeen(ids){if(takeSeen.mark(ids))renderClipAttention();}
const seenStorage=e=>{if(e.key===takeSeen.key&&takeSeen.refresh()){renderClipAttention();renderTakes();}};
window.addEventListener('storage',seenStorage);
function renderInspector(){
 inspectorNotes.render();
 if(selectionIds().length>1){renderSelectionInspector();return;}
 $('inspector').classList.remove('multi-selected');const c=selected();if(!c||selectedAudio()||inspectorTab==='audio'){renderNonVideoInspector();countLabel.hidden=true;jobStatus.textContent='';return;}
 $('inspector').classList.remove('audio-selected');$('clipName').value=c.name;$('inputsInspectorTab').classList.add('active');$('inputsInspectorTab').setAttribute('aria-selected','true');$('audioInspectorTab').classList.remove('active');$('audioInspectorTab').setAttribute('aria-selected','false');renderTakes();
 const reason=queueReason(c),embedded=!c.workflow&&!c.workflowVersion&&!!editableGraph(c),bindings=nativeRecipes[c.workflowVersion]?builtinBindings(nativeRecipes[c.workflowVersion],definitionsFor(c),c.bindings):c.bindings||[],essential=bindings.map((b,i)=>({b,i})).filter(({b})=>!b.advanced),pose=essential.filter(({b})=>b.role==='pose');
 $('generate').hidden=false;$('generate').disabled=!!reason;$('generate').title=reason||'Generate new takes with these settings';$('generateLabel').textContent='Generate';
 countLabel.hidden=!!reason;$('nativeCount').value=c.count||1;$('nativeCount').onchange=e=>{const value=Number(e.target.value);if(!Number.isInteger(value)||value<1||value>16){e.target.value=c.count||1;return;}edits.apply('Change take count',()=>{c.count=value;},'none');};
 renderJobStatus();
 const setup=workflowStatus(c,workflows[c.workflow],nativeRecipes[c.workflowVersion],definitionsFor(c),embedded);
 const workflowLabel=c.generationBase?'Workflow from take':c.workflowVersion?'Clip workflow':embedded?'Workflow from take':'Choose a take with a workflow';
 draw('inspectorContent','<div class="clip-workflow-heading"><span>'+workflowLabel+'<small class="workflow-route">'+(Object.values(nativeRecipes[c.workflowVersion]?.prompt||{}).some(n=>['DeadlineSubmit','SaveAndSubmitNode'].includes(n.class_type))?'Deadline':c.executionTarget==='cloud'?'Comfy Cloud':'Local ComfyUI')+'</small></span><div class="clip-workflow-actions"><button class="outline" id="editClipWorkflow">Edit in Comfy</button><button class="outline" id="reloadTakeWorkflow" title="Restore the selected take’s saved workflow and inputs, replacing current edits">Reload workflow from take</button></div></div>'+(!setup.ready?'<p class="'+(setup.problem?'workflow-problem':'workflow-hint')+'" role="status">'+esc(setup.note)+'</p>':'')+(nativeRecipes[c.workflowVersion]?.executionTarget==='cloud'?'<label class="field"><span>Execute on</span><select id="clipExecutionTarget"><option value="cloud" '+((c.executionTarget||'cloud')==='cloud'?'selected':'')+'>Comfy Cloud · Developer Platform</option><option value="local" '+(c.executionTarget==='local'?'selected':'')+'>Local ComfyUI · Partner Nodes</option></select></label>':'')+'<div class="native-bindings">'+essential.filter(({b})=>b.role!=='pose').map(({b,i})=>controlField(b,i,c)).join('')+'</div>'+(pose.length?'<details class="native-advanced"><summary>Pose extraction</summary><div class="native-bindings">'+pose.map(({b,i})=>controlField(b,i,c)).join('')+'</div></details>':'')+(!c.workflowVersion?takeFacts(take(c)):''));
 $('editClipWorkflow').disabled=!c.workflowVersion&&!embedded&&!c.workflow;$('editClipWorkflow').onclick=()=>c.workflow&&!c.workflowVersion&&!embedded?prepareWorkflow({...workflows[c.workflow].data,importedWorkflowId:c.workflow},c.name,state.clips.indexOf(c),c.id):openNativeWorkflow();
 $('reloadTakeWorkflow').disabled=!!take(c).placeholder||!editableGraph(c);$('reloadTakeWorkflow').onclick=()=>chooseTake(c.id,c.takeId);
 const executionTarget=$('clipExecutionTarget');if(executionTarget)executionTarget.onchange=()=>{edits.apply('Change execution target',()=>{c.executionTarget=executionTarget.value;c.revision++;},'inspector');};
 bindImageInputs(c);
 $('inspectorContent').querySelectorAll('[data-media-input]').forEach(field=>{
  const index=Number(field.dataset.mediaInput),picker=field.querySelector('input'),button=field.querySelector('[data-media-upload]'),timeline=field.querySelector('[data-use-timeline-video]');button.onclick=()=>picker.click();
  if(timeline)timeline.onclick=()=>useTimelineVideo(c.id,index);
  const replace=async files=>{if(files.length!==1)return;button.disabled=true;try{await replaceInputMedia(c,index,files[0]);}catch(error){toast(error.message);}finally{button.disabled=false;}};
  picker.onchange=()=>replace([...picker.files]);field.ondragover=e=>{e.preventDefault();e.stopPropagation();};field.ondrop=e=>{e.preventDefault();e.stopPropagation();void replace([...e.dataTransfer.files]);};
 });

 $('inspectorContent').querySelectorAll('[data-pixel-resolution]').forEach(group=>{for(const field of group.querySelectorAll('select'))field.onchange=()=>{const b=c.bindings[Number(group.dataset.pixelResolution)],size=Number(group.querySelector('[data-resolution-size]').value),ratio=group.querySelector('[data-resolution-ratio]').value,value=b.options.find(v=>{const p=pixelResolution(v);return p.size===size&&p.ratio===ratio;});if(!value)return;edits.apply('Change resolution and aspect ratio',()=>{c.inputValues[b.key]=value;c.revision++;},'none');};});

 $('inspectorContent').querySelectorAll('[data-seed-mode]').forEach(field=>field.onchange=()=>{edits.apply('Change seed behavior',()=>{c.seedMode=field.value;c.seedKey=field.dataset.seedMode;c.revision++;},'inspector');});
 $('inspectorContent').querySelectorAll('[data-native-control]').forEach(field=>field.onchange=()=>{const b=bindings[Number(field.dataset.nativeControl)],original=Object.hasOwn(c.inputValues,b.key)?c.inputValues[b.key]:nativeRecipes[c.workflowVersion].prompt[b.nodeId].inputs[b.input],integer=isInt(original)&&b.contract?.inputType!=='FLOAT';let value=integer?{__spool_int__:field.value}:typeof original==='boolean'?field.value==='true':typeof original==='number'?Number(field.value):field.value;if(integer&&!/^[-]?\d+$/.test(field.value)){toast('Use an exact decimal integer');return;}if(typeof value==='number'&&!Number.isFinite(value))return;edits.apply('Change '+b.label,()=>{bindWorkflowControls(c,bindings);c.inputValues[b.key]=value;c.revision++;delete drawn.inspectorContent;},'none');});
}
function takeMidpoint(c,t){return (Math.min(c.in,t.media.frames-1)+Math.min(c.out,t.media.frames))/2;}
function scrubTake(button,t,frame){takeHoverLabel.textContent='Hover · '+takeName(t)+' · '+tc(Math.floor(frame));thumbnails.scrub(button,t.media,frame,fps);}
// Consecutive takes generated from the same inputs form one batch; seeds may differ within it.
function takeBatchInputs(t){const seeds=new Set((t.request?.capture?.bindings||[]).filter(b=>b.role==='seed').map(b=>b.key));return Object.entries(t.request?.inputValues||{}).filter(([key])=>!seeds.has(key)).sort(([a],[b])=>a<b?-1:a>b?1:0);}
const takeBatchKey=t=>t.generated?'generated:'+(t.request?.workflowVersion??'')+':'+JSON.stringify(takeBatchInputs(t)):t.original?'original':'imported';
function takeBatchLabel(takes,previous){
 const t=takes[0],count=takes.length+' '+(takes.length===1?'take':'takes');
 if(!t.generated)return [t.original?'Original':'Imported',count];
 const job=state.jobs.find(j=>j.id===t.request?.attemptId),time=job?.createdAt?new Date(job.createdAt*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
 let summary='Generated';
 if(previous){
  const labels=new Map((t.request?.capture?.bindings||[]).map(b=>[b.key,b.label||b.key])),now=new Map(takeBatchInputs(t)),before=new Map(takeBatchInputs(previous));
  const changed=[...new Set([...now.keys(),...before.keys()])].filter(key=>JSON.stringify(now.get(key))!==JSON.stringify(before.get(key))).map(key=>labels.get(key)||key);
  summary=t.request?.workflowVersion!==previous.request?.workflowVersion?'Workflow changed':changed.length?changed.slice(0,2).join(', ')+(changed.length>2?' +'+(changed.length-2):'')+' changed':'Same inputs';
 }
 return [summary,[time,count].filter(Boolean).join(' · ')];
}
function groupTakeCards(real,cards){
 const groups=[];real.forEach((t,index)=>{const key=takeBatchKey(t);if(groups.at(-1)?.key===key)groups.at(-1).indexes.push(index);else groups.push({key,indexes:[index]});});
 if(groups.length<2)return cards.join('');
 let previous=null;
 return groups.map(({indexes})=>{const takes=indexes.map(i=>real[i]),[summary,meta]=takeBatchLabel(takes,previous);if(takes[0].generated)previous=takes[0];return '<div class="take-group"><span>'+esc(summary)+'</span><span>'+esc(meta)+'</span></div>'+indexes.map(i=>cards[i]).join('');}).join('');
}
function jobPercent(j){
 const observations=j.nodeProgress||[],node=observations.filter(n=>n.max>1).at(-1)||observations.at(-1),running=['running','farm_running'].includes(j.status);
 return running?(j.target==='deadline'?j.farmProgress?.percent:node?.max>1?100*node.value/node.max:null):null;
}
function renderPendingTakes(c){
 const jobs=c&&!selectedAudio()?pendingJobs(c):[];$('takes').classList.toggle('has-pending',jobs.length>0);
 draw('takePending',jobs.map(j=>{const percent=jobPercent(j),known=Number.isFinite(percent);
  return '<div class="take-pending-row" data-pending-job="'+esc(j.id)+'"><span class="take-pending-thumb">'+(known?Math.round(percent)+'%':'…')+'</span><span class="take-pending-info"><strong>'+(j.takeNumber?'Take '+String(j.takeNumber).padStart(2,'0'):'New take')+'</strong><small>'+esc(G.jobStage(j))+' · <span data-job-elapsed="'+esc(j.id)+'">'+esc(G.jobElapsed(j))+'</span></small>'+(known?'<span class="take-pending-bar"><i style="width:'+percent.toFixed(1)+'%"></i></span>':'')+'</span></div>';}).join(''));
}
function renderTakes(){
 renderPlaceholderState();
 const c=selected(),real=T.realTakes(c),list=$('takeList');updateTakeSelection();renderPendingTakes(c);
 $('takes').classList.toggle('has-real-takes',real.length>0&&!selectedAudio());
 $('takes').classList.toggle('has-clip',!!c&&!selectedAudio());
 $('takeCount').textContent=real.length;$('takesClip').textContent=c?.name||'';
 document.querySelector('.takes-keys').hidden=!!selectedAudio();$('takeCount').parentElement.firstChild.nodeValue=selectedAudio()?'Audio':'Takes';
 if(selectedAudio()){thumbnails.stopScrub();$('takeCount').textContent='';$('takesClip').textContent=selectedAudio().name;draw('takeList','<div class="takes-empty">Audio selected - adjust level and fades in Audio; Source reviews the full file.</div>');return;}

 if(!real.length){thumbnails.stopScrub();draw('takeList',c?'<div class="takes-empty">Copy videos or images into this clip’s folder to add takes.</div>':'');return;}
 const viewing=review.mode==='source'&&review.source?.clipId===c.id?review.source.takeId:null,unseen=new Set(takeSeen.unseen(c).map(t=>t.id));
 if(draw('takeList',groupTakeCards(real,real.map(t=>{
  const chosen=t.id===c.takeId,setupChosen=chosen&&c.generationBase?.takeId===t.id,preview=t.id===viewing,title=t.original?'Original':String(t.number).padStart(2,'0');
  const fresh=unseen.has(t.id)?'<span class="take-badge new" title="Not yet reviewed in Source or Compare">New</span>':'';
  const body='<div class="take-heading"><strong>'+title+'</strong>'+(chosen||preview?'<span class="take-badge '+(chosen?'used':'preview')+'">'+(chosen?'In edit':'Preview')+'</span>':'')+fresh+'</div><button class="take-thumb" data-view="'+t.id+'" aria-label="Preview '+esc(title)+'"><img src="'+esc(url(t.media.poster))+'" alt=""></button><div class="take-details"><span class="take-duration" title="Full take duration">'+seconds(t.media.frames)+'</span>'+(t.seed!=null?'<span class="take-seed" title="Seed '+esc(decimal(t.seed))+'">Seed '+esc(decimal(t.seed))+'</span>':'')+(!setupChosen?'<button class="use-take" data-use="'+t.id+'">Use take</button>':'')+'</div>';
  return '<article class="take-card'+(chosen?' chosen':'')+(preview?' viewing':'')+'" data-take="'+esc(t.id)+'" tabindex="0" aria-label="Take '+esc(title)+'"><input type="checkbox" class="take-select" data-select-take="'+esc(t.id)+'" aria-label="Select take '+esc(title)+'">'+body+'</article>';
 })))){
  thumbnails.stopScrub();list.querySelectorAll('[data-view]').forEach(b=>{const img=b.querySelector('img'),t=c.takes.find(t=>t.id===b.dataset.view),middle=takeMidpoint(c,t);thumbnails.bind(img,t.media,middle,fps);b.draggable=true;img.draggable=false;b.ondragstart=e=>{thumbnails.stopScrub();draggedTake={projectId:projectKey,clipId:c.id,takeId:t.id,frames:t.media.frames};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/spool-take',JSON.stringify(draggedTake));};b.ondragend=()=>{draggedTake=null;takeDropPreview.hidden=true;};b.onclick=()=>review.mode==='source'&&review.source?.takeId===b.dataset.view?play():viewTake(b.dataset.view);b.onpointerenter=b.onpointermove=e=>{const r=b.getBoundingClientRect(),end=t.media.frames;scrubTake(b,t,Math.min(end-1,Math.floor(clamp((e.clientX-r.left)/r.width,0,1)*end)));};b.onpointerleave=()=>thumbnails.stopScrub(b);});
  list.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>chooseTake(c.id,b.dataset.use));
 }
 updateTakeSelection();
}
const takeSelectionTools=document.createElement('div');takeSelectionTools.className='take-selection-tools';takeSelectionTools.innerHTML='<span id="takeSelectionCount" role="status"></span><button id="selectAllTakes" class="outline">Select all</button>';
const takesHead=$('takes').querySelector('.takes-head');takesHead.querySelector('.takes-title').after(takeSelectionTools);takeSelectionTools.append($('compareTakesStrip'));
const takeTools=document.createElement('div');takeTools.className='take-tools';takeTools.innerHTML='<button id="archiveTakes" class="outline" aria-haspopup="menu" aria-expanded="false" title="Remove takes from this clip; Ctrl+Z restores them. Files are kept.">Delete &#9662;</button><button id="deleteTakesFromDisk" class="outline" aria-haspopup="menu" aria-expanded="false" title="Permanently delete media and its workflow JSON; cannot be undone">Permanently delete &#9662;</button>';takesHead.append(takeTools);
const clipFolderButton=document.createElement('button');clipFolderButton.id='openClipFolder';clipFolderButton.className='outline';clipFolderButton.innerHTML=svg('folder')+'<span class="folder-label">Open clip folder</span>';takesHead.append(clipFolderButton);
const takePending=document.createElement('div');takePending.id='takePending';takePending.className='take-pending';takePending.setAttribute('aria-label','Takes being generated');$('takeList').after(takePending,document.querySelector('.takes-keys'));
let openingClipFolder=false;
clipFolderButton.onclick=async()=>{
 const clipId=selected()?.id,projectId=projectKey;if(!clipId||openingClipFolder)return;
 openingClipFolder=true;updateTakeSelection();
 try{await flushNative();await request('projects/'+projectId+'/clip-folder/'+encodeURIComponent(clipId)+'/reveal',{});toast('Clip folder opened. Copy videos or images here to add takes.');}
 catch(error){toast(error.message);}
 finally{openingClipFolder=false;updateTakeSelection();}
};
function takeSelection(c=selected()){
 if(c?.id!==selectedTakeClip){selectedTakeClip=c?.id||null;selectedTakeIds=[];takeSelectionAnchor=null;}
 const available=new Set(T.realTakes(c).map(t=>t.id));selectedTakeIds=selectedTakeIds.filter(id=>available.has(id));if(!available.has(takeSelectionAnchor))takeSelectionAnchor=null;return selectedTakeIds;
}
function updateTakeSelection(){
 if(!$('takeSelectionCount'))return;const c=selected(),takes=T.realTakes(c),ids=takeSelection(c);takeTools.hidden=takeSelectionTools.hidden=!!selectedAudio()||!takes.length;
 clipFolderButton.hidden=!c||!!selectedAudio();clipFolderButton.disabled=openingClipFolder||!productCapabilities.clipFolderReveal;clipFolderButton.title=productCapabilities.clipFolderReveal?'Open in Explorer. Copy completed videos or images here; they appear as new takes after a short scan.':'Opening clip folders requires an updated Windows Spool host';
 $('takeSelectionCount').textContent=ids.length+' selected';$('takeSelectionCount').hidden=!ids.length;$('selectAllTakes').textContent=ids.length===takes.length?'Clear':'Select all';
 $('archiveTakes').disabled=!ids.length||!takes.some(t=>t.id!==c?.takeId);$('deleteTakesFromDisk').disabled=$('archiveTakes').disabled;$('archiveTakes').hidden=$('deleteTakesFromDisk').hidden=!ids.length;$('deleteTakesFromDisk').title='Permanently delete media and its workflow JSON; cannot be undone';
 for(const card of $('takeList').querySelectorAll('[data-take]')){const checked=ids.includes(card.dataset.take);card.classList.toggle('take-selected',checked);card.querySelector('[data-select-take]').checked=checked;}
}
function selectTake(id,e={}){
 const takes=T.realTakes(selected()),ids=takeSelection().slice();if(e.shiftKey&&takeSelectionAnchor){const a=takes.findIndex(t=>t.id===takeSelectionAnchor),b=takes.findIndex(t=>t.id===id),range=takes.slice(Math.min(a,b),Math.max(a,b)+1).map(t=>t.id);selectedTakeIds=e.ctrlKey||e.metaKey?[...new Set([...ids,...range])]:range;}
 else{selectedTakeIds=e.toggle||e.ctrlKey||e.metaKey?(ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]):[id];takeSelectionAnchor=id;}
 updateTakeSelection();saveView();
}
function archiveTakes(others=false){
 const c=selected(),selectedIds=takeSelection(c).slice();if(!c||!selectedIds.length)return;
 const ids=T.realTakes(c).filter(t=>t.id!==c.takeId&&(others?!selectedIds.includes(t.id):selectedIds.includes(t.id))).map(t=>t.id);
 if(!ids.length){toast('The take in the edit is kept. Choose another take before deleting it.');return;}
 edits.apply('Delete '+ids.length+' '+(ids.length===1?'take':'takes'),()=>{T.hideTakes(c,ids);thumbnails.stopScrub();
 if(review.source?.clipId===c.id&&ids.includes(review.source.takeId)||review.audition?.clipId===c.id&&ids.includes(review.audition.takeId)||review.comparison?.clipId===c.id&&review.comparison.ids.some(id=>ids.includes(id))){pause();editView();review.clear();}
 });$('editor').focus({preventScroll:true});toast(ids.length+' '+(ids.length===1?'take':'takes')+' removed. Files are kept; Ctrl+Z restores the takes.');
}
$('selectAllTakes').onclick=()=>{const takes=T.realTakes(selected()),ids=takeSelection();selectedTakeIds=ids.length===takes.length?[]:takes.map(t=>t.id);takeSelectionAnchor=selectedTakeIds[0]||null;updateTakeSelection();saveView();};
function openTakeActions(action,origin){
 const c=selected(),selection=takeSelection(c),verb=action==='archive'?'Delete':'Permanently delete',r=origin.getBoundingClientRect();
 showActionMenu(action==='archive'?'Delete takes':'Permanently delete files',[false,true].map(others=>{const ids=T.realTakes(c).filter(t=>t.id!==c.takeId&&(others?!selection.includes(t.id):selection.includes(t.id))).map(t=>t.id);return {label:verb+(others?' others':' selected'),reason:!selection.length?'Select takes first':!ids.length?'The take in the edit is kept':null,run:()=>action==='archive'?archiveTakes(others):deleteTakes(others)};}),r.left,r.bottom+4,origin);origin.setAttribute('aria-expanded','true');
}
$('archiveTakes').onclick=()=>openTakeActions('archive',$('archiveTakes'));$('deleteTakesFromDisk').onclick=()=>openTakeActions('delete',$('deleteTakesFromDisk'));
async function deleteTakes(others=false){
 const c=selected(),selection=takeSelection(c),ids=T.realTakes(c).filter(t=>t.id!==c.takeId&&(others?!selection.includes(t.id):selection.includes(t.id))).map(t=>t.id);
 if(!selection.length||!ids.length)return;
 const clipId=c.id;
 showModal('Delete '+ids.length+' '+(ids.length===1?'take':'takes')+' from disk?', '<p>The media files and matching workflow JSON will be permanently deleted. This cannot be undone.</p><p>The take in the edit is kept. Files used by other takes, clips or generation inputs are protected.</p><p id="takeDeleteError" role="status"></p>', '<button class="outline" id="takeDeleteCancel">Cancel</button><button class="primary" id="takeDeleteConfirm">Delete from disk</button>');
 $('takeDeleteCancel').onclick=closeModal;
 $('takeDeleteConfirm').onclick=async()=>{const button=$('takeDeleteConfirm');button.disabled=true;button.textContent='Deleting…';
  try{thumbnails.stopScrub();pause();editView();review.clear();for(const video of pool.values())releaseMedia(video);pool.clear();shownVideo=null;
   const {value}=await projectEdit.change(revision=>request('projects/'+projectKey+'/delete-takes/'+clipId,{revision,takeIds:ids}));history.clear();selectedTakeIds=[];closeModal();render();saveHistory();saveView();
   toast(value.pendingFiles?'Takes deleted; '+value.pendingFiles+' files await release by another application.':ids.length+' '+(ids.length===1?'take':'takes')+' deleted from disk.');
  }catch(error){$('takeDeleteError').textContent=error.message;button.disabled=false;button.textContent='Delete from disk';render();}
 };
}
$('takeList').addEventListener('click',e=>{const card=e.target.closest('[data-take]');if(!card)return;const checkbox=e.target.closest('[data-select-take]');if(checkbox||e.ctrlKey||e.metaKey||e.shiftKey||!e.target.closest('button,input')){if(!checkbox)e.preventDefault();e.stopPropagation();selectTake(card.dataset.take,{ctrlKey:e.ctrlKey,metaKey:e.metaKey,shiftKey:e.shiftKey,toggle:!!checkbox});}},true);
$('takes').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();$('selectAllTakes').click();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();selectedTakeIds=[];updateTakeSelection();saveView();}else if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();archiveTakes();}});
$('takes').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)return;const list=$('takeList');if(list.scrollWidth<=list.clientWidth)return;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;if(!delta)return;e.preventDefault();e.stopPropagation();const unit=e.deltaMode===1?16:e.deltaMode===2?list.clientWidth:1;list.scrollLeft+=delta*unit;},{passive:false});
function comparisonTakes(){return review.takes;}
function sourceLength(){return review.length;}
function comparisonVideos(){return comparisonTakes()?Array.from($('takeCompare').querySelectorAll('video:not([hidden])')):[];}
function closeTakeComparison(){review.closeComparison();$('takeCompare').hidden=true;$('editor').classList.remove('compare-active');for(const v of $('takeCompare').querySelectorAll('video')){v.pause();v.hidden=true;}}
function toggleTakeComparison(){
 pause();finishViewerPan();hideTrimPreview();if(comparisonTakes()){closeTakeComparison();renderTakes();updateViewer(true);return;}
 const c=selected();if(T.realTakes(c).length<2||selectedAudio())return;
 selectedCut=null;nudgeGroup=null;clearHeld();state.selectedAudio=null;review.compare(c.id);markTakesSeen(review.comparison.ids);renderTakes();renderTimeline();updateViewer(true);$('editor').focus({preventScroll:true});
}
function selectComparisonPane(index){if(!review.selectPane(index))return;renderTakes();updateViewer();(viewerExpanded?$('viewer'):$('editor')).focus({preventScroll:true});}
function editView(){finishViewerPan();closeTakeComparison();review.edit();}
function viewTake(id,c=selected()){thumbnails.stopScrub();finishViewerPan();hideTrimPreview();state.selectedAudio=null;
 const t=T.realTakes(c).find(t=>t.id===id);if(!t)return;
 if(!(review.mode==='source'&&review.source?.clipId===c.id))pause();
 if(!(review.comparison?.clipId===c.id&&review.mode==='source'))closeTakeComparison();
 review.reviewTake(c.id,id);markTakesSeen([id]);renderTakes();renderTimeline();updateViewer(true);
 setStatus(c.name+' - '+takeName(t)+(t.id===c.takeId?' - in the edit':' - review only, the edit is unchanged'));
}

function flipTake(step){if(selectedAudio())return;const c=(review.mode==='source'&&state.clips.find(c=>c.id===review.source?.clipId))||selected(),real=T.realTakes(c);if(!real.length)return;const index=real.findIndex(t=>t.id===review.source?.takeId);viewTake(real[clamp(index<0?0:index+step,0,real.length-1)].id,c);}
function setViewMode(mode){finishViewerPan();hideTrimPreview();if(mode==='source'&&selectedAudio()){const c=selectedAudio();review.rememberMedia(c.media,review.source?.media.file===c.media.file?review.frame:c.in);}
 if(mode===review.mode)return;
 if(mode==='source'){const c=selected();if(c&&(!review.source||review.source.clipId&&review.source.clipId!==c.id)){viewTake(take(c).id,c);return;}if(!review.source)return;}
 pause();closeTakeComparison();review.setMode(mode);renderTakes();renderTimeline();updateViewer(true);
}
function tryInEdit(){
 const c=state.clips.find(c=>c.id===review.source?.clipId),row=c&&rowFor(c.id);if(!row)return;
 pause();closeTakeComparison();review.tryInEdit();state.selected=c.id;state.frame=Math.max(0,row.start-36);
 renderInspector();renderTimeline();updateViewer(true);play();
 setStatus(review.audition?'Trying '+takeName(c.takes.find(t=>t.id===review.audition.takeId))+' in the edit · Enter uses it, Esc cancels':c.name+' in the edit');
}
function cancelAudition(){if(!review.audition)return;pause();review.cancelTrial();renderTakes();renderTimeline();updateViewer(true);setStatus('Showing the saved edit');}
function useViewerTake(){const target=review.candidate;if(target?.takeId)chooseTake(target.clipId,target.takeId);}
// Geometry during a drag: the clip set and its content are unchanged, so positions
// are written to the nodes that are already there instead of rebuilding the lane and
// re-binding every handler and filmstrip. The full renderer runs again when the
// gesture ends, which is also when filmstrip frames and labels catch up — deferring
// them avoids re-decoding thumbnails on every drag frame.
let laneNodes=new Map(),laneOrder=[],laneDrawn=false;
function applyClipGeometry(rows){
 const sharedIn=new Set(),sharedOut=new Set(),previous=new Map();
 for(const {clip:c} of rows){const track=T.videoTrack(c),prev=previous.get(track);if(prev&&!c.gapBefore){sharedIn.add(c.id);sharedOut.add(prev.id);}previous.set(track,c);}
 for(const {clip:c,start} of rows){
  const node=laneNodes.get(c.id);if(!node)return false;
  setStyle(node,'left',start*ppf+'px');
  setStyle(node,'width',Math.max(14,(c.out-c.in)*ppf)+'px');
  setStyle(node,'top','calc(var(--video-top-'+T.videoTrack(c)+') + 6px)');
  setStyle(node,'height','calc(var(--video-height-'+T.videoTrack(c)+') - 12px)');
  const meta=node.querySelector('.clip-meta span:last-child'),duration=seconds(c.out-c.in);
  if(meta&&meta.textContent!==duration)meta.textContent=duration;
  node.querySelector('[data-trim="in"]')?.classList.toggle('shared',sharedIn.has(c.id));
  node.querySelector('[data-trim="out"]')?.classList.toggle('shared',sharedOut.has(c.id));
 }
 // The memo still holds the pre-gesture markup, so the next full render must write:
 // otherwise returning to exactly the starting state would short-circuit and leave the
 // styles this pass wrote in place.
 drawn['clipLane']=null;
 return true;
}
function renderTimeline(){
 const rows=layout(),length=total(),viewport=$('timelineScroll').clientWidth,count=T.videoTracks(state),sharedIn=new Set(),sharedOut=new Set(),previous=new Map();
 for(const {clip:c} of rows){const track=T.videoTrack(c),prev=previous.get(track);if(prev&&!c.gapBefore){sharedIn.add(c.id);sharedOut.add(prev.id);}previous.set(track,c);}activeVideoTrack=Math.min(activeVideoTrack,count);
 draw('videoTrackLabels',Array.from({length:count},(_,i)=>{const track=count-i;return '<div class="track-label'+(!T.videoTrackEnabled(state,track)?' disabled-track':'')+'" style="height:var(--video-height-'+track+')"><button class="track-toggle video-track-toggle" data-toggle-video-track="'+track+'" aria-label="'+(T.videoTrackEnabled(state,track)?'Disable':'Enable')+' video track V'+track+'" aria-pressed="'+T.videoTrackEnabled(state,track)+'" title="'+(T.videoTrackEnabled(state,track)?'Disable':'Enable')+' V'+track+' picture and linked audio">'+svg(T.videoTrackEnabled(state,track)?'eye':'eyeOff')+'</button><button class="track-select'+(track===activeVideoTrack?' active':'')+'" data-select-track="'+track+'" aria-pressed="'+(track===activeVideoTrack)+'" title="Add new clips to V'+track+'">V'+track+'</button>'+trackResizeHandle('video:'+track,'video track V'+track)+'</div>';}).join(''));
 $('videoTrackLabels').querySelectorAll('[data-select-track]').forEach(b=>b.onclick=()=>{activeVideoTrack=Number(b.dataset.selectTrack);renderTimeline();saveView();$('editor').focus({preventScroll:true});});
 $('videoTrackLabels').querySelectorAll('[data-toggle-video-track]').forEach(b=>b.onclick=()=>{const track=Number(b.dataset.toggleVideoTrack),value=!T.videoTrackEnabled(state,track);edits.apply((value?'Enable':'Disable')+' video track V'+track,()=>{pause();T.setVideoTrackEnabled(state,track,value);});$('videoTrackLabels').querySelector('[data-toggle-video-track="'+track+'"]')?.focus({preventScroll:true});});
 renderAudioTrackHeaders(count);
 const empty=!state.clips.length&&!(state.audioClips||[]).length,extra=empty?160:0,usable=Math.max(1,viewport-extra);
 ppf=drag?.scale||Math.max(.0001,usable/Math.max(length,fps*5))*state.zoom/100;
 const width=Math.max(viewport,Math.ceil(Math.max(length,120)*ppf)+extra);
 $('timelineContent').style.width=width+'px';$('zoomValue').textContent=state.zoom+'%';
 const second=Math.round(fps),interval=[1,2,5,Math.round(second/4),Math.round(second/2),...[1,2,5,10,15,30,60,120,300,600,1200,2400].map(n=>n*second)].filter(n=>n>0).sort((a,b)=>a-b).find(n=>n*ppf>=96)||Math.ceil(96/ppf),ticks=[];
 for(let f=0;f<width/ppf;f+=interval){const seconds=Math.floor(f/second),frames=f%second,label=frames?seconds+'s '+frames+'f':seconds<60?seconds+'s':Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');ticks.push('<span class="tick" title="'+tc(f)+'" style="left:'+f*ppf+'px">'+label+'</span>');if(interval>1)ticks.push('<span class="tick minor" style="left:'+(f+interval/2)*ppf+'px"></span>');}
 draw('ruler',ticks.join(''));renderExportRange();
 const sourceHandles=drag&&['slip','slide'].includes(drag.kind)?(()=>{const c=state.clips.find(c=>c.id===drag.id),r=rowFor(c.id);return '<div class="source-handles" style="top:var(--video-top-'+T.videoTrack(c)+');height:calc(var(--video-height-'+T.videoTrack(c)+') - 2px);left:'+(r.start-c.in)*ppf+'px;width:'+take(c).media.frames*ppf+'px"></div>';})():'';
 const order=rows.map(({clip:c})=>c.id);
 // Slip and slide draw the source-handle overlay inside the lane string, so they keep
 // the full path; every other gesture changes geometry only.
 if(!(laneDrawn&&drag&&drag.kind!=='slip'&&drag.kind!=='slide'&&order.length===laneOrder.length&&order.every((id,index)=>laneOrder[index]===id)&&applyClipGeometry(rows))){
 const lane=Array.from({length:count},(_,i)=>'<div class="video-track-lane" data-video-track="'+(count-i)+'" style="position:absolute;top:var(--video-top-'+(count-i)+');height:var(--video-height-'+(count-i)+');width:100%"></div>').join('')+sourceHandles+rows.map(({clip:c,start},index)=>{const t=take(c),trial=review.audition?.clipId===c.id?c.takes.find(t=>t.id===review.audition.takeId):null,width=(c.out-c.in)*ppf,frames=t.media.kind==='video'?[c.in,Math.max(c.in,Math.min(c.out,t.media.frames)-1)]:[c.in];const film=frames.map(frame=>'<img src="'+esc(url(t.media.poster))+'" data-frame="'+frame+'" alt="">').join('');const pending=pendingJobs(c).length,takeCount=T.realTakes(c).length;return '<div class="timeline-clip '+(trial?' audition':'')+(!T.videoEnabled(state,c)?' disabled-clip':'')+'" data-clip="'+c.id+'" data-workflow="'+c.workflow+'" style="top:calc(var(--video-top-'+T.videoTrack(c)+') + 6px);height:calc(var(--video-height-'+T.videoTrack(c)+') - 12px);left:'+start*ppf+'px;width:'+Math.max(14,width)+'px" tabindex="0" role="button" aria-pressed="false" aria-label="'+esc(c.name)+(!T.videoEnabled(state,c)?' disabled':'')+' timeline clip"><div class="filmstrip">'+film+'</div><div class="clip-label"><span class="clip-type">'+(workflows[c.workflow]?.short||'MEDIA')+'</span><strong>'+esc(c.name)+'</strong>'+clipAttention(c)+'</div><div class="clip-meta"><span>'+(trial?'T'+String(trial.number).padStart(2,'0')+' trial':t.placeholder?'No take':'T'+String(t.number).padStart(2,'0'))+'</span><span class="clip-takes-status'+(pending?' busy':'')+'">'+(takeCount?takeCount+' '+(takeCount===1?'take':'takes'):'')+(pending?' · '+pending+' pending':'')+'</span><span>'+seconds(c.out-c.in)+'</span></div><div class="trim-handle in'+(sharedIn.has(c.id)?' shared':'')+'" data-trim="in" title="Start edge"></div><div class="trim-handle out'+(sharedOut.has(c.id)?' shared':'')+'" data-trim="out" title="End edge"></div></div>';}).join('')+(length?'':'<div class="timeline-empty">Drop a workflow or media here to begin.</div>');
 if(draw('clipLane',lane)){laneNodes=new Map();$('clipLane').querySelectorAll('[data-clip]').forEach(node=>{laneNodes.set(node.dataset.clip,node);const c=state.clips.find(c=>c.id===node.dataset.clip);node.querySelectorAll('.filmstrip img').forEach(img=>thumbnails.bind(img,take(c).media,Number(img.dataset.frame),fps));node.classList.toggle('current',node.dataset.clip===currentClip);node.onpointerdown=e=>startClipDrag(e,node.dataset.clip);node.onkeydown=e=>{if(e.key==='Enter'){selectClip(node.dataset.clip,true,e);e.preventDefault();}};});}
 laneOrder=order;laneDrawn=true;}
 $('addShot').style.left=T.trackClips(state,activeVideoTrack).reduce((n,c)=>n+(c.gapBefore||0)+c.out-c.in,0)*ppf+8+'px';$('addShot').style.top='calc(var(--video-top-'+activeVideoTrack+') + 34px)';$('addShot').style.height='calc(var(--video-height-'+activeVideoTrack+') - 12px)';$('addShot').hidden=state.clips.length>0||(state.audioClips||[]).length>0;
 renderAudioTimeline(rows,false);applyTrackHeights();
 $('sequenceStats').textContent=state.clips.length+' '+(state.clips.length===1?'clip':'clips')+' · '+tc(length)+(selectionIds().length>1?' / '+selectionIds().length+' selected':'');
 // Gesture hints depend on the held modifiers and the selected cut, neither of which
 // changes while a pointer drag is running; resolving them for every node on every
 // frame was the hottest entry in the drag profile. They refresh when the drag ends.
 if(drag)gestureHintsStale=true;else refreshGestureHints();
 $('seek').max=length;}
function selectClip(id,seekTo=false,modifiers={},preserve=false){const clip=state.clips.find(c=>c.id===id);if(clip)activeVideoTrack=T.videoTrack(clip);selectedCut=null;nudgeGroup=null;hideTrimPreview();pause();editView();selectTimelineItem(id,modifiers,preserve);if(seekTo){const row=rowFor(id);if(row)state.frame=row.start;}renderBin();renderInspector();renderTimeline();updateViewer(true);buttons();$('editor').focus({preventScroll:true});saveView();}
async function chooseTake(clipId,id){
 const c=state.clips.find(c=>c.id===clipId),t=c&&T.realTakes(c).find(t=>t.id===id);if(!t)return;
 try{await workflowSetup.start({clipId,takeId:id,name:t.media.name||takeName(t),index:state.clips.indexOf(c),automatic:true,definitions:productDefinitions,
  capture:()=>takeWorkflowCapture(clipId,id,t.media.name||takeName(t))});}
 catch(error){toast(error.message);}
}
async function takeWorkflowCapture(clipId,takeId,name){
 const setup=await request('projects/'+projectKey+'/take-workflow/'+encodeURIComponent(clipId)+'/'+encodeURIComponent(takeId));
 if(!setup?.sidecar?.needsSerialization)return setup;
 const captured=await host('prepare',{workflow:setup.workflow,name});
 return {...captured,preferWorkflow:true,sidecar:setup.sidecar,provenance:{...captured.provenance,...setup.provenance}};
}
function addClip(workflow,index=state.clips.length){if(workflows[workflow]?.imported)return addLibraryShot(workflow,index);}
async function addMediaClip(id,index=state.clips.length,start=Math.round(state.frame)){
 if(T.videoTracks(state)>1)state.frame=start;
 const m=projectMedia().find(x=>x.id===id);if(!m)return;
 if(m.kind==='audio'){addAudioClip(m,start);return;}
 let data=null;
 try{data=await mediaWorkflowData(m);}catch(error){toast(error.message);return;}
 if(data){const w=registerWorkflowData(data,m.name,m.poster);addImportedWorkflowClip(w.id,index,m);return;}
 edits.apply('Add footage',()=>{const t={id:'take-'+crypto.randomUUID(),number:1,revision:1,media:copy(m),sample:false},c={id:'clip-'+crypto.randomUUID(),name:m.name,workflow:null,sources:[],prompt:'',seed:0,duration:m.frames/fps,count:1,revision:1,takes:[t],takeId:t.id,in:0,out:m.frames};T.insertClip(state,c,index,{track:activeVideoTrack,start:T.videoTracks(state)>1?Math.round(state.frame):null});state.selected=c.id;state.selectedAudio=null;editView();});}
function duplicate(){const ids=selectionIds().slice();if(!ids.length)return;const videos=state.clips.filter(c=>ids.includes(c.id)),audio=(state.audioClips||[]).filter(c=>ids.includes(c.id));edits.apply('Duplicate '+ids.length+' '+(ids.length===1?'clip':'clips'),()=>{pause();editView();const copies=[];for(const c of videos)copies.push(T.duplicateClip(state,c.id,'clip-'+crypto.randomUUID()).id);for(const c of audio)copies.push(T.duplicateAudio(state,c.id,'audio-'+crypto.randomUUID()).id);setTimelineSelection(copies);});toast(ids.length===1?'Clip duplicated':ids.length+' clips duplicated');}
function remove(ripple=false){const ids=selectionIds().slice();if(!ids.length)return;const index=Math.max(0,state.clips.findIndex(c=>c.id===state.selected)),videos=state.clips.filter(c=>ids.includes(c.id)).reverse();edits.apply((ripple?'Ripple delete ':'Delete ')+ids.length+' '+(ids.length===1?'clip':'clips'),()=>{pause();editView();for(const c of videos){inputReplacements.invalidate(c.id);T.removeClip(state,c.id,{ripple});}for(const id of ids)if((state.audioClips||[]).some(c=>c.id===id))T.removeAudio(state,id);const next=state.clips[Math.min(index,state.clips.length-1)]?.id||state.audioClips?.[0]?.id;setTimelineSelection(next?[next]:[]);state.frame=clamp(state.frame,0,total());});setStatus(ripple?'Ripple delete - following video clips moved':'Clips deleted - gaps preserved; Shift+Delete ripple deletes');}
function split(){if(selectionIds().length>1)return;if(selectedAudio()){splitAudio();return;}pause();editView();const row=T.splitTarget(state,state.frame,selected()?.id);if(!row){toast('Place the playhead inside a clip, at least 6 frames from either edge.');return;}edits.apply('Split at playhead',()=>{const {clip:d}=T.splitClip(state,state.frame,'clip-'+crypto.randomUUID(),row.clip.id);state.selected=d.id;});setStatus('Split at '+tc(state.frame));}
function timelineFrame(e){const rect=$('timelineScroll').getBoundingClientRect();return (e.clientX-rect.left+$('timelineScroll').scrollLeft)/ppf;}
function snapFrame(frame,ignore){if(!state.snap)return Math.round(frame);return T.snap(T.snapPoints(state,ignore),frame,T.SNAP_PIXELS/ppf);}
function startClipDrag(e,id){
 if(e.button!==0||pointerBusy())return;hideTrimPreview();
 const c=state.clips.find(c=>c.id===id),index=state.clips.indexOf(c),edge=e.target.closest('[data-trim]')?.dataset.trim||null,linked=!!e.currentTarget?.dataset.linkedAudio;
 if(!edge&&(e.ctrlKey||e.metaKey||e.shiftKey)){e.preventDefault();$('editor').focus({preventScroll:true});selectClip(id,false,e);return;}
 const collapseSelection=!edge&&selectionIds().includes(id)&&selectionIds().length>1;selectTimelineItem(id,{},!edge);
 activeVideoTrack=T.videoTrack(c);const shared=T.isSharedEdge(state,index,edge);
 e.preventDefault();$('editor').focus({preventScroll:true});pause();editView();selectedCut=shared?{id,edge,audio:false}:null;nudgeGroup=null;if(linked)inspectorTab='audio';
 const ids=selectionIds().slice();drag={...T.beginEdit(state,{id,kind:'pending',edge,snapEnabled:state.snap,snapTolerance:T.SNAP_PIXELS/ppf}),ids,group:ids.length>1,collapseSelection,shared,linked,startX:e.clientX,startY:e.clientY,scale:ppf,moved:false,targetIndex:index};if(drag.group)drag.snapPoints=T.snapPoints(state,ids);
 $('timelineScroll').setPointerCapture(e.pointerId);renderInspector();renderTimeline();updateViewer(true);buttons();

}
function lockClipGesture(e){
 const d=drag,action=clipGesture({id:d.id,edge:d.edge,shared:d.shared},e.shiftKey||held.shift,e.altKey||held.alt);if(action.blocked){toast(action.blocked);cancelClipDrag();return false;}
 if(d.group&&action.kind!=='move'){setTimelineSelection([d.id]);d.group=false;renderInspector();}
 d.kind=action.kind;d.mode=action.mode;d.overwrite=d.kind==='move'&&d.mode!=='copy'&&d.ids.every(id=>state.clips.some(c=>c.id===id));if(d.mode==='copy')copyDragSelection();d.moved=true;$('editor').style.setProperty('--active-edit-cursor',gestureCursor(action));if(d.kind!=='move')$('editor').classList.add('editing-clip');return true;
}
function copyDragSelection(){
 const d=drag;d.copies={};
 for(const c of [...state.clips,...state.audioClips||[]].filter(c=>d.ids.includes(c.id))){const audio=(state.audioClips||[]).includes(c),next=copy(c);next.id=(audio?'audio-':'clip-')+crypto.randomUUID();next.name+=' copy';if(!audio)L.inheritLineage(c,next);(audio?state.audioClips:state.clips).push(next);d.copies[c.id]=next.id;}
 $('editor').classList.add('copying-clip');d.id=d.copies[d.id];d.ids=Object.values(d.copies);d.snapPoints=T.snapPoints(d.before);setTimelineSelection(d.ids);renderInspector();
}
function moveSelectedGroup(e){const d=drag,rawDelta=(e.clientX-d.startX)/d.scale,delta=d.snapEnabled?T.snapMove(d.before,d.copies?Object.keys(d.copies):d.ids,rawDelta,d.snapTolerance,d.snapPoints):Math.round(rawDelta);const rect=$('clipLane').getBoundingClientRect(),targetTrack=!d.group&&state.clips.some(c=>c.id===d.id)&&e.clientY>=rect.top&&e.clientY<rect.bottom?trackAt(e):undefined,applied=T.moveGroup(state,d.before,d.ids,delta,targetTrack,{overwrite:d.overwrite,copies:d.copies});d.applied=applied;d.targetTrack=targetTrack;if(targetTrack)activeVideoTrack=targetTrack;if(state.clips.some(c=>c.id===d.id))state.frame=rowFor(d.id).start;else state.frame=clamp(d.before.frame,0,total());renderTimeline();updateViewer(true);
 if(!d.ghost){d.ghost=document.createElement('div');d.ghost.className='drag-ghost';document.body.append(d.ghost);}d.ghost.textContent=(d.copies?'Copy ':d.overwrite?'Overwrite ':'Move ')+d.ids.length+' '+(d.ids.length===1?'clip':'clips')+' '+(applied>=0?'+':'')+applied+'f';d.ghost.style.left=Math.max(8,Math.min(e.clientX+12,innerWidth-d.ghost.offsetWidth-8))+'px';d.ghost.style.top=Math.max(8,Math.min(e.clientY-20,innerHeight-d.ghost.offsetHeight-8))+'px';setStatus(d.ghost.textContent+(applied!==delta?' - occupied track or start limit':''));
}
function moveMarquee(e){const d=drag,rect=$('timelineContent').getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,left=Math.min(d.x,x),top=Math.min(d.y,y),right=Math.max(d.x,x),bottom=Math.max(d.y,y);if(!d.moved&&Math.abs(x-d.x)<4&&Math.abs(y-d.y)<4)return;d.moved=true;d.ghost.hidden=false;Object.assign(d.ghost.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});const ids=d.regions.filter(r=>r.left<right&&r.right>left&&r.top<bottom&&r.bottom>top).map(r=>r.id);setTimelineSelection([...d.base,...ids]);renderTimeline();renderInspector();buttons();}
$('timelineScroll').addEventListener('pointerdown',e=>{if(e.button!==0||pointerBusy()||e.target.closest('button,input,[data-clip],[data-linked-audio],[data-audio],#ruler'))return;e.preventDefault();$('editor').focus({preventScroll:true});pause();editView();hideTrimPreview();selectedCut=null;const rect=$('timelineContent').getBoundingClientRect(),before=copy(state),base=e.ctrlKey||e.metaKey?selectionIds().slice():[],regions=[...$('timelineContent').querySelectorAll('[data-clip],[data-audio],[data-linked-audio]:not(.no-audio)')].map(node=>{const r=node.getBoundingClientRect();return {id:node.dataset.clip||node.dataset.audio||node.dataset.linkedAudio,left:r.left-rect.left,right:r.right-rect.left,top:r.top-rect.top,bottom:r.bottom-rect.top};});setTimelineSelection(base);const ghost=document.createElement('div');ghost.className='selection-marquee';ghost.hidden=true;$('timelineContent').append(ghost);drag={kind:'marquee',before,base,regions,ghost,x:e.clientX-rect.left,y:e.clientY-rect.top,moved:false};$('timelineScroll').setPointerCapture(e.pointerId);renderInspector();renderTimeline();buttons();});


function clearClipDrag(){cancelAnimationFrame(clipMoveRAF);clipMoveRAF=0;pendingClipMove=null;hideTrimPreview();drag?.ghost?.remove();for(const node of $('timelineContent').querySelectorAll('[data-clip]'))node.style.opacity='';$('editor').style.removeProperty('--active-edit-cursor');$('dropLine').hidden=true;$('editor').classList.remove('dragging-clip','editing-clip','copying-clip','scrubbing');}
// A clip drag, panel or timeline resize, or track resize owns the pointer until it ends.
function pointerBusy(){return !!(drag||panelDrag||timelineDrag||trackResize);}
function cancelClipDrag(){if(!drag)return;const before=drag.before;clearClipDrag();drag=null;if(gestureHintsStale)refreshGestureHints();if(before)state=preserveTakes(before);render();save();setStatus('Edit cancelled');}
function handleClipPointerMove(e){
 if(!drag)return;
 if(drag.kind==='marquee'){moveMarquee(e);return;}
 if(drag.kind==='fade'){moveFadeDrag(e);return;}
 if(drag.kind==='audio'){moveAudioDrag(e);return;}
 if(drag.kind==='pending'){if(Math.abs(e.clientX-drag.startX)<4&&Math.abs(e.clientY-drag.startY)<4)return;if(!lockClipGesture(e))return;}
 if(drag.kind==='scrub'){setFrame(snapFrame(timelineFrame(e)),true);return;}
 if(drag.kind==='move'){moveSelectedGroup(e);return;}
 const c=state.clips.find(c=>c.id===drag.id);if(!c)return;const dx=e.clientX-drag.startX;
  $('editor').classList.add('editing-clip');
  let delta=Math.round(dx/drag.scale);
  if(state.snap&&drag.kind!=='slip'){const original=drag.start+(drag.kind==='out'?drag.original.out-drag.original.in:0),position=original+delta,near=T.snap(drag.snapPoints,position,T.SNAP_PIXELS/drag.scale);delta=near-original;}
  const applied=T.applyEdit(state,drag,delta),row=rowFor(c.id);drag.applied=applied;
  state.frame=['slip','slide'].includes(drag.kind)?clamp(drag.before.frame,row.start,row.end-1):drag.kind==='in'?row.start:row.end-1;
  renderTimeline();updateViewer(true);updateTrimPreview(drag,applied);
  if(!drag.ghost){drag.ghost=document.createElement('div');drag.ghost.className='drag-ghost edit-feedback';document.body.append(drag.ghost);}
  drag.ghost.textContent=editActions[drag.mode].name+' '+(applied>=0?'+':'')+applied+'f | '+tc(c.in)+' - '+tc(c.out);drag.ghost.style.left=Math.max(8,Math.min(e.clientX+14,innerWidth-drag.ghost.offsetWidth-8))+'px';drag.ghost.style.top=Math.max(8,Math.min(e.clientY-34,innerHeight-drag.ghost.offsetHeight-8))+'px';
  setStatus(editActions[drag.mode].name+' '+(applied>=0?'+':'')+applied+' frames'+(applied!==delta?' - limit reached':''));
}
function flushClipPointerMove(){cancelAnimationFrame(clipMoveRAF);clipMoveRAF=0;if(pendingClipMove){const move=pendingClipMove;pendingClipMove=null;handleClipPointerMove(move);}}
window.addEventListener('pointermove',e=>{if(!drag)return;pendingClipMove={clientX:e.clientX,clientY:e.clientY,shiftKey:e.shiftKey,altKey:e.altKey};if(!clipMoveRAF)clipMoveRAF=requestAnimationFrame(flushClipPointerMove);});
window.addEventListener('pointerup',()=>{
 if(!drag)return;flushClipPointerMove();const done=drag;clearClipDrag();drag=null;if(gestureHintsStale)refreshGestureHints();
 if(done.kind==='scrub'){save();return;}if(done.kind==='marquee'){selectionAnchor=state.selectedAudio||state.selected;renderInspector();renderTimeline();buttons();save();return;}if(done.kind==='pending'){if(done.collapseSelection)selectTimelineItem(done.id);renderTimeline();renderInspector();save();buttons();return;}
 if(done.kind==='audio'&&!done.moved&&done.collapseSelection){selectTimelineItem(done.id);renderInspector();}
 if(done.kind==='move'&&done.overwrite&&done.applied!==undefined&&(done.applied!==0||done.targetTrack&&done.targetTrack!==T.videoTrack(done.original))){T.overwriteMove(state,done.before,done.ids,done.applied,done.targetTrack,()=> 'clip-'+crypto.randomUUID());state.frame=rowFor(done.id).start;setStatus('Clip placed - covered footage overwritten');}
 if(editingSignature(projectData())!==editingSignature(done.before)){history.record(done.before,done.copies?'Duplicate '+(done.group?done.ids.length+' clips':done.original.name):done.group?'Move '+done.ids.length+' clips':done.kind==='fade'?'Fade '+done.side+' '+done.original.name:done.kind==='audio'?(editActions[done.mode]?.name||'Edit')+' audio '+done.original.name:done.kind==='move'?'Move '+done.original.name:editActions[done.mode].name+' '+done.original.name+(done.applied?' '+(done.applied>0?'+':'')+done.applied+'f':''));}
 renderTimeline();renderInspector();updateViewer(true);save();buttons();
});
window.addEventListener('pointercancel',cancelClipDrag);interruptions.on(cancelClipDrag);$('timelineScroll').addEventListener('lostpointercapture',cancelClipDrag);
$('timelineScroll').addEventListener('pointerdown',e=>{
 if(e.button!==1||drag||timelinePan||panelDrag||timelineDrag||trackResize)return;
 e.preventDefault();e.stopPropagation();const sc=$('timelineScroll');timelinePan={pointerId:e.pointerId,x:e.clientX,y:e.clientY,left:sc.scrollLeft,top:sc.scrollTop};sc.setPointerCapture(e.pointerId);$('editor').classList.add('timeline-grabbing');
},true);
window.addEventListener('pointermove',e=>{if(!timelinePan||e.pointerId!==timelinePan.pointerId)return;const sc=$('timelineScroll');sc.scrollLeft=timelinePan.left+timelinePan.x-e.clientX;sc.scrollTop=timelinePan.top+timelinePan.y-e.clientY;});
function finishTimelinePan(cancel=false){if(!timelinePan)return;const p=timelinePan,sc=$('timelineScroll');timelinePan=null;if(cancel){sc.scrollLeft=p.left;sc.scrollTop=p.top;}if(sc.hasPointerCapture(p.pointerId))sc.releasePointerCapture(p.pointerId);$('editor').classList.remove('timeline-grabbing');}
window.addEventListener('pointerup',()=>finishTimelinePan());window.addEventListener('pointercancel',()=>finishTimelinePan());interruptions.on(()=>finishTimelinePan());$('timelineScroll').addEventListener('lostpointercapture',()=>finishTimelinePan());
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&timelinePan){e.preventDefault();e.stopPropagation();finishTimelinePan(true);}},true);
$('timelineScroll').addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});
$('ruler').onpointerdown=e=>{if(e.button!==0||panelDrag||timelineDrag||trackResize||drag)return;hideTrimPreview();e.preventDefault();$('editor').focus({preventScroll:true});pause();if(review.mode!=='edit'||review.audition){editView();renderTakes();renderTimeline();}drag={kind:'scrub'};$('timelineScroll').setPointerCapture(e.pointerId);$('editor').classList.add('scrubbing');setFrame(snapFrame(timelineFrame(e)),true);};
let draggedTake=null;
const takeDropPreview=document.createElement('div');takeDropPreview.className='take-drop-preview';takeDropPreview.hidden=true;$('timelineContent').append(takeDropPreview);
let libraryDrag=null,libraryDragPoint=null,libraryScrollRAF=0;
const libraryDropPreview=document.createElement('div');libraryDropPreview.className='library-drop-preview';libraryDropPreview.hidden=true;
libraryDropPreview.innerHTML='<div class="library-drop-ghost"></div><div class="library-drop-marker"></div><div class="library-drop-label" role="status"></div>';$('timelineContent').append(libraryDropPreview);
function clearLibraryDrop(){libraryDropPreview.hidden=true;libraryDragPoint=null;cancelAnimationFrame(libraryScrollRAF);libraryScrollRAF=0;}
function libraryDrop(e,item){
 const track=trackAt(e),frame=Math.max(0,Math.round(timelineFrame(e))),workflow=!!(item.workflow||item.builtin),media=item.media&&projectMedia().find(m=>m.id===item.media);
 if(!workflow&&!media)return null;
 const {w,source}=workflow?libraryWorkflow(item.builtin||item.workflow,!!item.builtin):{},duration=source?.data.bindings?.find(b=>b.role==='duration'),seconds=duration?.unit==='seconds'?Number(source.data.prompt[duration.nodeId].inputs[duration.input]):5;
 const frames=workflow?Math.max(1,Math.round((seconds||5)*fps)):media.frames,label=workflow?(item.builtin?w?.family+' · '+w?.name:w?.name):media.name;
 const audio=!workflow&&(media.kind==='audio'||!!e.target.closest('#audioLane,#musicLane'));
 let clipId=null,start=frame;
 if(workflow){
  const hit=e.target.closest('[data-clip]'),rect=hit?.getBoundingClientRect(),margin=rect?Math.min(8,rect.width/4):0;
  clipId=hit&&e.clientX>rect.left+margin&&e.clientX<rect.right-margin?hit.dataset.clip:null;
  if(hit&&!clipId){const cut=rowFor(hit.dataset.clip);start=e.clientX<rect.left+rect.width/2?cut.start:cut.end;}
  else if(!hit&&state.snap){const points=layout().filter(r=>T.videoTrack(r.clip)===track).flatMap(r=>[r.start,r.end]),nearest=points.sort((a,b)=>Math.abs(a-frame)-Math.abs(b-frame))[0];if(Math.abs(nearest-frame)*ppf<=T.SNAP_PIXELS)start=nearest;}
 }else if(!audio){
  // Ask the same placement algorithm used by footage insertion where it fits.
  const geometry={...state,clips:state.clips.map(c=>({id:c.id,in:c.in,out:c.out,gapBefore:c.gapBefore,videoTrack:c.videoTrack}))},probe={id:'drop-preview',in:0,out:frames};
  T.insertClip(geometry,probe,T.dropIndex(state,frame),{track,start:T.videoTracks(state)>1?frame:null});start=T.rowFor(geometry,probe.id).start;
 }
 return {track,clipId,placement:{track,start:Math.max(0,start)},frames,label,index:T.dropIndex(state,start),mode:clipId?'replace':'insert',lane:audio?(e.target.closest('#audioLane')?'audioLane':'musicLane'):'clipLane'};
}
function paintLibraryDrop(e){
 const drop=libraryDrag&&libraryDrop(e,libraryDrag);if(!drop){libraryDropPreview.hidden=true;return;}
 const row=drop.clipId&&rowFor(drop.clipId),start=row?row.start:drop.placement.start,frames=row?row.end-row.start:drop.frames;
 const lane=$(drop.lane),top=lane.offsetTop+(drop.lane==='musicLane'?0:parseFloat($('editor').style.getPropertyValue('--'+(drop.lane==='audioLane'?'source':'video')+'-top-'+drop.track))||0),height=drop.lane==='musicLane'?trackHeight('music'):trackHeight((drop.lane==='audioLane'?'source:':'video:')+drop.track);
 const left=start*ppf,width=Math.max(14,frames*ppf),ghost=libraryDropPreview.querySelector('.library-drop-ghost'),marker=libraryDropPreview.querySelector('.library-drop-marker'),label=libraryDropPreview.querySelector('.library-drop-label'),sc=$('timelineScroll');
 libraryDropPreview.dataset.mode=drop.mode;Object.assign(ghost.style,{left:left+'px',width:width+'px',top:(top+5)+'px',height:(height-10)+'px'});
 Object.assign(marker.style,{left:left+'px',top:top+'px',height:height+'px'});marker.hidden=drop.mode==='replace';
 label.textContent=(drop.mode==='replace'?'Replace workflow':'Insert on '+(drop.lane==='clipLane'?'V'+drop.track:drop.lane==='audioLane'?'A1':'A2'))+' · '+(drop.label||'Workflow')+' · '+tc(start);
 Object.assign(label.style,{left:Math.max(sc.scrollLeft+4,Math.min(left+8,sc.scrollLeft+sc.clientWidth-260))+'px',top:Math.max(0,top-25)+'px',maxWidth:Math.max(80,sc.clientWidth-16)+'px'});libraryDropPreview.hidden=false;
}
function scrollLibraryDrop(){
 libraryScrollRAF=0;if(!libraryDragPoint||!libraryDrag)return;
 const sc=$('timelineScroll'),rect=sc.getBoundingClientRect(),x=libraryDragPoint.clientX,edge=48;
 const speed=x>rect.right-edge?Math.min(18,(x-rect.right+edge)/3):x<rect.left+edge?-Math.min(18,(rect.left+edge-x)/3):0;
 if(speed){const before=sc.scrollLeft;sc.scrollLeft=Math.max(0,Math.min($('timelineContent').clientWidth-sc.clientWidth,before+speed));if(sc.scrollLeft!==before){paintLibraryDrop({...libraryDragPoint,target:document.elementFromPoint(x,libraryDragPoint.clientY)||sc});libraryScrollRAF=requestAnimationFrame(scrollLibraryDrop);}}
}
$('editor').addEventListener('dragstart',e=>{try{libraryDrag=JSON.parse(e.dataTransfer.getData('application/spool'));}catch{libraryDrag=null;}});
document.addEventListener('dragend',()=>{libraryDrag=null;clearLibraryDrop();takeDropPreview.hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')clearLibraryDrop();});
$('timelineScroll').ondragover=e=>{
 e.preventDefault();const takeDrag=[...e.dataTransfer.types].includes('application/spool-take');e.dataTransfer.dropEffect=takeDrag?'move':'copy';
 if(takeDrag&&draggedTake){const track=trackAt(e),frame=Math.max(0,snapFrame(timelineFrame(e)));Object.assign(takeDropPreview.style,{left:frame*ppf+'px',width:draggedTake.frames*ppf+'px',top:'var(--video-top-'+track+')',height:'var(--video-height-'+track+')'});takeDropPreview.hidden=false;}
 else if(libraryDrag){libraryDragPoint={clientX:e.clientX,clientY:e.clientY};paintLibraryDrop(e);if(!libraryScrollRAF)libraryScrollRAF=requestAnimationFrame(scrollLibraryDrop);}
};
$('timelineScroll').ondragleave=e=>{if(!$('timelineScroll').contains(e.relatedTarget)){takeDropPreview.hidden=true;clearLibraryDrop();}};
$('timelineScroll').ondrop=e=>{
 e.preventDefault();takeDropPreview.hidden=true;clearLibraryDrop();libraryDrag=null;
 if([...e.dataTransfer.types].includes('application/spool-take')){try{const data=JSON.parse(e.dataTransfer.getData('application/spool-take'));if(data.projectId!==projectKey)throw Error('Move takes within the same project.');void moveTakeToTimeline(data.clipId,data.takeId,Math.max(0,snapFrame(timelineFrame(e))),trackAt(e));}catch(error){toast(error.message);}return;}
 activeVideoTrack=trackAt(e);state.frame=Math.max(0,Math.round(timelineFrame(e)));const audioOnly=!!e.target.closest('#audioLane,#musicLane');if(e.dataTransfer.files.length){importFiles(e.dataTransfer.files,true,Math.max(0,Math.round(timelineFrame(e))),state.clips.length,audioOnly,e.target.closest('#audioLane')?'source':'music');return;}
 try{const item=JSON.parse(e.dataTransfer.getData('application/spool')),f=timelineFrame(e),index=T.dropIndex(state,f);if(item.workflow||item.builtin){const {clipId,placement}=libraryDrop(e,item);if(item.builtin)addBuiltinShot(item.builtin,index,clipId,placement);else addLibraryShot(item.workflow,index,clipId,false,placement);}else if(item.media){if(audioOnly)addAudioClip(projectMedia().find(m=>m.id===item.media),Math.max(0,Math.round(f)),e.target.closest('#audioLane')?'source':'music');else addMediaClip(item.media,index,Math.max(0,Math.round(f)));}}catch(error){toast('Drop a workflow or a media file onto the timeline.');}
};
async function moveTakeToTimeline(clipId,takeId,start,track){
 const source=state.clips.find(c=>c.id===clipId),candidate=T.realTakes(source).find(t=>t.id===takeId);if(!candidate)return;
 let before,mutated=false;const inert=$('editor').inert;$('editor').inert=true;
 try{
  await flushNative();before=copy(state);const signature=editingSignature(projectData()),fallback=source.takeId===takeId?T.realTakes(source).find(t=>t.id!==takeId):null;
  const captureFor=id=>takeWorkflowCapture(clipId,id,source.name);
  const [capture,fallbackCapture,P]=await Promise.all([captureFor(takeId),fallback?captureFor(fallback.id):null,import('/spool/ui/profile.js')]);
  if(editingSignature(projectData())!==signature)throw Error('The clip changed while its take was being prepared. Drop it again.');
  pause();editView();const moved=T.moveTake(state,clipId,takeId,start,track,()=> 'clip-'+crypto.randomUUID());if(!moved)throw Error('This take is no longer available.');mutated=true;
  setTimelineSelection([moved.id]);activeVideoTrack=track;state.frame=rowFor(moved.id).start;save();await flushNative();
  const adopt=async(id,take,capture)=>{
   const current=state.clips.find(c=>c.id===id);if(!current)return;
   if(capture?.prompt){
    const choices=P.resultChoices(capture.prompt,productDefinitions),result=choices.find(r=>r.nodeId===capture.result?.nodeId&&r.group===capture.result?.group)||(choices.length===1?choices[0]:null);
    if(result){capture.result={nodeId:result.nodeId,group:result.group,index:result.index};capture.bindings=P.keyInputs(capture.prompt,productDefinitions,result).filter(b=>!b.ambiguous).map(({value,...b})=>({...b,key:crypto.randomUUID()}));await projectEdit.change(revision=>request('projects/'+projectKey+'/capture/'+id,{revision,capture,resetInputs:true}));}
   }
   const c=state.clips.find(c=>c.id===id);c.generationBase=capture?.provenance?.takeBase||{takeId:take.id,source:'No executable metadata'};save();await flushNative();
  };
  await adopt(moved.id,candidate,capture);if(fallback)await adopt(clipId,fallback,fallbackCapture);
  history.record(before,'Move take to timeline');markTakesSeen([takeId]);selectedTakeIds=[];closeTakeComparison();render();saveHistory();saveView();toast('Take moved to its own clip');
 }catch(error){if(mutated){state=preserveTakes(before);render();save();try{await flushNative();}catch{}}toast(error.message);}
 finally{$('editor').inert=inert;takeDropPreview.hidden=true;draggedTake=null;}
}
let externalDropDepth=0;
const externalFileDrag=e=>Array.from(e.dataTransfer?.types||[]).includes('Files')||!!e.dataTransfer?.files?.length;
function clearExternalDrop(){externalDropDepth=0;$('externalDropHint').hidden=true;}
$('editor').addEventListener('dragenter',e=>{if(!externalFileDrag(e))return;e.preventDefault();externalDropDepth++;$('externalDropHint').hidden=false;},true);
$('editor').addEventListener('dragover',e=>{if(e.target.closest('[data-image-input],[data-media-input]')||!externalFileDrag(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';$('externalDropHint').hidden=false;$('externalDropTitle').textContent=e.target.closest('.timeline-shell')?'Add workflow or media to the edit':'Import workflow or media';},true);
$('editor').addEventListener('dragleave',()=>{externalDropDepth=Math.max(0,externalDropDepth-1);if(!externalDropDepth)$('externalDropHint').hidden=true;},true);
$('editor').addEventListener('drop',e=>{if(e.target.closest('[data-image-input],[data-media-input]')||!externalFileDrag(e))return;e.preventDefault();e.stopPropagation();clearExternalDrop();const add=!!e.target.closest('.timeline-shell');if(add)activeVideoTrack=trackAt(e);const frame=add?Math.max(0,Math.round(timelineFrame(e))):Math.round(state.frame),index=add?T.dropIndex(state,frame):state.clips.length;if(add)state.frame=frame;importFiles(e.dataTransfer.files,add,frame,index,!!e.target.closest('#audioLane,#musicLane'),e.target.closest('#audioLane')?'source':'music');},true);
window.addEventListener('dragend',clearExternalDrop);interruptions.on(clearExternalDrop);
function audioButtons(){for(const id of ['monitorMute']){$(id).innerHTML=svg(state.muted?'mute':'volume')+'<span>Monitor</span>';$(id).classList.toggle('active',state.muted);$(id).setAttribute('aria-pressed',state.muted);$(id).setAttribute('aria-label',state.muted?'Unmute monitor':'Mute monitor');$(id).title=(state.muted?'Unmute':'Mute')+' monitor (export mix unchanged)';}const tracks=state.audioTracks||defaultAudioTracks;for(const [id,key] of [['trackMute','sourceMuted'],['trackSolo','sourceSolo'],['musicMute','musicMuted'],['musicSolo','musicSolo']]){$(id).classList.toggle('active',!!tracks[key]);$(id).setAttribute('aria-pressed',!!tracks[key]);}if(masterGain)masterGain.gain.value=state.muted?0:1;syncAudio();}

function setFrame(frame,force=false){if(!playing)thumbnails.stopScrub();if(review.mode==='source'&&review.source)review.seek(frame);else state.frame=clamp(frame,0,total());updateViewer(force);}
function viewerData(){return pictureAt(state,review,state.frame);}
function text(id,value){if($(id).textContent!==value)$(id).textContent=value;}
const placeholderState=document.createElement('div');placeholderState.id='placeholderState';placeholderState.className='empty-stage';placeholderState.hidden=true;placeholderState.setAttribute('role','status');
placeholderState.innerHTML='<span class="empty-symbol">'+svg('nodes')+'</span><strong id="placeholderTitle"></strong><p id="placeholderHint"></p>';$('emptyStage').after(placeholderState);
function renderPlaceholderState(d=viewerData()){
 placeholderState.hidden=!d?.take?.placeholder;
 if(!placeholderState.hidden){const available=T.realTakes(d.clip).length>0;text('placeholderTitle',available?'Choose a take':'Not generated yet');text('placeholderHint',available?'Generated takes are ready in Takes. Use a take to add it to the edit.':'Generate a take to preview this clip.');}
}
function viewerHead(d){
 $('previewQuality').value=previewQuality();
 const size=resolution();for(const option of $('previewQuality').options){const divisor={full:1,half:2,quarter:4}[option.value],label=(divisor===1?'Full':divisor===2?'1/2':'1/4')+' · '+previewDimension(size.width,divisor)+' × '+previewDimension(size.height,divisor);if(option.textContent!==label)option.textContent=label;}
 const src=review.mode==='source',c=d?.clip,t=d?.take,tried=review.audition&&state.clips.find(c=>c.id===review.audition.clipId),trial=tried?.takes.find(t=>t.id===review.audition.takeId);
 $('viewer').classList.toggle('source-mode',src);$('viewer').classList.toggle('audition',!src&&!!trial);
 $('sourceTab').classList.toggle('active',src);$('editTab').classList.toggle('active',!src);$('sourceTab').setAttribute('aria-selected',src);$('editTab').setAttribute('aria-selected',!src);$('sourceTab').disabled=!review.source&&!state.clips.length;
 draw('viewerContext',src?(c?'<b>'+esc(c.name)+'</b> · '+takeName(t)+' · '+(t.id===c.takeId?'<span class="in-edit">in edit</span>':'<span class="not-in-edit">not in edit</span>'):'<b>Media</b> · '+esc(review.source?.media.name||'')):trial?'<span class="not-in-edit">Trying '+takeName(trial)+' in '+esc(tried.name)+'</span> · not saved until you use it':'<b>Sequence 01</b> · '+state.clips.length+' '+(state.clips.length===1?'clip':'clips'));
 const usable=src?c&&t.id!==c.takeId&&t:trial;
 $('useSource').hidden=!usable;if(usable)text('useSource','Use '+takeName(usable));
 $('tryInEdit').hidden=!(src&&c);if(src&&c)$('tryInEdit').querySelector('.label').textContent=t.id===c.takeId?'Watch in edit':'Try in edit';
 $('cancelAudition').hidden=src||!trial;
 const compare=!!comparisonTakes(),canCompare=!selectedAudio()&&selected()?.takes.length>1;
 for(const id of ['compareTakes','compareTakesStrip']){$(id).hidden=!canCompare;$(id).setAttribute('aria-pressed',compare);text(id,compare?'Close compare':'Compare');}$('editor').classList.toggle('compare-active',compare);

 if((T.realTakes(selected()).length)<2)for(const id of ['compareTakes','compareTakesStrip'])$(id).hidden=true;
}
let currentClip=null;
function updateViewer(force=false){
 const d=viewerData(),src=review.mode==='source';$('emptyStage').hidden=!!d;$('emptyStage').classList.toggle('in-gap',!!(state.clips.length||state.audioClips?.length));renderPlaceholderState(d);viewerHead(d);
 if(!d){showMedia(null);draw('viewerOverlay','');text('timelineTime',tc(state.frame));text('viewerTime',tc(0));text('viewerDuration',tc(0));$('seek').max=0;$('scrubBand').hidden=true;return;}
 const pos=src?review.frame:state.frame;
 text('timelineTime',tc(state.frame));text('viewerTime',tc(pos));text('viewerDuration',tc(d.length));$('seek').max=d.length;$('seek').value=pos;
 const band=$('scrubBand');band.hidden=!(src&&d.clip);if(src&&d.clip){band.style.left=d.clip.in/d.length*100+'%';band.style.width=(Math.min(d.clip.out,d.length)-d.clip.in)/d.length*100+'%';}
 $('viewerDuration').title=src?'Full source duration':'Timeline duration';$('seek').title=src&&d.clip?'Full source · amber bar shows the current shot trim ('+seconds(d.clip.out-d.clip.in)+')':'';
 $('playhead').style.left=state.frame*ppf+'px';
 const trial=!src&&!d.gap&&review.audition?.takeId===d.take.id;
 draw('viewerOverlay',src?'':d.gap?'<span>Gap</span>':'<span>'+esc(d.clip.name)+'</span><span class="'+(trial?'preview-only':'in-edit')+'">'+(d.take.placeholder?'No take in edit':takeName(d.take))+(trial?' · trial':'')+'</span>');
 if(!src&&d.clipId!==currentClip){currentClip=d.clipId;$('clipLane').querySelectorAll('[data-clip]').forEach(n=>n.classList.toggle('current',n.dataset.clip===currentClip));}
 if(comparisonTakes())showTakeComparison(force);else{$('takeCompare').hidden=true;showMedia(d.take?.placeholder?null:d.media,d.frame,force);}if(!playing||force)applyViewerZoom();syncAudio(d);
 if(!src&&d.next){const n=d.next.clip,m=(review.audition?.clipId===n.id&&n.takes.find(t=>t.id===review.audition.takeId)||take(n)).media;if(m.kind==='video'){const v=videoFor(m);if(v&&v!==shownVideo){videoTiming(v,m);seekVideo(v,n.in/fps);}}}
 if(playing&&!src&&!timelinePan){const x=state.frame*ppf,sc=$('timelineScroll');if(x-sc.scrollLeft>sc.clientWidth-35)sc.scrollLeft=x-sc.clientWidth+80;}
}
function showTakeComparison(force=false){
 const takes=comparisonTakes(),stage=$('takeCompare');stage.hidden=false;$('still').hidden=true;
 const videos=takes.map((t,i)=>{const pane=$('comparePane'+i),v=t.media.kind==='video'?videoFor(t.media,'compare:'+i+':'+t.media.file):null,img=$('compareImage'+i),end=review.frame>=t.media.frames;
  pane.classList.toggle('active',i===review.comparison.active);$('compareSelect'+i).setAttribute('aria-pressed',i===review.comparison.active);text('compareName'+i,takeName(t));text('compareBadge'+i,[t.id===selected()?.takeId?'In edit':'',i===review.comparison.active?'Audio':''].filter(Boolean).join(' · '));$('compareBadge'+i).classList.toggle('used',t.id===selected()?.takeId);
  text('compareTime'+i,tc(Math.min(review.frame,t.media.frames-1)));text('compareEnd'+i,end?'End of take':'');
  img.hidden=t.media.kind!=='image';const file=previewFile(t.media);if(!file)img.hidden=true;else if(!img.hidden&&img.dataset.file!==file){img.dataset.file=file;img.src=file;}
  if(v){const picture=$('comparePicture'+i);if(v.parentElement!==picture)picture.prepend(v);videoTiming(v,t.media);v.hidden=false;const frame=Math.min(review.frame,t.media.frames-1);if(force||!playing||end||Math.abs(videoTime(v)-frame/fps)>.075)seekVideo(v,frame/fps);if(playing&&!end&&v.paused)v.play().catch(()=>{});if(end&&!v.paused)v.pause();}
  return v;
 });
 for(const v of pool.values())if(!videos.includes(v)){v.hidden=true;v.classList.remove('front');if(!v.paused)v.pause();}
 const lead=takes[0].media.frames>=takes[1].media.frames?0:1;shownVideo=videos[lead];
 if(shownVideo?.videoWidth)text('viewerResolution',shownVideo.videoWidth+' × '+shownVideo.videoHeight);
}
function previewQuality(){return ['full','half','quarter'].includes(state.previewQuality)?state.previewQuality:'full';}
function previewDimension(value,divisor){return Math.max(2,Math.round(value/divisor/2)*2);}
function previewTarget(){const size=resolution(),quality=previewQuality(),divisor=QUALITY[quality];return {width:previewDimension(size.width,divisor),height:previewDimension(size.height,divisor),fps,quality};}
// Preparing a preview states the size it wants, so it never has to save the project
// for the server to read one from the document.
const previews=createPreviews({
 target:previewTarget,
 request:async(m,size)=>{
  try{return await request('projects/'+projectKey+'/media/'+encodeURIComponent(m.id)+'/preview',size);}
  catch(error){
   // Media added in this session is not on the server until the next save; register
   // it, then retry once. Routine preparation stays save-free.
   if(error.status!==400&&error.status!==404)throw error;
   await flushNative();
   return request('projects/'+projectKey+'/media/'+encodeURIComponent(m.id)+'/preview',size);
  }
 },
 changed:(m,entry)=>{if(entry.state==='failed'){text('viewerResolution','Preview unavailable');setStatus('Playback preparation failed');toast(entry.error);return;}updateViewer();if(lastTrimEdit)updateTrimPreview(lastTrimEdit.d,lastTrimEdit.delta);}
});
function previewFile(m){
 if(!m.id||!['video','image'].includes(m.kind))return url(m.file);
 const entry=previews.status(m);
 if(entry.state==='failed'){text('viewerResolution','Preview unavailable');return m.kind==='image'?url(m.file):null;}
 if(entry.state==='preparing'){text('viewerResolution','Preparing '+(previewQuality()==='full'?'Full':previewQuality()==='half'?'1/2':'1/4')+'…');return m.kind==='image'?url(m.file):null;}
 return entry.file?url(entry.file):m.kind==='image'?url(m.file):null;
}
function videoTime(v){return Math.max(0,v.currentTime-Number(v.dataset.sourceOffset||0));}
const reviewSources=new Map();
function reviewSource(m,rate=fps){
 if(m.frameRateMode!=='interpret'||m.review?.frameRateMode==='interpret'&&m.sequenceFps===rate)return {file:m.file,offset:0};
 const key=(m.originalFile||m.file)+'|'+rate;let entry=reviewSources.get(key);
 if(!entry){entry={};reviewSources.set(key,entry);entry.pending=request('projects/'+projectKey+'/media/'+encodeURIComponent(m.id)+'/preview',{divisor:4,width:320,height:180,fps:rate}).then(result=>{entry.file=result.file;entry.pending=null;updateViewer();}).catch(error=>{reviewSources.delete(key);throw error;});}
 return {...entry,offset:(m.sourceRange?.start||0)/rate};
}
function videoTiming(v,m){v.dataset.sourceOffset=(m.sourceRange?.start||0)/fps;v.dataset.frames=m.frames;}
function videoSource(v,m){videoTiming(v,m);v.src=previewFile(m);}
function videoFor(m,key){
 const file=previewFile(m);if(!file)return null;key=(key||file)+'|'+previewQuality()+'|'+file;
 let v=pool.get(key);
 if(v){pool.delete(key);pool.set(key,v);return v;}
 v=document.createElement('video');v.crossOrigin='anonymous';v.preload='auto';v.playsInline=true;v.muted=state.muted;v.hidden=true;
 v.onloadedmetadata=()=>{if(v.seekTarget!==undefined)seekVideo(v,v.seekTarget);if(v===shownVideo)text('viewerResolution',v.videoWidth+' × '+v.videoHeight);applyViewerZoom();};
 v.onseeked=()=>{if(v.seekPending){v.seekPending=false;seekVideo(v,v.seekTarget);}else if(v===shownVideo)reveal(v);};
 v.onloadeddata=()=>{if(v===shownVideo&&!v.seeking)reveal(v);};
 v.oncanplay=()=>{if(playing&&v.paused&&(v===shownVideo||comparisonVideos().includes(v))&&(!v.closest('.compare-pane')||review.frame<Number(v.dataset.frames)))v.play().catch(()=>{});};
 v.onerror=()=>{const message='Playback unavailable · check the saved source or import it again';setStatus(message);toast(message);};
 videoSource(v,m);$('viewerStage').insertBefore(v,$('still'));pool.set(key,v);
 for(const [file,old] of pool){if(pool.size<=6)break;if(old!==shownVideo&&old!==v&&!comparisonVideos().includes(old)){releaseMedia(old);pool.delete(file);}}
 return v;
}
function seekVideo(v,time){
 const previous=v.currentTime,count=v.tagName==='VIDEO'?videoFrameCount(v):null;
 try{v.seekTarget=time;if(v.readyState<1||v.seeking){v.seekPending=v.seeking;return;}
 // Boundary timestamps can decode the previous frame. Audio keeps its exact clock.
 const video=v.tagName==='VIDEO',precise=video?(Math.floor(Math.max(0,time)*fps+1e-7)+.5)/fps:time;
 const offset=Number(v.dataset.sourceOffset||0),end=video?Math.min(v.duration,offset+Number(v.dataset.frames)/fps):v.duration;
 const target=clamp(precise+offset,offset,Math.max(offset,end-(video ? .5/fps : 0)));v.decodeTarget=target;
 if(Math.abs(v.currentTime-target)>1e-5)v.currentTime=target;else if(v===shownVideo&&v.readyState>=2)reveal(v);

 }finally{if(v.tagName==='VIDEO')nativeVideoSeekGuard.observe(v,time,previous,count);}
}
function reveal(v){if(v.closest('.compare-pane')||v!==shownVideo||v.classList.contains('front'))return;for(const other of pool.values())if(other!==v){other.hidden=true;other.classList.remove('front');if(!other.paused)other.pause();}v.classList.add('front');}
let finishStill=null;
function loadStill(img,file){
 finishStill?.();const finish=diagnostics.start('Decoding image',{background:true});finishStill=finish;
 img.onload=()=>{if(finishStill===finish){finish();finishStill=null;}};
 img.onerror=()=>{if(finishStill===finish){finish(Error('Image could not be decoded'));finishStill=null;}};
 img.dataset.file=file;img.src=file;
}
function showMedia(m,frame,force){
 if(m?.kind==='audio'){if(shownVideo){shownVideo.pause();shownVideo=null;}for(const v of pool.values()){v.hidden=true;v.classList.remove('front');}const a=audioFor('source:'+m.file,m);if(a&&(force||!playing||Math.abs(videoTime(a)-frame/fps)>.2))seekVideo(a,frame/fps);const img=$('still'),file=m.wave||m.poster;img.hidden=!file;if(file&&img.dataset.file!==file){img.dataset.file=file;img.src=url(file);}if(playing&&a?.paused)a.play().catch(()=>{});return;}
 const still=$('still'),v=m?.kind==='video'?videoFor(m):null;
 if(v!==shownVideo){shownVideo?.pause();shownVideo=v;force=true;if(v)v.hidden=false;else for(const other of pool.values()){other.hidden=true;other.classList.remove('front');}}
 if(v)videoTiming(v,m);
 if(force)applyViewerZoom();still.hidden=m?.kind!=='image';if(!still.hidden){const file=previewFile(m);if(!file)still.hidden=true;else if(still.dataset.file!==file){loadStill(still,file);}}
 if(!v)return;
 if(v.videoWidth)text('viewerResolution',v.videoWidth+' × '+v.videoHeight);
 if(force||!playing||Math.abs(videoTime(v)-frame/fps)>.25)seekVideo(v,frame/fps);
 if(!v.seeking&&v.readyState>=2)reveal(v);
 if(playing&&v.paused)v.play().catch(()=>{});
}
function pause(){if(playing)projectPoll=0;playing=false;$('mixLevel').style.height='0%';$('mixMeter').classList.remove('clipping');$('mixMeter').title='Monitor peak: silent';for(const a of audioPlayers.values())a.pause();cancelAnimationFrame(raf);for(const v of pool.values())if(!v.paused)v.pause();$('play').innerHTML=svg('play');$('play').setAttribute('aria-label','Play');}
function play(){thumbnails.stopScrub();hideTrimPreview();if(!viewerData())return;ensureAudioContext();if(playing){pause();save();return;}const src=review.mode==='source',len=src?sourceLength():total();if((src?review.frame:state.frame)>=len-1)setFrame(0,true);playing=true;previousTime=performance.now();$('play').innerHTML=svg('pause');$('play').setAttribute('aria-label','Pause');updateViewer();raf=requestAnimationFrame(tick);}
function tick(now){
 if(!playing)return;
 const d=viewerData(),src=review.mode==='source',pos=src?review.frame:state.frame,v=comparisonTakes()?shownVideo:d.media.kind==='video'?shownVideo:d.media.kind==='audio'?audioFor('source:'+d.media.file,d.media):null;
 if(['video','audio'].includes(d.media.kind)&&!v||d.media.kind==='image'&&!comparisonTakes()&&($('still').hidden||!$('still').complete)){previousTime=now;raf=requestAnimationFrame(tick);return;}
 let value=pos;
 if(!v)value+=Math.min((now-previousTime)/1000,.25)*fps;
 else if(v.ended||!v.paused&&!v.seeking&&v.readyState>=3){const frame=v.ended?Infinity:videoTime(v)*fps;value=src?Math.min(frame,d.length):Math.max(pos,Math.min(d.row.end,d.row.start+frame-d.clip.in));}
 previousTime=now;
 if(value>=d.length){if(src||state.loop)setFrame(0,true);else{setFrame(d.length,true);pause();save();return;}}
 else setFrame(value);
 raf=requestAnimationFrame(tick);
}
function skip(direction){pause();if(review.mode==='source'&&review.source){setFrame(direction<0?0:sourceLength(),true);return;}const points=[0,...layout().map(r=>r.start),total()].sort((a,b)=>a-b);const target=direction<0?points.filter(p=>p<state.frame-1).at(-1):points.find(p=>p>state.frame+1);setFrame(target===undefined?(direction<0?0:total()):target,true);save();}
function frameStep(delta){hideTrimPreview();pause();const src=review.mode==='source'&&review.source,length=src?sourceLength():total(),frame=Math.floor((src?review.frame:state.frame)+1e-7)+delta;setFrame(clamp(frame,0,Math.max(0,length-1)),true);saveView();}
async function uploadFile(file){return diagnostics.run('Importing '+file.name,async()=>{const m=await api.upload('upload?projectId='+encodeURIComponent(projectKey)+'&fps='+fps,file,file.name,{fallback:'Import failed'});if(m.workflow){m.workflowData=m.workflowData||readWorkflowData({workflow:m.workflow,prompt:m.prompt});registerWorkflowData(m.workflowData,m.name,m.poster);}state.media.push(m);return m;},{detail:Math.round(file.size/1024)+' KB'});}
async function importFiles(files,add=false,start=Math.round(state.frame),index=state.clips.length,audioOnly=false,audioTrack='music',audioLane=activeVideoTrack){let imported=0,failed=0;for(const file of files){try{if(!/\.json$/i.test(file.name)){const m=await uploadFile(file);if(!add)save();if(add){if(audioOnly){if(!m.audio)throw Error(m.name+' has no audio stream');addAudioClip(m,start,audioTrack,audioLane);}else await addMediaClip(m.id,index,start);if(!audioOnly&&m.kind!=='audio'){index++;if(T.videoTracks(state)>1&&state.selected){const placed=rowFor(state.selected);if(placed)start=placed.end;}}else start+=m.frames;}imported++;continue;}if(add){const session=await captureInputs(async()=>{const w=await importWorkflowFile(file);return {...copy(w.data),importedWorkflowId:w.id};},file.name,index);if(session&&await session.completed)index++;}else{await flushNative();await importWorkflowFile(file);}imported++;}catch(error){toast(error.message);failed++;}}binTab=!audioOnly&&[...files].some(file=>/\.json$/i.test(file.name))?'workflows':'media';$('mediaFiles').value='';$('audioFiles').value='';render();save();return {imported,failed};}
async function pasteImages(images,destination){
 if(!images.length){toast('No image in the clipboard. Copy an image, then paste again.');return;}
 pause();setStatus('Pasting image...');const frame=Math.round(state.frame),index=T.dropIndex(state,frame),files=[];
 try{
  for(let i=0;i<images.length;i++){
   let blob=images[i],extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type];
   if(!extension){const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('The clipboard image could not be read.');extension='png';}
   files.push(new File([blob],'Pasted image '+new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')+(images.length>1?' '+(i+1):'')+'.'+extension,{type:blob.type}));
  }
  const result=await importFiles(files,destination==='timeline',frame,index);setBinTab('media');
  if(result.imported){await flushNative();const message=result.imported+(result.imported===1?' image':' images')+' pasted to '+(destination==='timeline'?'timeline':'media pool');setStatus(message);if(!result.failed)toast(message);}
 }catch(error){toast(error.message);}
}
async function pasteClipboardImage(destination){
 if(!navigator.clipboard?.read){toast('Click the '+(destination==='timeline'?'timeline':'media pool')+' and press Ctrl+V to paste an image.');return;}
 try{const items=await diagnostics.run('Reading clipboard',()=>navigator.clipboard.read()),images=[];for(const item of items){const type=item.types.includes('image/png')?'image/png':item.types.find(type=>type.startsWith('image/'));if(type)images.push(await diagnostics.run('Reading clipboard image',()=>item.getType(type)));}await pasteImages(images,destination);}
 catch(error){toast('Clipboard access was blocked. Click the '+(destination==='timeline'?'timeline':'media pool')+' and press Ctrl+V.');}
}
let pasteDestination='timeline';
const textPasteTarget=target=>target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
const rememberPasteDestination=e=>{if(textPasteTarget(e.target))return;const destination=e.target.closest('#mediaPanel')?'media':e.target.closest('.timeline-shell,.timeline-toolbar')?'timeline':null;if(destination){pasteDestination=destination;if(e.type==='pointerdown'&&!e.target.closest('button,a'))$('editor').focus({preventScroll:true});}};
for(const event of ['pointerdown','focusin'])$('editor').addEventListener(event,rememberPasteDestination,true);
document.addEventListener('paste',e=>{
 if(textPasteTarget(e.target)||!$('modalOverlay').hidden||drag||workflowLocked||$('editor').inert)return;
 const files=Array.from(e.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
 if(!files.length)files.push(...Array.from(e.clipboardData?.files||[]).filter(file=>file.type.startsWith('image/')));
 if(!files.length)return;e.preventDefault();e.stopPropagation();closeClipMenu(false);pasteImages(files,e.target.closest('#mediaPanel')?'media':e.target.closest('.timeline-shell,.timeline-toolbar')?'timeline':pasteDestination);
});
function showModal(title,body,footer=''){
 modalCleanup?.();modalCleanup=null;
 $('modal').classList.remove('project-dialog','render-dialog','template-dialog','shortcut-dialog');
 pause();modalReturnFocus=document.activeElement;$('modal').innerHTML='<div class="modal-head"><h2 id="modalTitle">'+esc(title)+'</h2><button class="iconbutton" id="closeModal" aria-label="Close dialog">'+svg('close')+'</button></div>'+body+(footer?'<div class="modal-footer">'+footer+'</div>':'');$('modalOverlay').hidden=false;$('closeModal').onclick=closeModal;$('closeModal').focus();
}
processingButton.onclick=()=>{
 showModal('Processing and diagnostics','<p id="diagnosticsCurrent"></p><p>Recent timings and errors are kept locally in this tab. Copy this log when an action takes too long.</p><textarea class="diagnostics-log" id="diagnosticsLog" readonly aria-label="Local diagnostic log"></textarea>','<button class="outline" id="diagnosticsDownload">Download log</button><button class="primary" id="diagnosticsCopy">Copy diagnostics</button>');
 const refresh=()=>{const value=diagnostics.snapshot();$('diagnosticsCurrent').textContent=value.active.map(a=>a.label+' ('+(a.elapsedMs/1000).toFixed(1)+'s)').join(' - ')||'Ready';$('diagnosticsLog').value=JSON.stringify({spoolVersion:productCapabilities.version,projectId:projectKey,revision:projectEdit.revision,...value},null,2);};refresh();clearInterval(diagnosticsTimer);diagnosticsTimer=setInterval(refresh,500);
 $('diagnosticsCopy').onclick=async()=>{const field=$('diagnosticsLog');try{await navigator.clipboard.writeText(field.value);$('diagnosticsCopy').textContent='Copied';}catch(error){field.focus();field.select();$('diagnosticsCopy').textContent='Press Ctrl+C';}};
 $('diagnosticsDownload').onclick=()=>{const blob=new Blob([$('diagnosticsLog').value],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spool-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
};
function importFootageDialog(){
 showModal('Import video','<p>Spool reads the file where it is and makes review copies. Each detected shot becomes a clip whose first take is the original footage.</p><label class="field"><span>Video file path</span><input id="footagePath" placeholder="D:\\Footage\\edit.mp4" spellcheck="false"></label><label class="export-audio"><input type="checkbox" id="footageCuts" checked> Split at detected cuts</label><div id="footageResult"></div>','<button class="outline" id="footageCancel">Cancel</button><button class="primary" id="footageImport">Import</button>');
 $('footagePath').focus();$('footageCancel').onclick=closeModal;
 $('footagePath').onkeydown=e=>{if(e.key==='Enter')$('footageImport').click();};
 $('footageImport').onclick=async()=>{
  const path=$('footagePath').value.trim().replace(/^"(.*)"$/,'$1');if(!path)return;
  const button=$('footageImport');button.disabled=true;button.textContent='Importing…';$('footageResult').textContent='Making review copies and finding cuts…';
  try{const count=await importFootage(path,$('footageCuts').checked);closeModal();toast(count+(count===1?' clip':' clips')+' added from '+path.split(/[\\/]/).pop());}
  catch(error){if($('footageResult')){$('footageResult').textContent=error.message;button.disabled=false;button.textContent='Import';}}
 };
}
async function importFootage(path,detectCuts){
 const empty=!state.clips.length&&!(state.audioClips||[]).length;
 const result=await api.call('import-footage?projectId='+encodeURIComponent(projectKey),{method:'POST',body:{path,detectCuts,fps:empty&&!state.fpsExplicit?null:fps},fallback:'Import failed'});
 return edits.apply('Import '+result.source.name,()=>{pause();editView();clearHeld();
 if(empty)fps=state.fps=result.fps;
 for(const m of [result.source,result.audio])if(m){state.media.push(m);}
 const clips=result.shots.map(m=>{const t={id:'take-'+crypto.randomUUID(),number:0,original:true,revision:1,media:m,sample:false};return {id:'clip-'+crypto.randomUUID(),name:m.name,workflow:null,sources:[],prompt:'',seed:0,duration:m.frames/fps,count:1,revision:1,takes:[t],takeId:t.id,in:0,out:m.frames};});
 if(T.videoTracks(state)>1)state.frame=T.trackClips(state,activeVideoTrack).reduce((n,c)=>n+(c.gapBefore||0)+c.out-c.in,0);
 for(const c of clips){T.insertClip(state,c,state.clips.length,{track:activeVideoTrack,start:T.videoTracks(state)>1?Math.round(state.frame):null});state.frame=rowFor(c.id).end;}
 const start=rowFor(clips[0].id).start;
 if(result.audio)T.addAudioClip(state,result.audio,start,'audio-'+crypto.randomUUID()).audio.gainDb=0;
 state.selected=clips[0].id;state.selectedAudio=null;state.frame=start;
 return clips.length;});
}
function projectSettings(){
 const size=resolution(),occupied=state.clips.length||state.media.length||(state.audioClips||[]).length;
 showModal('Project settings','<label class="field"><span>Project name</span><input id="settingsName" value="'+esc(state.project)+'"></label><label class="field"><span>Project brief</span><textarea id="settingsBrief">'+esc(state.brief||'')+'</textarea></label><label class="field"><span>Resolution preset</span><select id="settingsPreset"><option value="custom">Custom</option><option value="960,540">960 × 540</option><option value="1280,720">HD · 1280 × 720</option><option value="1920,1080">Full HD · 1920 × 1080</option><option value="3840,2160">4K UHD · 3840 × 2160</option><option value="1080,1920">Portrait · 1080 × 1920</option></select></label><div class="two-fields"><label class="field"><span>Width</span><input type="number" min="2" step="2" id="settingsWidth" value="'+size.width+'"></label><label class="field"><span>Height</span><input type="number" min="2" step="2" id="settingsHeight" value="'+size.height+'"></label></div><label class="field"><span>Frame rate</span><input type="number" min="1" step="any" id="settingsFps" value="'+fps+'" '+(occupied?'readonly':'')+'></label><p class="small">Resolution sets the timeline and export size. Preview Full uses this size; 1/2 and 1/4 reduce playback resolution. Export uses original footage. Workflow generation size is controlled by each workflow.</p><p class="small">'+(occupied?'Frame rate is fixed after media is added to preserve edit timing.':'The first video sets the frame rate unless you choose one here.')+'</p><p id="settingsError"></p>','<button class="outline" id="settingsCancel">Cancel</button><button class="primary" id="settingsSave">Save settings</button>');
 $('settingsPreset').value=[...$('settingsPreset').options].some(o=>o.value===size.width+','+size.height)?size.width+','+size.height:'custom';
 $('settingsPreset').onchange=()=>{const value=$('settingsPreset').value;if(value!=='custom'){const [w,h]=value.split(',');$('settingsWidth').value=w;$('settingsHeight').value=h;}};
 for(const id of ['settingsWidth','settingsHeight'])$(id).oninput=()=>$('settingsPreset').value='custom';
 $('settingsCancel').onclick=closeModal;
 $('settingsSave').onclick=()=>{const width=Number($('settingsWidth').value),height=Number($('settingsHeight').value),rate=Number($('settingsFps').value);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width%2||height%2||!Number.isFinite(rate)||rate<=0){$('settingsError').textContent='Enter positive even dimensions and a positive frame rate.';return;}
  edits.apply('Project settings',()=>{state.brief=$('settingsBrief').value;state.project=$('settingsName').value.trim()||'Untitled project';state.resolution={width,height};if(!occupied&&rate!==fps){state.fps=rate;state.fpsExplicit=true;}closeModal();});toast('Project settings saved');
 };
}
async function detectClipCuts(id){
 const c=state.clips.find(c=>c.id===id);if(!c)return;const chosen=take(c),before=editingSignature(projectData());
 showModal('Detect cuts','<p>Find hard cuts inside <b>'+esc(c.name)+'</b> using its selected take and current trim. Review the result before splitting. Audio on A2 stays in place.</p><p id="cutsResult">Detecting cuts…</p>','<button class="outline" id="cutsCancel">Cancel</button><button class="primary" id="cutsApply" disabled>Split at cuts</button>');
 const button=$('cutsApply'),result=$('cutsResult');$('cutsCancel').onclick=closeModal;
 try{await flushNative();const {cuts}=await request('projects/'+projectKey+'/detect-cuts',{clipId:id,takeId:chosen.id},'POST');if($('cutsResult')!==result)return;
  result.textContent=cuts.length?cuts.length+' cuts found · '+(cuts.length+1)+' clips. You can undo the split.':'No hard cuts found in this clip.';button.disabled=!cuts.length;
  button.onclick=()=>{if(editingSignature(projectData())!==before){result.textContent='The edit changed. Close this dialog and detect again.';button.disabled=true;return;}
   const start=rowFor(id).start,name=c.name.replace(/\.(mp4|mov|webm|mkv|m4v)$/i,'');edits.apply('Detect cuts',()=>{editView();const shots=[c];for(const cut of cuts){const {clip}=T.splitClip(state,start+cut,'clip-'+crypto.randomUUID(),shots.at(-1).id);if(clip)shots.push(clip);}shots.forEach((shot,index)=>shot.name=name+'_'+String(index+1).padStart(2,'0'));state.selected=id;state.selectedAudio=null;state.frame=start;closeModal();});toast('Clip split at '+cuts.length+' cuts');
  };
 }catch(error){if($('cutsResult')===result)result.textContent=error.message;}
}
async function exportViewerFrame(data){
 if(viewerExpanded)toggleViewerFullscreen();
 showModal('Export frame','<p>Export this frame as a PNG at the footage’s original resolution.</p><p id="frameResult">Exporting frame…</p>');const result=$('frameResult');
 try{await flushNative();const frame=await request('projects/'+projectKey+'/frame',{mediaId:data.media.id,frame:Math.floor(data.frame)},'POST');if($('frameResult')!==result)return;result.innerHTML='<a class="download-link" href="'+esc(frame.url)+'" download="'+esc(frame.filename)+'">Download PNG</a>';const a=document.createElement('a');a.href=frame.url;a.download=frame.filename;a.click();}
 catch(error){if($('frameResult')===result)result.textContent=error.message;}
}
function closeModal(){modalCleanup?.();modalCleanup=null;clearInterval(diagnosticsTimer);diagnosticsTimer=0;projectEdit.cancelCapture();$('modalOverlay').hidden=true;modalReturnFocus?.focus();}
$('modalOverlay').onclick=e=>{if(e.target===$('modalOverlay'))closeModal();};
function queueLabel(){const active=visibleJobs().filter(j=>G.ACTIVE.includes(j.status)).length;$('queueLabel').textContent='Renders';const badge=$('renderCount');if(badge)badge.textContent=active||'';$('showQueue').setAttribute('aria-label',active?'Renders: '+active+' active requests':'Renders');$('showQueue').classList.toggle('busy',!!active);}
const resolution=()=>state.resolution||{width:960,height:540};
const exportRangeBar=document.createElement('div');exportRangeBar.id='exportRangeBar';exportRangeBar.innerHTML='<button data-export-edge="start" aria-label="Export start" role="slider" tabindex="0">Start</button><button data-export-edge="end" aria-label="Export end" role="slider" tabindex="0">End</button>';$('timelineContent').append(exportRangeBar);
exportRangeBar.onpointerdown=e=>{if(e.target===exportRangeBar){e.stopPropagation();$('ruler').onpointerdown(e);}};
const rangeSettings=document.createElement('button');rangeSettings.id='exportRangeSettings';rangeSettings.className='outline';rangeSettings.textContent='Range';rangeSettings.title='Export range · I sets start, O sets end at the timeline playhead';$('gestureHelp').after(rangeSettings);rangeSettings.onclick=()=>exportVideo();
function renderExportRange(range=T.exportRange(state)){
 exportRangeBar.hidden=!range.end;exportRangeBar.style.left=range.start*ppf+'px';exportRangeBar.style.width=(range.end-range.start)*ppf+'px';
 for(const b of exportRangeBar.children){const edge=b.dataset.exportEdge;b.title='Export '+edge+' · '+tc(range[edge])+' · drag or use arrow keys';b.setAttribute('aria-valuemin',edge==='start'?0:range.start+1);b.setAttribute('aria-valuemax',edge==='start'?range.end-1:total());b.setAttribute('aria-valuenow',range[edge]);b.setAttribute('aria-valuetext',tc(range[edge]));}
 rangeSettings.title='Export '+tc(range.start)+' – '+tc(range.end)+' · '+tc(range.end-range.start)+' · I: start / O: end';
}
function setExportRange(range){if(!range&&!state.exportRange||range&&state.exportRange&&range.start===state.exportRange.start&&range.end===state.exportRange.end)return;edits.apply('Set export range',()=>{if(range)state.exportRange=range;else delete state.exportRange;},'range');}
function setExportEdge(edge,frame){const range=T.exportRange(state);if(!range.end)return;range[edge]=clamp(frame,edge==='start'?0:range.start+1,edge==='start'?range.end-1:total());setExportRange(range);}
function cancelExportRange(){if(!exportRangeDrag)return;exportRangeDrag=null;renderExportRange();}
for(const b of exportRangeBar.children){
 b.onpointerdown=e=>{if(e.button!==0||pointerBusy())return;e.preventDefault();e.stopPropagation();pause();const range=T.exportRange(state);exportRangeDrag={edge:b.dataset.exportEdge,range,scale:ppf};b.setPointerCapture(e.pointerId);b.focus({preventScroll:true});};
 b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End','Escape'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='Escape'){cancelExportRange();return;}const edge=b.dataset.exportEdge,range=T.exportRange(state),frame=e.key==='Home'?0:e.key==='End'?total():range[edge]+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1);setExportEdge(edge,frame);};
}
window.addEventListener('pointermove',e=>{if(!exportRangeDrag)return;const d=exportRangeDrag,r=$('timelineContent').getBoundingClientRect(),frame=state.snap?T.snap(T.snapPoints(state), (e.clientX-r.left)/d.scale,T.SNAP_PIXELS/d.scale):Math.round((e.clientX-r.left)/d.scale);d.range[d.edge]=clamp(frame,d.edge==='start'?0:d.range.start+1,d.edge==='start'?d.range.end-1:total());renderExportRange(d.range);});
window.addEventListener('pointerup',()=>{if(!exportRangeDrag)return;const range=exportRangeDrag.range;exportRangeDrag=null;setExportRange(range);});
window.addEventListener('pointercancel',cancelExportRange);interruptions.on(cancelExportRange);
function exportFrameValue(value){if(/^\d+(?:\.\d+)?$/.test(value.trim()))return Math.round(Number(value)*fps);const m=value.trim().match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/);if(!m||Number(m[2])>=60||Number(m[3])>=60||Number(m[4])>=fps)throw Error('Enter seconds or HH:MM:SS:FF.');return Math.round((Number(m[1])*3600+Number(m[2])*60+Number(m[3]))*fps+Number(m[4]));}
const exportData=()=>({...T.exportPlan(state,T.exportRange(state)),fps,...resolution(),projectId:projectKey});
let exportFormat='mp4';
async function exportVideo(){
 if(state.clips.some(c=>take(c).placeholder)){toast('Remove empty workflow clips before exporting; they have no generated take.');return;}
 if(!total()){toast('Add video or audio before exporting.');return;}
 showModal('Export sequence','<p>Assemble the selected takes using the current trims and clip order.</p><div class="two-fields"><label class="field"><span>Format</span><select id="exportFormat"><option value="mp4">MP4 · H.264</option><option value="otio">OpenTimelineIO (.otio)</option></select></label><label class="field"><span>Resolution / frame rate</span><input value="'+resolution().width+' × '+resolution().height+' / '+fps+' fps" readonly></label></div><div class="two-fields export-range-fields"><label class="field"><span>Start</span><input id="exportStart" aria-label="Export start time" value="'+tc(T.exportRange(state).start)+'"></label><label class="field"><span>End</span><input id="exportEnd" aria-label="Export end time" value="'+tc(T.exportRange(state).end)+'"></label></div><div class="export-range-presets"><button class="outline" id="exportPicture">Picture length</button><button class="outline" id="exportEntire">Entire timeline</button><button class="outline" id="exportSelected">Selected clips</button></div><p id="exportRangeSummary"></p><p class="small">Enter seconds or HH:MM:SS:FF. The end marker is the cut after the included footage. Drag markers on the ruler, or use I / O at the playhead.</p><p id="exportRangeError" role="alert"></p><label class="export-audio"><input type="checkbox" id="exportAudio" checked> <span id="exportAudioLabel">Include audio mix</span></label><p class="small" id="exportFormatNote">Monitor mute does not affect export.</p><div id="exportResult"></div>','<button class="outline" id="exportCancel">Cancel</button><button class="primary" id="renderExport">Export video</button>');
 const updateRangeFields=()=>{const range=T.exportRange(state);$('exportStart').value=tc(range.start);$('exportEnd').value=tc(range.end);$('exportRangeSummary').textContent='Duration: '+tc(range.end-range.start)+' / '+(range.end-range.start)+' frames'+(!state.exportRange?' / follows picture length':'');$('exportRangeError').textContent='';$('renderExport').disabled=!range.end;};
 const applyRangeFields=()=>{try{const start=exportFrameValue($('exportStart').value),end=exportFrameValue($('exportEnd').value);if(start<0||end<=start||end>total())throw Error('Start must be before end, within the timeline.');const current=T.exportRange(state);if(state.exportRange||current.start!==start||current.end!==end)setExportRange({start,end});updateRangeFields();return true;}catch(error){$('exportRangeError').textContent=error.message;$('renderExport').disabled=true;return false;}};
 $('exportStart').onchange=$('exportEnd').onchange=applyRangeFields;
 $('exportPicture').onclick=()=>{setExportRange(null);updateRangeFields();};$('exportEntire').onclick=()=>{setExportRange({start:0,end:total()});updateRangeFields();};
 const selectedRows=[...layout().filter(r=>selectionIds().includes(r.clip.id)).map(r=>({start:r.start,end:r.end})),...(state.audioClips||[]).filter(c=>selectionIds().includes(c.id)).map(c=>({start:c.start,end:c.start+c.out-c.in}))];$('exportSelected').disabled=!selectedRows.length;$('exportSelected').onclick=()=>{setExportRange({start:Math.min(...selectedRows.map(r=>r.start)),end:Math.max(...selectedRows.map(r=>r.end))});updateRangeFields();};updateRangeFields();
 const showFormat=()=>{const otio=exportFormat==='otio';$('exportFormat').value=exportFormat;$('exportAudioLabel').textContent=otio?'Include audio tracks':'Include audio mix';$('exportFormatNote').textContent=otio?'Every track, clip and trim, for Resolve, Premiere Pro and other editors. Media stays where it is and is not copied. Gain and fades are not carried.':'Monitor mute does not affect export.';$('renderExport').textContent=otio?'Export timeline':'Export video';$('exportResult').textContent='';};
 $('exportFormat').onchange=()=>{exportFormat=$('exportFormat').value;showFormat();};showFormat();
 $('exportCancel').onclick=closeModal;
 $('renderExport').onclick=async()=>{
 if(!applyRangeFields())return;
 if(layout().some(r=>r.start<T.exportRange(state).end&&r.end>T.exportRange(state).start&&take(r.clip).placeholder)){$('exportRangeError').textContent='The range includes empty workflow clips. Generate a take or exclude them from this range.';return;}
 const button=$('renderExport');button.disabled=true;button.textContent='Exporting…';
 if(exportFormat==='otio'){exportTimeline(button);return;}
 $('exportResult').textContent='Rendering the selected edit locally…';
 try{
 await flushNative();const data=exportData();data.audio=$('exportAudio').checked;
 const result=await api.call('export?projectId='+encodeURIComponent(projectKey),{method:'POST',body:data,fallback:'Export failed.'});
 if($('exportResult'))$('exportResult').innerHTML='<p>Export complete. <a class="download-link" href="'+esc(url(result.url))+'" download="'+esc(result.filename)+'">Download MP4</a></p>';
 button.textContent='Export complete';setStatus('Sequence exported · '+result.filename);
 }catch(error){if($('exportResult'))$('exportResult').textContent=error.message;button.disabled=false;button.textContent='Try again';}
 };
}
async function exportTimeline(button){
 $('exportResult').textContent='Writing the timeline…';
 try{
 await flushNative();const plan=T.timelinePlan(state,T.exportRange(state));if(!$('exportAudio').checked)plan.tracks=plan.tracks.filter(t=>t.kind==='video');
 const result=await api.call('export/otio?projectId='+encodeURIComponent(projectKey),{method:'POST',body:{...plan,fps,...resolution(),name:state.project,projectId:projectKey},fallback:'Export failed.'});
 const link=URL.createObjectURL(new Blob([JSON.stringify(result.timeline,null,2)],{type:'application/json'}));
 if($('exportResult'))$('exportResult').innerHTML='<p>Export complete. <a class="download-link" href="'+link+'" download="'+esc(result.filename)+'">Download timeline</a></p><p class="small">Also saved as '+esc(result.path)+'</p>';
 button.textContent='Export complete';setStatus('Timeline exported · '+result.filename);
 }catch(error){if($('exportResult'))$('exportResult').textContent=error.message;button.disabled=false;button.textContent='Try again';}
}
async function downloadProject(){try{await flushNative();downloadValue(await request('projects/'+projectKey+'/export'));}catch(error){toast(error.message);}}
function setBinTab(tab){binTab=tab;renderBin();}
for(const button of document.querySelectorAll('[data-media-filter]'))button.onclick=()=>{mediaFilter=button.dataset.mediaFilter;document.querySelectorAll('[data-media-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',b===button);});renderBin();};
document.querySelectorAll('[data-bin-tab]').forEach(b=>b.onclick=()=>setBinTab(b.dataset.binTab));
$('pasteImageMedia').onclick=()=>pasteClipboardImage('media');$('pasteImageTimeline').onclick=()=>pasteClipboardImage('timeline');
$('sourceTab').onclick=()=>setViewMode('source');$('editTab').onclick=()=>setViewMode('edit');$('useSource').onclick=useViewerTake;$('tryInEdit').onclick=tryInEdit;$('cancelAudition').onclick=cancelAudition;$('play').onclick=play;$('previous').onclick=()=>skip(-1);$('next').onclick=()=>skip(1);$('frameBack').onclick=()=>frameStep(-1);$('frameForward').onclick=()=>frameStep(1);
$('seek').oninput=e=>{hideTrimPreview();pause();setFrame(Number(e.target.value),true);};$('seek').onchange=save;
$('loop').onclick=()=>{state.loop=!state.loop;$('loop').classList.toggle('active',state.loop);save();};
for(const id of ['monitorMute'])$(id).onclick=()=>{ensureAudioContext();state.muted=!state.muted;audioButtons();save();};
for(const [id,key] of [['trackMute','sourceMuted'],['trackSolo','sourceSolo'],['musicMute','musicMuted'],['musicSolo','musicSolo']])$(id).onclick=()=>{edits.apply('Change '+(key.startsWith('source')?'clip audio':'soundtrack')+' mix',()=>{state.audioTracks={...defaultAudioTracks,...state.audioTracks,[key]:!state.audioTracks?.[key]};},'audio');};
$('split').onclick=split;$('remove').onclick=()=>remove();$('duplicate').onclick=duplicate;$('undo').onclick=undo;$('redo').onclick=redo;
$('inputsInspectorTab').onclick=()=>{state.selectedAudio=null;inspectorTab='inputs';renderInspector();renderTimeline();save();};$('audioInspectorTab').onclick=()=>{inspectorTab='audio';renderInspector();};$('importAudio').onclick=()=>$('audioFiles').click();$('audioFiles').onchange=e=>importFiles(e.target.files,true,Math.round(state.frame),state.clips.length,true);
$('snap').onclick=()=>{state.snap=!state.snap;$('snap').classList.toggle('active',state.snap);save();toast('Snapping '+(state.snap?'on':'off'));};
$('zoom').oninput=e=>setTimelineZoom(Number(e.target.value));
$('fit').onclick=fitTimeline;
$('generate').onclick=()=>queueClips(selectedVideos());$('export').onclick=exportVideo;$('saveProject').onclick=downloadProject;$('openProject').onclick=()=>openProjectFolder();
$('projectName').onchange=e=>{edits.apply('Rename project',()=>{state.project=e.target.value.trim()||'Untitled project';e.target.value=state.project;},'none');};
$('clipName').onchange=e=>{const c=selectedAudio()||selected();if(!c)return;edits.apply('Rename '+c.name,()=>{c.name=e.target.value.trim()||'Untitled clip';},'timeline');};
$('reset').onclick=reset;
$('toggleMedia').onclick=()=>{if(window.innerWidth<=1100){$('mediaPanel').classList.toggle('open');$('inspector').classList.remove('open');}else if($('workbench').classList.contains('hide-media')&&$('mediaPanel').classList.contains('open'))closeMediaFlyout();else setMediaCollapsed(!$('workbench').classList.contains('hide-media'));};
// On desktop a collapsed media pool leaves an icon rail whose buttons open the pool over the viewer.
const mediaCollapsedKey='spool-media-collapsed',mediaRail=document.createElement('nav');mediaRail.className='media-rail';mediaRail.setAttribute('aria-label','Workflows and media');
mediaRail.innerHTML=[['workflows','nodes','Workflows'],['media','bin','Media']].map(([tab,icon,label])=>'<button type="button" class="iconbutton" data-rail-tab="'+tab+'" aria-pressed="false" title="'+label+'" aria-label="'+label+'">'+svg(icon)+'</button>').join('')+'<button type="button" class="iconbutton" id="dockMedia" title="Keep workflows and media open" aria-label="Keep workflows and media open">'+svg('sidebar')+'</button>';
$('editor').append(mediaRail);
function syncMediaRail(){const panel=$('mediaPanel'),open=panel.classList.contains('open');for(const b of mediaRail.querySelectorAll('[data-rail-tab]'))b.setAttribute('aria-pressed',open&&panel.dataset.tab===b.dataset.railTab);}
function closeMediaFlyout(){if(window.innerWidth>1100&&$('mediaPanel').classList.contains('open')){$('mediaPanel').classList.remove('open');syncMediaRail();}}
function setMediaCollapsed(collapsed){$('workbench').classList.toggle('hide-media',collapsed);$('mediaPanel').classList.remove('open');try{localStorage.setItem(mediaCollapsedKey,collapsed?'1':'0');}catch(error){}syncMediaRail();}
mediaRail.querySelectorAll('[data-rail-tab]').forEach(b=>b.onclick=()=>{const panel=$('mediaPanel'),same=panel.classList.contains('open')&&panel.dataset.tab===b.dataset.railTab;setBinTab(b.dataset.railTab);panel.classList.toggle('open',!same);syncMediaRail();});
$('dockMedia').onclick=()=>setMediaCollapsed(false);
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#mediaPanel,.media-rail,#modalOverlay,#native-clip-menu'))closeMediaFlyout();},true);
$('mediaPanel').addEventListener('dragend',closeMediaFlyout);
try{if(window.innerWidth>1100&&localStorage.getItem(mediaCollapsedKey)==='1')$('workbench').classList.add('hide-media');}catch(error){}
$('toggleInspector').onclick=()=>{if(window.innerWidth<=760){$('inspector').classList.toggle('open');$('mediaPanel').classList.remove('open');}else{document.querySelector('.workbench').classList.toggle('hide-inspector');}};
for(const id of ['importMedia','importTop'])$(id).onclick=()=>pickImport();$('mediaFiles').onchange=e=>importFiles(e.target.files);
$('importWorkflow').onclick=()=>pickImport(false,true);$('poolSearch').oninput=renderBin;$('addShot').onclick=showShotPicker;
$('help').onclick=()=>showModal('Edit by pointing','<p>Click to select. Ctrl-click toggles clips; Shift-click selects a range on one track. Drag empty timeline space to box-select, or press Ctrl+A to select all. Drag selected clips to move them together; Alt-drag copies them at the drop position. Ctrl+D also duplicates the selection. Drag the clip to move it, a free edge to trim, or a shared cut to roll. The cursor shows what will happen. Your gesture stays fixed until you release it.</p><div class="shortcut-grid"><span>Enable / disable selected clips</span><kbd>Ctrl Shift D</kbd><span>Ripple an edge</span><kbd>Shift + drag</kbd><span>Slip source inside a clip</span><kbd>Hold S + drag</kbd><span>Slide between touching neighbors</span><kbd>Hold D + drag</kbd><span>Nudge held S/D, or selected cut</span><kbd>, / .</kbd><span>Five-frame nudge</span><kbd>Shift + , / .</kbd><span>Compare / single viewer during edit</span><kbd>C</kbd><span>Compare takes / close compare</span><kbd>C</kbd><span>Fullscreen viewer / fit picture</span><kbd>F / Shift F</kbd><span>Timeline zoom / fit</span><kbd>+ / − / Shift Z</kbd><span>Snap</span><kbd>N</kbd><span>Play / pause</span><kbd>Space</kbd><span>Previous / next frame</span><kbd>Left / Right</kbd><span>Previous / next take or edit</span><kbd>Up / Down</kbd><span>Review take 1–9</span><kbd>1–9</kbd><span>Use take</span><kbd>Enter</kbd><span>Source / Edit</span><kbd>Q</kbd><span>Cancel edit</span><kbd>Esc</kbd><span>Split at playhead</span><kbd>B</kbd><span>Delete, leaving space / close selected gap</span><kbd>Delete</kbd><span>Ripple delete</span><kbd>Shift + Delete</kbd><span>Undo / Redo</span><kbd>Ctrl Z / Ctrl Shift Z</kbd></div><p>Wheel over the viewer to zoom around the pointer, then drag to pan. Double-click the picture, click Fit, or press Shift+F to reset. F toggles fullscreen; Esc exits it. Compare opens two synchronized takes; select A or B, then click a take to replace that pane. Only the active pane plays audio. Enter uses its take. Timeline +/− or Ctrl+wheel zooms; Shift+Z fits.</p><p>A1 edits with its linked video; fade handles adjust fades. A2 moves and slips independently, and its shared cuts roll. A2 never ripples or slides with video edits.</p><p>Click a gap to select it, then Delete to close it. Drag dividers to resize panels or the timeline; double-click resets them.</p>');
let viewerExpanded=false,fullscreenPending=false,fullscreenWasNative=false;
function setViewerExpanded(expanded){viewerExpanded=expanded;const v=$('viewer');v.classList.toggle('expanded',expanded);$('fullscreen').title=expanded?'Exit fullscreen (F / Esc)':'Fullscreen viewer (F)';$('fullscreen').setAttribute('aria-label',expanded?'Exit fullscreen':'Fullscreen viewer');applyViewerZoom();(expanded?v:$('editor')).focus({preventScroll:true});}
function toggleViewerFullscreen(){
 finishViewerPan();setViewerExpanded(!viewerExpanded);
 if(!viewerExpanded){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});return;}
 // Desktop webviews manage fullscreen in their host; use the window-filling view there.
 if(document.fullscreenEnabled&&!navigator.userAgent.includes('Electron/')&&!fullscreenPending){fullscreenPending=true;$('viewer').requestFullscreen().then(()=>{fullscreenPending=false;if(!viewerExpanded&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});}).catch(()=>{fullscreenPending=false;});}
}
$('fullscreen').onclick=toggleViewerFullscreen;
$('compareTakes').onclick=$('compareTakesStrip').onclick=toggleTakeComparison;for(let i=0;i<2;i++){$('compareSelect'+i).onclick=()=>selectComparisonPane(i);$('comparePane'+i).addEventListener('pointerdown',e=>{if(e.button===0&&!e.target.closest('button'))selectComparisonPane(i);});$('compareImage'+i).addEventListener('load',applyViewerZoom);}
document.addEventListener('fullscreenchange',()=>{finishViewerPan();const full=document.fullscreenElement===$('viewer');if(full&&!viewerExpanded){document.exitFullscreen().catch(()=>{});return;}if(!full&&fullscreenWasNative)setViewerExpanded(false);fullscreenWasNative=full;applyViewerZoom();});
$('editor').addEventListener('keydown',e=>{
 if(workflowLocked)return;
 if(e.key==='Escape'&&viewerExpanded){e.preventDefault();e.stopPropagation();toggleViewerFullscreen();return;}
 if(e.key==='Escape'&&viewerPan){e.preventDefault();e.stopPropagation();finishViewerPan(true);return;}
 if(e.key==='Escape'&&drag){e.preventDefault();e.stopPropagation();cancelClipDrag();return;}
 if($('modalOverlay').hidden&&$('rendersPanel').contains(e.target)){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRenders();}return;}
 if(e.key==='Escape'&&!$('modalOverlay').hidden){e.stopPropagation();closeModal();return;}
 if(!$('modalOverlay').hidden){if(e.key==='Tab'){const nodes=[...$('modalOverlay').querySelectorAll('button:not(:disabled),input,a,iframe')].filter(n=>n.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}return;}
 if(e.target.closest('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]:not([contenteditable=false])')){clearHeld();return;}
 if(e.key==='Escape'){clearHeld();hideTrimPreview();if(!review.audition){selectedCut=null;setTimelineSelection([]);render();save();}if(review.audition)cancelAudition();else setViewMode('edit');$('mediaPanel').classList.remove('open');syncMediaRail();$('inspector').classList.remove('open');return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopPropagation();selectedCut=null;pause();editView();setTimelineSelection([...state.clips,...state.audioClips||[]].map(c=>c.id));selectionAnchor=state.selectedAudio||state.selected;render();save();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();e.stopPropagation();e.shiftKey?toggleSelectedEnabled():duplicate();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();e.stopPropagation();redo();return;}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?redo():undo();return;}
 if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&['s','d','shift'].includes(e.key.toLowerCase())&&!e.target.closest('input[type=range]')){const key=e.key.toLowerCase();if(!e.repeat){held[key]=true;refreshGestureHints(true);}e.preventDefault();e.stopPropagation();return;}
 if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='c'&&!$('trimViewButton').hidden){e.preventDefault();e.stopPropagation();toggleTrimView();return;}
 if(drag){if(e.key.toLowerCase()==='c'&&drag.moved){e.preventDefault();toggleTrimView();}else if(e.key!=='Shift')e.preventDefault();e.stopPropagation();return;}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(['i','o'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();setExportEdge(e.key.toLowerCase()==='i'?'start':'end',Math.round(state.frame));return;}
 if(e.key.toLowerCase()==='f'){e.preventDefault();e.stopPropagation();if(!e.repeat)e.shiftKey?resetViewerZoom():toggleViewerFullscreen();return;}
 if(e.key.toLowerCase()==='c'){e.preventDefault();e.stopPropagation();if(!e.repeat)toggleTakeComparison();return;}
 const key=editingKey(e);if(e.target.closest('input[type=range]')&&!['.',','].includes(key))return;if(['+','=','-','_'].includes(key)){e.preventDefault();e.stopPropagation();setTimelineZoom(state.zoom*(['+','='].includes(key)?1.25:.8));return;}if(key==='z'&&e.shiftKey){e.preventDefault();e.stopPropagation();fitTimeline();return;}if(key===','||key==='.'){e.preventDefault();e.stopPropagation();nudgeEdit((key===','?-1:1)*(e.shiftKey?5:1));return;}if(key==='n'){e.preventDefault();e.stopPropagation();$('snap').click();return;}if(![' ','arrowleft','arrowright','arrowup','arrowdown','home','end','b','delete','backspace','q','enter','1','2','3','4','5','6','7','8','9'].includes(key))return;if((key===' '||key==='enter')&&e.target.closest('button,a,[data-clip]'))return;e.stopPropagation();if(key===' '){e.preventDefault();play();}else if(key==='q')setViewMode(review.mode==='source'?'edit':'source');else if(key==='enter')useViewerTake();else if(/^[1-9]$/.test(key)){const c=selectedAudio()?null:selected(),t=T.realTakes(c)[Number(key)-1];if(t)viewTake(t.id,c);}else if(key==='arrowup'||key==='arrowdown'){e.preventDefault();const step=key==='arrowup'?-1:1;review.mode==='source'?flipTake(step):skip(step);}else if(key==='arrowleft'){e.preventDefault();frameStep(-1);}else if(key==='arrowright'){e.preventDefault();frameStep(1);}else if(key==='home'||key==='end'){e.preventDefault();pause();setFrame(key==='home'?0:review.mode==='source'&&review.source?sourceLength():total(),true);save();}else if(key==='b'){split();}else if(key==='delete'||key==='backspace'){e.preventDefault();remove(e.shiftKey);}
});
// Zoom is local to this view. Source retains its crop while flipping takes.
function freshViewerZoom(){return {edit:{scale:1,x:0,y:0},source:{scale:1,x:0,y:0}};}
let viewerZoom=freshViewerZoom(),viewerPan=null,viewSaveTimer=0;
try{const saved=JSON.parse(sessionStorage.getItem(VIEW_KEY))?.viewerZoom;for(const mode of ['edit','source'])if(saved?.[mode]){const z=saved[mode];viewerZoom[mode]={scale:clamp(Number(z.scale)||1,1,6),x:Number(z.x)||0,y:Number(z.y)||0};}}catch(error){}
function persistView(){try{sessionStorage.setItem(VIEW_KEY,JSON.stringify(viewState()));}catch(error){}}
function saveView(){clearTimeout(viewSaveTimer);viewSaveTimer=setTimeout(persistView,100);}
function viewerImageBox(element){
 const parent=element?.closest('.trim-frame')||$('viewerStage'),box=parent.getBoundingClientRect(),ratio=element?.videoWidth?element.videoWidth/element.videoHeight:element?.naturalWidth?element.naturalWidth/element.naturalHeight:16/9,width=Math.min(box.width,box.height*ratio),height=width/ratio;
 return {width,height,cx:box.left+box.width/2,cy:box.top+box.height/2};
}
function applyViewerZoom(){
 const z=viewerZoom[review.mode];z.scale=clamp(z.scale,1,6);z.x=clamp(z.x,-(z.scale-1)/2,(z.scale-1)/2);z.y=clamp(z.y,-(z.scale-1)/2,(z.scale-1)/2);if(z.scale<1.01)z.scale=1,z.x=z.y=0;
 for(const element of $('viewerStage').querySelectorAll(':scope>video:not(.take-scrub-preview),#still,.trim-frame video,.trim-frame img')){if(element.hidden||element.closest('.trim-frame')?.hidden)continue;const b=viewerImageBox(element);element.style.transform=z.scale===1?'':'translate('+z.x*b.width+'px,'+z.y*b.height+'px) scale('+z.scale+')';element.classList.toggle('zoomable',element.tagName==='VIDEO'||!element.hidden);}
 if(z.scale===1)releaseViewerPan();$('viewerStage').classList.toggle('zoomed',z.scale>1);$('viewerStage').classList.toggle('panning',!!viewerPan);$('viewerZoom').textContent=z.scale===1?'Fit':Math.round(z.scale*100)+'%';$('viewerZoom').title='Viewer '+(z.scale===1?'fit':Math.round(z.scale*100)+'%')+' · Wheel to zoom · Drag to pan · Double-click or Shift+F to fit';
}
function releaseViewerPan(){const p=viewerPan;viewerPan=null;const stage=$('viewerStage');if(p&&stage.hasPointerCapture(p.pointerId))stage.releasePointerCapture(p.pointerId);stage.classList.remove('panning');}
function resetViewerZoom(){releaseViewerPan();viewerZoom[review.mode]={scale:1,x:0,y:0};applyViewerZoom();saveView();}
function viewerZoomAt(scale,element,clientX,clientY){const z=viewerZoom[review.mode],b=viewerImageBox(element);if(!b.width||!b.height)return;scale=clamp(scale,1,6);z.x+=(z.scale-scale)*((clientX-b.cx)/b.width-z.x)/z.scale;z.y+=(z.scale-scale)*((clientY-b.cy)/b.height-z.y)/z.scale;z.scale=scale;applyViewerZoom();saveView();}
function viewerHit(e){if(e.target.closest('button')||!viewerData()||pointerBusy())return null;const frame=e.target.closest('.trim-frame');return frame?frame.querySelector('video:not([hidden]),img:not([hidden])'):shownVideo||(!$('still').hidden?$('still'):null);}
function setPreviewQuality(quality){
 const resume=playing;pause();hideTrimPreview();state.previewQuality=quality;
 previews.clear();
 shownVideo=null;for(const v of pool.values())releaseMedia(v);pool.clear();
 updateViewer(true);saveView();setStatus('Preview '+(quality==='full'?'Full':quality==='half'?'1/2':'1/4'));if(resume)play();
}
$('previewQuality').onchange=e=>setPreviewQuality(e.target.value);
// A failed preparation is retryable in place instead of for the rest of the session.
$('viewerResolution').title='Click to retry a failed playback preparation';
$('viewerResolution').addEventListener('click',()=>{const m=viewerData()?.media;if(m&&previews.retry(m)){updateViewer(true);setStatus('Retrying playback preparation');}});
$('viewerZoom').onclick=resetViewerZoom;for(const id of ['still','trimImage0','trimImage1','trimImage2','trimImage3'])$(id).addEventListener('load',applyViewerZoom);
$('viewerStage').addEventListener('wheel',e=>{const element=viewerHit(e);if(!element)return;e.preventDefault();e.stopPropagation();finishViewerPan();const unit=e.deltaMode===1?16:e.deltaMode===2?$('viewerStage').clientHeight:1;clearTimeout(trimPreviewTimer);viewerZoomAt(viewerZoom[review.mode].scale*Math.exp(-e.deltaY*unit*.0015),element,e.clientX,e.clientY);},{passive:false});
$('viewerStage').addEventListener('pointerdown',e=>{const element=viewerHit(e),z=viewerZoom[review.mode];if(!element||e.button!==0||z.scale<=1)return;e.preventDefault();e.stopPropagation();$('editor').focus({preventScroll:true});clearTimeout(trimPreviewTimer);viewerPan={pointerId:e.pointerId,x:e.clientX,y:e.clientY,original:copy(z),box:viewerImageBox(element),mode:review.mode};$('viewerStage').setPointerCapture(e.pointerId);applyViewerZoom();});
$('viewerStage').addEventListener('pointermove',e=>{if(!viewerPan||viewerPan.pointerId!==e.pointerId)return;const p=viewerPan,z=viewerZoom[p.mode];z.x=p.original.x+(e.clientX-p.x)/p.box.width;z.y=p.original.y+(e.clientY-p.y)/p.box.height;applyViewerZoom();});
function finishViewerPan(cancel=false){if(!viewerPan)return;if(cancel)viewerZoom[viewerPan.mode]=viewerPan.original;releaseViewerPan();applyViewerZoom();saveView();}
for(const event of ['pointerup','lostpointercapture'])$('viewerStage').addEventListener(event,()=>finishViewerPan());
$('viewerStage').addEventListener('pointercancel',()=>finishViewerPan(true));
$('viewerStage').addEventListener('dblclick',e=>{if(!viewerHit(e))return;e.preventDefault();resetViewerZoom();});
interruptions.on(()=>finishViewerPan(true));
const viewerObserver=new ResizeObserver(()=>applyViewerZoom());viewerObserver.observe($('viewerStage'));
function setTimelineZoom(value,anchor=state.frame,pixel=null){
 if(pointerBusy())return;const sc=$('timelineScroll');if(pixel===null){const x=anchor*ppf-sc.scrollLeft;pixel=x>=0&&x<=sc.clientWidth?x:sc.clientWidth/2;if(x<0||x>sc.clientWidth)anchor=(sc.scrollLeft+pixel)/ppf;}
 state.zoom=Math.round(clamp(value,100,1600));$('zoom').value=state.zoom;renderTimeline();sc.scrollLeft=anchor*ppf-pixel;updateViewer();saveView();
}
function fitTimeline(){if(drag)return;state.zoom=100;$('zoom').value=100;$('timelineScroll').scrollLeft=0;renderTimeline();updateViewer();saveView();}
$('zoomOut').onclick=()=>setTimelineZoom(state.zoom/1.25);
$('zoomIn').onclick=()=>setTimelineZoom(state.zoom*1.25);

const resizeObserver=new ResizeObserver(()=>{renderTimeline();updateViewer();});resizeObserver.observe($('timelineScroll'));
$('editor').addEventListener('click',e=>{if(e.detail&&e.target.closest('button')&&!e.target.closest('.modal,.topbar,[role=tablist]')&&$('modalOverlay').hidden)$('editor').focus({preventScroll:true});});
document.querySelectorAll('[role=tablist]').forEach(list=>list.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const tabs=[...list.querySelectorAll('[role=tab]:not(:disabled)')],index=tabs.indexOf(e.target),next=tabs[(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];next?.click();next?.focus({preventScroll:true});}));
for(const id of ['seek','zoom'])$(id).addEventListener('pointerup',()=>$('editor').focus({preventScroll:true}));
$('editor').addEventListener('pointerdown',e=>{if(!e.target.closest('button,a,input,textarea,select,[contenteditable]'))$('editor').focus({preventScroll:true});});
$('emptyStage').innerHTML='<div class="welcome-empty"><span class="empty-symbol">'+svg('timeline')+'</span><strong>Build your first sequence</strong><p>Start with footage or a Comfy workflow.<br>Arrange clips, generate takes, and choose your edit.</p><div class="empty-actions"><button class="primary" id="emptyImport">'+svg('import')+'Import footage</button><button class="outline" id="emptyWorkflow">'+svg('plus')+'Add workflow</button></div><small>Or drop files onto the timeline</small></div><span class="gap-empty">No picture at the playhead</span>';
$('emptyImport').onclick=()=>pickImport(true);$('emptyWorkflow').onclick=()=>pickImport(true,true);
{
 $('editor').classList.add('full-editor');setBinTab('workflows');
 $('editor').append($('mediaPanel'));$('editor').classList.add('studio-sidebar');
 const settings=document.createElement('div');settings.className='viewer-settings';settings.append($('viewerZoom'),$('previewQuality'));
 $('viewer').querySelector('.viewer-meta').prepend(settings,$('monitorMute'));
 document.querySelector('.tools').append(document.querySelector('.history-tools'));
}
const inspectorHeightKey=VIEW_KEY+':inspector-height:full';
let inspectorFull=true;try{inspectorFull=localStorage.getItem(inspectorHeightKey)!=='viewer';}catch(error){}
const inspectorHeightButton=document.createElement('button');inspectorHeightButton.id='inspectorHeight';inspectorHeightButton.className='outline inspector-height';inspectorHeightButton.textContent='Full height';inspectorHeightButton.setAttribute('aria-label','Full height inspector');$('inspector').querySelector('.inspector-head').insertBefore(inspectorHeightButton,$('openWorkflow'));
function applyInspectorHeight(){
 const panel=$('inspector');(inspectorFull?$('editor'):$('workbench')).append(panel);$('editor').classList.toggle('inspector-full',inspectorFull);inspectorHeightButton.setAttribute('aria-pressed',inspectorFull);inspectorHeightButton.title=inspectorFull?'Switch inspector to viewer height':'Extend inspector beside viewer and timeline';
}
applyInspectorHeight();inspectorHeightButton.onclick=()=>{inspectorFull=!inspectorFull;try{localStorage.setItem(inspectorHeightKey,inspectorFull?'full':'viewer');}catch(error){}applyInspectorHeight();applyPanelWidths();};
const panelWidths={media:null,inspector:null};let panelDrag=null;
const panelKey=name=>VIEW_KEY+':'+name+':full';
for(const name of Object.keys(panelWidths)){try{const saved=Number(sessionStorage.getItem(panelKey(name)));if(Number.isFinite(saved)&&saved>0)panelWidths[name]=saved;}catch(error){}}
function panelBounds(name){
 const available=$('editor').clientWidth-20;
 const width=available,drawer=name==='media'?innerWidth<=1100:innerWidth<=760;
 let max;
 if(drawer)max=width-24;
 else{const other=$(name==='media'?'inspector':'mediaPanel'),takes=$('takes').getBoundingClientRect(),occupied=getComputedStyle(other).display!=='none'&&getComputedStyle(other).position!=='absolute'?other.getBoundingClientRect().width:0,rail=takes.width&&Math.abs(takes.top-$('viewer').getBoundingClientRect().top)<2?takes.width:0;max=width-320-occupied-rail;}
 max=Math.max(0,max);
 return {min:Math.min(name==='media'?160:240,max),max};
}
function applyPanelWidths(){
 for(const name of ['media','inspector']){
  const bounds=panelBounds(name),value=panelWidths[name],sized=value!==null,handle=$(name+'Resize'),panel=$(name==='media'?'mediaPanel':'inspector');
  if(name==='inspector')$('workbench').classList.toggle('inspector-sized',sized);
  if(sized)$('editor').style.setProperty('--'+name+'-width',clamp(value,bounds.min,bounds.max)+'px');else $('editor').style.removeProperty('--'+name+'-width');
  handle.setAttribute('aria-valuemin',Math.round(bounds.min));handle.setAttribute('aria-valuemax',Math.round(bounds.max));handle.setAttribute('aria-valuenow',Math.round(panel.getBoundingClientRect().width));
 }
}
function storePanelWidth(name){try{if(panelWidths[name]===null)sessionStorage.removeItem(panelKey(name));else sessionStorage.setItem(panelKey(name),panelWidths[name]);}catch(error){}}
function endPanelResize(cancel=false){
 if(!panelDrag)return;const done=panelDrag;panelDrag=null;
 if(cancel){panelWidths[done.name]=done.initial;applyPanelWidths();}
 $('editor').classList.remove('resizing-panels');storePanelWidth(done.name);
}
for(const name of Object.keys(panelWidths)){
 const handle=$(name+'Resize'),panel=$(name==='media'?'mediaPanel':'inspector'),direction=name==='media'?1:-1;
 handle.onpointerdown=e=>{
  if(e.button!==0||drag||trackResize)return;
  e.preventDefault();e.stopPropagation();handle.focus({preventScroll:true});
  panelDrag={name,x:e.clientX,width:panel.getBoundingClientRect().width,initial:panelWidths[name],...panelBounds(name)};
  handle.setPointerCapture(e.pointerId);$('editor').classList.add('resizing-panels');
 };
 handle.onpointermove=e=>{if(!panelDrag||panelDrag.name!==name)return;e.stopPropagation();panelWidths[name]=Math.round(clamp(panelDrag.width+(e.clientX-panelDrag.x)*direction,panelDrag.min,panelDrag.max));applyPanelWidths();};
 handle.onpointerup=e=>{e.stopPropagation();endPanelResize();};handle.onpointercancel=()=>endPanelResize(true);handle.onlostpointercapture=()=>endPanelResize();
 handle.ondblclick=e=>{e.preventDefault();e.stopPropagation();panelWidths[name]=null;applyPanelWidths();storePanelWidth(name);};
 handle.onkeydown=e=>{
  e.stopPropagation();if(e.key==='Escape'){e.preventDefault();endPanelResize(true);return;}
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();const bounds=panelBounds(name),width=panel.getBoundingClientRect().width;
  panelWidths[name]=e.key==='Home'?bounds.min:e.key==='End'?bounds.max:clamp(width+(e.key==='ArrowRight'?1:-1)*direction*(e.shiftKey?40:12),bounds.min,bounds.max);
  applyPanelWidths();storePanelWidth(name);
 };
}
const panelObserver=new ResizeObserver(applyPanelWidths);panelObserver.observe($('workbench'));
interruptions.on(()=>endPanelResize(true));
$('toggleMedia').addEventListener('click',applyPanelWidths);$('toggleInspector').addEventListener('click',applyPanelWidths);
applyPanelWidths();


function selectedAudio(){return (state.audioClips||[]).find(c=>c.id===state.selectedAudio);}
const audioSettings=T.audioSettings;
const trackAudible=track=>T.trackAudible(state,track);
const audioEnvelope=T.audioEnvelope;
function audioWave(c,m){const length=c.out-c.in,a=audioSettings(c),level=clamp((a.gainDb+60)/66,0,1);return (m.wave?'<img src="'+esc(url(m.wave))+'" alt="" style="width:'+m.frames/length*100+'%;left:'+-c.in/length*100+'%">':'')+'<span class="audio-gain-line" style="top:'+(100-level*75)+'%"></span><svg class="audio-fade" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 100L'+a.fadeIn/length*100+' 0M'+(100-a.fadeOut/length*100)+' 0L100 100" stroke="#a7e4be" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/></svg><div class="audio-fade-handle in" data-fade="in" style="left:'+a.fadeIn/length*100+'%" title="Drag fade in"></div><div class="audio-fade-handle out" data-fade="out" style="right:'+a.fadeOut/length*100+'%" title="Drag fade out"></div>';}
function renderAudioTimeline(rows,refresh=true){
 const independent=track=>(state.audioClips||[]).filter(c=>T.audioTrack(c)===track&&(track!=='source'||!T.sourceTrackHidden(state,T.sourceLane(c)))).map(c=>'<div class="audio-clip music-clip'+(!T.enabled(c)||audioSettings(c).muted||!trackAudible(track)?' muted':'')+'" data-audio="'+c.id+'" style="top:calc('+(track==='source'?'var(--source-top-'+T.sourceLane(c)+')':'0px')+' + 5px);height:calc('+(track==='source'?'var(--source-height-'+T.sourceLane(c)+')':'var(--music-height)')+' - 10px);left:'+c.start*ppf+'px;width:'+(c.out-c.in)*ppf+'px" tabindex="0" role="button" aria-pressed="false" aria-label="'+esc(c.name)+' independent audio clip" title="Independent audio: drag to move; drag edges to trim">'+audioWave(c,c.media)+'<span class="audio-name"><span class="audio-title">'+esc(c.name)+'</span>'+clipAttention(c,false)+'</span><div class="trim-handle in" data-audio-trim="in"></div><div class="trim-handle out" data-audio-trim="out"></div></div>').join('');
 draw('audioLane',Array.from({length:T.videoTracks(state)},(_,i)=>{const track=T.videoTracks(state)-i;return '<div class="audio-track-lane" style="top:var(--source-top-'+track+');height:var(--source-height-'+track+')"></div>';}).join('')+rows.filter(r=>!r.clip.audioDetached&&!T.sourceTrackHidden(state,T.videoTrack(r.clip))).map(({clip:c,start})=>{const m=take(c).media,muted=!T.videoEnabled(state,c)||audioSettings(c).muted||!trackAudible('source');return '<div class="audio-clip '+(!m.audio?'no-audio':'')+(muted?' muted':'')+'" data-linked-audio="'+c.id+'" style="top:calc(var(--source-top-'+T.videoTrack(c)+') + 5px);height:calc(var(--source-height-'+T.videoTrack(c)+') - 10px);left:'+start*ppf+'px;width:'+(c.out-c.in)*ppf+'px" title="'+esc(c.name)+' - audio linked to video">'+(m.audio?audioWave(c,m)+'<span class="audio-name">'+svg('link')+' '+esc(c.name)+'</span>':'<span class="no-audio-label">No audio</span>')+'</div>';}).join('')+independent('source'));
 $('audioLane').querySelectorAll('[data-linked-audio]').forEach(n=>{if(n.classList.contains('no-audio'))return;if(!n.querySelector('[data-trim]'))n.insertAdjacentHTML('beforeend','<div class="trim-handle in" data-trim="in"></div><div class="trim-handle out" data-trim="out"></div>');n.onpointerdown=e=>e.target.closest('[data-fade]')?startFadeDrag(e,n.dataset.linkedAudio,false):startClipDrag(e,n.dataset.linkedAudio);});
 draw('musicLane',independent('music')||'<button class="music-empty" id="musicEmpty">+ Add audio - or drop an audio or video file here</button>');
 for(const lane of ['audioLane','musicLane'])$(lane).querySelectorAll('[data-audio]').forEach(n=>{n.onpointerdown=e=>e.target.closest('[data-fade]')?startFadeDrag(e,n.dataset.audio,true):startAudioDrag(e,n.dataset.audio);n.onkeydown=e=>{if(e.key==='Enter'){selectAudio(n.dataset.audio,e);e.preventDefault();}};});
 if($('musicEmpty'))$('musicEmpty').onclick=()=>$('audioFiles').click();
 syncTimelineSelection();if(refresh)refreshGestureHints();
}
function renderAudioInspector(){
 const c=selectedAudio()||selected(),bed=!!selectedAudio();$('clipName').value=c?.name||'Audio';$('generateLabel').textContent=selected()?'Generate '+selected().count+' takes':'Generate takes';
 if(!c){draw('inspectorContent','<p class="audio-note">Import music or voiceover to A2. Audio follows the sequence clock, independently of the video edit.</p>');return;}
 if(!bed&&c.audioDetached){draw('inspectorContent','<div class="group-label">Video only</div><p class="audio-note">Audio has been unlinked. Select its separate clip on A1 to adjust it.</p>');return;}
 const m=bed?c.media:take(c).media,a=audioSettings(c),max=(c.out-c.in)/fps/2;
 const html='<div class="group-label">'+(bed?(T.audioTrack(c)==='source'?'Independent clip audio':'Soundtrack'):'Linked clip audio')+'<span>'+svg(bed?'audio':'link')+'</span></div><p class="audio-summary">'+seconds(c.out-c.in)+' · '+(bed?'at '+tc(c.start):takeName(take(c)))+'</p>'+(m.audio?'<div class="audio-controls"><div><label class="field"><span class="audio-level-head">Level <input id="audioGainNumber" type="number" min="-60" max="6" step="1" value="'+a.gainDb+'" aria-label="Audio level in decibels"></span><input id="audioGain" type="range" min="-60" max="6" step="1" value="'+a.gainDb+'" aria-label="Audio level"><span class="small">dB · double-click slider to reset</span></label><button class="outline'+(a.muted?' active':'')+'" id="clipAudioMute" aria-pressed="'+a.muted+'">'+svg(a.muted?'mute':'volume')+(a.muted?'Clip muted':'Mute this clip')+'</button></div><div class="two-fields"><label class="field"><span>Fade in (s)</span><input id="audioFadeIn" type="number" min="0" max="'+max+'" step=".1" value="'+(a.fadeIn/fps).toFixed(2)+'"></label><label class="field"><span>Fade out (s)</span><input id="audioFadeOut" type="number" min="0" max="'+max+'" step=".1" value="'+(a.fadeOut/fps).toFixed(2)+'"></label></div><div><p class="audio-note">'+(bed?'Audio stays at its timeline position when the video edit ripples. Trim or move this clip directly on its audio track.':'This is the chosen take\'s audio. Video trims, rolls, and slips keep it in sync. Unlink audio and video to edit them independently.')+'</p><p class="audio-note">Track M/S buttons change the saved mix. Monitor mute only changes what you hear.</p></div></div>':'<p class="audio-note">This take has no audio. Import music or voiceover to the soundtrack lane.</p><button class="outline" id="audioAdd">'+svg('import')+' Import audio</button>');
 if(!draw('inspectorContent',html))return;if($('audioAdd'))$('audioAdd').onclick=()=>$('audioFiles').click();if(!m.audio)return;
 const commit=(key,value,label)=>{const clip=selectedAudio()||selected(),current=audioSettings(clip);if(current[key]===value)return;edits.apply(label,()=>{clip.audio={...current,[key]:value};},'audio');};
 const gain=$('audioGain');gain.onpointerup=()=>$('editor').focus({preventScroll:true});let before=null;gain.oninput=()=>{const clip=selectedAudio()||selected();if(!clip)return;if(!before)before=copy(state);clip.audio={...audioSettings(clip),gainDb:Number(gain.value)};$('audioGainNumber').value=gain.value;syncAudio();};gain.onchange=()=>{const clip=selectedAudio()||selected(),original=clip&&[...before?.audioClips||[],...before?.clips||[]].find(x=>x.id===clip.id);if(original&&audioSettings(original).gainDb!==Number(gain.value))history.record(before,'Adjust '+clip.name+' audio level');before=null;renderAudioTimeline(layout());save();buttons();};gain.ondblclick=()=>{commit('gainDb',0,'Reset audio level');renderInspector();};
 $('audioGainNumber').onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)){renderInspector();return;}commit('gainDb',clamp(value,-60,6),'Adjust audio level');renderInspector();};
 for(const [id,key] of [['audioFadeIn','fadeIn'],['audioFadeOut','fadeOut']])$(id).onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)){renderInspector();return;}commit(key,clamp(Math.round(value*fps),0,Math.floor((c.out-c.in)/2)),'Adjust '+(key==='fadeIn'?'fade in':'fade out'));renderInspector();};
 $('clipAudioMute').onclick=()=>{const clip=selectedAudio()||selected();if(!clip)return;commit('muted',!audioSettings(clip).muted,(audioSettings(clip).muted?'Unmute ':'Mute ')+clip.name);renderInspector();};
}
function selectAudio(id,modifiers={},preserve=false){hideTrimPreview();selectedCut=null;nudgeGroup=null;pause();editView();selectTimelineItem(id,modifiers,preserve);const c=selectedAudio();if(c){review.rememberMedia(c.media,c.in);inspectorTab='audio';}renderInspector();renderTimeline();buttons();$('editor').focus({preventScroll:true});saveView();}
function addAudioClip(m,start=Math.round(state.frame),track='music',lane=activeVideoTrack){if(!m||!m.audio){toast('This file has no audio stream');return;}pause();edits.apply('Add '+m.name+' audio',()=>{const c=T.addAudioClip(state,m,start,'audio-'+crypto.randomUUID(),{track,fullLength:true,lane});state.selectedAudio=c.id;review.rememberMedia(c.media,c.in);inspectorTab='audio';editView();});toast('Audio added to '+(track==='source'?'A1':'A2')+' · unmute the monitor to listen');}
function splitAudio(){const c=selectedAudio(),offset=Math.round(state.frame-c.start);if(!c||offset<6||offset>c.out-c.in-6){toast('Place the playhead inside the audio clip, away from its edges');return;}edits.apply('Split audio',()=>{pause();const d=T.splitAudio(state,state.frame,'audio-'+crypto.randomUUID(),c.id);state.selectedAudio=d.id;});}
function startFadeDrag(e,id,bed){if(e.button!==0||pointerBusy())return;if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();bed?selectAudio(id,e):selectClip(id,false,e);return;}setTimelineSelection([id]);selectedCut=null;nudgeGroup=null;hideTrimPreview();e.preventDefault();e.stopPropagation();pause();editView();const c=(bed?state.audioClips:state.clips).find(x=>x.id===id);if(!c)return;inspectorTab='audio';drag={kind:'fade',side:e.target.closest('[data-fade]').dataset.fade,id,bed,startX:e.clientX,before:copy(state),original:copy(c),scale:ppf,moved:false};$('timelineScroll').setPointerCapture(e.pointerId);$('editor').style.setProperty('--active-edit-cursor','ew-resize');$('editor').classList.add('editing-clip');$('editor').focus({preventScroll:true});renderInspector();renderTimeline();}
function moveFadeDrag(e){const d=drag,c=(d.bed?state.audioClips:state.clips).find(x=>x.id===d.id),a=audioSettings(d.original),key=d.side==='in'?'fadeIn':'fadeOut';if(Math.abs(e.clientX-d.startX)<4&&!d.moved)return;d.moved=true;const value=clamp(a[key]+Math.round((e.clientX-d.startX)/d.scale)*(d.side==='in'?1:-1),0,Math.floor((c.out-c.in)/2));if(value!==audioSettings(c)[key])c.audio={...audioSettings(c),[key]:value};renderAudioTimeline(layout());const field=$(d.side==='in'?'audioFadeIn':'audioFadeOut');if(field)field.value=(value/fps).toFixed(2);setStatus('Fade '+d.side+' '+(value/fps).toFixed(2)+'s');}
function startAudioDrag(e,id){
 if(e.button!==0||pointerBusy())return;const edge=e.target.closest('[data-audio-trim]')?.dataset.audioTrim||null;if(!edge&&(e.ctrlKey||e.metaKey||e.shiftKey)){e.preventDefault();$('editor').focus({preventScroll:true});selectAudio(id,e);return;}const collapseSelection=!edge&&selectionIds().includes(id)&&selectionIds().length>1;selectTimelineItem(id,{},!edge);hideTrimPreview();e.preventDefault();$('editor').focus({preventScroll:true});pause();editView();nudgeGroup=null;inspectorTab='audio';const c=selectedAudio(),peer=edge&&audioNeighbor(c,edge);selectedCut=peer?{id,edge,audio:true}:null;
 const ids=selectionIds().slice();drag={...T.beginEdit(state,{id,audio:true,kind:'audio',edge,peer,snapEnabled:state.snap,snapTolerance:T.SNAP_PIXELS/ppf}),ids,group:ids.length>1,collapseSelection,shared:!!peer,startX:e.clientX,scale:ppf,moved:false};if(drag.group)drag.snapPoints=T.snapPoints(state,ids);$('timelineScroll').setPointerCapture(e.pointerId);renderInspector();renderTimeline();buttons();
}

function moveAudioDrag(e){
 const d=drag;if(d.operation==='pending'){if(Math.abs(e.clientX-d.startX)<4)return;const a=clipGesture({id:d.id,audio:true,edge:d.edge,shared:d.shared},e.shiftKey||held.shift,e.altKey||held.alt);if(a.blocked){toast(a.blocked);cancelClipDrag();return;}d.operation=a.mode==='roll'?'roll':a.kind;d.mode=a.mode;d.moved=true;if(a.mode==='copy'){d.kind='move';copyDragSelection();moveSelectedGroup(e);return;}$('editor').style.setProperty('--active-edit-cursor',a.kind==='move'?'grabbing':gestureCursor(a));$('editor').classList.add('editing-clip');}
 if(d.group&&d.operation==='move'){moveSelectedGroup(e);return;}if(d.group){setTimelineSelection([d.id]);d.group=false;renderInspector();}
 const delta=Math.round((e.clientX-d.startX)/d.scale),applied=T.applyEdit(state,d,delta);d.applied=applied;renderTimeline();updateViewer(true);setStatus(editActions[d.mode].name+' audio '+(applied>=0?'+':'')+applied+'f · video stays fixed'+(applied!==delta?' · limit reached':''));
}
function ensureAudioContext(){if(!audioContext){audioContext=new AudioContext();masterGain=audioContext.createGain();audioAnalyser=audioContext.createAnalyser();audioAnalyser.fftSize=256;masterGain.connect(audioAnalyser);const limiter=audioContext.createDynamicsCompressor();limiter.threshold.value=-1;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.005;limiter.release.value=.05;audioAnalyser.connect(limiter);limiter.connect(audioContext.destination);masterGain.gain.value=state.muted?0:1;}if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});}
function setAudioGain(element,gain){if(audioContext){if(!element.mixGain){element.mixGain=audioContext.createGain();element.mixSource=audioContext.createMediaElementSource(element);element.mixSource.connect(element.mixGain);element.mixGain.connect(masterGain);}element.muted=state.muted||!gain;element.volume=1;element.mixGain.gain.value=gain;}else{element.muted=state.muted||!gain;element.volume=clamp(gain,0,1);}}
function releaseMedia(element){element.pause();element.onloadedmetadata=element.onseeked=element.onloadeddata=element.oncanplay=element.onerror=null;element.mixSource?.disconnect();element.mixGain?.disconnect();element.removeAttribute('src');element.load();element.remove();}
function audioFor(id,m){const source=m.fps?reviewSource(m):{file:m.file,offset:0};if(source.pending){void source.pending.catch(error=>toast(error.message));return null;}let a=audioPlayers.get(id);if(a&&a.dataset.file===source.file){a.dataset.sourceOffset=source.offset;return a;}if(a)releaseMedia(a);a=document.createElement('audio');a.preload='auto';a.crossOrigin='anonymous';a.src=url(source.file);a.dataset.file=source.file;a.dataset.sourceOffset=source.offset;a.onloadedmetadata=()=>{if(a.seekTarget!==undefined)seekVideo(a,a.seekTarget);};a.onseeked=()=>{if(a.seekPending){a.seekPending=false;seekVideo(a,a.seekTarget);}};audioPlayers.set(id,a);return a;}
function syncAudio(d=viewerData()){
 const compared=comparisonTakes(),monitor=compared?$('comparePane'+review.comparison.active).querySelector('video:not([hidden])'):shownVideo;
 const waitingImage=d?.media.kind==='image'&&!compared&&($('still').hidden||!$('still').complete);
 const running=playing&&!waitingImage&&(d?.media.kind!=='video'||shownVideo&&!shownVideo.paused&&!shownVideo.seeking&&shownVideo.readyState>=3);
 for(const v of pool.values())if(v!==monitor)setAudioGain(v,0);
 if(monitor){const gain=compared&&review.frame>=compared[review.comparison.active].media.frames?0:review.mode==='source'?1:0;setAudioGain(monitor,d?.media.audio?gain:0);}
 const active=new Set();if(d&&review.mode==='source'&&d.media.kind==='audio'){const key='source:'+d.media.file,a=audioFor(key,d.media);if(a){active.add(key);setAudioGain(a,1);}}
 if(review.mode==='edit')for(const c of [...(state.audioClips||[]),...layout().filter(r=>T.videoEnabled(state,r.clip)&&T.linkedAudio(r.clip)).map(r=>({...r.clip,id:'linked:'+r.clip.id,media:(review.audition?.clipId===r.clip.id?r.clip.takes.find(t=>t.id===review.audition.takeId):take(r.clip)).media,start:r.start,track:'source'}))]){const elapsed=state.frame-c.start,key=c.id;if(!T.enabled(c)||elapsed<0||elapsed>=c.out-c.in)continue;const a=audioFor(key,c.media);if(!a)continue;active.add(key);setAudioGain(a,trackAudible(T.audioTrack(c))?audioEnvelope(c,elapsed):0);const time=(c.in+elapsed)/fps;if(!running||Math.abs(videoTime(a)-time)>.12)seekVideo(a,time);if(running&&a.paused)a.play().catch(()=>{});else if(!running&&!a.paused)a.pause();}
 for(const [id,a] of audioPlayers)if(!active.has(id)){a.pause();if(a.mixGain)a.mixGain.gain.value=0;else a.muted=true;if(!id.startsWith('source:')&&!(state.audioClips||[]).some(c=>c.id===id)||audioPlayers.size>12){releaseMedia(a);audioPlayers.delete(id);}}
 if(audioAnalyser&&playing){const samples=new Float32Array(audioAnalyser.fftSize);audioAnalyser.getFloatTimeDomainData(samples);const peak=samples.reduce((n,v)=>Math.max(n,Math.abs(v)),0),db=peak?20*Math.log10(peak):-60;$('mixLevel').style.height=clamp((db+60)/60,0,1)*100+'%';$('mixMeter').classList.toggle('clipping',peak>=.99);$('mixMeter').title='Monitor peak: '+(peak?db.toFixed(1)+' dBFS':'silent')+(state.muted?' · monitor muted':'');}
}

function hideTrimPreview(keepViewer=false){if(!keepViewer)lastTrimEdit=null;if(!keepViewer)$('trimViewButton').hidden=true;clearTimeout(trimPreviewTimer);$('trimPreview').hidden=true;if(!keepViewer)$('editor').classList.remove('trim-active');for(let i=0;i<4;i++)$('trimVideo'+i).pause();}
function setTrimFrame(index,media,frame,label){
 const v=$('trimVideo'+index),img=$('trimImage'+index),empty=$('trimEmpty'+index);$('trimLabel'+index).textContent=label;$('trimTime'+index).textContent=media?tc(frame):'';
 empty.hidden=!!media;img.hidden=true;v.hidden=media?.kind!=='video';
 if(!media){v.pause();return;}
 if(media.kind==='video'){
  const file=previewFile(media);if(!file){v.pause();v.hidden=true;return;}if(v.dataset.file!==file){v.dataset.file=file;videoSource(v,media);v.muted=true;v.onloadedmetadata=()=>{seekVideo(v,v.seekTarget||0);applyViewerZoom();};v.onseeked=()=>{if(v.seekPending){v.seekPending=false;seekVideo(v,v.seekTarget);}};}videoTiming(v,media);
  seekVideo(v,frame/fps);
 }else{const file=previewFile(media);img.hidden=!file;if(file)img.src=file;}
}
function updateTrimPreview(d,delta){
 lastTrimEdit={d,delta};
 $('trimViewButton').hidden=false;$('trimViewButton').textContent=trimSingle?'Compare':'Single';
 $('editor').classList.add('trim-active');if(trimSingle){hideTrimPreview(true);return;}const index=state.clips.findIndex(c=>c.id===d.id),c=state.clips[index];if(!c){hideTrimPreview();return;}
 const clips=T.trackClips(state,T.videoTrack(c)),laneIndex=clips.indexOf(c),prev=laneIndex>0&&!c.gapBefore?clips[laneIndex-1]:null,next=laneIndex+1<clips.length&&!gapAfter(index)?clips[laneIndex+1]:null,four=['slip','slide'].includes(d.kind);
 $('trimPreview').hidden=false;$('trimGrid').classList.toggle('two',!four);$('trimPreviewTitle').textContent=editActions[d.mode].name+' · '+c.name;$('trimDelta').textContent=(delta>=0?'+':'')+delta+'f';
 for(let i=0;i<4;i++)$('trimFrame'+i).hidden=!four&&i>1;
 if(four){setTrimFrame(0,take(c).media,c.in,'In · '+c.name);setTrimFrame(1,take(c).media,c.out-1,'Out · '+c.name);setTrimFrame(2,prev&&take(prev).media,prev?prev.out-1:0,prev?'Previous · '+prev.name:'Previous · Gap');setTrimFrame(3,next&&take(next).media,next?next.in:0,next?'Next · '+next.name:'Next · Gap');}
 else if(d.kind==='in'){setTrimFrame(0,prev&&take(prev).media,prev?prev.out-1:0,prev?'Outgoing · '+prev.name:'Outgoing · Gap');setTrimFrame(1,take(c).media,c.in,'Incoming · '+c.name);}
 else{setTrimFrame(0,take(c).media,c.out-1,'Outgoing · '+c.name);setTrimFrame(1,next&&take(next).media,next?next.in:0,next?'Incoming · '+next.name:'Incoming · Gap');}
 applyViewerZoom();
}
function nudgeEdit(frames){
 const audio=selectedAudio(),c=audio||selected();if(!c||!held.s&&!held.d&&!selectedCut){nudgeGroup=null;frameStep(frames);return;}
 const target={id:c.id,audio:!!audio,edge:!held.s&&!held.d?selectedCut?.edge:null,shared:!!selectedCut},a=clipGesture(target,false);if(a.blocked){toast(a.blocked);return;}
 pause();editView();const d=T.beginEdit(state,{id:c.id,audio:!!audio,kind:a.kind,mode:a.mode,edge:target.edge,peer:audio&&target.edge?audioNeighbor(c,target.edge):null,snapEnabled:state.snap,snapTolerance:T.SNAP_PIXELS/ppf}),before=d.before;
 if(audio){d.operation=a.mode==='roll'?'roll':a.kind;d.edge=target.edge;d.peer=target.edge&&copy(audioNeighbor(c,target.edge));}
 const delta=T.applyEdit(state,d,frames);if(!delta){toast('Source limit reached');return;}
 const key=c.id+':'+a.mode+':'+a.kind;if(nudgeGroup!==key){history.record(before,editActions[a.mode].name+' '+c.name);nudgeGroup=key;}else redoStack.length=0;
 renderTimeline();updateViewer(true);if(!audio){updateTrimPreview(d,delta);clearTimeout(trimPreviewTimer);trimPreviewTimer=setTimeout(hideTrimPreview,1500);}save();buttons();setStatus(editActions[a.mode].name+' '+(delta>=0?'+':'')+delta+'f');
}
// Gestures are chosen at the drag threshold; held keys never become saved tools.
const clipGesture=(target,shift=held.shift,alt=held.alt)=>T.resolveGesture(state,target,{...held,shift,alt});
const cursorCache={};
function gestureCursor(a){
 if(a.blocked)return 'not-allowed';if(a.kind==='move')return a.mode==='copy'?'copy':'grab';
 const key=a.mode+':'+a.kind;if(cursorCache[key])return cursorCache[key];
 const shape=a.mode==='roll'?'M10 5v14M14 5v14M6 9l-3 3 3 3M18 9l3 3-3 3M3 12h18':a.mode==='slip'?'M4 5v14M20 5v14M8 9l-3 3 3 3M16 9l3 3-3 3M5 12h14':a.mode==='slide'?'M8 5h8v14H8zM5 9l-3 3 3 3M19 9l3 3-3 3':a.kind==='in'?'M12 4H8v16h4M16 9l-3 3 3 3':'M12 4h4v16h-4M8 9l3 3-3 3';
 const ripple=a.mode==='ripple'?'M3 3h3M3 21h3M18 3h3M18 21h3':'';
 const body='<path d="'+shape+ripple+'"/>';
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">'+body+'</g><g fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+body+'</g></svg>';
 return cursorCache[key]='url("data:image/svg+xml,'+encodeURIComponent(svg)+'") 12 12, ew-resize';
}
const audioNeighbor=(c,edge)=>T.audioNeighbor(state,c,edge);
function hoverIdentity(node,edge){const audio=!!node.dataset.audio,id=node.dataset.audio||node.dataset.clip||node.dataset.linkedAudio,c=audio?(state.audioClips||[]).find(c=>c.id===id):state.clips.find(c=>c.id===id),index=state.clips.indexOf(c);return {id,audio,edge,shared:!!c&&!!edge&&(audio?!!audioNeighbor(c,edge):T.isSharedEdge(state,index,edge))};}
function gestureLabel(target,a){if(target.edge&&!target.audio&&!a.blocked)return a.mode==='roll'?'Roll shared cut · Both sources need spare frames':a.mode==='ripple'?'Ripple trim · Following clips move':'Drag edge to trim · Shift ripple · Alt roll shared cut';return a.mode==='copy'?'Alt-drag to duplicate':a.blocked||a.mode==='move'?(a.blocked||'Drag to move · Alt-drag to duplicate · Hold S to slip'):a.mode==='roll'?'Drag to roll cut · Shift to ripple':a.mode==='ripple'?'Ripple '+(a.kind==='in'?'start':'end')+' · video stays fixed':a.mode==='trim'?'Trim '+(a.kind==='in'?'start':'end')+(target.audio?' · video stays fixed':' · Shift to ripple'):a.mode==='slip'?'Slip source · , / . fine-tune':'Slide between neighbors · , / . fine-tune';}
let gestureState=null,gestureHintsStale=false;
function refreshGestureHints(all=false){
 gestureHintsStale=false;
 const key=JSON.stringify([held,selectedCut]);if(key!==gestureState){gestureState=key;all=true;}
 for(const node of $('timelineContent').querySelectorAll('[data-clip],[data-audio],[data-linked-audio]')){
  if(!all&&node.dataset.gesture&&node.dataset.clip!==hoverTarget?.id&&node.dataset.audio!==hoverTarget?.id&&node.dataset.linkedAudio!==hoverTarget?.id)continue;
  const t=hoverIdentity(node,null),a=clipGesture(t);node.dataset.gesture=a.mode;node.style.cursor=gestureCursor(a);node.title=gestureLabel(t,a);
  for(const h of node.querySelectorAll('[data-trim],[data-audio-trim]')){const edge=h.dataset.trim||h.dataset.audioTrim,target=hoverIdentity(node,edge),action=clipGesture(target);h.dataset.gesture=action.mode;h.style.cursor=gestureCursor(action);h.style.width=Math.min(target.audio?(target.shared?6:8):12,parseFloat(node.style.width)/3)+'px';h.title=gestureLabel(target,action);h.classList.toggle('shared',target.shared);const cut=selectedCut;let selected=false;if(cut&&cut.audio===target.audio){if(cut.id===target.id)selected=cut.edge===target.edge;else if(target.audio){const c=(state.audioClips||[]).find(c=>c.id===cut.id);selected=audioNeighbor(c,cut.edge)?.id===target.id&&cut.edge!==target.edge;}else{const i=state.clips.findIndex(c=>c.id===cut.id);selected=state.clips[i+(cut.edge==='in'?-1:1)]?.id===target.id&&cut.edge!==target.edge;}}h.classList.toggle('cut-selected',selected);}
 }
 const a=hoverTarget&&clipGesture(hoverTarget);$('gestureHint').textContent=a?gestureLabel(hoverTarget,a):'Drag clips or edges';
 $('timelineHint').textContent='Alt-drag to duplicate · Drag edge to trim · Shift ripple · Alt roll shared cut · Hold S slip · Hold D slide · N snap';
 $('remove').title='Delete clip (Delete); Shift+Delete ripple deletes';
 document.querySelectorAll('.hover-source-handles').forEach(n=>n.remove());
 if(!drag&&hoverTarget&&!hoverTarget.edge&&a?.mode==='slip'&&!a.blocked){const t=hoverTarget,c=t.audio?(state.audioClips||[]).find(c=>c.id===t.id):state.clips.find(c=>c.id===t.id),start=t.audio?c.start:rowFor(c.id)?.start;if(c&&start!==undefined){const outline=document.createElement('div');outline.className='source-handles hover-source-handles';outline.style.left=(start-c.in)*ppf+'px';outline.style.width=(t.audio?c.media:take(c).media).frames*ppf+'px';const lane=t.audio?T.sourceLane(c):T.videoTrack(c),kind=t.audio?'source':'video',music=t.audio&&T.audioTrack(c)==='music';outline.style.top=music?'0px':'var('+trackVariable(kind,lane,'top')+')';outline.style.height='calc('+(music?'var(--music-height)':'var('+trackVariable(kind,lane,'height')+')')+' - 2px)';$(t.audio?(T.audioTrack(c)==='source'?'audioLane':'musicLane'):'clipLane').append(outline);}}
}
let lastTrimEdit=null;
function toggleTrimView(){trimSingle=!trimSingle;if(lastTrimEdit)updateTrimPreview(lastTrimEdit.d,lastTrimEdit.delta);save();}
function editingKey(e){const key=e.key.toLowerCase();return e.code==='Comma'||key==='<'?',':e.code==='Period'||key==='>'?'.':key;}
function clearHeld(){held.alt=false;held.s=false;held.d=false;held.shift=false;nudgeGroup=null;refreshGestureHints(true);}
$('trimViewButton').onclick=toggleTrimView;
$('editor').addEventListener('keyup',e=>{const key=editingKey(e);if(['s','d','shift'].includes(key)){held[key]=false;nudgeGroup=null;refreshGestureHints(true);e.stopPropagation();}if((key===','||key==='.')&&!held.s&&!held.d)nudgeGroup=null;});
$('editor').addEventListener('focusin',e=>{if(e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])'))clearHeld();});
interruptions.on(clearHeld);
$('timelineContent').addEventListener('pointermove',e=>{if(drag)return;const n=e.target.closest('[data-clip],[data-audio],[data-linked-audio]'),h=e.target.closest('[data-trim],[data-audio-trim]');const target=n&&!e.target.closest('[data-fade]')?hoverIdentity(n,h?.dataset.trim||h?.dataset.audioTrim||null):null;if(JSON.stringify(target)!==JSON.stringify(hoverTarget)){hoverTarget=target;refreshGestureHints();}});
$('timelineContent').addEventListener('pointerleave',()=>{hoverTarget=null;if(!drag)refreshGestureHints();});

const timelineHeightKey=VIEW_KEY+':timeline-height:full';
function timelineBounds(){const min=innerHeight<820?180:236;return {min,max:Math.max(min,Math.min(440,innerHeight-330))};}
function setTimelineHeight(height){const bounds=timelineBounds();$('editor').style.setProperty('--timeline-height',clamp(height,bounds.min,bounds.max)+'px');$('timelineResize').setAttribute('aria-valuemin',bounds.min);$('timelineResize').setAttribute('aria-valuemax',bounds.max);$('timelineResize').setAttribute('aria-valuenow',Math.round(document.querySelector('.timeline-shell').getBoundingClientRect().height));}
try{const height=Number(sessionStorage.getItem(timelineHeightKey));if(height)setTimelineHeight(height);}catch(error){}
$('timelineResize').onpointerdown=e=>{if(e.button!==0||drag||panelDrag||trackResize)return;e.preventDefault();e.stopPropagation();timelineDrag={y:e.clientY,height:document.querySelector('.timeline-shell').getBoundingClientRect().height,initial:$('editor').style.getPropertyValue('--timeline-height')};$('timelineResize').setPointerCapture(e.pointerId);$('editor').classList.add('resizing-timeline');};
$('timelineResize').onpointermove=e=>{if(timelineDrag)setTimelineHeight(timelineDrag.height+timelineDrag.y-e.clientY);};
function endTimelineResize(cancel=false){if(!timelineDrag)return;if(cancel){if(timelineDrag.initial)$('editor').style.setProperty('--timeline-height',timelineDrag.initial);else $('editor').style.removeProperty('--timeline-height');}else sessionStorage.setItem(timelineHeightKey,document.querySelector('.timeline-shell').getBoundingClientRect().height);timelineDrag=null;$('editor').classList.remove('resizing-timeline');}
$('timelineResize').onpointerup=()=>endTimelineResize();$('timelineResize').onpointercancel=()=>endTimelineResize(true);$('timelineResize').onlostpointercapture=()=>endTimelineResize();
$('timelineResize').ondblclick=()=>{$('editor').style.removeProperty('--timeline-height');sessionStorage.removeItem(timelineHeightKey);};
$('timelineResize').onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){endTimelineResize(true);return;}if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const b=timelineBounds(),height=document.querySelector('.timeline-shell').getBoundingClientRect().height;setTimelineHeight(e.key==='Home'?b.min:e.key==='End'?b.max:height+(e.key==='ArrowUp'?1:-1)*(e.shiftKey?40:12));sessionStorage.setItem(timelineHeightKey,document.querySelector('.timeline-shell').getBoundingClientRect().height);};
interruptions.on(()=>endTimelineResize(true));
function endTrackResize(cancel=false){
 if(!trackResize)return;const done=trackResize;trackResize=null;
 if(cancel){if(done.initial===undefined)delete trackHeights[done.key];else trackHeights[done.key]=done.initial;applyTrackHeights();}else storeTrackHeights();
 $('editor').classList.remove('resizing-track');
 if(done.handle.hasPointerCapture(done.pointerId))done.handle.releasePointerCapture(done.pointerId);
}
$('trackHeaders').addEventListener('pointerdown',e=>{
 const handle=e.target.closest('[data-track-resize]');if(!handle||e.button!==0||pointerBusy())return;
 e.preventDefault();e.stopPropagation();const key=handle.dataset.trackResize;trackResize={key,y:e.clientY,height:trackHeight(key),initial:trackHeights[key],pointerId:e.pointerId,handle};
 handle.focus({preventScroll:true});handle.setPointerCapture(e.pointerId);$('editor').classList.add('resizing-track');
});
window.addEventListener('pointermove',e=>{if(!trackResize||e.pointerId!==trackResize.pointerId)return;const b=trackHeightBounds(trackResize.key);trackHeights[trackResize.key]=Math.round(clamp(trackResize.height+e.clientY-trackResize.y,b.min,b.max));applyTrackHeights();});
window.addEventListener('pointerup',e=>{if(e.pointerId===trackResize?.pointerId)endTrackResize();});
window.addEventListener('pointercancel',e=>{if(e.pointerId===trackResize?.pointerId)endTrackResize(true);});
$('trackHeaders').addEventListener('lostpointercapture',()=>endTrackResize(true));
$('trackHeaders').addEventListener('dblclick',e=>{const handle=e.target.closest('[data-track-resize]');if(!handle)return;e.preventDefault();e.stopPropagation();delete trackHeights[handle.dataset.trackResize];applyTrackHeights();storeTrackHeights();});
$('trackHeaders').addEventListener('keydown',e=>{
 const handle=e.target.closest('[data-track-resize]');if(!handle)return;e.stopPropagation();if(e.key==='Escape'){e.preventDefault();endTrackResize(true);return;}
 if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const key=handle.dataset.trackResize,b=trackHeightBounds(key);trackHeights[key]=e.key==='Home'?b.min:e.key==='End'?b.max:clamp(trackHeight(key)+(e.key==='ArrowDown'?1:-1)*(e.shiftKey?32:8),b.min,b.max);applyTrackHeights();storeTrackHeights();
});
document.querySelector('.track-labels').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey)return;e.preventDefault();$('timelineScroll').scrollTop+=e.deltaY;},{passive:false});
interruptions.on(()=>endTrackResize(true));
$('timelineScroll').addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();e.stopPropagation();const sc=$('timelineScroll'),x=e.clientX-sc.getBoundingClientRect().left;setTimelineZoom(state.zoom*(e.deltaY<0?1.15:1/1.15),(x+sc.scrollLeft)/ppf,x);},{passive:false});


// Recover a paused retained decoder only when a changed seek makes no frame progress.
const nativeVideoSeekGuard=createVideoSeekGuard(v=>!v.hidden&&(v===shownVideo&&v.classList.contains('front')||!$('takeCompare').hidden&&comparisonVideos().includes(v)),()=>playing);
const nativeRecipes={...BOOT.recipes},linkedSidecarHashes=new Map();
let bridgeId=params.get('bridge'),bridge=bridgeId?B.openChannel(bridgeId):null,bridgeClient=bridge?B.createClient(bridge):null;
let bridgeReady=null,stopWorkflowApply=null;
function listenForWorkflowApply(){
 stopWorkflowApply?.();if(!bridge)return;const channel=bridge;
 const receive=async({data})=>{
  if(!data?.requestId||data.action!==B.LINK_APPLY||data.link?.editorId!==focusViewId||data.link.projectId!==projectKey)return;
  let reply;try{await updateClipInputs(data.link.clipId,data.link);reply={result:{applied:true}};}catch(error){reply={error:error.message};}
  if(bridge===channel)channel.postMessage({requestId:data.requestId,...reply});
 };
 channel.addEventListener('message',receive);stopWorkflowApply=()=>channel.removeEventListener('message',receive);
}
listenForWorkflowApply();
if(bridgeClient){const initial=bridgeClient;void initial.call(B.ACTIONS.ping,{}, {timeoutMs:900}).then(live=>{if(bridgeClient===initial)bridgeReady=!!live.connected&&!!live.workflowLinks;}).catch(()=>{if(bridgeClient===initial)bridgeReady=false;});}
function reconnectBridge(id){
 if(id===bridgeId)return;bridgeClient?.close();bridgeId=id;bridgeReady=null;bridge=id?B.openChannel(id):null;bridgeClient=bridge?B.createClient(bridge):null;listenForWorkflowApply();
 const address=new URL(location.href);if(id)address.searchParams.set('bridge',id);else address.searchParams.delete('bridge');window.history.replaceState(null,'',address);
}
async function host(action,values={},preparedTab=null){
 if(['open','prepare'].includes(action)&&(values.workflow||values.prompt)){const prepared=await request('prepare-workflow?projectId='+encodeURIComponent(projectKey),{...(values.workflow&&(!values.prompt||values.preferWorkflow)?{workflow:values.workflow}:{}),...(values.prompt?{prompt:values.prompt}:{})});values={...values,workflow:values.prompt&&!values.preferWorkflow?null:prepared.workflow,prompt:prepared.prompt,controls:values.controls?.map(c=>({...c,value:prepared.prompt?.[c.nodeId]?.inputs?.[c.input]??c.value}))};}
 if(bridgeClient&&action!=='prepare'){
  let live;try{live=await bridgeClient.call(B.ACTIONS.ping,{}, {timeoutMs:900});}catch(error){if(error.code!=='SPOOL_BRIDGE_TIMEOUT')throw error;}
  if(live?.connected&&(!values.link||live.workflowLinks)){bridgeReady=true;preparedTab?.close();return bridgeClient.call(action,values,{timeoutMs:120000});}
  reconnectBridge(null);
 }
 if(action===B.ACTIONS.workflowDrop)throw Error('That Comfy tab is no longer connected. Drag the workflow again from its current tab.');
 if(action===B.ACTIONS.capture&&values.link){if(productCapabilities.configuration?.comfyUrl&&new URL(productCapabilities.configuration.comfyUrl).origin!==location.origin)throw Error('Open Spool from the paired Comfy host to apply linked workflow changes.');throw Error('Choose Edit in Comfy for this clip to reconnect its workflow, then apply changes.');}
 if(!['capture','open','prepare'].includes(action))throw Error('This action requires a connected Comfy graph tab.');
 await ensureComfy();
 const config=productCapabilities.configuration;
 await flushNative();const c=values.link?state.clips.find(c=>c.id===values.link.clipId):selected();if(!c&&action==='open')throw Error('Select a saved shot first.');
 const handoff=await request('projects/'+projectKey+'/handoffs',{action,clipId:c?.id,revision:projectEdit.revision,...values});
 const address=config.comfyUrl+'/?'+B.HANDOFF_PARAM+'='+encodeURIComponent(handoff.id);
 const tab=preparedTab||window.open(address,'_blank');if(preparedTab)preparedTab.location.href=address;
 if(!tab)throw Error('Allow this site to open the Comfy graph tab, then retry.');
 const end=Date.now()+600000;while(Date.now()<end){await new Promise(r=>setTimeout(r,750));const current=await request('handoffs/'+handoff.id);if(current.state==='complete'){if(current.result.error)throw Error(current.result.error);if(current.result.bridgeId)reconnectBridge(current.result.bridgeId);return current.result;}if(tab.closed)throw Error('The Comfy tab was closed before the workflow finished opening. Choose Edit in Comfy to try again.');}
 throw Error('Graph handoff expired. Open a fresh one.');
}
function withBridge(url){return url+(bridgeId?(url.includes('?')?'&':'?')+'bridge='+encodeURIComponent(bridgeId):'');}
const nativeDocument=()=>L.authored(projectData());
const exactInt=W.isExactInt,isInt=W.isIntegerValue,decimal=W.exactDecimal;
function applyNativeProject(project,replace){if(JSON.stringify(project.document.deletedTakeIds||[])!==JSON.stringify(state.deletedTakeIds||[])){history.clear();thumbnails.stopScrub();pause();editView();review.clear();saveHistory();}Object.assign(nativeRecipes,project.recipes);if(replace)receiveProject(project.document);else{L.mergeArrivals(state,project.document);renderTakes();renderClipAttention();queueLabel();renderJobStatus();if($('queueList'))renderQueueList();}}
function showConflict(){showModal('Project changed in another view','<p>Your current edit is kept here. Download it before reloading if you want to preserve it. The server revision has not been overwritten.</p>','<button class="outline" id="draftDownload">Download local edit</button><button class="primary" id="conflictReload">Reload saved project</button>');$('draftDownload').onclick=downloadLocalDraft;$('conflictReload').onclick=async()=>{try{await projectEdit.reload();closeModal();history.clear();}catch(error){toast(error.message);}};}
const projectEdit=createProjectEdit({project:BOOT,document:nativeDocument,apply:applyNativeProject,request,
 blocked:operation=>isFailed()||!!exportRangeDrag||(operation==='save'?drag&&drag.kind!=='scrub':!!drag)||(operation==='replace'?nativeEditingField():operation==='navigation'?!$('modalOverlay').hidden:false),
 notify:status=>{latestSaveStatus=status;if(topbar)topbar.save(status);else $('saveStatus').textContent=status.kind==='saving'?'Saving…':'Opening project…';if(status.kind==='conflict'&&status.error)showConflict();else if(status.kind==='error')toast(status.message);else if(status.kind==='connection')setStatus('Project connection: '+status.message);}
});
async function flushNative(){saveView();saveHistory();await projectEdit.flush();}
async function saveProjectNow(manual=true){
 if(isFailed()||drag){if(manual)toast('Finish the current gesture before saving.');return;}
 // Blur commits native change handlers, including text still being edited.
 const field=document.activeElement;
 if($('editor').contains(field)&&!field.closest('.modal-overlay')&&field.matches('input:not([type=file]):not([type=checkbox]),textarea,select')){
  const id=field.id,start=field.selectionStart,end=field.selectionEnd;field.blur();const current=field.isConnected?field:$(id);
  current?.focus({preventScroll:true});if(start!==null&&current?.setSelectionRange&&current.type!=='number')current.setSelectionRange(start,end);
 }
 try{await flushNative();if(manual)toast('Project saved');}catch(error){if(manual)toast(error.message);}
}
function saveShortcut(e){if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();if(!workflowLocked&&e.type==='keydown'&&!e.repeat)saveProjectNow();}}
window.addEventListener('keydown',saveShortcut,true);window.addEventListener('keyup',saveShortcut,true);
// Only edits and view history use browser storage; durable queue/result state is polled from SQLite.
const nativeEditingField=()=>document.activeElement?.matches('input:not([type=range]):not([type=checkbox]):not([type=file]),textarea,select');
let projectPoll=Date.now(),nativePolling=false;
const focusViewId=crypto.randomUUID();
let focusPoll=0;
const editorVisible=()=>!document.hidden&&(!window.frameElement||window.frameElement.getClientRects().length>0);
async function pollNative(automatic=false){
 if(nativePolling||automatic&&!editorVisible())return;nativePolling=true;
 try{
  const active=visibleJobs().some(j=>!G.TERMINAL.includes(j.status));
  if(!automatic||!playing&&Date.now()-projectPoll>=(active?1200:15000)){projectPoll=Date.now();await projectEdit.poll();}
  // Agent focus expires after 15 seconds; a small heartbeat keeps it current.
  if(Date.now()-focusPoll>=10000&&editorVisible()){focusPoll=Date.now();await request('projects/'+projectKey+'/focus/'+focusViewId,{clipId:state.selected,takeId:review.source?.takeId||selected()?.takeId,playhead:state.frame,mode:'editor'}).catch(()=>{});}
 }finally{nativePolling=false;}
}
const connectionButton=document.createElement('button');connectionButton.className='outline';connectionButton.textContent=productCapabilities.connected?'Comfy connected':productCapabilities.configuration?'Waiting for Comfy':'Pair Comfy';$('showQueue').before(connectionButton);
connectionButton.id='comfyConnection';
let comfyConnection={state:productCapabilities.connected?'connected':'stopped'};
function renderConnection(){if(topbar)topbar.connection(comfyConnection);}
async function connectComfy(){
 comfyConnection=await request('comfy');renderConnection();
 if(comfyConnection.state!=='connected'){
  if(!comfyConnection.settings.startupFile)throw Error('Choose a startup file in Project → Comfy settings first.');
  comfyConnection=await request('comfy/start',{});renderConnection();
  const end=Date.now()+180000;while(comfyConnection.state==='starting'&&Date.now()<end){await new Promise(r=>setTimeout(r,750));comfyConnection=await request('comfy');renderConnection();}
  if(comfyConnection.state!=='connected')throw Error(comfyConnection.error||'Comfy is still starting. Check its startup log in Comfy settings.');
 }
}
async function ensureComfy(){await connectComfy();Object.assign(productCapabilities,await request('capabilities'));productDefinitions=productCapabilities.definitions||{};}
async function comfySettings(){try{
 comfyConnection=await request('comfy');renderConnection();const s=comfyConnection.settings;
 showModal('Comfy settings',(productCapabilities.cloudExecution===false?'<p class="setup-note">'+esc(productCapabilities.requirements?.optional?.[0]||'Comfy Cloud is unavailable on this host.')+'</p>':'')+'<p>'+esc(comfyConnection.error||({connected:'Comfy is connected.',starting:'Comfy is starting.',stopped:'Comfy is stopped.'}[comfyConnection.state]||'Check the connection.'))+'</p>'+(comfyConnection.state==='connected'?'<p><a class="download-link" href="'+esc(s.comfyUrl)+'" target="_blank" rel="noopener">Open ComfyUI</a></p>':'')+'<label class="field"><span>Comfy Cloud API Key</span><input id="comfyApiKey" type="password" autocomplete="new-password" placeholder="'+(comfyConnection.hasApiKey?'Key configured - leave blank to keep it':'comfyui-…')+'"></label><p class="small">Stored on this machine. Never included in project exports. Falls back to COMFY_API_KEY.</p><label><input id="comfyClearApiKey" type="checkbox"> Remove saved key</label><label class="field"><span>Startup file</span><input id="comfyStartupFile" list="comfyStartupFiles" value="'+esc(s.startupFile)+'" placeholder="Full path to your Comfy .bat or executable"><datalist id="comfyStartupFiles">'+(comfyConnection.startupFiles||[]).map(p=>'<option value="'+esc(p)+'"></option>').join('')+'</datalist></label><label class="field"><span>Comfy address</span><input id="comfyAddress" value="'+esc(s.comfyUrl)+'"></label><p class="small">Use the port from your startup file. Spool starts it in its own folder and keeps the same project store.</p><label class="field"><span><input id="comfyAutoStart" type="checkbox" '+(s.autoStart?'checked':'')+'> Start Comfy automatically when standalone Spool opens</span></label><p class="small">Automatic startup is off by default. Closing Spool leaves Comfy running.</p><pre id="comfyStartupLog" hidden></pre>','<button class="outline" id="comfyShowLog" '+(!comfyConnection.logAvailable?'disabled':'')+'>Startup log</button><button class="outline" id="comfySaveSettings">Save settings</button><button class="primary" id="comfySaveStart">Save and connect</button>');
 const saveSettings=async()=>{await request('comfy/settings',{startupFile:$('comfyStartupFile').value,comfyUrl:$('comfyAddress').value,autoStart:$('comfyAutoStart').checked,...($('comfyApiKey').value.trim()?{apiKey:$('comfyApiKey').value.trim()}:$('comfyClearApiKey').checked?{apiKey:''}:{})},'PUT').then(result=>{Object.assign(productCapabilities,{hasApiKey:result.hasApiKey,apiKeySource:result.apiKeySource});workflowLibrary?.render();});templateBrowser?.reset();builtinPreparer.reset();preparedWorkflows.clear();workflowLoads.clear();};
 $('comfyShowLog').onclick=async()=>{try{$('comfyStartupLog').textContent=(await request('comfy/log')).text;$('comfyStartupLog').hidden=false;}catch(e){toast(e.message);}};
 $('comfySaveSettings').onclick=async()=>{try{await saveSettings();closeModal();toast('Comfy settings saved');}catch(e){toast(e.message);}};
 $('comfySaveStart').onclick=async()=>{try{await saveSettings();closeModal();await ensureComfy();toast('Comfy connected');}catch(e){toast(e.message);}};
 }catch(error){toast(error.message);}}
connectionButton.onclick=async()=>{try{comfyConnection=await request('comfy');if(comfyConnection.state==='stopped'&&comfyConnection.settings.startupFile){await ensureComfy();toast('Comfy connected');}else await comfySettings();}catch(error){toast(error.message);}};
const queueRetryKey=STORAGE_KEY+':queue-request';
const queueSubmission=G.createQueueSubmission({storage:sessionStorage,key:queueRetryKey,submit:submitQueue});
async function submitQueue(body){
 const {seedUpdates=[],...payload}=body;
 await projectEdit.change(()=>request('projects/'+projectKey+'/queue',payload));
 const updates=seedUpdates.filter(update=>{const c=state.clips.find(c=>c.id===update.clipId);return c&&c.workflowVersion===update.workflowVersion&&c.seedMode===update.mode&&c.seedKey===update.seedKey&&decimal(c.inputValues[update.key])===decimal(update.before);});
 if(updates.length){
  edits.apply('Advance generation seeds',()=>{
  for(const update of updates){const c=state.clips.find(c=>c.id===update.clipId);c.inputValues[update.key]=update.after;c.revision++;}
  },'inspector');
 }
 if($('generationReviewQueue'))closeModal();const cloudOnly=payload.items?.every(item=>{const clip=state.clips.find(c=>c.id===item.clipId);return (clip?.executionTarget||nativeRecipes[clip?.workflowVersion]?.executionTarget)==='cloud';});toast(cloudOnly?'Cloud generation requests accepted.':productCapabilities.connected?'Generation requests accepted.':'Requests saved; waiting for Comfy.');
}
function queueClips(clips,reviewed=null){return queueSubmission.start(async()=>{
 if(!clips.length)return;
 if(bridgeClient){const live=await bridgeClient.call(B.ACTIONS.ping,{}, {timeoutMs:300}).catch(()=>null),linked=live?.linkedWorkflow;if(linked?.projectId===projectKey&&linked.deadline&&clips.some(c=>c.id===linked.clipId&&!Object.values(nativeRecipes[c.workflowVersion]?.prompt||{}).some(n=>['DeadlineSubmit','SaveAndSubmitNode'].includes(n.class_type))))throw Error('Apply this clip’s Comfy changes before generating. Its saved workflow has no Deadline submit node.');}
 for(const c of clips){const reason=queueReason(c);if(reason)throw Error(c.name+': '+reason);}
 if(!reviewed&&clips.some(c=>(c.count||1)>1)){await reviewGeneration(clips);return;}
 await flushNative();
 const items=reviewed||G.generationItems(clips,{...cloudDefinitions,...productDefinitions},nativeRecipes);
 return {revision:projectEdit.revision,items,seedUpdates:G.seedUpdates(clips,items),operationId:crypto.randomUUID()};
}).catch(error=>{if(error.status!==409)toast(error.message);}).finally(()=>{if($('queueList'))renderQueueList();});}
// Renders is a panel, not a modal: editing, playback and shortcuts continue while it is open.
function closeRenders(){const panel=$('rendersPanel');if(panel.hidden)return;const inside=panel.contains(document.activeElement);panel.hidden=true;panel.innerHTML='';$('showQueue').setAttribute('aria-expanded','false');if(inside)$('showQueue').focus({preventScroll:true});}
function queueModal(){
 const panel=$('rendersPanel');if(!panel.hidden){closeRenders();return;}
 panel.innerHTML='<div class="modal-head"><h2 id="rendersTitle">Renders</h2><button class="iconbutton" id="closeRenders" aria-label="Close renders">'+svg('close')+'</button></div><div class="render-toolbar"><span id="queueSummary" role="status"></span><div class="render-toolbar-actions"><button class="textbutton" id="clearFinishedRenders" title="Clear finished entries from the queue. Takes are kept.">Clear finished</button><button class="textbutton" id="reconcileQueue" title="Refresh render status and retry collecting finished results">'+svg('loop')+' Refresh</button></div></div><div id="queuePending" class="render-pending" hidden><div><strong>Submission not confirmed</strong><p>Retry to check the same request.</p></div><button class="outline" id="retryQueue">Retry submission</button></div><div id="queueList" class="queue-list"></div>';
 panel.hidden=false;$('showQueue').setAttribute('aria-expanded','true');$('closeRenders').onclick=closeRenders;renderQueueList();
 $('retryQueue').onclick=async()=>{const button=$('retryQueue');button.disabled=true;try{await queueSubmission.retry();}catch(error){toast(error.message);}finally{renderQueueList();if(!queueSubmission.pending)$('reconcileQueue').focus();}};
 $('reconcileQueue').onclick=refreshQueue;
 $('clearFinishedRenders').onclick=()=>clearRenders(visibleJobs().filter(G.finishedRender).map(j=>j.id));
 $('closeRenders').focus();
}
function visibleJobs(){return G.visibleRenderJobs(state.jobs,state.clearedRenderIds);}
async function clearRenders(ids){
 try{await flushNative();const requested=new Set(ids),clear=state.jobs.filter(j=>requested.has(j.id)&&G.clearableRender(j));if(!clear.length)return;
  state.clearedRenderIds=[...new Set([...state.clearedRenderIds||[],...clear.map(j=>j.id)])];save();await flushNative();renderQueueList();queueLabel();renderJobStatus();
  $('reconcileQueue')?.focus({preventScroll:true});toast(clear.length+' '+(clear.length===1?'entry cleared':'entries cleared')+'. Takes kept.');
 }catch(error){toast(error.message);}
}
async function refreshQueue(){try{await request('reconcile',{});await pollNative();renderQueueList();}catch(error){toast(error.message);}}
$('showQueue').onclick=queueModal;
function renderQueueList(){
 const list=$('queueList');if(!list)return;
 const terminal=j=>['complete','cancelled'].includes(j.status),attention=j=>['failed','collection_pending','submission_uncertain','uncertain','farm_attention'].includes(j.status);
 const jobs=visibleJobs().slice().reverse(),current=jobs.filter(j=>!terminal(j)),past=jobs.filter(terminal),active=current.filter(j=>!attention(j)),needs=current.filter(attention);
 $('clearFinishedRenders').disabled=!jobs.some(G.finishedRender);
 $('queueSummary').textContent=[active.length?active.length+' active render'+(active.length===1?'':''):'',needs.length?needs.length+' need'+(needs.length===1?'s':'')+' attention':''].filter(Boolean).join(' · ')||(past.length?'No active renders':state.jobs.length?'Queue is clear':'No renders yet');
 $('queuePending').hidden=!queueSubmission.pending;$('retryQueue').disabled=queueSubmission.sending;
 const row=j=>{
  const observations=j.nodeProgress||[],node=observations.filter(n=>n.max>1).at(-1)||observations.at(-1),running=['running','farm_running'].includes(j.status);
  const farm=j.farmProgress,percent=jobPercent(j);
  const progress=Number.isFinite(percent)?'<div class="render-progress"><progress max="100" value="'+esc(percent)+'" aria-label="'+esc(j.target==='deadline'?'Deadline worker':'Current node')+' progress"></progress></div>':'';
  const result=state.clips.flatMap(c=>c.takes).find(t=>t.generated&&t.request?.attemptId===j.id),output=result?.media?.originalFile;
  const details='<div class="render-execution"><p>'+esc(j.target==='deadline'?'Deadline':j.target==='cloud'?'Comfy Cloud · Developer Platform':'Local Comfy')+(farm?.worker?' · '+esc(farm.worker):'')+'</p>'+(farm?.message?'<p>'+esc(farm.message)+'</p>':'')+observations.map(n=>'<div class="job-node">'+esc(n.label)+(n.max>1?' / '+esc(n.value)+' of '+esc(n.max):'')+'</div>').join('')+(j.seeds?.length?'<p class="job-seeds">'+j.seeds.map(b=>esc(b.label)+': '+esc(decimal(b.value))).join(' / ')+'</p>':'')+(j.error?'<pre class="render-error">'+esc(j.error)+'</pre>':'')+(output?'<p class="render-output">Saved to <a class="download-link" target="_blank" href="'+esc(url(output))+'">'+esc(output)+'</a></p>':'')+'<code>'+esc(j.submission?.external_id||j.promptId||'')+'</code><a class="download-link" target="_blank" href="/spool/api/attempts/'+encodeURIComponent(j.id)+'">Execution record ↗</a></div>';
  const actions=(j.status==='collection_pending'?'<button class="outline" data-retry-collection data-queue-focus="collect:'+esc(j.id)+'">Retry collection</button>':'')+(G.cancelAction(j)!=='refused'&&j.status!=='cancel_requested'?'<button class="outline" data-cancel-attempt="'+esc(j.id)+'" data-queue-focus="cancel:'+esc(j.id)+'">'+(j.status==='uncertain'&&G.cancelAction(j)==='cancelled'?'Dismiss':'Cancel request')+'</button>':'')+(j.target==='deadline'&&j.status==='submission_uncertain'?'<button class="outline" data-recover-submission="'+esc(j.id)+'" data-queue-focus="recover:'+esc(j.id)+'">Find existing Deadline job</button>':'');
  return '<article class="queue-row" data-render="'+esc(j.id)+'"><details data-queue-detail="'+esc(j.id)+'"><summary class="'+(G.clearableRender(j)?'has-clear':'')+'" data-queue-focus="details:'+esc(j.id)+'" aria-label="Take '+esc(j.takeNumber||'')+' details"><span class="render-take">Take '+esc(j.takeNumber||'—')+'</span><span class="render-stage" data-state="'+(attention(j)?'attention':j.status==='complete'?'ready':running?'running':'waiting')+'">'+esc(G.jobStage(j))+'</span>'+(Number.isFinite(percent)?'<span class="render-percent">'+Math.round(percent)+'%</span>':'')+'<span data-job-elapsed="'+esc(j.id)+'"></span>'+(G.clearableRender(j)?'<button class="render-clear" data-clear-render="'+esc(j.id)+'" data-queue-focus="clear:'+esc(j.id)+'" aria-label="Clear take '+esc(j.takeNumber||'')+' from queue" title="Clear from queue. Takes are kept.">'+svg('close')+'</button>':'')+'</summary>'+details+(actions?'<div class="render-row-actions">'+actions+'</div>':'')+'</details>'+progress+'</article>';
 };
 const grouped=items=>{const groups=new Map();for(const job of items){if(!groups.has(job.clipId))groups.set(job.clipId,[]);groups.get(job.clipId).push(job);}return [...groups].map(([id,group])=>'<section class="render-shot" data-render-shot="'+esc(id)+'"><h3 title="'+esc(group[0].name)+'">'+esc(state.clips.find(c=>c.id===id)?.name||group[0].name)+'</h3>'+group.map(row).join('')+'</section>').join('');};
 const recovered=state.recoverableResults||[];
 const html=grouped(current)+(past.length?'<details class="render-history" data-queue-detail="history"><summary data-queue-focus="history">Recent renders <span>'+past.length+'</span></summary><div>'+grouped(past)+'</div></details>':'')+(!jobs.length?'<div class="queue-empty">'+(state.jobs.length?'Queue is clear. Your takes are kept.':'Generated takes will appear here.')+'</div>':'')+(recovered.length?'<details class="render-history" data-queue-detail="recovered"><summary data-queue-focus="recovered">Results from removed shots <span>'+recovered.length+'</span></summary>'+recovered.map(r=>'<p>'+esc(r.clipName)+' / '+esc(r.takeId)+' <a class="download-link" target="_blank" href="'+esc(url(r.media.file))+'">Review media</a></p>').join('')+'</details>':'');
 if(list.renderMarkup!==html){
  const opened=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.queueDetail)),focused=list.getRootNode().activeElement,focus=list.contains(focused)?focused.dataset.queueFocus:null;
  list.innerHTML=html;list.renderMarkup=html;
  for(const el of list.querySelectorAll('details'))el.open=opened.has(el.dataset.queueDetail);
  const bind=(attribute,action,capability)=>list.querySelectorAll('['+attribute+']').forEach(button=>button.onclick=async()=>{try{const id=button.getAttribute(attribute),job=state.jobs.find(j=>j.id===id),clip=state.clips.find(c=>c.id===job.clipId)||{id:job.clipId};await authoredCommand(action,{attemptId:id},clip,[capability]);await pollNative();renderQueueList();}catch(error){toast(error.message);}});
  bind('data-cancel-attempt','cancel','cancel');bind('data-recover-submission','recover_submission','recover');
  list.querySelectorAll('[data-clear-render]').forEach(button=>button.onclick=e=>{e.preventDefault();e.stopPropagation();return clearRenders([button.dataset.clearRender]);});
  list.querySelectorAll('[data-retry-collection]').forEach(button=>button.onclick=refreshQueue);
  if(focus)(list.querySelector('[data-queue-focus="'+CSS.escape(focus)+'"]')||$('closeRenders')).focus({preventScroll:true});
 }
 for(const el of list.querySelectorAll('[data-job-elapsed]'))el.textContent=G.jobElapsed(jobs.find(j=>j.id===el.dataset.jobElapsed));
}
const rollKey=e=>{
 if(workflowLocked)return;
 if(e.key!=='Alt')return;
 if(e.type==='keyup'){held.alt=false;refreshGestureHints(true);return;}
 if(!$('editor').contains(e.target)||e.target.closest('input,textarea,select,[contenteditable]')||!$('modalOverlay').hidden||!clipMenu.hidden)return;
 held.alt=true;refreshGestureHints(true);e.preventDefault();e.stopPropagation();
};
window.addEventListener('keydown',rollKey);window.addEventListener('keyup',rollKey,true);
$('timelineScroll').addEventListener('pointerdown',e=>{held.alt=e.altKey;},true);
const rollPointer=e=>{if(drag?.kind==='pending'&&held.alt!==e.altKey){held.alt=e.altKey;refreshGestureHints(true);}};
window.addEventListener('pointermove',rollPointer,true);
window.addEventListener('pagehide',()=>{window.removeEventListener('keydown',rollKey);window.removeEventListener('keyup',rollKey,true);window.removeEventListener('pointermove',rollPointer,true);});
$('gestureHelp').onclick=async()=>{const {shortcutSheet}=await import('/spool/ui/shortcuts.js');showModal('Keyboard shortcuts',shortcutSheet());$('modal').classList.add('shortcut-dialog');};
const experimentRetryKey=STORAGE_KEY+':experiment-request';
let experimentRetry=null;try{experimentRetry=JSON.parse(sessionStorage.getItem(experimentRetryKey)||'null');}catch(error){}
function commandScope(c,capabilities,maxTakes=16){return {projectId:projectKey,clipIds:c?[c.id]:[],capabilities,maxTakes};}
async function authoredCommand(action,args,c,capabilities){await flushNative();const data={operationId:crypto.randomUUID(),revision:projectEdit.revision,actor:'human',scope:commandScope(c,capabilities),action,arguments:args};await projectEdit.change(async()=>{await request('projects/'+projectKey+'/commands',data);return request('projects/'+projectKey);});return data;}
function generationSourceLabel(setting){
 if(!setting)return 'Workflow file';
 if(setting.source==='track')return setting.track==='music'?'A2 soundtrack / aligned to shot':'A1 clip audio / V'+(setting.lane||1)+' / aligned to shot';
 if(setting.source==='clip')return [...state.clips,...state.audioClips||[]].find(c=>c.id===setting.clipId)?.name||'Removed audio clip';
 return setting.source==='original'?'Original shot':'Selected take';
}
async function reviewGeneration(clips){
 const ids=clips.map(c=>c.id);await flushNative();clips=ids.map(id=>state.clips.find(c=>c.id===id)).filter(Boolean);if(clips.length!==ids.length)throw Error('A selected clip was removed. Select the clips to generate again.');
 let items;try{items=G.generationItems(clips,{...cloudDefinitions,...productDefinitions},nativeRecipes);}catch(error){toast(error.message);return;}
 const signature=G.reviewSignature(state,ids);
 showModal('Review generation','<p>'+items.reduce((n,i)=>n+i.count,0)+' takes. New takes stay unselected.</p>'+clips.map(c=>'<h3>'+esc(c.name)+'</h3><p>'+esc(({same:'Fixed seeds',different:'Incrementing seeds',increment:'Incrementing seeds',decrement:'Decrementing seeds',randomize:'Random seeds'})[c.seedMode||'same'])+'</p>'+items.filter(i=>i.clipId===c.id).map(i=>'<p>'+i.count+' take(s) / '+(G.seedControls(c).map(b=>esc(b.label)+': <code>'+esc(decimal(i.values?.[b.key]??c.inputValues[b.key]))+'</code>').join(' / ')||'No mapped seed')+'</p>').join('')).join(''),'<button class="outline" id="generationReviewCancel">Cancel</button><button class="primary" id="generationReviewQueue">Queue these takes</button>');
 $('generationReviewCancel').onclick=closeModal;$('generationReviewQueue').onclick=async()=>{if(G.reviewSignature(state,ids)!==signature){await reviewGeneration(clips);toast('Settings changed. Review the updated values.');return;}$('generationReviewQueue').disabled=true;await queueClips(clips,items);if($('generationReviewQueue'))$('generationReviewQueue').disabled=false;};
}
function renderJobStatus(){
 if(!selected()||selectedAudio()||selectionIds().length>1){jobStatus.textContent='';return;}
 const jobs=visibleJobs().filter(j=>j.clipId===selected().id&&!G.TERMINAL.includes(j.status)),job=jobs.find(j=>['running','farm_running','collecting'].includes(j.status))||jobs[0];
 jobStatus.textContent=job?G.jobStage(job)+' / '+G.jobElapsed(job)+(jobs.length>1?' / '+jobs.length+' pending':''):'';
}
async function submitExperiment(data){await projectEdit.change(async()=>{await request('projects/'+projectKey+'/commands',data);return request('projects/'+projectKey);});experimentRetry=null;sessionStorage.removeItem(experimentRetryKey);toast('Experiment accepted. New takes stay unselected.');}
async function showActivity(){try{const value=await request('projects/'+projectKey+'/events?limit=30&latest=true');showModal('Activity','<p>View ID: '+esc(focusViewId)+'</p>'+value.events.slice(-30).reverse().map(e=>'<p>'+esc(e.kind)+' / '+esc(e.data.actor||'execution')+'</p><details><summary>Details</summary><pre>'+esc(JSON.stringify(e.data,null,2))+'</pre></details>').join(''),'<button class="outline" id="retryExperiment">Retry pending experiment</button>');$('retryExperiment').disabled=!experimentRetry;$('retryExperiment').onclick=async()=>{try{await submitExperiment(experimentRetry);closeModal();}catch(e){toast(e.message);}};}catch(error){toast(error.message);}}
function queueReason(c){const recipe=nativeRecipes[c?.workflowVersion];return workflowStatus(c,workflows[c?.workflow],recipe,definitionsFor(c)).reason||(recipe?.provenance?.builtinTemplate?.startsWith('api_')&&!productCapabilities.hasApiKey?'Set your Comfy Cloud API key in Comfy settings.':null);}

function bindWorkflowControls(c,bindings){
 if(bindings.length===c.bindings.length)return;
 const capture=copy(nativeRecipes[c.workflowVersion]),version=crypto.randomUUID();capture.bindings=copy(bindings);
 c.inputValues={...Object.fromEntries(bindings.map(b=>[b.key,copy(capture.prompt[b.nodeId].inputs[b.input])])),...c.inputValues};
 c.bindings=copy(bindings);c.workflowVersion=version;nativeRecipes[version]=capture;unsavedRecipes.set(version,capture);
}
function controlField(b,i,c){
 const value=Object.hasOwn(c.inputValues||{},b.key)?c.inputValues[b.key]:nativeRecipes[c.workflowVersion]?.prompt[b.nodeId]?.inputs[b.input],label=esc(b.label||b.input),source=(c.shotInputs||[]).find(s=>s.key===b.key);
 if(b.role==='resolution'&&b.options?.length&&b.options.every(v=>/^\d+x\d+$/.test(v))){
  const current=pixelResolution(value),sizes=[...new Set(b.options.map(v=>pixelResolution(v).size))],ratios=[...new Set(b.options.map(v=>pixelResolution(v).ratio))];
  return '<div class="two-fields" data-pixel-resolution="'+i+'"><label class="field"><span>Resolution</span><select data-resolution-size>'+sizes.map(v=>'<option value="'+v+'" '+(v===current.size?'selected':'')+'>'+v+'p</option>').join('')+'</select></label><label class="field"><span>Aspect ratio</span><select data-resolution-ratio>'+ratios.map(v=>'<option '+(v===current.ratio?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div>';
 }

 const missing=nativeRecipes[c.workflowVersion]?.inputRecovery?.missing?.some(m=>m.nodeId===b.nodeId&&m.input===b.input&&m.sources.includes(value));
 if(b.asset&&['video','audio'].includes(b.slot)){
  const video=b.slot==='video',current=take(c),available=!current.placeholder&&current.media.kind==='video',timeline=video&&source?.source==='selected';
  const description=source?(timeline?'Timeline video · '+c.name:generationSourceLabel(source)):!value||missing?'No '+b.slot+' selected':String(value).split('/').at(-1);
  return '<div class="field binding-source" data-media-input="'+i+'"><span>'+label+'</span><span class="native-source-value" data-media-source>'+esc(description)+'</span><div class="media-input-actions">'+(video?'<button class="outline" type="button" data-use-timeline-video aria-pressed="'+timeline+'" '+(!available?'disabled':'')+' title="'+(available?'Use this clip’s selected take and timeline trim':'This clip needs a video take first')+'">Use timeline video</button>':'')+'<button class="outline" type="button" data-media-upload>Choose file…</button></div><input type="file" accept="'+b.slot+'/*" hidden></div>';
 }
 if(b.asset&&['LoadImage','LoadImageMask'].includes(b.contract?.classType||nativeRecipes[c.workflowVersion]?.prompt[b.nodeId]?.class_type))return '<div class="field binding-source image-input" data-image-input="'+i+'"><span>'+label+'</span><button type="button" class="image-input-target" aria-label="Replace '+label+'"><img class="native-source-preview" '+(!value||missing||source?'hidden':'src="/spool/api/input/'+encodeURIComponent(value)+'"')+' alt="'+label+'"><span><strong>'+esc(source?generationSourceLabel(source):!value||missing?'Choose image':'Replace image')+'</strong><small>'+esc(value&&!source&&!missing?String(value).split('/').at(-1):'Paste, drop or click to choose an image')+'</small></span></button><input type="file" accept="image/*" data-image-file hidden></div>';
 let field=typeof value==='boolean'?'<select data-native-control="'+i+'"><option value="true" '+(value?'selected':'')+'>On</option><option value="false" '+(!value?'selected':'')+'>Off</option></select>':isInt(value)&&b.contract?.inputType!=='FLOAT'?'<input type="text" inputmode="numeric" data-exact-integer="true" data-native-control="'+i+'" value="'+esc(decimal(value))+'">':typeof value==='number'?'<input type="number" step="any" data-native-control="'+i+'" value="'+esc(value)+'">':'<textarea data-native-control="'+i+'">'+esc(value??'')+'</textarea>';
 if(source)field='<span class="native-source-value">'+esc(generationSourceLabel(source))+'</span>';
 else if(b.role==='source'||b.options){
  const input=productDefinitions[b.contract?.classType]?.input?.required?.[b.input],options=b.options||(Array.isArray(input?.[0])?input[0]:input?.[1]?.options||[]);
  field='<select data-native-control="'+i+'">'+[...new Set([value,...options])].map(v=>'<option value="'+esc(v)+'" '+(v===value?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select>';
 }
 if(b.role==='seed'){
  const mode=!c.seedKey||c.seedKey===b.key?c.seedMode||'same':'same';
  field='<div class="seed-controls">'+field+'<select data-seed-mode="'+esc(b.key)+'" aria-label="'+label+' behavior">'+[['same','Fixed'],['increment','Increment'],['decrement','Decrement'],['randomize','Randomize']].map(([id,name])=>'<option value="'+id+'" '+(id===(mode==='different'?'increment':mode)?'selected':'')+'>'+name+'</option>').join('')+'</select></div>';
 }
 return '<label class="field binding-'+esc(b.role||'other')+'"><span>'+label+'</span>'+field+'</label>';
}
let imagePreviewTicket=0;
function bindImageInputs(c){
 const ticket=++imagePreviewTicket;
 const fields=[...$('inspectorContent').querySelectorAll('[data-image-input]')];
 for(const field of fields){
  const index=Number(field.dataset.imageInput),button=field.querySelector('button'),picker=field.querySelector('input');
  const replace=async files=>{if(button.disabled)return;if(files.length!==1){toast('Choose one image for this input.');return;}button.disabled=true;try{await replaceInputImage(c,index,files[0]);}catch(error){toast(error.message);}finally{button.disabled=false;}};
  button.onclick=()=>picker.click();picker.onchange=()=>replace([...picker.files]);
  field.onpaste=e=>{const files=[...e.clipboardData.items].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();e.stopPropagation();void replace(files);}};
  field.ondragover=e=>{e.preventDefault();e.stopPropagation();field.classList.add('drag-over');};field.ondragleave=()=>field.classList.remove('drag-over');
  field.ondrop=e=>{e.preventDefault();e.stopPropagation();field.classList.remove('drag-over');void replace([...e.dataTransfer.files]);};
 }
 if(fields.some(field=>(c.shotInputs||[]).some(s=>s.key===c.bindings[Number(field.dataset.imageInput)].key))){
  const signature=clipWorkflowLink(c).sourceKey,current=()=>ticket===imagePreviewTicket&&selected()?.id===c.id&&clipWorkflowLink(selected()).sourceKey===signature&&fields.some(field=>field.isConnected);
  void flushNative().then(()=>current()?request('projects/'+projectKey+'/generation-preview',{revision:projectEdit.revision,clipId:c.id}):null).then(preview=>{if(!preview||!current())return;for(const field of fields){const b=c.bindings[Number(field.dataset.imageInput)],asset=preview.assets.find(a=>a.nodeId===b.nodeId&&a.input===b.input);if(asset&&field.isConnected){const image=field.querySelector('img');image.src='/spool/api/input/'+encodeURIComponent(asset.frozen);image.hidden=false;}}}).catch(error=>{if(current()&&error.status!==409)toast(error.message);});
 }
}
function useTimelineVideo(clipId,index){
 const c=state.clips.find(c=>c.id===clipId);if(!c)return;
 const b=c.bindings[index],current=take(c);if(b.slot!=='video'||current.placeholder||current.media.kind!=='video')return;
 inputReplacements.choose(c.id,b.key);
 if(c.shotInputs?.some(s=>s.key===b.key&&s.source==='selected'))return;
 edits.apply('Use timeline video',()=>{c.shotInputs=[...(c.shotInputs||[]).filter(s=>s.key!==b.key),{key:b.key,source:'selected'}];c.revision++;},'inspector');
 $('inspectorContent').querySelector('[data-media-input="'+index+'"] [data-use-timeline-video]')?.focus({preventScroll:true});
}
async function replaceInputMedia(c,index,file){
 const b=c.bindings[index];
 const allowed=b.slot==='video'?/\.(mp4|mov|mkv|webm|m4v)$/i:/\.(wav|mp3|ogg|flac|m4a)$/i;
 if(!allowed.test(file.name))throw Error('Choose a '+b.slot+' file.');
 const replacement=inputReplacements.begin(c,b.key);
 try{
 const uploaded=await api.upload('projects/'+projectKey+'/input',file,file.name,{fallback:'Could not save this input.'});
 const current=state.clips.find(clip=>clip.id===c.id);
 if(!replacement.owns(current))throw Error('This input changed while uploading. Choose the file again.');
 edits.apply('Replace '+b.label,()=>{current.inputValues[b.key]=uploaded.file;current.shotInputs=(current.shotInputs||[]).filter(s=>s.key!==b.key);current.revision++;},'inspector');await flushNative();toast(b.label+' replaced');
 }finally{replacement.finish();}
}
async function replaceInputImage(c,index,file){
 if(!file.type.startsWith('image/'))throw Error('Choose an image file.');
 const b=c.bindings[index];
 if(file.size>100*1024*1024)throw Error('Choose an image smaller than 100 MB.');
 const replacement=inputReplacements.begin(c,b.key);
 try{
 let blob=file,extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[file.type];const bitmap=await createImageBitmap(file);if(!extension){const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));extension='png';}bitmap.close();
 const uploaded=await api.upload('projects/'+projectKey+'/input',blob,file.name?.replace(/\.[^.]+$/,'')+'.'+extension||'image.'+extension,{fallback:'Could not save this input image.'});
 const current=state.clips.find(clip=>clip.id===c.id);
 if(!replacement.owns(current))throw Error('The input changed while uploading. Choose the image again.');
 const value=uploaded.file;
 edits.apply('Replace '+b.label,()=>{current.inputValues[b.key]=value;current.shotInputs=(current.shotInputs||[]).filter(s=>s.key!==b.key);current.revision++;},'inspector');await flushNative();toast(b.label+' replaced');
 }finally{replacement.finish();}
}
const countLabel=document.createElement('label');countLabel.className='native-count';countLabel.innerHTML='Takes <input id="nativeCount" aria-label="Number of takes" type="number" min="1" max="16" value="1">';$('generate').before(countLabel);
const jobStatus=document.createElement('span');jobStatus.className='native-job-status';$('generate').after(jobStatus);
// Media evidence — the probe and the workflow Comfy embedded in a render — lives
// outside the working document and is stored once per media id. The projection
// keeps `media.evidence`, a list naming what exists, so enablement stays
// synchronous; only the payload is fetched, and only when a surface opens it.
const evidenceCache=new Map();
async function mediaEvidence(m){
 if(!m?.id||!Array.isArray(m.evidence)||!m.evidence.length)return null;
 if(evidenceCache.has(m.id))return evidenceCache.get(m.id);
 const held=await request('projects/'+projectKey+'/media/'+encodeURIComponent(m.id)+'/evidence');
 evidenceCache.set(m.id,held);
 return held;
}
async function mediaWorkflowData(m){
 if(m.workflowData)return m.workflowData;
 const kinds=Array.isArray(m.evidence)?m.evidence:null;
 if(!kinds?.includes('workflowData'))return null;
 return (await mediaEvidence(m))?.workflowData||null;
}
// A take's editable graph may be a saved recipe, a snapshot frozen in the document,
// or evidence embedded in the render. Answer whether one exists without fetching it.
function editableGraph(c){
 const recipe=nativeRecipes[c.workflowVersion]||workflows[c.workflow]?.data;
 if(Array.isArray(recipe?.workflow?.nodes)||c.generationBase&&recipe?.prompt)return {capture:recipe};
 const t=take(c),m=t?.media;
 const snapshot=t?.workflowSnapshot||t?.request?.capture;
 if(Array.isArray(snapshot?.workflow?.nodes))return {capture:snapshot};
 const inline=m?.workflowData||(m?.workflow?{workflow:m.workflow,prompt:m.prompt}:null);
 if(Array.isArray(inline?.workflow?.nodes))return {capture:inline};
 return m?.embeddedGraph?{media:m}:null;
}
async function resolvedClipWorkflow(c){
 const graph=editableGraph(c);if(!graph)return null;
 if(graph.capture)return graph.capture;
 const held=await mediaEvidence(graph.media);
 return held?.workflowData||(held?.workflow?{workflow:held.workflow,prompt:held.prompt}:null);
}
function clipWorkflowLink(c){return {projectId:projectKey,clipId:c.id,editorId:focusViewId,sidecarSha:linkedSidecarHashes.get(c.id)??nativeRecipes[c.workflowVersion]?.sidecar?.sha256??'',sourceKey:JSON.stringify({graphFormat:'workflow',version:c.workflowVersion,take:c.takeId,values:Object.fromEntries(Object.entries(c.inputValues||{}).map(([key,value])=>[key,isInt(value)?decimal(value):value])),sources:c.shotInputs||[],in:c.in,out:c.out,fps})};}
async function openNativeWorkflow(){
 const tab=bridgeReady!==true?window.open('about:blank','_blank'):null;
 if(tab){tab.document.title='Opening Comfy workflow';tab.document.body.textContent='Spool is connecting to Comfy...';}
 try{
  await projectEdit.prepareNavigation();if(!selected())throw Error('Select a clip first.');const c=copy(selected());
  const saved=c.workflowVersion?await request('workflows/'+c.workflowVersion):await resolvedClipWorkflow(c);
  const current=!take(c)?.placeholder?await request('projects/'+projectKey+'/take-workflow/'+encodeURIComponent(c.id)+'/'+encodeURIComponent(c.takeId)):null;
  linkedSidecarHashes.set(c.id,current?.sidecar?.sha256||'');
  const capture=current?.sidecar?current:saved,link=clipWorkflowLink(c);
  if(!capture)throw Error('This clip has no workflow graph');
  if(!capture.workflow?.nodes?.length)throw Error('This recipe has no editable Comfy graph. Import the original workflow to edit it in Comfy.');
  const prompt=capture.prompt?copy(capture.prompt):null;
  const sameSetup=!capture.sidecar||capture.sidecar.sha256===saved?.sidecar?.sha256;
  const controls=sameSetup?(c.bindings||[]).filter(b=>Object.hasOwn(c.inputValues||{},b.key)).map(b=>({nodeId:b.nodeId,input:b.input,value:c.inputValues[b.key]})):[];
  if(prompt)for(const b of controls)if(prompt[b.nodeId])prompt[b.nodeId].inputs[b.input]=b.value;
  if(prompt&&sameSetup&&c.shotInputs?.length){const preview=await request('projects/'+projectKey+'/generation-preview',{revision:projectEdit.revision,clipId:c.id});for(const asset of preview.assets)prompt[asset.nodeId].inputs[asset.input]=asset.frozen;}
  if(prompt)for(const control of controls){control.value=prompt[control.nodeId].inputs[control.input];if(exactInt(control.value)){const number=Number(decimal(control.value));if(!Number.isSafeInteger(number))throw Error('This control exceeds Comfy’s exact browser integer range. Keep its preserved execution value or choose an exact safe integer before editing in Comfy.');control.value=number;}}
  const result=await host(B.ACTIONS.open,{workflow:capture.workflow,prompt,preferWorkflow:true,controls,name:c.name,link},tab);
  toast(result.reused?'Focused this clip’s linked Comfy workflow.':'Workflow linked. Edit it in Comfy, then choose Apply to clip in Spool.');
 }catch(error){if(tab&&!tab.closed){try{if(tab.location.href==='about:blank')tab.close();}catch{}}toast(error.message);}
}
function paintWorkflowSetup(question){
 const {capture,name,target,choices,result,issue,candidates,savers}=question;
 if(question.exact){
showModal('Configure exact controls','<p>Select literal inputs to expose. Linked inputs keep their edges. Recognized source files are frozen automatically before dispatch.</p><div style="max-height:42vh;overflow:auto">'+candidates.map((b,i)=>'<label class="field"><span><input type="checkbox" data-bind="'+i+'" '+(b.old?'checked':'')+'> '+esc(b.nodeId)+' · '+esc(capture.prompt[b.nodeId].class_type)+' / '+esc(b.input)+'</span><input data-bind-label="'+i+'" value="'+esc(b.old?.label||b.input)+'" aria-label="Control label"></label>').join('')+'</div><div class="three-fields"><label class="field"><span>Result saver</span><select id="nativeSaver">'+savers.map(([id,n])=>'<option value="'+esc(id)+'" '+(capture.result?.nodeId===id?'selected':'')+'>'+esc(id)+' · '+esc(n.class_type)+'</option>').join('')+'</select></label><label class="field"><span>History group</span><select id="nativeGroup">'+['images','gifs','videos'].map(g=>'<option '+(capture.result?.group===g?'selected':'')+'>'+g+'</option>').join('')+'</select></label><label class="field"><span>Artifact index (0-based)</span><input id="nativeIndex" type="number" min="0" value="'+(capture.result?.index||0)+'"></label></div><p class="audio-note">All normal output branches execute. This selection chooses which reported artifact enters review. VHS meta_batch is unsupported. A Submit node routes this recipe to Deadline with one job per take. Host widget capture cannot recover integers already rounded by Comfy; raw API JSON preserves 64-bit values.</p><label class="field"><span><input type="checkbox" id="keepOverrides"> Keep existing Spool control overrides instead of newly captured values</span></label>','<button class="outline" id="captureCancel">Cancel</button><button class="primary" id="captureSave">Save to clip</button>');
  $('captureCancel').onclick=closeModal;
  $('captureSave').onclick=()=>question.confirm('inputs',{
   bindings:candidates.flatMap((b,i)=>$('modal').querySelector('[data-bind="'+i+'"]').checked?[{index:i,label:$('modal').querySelector('[data-bind-label="'+i+'"]').value}]:[]),
   result:{nodeId:$('nativeSaver').value,group:$('nativeGroup').value,index:Number($('nativeIndex').value)},keep:$('keepOverrides').checked
  });
  return;
 }
 const values=question.essential,optional=question.optional,graphOnly=!capture.prompt&&Array.isArray(capture.workflow?.nodes);
  showModal(graphOnly?'Prepare this workflow?':capture.prompt?'Capture inputs from this workflow?':'Add this workflow?',
   '<p>'+esc(name)+'</p>'+(graphOnly?'<p>Spool will open this workflow in a separate Comfy tab and prepare its settings for generation. Comfy starts if needed. Preparing does not generate a take.</p>':issue?'<p>'+esc(issue)+'</p>':'<p>Choose the key inputs to edit in Spool. Everything else keeps its saved settings.</p>')+
   (!issue&&choices.length>1?'<label class="field"><span>Which output belongs to this clip?</span><select id="captureOutput"><option value="">Choose output…</option>'+choices.map((r,i)=>'<option value="'+i+'" '+(result===r?'selected':'')+'>'+esc(r.label)+' · output '+(i+1)+'</option>').join('')+'</select></label>':'')+
   '<div class="native-capture-values">'+values.map((b,i)=>'<label><input type="checkbox" data-key-input="'+i+'" checked> '+esc(b.label)+'<output>'+esc(exactInt(b.value)?decimal(b.value):b.value)+'</output></label>').join('')+'</div>'+
   (!issue&&result&&!values.length?'<p class="audio-note">No supported key inputs found. You can use the workflow’s saved settings.</p>':'')+
   (optional.length?'<details class="native-advanced"><summary>Optional controls</summary>'+optional.map((b,i)=>'<label class="field"><span><input type="checkbox" data-optional-input="'+i+'"> '+esc(b.label)+'</span></label>').join('')+'</details>':'')+
   (target&&Object.keys(target.inputValues||{}).length?'<label class="field"><span><input type="checkbox" id="keepKeyOverrides"> Keep my Spool input changes</span></label>':''),
   '<button class="outline" id="keyCaptureCancel">Cancel</button>'+(!issue?'<button class="outline" id="keyCaptureSaved" '+(!result?'disabled':'')+'>Use saved settings</button><button class="primary" id="keyCaptureSave" '+(!result?'disabled':'')+'>Capture</button>':graphOnly?'<button class="outline" id="keyCaptureGraph">Save workflow only</button><button class="primary" id="keyCapturePrepare">Prepare in Comfy</button>':'<button class="primary" id="keyCaptureGraph">Add workflow only</button>'));
 $('keyCaptureCancel').onclick=closeModal;
 if($('captureOutput'))$('captureOutput').onchange=e=>question.chooseOutput(e.target.value);
 const selection=()=>({essential:values.flatMap((b,i)=>$('modal').querySelector('[data-key-input="'+i+'"]').checked?[i]:[]),optional:optional.flatMap((b,i)=>$('modal').querySelector('[data-optional-input="'+i+'"]').checked?[i]:[]),keep:$('keepKeyOverrides')?.checked});
 if($('keyCaptureGraph'))$('keyCaptureGraph').onclick=()=>question.confirm('graph');
 if($('keyCaptureSaved'))$('keyCaptureSaved').onclick=()=>question.confirm('saved',selection());
 if($('keyCaptureSave'))$('keyCaptureSave').onclick=()=>question.confirm('inputs',selection());
 if(graphOnly)$('keyCapturePrepare').onclick=()=>{const graph={...capture,importedWorkflowId:question.session.workflowId};closeModal();prepareWorkflow(graph,name,question.session.index,question.session.clipId);};
}
async function saveWorkflowSetup({session,capture,name,clipId,index,mode,keep,exact,automatic}){
 let c=clipId?state.clips.find(c=>c.id===clipId):null;
 if(session.replaceInputs){const link=capture.provenance?.spoolLink;if(!c||link?.projectId!==projectKey||link.clipId!==clipId||clipWorkflowLink(c).sourceKey!==link.sourceKey)throw Error('This clip changed while Comfy was being captured. Reopen its workflow before applying changes.');}
 if(clipId)inputReplacements.invalidate(clipId);
 if(session.takeId){
  const before=copy(state);
  const {adopted}=await projectEdit.change(revision=>request('projects/'+projectKey+'/use-take/'+encodeURIComponent(clipId),{revision,takeId:session.takeId,capture:mode==='graph'?null:capture}),true);
  if(adopted){history.record(before,'Use take and generation setup');review.used(clipId);markTakesSeen([session.takeId]);state.frame=clamp(state.frame,0,total());render();saveView();toast(capture&&mode!=='graph'?'Take in edit. Next generation uses its metadata.':'Take in edit. No executable metadata; choose a workflow from the library.');}
  else toast('Take setup saved. Reload to adopt it after resolving your local edit.');
  return;
 }
 const prepared=nativeRecipes[session.preparedVersion],reuse=prepared&&['nodeId','group','index'].every(key=>prepared.result[key]===capture.result?.[key])&&prepared.bindings.length===capture.bindings.length&&capture.bindings.every((b,i)=>reusableBinding(prepared.bindings[i],b)&&prepared.bindings[i].label===b.label);
 if(!c){const w=session.workflowId?workflows[session.workflowId]:registerWorkflowData(capture,name);addImportedWorkflowClip(w.id,index,null,session.placement,reuse?session.preparedVersion:null);c=selected();session.added=true;if(!reuse)await flushNative();}
 if(reuse){if(clipId)edits.apply('Replace workflow',()=>applyPreparedWorkflow(c,session.workflowId,session.preparedVersion));await flushNative();session.savedClipId=c.id;toast('Workflow prepared. Ready to generate.');return;}
 if(mode==='graph'){if(clipId){edits.apply('Update workflow graph',()=>{const w=registerWorkflowData({workflow:capture.workflow,prompt:capture.prompt,provenance:capture.provenance},name);c.workflow=w.id;delete c.workflowVersion;c.bindings=[];c.inputValues={};},'none');await flushNative();}toast('Workflow saved. Select the shot and click Prepare when ready.');return;}
 const before=copy(state),overrides=keep?Object.fromEntries(capture.bindings.filter(b=>Object.hasOwn(c.inputValues||{},b.key)).map(b=>[b.key,c.inputValues[b.key]])):undefined;
 const {adopted}=await projectEdit.change(revision=>request('projects/'+projectKey+'/capture/'+encodeURIComponent(c.id),{revision,capture,overrides,resetInputs:!!(session.replaceInputs||session.replaceWorkflow),saveSidecar:!!session.replaceInputs}));
 if(adopted){
  if(clipId&&!session.replaceInputs){const updated=state.clips.find(c=>c.id===clipId);if(updated){const workflow=workflows[session.workflowId]||registerWorkflowData(capture,name);updated.workflow=workflow.id;if(session.replaceWorkflow){updated.executionTarget=capture.executionTarget||'local';matchClipInputs(updated,before.clips.find(c=>c.id===clipId),nativeRecipes[updated.workflowVersion],definitionsFor(updated),fps);}save();await flushNative();renderInspector();}}
  if(!session.added)history.record(before,session.replaceInputs?'Apply Comfy workflow':exact?'Save workflow to clip':session.replaceWorkflow?'Replace workflow':'Capture clip inputs');
  session.savedClipId=c.id;buttons();saveHistory();saveView();
  if(session.replaceInputs){session.applied=true;const current=state.clips.find(c=>c.id===clipId);linkedSidecarHashes.set(clipId,nativeRecipes[current.workflowVersion]?.sidecar?.sha256||'');try{await bridgeClient?.call(B.LINK_APPLIED,{previous:capture.provenance.spoolLink,next:clipWorkflowLink(current)});}catch{}toast('Comfy changes applied to '+current.name);return;}
  toast(exact?'Immutable workflow version saved. Existing take requests are unchanged.':automatic?'Workflow prepared. Ready to generate.':'Clip updated. Previous take settings are preserved.');
 }
 else toast('Capture saved; newer local edits kept. Update again to adopt it.');
}
const workflowSetup=createWorkflowSetup({edit:projectEdit,flush:flushNative,clip:id=>state.clips.find(c=>c.id===id),save:saveWorkflowSetup,
 dialog:{show:paintWorkflowSetup,close:closeModal,error:error=>toast(error.message),lock(){
  // Keep library navigation available while the committed capture owns the edit.
  const editor=$('editor'),panel=$('mediaPanel'),before=workflowLocked,focused=document.activeElement;
  const targets=[...editor.children].filter(node=>node!==panel).concat([...panel.children].filter(node=>!node.classList.contains('panel-head')),$('importTop'));
  const inert=targets.map(node=>[node,node.inert]);workflowLocked=true;clearHeld();
  for(const [node]of inert)node.inert=true;
  return()=>{for(const [node,value]of inert)node.inert=value;workflowLocked=before;if(document.activeElement===document.body)(focused?.isConnected&&focused.getClientRects().length?focused:editor).focus({preventScroll:true});};
 }}
});
async function configureCapture(origin,initial=null){
 const c=selected();if(!c)return;
 try{await workflowSetup.start({name:c.name,clipId:c.id,exact:true,previous:nativeRecipes[c.workflowVersion],capture:async()=>{
  let capture;
  if(origin==='host'){capture=initial||await host(B.ACTIONS.capture);if(c.workflowVersion){const previous=await request('workflows/'+c.workflowVersion);capture.bindings=(previous.bindings||[]).filter(b=>capture.prompt[b.nodeId]?.class_type===previous.prompt[b.nodeId]?.class_type&&Object.hasOwn(capture.prompt[b.nodeId].inputs,b.input)&&(['string','number','boolean'].includes(typeof capture.prompt[b.nodeId].inputs[b.input])||exactInt(capture.prompt[b.nodeId].inputs[b.input])));}}
  else if(origin==='saved')capture=await request('workflows/'+c.workflowVersion);
  else{const data=workflows[c.workflow]?.data;if(!data?.prompt||Array.isArray(data.prompt.nodes))throw Error('Graph-only JSON needs Open workflow, then Save graph to clip through Comfy.');capture={workflow:Array.isArray(data.workflow?.nodes)?data.workflow:null,prompt:copy(data.prompt),provenance:{source:'explicit API import',historicalMetadata:copy(data)}};}
  capture.definitions=capture.definitions||(await request('capabilities')).definitions;return capture;
 }});}catch(error){toast(error.message);}
}

async function importWorkflowFile(file){
 const raw=await file.text();
 const {value,adopted}=await projectEdit.change(async revision=>{
  return api.call('projects/'+projectKey+'/import-workflow',{method:'POST',body:raw,json:false,headers:{'Content-Type':'application/json','X-Filename':encodeURIComponent(file.name),'X-Spool-Revision':String(revision)}});
 },true);
 if(!adopted)throw Error('Workflow imported to the project library. Finish your local edit before adding it.');
 return value.workflow;
}
async function reset(){
 await flushNative();
 showModal('New project','<label>Project name<input id="newProjectName" value="Untitled Spool project"></label><label>Project folder<input id="newProjectFolder" placeholder="Leave empty to use your projects directory"></label>','<button class="primary" id="createProjectFolder">Create project</button>');
 $('createProjectFolder').onclick=async()=>{try{const folder=$('newProjectFolder').value.trim(),name=$('newProjectName').value.trim()||'Untitled Spool project';const created=await request('projects',{document:{project:name,clips:[],media:[]},...(folder?{folder}:{})});location.href=withBridge('/spool/?project='+created.id);}catch(error){toast(error.message);}};
}
async function openProjectFolder(){
 await flushNative();showModal('Open project folder','<label>Folder containing project.spool<input id="openProjectFolderPath" placeholder="X:\\spool\\My project"></label>','<button class="primary" id="openProjectFolderButton">Open project</button>');
 $('openProjectFolderButton').onclick=async()=>{try{const opened=await request('open-project',{folder:$('openProjectFolderPath').value.trim()});location.href=withBridge('/spool/?project='+opened.id);}catch(error){toast(error.message);}};
}

$('reset').title='New project';$('reset').textContent='New project';$('reset').onclick=reset;

function downloadValue(value,suffix=''){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=state.project.replace(/[^a-z0-9]+/gi,'-')+suffix+'.spool.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
async function downloadLocalDraft(){
 const document=copy(projectData()),recipes={};
 for(const c of document.clips)if(c.workflowVersion&&nativeRecipes[c.workflowVersion])recipes[c.workflowVersion]=nativeRecipes[c.workflowVersion];
 // Evidence is stored outside the working document, so a portable draft must ask for
 // it; without it an imported draft would name graphs and probes it cannot supply.
 let evidence={};
 try{evidence=await request('projects/'+projectKey+'/evidence');}catch(error){toast('Downloading the draft without media evidence: '+error.message);}
 downloadValue({spoolVersion:1,document:L.compose(document,evidence),recipes,draftOrigin:{projectId:projectKey,revision:projectEdit.revision,unsaved:true}},'-local-draft');
}
$('projectFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const project=await api.call('import-project',{method:'POST',body:await file.text(),json:false,headers:{'Content-Type':'application/json'}});location.href=withBridge('/spool/?project='+project.id);}catch(error){toast(error.message);}e.target.value='';};
function captureInputs(capture,name,index=state.clips.length,clipId=null,automatic=false){
 return workflowSetup.start({capture,name,index,clipId,automatic,definitions:productDefinitions,previous:nativeRecipes[state.clips.find(c=>c.id===clipId)?.workflowVersion]});
}

async function prepareWorkflow(capture,name,index=state.clips.length,clipId=null){
 const tab=window.open('about:blank','_blank');
 if(!tab){toast('Allow Spool to open a Comfy tab, then prepare again.');return;}
 tab.document.title='Preparing workflow';tab.document.body.textContent='Spool is connecting to Comfy and preparing your workflow…';
 try{await captureInputs(async()=>({...await host('prepare',{workflow:capture.workflow,name,clipId},tab),importedWorkflowId:capture.importedWorkflowId}),name,index,clipId,true);}
 catch(error){tab.close();toast(error.message);}
}
async function updateClipInputs(id,expected=null){
 const c=state.clips.find(c=>c.id===id);
 try{
  if(!c)throw Error('This clip was removed.');
  if(expected&&clipWorkflowLink(c).sourceKey!==expected.sourceKey)throw Error('This clip changed in Spool. Choose Edit in Comfy again.');
  const session=await workflowSetup.start({name:c.name,clipId:id,index:state.clips.indexOf(c),automatic:true,replaceInputs:true,previous:nativeRecipes[c.workflowVersion],definitions:productDefinitions,capture:()=>host(B.ACTIONS.capture,{link:clipWorkflowLink(c)})});
  if(expected){await session.completed;if(!session.applied)throw session.error||Error('Changes were not applied. Finish the workflow setup in Spool.');}
  return session;
 }catch(error){toast(error.message);if(expected)throw error;}
}
async function addNativeGraph(capture,name=capture.name||'Current workflow',index=state.clips.length){await captureInputs(capture,name,index);}
const clipMenu=document.createElement('div');clipMenu.id='native-clip-menu';clipMenu.setAttribute('role','menu');clipMenu.setAttribute('aria-label','Clip actions');clipMenu.hidden=true;document.body.append(clipMenu);
let menuClipId=null,menuOrigin=null;
function closeClipMenu(returnFocus=true){if(clipMenu.hidden)return;clipMenu.hidden=true;if(menuOrigin?.hasAttribute('aria-expanded'))menuOrigin.setAttribute('aria-expanded','false');const origin=menuOrigin?.isConnected?menuOrigin:$('clipLane').querySelector('[data-clip="'+menuClipId+'"]');menuClipId=null;menuOrigin=null;if(returnFocus)origin?.focus({preventScroll:true});}
function unlinkClipAudio(id){const c=state.clips.find(c=>c.id===id);if(!c||!T.linkedAudio(c)||take(c).placeholder)return;pause();edits.apply('Unlink audio and video',()=>{const audio=T.unlinkAudio(state,id,'audio-'+crypto.randomUUID());state.selectedAudio=audio.id;review.rememberMedia(audio.media,audio.in);inspectorTab='audio';editView();});toast('Audio unlinked on A1 - move or trim it independently');}
function unlinkSelectedAudio(){const clips=selectedVideos().filter(c=>T.linkedAudio(c)&&!take(c).placeholder);if(!clips.length)return;pause();edits.apply('Unlink '+clips.length+' clips',()=>{const ids=clips.map(c=>T.unlinkAudio(state,c.id,'audio-'+crypto.randomUUID()).id);setTimelineSelection(ids);inspectorTab='audio';editView();});}
function toggleSelectedEnabled(){if(drag)return;const ids=selectionIds(),clips=[...state.clips,...state.audioClips||[]].filter(c=>ids.includes(c.id));if(!clips.length)return;const value=clips.some(c=>!T.enabled(c));edits.apply(value?'Enable clips':'Disable clips',()=>{pause();T.setEnabled(state,ids,value);});$('editor').focus({preventScroll:true});}
function enableAction(){const ids=selectionIds(),off=[...state.clips,...state.audioClips||[]].some(c=>ids.includes(c.id)&&!T.enabled(c));return {label:off?'Enable clip'+(ids.length>1?'s':''):'Disable clip'+(ids.length>1?'s':''),run:toggleSelectedEnabled};}
$('addVideoTrack').onclick=()=>edits.apply('Add video track',()=>{activeVideoTrack=T.addVideoTrack(state);});
$('timelineScroll').addEventListener('scroll',()=>{$('trackHeaders').style.transform='translateY(-'+$('timelineScroll').scrollTop+'px)';});
function selectionActions(){return [enableAction(),...(selectedVideos().some(c=>T.linkedAudio(c)&&!take(c).placeholder)?[{label:'Unlink audio and video',run:unlinkSelectedAudio}]:[]),{label:'Delete selection',run:()=>remove(false)},{label:'Ripple delete selection',run:()=>remove(true)}];}
function openClipMenu(id,x,y,origin,inspector=false){
 const c=state.clips.find(c=>c.id===id);if(!c)return;closeClipMenu(false);selectClip(id,false,{},true);menuClipId=id;menuOrigin=origin;
 if(selectionIds().length>1){showActionMenu('Selection actions',inspector?[{label:'Delete selection',run:()=>remove(false)}]:selectionActions(),x,y,origin);return;}
 const actions=[...(editableGraph(c)?[
  {label:'Open workflow in Comfy',reason:!bridge&&!productCapabilities.connected?'Start the paired Comfy host.':null,run:()=>openNativeWorkflow()}]:[]),
  {label:'Delete',run:()=>{selectClip(id,false);remove(false);}}
 ];
 if(!inspector){
  actions.unshift(enableAction(),...(T.linkedAudio(c)&&!take(c).placeholder?[{label:'Unlink audio and video',run:()=>unlinkClipAudio(id)}]:[]));
  actions.splice(actions.length-1,0,...(!take(c).placeholder&&take(c).media.kind==='video'?[{label:'Detect cuts\u2026',run:()=>detectClipCuts(id)}]:[]));
 }
 showActionMenu('Clip actions',actions,x,y,origin);
}
function showActionMenu(label,actions,x,y,origin){
 closeClipMenu(false);menuOrigin=origin;clipMenu.className='';clipMenu.setAttribute('aria-label',label);
 clipMenu.innerHTML=actions.map((a,i)=>'<button role="menuitem" data-action="'+i+'" '+(a.reason?'disabled aria-disabled="true"':'')+'>'+esc(a.label)+(a.reason?'<small>'+esc(a.reason)+'</small>':'')+'</button>').join('');
 clipMenu.querySelectorAll('button').forEach(b=>b.onclick=()=>{const action=actions[Number(b.dataset.action)];closeClipMenu();action.run();});
 placeMenu(x,y);
}
function placeMenu(x,y){
 (viewerExpanded?$('viewer'):document.body).append(clipMenu);clipMenu.hidden=false;const rect=clipMenu.getBoundingClientRect();clipMenu.style.left=Math.max(6,Math.min(x,innerWidth-rect.width-6))+'px';clipMenu.style.top=Math.max(6,Math.min(y,innerHeight-rect.height-6))+'px';clipMenu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
}
function showViewerMenu(picture,x,y){
 const available=picture&&!picture.gap&&!picture.take?.placeholder&&['video','image'].includes(picture.media.kind);
 closeClipMenu(false);menuOrigin=$('viewer');clipMenu.className='viewer-menu';clipMenu.setAttribute('aria-label','Viewer actions');
 const detail=available?'Original'+(picture.media.width&&picture.media.height?' · '+picture.media.width+' × '+picture.media.height:''):'Choose a frame from video or an image';
 clipMenu.innerHTML='<button class="menu-action" role="menuitem" aria-label="Export frame" aria-describedby="viewer-menu-export-detail" data-viewer-action="export" '+(available?'':'disabled aria-disabled="true"')+'>'+svg('export')+'<span>Export frame<small id="viewer-menu-export-detail">'+esc(detail)+'</small></span><span class="menu-format">PNG</span></button><div class="menu-divider" role="separator"></div><button class="menu-action" role="menuitem" data-viewer-action="fit">'+svg('fit')+'<span>Fit to viewer</span></button><button class="menu-action" role="menuitem" data-viewer-action="fullscreen">'+svg('expand')+'<span>'+(viewerExpanded?'Exit fullscreen':'Fullscreen')+'</span><kbd>F</kbd></button>';
 clipMenu.querySelector('[data-viewer-action="export"]').onclick=()=>{closeClipMenu();exportViewerFrame(copy(picture));};
 clipMenu.querySelector('[data-viewer-action="fit"]').onclick=()=>{closeClipMenu();resetViewerZoom();};
 clipMenu.querySelector('[data-viewer-action="fullscreen"]').onclick=()=>{closeClipMenu();toggleViewerFullscreen();};
 placeMenu(x,y);
}
document.addEventListener('contextmenu',e=>{e.preventDefault();if(!e.target.closest('#viewer,#timelineScroll'))closeClipMenu(false);});
$('takeList').addEventListener('contextmenu',e=>{
 e.preventDefault();e.stopPropagation();const card=e.target.closest('[data-take]'),c=selected(),take=card&&T.realTakes(c).find(t=>t.id===card.dataset.take);
 if(!take){closeClipMenu(false);return;}
 const path='projects/'+encodeURIComponent(projectKey)+'/take-file/'+encodeURIComponent(c.id)+'/'+encodeURIComponent(take.id);
 showActionMenu('Take file actions',[
  {label:'Reveal in Explorer',run:async()=>{try{await request(path+'/reveal',{});}catch(error){toast(error.message);}}},
  {label:'Download',run:()=>{const a=document.createElement('a');a.href='/spool/api/'+path;a.download='';document.body.append(a);a.click();a.remove();}}
 ],e.clientX,e.clientY,card);
 clipMenu.classList.add('take-file-menu');placeMenu(e.clientX,e.clientY);
});
$('modalOverlay').addEventListener('contextmenu',e=>e.preventDefault());
$('viewer').addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();pause();
 const pane=e.target.closest('.compare-pane');if(pane)selectComparisonPane(Number(pane.id.replace('comparePane','')));
 showViewerMenu(viewerData(),e.clientX,e.clientY);
});
$('trackHeaders').addEventListener('contextmenu',e=>{
 const header=e.target.closest('.track-label'),key=header?.querySelector('[data-track-resize]')?.dataset.trackResize;if(!key)return;e.preventDefault();e.stopPropagation();
 const [kind,number]=key.split(':'),label=kind==='video'?'V'+number:kind==='source'?'A1 / V'+number:'A2';
 showActionMenu(label+' track',[{label:'Delete track',reason:kind==='video'&&T.videoTracks(state)===1?'Keep at least one video track':null,run:()=>{pause();edits.apply('Delete '+label+' track',()=>{T.removeTrack(state,key);setTimelineSelection(selectionIds());state.frame=clamp(state.frame,0,total());});toast(label+' track deleted. Undo restores it.');}}],e.clientX,e.clientY,header);
});
$('timelineScroll').addEventListener('contextmenu',e=>{if(e.target.closest('input,textarea,[contenteditable]'))return;e.preventDefault();e.stopPropagation();if(e.target.closest('#ruler')){closeClipMenu(false);return;}const clip=e.target.closest('[data-clip],[data-linked-audio]'),audio=e.target.closest('[data-audio]');if(clip)openClipMenu(clip.dataset.clip||clip.dataset.linkedAudio,e.clientX,e.clientY,clip);else if(audio){selectAudio(audio.dataset.audio,{},true);showActionMenu(selectionIds().length>1?'Selection actions':'Audio clip actions',selectionIds().length>1?selectionActions():[enableAction(),{label:'Split at playhead',run:splitAudio},{label:'Delete',run:()=>remove(false)}],e.clientX,e.clientY,audio);}else showActionMenu('Timeline actions',[{label:'Paste image to timeline',run:()=>pasteClipboardImage('timeline')}],e.clientX,e.clientY,$('editor'));});
$('mediaPanel').addEventListener('contextmenu',e=>{
 const card=e.target.closest('[data-media]');if(textPasteTarget(e.target))return;e.preventDefault();e.stopPropagation();
 if(!card&&(binTab!=='media'||e.target.closest('button,[role=separator],.panel-head,.pool-toolbar,.workflow-library'))){closeClipMenu(false);return;}
 const m=card&&projectMedia().find(m=>m.id===card.dataset.media);if(card&&!m){closeClipMenu(false);return;}
 const actions=m?[{label:'Remove from media pool',run:()=>removeMedia(m.id)},{label:'Add to timeline',run:()=>addMediaClip(m.id)},...(m.audio?[{label:'Use audio only',run:()=>addAudioClip(m)}]:[])]:[{label:'Paste image to media pool',run:()=>pasteClipboardImage('media')}];
 showActionMenu('Media actions',actions,e.clientX,e.clientY,card||$('editor'));
});
const menuKey=e=>{if(clipMenu.hidden)return;e.stopImmediatePropagation();if(e.type==='keyup')return;const items=[...clipMenu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();closeClipMenu();}else if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)+items.length)%items.length]?.focus();}};
window.addEventListener('keydown',menuKey,true);window.addEventListener('keyup',menuKey,true);
const dismissMenu=e=>{if(!clipMenu.contains(e.target))closeClipMenu(false);};document.addEventListener('pointerdown',dismissMenu,true);
window.addEventListener('pagehide',()=>{closeClipMenu(false);document.removeEventListener('pointerdown',dismissMenu,true);window.removeEventListener('keydown',menuKey,true);window.removeEventListener('keyup',menuKey,true);});
const workflowTabDrag=B.WORKFLOW_TAB_TYPE;
$('timelineScroll').addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes(workflowTabDrag)){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';}},true);
$('timelineScroll').addEventListener('drop',async e=>{if(![...e.dataTransfer.types].includes(workflowTabDrag))return;e.preventDefault();e.stopImmediatePropagation();activeVideoTrack=trackAt(e);state.frame=Math.max(0,Math.round(timelineFrame(e)));try{const ref=JSON.parse(e.dataTransfer.getData(workflowTabDrag)),frame=timelineFrame(e),index=T.dropIndex(state,frame);if(typeof ref.token!=='string'||typeof ref.path!=='string')throw Error('Invalid workflow tab reference');const capture=await host(B.ACTIONS.workflowDrop,{token:ref.token,path:ref.path});await addNativeGraph(capture,capture.name,index);}catch(error){toast(error.message);}},true);
const addGraphButton=document.createElement('button');addGraphButton.id='nativeAddGraph';addGraphButton.className='outline';addGraphButton.textContent='Add current graph';$('showQueue').parentElement.insertBefore(addGraphButton,$('showQueue'));addGraphButton.onclick=async()=>{try{await addNativeGraph(await host(B.ACTIONS.capture));}catch(error){toast(error.message);}};
async function showProjects(){
 try{
  await flushNative();
  const projects=await request('projects'),c=selected(),size=resolution();
  const action=(id,label,icon,disabled=false)=>'<button class="project-dialog-action" id="'+id+'" '+(disabled?'disabled':'')+'>'+svg(icon)+'<span>'+label+'</span></button>';
  const rows=projects.map(p=>'<a class="saved-project-row" '+(p.id===projectKey?'aria-current="page"':'')+' href="'+esc(withBridge('/spool/?project='+encodeURIComponent(p.id)))+'"><span class="saved-project-icon">'+svg('folder')+'</span><span class="saved-project-copy"><strong>'+esc(p.name)+'</strong><small>'+esc(p.unavailable?'Folder unavailable':p.folder||(p.id===projectKey?'Current project':'Open project'))+'</small></span><span class="saved-project-arrow" aria-hidden="true">›</span></a>').join('');
  showModal('Project','<div class="project-dialog-layout"><section aria-labelledby="savedProjectsTitle"><h3 id="savedProjectsTitle">Saved projects <span>'+projects.length+'</span></h3><nav class="saved-project-list" aria-label="Saved projects">'+rows+'</nav>'+action('projectOpenFile','Open project folder…','folder')+'</section><div class="project-dialog-tools"><section class="project-dialog-group"><h3>Current project</h3><div class="project-current-name">'+esc(state.project)+'</div><div class="project-current-meta">'+state.clips.length+' clips · '+fps+' fps · '+size.width+' × '+size.height+'</div>'+action('projectSettings','Project settings…','sliders')+'<div class="project-folder-path">'+esc(BOOT.folder||'')+'</div>'+'</section><section class="project-dialog-group"><h3>Import & tools</h3>'+action('projectImportFootage','Import footage…','import')+action('projectImportVideo','Import video from path…','folder')+action('projectAddWorkflow','Add current workflow','nodes',!bridge&&!productCapabilities.connected)+action('projectDetectCuts','Detect cuts in selected clip…','scissors',!c||take(c).placeholder||take(c).media.kind!=='video')+'</section><section class="project-dialog-group"><h3>Connection</h3>'+action('projectComfySettings','Comfy settings…','settings')+'</section></div></div>','<span>Edits save automatically. Ctrl+S saves now; a save check runs every minute.</span><button class="primary" id="newNativeProject">'+svg('plus')+'New project</button>');
  $('modal').classList.add('project-dialog');
  $('projectOpenFile').classList.add('project-open-file');
  $('newNativeProject').onclick=()=>reset().catch(error=>toast(error.message));
  $('projectOpenFile').onclick=openProjectFolder;
  $('projectAddWorkflow').onclick=()=>{closeModal();addGraphButton.click();};
  $('projectImportFootage').onclick=()=>{closeModal();$('mediaFiles').onchange=e=>importFiles(e.target.files,true);$('mediaFiles').click();};
  $('projectImportVideo').onclick=importFootageDialog;
  $('projectSettings').onclick=projectSettings;
  $('projectComfySettings').onclick=comfySettings;
  $('projectDetectCuts').onclick=()=>detectClipCuts(selected().id);
 }catch(error){toast(error.message);}
}
$('openWorkflow').textContent='⋯';$('openWorkflow').setAttribute('aria-label','Clip actions');$('openWorkflow').title='Clip actions';$('openWorkflow').onclick=e=>{const c=selected();if(c){const rect=e.currentTarget.getBoundingClientRect();openClipMenu(c.id,rect.left,rect.bottom,e.currentTarget,true);}};

const nativeApi={projectKey,diagnostics:()=>diagnostics.snapshot(),get dialogRoot(){return document;},get videoSeek(){return nativeVideoSeekGuard.status(shownVideo);},get revision(){return projectEdit.revision;},get state(){return state;},get laneDraws(){return laneDraws;},get laneNodes(){return laneNodes;},flush:flushNative,poll:pollNative,host,editWorkflow:openNativeWorkflow,applyWorkflow:updateClipInputs,configureCapture,queueClips,selectClip,undo,redo,setFrame,duplicate,split,chooseTake,viewTake,get dirty(){return projectEdit.dirty;},get drag(){return drag;},get view(){return viewState();}};

if(params.has('clip')&&state.clips.some(c=>c.id===params.get('clip')))setTimelineSelection([params.get('clip')]);
if(params.has('frame')&&Number.isFinite(Number(params.get('frame'))))state.frame=clamp(Number(params.get('frame')),0,total());
if(params.has('clip')||params.has('frame')){const address=new URL(location.href);address.searchParams.delete('clip');address.searchParams.delete('frame');window.history.replaceState(null,'',address);}
if(state.selected&&!state.clips.some(c=>c.id===state.selected)||!Array.isArray(state.selection)&&!state.selectedAudio&&!state.selected)state.selected=state.clips[0]?.id||null;
state.frame=clamp(state.frame,0,total());

try{const saved=sessionStorage.getItem(VIEW_KEY+':history'),parsed=saved?JSON.parse(saved):null;if(parsed?.project&&editingSignature(JSON.parse(parsed.project))===editingSignature(projectData()))history.load(saved);}catch(error){}
const {createTopbar}=await import('/spool/ui/topbar.js');
const {createWorkflowLibrary}=await import('/spool/ui/workflow-library.js');
workflowLibrary=createWorkflowLibrary({root:$('editor'),templates:()=>api.call('templates').catch(()=>{throw Error('Studio templates unavailable. Restart Comfy to load the updated extension.');}),projectWorkflows:()=>workflows,selectedWorkflow:()=>selected()?.workflow,onProject:addLibraryShot,onBuiltin:addBuiltinShot,onSettings:comfySettings,hasApiKey:()=>!!productCapabilities.hasApiKey,cloudReady:()=>productCapabilities.cloudExecution!==false,onTemplates:browseComfyTemplates,onCurrent:async()=>{try{await addNativeGraph(await host(B.ACTIONS.capture));}catch(error){toast(error.message);}},onImport:()=>pickImport(false,true),revealMedia(){setBinTab('workflows');if(innerWidth<=1100)$('mediaPanel').classList.add('open');else $('workbench').classList.remove('hide-media');}});
topbar=createTopbar($('editor'),{projects:showProjects,settings:projectSettings,activity:showActivity,connection:()=>connectionButton.click(),workflows:()=>workflowLibrary.toggle(),save:saveProjectNow,sync:()=>pollNative(),conflict:showConflict});
topbar.save(latestSaveStatus);renderConnection();
if(builtinCatalog.unavailable)toast('Built-in workflows could not load. Reload Spool to try again; your projects and own workflows still work.');
const setupIssues=productCapabilities.requirements?.missing||[];
if(setupIssues.length){const setup=document.createElement('button');setup.id='setupWarning';setup.type='button';setup.className='setup-warning';setup.textContent='Setup needed';setup.title=setupIssues.join('\n');setup.onclick=()=>showModal('Finish setting up Spool','<ul class="setup-issues">'+setupIssues.map(issue=>'<li>'+esc(issue)+'</li>').join('')+'</ul><p class="small">Restart ComfyUI after installing, then reload Spool.</p>');$('workspaceMenu').before(setup);}
icons();render();save();
if(isFailed())throw Error('Initialization cancelled');
const generationClock=setInterval(()=>{if(!editorVisible())return;renderJobStatus();for(const el of document.querySelectorAll('[data-job-elapsed]')){const job=state.jobs.find(j=>j.id===el.dataset.jobElapsed);if(job)el.textContent=G.jobElapsed(job);}},1000);
const pollTimer=setInterval(()=>pollNative(true),1200),saveTimer=setInterval(()=>saveProjectNow(false),60000);
const resumeSync=()=>{if(editorVisible()&&!playing)pollNative();};
window.addEventListener('focus',resumeSync);document.addEventListener('visibilitychange',resumeSync);
request('comfy').then(value=>{if(isFailed())return;comfyConnection=value;renderConnection();if(value.settings.autoStart&&value.state==='stopped')ensureComfy().catch(error=>toast(error.message));}).catch(()=>{});
window.addEventListener('pagehide',()=>{builtinPreparer.dispose();templateBrowser?.dispose();clearInterval(diagnosticsTimer);clearInterval(pollTimer);clearInterval(saveTimer);clearInterval(generationClock);clearTimeout(viewSaveTimer);inspectorNotes.dispose();window.removeEventListener('storage',seenStorage);persistView();resizeObserver.disconnect();panelObserver.disconnect();viewerObserver.disconnect();pause();window.removeEventListener('focus',resumeSync);document.removeEventListener('visibilitychange',resumeSync);interruptions.dispose();window.removeEventListener('keydown',saveShortcut,true);window.removeEventListener('keyup',saveShortcut,true);stopWorkflowApply?.();bridgeClient?.close();});
return nativeApi;

}
