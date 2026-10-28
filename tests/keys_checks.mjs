// Shortcut labels: Ctrl reads Cmd and Alt reads Option on a Mac, and nothing else changes.
// node tests/keys_checks.mjs
import {isMac, keyText} from '../ui/keys.js';

const checks = [];
const check = (label, ok) => { if (!ok) throw Error(label); checks.push(label); };
check('Mac and iPad platforms count as Mac', isMac('MacIntel') && isMac('macOS') && isMac('iPad') && !isMac('Win32') && !isMac('Linux x86_64') && !isMac(''));
check('Other platforms keep Ctrl and Alt', keyText('Ctrl+Shift+Z / Ctrl+Y · Alt-drag', false) === 'Ctrl+Shift+Z / Ctrl+Y · Alt-drag');
check('A Mac reads Cmd and Option', keyText('Ctrl+Shift+Z / Ctrl+Y · Alt-drag · Ctrl-click', true) === 'Cmd+Shift+Z / Cmd+Y · Option-drag · Cmd-click');
check('Only whole key names change', keyText('Alternative takes; Ctrlx', true) === 'Alternative takes; Ctrlx');
console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
