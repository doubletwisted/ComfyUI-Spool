# Architecture

Spool is a ComfyUI extension with three parts: a Python backend that owns
projects and execution, the studio (a browser app served at `/spool/`), and a
small Comfy page extension. Vocabulary is defined in [the glossary](glossary.md).

```text
ComfyUI page (web/*)  ── BroadcastChannel bridge ──  Studio (ui/*)
        │                                               │
        └──────────── HTTP /spool/api/* ────────────────┘
                              │
                     Python backend (spool/*)
              project folders · SQLite · execution targets
```

## Backend (`spool/`)

`__init__.py` registers the routes on ComfyUI's server and starts the local
executor. `__main__.py` runs the same routes standalone (`python -m spool`).

- **HTTP surface:** `routes.py` (every `/spool/api` route and the local-control
  guard), `editor.py` (serves the studio), `cli.py` (thin HTTP client).
- **Projects:** `projects.py` (folders, local working SQLite, snapshot
  publication under a lock), `store.py` (the only module that knows the tables:
  `editing` changes a document at a revision, named reads and writes do the
  rest), `ledger.py`
  (authored document, take ownership, generated-take projection), `notes.py`,
  `maintenance.py` (prune and reclaim).
- **Commands and operations:** `commands.py` holds typed agent commands with scope,
  budgets and operation replay. `operations.py` holds the project operations both
  routes and commands perform (take choice and trim refit, workflow assignment,
  Use take and Apply to clip with their `take.json` ordering).
- **Requests and attempts:** `requests.py` freezes a generation request
  independently of a running Comfy. `attempts.py` is the Attempt module: statuses,
  allowed transitions, Cancel policy and `target_of`, the one rule for where an
  attempt computes. `ownership.py` gives one process the dispatch role.
- **Execution targets:** `execution_targets.py` defines one `ExecutionAdapter`
  contract and the local, Deadline and Cloud adapters, selected by
  `attempts.target_of`. `prepare`, `submit`, `observe`, `cancel` and `recover`
  return dictionaries with submission material, acknowledgments, observations or
  decisions; adapters never write the project store. Cancellation separates the
  ownership check, transactional plan and external send so an unconfirmed delivery
  stays retryable. Recovery never resubmits uncertain work.
  `execution.py` owns local/Deadline claims, executor identity, host hooks and
  validation, the frozen-prompt semantic check and guarded status transitions.
  `farm.py` applies Deadline observations and verifies/accepts worker receipts;
  it holds every `deadlinecommand` call. `deadline_job.py`, `deadline_task.py`
  and `farm_protocol.py` are the submission, worker script and receipt protocol.
  `cloud.py` drives the same adapter contract through `comfy-sdk` in its own loop,
  because it needs no local Comfy; it persists job IDs and accepts downloaded
  receipts through the shared collector. `commands.py` applies adapter cancellation
  and recovery decisions under the existing scope, replay and delivery guards.
- **Results:** `receipts.py` (atomic, versioned receipts), `collection.py`
  (recovery without Comfy's queue), `folder_takes.py` (external takes in clip
  folders), `sidecars.py` (`take.json` workflows), `take_files.py` (permanent
  deletion), `take_workflow.py` (continue from a take).
- **Workflows:** `workflows.py`, `workflow_inputs.py` (loader addresses, and
  optional and grouped media inputs: what blocks a request and what it leaves
  out), `graph_inputs.py`, `templates.py` (built-ins: Spool's own workflow files
  in `builtin_workflows/` and curated Comfy templates), `cloud_templates.json`.
- **Media:** `media.py` (probing, proxies, staging, playback copies), `timing.py`
  (source-frame clocks), `cuts.py` (hard-cut detection), `export.py` (MP4),
  `interchange.py` (OpenTimelineIO JSON, written without the OTIO package).
- **Host:** `launcher.py` (starts a configured ComfyUI), `system.py` (what
  differs between Windows, macOS and Linux: finding ffmpeg and `deadlinecommand`,
  showing files in the file manager), `credentials.py` (Cloud key), `requirements.py` (reported requirements), `wire.py` (exact integers).

Storage and project-folder work runs off ComfyUI's event loop through
`asyncio.to_thread`. Live SQLite stays on the local disk; project folders hold
the published snapshot.

## Project format

A project folder has a `project.spool` SQLite snapshot and a small `project.json`
manifest: `format: "spool-project"`, `formatVersion` (the SQLite `user_version`),
`projectId` and `writtenBy` (the Spool version). There is one format number;
currently it is 6. Opening reads the manifest first and refuses a newer format
before opening SQLite. Older folders without a manifest acquire it on their next
published write. JSON exports use their separate `spoolVersion: 1` envelope;
imports reject unknown export versions before creating a destination.

`store.py` owns ordered, numbered migration steps. Each commits its data and
version together, version last; a failed step rolls back and can run again.
Completed earlier steps remain committed. Released steps are frozen: changes
require a new number. Before upgrading a folder, Spool copies its last published
snapshot to `.spool/backups/project-schema<old>-<UTC timestamp>.spool`. Schema 6
packs existing evidence, then compacts through the existing local-cache path
after commit. Newer SQLite versions are refused even without a manifest.

Schema 6 keeps immutable JSON in `blobs(hash TEXT PRIMARY KEY, data TEXT NOT NULL)`.
The hash is SHA-256 of `store.encode`'s canonical UTF-8 JSON; a reference is
`{"__spool_blob__": "<hash>"}`. Recipe captures share their workflow and prompt
blobs; attempt requests refer to the same captures. API nodes, editor nodes and
subgraph definitions also share blobs, so changing a seed does not copy the
whole graph. Authored document captures and imported workflow records use the
same packing boundary. Scalars used by SQL remain directly accessible.
Attempt results and execution receipts refer to one receipt blob. Receipts name
`primaryArtifactId` instead of duplicating the primary artifact. Storage markers
restore the original receipt envelope, including whether it exposed that ID.

A media file owns its embedded workflow and prompt. Artifact fields and separated
media evidence use `{"__spool_media__": "<original path>", "key": "workflow" | "prompt",
"graph": true | false}` instead of storing those values. Identical members of
prepared `workflowData` use the same references; distinct sidecar/prepared values
remain stored. During migration paths come from authored records, collected
artifacts or the original probe filename. Probes retain their streams and format
fields except `format.tags`, extracting the metadata before dropping those tags.
One editor graph remains available per recipe capture.

Routine project, attempt and receipt reads expose `evidence` / `embeddedGraph`
markers for file-owned fields. The evidence routes, continuation, sidecar creation
and portable export resolve them from the original file (PNG tags or video probe)
on demand. Resolution is cached only within a read; a missing original reports
`Source media is missing or unsupported`. SQLite does not substitute a stale graph.
The history prompt tuple keeps the exact API prompt, number, prompt ID, outputs,
status, messages and other metadata. Its editor graph uses a file reference when
it equals an artifact's embedded graph; other graphs share stored blobs, including
with dispatch metadata.

Projection passes decoded requests/results directly to the ledger, avoiding a
JSON encode/decode round trip. Identical decoded blobs share objects within that
response, whose captures are treated as immutable by readers; later reads are
independent. The bounded process cache holds only JSON text, so caller mutations
cannot corrupt later reads. The editor still omits `workflowSnapshot` and media
evidence. No Python/JavaScript authored document fields or wire versions change.
Maintenance reports open immutable read-only snapshots: no migrations, directory
creation, cache refresh or take-file recovery.

`durable.py` owns unique temporary files, flush/fsync, atomic replacement with
SMB retry, and failure cleanup for JSON receipts, take sidecars, farm JSON and
manifests. `ownership.atomic_replace` reexports the same replacement primitive.
Deadline submissions copy the stdlib-only helper beside their worker protocol.
Local `receipt.json` writes use schema 2 and `primaryArtifactId`; collection still
verifies schema 1 from older executions. Farm protocol 2 already uses that
representation and retains its exact-prompt verification.

## Studio (`ui/`)

`editor.html` loads `bootstrap.js`, which owns the loading barrier and imports
`editor.js`, the runtime. See [editor.md](editor.md). Focused modules hold the
contracts that have tests of their own:

- `timeline.js`: pure timeline operations ([timeline.md](timeline.md)).
- `project-edit.js`: draft, revision, save, poll and capture ownership
  ([project-edit.md](project-edit.md)).
- `ledger.js`: authored projection and take arrivals, mirroring `spool/ledger.py`;
  the document field registry is pinned by `tests/fixtures/document_fields.json`.
- `api.js`: the one HTTP client for `/spool/api` (error mapping, processing
  labels, background rules, recipe attachment on save).
- `picture.js`: what the viewer shows at a frame or in Source, apart from playback.
- `pointer.js`: cancels every pointer gesture when the window loses focus or the
  tab is hidden.
- `edit-session.js`: applies an authored edit (undo step, change, repaint scope,
  save); pointer gestures record their own step on release.
- `input-groups.js`: optional and grouped media inputs, mirroring
  `spool/workflow_inputs.py`.
- `history.js` (undo and redo), `generation.js` (attempt status table and seeds),
  `workflow-setup.js` (capture decisions), `profile.js` (input profiles),
  `take-review.js`, `take-seen.js`, `preview.js`, `thumbnails.js`, `notes.js`,
  `diagnostics.js`, `topbar.js`, `workflow-library.js`, `template-browser.js`,
  `shortcuts.js`, `bridge.js`, `wire.js`.
- `studio.css`: the one stylesheet, with semantic colour tokens on `.editor`.
- `builtin-captures.json`: generated by `tests/build_builtin_captures.py`.

## Comfy page extension (`web/`)

`spool.js` adds **Open Spool ↗** to ComfyUI's top action bar and serves the
bridge. `workflow-link.js` owns linked graph tabs and **Apply to clip**;
`graph-capture.js` and `graph-inputs.js` resolve widget addresses the way Comfy
serializes them; `template-prepare.js` and `template-browser.js` prepare and show
Comfy templates without touching the user's graph.

## Contracts shared across languages

| Contract | Python | JavaScript | Pinned by |
| --- | --- | --- | --- |
| Exact integers | `spool/wire.py` | `ui/wire.js` | `tests/fixtures/wire_cases.json` |
| Attempt statuses | `spool/attempts.py` | `ui/generation.js` | `tests/fixtures/attempt_statuses.json` |
| Document fields | `spool/ledger.py` | `ui/ledger.js` | `tests/fixtures/document_fields.json` |
| Take ownership | `spool/ledger.py` | `ui/ledger.js` | `tests/fixtures/ledger_cases.json` |
| Optional and grouped inputs | `spool/workflow_inputs.py` | `ui/input-groups.js` | `tests/fixtures/optional_inputs.json` |
| API version | `spool/protocol.py` | `ui/protocol.js` | `tests/fixtures/protocol_versions.json` |
| Bridge messages | — | `ui/bridge.js` | `tests/bridge_checks.mjs` |

## Constraints

- Ordinary workflows need no Spool nodes or graph rewrites.
- Keep project state, UI, identity mapping and execution adapters in this
  extension; prefer narrow integration over changes to ComfyUI.
- Generation never selects a take. Only an explicit choice changes the edit.
- A request is frozen before dispatch, and nothing is resubmitted automatically
  when its outcome is uncertain.

## API compatibility

`spool/errors.py` defines expected failures; the route middleware maps unexpected
exceptions to a generic 500 and logs their traceback. `ValueError` messages remain
user-facing 400s. Explicit missing resources use `NotFound`; ordinary `KeyError`
and `TypeError` indicate bugs. `ROUTE_AUDIENCES` declares each route's audience.

The integer `apiVersion` is independent of package versions. Bump it for changes
to the API or authored document that an older studio cannot safely write. Pin the
Python and JS values in the protocol fixture. Versioned studio writes must match;
versionless tools retain the public automation contract. The Comfy bridge has a
separate `bridgeVersion` on ping; keep its literal names unchanged. See
[durable names](durable-names.md) before renaming persistent identifiers.
