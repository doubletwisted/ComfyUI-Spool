# Durable names

These names are used outside a running process. After release, changing one
requires a migration or a compatible alias. Package versions and protocol
versions are separate: the gate checks the package version in `pyproject.toml`
against `spool.__version__`; protocol fixtures pin API and bridge versions.

| Names | Code owning the contract |
| --- | --- |
| Package `spool-timeline`, publisher `doubletwisted` | `pyproject.toml` (`project.name`, `tool.comfy.PublisherId`) |
| Module `spool` | `spool/__init__.py`, `spool/__main__.py`; CLI `python -m spool` |
| Frontend extension `Spool.Timeline` | `web/spool.js` |
| `/spool/`, `/spool/api` prefixes | `spool/routes.py`, `ui/api.js` |
| Channel prefix `spool-comfy-`, actions `capture`, `workflowDrop`, `open`, `ping`, `applyLinkedWorkflow`, `workflowLinkApplied` | `ui/bridge.js` |
| Drag type `application/x-spool-workflow-tab` | `ui/bridge.js` |
| Query parameters `bridge`, `project`, `view`, `spoolHandoff`, `spoolTemplates`, `spoolTemplateSession`, `spoolTemplateOrigin`, `spoolTemplateView` | `ui/editor.js`, `ui/bridge.js`, `web/spool.js` |
| Template modes `embedded`, `prepare`; messages `spool-template-request`, `spool-template-state`, `spool-prepare-template`, `spool-template-preparation` | `ui/bridge.js` |
| Browser bridge identity `spool-comfy-bridge` | `ui/bridge.js` (session storage) |
| `project.spool`, `.spool/project.lock`, `app.sqlite3` | `spool/projects.py`, `spool/store.py` |
| Project `input/images`, `input/audio`, `input/video`, `output` (per-clip output folders), `.spool/previews`, `.spool/receipts` | `spool/projects.py` |
| `receipt.json` | `spool/receipts.py`, `spool/farm_protocol.py` |
| Media-stem `.json` sidecars | `spool/sidecars.py` |
| Settings `project_folders`, `projects_directory`, `comfy_startup`, `comfy_launch` | `spool/projects.py`, `spool/launcher.py` |
| Environment `SPOOL_STORAGE`, `SPOOL_CREDENTIALS`, `COMFY_API_KEY`, `COMFY_BASE_URL` | `spool/__main__.py`, root `__init__.py`, `spool/credentials.py`, `spool/cloud.py` |
| Pending envelopes `spool-native-<project ID>:queue-request`, `spool-native-<project ID>:experiment-request` | `ui/editor.js`, `ui/generation.js` (session storage) |

The parallel project-storage lane plans a `project.json` manifest inside project
folders; treat that name as durable when the format lands. Do not rename pending
envelope keys casually: losing an operation ID can cause duplicate submissions
after an uncertain reply. The same compatibility rule covers error codes,
command action/capability names and the exact-integer tag `__spool_int__`.
