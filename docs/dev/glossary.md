# Spool glossary

Terms used in code, docs and architecture reviews. This file fixes vocabulary;
module contracts are in [architecture.md](architecture.md).

## Editing

- **Project**: one saved edit, stored as a project folder with `project.spool`.
  SQLite holds its current **Revision**; retired revision snapshots are not kept.
- **Authored document**: the part of a project a person edits: clips, trims,
  gaps, chosen take, soundtrack, imported library items and imported takes.
  It excludes view state (playhead, selection, zoom) and **generated takes**.
- **Draft**: an editor's local authored document that is not yet saved at the
  current revision. Owned by `ui/project-edit.js`.
- **Clip**: one item on a video track. It has a permanent ID, a **Recipe**
  reference (`workflowVersion`), **Bindings**, current input values, trims
  (`in`/`out`), `gapBefore`, its takes and the chosen `takeId`.
- **Gap**: empty frames before a clip (`gapBefore`) or at the end (`tailGap`).
- **Edit gesture**: trim, ripple, roll, slip, slide or move, resolved from the
  target (body/edge, shared cut) plus held modifiers (Shift, Alt, S, D).
- **Edit session**: `ui/edit-session.js`. Applies one authored edit the same way
  everywhere: clear the selected cut and nudge group, record the undo step, make
  the change, repaint its scope, save. Pointer gestures keep their own `before`
  copy and record it on release.
- **Timeline edit module**: `ui/timeline.js`. Pure operations on the
  authored document: layout, gaps, gestures, split/duplicate/remove, take choice,
  soundtrack placement and the export plan.
- **Soundtrack (A2)**: independent audio clips on the sequence clock. Linked
  source audio (A1) follows its video clip.
- **Project frame rate**: `document.fps` (default 24), the sequence clock.
  Source footage retains its decoded frames and intrinsic FPS; each frame is
  interpreted once on the sequence clock. Linked audio follows that speed,
  while independent soundtrack placement uses sequence frames.

## Generation

- **Recipe**: an immutable captured workflow version: editor graph, executable API
  prompt, bindings and the chosen result saver output. Stored in `workflows`.
- **Binding**: an exact (API node ID, input name) pair exposed as a clip control.
- **Optional input**: a media binding that may stay empty (`optional`). A request
  leaves it out of the prompt, with the nodes listed in its `omit`.
- **Input group**: media bindings sharing a `group` that fill one repeatable node
  input in order, such as MiniMax's reference images. A request moves filled ones
  into the first slots. A recipe's `inputRules` name groups of which at least one
  input must be filled.
- **Spool workflow**: a built-in workflow Spool ships as files in
  `spool/builtin_workflows/`, as opposed to a curated Comfy template.
- **Workflow setup**: preparing a workflow, choosing its result and exposed
  controls, then explicitly capturing an immutable Recipe for a Clip.
  `ui/workflow-setup.js` owns those decisions and capture completion; project-edit
  retains reservation/revision ownership and the editor supplies the dialog.
- **Attempt**: one execution of a frozen request. It has a permanent ID, a take ID,
  a prompt ID and a status. The statuses and their transitions are defined in
  `spool/attempts.py` and pinned by `tests/fixtures/attempt_statuses.json`.
- **Frozen request**: the exact prompt, input values, frozen assets and output
  namespace persisted before dispatch.
- **Batch input snapshot**: immutable frozen input bytes shared by unchanged
  inputs within one accepted batch. Every Attempt still has its own identity,
  settings and output namespace. A later batch creates a new snapshot.
- **Execution target**: where an attempt computes: local Comfy, Cloud or
  Deadline. The frozen request records the resolved target and
  `attempts.target_of` reads it (a Deadline submission row also marks older
  Deadline work); host capabilities and configuration determine which adapters
  are available.
- **Receipt**: the versioned terminal record of a collected attempt. It lists the
  exact artifacts and the primary artifact, and it is written atomically next to them.
- **Take**: one candidate result for a clip. **Generated takes** come from complete
  attempts and are never stored in the authored document. **Imported takes** are
  footage the user added, and they are authored.
- **Original clip**: an imported take (`original: true`) holding one detected shot
  of a source video as its own review file. `media.sourceRange` records the shot's
  start and length in project frames of `media.originalFile`.
- **Take ledger**: the rule set for which clips receive a generated take, and how
  arriving takes merge into a local draft without changing the edit. Owned by
  `spool/ledger.py` and `ui/ledger.js`.
- **Take lineage**: `takeSourceIds` / `takeOwnerId` on a clip created by split or
  duplicate, so results for the original clip also arrive on the copy.
- **Take review**: view-only Source, Compare and Try in edit choices, with a source
  playhead independent of the sequence. `ui/take-review.js` owns their transitions.
  Only Use take changes the authored choice; playback and hover decoding stay
  outside this module.

## Integration

- **Bridge**: the per-Comfy-tab BroadcastChannel (`spool-comfy-<id>`) the studio uses
  to ask the Comfy page for graph capture, workflow-tab drops and opening graphs.
  Its wire contract, and those of the graph handoff and the embedded template
  documents, are owned by `ui/bridge.js`.
- **Exact integer**: `{"__spool_int__": "<decimal>"}`, the wire form of integers
  beyond JavaScript's safe range (`spool/wire.py` and `ui/wire.js`).
- **Local control**: the request guard in `spool/routes.py`. Mutations need a
  same-origin page or an origin-less local tool; routes that reach beyond project
  files also need a loopback peer and host name. See [Security and network access](../guide/security.md).
