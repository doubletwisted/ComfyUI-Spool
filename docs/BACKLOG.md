# Spool backlog

Outstanding work, roughly in priority order. Add new issues with concrete
reproduction steps and the owning module. Remove an entry when its fix reaches
`main`, and note user-facing changes in [CHANGELOG.md](../CHANGELOG.md).

## Open work

### Cloud: interrupted-submit recovery

Run `cloud-smoke` against the Developer Platform with a key on a plan that allows
API keys (Partner Nodes are verified). A connection lost after a Cloud
submission but before its job ID is recorded leaves the attempt uncertain. Add an
explicit, verified adoption flow for the remote job if users need it. Never retry
the submission automatically: the SDK's idempotency key prevents duplicate
billing, but the endpoint does not replay a lost job ID.

### File delivery outside Spool

A production host once returned headers with no payload for video and core
ComfyUI scripts. The process-wide cause is not established. Spool streams its own
files and the test entry points disable native sendfile. If loading problems
persist, verify ComfyUI's own asset delivery after a restart. No core or global
library patch was made.

### Source-file choices in linked Comfy tabs

LoadImage choices come from cached node definitions. After reloading a linked
Comfy tab, or after uploading files once the definitions were loaded, a
project-staged image can show "Media input missing" although the file exists and
its thumbnail loads. Refresh the loader's options when a graph opens or after an
import, without changing the selected source, rewriting metadata or downloading
every schema on each selection.

### Linked editing across browser origins

Linked live commands use BroadcastChannel, so Spool and ComfyUI must share an
origin. A validated postMessage transport could keep the live link across
separate origins. Do not fall back to capturing an arbitrary active graph.

### Folder ownership

- Reconcile external file renames and deletions explicitly, keeping stable media
  IDs, selected-take diagnostics and undo semantics. Discovery currently adds new
  files only.
- Make moving a take to its own clip mirror reversible physical file ownership,
  including generated receipt media, splits and undo/redo.
- Measure snapshot write amplification on large projects on network storage.
  Keep transient focus updates from forcing large snapshots if measurements
  justify it.
- Add project-folder creation and opening to the scoped agent commands; the
  folder HTTP routes already serve the editor and agents.

### Agent-led iteration and take review

Keep project instructions in the agent conversation, separate from the video
prompt. Extend the scoped commands for image, prompt and duration changes,
workflow mapping and experiment plans; ask only about ambiguous input roles.
Show notes, ratings and comparison beside takes when that area is redesigned.

### Paused-video seek can show stale footage

Observed when reusing a video element across viewer and clip transitions while
stepping paused footage. Root cause and repeatability are unresolved. Owner:
editor playback and `ui/video-seek-guard.js`. Capture the exact switch and seek
sequence and compare decoded pixels, requested time and frame callbacks in a
healthy and a failing run. Acceptance: the displayed frame advances correctly and
the bounded guard neither reloads healthy footage nor loops.

### Strict attempt transitions

`Store.transition` logs invalid transitions; complete attempts stay immutable.
Cover every dispatch and recovery path before rejecting invalid transitions.
Keep intent recovery, uncertain/no-redispatch, collection retry and late-failure
protection.

### Workflow slots

Owner: `ui/profile.js` (proposers) and the inspector. Typed source and
conditioning walks, seeds, frame counts and duration metadata are done.
Remaining, in order:

1. Measure how many installed templates profile after each step and template
   package update.
2. A slot card in the inspector with source tags, unresolved badges and "Pick in
   graph" through the bridge; accepted mappings keyed by workflow fingerprint;
   frame-count constraint presentation and validation.
3. Read App mode `extra.linearData` and promoted subgraph widgets, including the
   subgraph-to-API node ID mapping.
4. Remaining gaps: linked or generated text, seconds/fps and other duration
   formulas, dynamic interface inputs, LTX frame-index roles.
5. Write and read `extra.spool` for "Save as Spool-ready".
6. Optional slot suggester (an LLM or a typed classifier): opt-in, with the user's
   credentials, never at queue time.

Acceptance: ordinary drops never block; ambiguous first/last frame or prompt
roles ask once; template coverage is reported, not assumed.

### Timeline interchange

OTIO export writes the authored layers referencing media in place. Verified in
DaVinci Resolve Studio 21.1.1 with SOCRATES2 (30 fps sequence, 24 fps takes on NAS
paths). In a 30 fps project every clip's position, length, source in/out and 125%
speed matched, the media was online, and the off tracks came in off. Resolve rejected
`file://` URLs, so references are plain paths. Resolve ignores the file's rate and
uses the project's, and shows file names instead of clip names. Not verified yet in
Premiere Pro or Kdenlive, or with source timecode other than zero; check the same
points there.
Possible follow-ups if needed: collecting media into a package (`.otioz`), FCP 7
XML for editors without OTIO, gain as an editor-specific field, and
sequence resolution where an importer reads one.

### Editing

- Join clips: a false cut cannot be merged yet.
- Path import is one blocking request; add progress if long sources need it.
- Changing the frame rate after media is added requires conforming media and
  clip/audio timing, which is not implemented.

### Batching, warm workers and remote ComfyUI

Separate improvements, measured first:

- Measure cold start, model load, render time, memory and transfer for
  representative video workflows; compare one job per take with chunked jobs.
- Group compatible recipes by topology, unbound values, binding contracts and
  resources, keeping per-execution isolation and receipts under chunking and
  retries.
- Evaluate dedicated warm endpoints with host identity, GPU ownership, input
  staging and isolated output copying.
- For a remote ComfyUI, add a narrow Spool transport for frozen commands,
  capabilities and artifacts. Do not share SQLite across a network filesystem or
  use ordinary `/prompt` retries in place of the command protocol.
