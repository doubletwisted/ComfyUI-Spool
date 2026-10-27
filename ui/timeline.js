import {inheritLineage} from './ledger.js';
// Authored timeline operations mutate the supplied document. UI and persistence stay in the editor.
export const MIN_FRAMES=6, SPLIT_MARGIN=6, SNAP_PIXELS=7;
const copy=x=>JSON.parse(JSON.stringify(x));
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const defaultAudioTracks={sourceMuted:false,sourceSolo:false,musicMuted:false,musicSolo:false};
export const takeOf=c=>c.takes.find(t=>t.id===c.takeId)||c.takes[0];
export const realTakes=c=>c?.takes.filter(t=>!t.placeholder&&(!c.hiddenTakeIds?.includes(t.id)||t.id===c.takeId))||[];
export function hideTakes(c,ids){const selected=new Set(ids),removed=realTakes(c).filter(t=>selected.has(t.id)&&t.id!==c.takeId).map(t=>t.id);if(removed.length)c.hiddenTakeIds=[...new Set([...c.hiddenTakeIds||[],...removed])];return removed;}
export const videoTrack=c=>c.videoTrack||1;
export const videoTracks=doc=>Math.max(doc.videoTracks||1,...doc.clips.map(videoTrack));
export const enabled=c=>c.enabled!==false;
export const videoTrackEnabled=(doc,track)=>!(doc.disabledVideoTracks||[]).includes(track);
export const videoEnabled=(doc,c)=>enabled(c)&&videoTrackEnabled(doc,videoTrack(c));
export function setVideoTrackEnabled(doc,track,value){doc.disabledVideoTracks=[...new Set(doc.disabledVideoTracks||[])].filter(t=>t!==track);if(!value)doc.disabledVideoTracks.push(track);}
export const trackClips=(doc,track)=>doc.clips.filter(c=>videoTrack(c)===track);
const tailGap=(doc,track)=>track===1||doc._track===track?doc.tailGap||0:doc.videoTailGaps?.[track]||0;
function setTailGap(doc,track,frames){if(track===1||doc._track===track)doc.tailGap=frames;else if(frames||doc.videoTailGaps?.[track]){doc.videoTailGaps??={};doc.videoTailGaps[track]=frames;}}
export const videoTotal=doc=>Math.max(0,...Array.from({length:videoTracks(doc)},(_,i)=>trackClips(doc,i+1).reduce((n,c)=>n+(c.gapBefore||0)+c.out-c.in,tailGap(doc,i+1))));
export const total=doc=>Math.max(videoTotal(doc),...(doc.audioClips||[]).map(c=>c.start+c.out-c.in));
export const rowFor=(doc,id)=>layout(doc).find(r=>r.clip.id===id);
export function isSharedEdge(doc,index,edge){const c=doc.clips[index],clips=trackClips(doc,videoTrack(c)),i=clips.indexOf(c);return edge==='in'?i>0&&!c.gapBefore:edge==='out'?i<clips.length-1&&!gapAfter(doc,index):false;}
export function dropIndex(doc,frame,ignoreId,track=1){const rows=layout(doc).filter(r=>videoTrack(r.clip)===track&&r.clip.id!==ignoreId),next=rows.find(r=>frame<=(r.start+r.end)/2);const remaining=doc.clips.filter(c=>c.id!==ignoreId);return next?remaining.indexOf(next.clip):remaining.length;}
export const snapPoints=(doc,ignoreId)=>{const ignored=new Set(Array.isArray(ignoreId)?ignoreId:[ignoreId]);return [0,...layout(doc).filter(r=>!ignored.has(r.clip.id)).flatMap(r=>[r.start,r.end])];};
export function snap(points,frame,toleranceFrames){const near=points.find(p=>Math.abs(p-frame)<toleranceFrames);return near===undefined?Math.round(frame):near;}
export function snapMove(doc,ids,delta,toleranceFrames,points=snapPoints(doc,ids)){
 const selected=new Set(ids),edges=[...layout(doc).filter(r=>selected.has(r.clip.id)).flatMap(r=>[r.start,r.end]),...(doc.audioClips||[]).filter(c=>selected.has(c.id)).flatMap(c=>[c.start,c.start+c.out-c.in])];
 let adjustment=0,distance=toleranceFrames;
 for(const edge of edges)for(const point of points){const gap=point-edge-delta;if(Math.abs(gap)<distance){adjustment=gap;distance=Math.abs(gap);}}
 return Math.round(delta+adjustment);
}
export const splitTarget=(doc,frame,id)=>{const rows=layout(doc).filter(r=>frame>r.start+SPLIT_MARGIN-1&&frame<r.end-SPLIT_MARGIN+1);return (id?rows.find(r=>r.clip.id===id):rows.sort((a,b)=>videoTrack(b.clip)-videoTrack(a.clip))[0])||null;};
export function layout(doc){const ends=new Map();return doc.clips.map(c=>{const track=videoTrack(c),gapStart=ends.get(track)||0,start=gapStart+(c.gapBefore||0),row={clip:c,gapStart,start,end:start+c.out-c.in};ends.set(track,row.end);return row;});}
export function visibleRow(doc,frame){return layout(doc).filter(r=>videoEnabled(doc,r.clip)&&frame>=r.start&&frame<r.end).sort((a,b)=>videoTrack(b.clip)-videoTrack(a.clip))[0]||null;}
export function gapAfter(doc,index){const c=doc.clips[index],clips=trackClips(doc,videoTrack(c)),next=clips[clips.indexOf(c)+1];return next?next.gapBefore||0:tailGap(doc,videoTrack(c));}
export function setGapAfter(doc,index,frames){if(gapAfter(doc,index)===frames)return;const c=doc.clips[index],clips=trackClips(doc,videoTrack(c)),next=clips[clips.indexOf(c)+1];if(next)next.gapBefore=frames;else setTailGap(doc,videoTrack(c),frames);}
function trackDocument(doc,track){return {...doc,_track:track,clips:trackClips(doc,track),tailGap:tailGap(doc,track)};}
function commitTrack(doc,track,part){const first=doc.clips.findIndex(c=>videoTrack(c)===track),others=doc.clips.filter(c=>videoTrack(c)!==track);others.splice(first<0?others.length:first,0,...part.clips);doc.clips=others;setTailGap(doc,track,part.tailGap||0);}
function applyClipEdit(doc,d,delta){
 const track=videoTrack(d.original),part=trackDocument(doc,track),before=trackDocument(d.before,track),index=before.clips.findIndex(c=>c.id===d.id);
 const applied=applyTrackEdit(part,{...d,index,before},delta);commitTrack(doc,track,part);return applied;
}
function applyTrackEdit(doc,d,delta){
 if(d.mode==='trim'&&d.afterGap===undefined)d.afterGap=d.before.clips[d.index+1]?.gapBefore||(!d.before.clips[d.index+1]?d.before.tailGap:0)||0;
 const c=doc.clips.find(c=>c.id===d.id),o=d.original,index=doc.clips.indexOf(c);
 if(d.kind==='slip'){delta=clamp(delta,-o.in,takeOf(c).media.frames-o.out);c.in=o.in+delta;c.out=o.out+delta;}
 else if(d.kind==='slide'){const prev=doc.clips[index-1],next=doc.clips[index+1],a=d.before.clips[index-1],b=d.before.clips[index+1];delta=clamp(delta,Math.max(a.in+MIN_FRAMES-a.out,-b.in),Math.min(takeOf(prev).media.frames-a.out,b.out-MIN_FRAMES-b.in));prev.out=a.out+delta;next.in=b.in+delta;}
 else if(d.mode==='roll'){
  if(d.kind==='out'){const n=doc.clips[index+1],orig=d.before.clips[index+1];delta=clamp(delta,Math.max(o.in+MIN_FRAMES-o.out,-orig.in),Math.min(takeOf(c).media.frames-o.out,orig.out-MIN_FRAMES-orig.in));c.out=o.out+delta;n.in=orig.in+delta;}
  else{const n=doc.clips[index-1],orig=d.before.clips[index-1];delta=clamp(delta,Math.max(-o.in,orig.in+MIN_FRAMES-orig.out),Math.min(o.out-MIN_FRAMES-o.in,takeOf(n).media.frames-orig.out));c.in=o.in+delta;n.out=orig.out+delta;}
 }else if(d.kind==='in'){
  delta=clamp(delta,d.mode==='trim'?Math.max(-o.in,-(o.gapBefore||0)):-o.in,o.out-MIN_FRAMES-o.in);c.in=o.in+delta;
  if(d.mode==='trim'&&(c.gapBefore||0)!==(o.gapBefore||0)+delta)c.gapBefore=(o.gapBefore||0)+delta;
 }else{
  delta=clamp(delta,o.in+MIN_FRAMES-o.out,d.mode==='trim'&&index<doc.clips.length-1?Math.min(takeOf(c).media.frames-o.out,d.afterGap):takeOf(c).media.frames-o.out);c.out=o.out+delta;
  if(d.mode==='trim'&&(index<doc.clips.length-1||d.afterGap))setGapAfter(doc,index,Math.max(0,d.afterGap-delta));
 }
 return delta;
}
export const audioTrack=c=>c.track==='source'?'source':'music';
export const sourceLane=c=>c.sourceLane||1;
export const linkedAudio=c=>!c.audioDetached&&!!takeOf(c)?.media.audio;
function audioOccupancy(doc,track,ignore,lane=sourceLane((doc.audioClips||[]).find(c=>c.id===ignore)||{})){return [...(doc.audioClips||[]).filter(c=>c.id!==ignore&&audioTrack(c)===track&&(track!=='source'||sourceLane(c)===lane)),...(track==='source'?layout(doc).filter(r=>r.clip.id!==ignore&&linkedAudio(r.clip)&&videoTrack(r.clip)===lane).map(r=>({id:r.clip.id,start:r.start,in:r.clip.in,out:r.clip.out})):[])];}
export function freeAudioStart(doc,desired,length,ignore,track='music',lane){const clips=audioOccupancy(doc,track,ignore,lane);const candidates=[Math.max(0,desired),0,...clips.flatMap(c=>[c.start-length,c.start+c.out-c.in])].filter(x=>x>=0&&clips.every(c=>x+length<=c.start||x>=c.start+c.out-c.in));return candidates.sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired))[0]??0;}
function applyAudioEdit(doc,d,delta){
 const c=(doc.audioClips||[]).find(c=>c.id===d.id),o=d.original;let applied=delta;
 if(d.operation==='move'){let start=o.start+delta;if(d.snapEnabled)start=snap(d.snapPoints,start,d.snapTolerance);c.start=freeAudioStart(doc,Math.max(0,start),o.out-o.in,c.id,audioTrack(c));applied=c.start-o.start;}
 else if(d.operation==='slip'){applied=clamp(delta,-o.in,c.media.frames-o.out);c.in=o.in+applied;c.out=o.out+applied;}
 else if(d.operation==='roll'){
  const b=d.peer,n=(doc.audioClips||[]).find(c=>c.id===b.id);
  if(d.edge==='out'){applied=clamp(delta,Math.max(o.in+MIN_FRAMES-o.out,-b.in),Math.min(c.media.frames-o.out,b.out-b.in-MIN_FRAMES));c.out=o.out+applied;n.in=b.in+applied;n.start=b.start+applied;}
  else{applied=clamp(delta,Math.max(-o.in,b.in+MIN_FRAMES-b.out),Math.min(o.out-o.in-MIN_FRAMES,n.media.frames-b.out));c.in=o.in+applied;c.start=o.start+applied;n.out=b.out+applied;}
 }else if(d.operation==='in'){const prev=audioOccupancy(doc,audioTrack(c),c.id).filter(x=>x.start<o.start).reduce((n,x)=>Math.max(n,x.start+x.out-x.in),0);applied=clamp(delta,Math.max(-o.in,prev-o.start),o.out-o.in-MIN_FRAMES);c.in=o.in+applied;c.start=o.start+applied;}
 else{const next=audioOccupancy(doc,audioTrack(c),c.id).filter(x=>x.start>=o.start+o.out-o.in).reduce((n,x)=>Math.min(n,x.start),Infinity);applied=clamp(delta,o.in+MIN_FRAMES-o.out,Math.min(c.media.frames-o.out,next-(o.start+o.out-o.in)));c.out=o.out+applied;}
 return applied;
}
export function audioSettings(c){const length=c.out-c.in,a=c.audio||{};return {gainDb:clamp(Number(a.gainDb)||0,-60,6),muted:!!a.muted,fadeIn:clamp(Number(a.fadeIn)||0,0,Math.floor(length/2)),fadeOut:clamp(Number(a.fadeOut)||0,0,Math.floor(length/2))};}
export function trackAudible(doc,track){const t={...defaultAudioTracks,...doc.audioTracks};return track==='source'?!t.sourceMuted&&(!t.musicSolo||t.sourceSolo):!t.musicMuted&&(!t.sourceSolo||t.musicSolo);}
export function audioEnvelope(c,elapsed){const a=audioSettings(c),length=c.out-c.in;return !enabled(c)||a.muted?0:Math.pow(10,a.gainDb/20)*Math.min(1,a.fadeIn?Math.max(0,elapsed)/a.fadeIn:1,a.fadeOut?Math.max(0,length-elapsed)/a.fadeOut:1);}
export function audioNeighbor(doc,c,edge){return c&&(doc.audioClips||[]).find(n=>n.id!==c.id&&audioTrack(n)===audioTrack(c)&&(audioTrack(c)!=='source'||sourceLane(n)===sourceLane(c))&&(edge==='in'?n.start+n.out-n.in===c.start:n.start===c.start+c.out-c.in));}
export const pictureEnd=doc=>Math.max(0,...layout(doc).map(r=>r.end));
export function exportRange(doc){const limit=total(doc),end=clamp(Math.round(doc.exportRange?.end??(pictureEnd(doc)||Math.max(0,...(doc.audioClips||[]).map(c=>c.start+c.out-c.in)))),0,limit);return {start:clamp(Math.round(doc.exportRange?.start||0),0,Math.max(0,end-1)),end};}
export function exportPlan(doc,range={start:0,end:total(doc)}){
 const clips=[],audioClips=[],rows=layout(doc),points=[...new Set([range.start,range.end,...rows.flatMap(r=>[r.start,r.end]).filter(f=>f>range.start&&f<range.end)])].sort((a,b)=>a-b);
 for(let i=0;i<points.length-1;i++){const start=points[i],end=points[i+1],r=visibleRow(doc,start),c=r?.clip,m=c&&takeOf(c).media,offset=c?c.in+start-r.start:0,file=m?.file||'assets/black.png',last=clips.at(-1);if(last&&last.file===file&&(file==='assets/black.png'||last.out===offset))last.out+=end-start;else clips.push({file,in:offset,out:offset+end-start});}
 for(const {clip:c,start} of rows){const audio=audioSettings(c);if(videoEnabled(doc,c)&&linkedAudio(c)&&trackAudible(doc,'source')&&!audio.muted)audioClips.push({file:takeOf(c).media.file,start,in:c.in,out:c.out,...audio});}
 for(const c of doc.audioClips||[]){const audio=audioSettings(c);if(enabled(c)&&trackAudible(doc,audioTrack(c))&&!audio.muted)audioClips.push({file:c.media.file,start:c.start,in:c.in,out:c.out,...audio});}
 return {audio:true,clips,audioClips:audioClips.filter(c=>c.start<range.end&&c.start+c.out-c.in>range.start),...(range.start?{audioOffset:range.start}:{})};
}
export function setEnabled(doc,ids,value){const selected=new Set(ids);for(const c of [...doc.clips,...doc.audioClips||[]])if(selected.has(c.id))c.enabled=value;}
export function addVideoTrack(doc){return doc.videoTracks=videoTracks(doc)+1;}
export const sourceTrackHidden=(doc,track)=>(doc.audioTracks?.hiddenSourceTracks||[]).includes(track);
export function showAudioTrack(doc,kind,track=1){doc.audioTracks??={};if(kind==='music')doc.audioTracks.musicHidden=false;else doc.audioTracks.hiddenSourceTracks=(doc.audioTracks.hiddenSourceTracks||[]).filter(t=>t!==track);}
export function removeTrack(doc,key){
 const [kind,number]=key.split(':'),track=Number(number),count=videoTracks(doc);doc.audioTracks??={};
 if(kind==='music'){doc.audioClips=(doc.audioClips||[]).filter(c=>audioTrack(c)!=='music');doc.audioTracks.musicHidden=true;return true;}
 if(!['video','source'].includes(kind)||!Number.isInteger(track)||track<1||track>count)return false;
 if(kind==='video'&&count===1)return false;
 doc.audioClips=(doc.audioClips||[]).filter(c=>audioTrack(c)!=='source'||sourceLane(c)!==track);
 if(kind==='source'){for(const c of trackClips(doc,track))c.audioDetached=true;doc.audioTracks.hiddenSourceTracks=[...new Set([...doc.audioTracks.hiddenSourceTracks||[],track])];return true;}
 doc.clips=doc.clips.filter(c=>videoTrack(c)!==track);for(const c of doc.clips)if(videoTrack(c)>track)c.videoTrack=videoTrack(c)-1;
 for(const c of doc.audioClips)if(audioTrack(c)==='source'&&sourceLane(c)>track)c.sourceLane=sourceLane(c)-1;
 const gaps=new Map(Array.from({length:count},(_,i)=>[i+1,tailGap(doc,i+1)]));doc.tailGap=gaps.get(track===1?2:1)||0;doc.videoTailGaps={};for(let lane=2;lane<count;lane++)doc.videoTailGaps[lane]=gaps.get(lane>=track?lane+1:lane)||0;
 const renumber=values=>(values||[]).filter(t=>t!==track).map(t=>t>track?t-1:t);doc.disabledVideoTracks=renumber(doc.disabledVideoTracks);doc.audioTracks.hiddenSourceTracks=renumber(doc.audioTracks.hiddenSourceTracks);doc.videoTracks=count-1;return true;
}
export function moveToTrack(doc,ids,track){
 const selected=new Set(ids),rows=layout(doc),moving=rows.filter(r=>selected.has(r.clip.id)),fixed=rows.filter(r=>!selected.has(r.clip.id));
 if(moving.some(r=>fixed.some(n=>videoTrack(n.clip)===track&&r.start<n.end&&r.end>n.start))||moving.some((r,i)=>moving.slice(i+1).some(n=>r.start<n.end&&r.end>n.start)))return false;
 const affected=new Set([...moving.map(r=>videoTrack(r.clip)),track]),ends=new Map([...affected].map(lane=>[lane,Math.max(0,...rows.filter(r=>videoTrack(r.clip)===lane).map(r=>r.end))+tailGap(doc,lane)]));for(const r of moving)r.clip.videoTrack=track;
 for(const lane of affected){const part=trackDocument(doc,lane);let end=0;part.clips=rows.filter(r=>videoTrack(r.clip)===lane).sort((a,b)=>a.start-b.start).map(r=>{r.clip.gapBefore=r.start-end;end=r.end;return r.clip;});part.tailGap=Math.max(0,ends.get(lane)-end);commitTrack(doc,lane,part);}
 doc.videoTracks=Math.max(videoTracks(doc),track);return true;
}
export function insertClip(doc,c,index=doc.clips.length,{track=1,start=null,ripple=false}={}){c.videoTrack=track;showAudioTrack(doc,'source',track);if(start!==null){const rows=layout(doc).filter(r=>videoTrack(r.clip)===track),length=c.out-c.in;if(ripple){start=Math.max(0,start);const next=rows.find(r=>r.start>=start),prev=rows.filter(r=>r.end<=start).at(-1);c.gapBefore=start-(prev?.end||0);if(next){next.clip.gapBefore=Math.max(0,next.start-start-length);index=doc.clips.indexOf(next.clip);}else{index=doc.clips.length;setTailGap(doc,track,Math.max(0,(rows.at(-1)?.end||0)+tailGap(doc,track)-start-length));}doc.clips.splice(index,0,c);return c;}const candidates=[Math.max(0,start),0,...rows.map(r=>r.end)],free=candidates.filter(f=>rows.every(r=>f+length<=r.start||f>=r.end)).sort((a,b)=>Math.abs(a-start)-Math.abs(b-start))[0];const next=rows.find(r=>r.start>=free+length),prev=rows.filter(r=>r.end<=free).at(-1);c.gapBefore=free-(prev?.end||0);if(next){next.clip.gapBefore=next.start-free-length;index=doc.clips.indexOf(next.clip);}else{index=doc.clips.length;setTailGap(doc,track,Math.max(0,(rows.at(-1)?.end||0)+tailGap(doc,track)-free-length));}}doc.clips.splice(index,0,c);return c;}
export function unlinkAudio(doc,id,newId){const row=rowFor(doc,id);if(!row||!linkedAudio(row.clip)||takeOf(row.clip).placeholder)return null;const c=row.clip,a={id:newId,name:c.name+' audio',track:'source',...(videoTrack(c)>1?{sourceLane:videoTrack(c)}:{}),media:{...copy(takeOf(c).media),kind:'audio'},start:row.start,in:c.in,out:c.out,audio:audioSettings(c),...(c.enabled===false?{enabled:false}:{})};c.audioDetached=true;(doc.audioClips??=[]).push(a);return a;}
export function resolveGesture(doc,target,modifiers={}){
 const shift=!!modifiers.shift;
 const c=target.audio?(doc.audioClips||[]).find(c=>c.id===target.id):doc.clips.find(c=>c.id===target.id);
 if(!c)return {kind:'move',mode:'move',blocked:'This clip is no longer available.'};
 if(target.edge)return {kind:target.edge,mode:target.audio?(target.shared&&!shift?'roll':'trim'):shift?'ripple':modifiers.alt&&target.shared?'roll':'trim'};
 if(modifiers.s)return {kind:'slip',mode:'slip'};
 if(modifiers.d){const clips=trackClips(doc,videoTrack(c)),index=clips.indexOf(c),blocked=target.audio?'Soundtrack stays independent. Move or slip it directly.':index<1||index===clips.length-1||c.gapBefore||gapAfter(doc,doc.clips.indexOf(c))?'Slide needs touching clips on both sides.':null;return {kind:'slide',mode:'slide',blocked};}
 return {kind:'move',mode:modifiers.alt?'copy':'move'};
}

export function beginEdit(doc,{id,audio=false,kind,mode,edge=null,peer=null,snapEnabled=false,snapTolerance=0}){
 const clips=audio?doc.audioClips||[]:doc.clips,c=clips.find(c=>c.id===id),index=clips.indexOf(c);
 return {id,audio,index,kind,mode,operation:audio?(kind==='audio'?'pending':mode==='roll'?'roll':kind):undefined,edge,peer:peer&&copy(peer),before:copy(doc),original:copy(c),start:audio?c.start:rowFor(doc,id).start,afterGap:audio?undefined:gapAfter(doc,index),snapPoints:snapPoints(doc,audio?undefined:id),snapEnabled,snapTolerance};
}
export const applyEdit=(doc,session,delta)=>session.audio?applyAudioEdit(doc,session,delta):applyClipEdit(doc,session,delta);
export function moveClip(doc,id,index){const c=doc.clips.find(c=>c.id===id);doc.clips.splice(doc.clips.indexOf(c),1);doc.clips.splice(index,0,c);return c;}
export function moveGroup(doc,before,ids,delta,targetTrack,{overwrite=false,copies={}}={}){
 const selected=new Set(ids),rows=layout(before).flatMap(r=>copies[r.clip.id]?[r,{...r,clip:{...r.clip,id:copies[r.clip.id]}}]:[r]),audio=(before.audioClips||[]).flatMap(c=>copies[c.id]?[c,{...c,id:copies[c.id]}]:[c]),laneFor=c=>selected.has(c.id)&&targetTrack?targetTrack:videoTrack(c),pieces=rows.flatMap(r=>[{id:r.clip.id,track:'video:'+laneFor(r.clip),start:r.start,in:r.clip.in,out:r.clip.out},...(linkedAudio(r.clip)?[{id:r.clip.id,track:laneFor(r.clip)===1?'source':'source:'+laneFor(r.clip),start:r.start,in:r.clip.in,out:r.clip.out}]:[])]).concat(audio.map(c=>({...c,track:audioTrack(c)==='source'&&sourceLane(c)>1?'source:'+sourceLane(c):audioTrack(c)})));
 const moving=pieces.filter(c=>selected.has(c.id)),fixed=pieces.filter(c=>!selected.has(c.id));if(!moving.length)return 0;
 const minimum=0-Math.min(...moving.map(c=>c.start)),desired=Math.max(minimum,Math.round(delta));
 const candidates=[desired,0,minimum,...moving.flatMap(c=>fixed.filter(n=>n.track===c.track).flatMap(n=>[n.start-(c.start+c.out-c.in),n.start+n.out-n.in-c.start]))];
 const allowed=overwrite?[desired]:candidates.filter(d=>d>=minimum&&moving.every(c=>fixed.every(n=>n.track!==c.track||c.start+d+c.out-c.in<=n.start||c.start+d>=n.start+n.out-n.in)));
 const applied=allowed.sort((a,b)=>Math.abs(a-desired)-Math.abs(b-desired))[0]??0;
 if(rows.some(r=>selected.has(r.clip.id))){const clips=new Map(doc.clips.map(c=>[c.id,c])),ordered=[];for(let track=1;track<=videoTracks(doc);track++){let end=0;const laneRows=rows.filter(r=>laneFor(r.clip)===track).map(r=>({...r,start:r.start+(selected.has(r.clip.id)?applied:0)})).sort((a,b)=>a.start-b.start);for(const r of laneRows){const c=clips.get(r.clip.id),gap=r.start-end;if(gap||Object.hasOwn(r.clip,'gapBefore'))c.gapBefore=gap;else delete c.gapBefore;if(track!==videoTrack(r.clip))c.videoTrack=track;else if(Object.hasOwn(r.clip,'videoTrack'))c.videoTrack=r.clip.videoTrack;else delete c.videoTrack;end=r.start+c.out-c.in;ordered.push(c);}const oldEnd=Math.max(0,...rows.filter(r=>videoTrack(r.clip)===track).map(r=>r.end))+tailGap(before,track);setTailGap(doc,track,Math.max(0,oldEnd-end));}doc.clips=ordered;}
 for(const original of audio)if(selected.has(original.id)){const c=doc.audioClips.find(c=>c.id===original.id);if(c)c.start=original.start+applied;}
 return applied;
}
// Commit overwrite only at drop; preview keeps the existing node set intact.
function overwriteRows(doc,rows,moving,ends,newId){
 const result=[];
 for(const row of rows){
  if(moving.has(row.clip.id)){result.push(row);continue;}
  let segments=[[row.start,row.end]];
  for(const cover of rows.filter(r=>moving.has(r.clip.id)&&videoTrack(r.clip)===videoTrack(row.clip))){
   segments=segments.flatMap(([start,end])=>cover.end<=start||cover.start>=end?[[start,end]]:[[start,Math.min(end,cover.start)],[Math.max(start,cover.end),end]].filter(([a,b])=>b>a));
  }
  if(!segments.length)continue;
  if(segments.length===1&&segments[0][0]===row.start&&segments[0][1]===row.end){result.push(row);continue;}
  const template=copy(row.clip),sourceIn=template.in;
  for(const [index,[start,end]] of segments.entries()){
   const c=index?inheritLineage(template,copy(template)):row.clip;
   if(index)c.id=newId();
   const offset=start-row.start;c.in=sourceIn+offset;c.out=c.in+end-start;
   if(c.audio){c.audio={...template.audio};if(start>row.start)c.audio.fadeIn=0;if(end<row.end)c.audio.fadeOut=0;}
   result.push({clip:c,start,end});
  }
 }
 doc.clips=[];
 for(let track=1;track<=videoTracks({...doc,clips:rows.map(r=>r.clip)});track++){
  let end=0;
  for(const row of result.filter(r=>videoTrack(r.clip)===track).sort((a,b)=>a.start-b.start)){row.clip.gapBefore=row.start-end;end=row.end;doc.clips.push(row.clip);}
  setTailGap(doc,track,Math.max(0,(ends.get(track)||0)-end));
 }
}
export function overwriteMove(doc,before,ids,delta,targetTrack,newId){
 const moving=new Set(ids),current=new Map(doc.clips.map(c=>[c.id,c])),rows=layout(before),ends=new Map();
 for(let track=1;track<=videoTracks(before);track++)ends.set(track,Math.max(0,...rows.filter(r=>videoTrack(r.clip)===track).map(r=>r.end))+tailGap(before,track));
 const placed=rows.map(row=>{const c=current.get(row.clip.id);c.in=row.clip.in;c.out=row.clip.out;c.videoTrack=moving.has(c.id)&&targetTrack?targetTrack:videoTrack(row.clip);const start=row.start+(moving.has(c.id)?delta:0);return {clip:c,start,end:start+c.out-c.in};});
 overwriteRows(doc,placed,moving,ends,newId);
}
export function overwriteInsert(doc,c,start,track,newId){
 const rows=layout(doc),ends=new Map();for(let lane=1;lane<=videoTracks(doc);lane++)ends.set(lane,Math.max(0,...rows.filter(r=>videoTrack(r.clip)===lane).map(r=>r.end))+tailGap(doc,lane));
 c.videoTrack=track;doc.videoTracks=Math.max(videoTracks(doc),track);start=Math.max(0,Math.round(start));
 overwriteRows(doc,[...rows,{clip:c,start,end:start+c.out-c.in}],new Set([c.id]),ends,newId);return c;
}
export function moveTake(doc,clipId,takeId,start,track,newId){
 const source=doc.clips.find(c=>c.id===clipId),t=realTakes(source).find(t=>t.id===takeId);if(!t)return null;
 const c=copy(source);c.id=newId();c.name=source.name+' - Take '+String(t.number||1).padStart(2,'0');c.takes=[t];c.takeId=t.id;c.in=0;c.out=t.media.frames;c.count=1;c.revision=1;
 for(const key of ['outputFolder','takeOwnerId','takeSourceIds','hiddenTakeIds','generationBase','workflow','workflowVersion','shotInputs','seedKey','audioDetached'])delete c[key];
 c.takeSourceTakeIds=t.generated?[t.id]:[];c.bindings=[];c.inputValues={};c.seedMode='same';c.audio={gainDb:0,muted:false,fadeIn:0,fadeOut:0};
 if(source.takeId===t.id){const fallback=realTakes(source).find(t=>t.id!==takeId);if(fallback){chooseTake(doc,clipId,fallback.id);delete source.workflowVersion;delete source.workflow;delete source.generationBase;delete source.shotInputs;source.bindings=[];source.inputValues={};}else removeClip(doc,clipId);}
 if(doc.clips.includes(source))source.hiddenTakeIds=[...new Set([...source.hiddenTakeIds||[],takeId])];
 return overwriteInsert(doc,c,start,track,newId);
}
function duplicateClipOnTrack(doc,id,newId){const c=doc.clips.find(c=>c.id===id);if(!c)return null;const d=inheritLineage(c,copy(c));d.id=newId;d.name=c.name+' copy';d.gapBefore=0;doc.clips.splice(doc.clips.indexOf(c)+1,0,d);return d;}
export function splitClip(doc,frame,newId,id){const row=splitTarget(doc,frame,id);if(!row)return {error:'Place the playhead inside a clip, at least 6 frames from either edge.'};const c=row.clip,cut=c.in+Math.round(frame-row.start),d=inheritLineage(c,copy(c));d.id=newId;d.name=c.name+' B';d.gapBefore=0;d.in=cut;c.out=cut;if(c.audio){d.audio.fadeIn=0;c.audio.fadeOut=0;}doc.clips.splice(doc.clips.indexOf(c)+1,0,d);return {clip:d};}
function removeClipOnTrack(doc,id,{ripple=false}={}){const c=doc.clips.find(c=>c.id===id);if(!c)return null;const index=doc.clips.indexOf(c),space=(c.gapBefore||0)+(ripple?0:c.out-c.in);setGapAfter(doc,index,gapAfter(doc,index)+space);doc.clips.splice(index,1);return doc.clips[Math.min(index,doc.clips.length-1)]?.id||null;}
export const gapFrames=(doc,index)=>index<0?tailGap(doc,-index):index<doc.clips.length?doc.clips[index].gapBefore||0:doc.tailGap||0;
export function closeGap(doc,index){if(!gapFrames(doc,index))return false;if(index<0)setTailGap(doc,-index,0);else if(index<doc.clips.length)doc.clips[index].gapBefore=0;else doc.tailGap=0;return true;}
export function chooseTake(doc,clipId,id){const c=doc.clips.find(c=>c.id===clipId);if(!c||c.takeId===id||!realTakes(c).some(t=>t.id===id))return {changed:false,addedGap:0};const length=c.out-c.in;c.takeId=id;const max=takeOf(c).media.frames,newLength=Math.min(length,max);c.in=clamp(c.in,0,max-newLength);c.out=c.in+newLength;const addedGap=length-newLength;if(addedGap){const index=doc.clips.indexOf(c);setGapAfter(doc,index,gapAfter(doc,index)+addedGap);}return {changed:true,addedGap};}
export function addAudioClip(doc,m,start,newId,{track='music',fullLength=false,lane=1}={}){if(m.kind==='video'&&!m.audio)return null;showAudioTrack(doc,track,lane);const length=fullLength?m.frames:Math.min(m.frames,Math.max(MIN_FRAMES,videoTotal(doc)-start)),c={id:newId,name:m.name.replace(/\.[^.]+$/,''),media:{...copy(m),kind:'audio'},start:freeAudioStart(doc,start,length,undefined,track,lane),...(track==='source'&&lane>1?{sourceLane:lane}:{}),in:0,out:length,audio:{gainDb:-6,muted:false,fadeIn:0,fadeOut:0}};if(track==='source')c.track=track;(doc.audioClips??=[]).push(c);return c;}
export function removeAudio(doc,id){doc.audioClips=doc.audioClips.filter(c=>c.id!==id);}
export function duplicateAudio(doc,id,newId){const c=doc.audioClips.find(c=>c.id===id);if(!c)return null;const d=copy(c);d.id=newId;d.name+=' copy';d.start=freeAudioStart(doc,c.start+c.out-c.in,c.out-c.in,undefined,audioTrack(c),sourceLane(c));doc.audioClips.push(d);return d;}
export function splitAudio(doc,frame,newId,clipId){const c=clipId?doc.audioClips.find(c=>c.id===clipId):doc.audioClips.find(c=>frame>=c.start&&frame<c.start+c.out-c.in);if(!c)return null;const offset=Math.round(frame-c.start);if(offset<MIN_FRAMES||offset>c.out-c.in-MIN_FRAMES)return null;const d=copy(c);d.id=newId;d.name+=' B';d.start=c.start+offset;d.in=c.in+offset;c.out=d.in;d.audio={...audioSettings(d),fadeIn:0};c.audio={...audioSettings(c),fadeOut:0};doc.audioClips.push(d);return d;}

export function duplicateClip(doc,id,newId){const c=doc.clips.find(c=>c.id===id);if(!c)return null;const track=videoTrack(c),part=trackDocument(doc,track),result=duplicateClipOnTrack(part,id,newId);commitTrack(doc,track,part);return result;}

export function removeClip(doc,id,options={}){const c=doc.clips.find(c=>c.id===id);if(!c)return null;const track=videoTrack(c),part=trackDocument(doc,track),result=removeClipOnTrack(part,id,options);commitTrack(doc,track,part);return result;}
