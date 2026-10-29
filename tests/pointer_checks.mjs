// Gesture interruption: blur and a hidden tab cancel every registered gesture.
// node tests/pointer_checks.mjs
import { createInterruptions } from '../ui/pointer.js';

const checks = [];
const check = (label, ok) => {
  if (!ok) throw Error(label);
  checks.push(label);
};
const view = new EventTarget(),
  doc = Object.assign(new EventTarget(), { hidden: false });
const interruptions = createInterruptions(view, doc),
  cancelled = [];
interruptions.on(() => cancelled.push('clip drag'));
interruptions.on(() => cancelled.push('panel resize'));

view.dispatchEvent(new Event('blur'));
check('Losing the window cancels every registered gesture', cancelled.join() === 'clip drag,panel resize');
doc.dispatchEvent(new Event('visibilitychange'));
check('Becoming visible again cancels nothing', cancelled.length === 2);
doc.hidden = true;
doc.dispatchEvent(new Event('visibilitychange'));
check('Hiding the tab cancels every registered gesture', cancelled.length === 4);
interruptions.dispose();
view.dispatchEvent(new Event('blur'));
doc.dispatchEvent(new Event('visibilitychange'));
check('A disposed editor no longer listens', cancelled.length === 4);

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
