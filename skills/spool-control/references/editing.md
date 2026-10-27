# Media, timeline and export

## Project lifecycle and backups

`POST /spool/api/open-project` with `{folder}` opens a local project folder. `POST /spool/api/projects` with optional `{document,folder}` creates a project; an explicit folder must be an empty absolute path. Use the user's intended location. `GET /spool/api/projects/{project}/export` exports document, recipes and evidence as JSON. It bundles no media bytes: original footage, generated outputs, reference inputs and sidecars remain separate dependencies. `POST /spool/api/import-project` creates a new project from that JSON without copying those files. Do not describe JSON alone as a self-contained media backup.

Opening a folder, creating in an explicit folder, input upload, path import, reading originals, playback preparation and frame export require access from the host's loopback interface. A readable remote editor does not establish these capabilities. Use the permitted host-local API or editor path; do not restart a host or expose its local API just to bypass this boundary.

## Media import and reference files

- `POST /spool/api/import-footage?projectId=PROJECT` with `{path,fps,detectCuts:true}` imports a local file and returns prepared source/shot data. It does not save a timeline edit. Read the response and current `Media.import_footage`/editor import handler to construct the authored insertion.
- `POST /spool/api/upload?projectId=PROJECT&fps=FPS` uploads raw media. Returned metadata still needs an authored library/timeline insertion.
- `POST /spool/api/projects/{project}/input` uploads a workflow reference as raw bytes, `Content-Type: application/octet-stream`, and URL-encoded `X-Filename`. The returned `file` is a staged input path, not an automatic binding assignment. Set the literal binding and remove conflicting shot routing deliberately.

Use verified allowed file types and size limits from the current host. Do not encode the raw payload as JSON/base64 for these endpoints. For project media URLs, use `/spool/media/{project}/{relativePath}` with escaped components.

## Structural editing

Fetch the full project and retain its saved revision. Work on a detached copy of `document`, preserving unknown fields. Reuse pure operations in checkout `ui/timeline.js` for move, trim, ripple/roll, split, duplicate, unlink audio and track operations. Read relevant signatures before calling them; arbitrary edits to array order or `start` do not implement video-track timing.

Key semantics:

- Video position is derived per track from `gapBefore` and duration `out-in`; `layout(document)` gives sequence rows. `in` is inclusive and `out` exclusive.
- `document.fps` is the sequence frame clock. Every decoded source frame is interpreted once: 125 source frames run for 125/30 seconds in a 30 FPS sequence. Linked audio follows that interpretation. Independent audio uses sequence positions. Do not change sequence FPS to fix a duration without considering retiming.
- `splitClip(document, sequenceFrame, newId, clipId)` preserves lineage and enforces six-frame margins. `duplicateClip` also preserves take lineage. Verify that the new clip's `takeSourceIds` includes the source clip ID and inherited owners; there is no generic `lineage` field. Generate new stable IDs; do not recycle names or indexes as identity.
- Audio clips have `start`, `in`, `out`, track and settings; source lanes and music tracks differ. Use `unlinkAudio`, `splitAudio`, `addAudioClip` and existing edit sessions to preserve their rules.

After transformation, strip result projections with `ui/ledger.js` `authored(document)` or Python `spool.ledger.authored`. Generated takes/jobs are derived evidence; imported takes and lineage remain authored. PUT `/spool/api/projects/{project}` with `{revision,document:authoredDocument}`. Use exact-integer wire encoding. Preserve recipe versions, source references, chosen take IDs, notes and unrelated fields. New recipe captures need the route's `workflowRecipes` contract, not fabricated versions.

A successful save returns new state. Re-read and verify affected geometry and selection, ideally in the editor. Direct API saves do not promise a browser Undo entry. Keep a before snapshot for complex operations. On conflict, re-read and reapply the change against current state; never overwrite concurrent edits using a patched revision alone.

`POST /spool/api/projects/{project}/detect-cuts` with `{clipId,takeId}` returns cuts without automatically splitting the timeline. Translate returned cut positions using the documented source/sequence clock before applying edits.

Coordinate rules prevent double-offset and retiming errors:

- For sequence frame `F` inside a `layout` row, `/frame` expects `clip.in + F - row.start`, a frame local to that take's media. The backend adds the media's `sourceRange.start`; do not add it yourself.
- Detected cuts are offsets from the beginning of the current trimmed range. Their sequence positions are `row.start + cut`. Do not add `clip.in` again or rescale by intrinsic FPS.
- After each split, find the remaining fragment by its new identity before the next split. Reject out-of-range cuts and honor the timeline operation's minimum margins.

## Export

Use the editor's export path or build the plan with `ui/timeline.js` `exportRange(document)` and `exportPlan(document, range)`. The plan resolves visible video layers, gaps and audio; do not flatten only `document.clips` and ignore layering or audio.

POST the plan plus `projectId`, `fps`, `width` and `height` to `/spool/api/export?projectId=PROJECT`; it returns `{url,filename}`. Read the current export implementation for any additional encoding requirements. The default `exportRange(document)` ends at picture length when picture exists, which can exclude later soundtrack tails and trailing gaps. Choose an explicit range when those belong in the deliverable.

Keep `audioOffset` from `exportPlan` for a range starting after zero; do not also rebase its audio positions. Higher enabled video tracks determine picture, but linked sound from enabled lower tracks may still mix underneath. Monitor mute is a listening control and does not mute export. Verify source/music mute, solo, gain and fades in the actual plan.

Download the returned URL and verify duration `(end-start)/fps`, frame rate, dimensions, playback and relevant audio. `take-file` downloads the underlying original file, which can extend beyond an imported segment or current trim; use sequence export for a trimmed deliverable. API success alone does not establish quality.

Hiding a take and deleting its file are different operations. `/spool/api/projects/{project}/delete-takes/{clip}` accepts `{revision,takeIds}` and deletes media on disk; use it only for an explicit deletion request. Do not use permanent deletion as a substitute for reversible timeline/library cleanup.
