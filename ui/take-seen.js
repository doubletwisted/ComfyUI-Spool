import {realTakes} from './timeline.js';

// Review acknowledgements are browser-local, shared by full/native views, never edits.
export function createTakeSeen(projectId,clips,storage){
 const key='spool-native-'+projectId+':seen-takes';
 const read=()=>{try{const value=JSON.parse(storage.getItem(key));return Array.isArray(value)?value:null;}catch{return null;}};
 const saved=read(),seen=new Set(saved??clips.flatMap(c=>c.takes.filter(t=>!t.placeholder).map(t=>t.id)));
 const write=()=>{try{storage.setItem(key,JSON.stringify([...seen]));}catch{}};
 if(saved===null)write();
 function refresh(){const previous=seen.size,held=new Set(read()||[]);for(const id of held)seen.add(id);if(seen.size>held.size)write();return seen.size!==previous;}
 function mark(ids){const refreshed=refresh(),previous=seen.size;for(const id of ids)seen.add(id);if(seen.size!==previous)write();return refreshed||seen.size!==previous;}
 return {key,refresh,mark,unseen:c=>realTakes(c).filter(t=>t.id!==c.takeId&&!seen.has(t.id))};
}
