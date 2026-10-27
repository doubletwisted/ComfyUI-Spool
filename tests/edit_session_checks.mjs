// How an authored edit is applied: step before change, repaint scope, one save.
// node tests/edit_session_checks.mjs
import assert from 'node:assert/strict';
import {createEditSession, SCOPES} from '../ui/edit-session.js';
import {createHistory} from '../ui/history.js';

const checks = [];
const check = (label, ok) => { if (!ok) throw Error(label); checks.push(label); };

function harness() {
  const log = [];
  let state = {project: 'Edit QA', fps: 24, frame: 0, clips: [{id: 'clip-1', name: 'Shot', in: 0, out: 48, takes: [{id: 'take-1'}], takeId: 'take-1'}], audioClips: []};
  const history = createHistory();
  const session = createEditSession({
    history,
    current: () => state,
    reset: () => log.push('reset'),
    recorded: () => log.push('recorded'),
    repaint: scope => log.push('repaint:' + scope),
    save: () => log.push('save:' + state.clips[0].name),
  });
  return {log, history, session, get state() { return state; }};
}

{
  const h = harness();
  const result = h.session.apply('Rename Shot', () => { h.state.clips[0].name = 'Renamed'; return 'done'; }, 'timeline');
  check('An edit returns what its change returns', result === 'done');
  check('An edit runs reset, step, change, repaint and save in order',
    JSON.stringify(h.log) === JSON.stringify(['reset', 'recorded', 'repaint:timeline', 'save:Renamed']));
  check('The step carries the label', h.history.undo.at(-1)._label === 'Rename Shot');
  check('The step holds the document from before the change', h.history.undo.at(-1).clips[0].name === 'Shot');
  check('One edit records one step', h.history.undo.length === 1);
}

{
  const h = harness();
  h.session.apply('Add track', () => {});
  check('The default scope repaints everything', h.log.includes('repaint:all'));
}

{
  const h = harness();
  assert.throws(() => h.session.apply('Broken', () => { h.state.clips[0].name = 'Half'; throw Error('failed'); }), /failed/);
  check('A throwing change keeps its step so Undo can restore the document', h.history.undo.length === 1 && h.history.undo[0].clips[0].name === 'Shot');
  check('A throwing change is not saved or repainted', !h.log.some(entry => entry.startsWith('save') || entry.startsWith('repaint')));
}

{
  const h = harness();
  h.session.record('Edit note');
  h.state.clips[0].name = 'Typing';
  check('Record takes the step for an edit that continues', h.history.undo.at(-1)._label === 'Edit note' && h.history.undo.at(-1).clips[0].name === 'Shot');
  check('Record leaves repainting and saving to the caller', JSON.stringify(h.log) === JSON.stringify(['reset', 'recorded']));
}

{
  const h = harness();
  assert.throws(() => h.session.apply('Typo', () => {}, 'inspectr'), /Unknown repaint scope/);
  check('An unknown scope fails before anything is recorded', h.history.undo.length === 0 && h.log.length === 0);
  check('Scopes are fixed', Object.isFrozen(SCOPES) && SCOPES.includes('none'));
}

console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
