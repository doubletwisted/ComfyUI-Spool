# Apple Silicon validation

Real-machine evidence for [#14](https://github.com/doubletwisted/ComfyUI-Spool/issues/14),
recorded on 2026-10-28. macOS remains experimental; the remaining Desktop and
downloaded-launcher acceptance is tracked in
[#17](https://github.com/doubletwisted/ComfyUI-Spool/issues/17).

## Environment

| Component | Version |
| --- | --- |
| Hardware | Apple M3 Max, arm64, 48 GB RAM |
| macOS | 27.0.1, build 26A434 |
| Python | 3.13.16, private ComfyUI `.venv` |
| Node | 24.22.1 |
| ffmpeg / ffprobe | 9.0, OSXExperts Apple Silicon static builds |
| Chrome | 156.0.8078.48 |
| ComfyUI | 0.43.0, commit `426f5eea52a7ece1dd599fff4cb6cd1f352ddd24` |
| ComfyUI frontend | 1.57.4 |
| Workflow templates | 0.11.97 |
| PyTorch | 2.14.1, CPU execution |

ComfyUI was cloned into a disposable folder with its own virtual environment.
Node and ffmpeg were also local to that folder; Homebrew and system packages
were not installed. Existing Chrome and Python were reused. Browser and live
checks used `tests/run_host.py`, isolated projects, media and credentials.
The browser host loaded Partner Node schemas and the Deadline plugin solely
for workflow/bridge checks. No Cloud or farm jobs were submitted.

## Automated evidence

- `python tests/run_architecture_checks.py`: 314 Python tests (one Windows-only
  streaming check skipped), plus all 24 JavaScript suites, passed.
- Every default `run_browser_checks.cjs` scenario passed on native macOS:
  74 scenarios, 1,416 assertions. After fixing the failures below, the remaining
  scenarios were resumed in separate runs; this was not one uninterrupted run.
  `take-file-actions`, `clip-folder` and `inspector-notes` also passed together
  as explicit named checks, without `-mac` emulation.
- `verify_live.py`: all 19 checks passed using genuine CPU image/video renders
  and ffmpeg. This covered collection, unchanged take choice, frozen inputs,
  backup/import, restart recovery, byte-range seeking, cached cut detection,
  source-rate interpretation, MP4/audio export and OTIO references.
- `verify_agent_live.py`: all five checks passed, including scoped CLI variants
  queued while ComfyUI was stopped and collected after restarting it. Its first
  run collided with the Finder-launched standalone server on its fixed port
  8190; the successful run used a free port after stopping that server.

The architecture gate contains mocked execution-adapter tests. Browser checks
use intercepted frontend assets and some fixture responses (including Cloud,
offline and file-action checks). Those results do not establish live Cloud or
farm support. The CPU live checks and native actions below are separate live
evidence. Paid `cloud-smoke` and the two opt-in profiling/capture checks were
excluded from the default browser run.

## Native actions

- Finder double-click of the git-cloned `run_spool.command` started standalone
  Spool, used ComfyUI's `.venv`, and opened the default browser without a
  Gatekeeper prompt.
- `sh run_spool.sh --port 8191` launched from another working directory used
  the same virtual environment and served a healthy studio.
- Both a non-executable `.sh` and an executable launcher with a space in its
  path started real ComfyUI through standalone startup settings. The host paired
  successfully and survived termination of its standalone parent process.
  A real settings request rejected a non-script, non-executable file with the
  ComfyUI Desktop guidance.
- **Reveal in Finder** selected the original take file. **Open clip folder**
  opened the actual clip folder. A copied video appeared automatically as a
  **New** take without replacing the chosen take.
- Tooltips, timeline hints, the editing help and the shortcut sheet displayed
  Cmd and Option. In a normal Chrome window with a disposable profile,
  Cmd+D duplicated, Cmd+Z undid, Cmd+Shift+Z redid, Cmd+A selected all clips,
  Cmd+S saved, and Cmd+Enter added a note. Chrome did not intercept these keys.
- Safari opened the project and played the H.264 take, with advancing frames
  and decoded picture visible. This smoke check does not establish Safari
  support.
- The real import-footage route with cut detection split the red/blue source
  into two 15-frame shots.
- A GitHub ZIP fetched through the authenticated API was downloaded in Safari
  through an isolated loopback server and expanded by Archive Utility. The
  launcher retained mode `0755` and Safari's quarantine attribute. Double-click
  did not start Spool; Gatekeeper/XProtect logged an executable assessment.
  Automation could not inspect Terminal's dialog or verify a recovery path.
  No quarantine attribute or security setting was bypassed.

## Test corrections

Two browser assertions expected Windows shortcut labels (`Ctrl+Z`, `Ctrl+S`).
The UI already displayed the correct Mac labels. Take-removal keyboard checks
now exercise native Cmd on macOS, including trusted CDP Undo/Redo and Undo
after reload.

The embedded-template check also assumed an LTX card was rendered on the first
screen of ComfyUI's virtualized catalog and that `generation-controls.png`
already existed on the host. It now searches for LTX on each chooser opening
and uploads its own source fixture before opening ComfyUI. These were test
assumptions exposed by a fresh install, rather than demonstrated Mac defects.

## Scope

Studio buttons, menus, keyboard shortcuts and the inspector were exercised;
the Comfy page entry and real graph/Apply bridge were included in the browser
suite. Both the installed extension host and standalone Spool were checked.
Local execution has real CPU evidence; Cloud has mocks only, and Deadline has
contract/schema coverage without a real farm. No shared Python/JavaScript wire
format changed.

This run does not establish Intel Mac support, Apple GPU/model performance,
Linux support, or production-scale video performance. Desktop's Dock PATH and
standalone pairing require a compatible Desktop build: the latest inspected
Desktop release, v0.9.4, bundled ComfyUI 0.22.3, below Spool's minimum 0.39.0.
