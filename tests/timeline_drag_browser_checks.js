// A trusted pointer drag carrying a two-clip group. The lane must not be rebuilt while
// the gesture runs, the carried clips' geometry must still be written, and the lane must
// be rebuilt once when the gesture ends. A group move overwrites covered footage
// at drop, so positions are compared against where the gesture started rather
// than between frames.
(async()=>{
 const n=window.spoolNative,d=document,drag=window.__drag;
 if(location.port!=='8195'||!n||!drag)throw Error('Use the owned timeline group-drag QA project on 8195');
 const checks=[],check=(label,ok)=>{if(!ok)throw Error(label);checks.push(label);};
 const samples=drag.samples,left=(sample,id)=>sample.box[id].left,start=id=>drag.before.box[id].left;

 check('The drag produced frames to inspect',samples.length>=5);
 const tokens=samples[0].tokens;
 check('The lane was not rebuilt on any drag frame',samples.every(sample=>sample.draws===drag.before.draws));
 check('Every clip node survived every drag frame',
   samples.every(sample=>sample.tokens.length===tokens.length&&sample.tokens.every((token,index)=>token===tokens[index])));
 check('The lane still holds every clip',tokens.length===60);
 check('The gesture was a group move',samples.every(sample=>sample.drag&&sample.drag.group&&sample.drag.kind==='move'&&sample.drag.ids===2));

 const carried=['drag-clip-1','drag-clip-2'];
 for(const id of carried){
  const values=samples.map(sample=>left(sample,id));
  check('The carried clip moved left from where it started ('+id+')',values.every(value=>value<=start(id))&&values.some(value=>value<start(id)));
  check('The carried clip ended where the last frame left it ('+id+')',drag.after.box[id].left===values.at(-1));
  check('The carried clip never moved right ('+id+')',values.every(value=>value<=start(id)));
 }
 check('The carried clips kept their spacing',
   samples.every(sample=>Math.abs((left(sample,'drag-clip-2')-left(sample,'drag-clip-1'))-(start('drag-clip-2')-start('drag-clip-1')))<=1));
 check('The carried clips kept their widths',
   carried.every(id=>samples.every(sample=>sample.box[id].width===drag.before.box[id].width)));

 // Clips outside the group must not be disturbed by a group move.
 for(const id of ['drag-clip-0','drag-clip-3','drag-clip-4']){
  check('Moving a group leaves the clips outside it in place ('+id+')',samples.every(sample=>left(sample,id)===start(id)));
 }
 const carriedRanges=carried.map(id=>({start:drag.after.box[id].left,end:drag.after.box[id].left+drag.after.box[id].width}));
 const covered=Object.keys(drag.before.box).filter(id=>!carried.includes(id)&&!drag.after.box[id]);
 check('Only footage covered by the drop is removed',covered.length>0&&covered.every(id=>carriedRanges.some(r=>r.start<=drag.before.box[id].left&&r.end>=drag.before.box[id].left+drag.before.box[id].width)));
 check('Uncovered clips retain their timeline positions',Object.keys(drag.before.box).filter(id=>!carried.includes(id)&&drag.after.box[id]).every(id=>drag.after.box[id].left===start(id)));
 check('The lane was rebuilt once when the gesture ended',drag.after.draws===drag.before.draws+1);

 check('The group moved earlier in the timeline',(n.state.clips.find(c=>c.id==='drag-clip-1').gapBefore||0)<120);
 check('The group kept its internal order',n.state.clips.findIndex(c=>c.id==='drag-clip-1')<n.state.clips.findIndex(c=>c.id==='drag-clip-2'));
 check('Overwrite removes exactly the covered clips without duplicates',n.state.clips.length===60-covered.length&&new Set(n.state.clips.map(c=>c.id)).size===n.state.clips.length);
 await n.flush();
 check('The move saved without a conflict',!n.dirty);n.undo();await n.flush();check('Undo restores overwritten clips and their original positions',n.state.clips.length===60);n.redo();await n.flush();check('Redo repeats the same overwrite',n.state.clips.length===60-covered.length);
 return {checks,clips:tokens.length,frames:samples.length,drawsBefore:drag.before.draws,drawsAfter:drag.after.draws,kind:'Installed editor, trusted CDP group drag, no generation'};
})()
