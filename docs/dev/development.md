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
Chrome or Edge.

## The gate

Run before every commit:

```powershell
python tests/run_architecture_checks.py
```

It runs the Python tests, the JavaScript module checks and the contract checks
that pin shared Python/JavaScript formats (see the table in the architecture
doc). It needs no ComfyUI host. The Deadline contract tests also run the real
[ComfyUI-Deadline-Plugin](https://github.com/doubletwisted/ComfyUI-Deadline-Plugin)
when it is checked out beside the Spool folder, and are skipped otherwise.

[`checks.yml`](../../.github/workflows/checks.yml) runs the gate on Windows,
macOS and Linux for every pull request, and by hand from the Actions tab. It is
the only regular check on macOS and Linux; browser and live checks still run
locally.

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

`controlnet-comfy` needs a host started with `--partner-nodes`, and
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

`ui/builtin-captures.json` is generated. To refresh it, run the
`workflow-capture-bundle` browser check, then pass the QA project ID from its
`summary.json` to `python tests/build_builtin_captures.py QA_PROJECT_ID`. The
builder removes example sources and validates every capture before replacing the
file.

## Releasing

1. Bump the version in `pyproject.toml` and `spool/__init__.py`.
2. Move the CHANGELOG's unreleased section under the new version.
3. Merge to `main`. [`publish.yml`](../../.github/workflows/publish.yml) publishes
   to the Comfy Registry whenever `pyproject.toml` changes on `main`, using the
   `REGISTRY_ACCESS_TOKEN` repository secret. Run it by hand from the Actions tab
   with **Run workflow**, or publish locally with `comfy node publish` from a
   clean checkout.

`.comfyignore` keeps tests and development material out of the package.
