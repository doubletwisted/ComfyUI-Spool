// Undo/redo ownership: what a step carries, how a stack is bounded, and what
// survives a reload. Rendering, gestures and status text stay in the editor.
//
// A step used to be a deep copy of the whole editor state, so a 205-take project
// kept 40 copies of every take and could persist exactly one of them inside the
// 1.8 MB session budget. A take is immutable once it has an id, so a step carries
// take ids and the payload is remembered once in an archive. Media records and the
// workflow library are not carried at all: `ledger.preserveArrivals` re-supplies
// them on restore, and removing a media item is recorded as `hiddenMediaIds`.
import { UNDO_SKIPS as VIEW_KEYS } from './ledger.js';
export const LIMIT = 40;
export const BUDGET = 1800000;

const slim = state => {
  const entry = {};
  for (const [key, value] of Object.entries(state))
    if (!VIEW_KEYS.includes(key) && key !== '_label') entry[key] = value;
  entry.clips = (state.clips || []).map(clip => ({ ...clip, takes: (clip.takes || []).map(take => take.id) }));
  entry.audioClips = state.audioClips || [];
  return entry;
};

export function createHistory({ limit = LIMIT, budget = BUDGET } = {}) {
  const undo = [],
    redo = [],
    takes = new Map();

  // Remember each take once, then carry only what an edit can change. The slim
  // structure is copied so a later in-place gesture cannot reach into a step.
  function remember(state, label = '') {
    for (const clip of state.clips || [])
      for (const take of clip.takes || []) if (!takes.has(take.id)) takes.set(take.id, take);
    return { ...JSON.parse(JSON.stringify(slim(state))), _label: label };
  }

  // A step is only usable if every take it names is still remembered.
  function hydrate(entry) {
    if (!entry || !Array.isArray(entry.clips)) return null;
    const restored = {};
    for (const [key, value] of Object.entries(entry)) if (key !== '_label') restored[key] = value;
    restored.clips = [];
    for (const clip of entry.clips) {
      const members = [];
      for (const id of clip.takes || []) {
        const take = takes.get(id);
        if (!take) return null;
        members.push(take);
      }
      restored.clips.push({ ...clip, takes: members });
    }
    return restored;
  }

  // Prune the archive to what the retained stacks still name, so expiring steps and
  // clearing redo cannot leak take payloads.
  function prune() {
    const live = new Set();
    for (const entry of [...undo, ...redo])
      for (const clip of entry.clips || []) for (const id of clip.takes || []) live.add(id);
    for (const id of [...takes.keys()]) if (!live.has(id)) takes.delete(id);
  }

  function clear() {
    undo.length = 0;
    redo.length = 0;
    takes.clear();
  }

  function record(state, label) {
    undo.push(remember(state, label));
    while (undo.length > limit) undo.shift();
    redo.length = 0;
    prune();
    return undo;
  }

  // Undo moves the current state onto the redo stack, so it must be remembered too.
  function step(from, to, state) {
    if (!from.length) return null;
    const entry = from.pop();
    to.push(remember(state, entry._label));
    while (to.length > limit) to.shift();
    const restored = hydrate(entry);
    if (!restored) {
      clear();
      return null;
    }
    prune();
    return { restored, label: entry._label };
  }

  // Newest first, so the budget is spent on the steps closest to what is shown.
  function choose(entries, available) {
    const chosen = [];
    let used = 0;
    for (let index = entries.length - 1; index >= 0; index--) {
      const text = JSON.stringify(entries[index]);
      if (used + text.length + 1 > available) break;
      chosen.push(entries[index]);
      used += text.length + 1;
    }
    return { chosen: chosen.reverse(), used };
  }

  function accountant() {
    const ids = new Set();
    let chars = 2;
    const cost = id => {
      const take = takes.get(id);
      return id.length + (take ? JSON.stringify(take).length : 0) + 8;
    };
    return {
      ids,
      get chars() {
        return chars;
      },
      add(entry) {
        for (const clip of entry.clips || [])
          for (const id of clip.takes || [])
            if (!ids.has(id)) {
              ids.add(id);
              chars += cost(id);
            }
      },
    };
  }

  function payloadFor(entries) {
    const ids = new Set();
    for (const entry of entries) for (const clip of entry.clips || []) for (const id of clip.takes || []) ids.add(id);
    const held = {};
    for (const id of ids) if (takes.has(id)) held[id] = takes.get(id);
    return held;
  }

  // The archive is shared by every step, so it is charged once against the whole
  // budget and the remainder is split in favour of undo: undo is the stack a reload
  // reaches for first, but redo must survive too rather than be silently discarded.
  // If nothing fits, the chain is explicitly empty instead of over the quota.
  function serialize(signature) {
    const head = '{"project":' + JSON.stringify(signature) + ',"takes":',
      open = ',"undo":[',
      middle = '],"redo":[',
      tail = ']}';
    const available = budget - head.length - open.length - middle.length - tail.length;
    const budgeted = accountant();
    for (const entry of [...undo, ...redo]) budgeted.add(entry);
    const remaining = Math.max(0, available - budgeted.chars);
    const chosen = choose(undo, redo.length ? Math.floor((remaining * 3) / 4) : remaining);
    const chosenRedo = choose(redo, Math.max(0, remaining - chosen.used)).chosen;
    const text =
      head +
      JSON.stringify(payloadFor([...chosen.chosen, ...chosenRedo])) +
      open +
      chosen.chosen.map(entry => JSON.stringify(entry)).join(',') +
      middle +
      chosenRedo.map(entry => JSON.stringify(entry)).join(',') +
      tail;
    if (text.length > budget) throw Error('History exceeds its session budget');
    return text;
  }

  function load(text) {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return 0;
    }
    if (!parsed || !Array.isArray(parsed.undo) || !Array.isArray(parsed.redo)) return 0;
    for (const [id, take] of Object.entries(parsed.takes || {})) if (!takes.has(id)) takes.set(id, take);
    // Adopt only a chain that reconstructs completely, so a trimmed or corrupt
    // blob cannot make an undo restore a partial edit.
    for (const entry of [...parsed.undo, ...parsed.redo]) if (!hydrate(entry)) return 0;
    undo.length = 0;
    redo.length = 0;
    undo.push(...parsed.undo);
    redo.push(...parsed.redo);
    return undo.length + redo.length;
  }

  return {
    undo,
    redo,
    remember,
    hydrate,
    record,
    step,
    serialize,
    load,
    clear,
    get size() {
      return { steps: undo.length + redo.length, takes: takes.size };
    },
  };
}

export function sameStacks(saved, undo, redo) {
  const same = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);
  return same(saved.undo, undo) && same(saved.redo, redo);
}
