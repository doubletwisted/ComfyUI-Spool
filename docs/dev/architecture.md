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
- **Execution targets:** three adapters behind `attempts.target_of`.
  `execution.py` runs the host checks every local or Deadline attempt passes, then
  submits to this Comfy's queue (local) or to Deadline. `farm.py` observes and
  collects Deadline jobs and holds every `deadlinecommand` call (ownership lookup,
  fail, recovery search); `deadline_job.py`, `deadline_task.py` and
  `farm_protocol.py` are the submission, worker script and receipt protocol.
  `cloud.py` dispatches, observes, cancels and collects Comfy Cloud jobs through
  `comfy-sdk` in its own loop, because it needs no local Comfy.
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
| Bridge messages | — | `ui/bridge.js` | `tests/bridge_checks.mjs` |

## Constraints

- Ordinary workflows need no Spool nodes or graph rewrites.
- Keep project state, UI, identity mapping and execution adapters in this
  extension; prefer narrow integration over changes to ComfyUI.
- Generation never selects a take. Only an explicit choice changes the edit.
- A request is frozen before dispatch, and nothing is resubmitted automatically
  when its outcome is uncertain.
