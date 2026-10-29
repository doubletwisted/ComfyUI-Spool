# Project-edit ownership

`ui/project-edit.js` owns one editor's authored draft, saved revision, pending PUT,
retry/conflict state and capture reservation. It gives this module depth by
keeping response-adoption policy behind one interface. Each studio tab
instantiates it; SQLite remains the authority shared by every tab and agent.

The seam is deliberately narrow. `ui/editor.js` supplies adapters that read the
authored document, apply a project receipt, send a request, report status, and
identify UI conditions that block polling or navigation. Generated takes and
jobs do not enter the authored document. Applying a ledger receipt merges jobs
and takes without changing the draft, selected take, playhead or selection.

- `save` coalesces pending edits; `flush` awaits the actual PUT promise. A failed
  PUT retains its draft for explicit retry. A 409 preserves the draft and requires
  explicit `reload`; offline draft export remains a UI action independent of saving.
  An active editing gesture blocks both saving and flushing; scrub remains allowed.
- `poll` checks ownership both before and after GET. A revision/signature/epoch
  change, capture reservation, failed save, drag or focused field prevents
  replacement. A capture that begins and ends during GET still invalidates it.
- `beginCapture` reserves before asynchronous preparation. Its session can be
  canceled, committed, then finished only by its owner. The UI controls dialog
  DOM and inert state; it releases inert only when `finish` confirms ownership.
- `change` records the draft before transport. A late receipt merges the ledger
  and saves newer edits instead of replacing them. Raw workflow imports use
  strict adoption: a changed draft stays local and the import remains in the
  server library until explicitly reopened. Raw JSON bytes stay backend-parsed.
- `prepareNavigation` flushes and rechecks dialog/gesture/capture ownership before
  returning control to the existing project-preserving Comfy link.

This improves locality: draft and revision decisions no longer depend on flags
spread across UI handlers. Test leverage comes from exercising the production
module through its interface with controlled transport order. Run:

```powershell
node tests/project_edit_checks.mjs
node tests/capture_boundary_checks.mjs
```

Both suites import complete production modules. `ui/workflow-setup.js` owns
capture decisions and completion while project-edit retains the reservation.
The dialog adapter paints questions and restores interactivity only when its
committed owner finishes. Installed checks live in the startup browser harness. Their synthetic timing/receipt evidence is labeled separately
from real SQLite requests. `poll` can skip while a GET is already in flight; a
caller that needs eventual convergence must wait for the observed revision.

The [studio runtime](editor.md) supplies these adapters directly.

## Take ledger

`ui/ledger.js` owns authored projection, edit signatures, arrival merging and
lineage inheritance. `spool/ledger.py` owns authored/view separation, the existing
four-way ownership predicate, job/take attachment and import detachment. The
shared `tests/fixtures/ledger_cases.json` pins direct, split, copied, deleted and
reused-take ownership. A deleted owner leaves a visible job without assigning its
result to another position. The chosen-take-ID predicate is retained as an
existing product rule; changing it requires a separate decision.

The project-edit authored signature is `JSON.stringify(ledger.authored(...))`: it
includes imported take lists and means saving is dirty. The ledger edit signature
ignores take lists, media and the workflow library: it means timeline content
changed and decides drag adoption and undo validity. `project-edit.js` remains
dependency-free. `mergeArrivals` appends unknown takes by clip identity and copies
jobs without changing trims or chosen take. `preserveArrivals` additionally keeps
current media and unions imported workflows for undo/redo/cancel.

Conflict reload retains its explicit history clear: a remote library-only change
can have the same edit signature, so `receiveProject` does not always clear it.

Compact poll responses containing only job status/progress use the `progress`
adapter. They retain authored object identity and the accepted revision. The
studio patches render rows, pending-take status and clip badges without adopting
a project receipt or rebuilding timeline/inspector DOM. Full receipts continue
through the existing revision and ledger-adoption checks.
