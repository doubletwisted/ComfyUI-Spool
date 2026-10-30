# Changelog

All notable changes to Spool are recorded here. Versions follow
[semantic versioning](https://semver.org/).

## 0.1.0 (2026-10-30)

First public release.

### Studio

- A full-screen video studio opened from **Open Spool ↗** in ComfyUI's top bar.
  Ordinary workflows need no Spool nodes or graph changes.
- Timeline editing with video tracks, linked clip audio and a soundtrack lane:
  trim, ripple, roll, slip, slide, split, duplicate (Alt-drag), disable, snapping,
  box selection and undo/redo.
- Takes: every clip collects candidate results; review them in Source or
  side by side, choose the take used in the edit, and remove or permanently
  delete takes. Copy files into a clip's folder to add them as takes; a renamed
  file keeps its take, and a replaced file becomes a new take.
- Projects live in self-contained folders (a project file plus media), can be
  opened from shared storage, downloaded and imported. The project file stays
  small: render evidence is stored once, and workflows embedded in takes are read
  from the media. Opening a project from an earlier format upgrades it after a
  backup, a project from a newer Spool is refused, and an interrupted save or
  upgrade restores the last published project.
- Playback copies are prepared in the background at the project size, never
  upscaled, and kept on this computer rather than in the project folder.
- Inside ComfyUI, new takes, render progress and changes made by agents appear
  at once. Standalone Spool, and changes made on another computer, arrive by
  polling.
- Export the sequence, a range or selected clips to MP4 with an audio mix, or
  export a single frame.
- Export the timeline as OpenTimelineIO (`.otio`) for Resolve, Premiere Pro and
  other editors: video tracks, covered clips, trims, gaps and audio lanes, with
  clips referencing the original files in place.
- `run_spool.bat` starts the studio without ComfyUI and opens it in the browser;
  `python -m spool --open` does the same elsewhere.
- Clip notes, a keyboard shortcut sheet, a non-blocking Renders panel and a
  layout that adapts to laptop screens.
- Timeline lanes shrink together to fit the timeline's height instead of
  scrolling.
- A status bar for work in progress or the last edit, save state and the Comfy
  connection. **Activity** reads the project's events as sentences. The
  inspector shows short controls as compact rows and only the workflow actions
  that apply.
- The studio starts when opened over plain HTTP from another machine, such as a
  LAN or Tailscale address.
- Projects on a network share open and save without waiting for playback copies
  to be checked, and clip folders are scanned from one directory listing.

### Generation

- Add workflows from a curated library of built-in templates, the current Comfy
  graph or a saved workflow file. Spool captures an immutable recipe and exposes
  the workflow's key inputs (prompt, seed, duration, size, sources) on the clip.
- **Edit in Comfy** opens the clip's original workflow; **Apply to clip** brings
  changes back, including media added in Comfy.
- Generate on the local ComfyUI, on Comfy Cloud, or on a Thinkbox Deadline farm
  (experimental, through ComfyUI-Deadline-Plugin). Every result is collected with
  a durable receipt; interrupted work is recovered without repeating it.
- A request is frozen before it runs: a ComfyUI hook that changes a frozen
  workflow is refused, and work whose outcome is uncertain is never resubmitted
  automatically. On a project shared between computers, only the computer that
  started a local render decides whether it was lost. An interrupted Deadline
  cancellation can be sent again.
- Detailed render diagnostics are pruned after 30 days; results and their
  completion times are kept.
- Seed modes (fixed, increment, decrement, randomize) with exact 64-bit seeds.
  The generation review shows each shot's route and seeds, and warns when
  several takes would repeat the same seed.
- A failed take is announced, stays on its clip's take rail with the reason until
  dismissed, and is counted on **Renders**. Takes still rendering are compact
  rows, and large, compact or list takes fit more on the rail.
- **Renders** shows one line per take with **Cancel** beside it, and **Cancel
  all** per shot. Local takes can be cancelled from Spool, whether queued or
  running.
- **Execute on: Deadline** in the inspector renders a local workflow on the farm
  without adding a node to it, with the pool, group, priority and workers chosen
  per clip. Agents use the `set_execution` command.
- Spool ships its own built-in workflows with more of their media inputs
  connected: MiniMax H3 and H3 Max Reference to Video on Comfy Cloud (reference
  images, video and audio), FLUX 3 Image to Video (up to 10 keyframes), and the
  local MiniMax H3 Reference to Video, Multi-Frame Reference and ControlNet Union
  (more reference images, reference video and audio, optional guide frames).
- Image, video and audio inputs are compact rows with a thumbnail, the chosen
  file and their actions.
- Optional media inputs can stay empty and are left out of the request. Repeated
  inputs show one empty slot at a time, **Remove** moves later ones up, and
  Generate names a missing required input or an unmet "image or video" rule.

### Automation

- A scoped command API and CLI (`python -m spool`) for agents and scripts, with
  explicit project, clip, capability and budget limits, plus the
  `skills/spool-control` agent skill. Commands cover notes, inputs, generation,
  Use take, and clip trims and renames.
- Errors carry stable codes, the command envelope is published as a JSON
  Schema, and `--wire-json` keeps exact 64-bit integers in CLI output.
- A studio tab left open across a Spool update cannot save over newer data: it
  keeps its draft and asks for a reload. An outdated ComfyUI page is detected
  the same way.

### macOS and Linux (experimental)

- Verified an Apple Silicon source install on macOS 27.0.1 with ComfyUI 0.43.0:
  real CPU collection, cut detection, MP4/OTIO export, standalone launchers and
  Finder actions. Desktop and downloaded-launcher acceptance remain experimental.
- `run_spool.command` (macOS) and `run_spool.sh` start the studio without
  ComfyUI, using a `venv` or `.venv` beside ComfyUI when there is one.
- **Reveal in Finder** and **Open clip folder** work on macOS, and through
  `xdg-open` on Linux.
- ffmpeg, ffprobe and `deadlinecommand` are also found in Homebrew, MacPorts and
  Deadline's default folders, so ComfyUI Desktop started from the Dock finds them.
- **Comfy settings** accepts `.sh` and `.command` scripts or executables as the
  ComfyUI launcher.
- On a Mac, the studio shows Cmd and Option in tooltips, hints and the shortcut
  sheet.

### Documentation

- A user guide, agent and Deadline docs, and contributor notes.

### Requirements and security

- Python 3.11+, ffmpeg and ffprobe on PATH; tested with ComfyUI 0.43.1 and
  frontend 1.57.4. Missing requirements are reported in the studio and the
  health route. Comfy Cloud needs the `comfy-sdk` package and a Comfy plan that
  allows API keys; free accounts can run Cloud workflows as Partner Nodes on their
  own ComfyUI.
- `SPOOL_CREDENTIALS` moves the saved Comfy Cloud key to another folder.
- Changes are accepted only from Spool's own pages or local tools; actions that
  reach beyond project files answer only the computer running Spool. See
  [Security and network access](docs/guide/security.md).
