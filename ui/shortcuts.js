// The studio's keyboard and pointer shortcuts, grouped for the shortcut sheet.
// Keep in step with the editor's keydown handler in ui/editor.js.
import {keyText} from './keys.js';
export const SHORTCUTS=Object.freeze([
 ['Playback and review',[
  [['Space'],'Play or pause'],
  [['←','→'],'Previous or next frame'],
  [['↑','↓'],'Previous or next cut; in Source, previous or next take'],
  [['Home','End'],'Go to the start or end'],
  [['Q'],'Switch between Source and Edit'],
  [['1','9'],'Review take 1 to 9 in Source','–'],
  [['Enter'],'Use the take being reviewed'],
  [['C'],'Compare takes; while trimming, toggle the trim view'],
  [['F'],'Viewer fullscreen'],[['Shift','F'],'Reset viewer zoom','+'],
 ]],
 ['Editing',[
  [['B'],'Split at the playhead'],
  [['Delete'],'Delete the selection'],[['Shift','Delete'],'Ripple delete','+'],
  [['Ctrl','D'],'Duplicate','+'],[['Ctrl','Shift','D'],'Disable or enable clips','+'],
  [['Ctrl','Z'],'Undo','+'],[['Ctrl','Shift','Z'],'Redo (also Ctrl+Y)','+'],
  [[',','.'],'Nudge the selected cut one frame; with Shift, five'],
  [['N'],'Toggle snapping'],
  [['I','O'],'Set the export range start or end at the playhead'],
  [['Ctrl','S'],'Save now','+'],
 ]],
 ['Selection and view',[
  [['Ctrl','A'],'Select all clips','+'],
  [['Ctrl','Click'],'Add or remove a clip','+'],
  [['Shift','Click'],'Select a range on one track','+'],
  [['Esc'],'Clear the selection or leave Source'],
  [['+','−'],'Zoom the timeline in or out'],
  [['Shift','Z'],'Fit the timeline','+'],
 ]],
 ['Timeline gestures',[
  [['Drag edge'],'Trim; following clips stay in place'],
  [['Shift','Drag edge'],'Ripple trim','+'],
  [['Alt','Drag cut'],'Roll both sides of a touching cut','+'],
  [['Drag body'],'Move'],[['Alt','Drag body'],'Drag a copy','+'],
  [['S','Drag body'],'Slip the source inside the clip','+'],
  [['D','Drag body'],'Slide between neighbours','+'],
  [['Drag track edge'],'Resize a lane; double-click resets it'],
 ]],
]);

const esc=value=>keyText(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

export function shortcutSheet(){
 return '<div class="shortcut-sheet">'+SHORTCUTS.map(([group,rows])=>'<section><h3>'+esc(group)+'</h3><dl>'+rows.map(([keys,action,join='/'])=>
  '<dt>'+keys.map(key=>'<kbd>'+esc(key)+'</kbd>').join('<span class="shortcut-join">'+esc(join)+'</span>')+'</dt><dd>'+esc(action)+'</dd>').join('')+'</dl></section>').join('')+'</div>';
}
