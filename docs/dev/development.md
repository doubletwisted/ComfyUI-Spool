# Development

How to set up a checkout, run the test gate and check changes against a real
ComfyUI. [CONTRIBUTING.md](../../CONTRIBUTING.md) covers what makes a change
acceptable; [the glossary](glossary.md) and [architecture.md](architecture.md)
explain the vocabulary and how the modules fit together.

## Layout

| Path | Contents |
| --- | --- |
| `spool/` | Python backend: routes, project store, commands, execution targets |
| `ui/` | The studio served at `/spool/` |
| `web/` | ComfyUI page extension: the top-bar entry, the bridge and linked graph tabs |
| `skills/spool-control/` | Agent skill for operating Spool |
| `tests/` | Unit, contract and browser checks, and the test hosts |
| `docs/` | User guide, agent and Deadline docs, developer notes, backlog |

## Setup

Clone into a ComfyUI's `custom_nodes` folder and install the dependency with that
ComfyUI's Python:

```powershell
git clone https://github.com/doubletwisted/ComfyUI-Spool ComfyUI/custom_nodes/Spool
python -m pip install -r ComfyUI/custom_nodes/Spool/requirements.txt
```

The checks need Python 3.11+ (3.12 is used in development) with aiohttp and
Pillow, Node 24, and `ffmpeg` and `ffprobe` on PATH. Browser checks also need
Chrome or Edge. Install the formatter and linters once per checkout or worktree:

```powershell
python -m pip install -r requirements-dev.txt
npm ci
```

These are development tools only: installing or running Spool needs no Node
packages. To tell `git blame` to skip the commit that formatted the codebase:

```powershell
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## The gate

Run before every commit:

```powershell
python tests/run_architecture_checks.py
```

It checks formatting (ruff for Python, Prettier for JavaScript, HTML and CSS)
and lint (ruff and ESLint), TypeScript checking of the studio owners without
emitting a build, then runs every `tests/test_*.py` and
`tests/*_checks.mjs` and the contract checks that pin shared Python/JavaScript
formats (see the table in the architecture doc). It needs no ComfyUI host.
`npm run format` and `python -m ruff format .` fix formatting; the gate only
reports it. The Deadline contract tests also run the real
[ComfyUI-Deadline-Plugin](https://github.com/doubletwisted/ComfyUI-Deadline-Plugin)
when it is checked out beside the Spool folder, and are skipped otherwise.

[`checks.yml`](../../.github/workflows/checks.yml) runs the gate on Linux for
pull requests that change more than docs. Run it by hand from the Actions tab to
also cover Windows and macOS; macOS minutes cost ten times as much in a private
repository. Browser and live checks still run locally.

## Agent skill evals

[`evals/`](../../evals/README.md) measures how a model following the shipped
`spool-control` skill handles scoped commands, notes, budgets and safe retries on
synthetic projects. The gate runs its simulator, grader and scripted-model loop
tests offline, with no host, API key or charge. Real Anthropic/OpenAI runs are
manual and paid: run them only when the owner asks, following the eval README.
Keep simulated scores separate from live evidence.

## A test host

Browser and live checks use an isolated CPU ComfyUI host. It keeps projects,
inputs and outputs in its own runtime folder and loads only Spool as a custom
extension:

```powershell
python -s tests/run_host.py --comfy PATH/TO/ComfyUI --runtime .native-test/dev --port 8195
```

Use the Python that runs that ComfyUI. The host also keeps its Comfy Cloud key in
the runtime folder (`SPOOL_CREDENTIALS`), because some checks save and remove a
fixture key. Add `--partner-nodes` for checks that need
the Partner Node schemas, or `--deadline` to also load ComfyUI-Deadline-Plugin from
the folder beside the checkout. Open
`http://127.0.0.1:8195/spool/` for the studio. `.native-test/` is ignored by Git.
Never point checks at a ComfyUI you use for real work.

A browser reload picks up frontend changes. Restart the test host after Python
changes. On Windows the test entry points set `AIOHTTP_NOSENDFILE=1`.

## Browser checks

```powershell
node tests/run_browser_checks.cjs "C:/Program Files/Google/Chrome/Application/chrome.exe" .native-test/browser
node tests/run_browser_checks.cjs CHROME .native-test/browser studio render-queue inspector-notes
```

The runner drives Chrome over CDP with its own profile, serves this checkout's
`ui/*` and `web/*` files over Fetch interception, creates throwaway projects on
the host, and writes screenshots and `summary.json` to the evidence folder. It
fails on any page exception. Without names it runs every check except the opt-in
profiles (`workflow-project-profile`, `workflow-capture-bundle`); check names are
the keys of `CHECKS` in `tests/run_browser_checks.cjs`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SPOOL_BROWSER_BASE` | `http://127.0.0.1:8195` | Test host address |
| `SPOOL_BROWSER_PORT` | `9228` | Chrome debugging port |
| `SPOOL_API_BASE` | the host | Separate editing API (below) |
| `SPOOL_STANDALONE_BASE` | none | Standalone Spool for the settings checks |

`cloud-smoke` is a paid, opt-in check: it renders one 2-second LTX-2.5 take on
Comfy Cloud and refuses to run unless `SPOOL_CLOUD_SMOKE=1`. Start its host with
the key in `COMFY_API_KEY` (the host keeps no saved key), and set
`SPOOL_CLOUD_SMOKE_TARGET=local` to run it as Partner Nodes on the host.

`controlnet-comfy` and `builtin-comfy-link` need a host started with
`--partner-nodes`, and
`comfy-link-placeholder` one started with `--deadline`. The `-mac` checks
(`take-file-actions-mac`, `clip-folder-mac`) report a Mac platform and a host
that names Finder, so the macOS labels are checked from Windows too; they are
not a substitute for a real Mac.

To test Python editing changes without restarting the host, start the editing API
in another terminal and point the browser checks at it. Its schemas come from the
host; projects and credentials stay in its runtime folder, and execution is
disabled:

```powershell
python tests/run_api_host.py --runtime .native-test/edit-api --port 8194
$env:SPOOL_API_BASE = 'http://127.0.0.1:8194'
node tests/run_browser_checks.cjs CHROME .native-test/edit-api workflow-first studio
Remove-Item Env:SPOOL_API_BASE
```

Other runners: `run_editor_layout.cjs` (layout and selection timing; set
`SPOOL_LAYOUT_ONLY=1` for layout only), `run_performance.cjs` (large-history and
paste checks; takes a Playwright module path), `run_generation.cjs`,
`run_editor_settings.cjs` and `profile_media.py` (media preparation timings).

## Live checks

Execution, media and export changes need real collection, not only mocks:

```powershell
python tests/verify_live.py --python PATH/TO/python.exe --comfy PATH/TO/ComfyUI --runtime .native-test/live --port 8198
```

It starts and stops its own host on a free port, renders tiny CPU images and
videos, and checks collection, project backup and import, restarts, cut detection
and export. Two more live checks take the same `--python`, `--comfy`, `--runtime`
and `--port` options: `verify_agent_live.py` drives a scoped CLI experiment while
Comfy is stopped, then renders it, and `verify_executor_conflict.py` starts a
second Comfy on a busy store and checks it stays passive. Report
mocked results separately from live evidence.

Deadline acceptance submits real farm jobs, so run it only on a farm you may use:

```powershell
python tests/verify_deadline.py --python PATH/TO/python.exe --comfy PATH/TO/ComfyUI --runtime .native-test/deadline --result-root SHARED/FOLDER --worker WORKER --video --offline --count 1
python tests/verify_project_execution.py --base http://127.0.0.1:8195 --runtime .native-test/project-execution --project-folder SHARED/PROJECT --worker WORKER
```

`verify_project_execution.py` attaches to a running host started with `--deadline`
and queues four jobs (local and Deadline, image and video). `--resume` inspects a
timed-out run without submitting again.

## Built-in workflows

Spool's own workflows live in `spool/builtin_workflows/<id>/`, one folder per
workflow. They are read as written; nothing rewrites them at runtime.

| File | Contents |
| --- | --- |
| `workflow.json` | The graph, saved from ComfyUI |
| `prompt.json` | The same graph from ComfyUI's **Export (API)** |
| `spool.json` | Library name, family, task and target, the result node, and the inspector's inputs in order |

`spool.json` lists each input once, in inspector order:

- A control names its `node`, `input`, `label`, `role` and optional `unit`. Cloud
  workflows read input types from the shipped Cloud definitions; local workflows
  state `type`, and `options` for a list, because standalone Spool has no node
  definitions.
- A media input names its loader `node`, `label` and `slot`. With `optional` it may
  stay empty; `alsoRemove` names helper nodes that only feed it, and `bypass` maps
  a node that cannot run without it to the input passed on in its place, as
  Comfy's Bypass does (Multi-Frame Reference's guide frames).
- A `group` lists the loader `nodes` that fill one repeatable input in order. Every
  slot is optional; a slot may be `{"node": ..., "alsoRemove": [...]}`.
- `inputRules` lists groups of which at least one input must be filled, with the
  message shown beside Generate.

Loaders ship with an empty file name, and each loader's title is its inspector
label, because Apply to clip labels inputs by node title.

To change one, open `workflow.json` in ComfyUI on a test host, edit it, save it
over `workflow.json`, export the API prompt over `prompt.json`, and update
`spool.json` if node IDs or inputs changed. A folder with the same ID as a curated
Comfy template replaces that template. `tests/test_builtin_workflows.py` checks
that the three files agree, that control types match the node definitions (Cloud
definitions, or `tests/fixtures/local_node_definitions.json` for local nodes), and
that every input that can be left out feeds an input its node allows to be
missing. ComfyUI must also reopen the saved graph unchanged, because **Edit in
Comfy** loads it the same way: the `builtin-comfy-link` browser check opens every
Spool workflow through Edit in Comfy and applies it back.

### Slots ComfyUI can reopen

ComfyUI frontend 1.55.18 loses or swaps links when it reopens nodes with many
connected Autogrow inputs
([ComfyUI_frontend#10136](https://github.com/Comfy-Org/ComfyUI_frontend/issues/10136)),
so these workflows connect fewer slots than their nodes accept. The limit depends
on the node's other inputs, not a fixed count; measure a new shape by reopening
it in ComfyUI more than once.

| Workflow | Connected | Node accepts |
| --- | --- | --- |
| MiniMax H3 Reference to Video (Cloud) | 4 images, 1 video, 1 audio | 9, 3, 3 |
| MiniMax H3 Max Reference to Video (Cloud) | 2 images, 1 video | 9, 3, 3 |
| MiniMax H3 Reference to Video (local) | 9 images, 1 video with its soundtrack, 1 audio | 9, 3, 3 |
| MiniMax H3 ControlNet Union (local) | 9 reference images | 9 |
| FLUX 3 Image to Video | 10 keyframes | 10 |

The Max workflow feeds each reference to its generator, prompt enhancer and 2K
regenerator. Wiring the generator alone would allow 3 images, 1 video and 1
audio. Add slots when a frontend release reopens them intact.

`ui/builtin-captures.json` holds the curated Comfy templates and is generated. To
refresh it, run the `workflow-capture-bundle` browser check, then pass the QA
project ID from its `summary.json` to
`python tests/build_builtin_captures.py QA_PROJECT_ID`. The builder removes example
sources, skips Spool's own workflows and validates every capture before replacing
the file.

### Why empty inputs are left out

An empty optional input is removed from the request, with the nodes that only
fed it, instead of filled with a placeholder. A blank image would still reach the
model as a reference. An empty Load Image passes ComfyUI's validation but fails
when it runs, because the empty name points at the input folder. Spool also
freezes every file a request uses and uploads it for Cloud; there is no file to
freeze. Removing the input is the one behaviour that means "not provided" on
local ComfyUI, Comfy Cloud and Deadline alike.

## Releasing

1. Bump the version in `pyproject.toml` and `spool/__init__.py`.
2. Move the CHANGELOG's unreleased section under the new version.
3. Merge to `main`. [`publish.yml`](../../.github/workflows/publish.yml) publishes
   to the Comfy Registry whenever `pyproject.toml` changes on `main`, using the
   `REGISTRY_ACCESS_TOKEN` repository secret. Run it by hand from the Actions tab
   with **Run workflow**, or publish locally with `comfy node publish` from a
   clean checkout.

`.comfyignore` keeps tests and development material out of the package.

The opt-in `stale-tab` browser check requires an isolated host with a different
server `API_VERSION` than the studio. To reproduce an update accurately, keep a
studio tab open, change only `spool/protocol.py` on the isolated host and restart
that host, then run `tests/stale_tab_browser_checks.js` in that tab. It checks
save refusal, draft retention, unchanged server state and a single reload notice.
Restore the version before running the gate or committing.
