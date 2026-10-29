// Generated arrivals enrich local edits without changing chosen media or trim geometry.
const copy = x => JSON.parse(JSON.stringify(x));
const sortedKeys = (key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, value[key]]),
      )
    : value;
// One field list decides what a project document carries; tests/fixtures/document_fields.json
// pins it to spool/ledger.py. Edit fields are the authored edit: saved, undone and compared to
// detect another editor's change. Records are saved but never undone or compared. View fields
// stay in this tab. Undo restores the edit and where the editor was looking, not display settings.
export const EDIT_FIELDS = Object.freeze([
  'project',
  'brief',
  'fps',
  'fpsExplicit',
  'resolution',
  'exportRange',
  'clips',
  'tailGap',
  'videoTracks',
  'videoTailGaps',
  'disabledVideoTracks',
  'audioClips',
  'audioTracks',
  'hiddenMediaIds',
  'deletedTakeIds',
  'deletedMediaIds',
]);
export const RECORD_FIELDS = Object.freeze([
  'jobs',
  'recoverableResults',
  'media',
  'importedWorkflows',
  'clearedRenderIds',
]);
export const VIEW_FIELDS = Object.freeze([
  'selected',
  'selectedAudio',
  'selection',
  'takeSelection',
  'frame',
  'zoom',
  'snap',
  'muted',
  'loop',
  'trimSingle',
  'viewerZoom',
  'previewQuality',
  'activeVideoTrack',
]);
export const EDITOR_TAKE_FIELDS = Object.freeze([
  'id',
  'number',
  'revision',
  'seed',
  'generated',
  'media',
  'summary',
  'recipeGraph',
]);
export const TAKE_SUMMARY_FIELDS = Object.freeze(['attemptId', 'workflowVersion', 'inputValues', 'bindings']);
export const UNDO_SKIPS = Object.freeze([...RECORD_FIELDS, 'zoom', 'snap', 'muted', 'loop', 'previewQuality']);
// What the editor saves, in its established order; the server owns jobs' recoverable results.
const SAVED_ORDER = [
  'deletedTakeIds',
  'deletedMediaIds',
  'exportRange',
  'clearedRenderIds',
  'brief',
  'project',
  'fps',
  'resolution',
  'fpsExplicit',
  'clips',
  'jobs',
  'media',
  'tailGap',
  'videoTracks',
  'videoTailGaps',
  'disabledVideoTracks',
  'audioClips',
  'audioTracks',
  'hiddenMediaIds',
  'importedWorkflows',
];
const OMIT_EMPTY = new Set(['deletedTakeIds', 'deletedMediaIds', 'clearedRenderIds', 'hiddenMediaIds']),
  SAVED_DEFAULTS = { brief: '', tailGap: 0, disabledVideoTracks: [], audioClips: [], importedWorkflows: [] };
export function savedDocument(state) {
  const out = {};
  for (const key of SAVED_ORDER) {
    const value = state[key] ?? SAVED_DEFAULTS[key];
    if (
      value === undefined ||
      (OMIT_EMPTY.has(key) && !value.length) ||
      ((key === 'exportRange' || key === 'videoTracks' || key === 'videoTailGaps') && !value)
    )
      continue;
    out[key] = value;
  }
  return out;
}
export function authored(doc) {
  const { jobs, recoverableResults, ...document } = doc;
  return copy({ ...document, clips: doc.clips.map(c => ({ ...c, takes: c.takes.filter(t => !t.generated) })) });
}
// How each edit field compares: defaults stand in for absent values and id sets ignore order.
const sortedIds = values => [...(values || [])].sort();
const SIGNATURE = {
  brief: p => p.brief || '',
  clips: p => p.clips.map(({ takes, ...c }) => c),
  tailGap: p => p.tailGap || 0,
  videoTracks: p => p.videoTracks || 1,
  disabledVideoTracks: p => [...(p.disabledVideoTracks || [])].sort((a, b) => a - b),
  hiddenMediaIds: p => sortedIds(p.hiddenMediaIds),
  deletedTakeIds: p => sortedIds(p.deletedTakeIds),
  deletedMediaIds: p => sortedIds(p.deletedMediaIds),
  audioClips: p => p.audioClips || [],
};
export function editSignature(project) {
  return JSON.stringify(
    Object.fromEntries(EDIT_FIELDS.map(key => [key, SIGNATURE[key] ? SIGNATURE[key](project) : project[key]])),
    sortedKeys,
  );
}
// A media record is the same shape in Python and here: a string id and a media kind.
export function mediaRecords(value, found = []) {
  if (Array.isArray(value)) {
    for (const child of value) mediaRecords(child, found);
  } else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && ['video', 'image', 'audio'].includes(value.kind)) found.push(value);
    for (const child of Object.values(value)) mediaRecords(child, found);
  }
  return found;
}
// Re-attach stored evidence, restoring the shape a saved project has, so a local
// draft stays portable when it is imported into a new project.
export function compose(document, evidence) {
  const working = copy(document);
  for (const record of mediaRecords(working)) {
    const held = evidence?.[record.id];
    if (held) Object.assign(record, copy(held));
    delete record.evidence;
    delete record.embeddedGraph;
  }
  return working;
}
export function mergeArrivals(local, incoming) {
  for (const key of ['deletedTakeIds', 'deletedMediaIds', 'clearedRenderIds']) {
    const ids = [...new Set([...(local[key] || []), ...(incoming[key] || [])])];
    if (ids.length) local[key] = ids;
  }
  const deleted = new Set(local.deletedTakeIds || []),
    media = new Set(local.deletedMediaIds || []);
  for (const c of local.clips) {
    const latest = incoming.clips.find(x => x.id === c.id);
    if (latest) {
      const known = new Set(c.takes.map(t => t.id));
      c.takes.push(...latest.takes.filter(t => !known.has(t.id)));
    }
    c.takes = c.takes.filter(t => !deleted.has(t.id) && !media.has(t.media?.id));
    c.takes.sort((a, b) => !!a.generated - !!b.generated || a.number - b.number);
  }
  if (local.media) local.media = local.media.filter(m => !media.has(m.id));
  local.jobs = incoming.jobs;
  if (incoming.recoverableResults) local.recoverableResults = incoming.recoverableResults;
  else delete local.recoverableResults;
  return local;
}
export function preserveArrivals(restored, current) {
  mergeArrivals(restored, current);
  restored.media = current.media;
  const imported = restored.importedWorkflows || [],
    known = new Set(imported.map(w => w.id));
  restored.importedWorkflows = [...imported, ...(current.importedWorkflows || []).filter(w => !known.has(w.id))];
  return restored;
}
export function inheritLineage(source, target) {
  target.takeSourceIds = [
    ...new Set([source.id, ...(source.takeSourceIds || []), ...(source.takeOwnerId ? [source.takeOwnerId] : [])]),
  ];
  return target;
}
