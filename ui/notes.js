import {keyText} from './keys.js';
export function clipNotes(clip){
 if(!clip)return [];
 if(Array.isArray(clip.notes))return clip.notes;
 return clip.intent?.trim()?[{id:'note-'+clip.id,text:clip.intent,status:'open',createdAt:null,createdBy:'user'}]:[];
}

export function createNotes(root,{selected,record,save,notify=()=>{}}){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const check='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
 root.innerHTML='<div class="notes-heading"><h3>Notes <span id="notesOpenCount"></span></h3></div><div id="notesOpenList"></div><form class="notes-composer" id="notesForm"><label class="sr-only" for="clipNotes">New note</label><textarea id="clipNotes" rows="2" placeholder="Add a note for this clip — you or an agent can act on it…" aria-label="New note"></textarea><div class="notes-compose-actions"><span>'+keyText('Ctrl')+' + Enter to add</span><button type="submit" class="outline" id="addClipNote">Add note</button></div></form><details class="notes-history" id="notesHistory"><summary>Addressed <span id="notesHistoryCount"></span></summary><div id="notesHistoryList"></div></details><span class="sr-only" id="notesAnnouncement" aria-live="polite"></span>';
 const $=id=>root.querySelector('#'+id),field=$('clipNotes');
 let owner=null,listSignature='',timer;
 const who=actor=>actor?.startsWith('agent:')?'Agent':'You';
 const when=stamp=>stamp?new Date(stamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 const current=()=>{const c=selected();return c&&c.id===owner?c:null;};
 function announce(text){$('notesAnnouncement').textContent=text;notify(text);}
 function change(c,label,edit){record(label);c.notes=JSON.parse(JSON.stringify(clipNotes(c)));delete c.intent;edit(c.notes);clearTimeout(timer);save();}
 function add(c,text,source){const note={id:crypto.randomUUID(),text:text.trim(),status:'open',createdAt:Date.now(),createdBy:'user'};if(source)note.reopenedFrom=source.id;c.notes.push(note);return note;}
 function resize(textarea){textarea.style.height='auto';textarea.style.height=textarea.scrollHeight+'px';}
 function render(){
  const c=selected();root.hidden=!c;if(!c){owner=null;listSignature='';return;}
  if(owner!==c.id){owner=c.id;listSignature='';field.value=c.noteDraft||'';}
  else if(field.value!==(c.noteDraft||''))field.value=c.noteDraft||'';
  $('addClipNote').disabled=!field.value.trim();
  const notes=clipNotes(c),open=notes.filter(n=>n.status==='open'),past=notes.filter(n=>n.status==='addressed').sort((a,b)=>(b.addressedAt||0)-(a.addressedAt||0)),signature=JSON.stringify(notes);
  $('notesOpenCount').textContent=open.length?open.length+' open':'';$('notesHistoryCount').textContent=past.length;$('notesHistory').hidden=!past.length;
  if(signature===listSignature)return;listSignature=signature;
  const expanded=new Set([...root.querySelectorAll('[data-note-history][open]')].map(n=>n.dataset.noteHistory));
  $('notesOpenList').innerHTML=open.map(n=>'<div class="note-open" data-note="'+esc(n.id)+'"><input type="checkbox" data-address="'+esc(n.id)+'" aria-label="Mark note addressed: '+esc(n.text)+'"><textarea rows="1" class="note-text" data-note-edit="'+esc(n.id)+'" aria-label="Edit note">'+esc(n.text)+'</textarea></div>').join('');
  $('notesHistoryList').innerHTML=past.map(n=>{
   const reopened=open.some(v=>v.reopenedFrom===n.id);
   return '<details class="note-addressed" data-note-history="'+esc(n.id)+'"'+(expanded.has(n.id)?' open':'')+'><summary><span class="note-done">'+check+'</span><span class="note-history-title">'+esc(n.text)+'</span><span class="note-chevron">›</span></summary><div class="note-history-body">'+(n.resolution?'<p class="note-resolution">'+esc(n.resolution)+'</p>':'')+'<div class="note-history-meta"><span title="'+esc(n.addressedBy)+'">'+who(n.addressedBy)+' · '+esc(when(n.addressedAt))+'</span><button class="outline" data-reopen="'+esc(n.id)+'"'+(reopened?' disabled':'')+'>'+(reopened?'Reopened':'Reopen')+'</button></div>'+(n.versions?.length?'<details class="note-versions"><summary>Earlier text</summary>'+n.versions.map(v=>'<p>'+esc(v.text)+'</p>').join('')+'</details>':'')+'</div></details>';
  }).join('');
  root.querySelectorAll('[data-note-edit]').forEach(input=>{
   resize(input);let started=false;
   function edit(){const c=current(),note=c&&clipNotes(c).find(n=>n.id===input.dataset.noteEdit),text=input.value.trim();if(!note||note.status!=='open'||!text||text===note.text)return;
    if(!started){record('Edit note');c.notes=JSON.parse(JSON.stringify(clipNotes(c)));delete c.intent;const n=c.notes.find(v=>v.id===note.id);(n.versions??=[]).push({text:n.text,at:Date.now(),by:'user'});started=true;}
    const n=c.notes.find(v=>v.id===note.id);n.text=text;n.updatedAt=Date.now();n.updatedBy='user';listSignature=JSON.stringify(c.notes);clearTimeout(timer);timer=setTimeout(save,350);
   }
   input.onfocus=()=>{started=false;};input.oninput=()=>{resize(input);edit();};input.onchange=edit;
   input.onblur=()=>{if(!input.value.trim()){const c=current(),note=c&&clipNotes(c).find(n=>n.id===input.dataset.noteEdit);if(note){input.value=note.text;resize(input);announce('A note cannot be empty.');}}edit();started=false;clearTimeout(timer);save();};
  });
  root.querySelectorAll('[data-address]').forEach(input=>input.onchange=()=>{const c=current();if(!c)return;change(c,'Address note',values=>{const n=values.find(v=>v.id===input.dataset.address);n.status='addressed';n.addressedAt=Date.now();n.addressedBy='user';n.resolution='';});render();field.focus({preventScroll:true});announce('Note addressed. Kept in history.');});
  root.querySelectorAll('[data-reopen]').forEach(button=>button.onclick=()=>{const c=current();if(!c)return;const source=clipNotes(c).find(n=>n.id===button.dataset.reopen);if(clipNotes(c).some(n=>n.reopenedFrom===source.id&&n.status==='open'))return;change(c,'Reopen note',()=>add(c,source.text,source));render();announce('Note reopened. Its addressed history is preserved.');});
 }
 field.oninput=()=>{const c=current();if(!c)return;c.noteDraft=field.value;$('addClipNote').disabled=!field.value.trim();clearTimeout(timer);timer=setTimeout(save,350);};
 field.onblur=()=>{clearTimeout(timer);save();};
 $('notesForm').onsubmit=e=>{e.preventDefault();const c=current(),text=field.value.trim();if(!c||!text)return;change(c,'Add note',()=>{add(c,text);delete c.noteDraft;});field.value='';render();field.focus({preventScroll:true});announce('Note added.');};
 field.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();$('notesForm').requestSubmit();}};
 return {render,dispose(){clearTimeout(timer);}};
}
