// Pending uploads belong to the most recent explicit choice for a clip input.
export function createInputReplacements() {
  const pending = new Map();
  function invalidate(clipId) {
    if (clipId === undefined) pending.clear();
    else pending.delete(clipId);
  }
  function begin(clip, key) {
    let inputs = pending.get(clip.id);
    if (!inputs) {
      inputs = new Map();
      pending.set(clip.id, inputs);
    }
    const token = {},
      version = clip.workflowVersion,
      before = clip.inputValues[key],
      sources = JSON.stringify(clip.shotInputs || []);
    inputs.set(key, token);
    function owns(current) {
      return (
        !!current &&
        pending.get(clip.id)?.get(key) === token &&
        current.workflowVersion === version &&
        current.inputValues[key] === before &&
        JSON.stringify(current.shotInputs || []) === sources
      );
    }
    function finish() {
      if (pending.get(clip.id)?.get(key) !== token) return;
      inputs.delete(key);
      if (!inputs.size) pending.delete(clip.id);
    }
    return { owns, finish };
  }
  function choose(clipId, key) {
    const inputs = pending.get(clipId);
    inputs?.delete(key);
    if (!inputs?.size) pending.delete(clipId);
  }
  return { begin, choose, invalidate };
}
