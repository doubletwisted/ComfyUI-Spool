(async()=>{
 const n=window.spoolNative,d=document,checks=[],check=(label,value)=>{if(!value)throw Error(label);checks.push(label);},$=id=>d.getElementById(id);
 const shot=()=>n.state.clips.find(c=>c.id==='shot');
 n.selectClip('shot');n.setFrame(24,true);await n.flush();
 check('Footage explains why generation is unavailable',$('generate').disabled&&$('inspectorContent').querySelector('.workflow-hint').textContent==='Use a take or choose a workflow from the library'&&!$('generateReason').hidden);
 n.viewTake('two');n.setFrame(35,true);
 check('Source review preserves the take in the edit',shot().takeId==='one'&&$('sourceTab').getAttribute('aria-selected')==='true');
 check('Source explains the full duration and amber shot trim',$('viewerDuration').title==='Full source duration'&&$('seek').title.includes('current shot trim (2.00s)'));
 check('Source seeking leaves the edit playhead unchanged',n.state.frame===24);
 $('compareTakes').click();check('Comparison enters the viewer',d.querySelectorAll('#takeCompare .compare-pane:not([hidden])').length===2&&!$('takeCompare').hidden);
 const prior=$('viewerTime').textContent,button=d.querySelector('[data-view="three"]');
 button.dispatchEvent(new PointerEvent('pointerenter'));button.dispatchEvent(new PointerEvent('pointerleave'));
 check('Hover leaves comparison context and playhead intact',!$('takeCompare').hidden&&$('viewerTime').textContent===prior&&n.state.frame===24&&shot().takeId==='one');
 $('compareSelect1').click();$('tryInEdit').click();$('play').click();
 check('Trial is view-only and closes comparison',shot().takeId==='one'&&!$('cancelAudition').hidden&&$('takeCompare').hidden);
 $('cancelAudition').click();check('Cancel returns to saved edit',shot().takeId==='one'&&$('cancelAudition').hidden&&$('editTab').getAttribute('aria-selected')==='true');
 n.viewTake('three');$('useSource').click();for(let i=0;i<200&&shot().takeId!=='three';i++)await new Promise(r=>setTimeout(r,20));await n.flush();check('Use take is the only review action that changes the edit',shot().takeId==='three');
 n.undo();await n.flush();check('Undo restores the authored take',shot().takeId==='one');
 n.viewTake('two');d.getElementById('editor').focus();d.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 check('Escape exits Source review',$('editTab').getAttribute('aria-selected')==='true'&&shot().takeId==='one');
 return {checks};
})()
