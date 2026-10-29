// One authored edit, applied the same way everywhere: clear the transient cut and
// nudge state, record the undo step from the document before the change, make the
// change, repaint what it touched, then save. Gestures that change the document
// across pointer moves (drags, audio level, nudges) and workflow captures keep
// their own `before` copy and record it when they finish.
export const SCOPES = Object.freeze(['all', 'inspector', 'timeline', 'audio', 'range', 'none']);

export function createEditSession({ history, current, reset, recorded, repaint, save }) {
  // Record the step for an edit that continues after this call, such as typing a
  // note. The caller changes the document and saves when the edit settles.
  function record(label) {
    reset();
    history.record(current(), label);
    recorded();
  }

  // `change` runs after the step is recorded; its return value is returned. A
  // throwing change keeps its step, so Undo restores the document from before it,
  // and nothing is saved. `scope` names what the editor repaints.
  function apply(label, change, scope = 'all') {
    if (!SCOPES.includes(scope)) throw Error('Unknown repaint scope: ' + scope);
    record(label);
    const result = change();
    repaint(scope);
    save();
    return result;
  }
  return { apply, record };
}
