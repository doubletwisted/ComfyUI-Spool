# Changelog

All notable changes to Spool are recorded here. Versions follow
[semantic versioning](https://semver.org/).

## Unreleased

### Fixes

- Transition buttons escape project track values, preventing a crafted track
  from executing script when the timeline opens.
- Failed imports remove only their own new working cache, preserving existing or
  redirected caches and the original import error when cleanup is denied.
- Storage reports include project backups from their managed cache directory.
- Slow launcher settings, startup-file scans and process creation run in workers,
  keeping the host responsive. Delayed state updates preserve newer startup
  reservations, and cancellation waits for an in-flight launch to finish.
- Local, Deadline and Cloud collection own their temporary files, so concurrent
  collectors cannot overwrite or remove each other's unfinished copies.
- Finding an existing Deadline job reports an unavailable service with a retry
  action when its recovery lookup fails.
- Missing required revision/request fields return validation errors before the
  operation starts, including the save and take actions simulated by the demo.
- Manual reconciliation and background collection serialize work for each
  project, preventing duplicate artifact copies. Shutdown waits for collection
  workers to finish before releasing ownership.
- Deadline submission grace no longer includes time waiting in the queue or
  preparing inputs, so old queued takes can still be submitted.
- Maintenance dry runs scan a private snapshot, so a long report does not block
  another editor's save on Windows.
- Invalid or nonfinite probed frame rates produce a clear validation error.
- Cloud observation batches settle before reporting failures; cancellation
  preserves other errors and always releases executor ownership on shutdown.

- The local demo server rejects inverted or out-of-bounds byte ranges with a
  complete 416 response instead of a negative content length.

- Cloud key status follows the effective saved or environment credential,
  including empty or whitespace-only values.
- Registry publishing pins its external action to a reviewed commit.

- Failed input staging and export muxing remove their own partial files while
  preserving published inputs, successful exports and the original error.

- Linked Comfy image-loader choices refresh when a workflow opens or reloads,
  keeping valid staged images selectable without changing the saved input.
- Newly described image/video dimensions follow EXIF and display-matrix
  orientation. Existing media records and originals are unchanged.
- Path-imported video copies keep project-relative original references, so
  moving a project also preserves its shot and audio source references.
- Joined extension audio follows the measured frame shift and sequence frame
  rate, keeping its duration aligned with the joined video.
- Snapshot publications carry an identity inside the SQLite snapshot, so
  same-size saves with coarse timestamps do not hide newer revisions.
- Demo take deletion follows host media-pool and generation-input protection
  rules and removes aliases of a deleted original.

- New clip output folders stay distinct when names differ only by case, and
  Windows device names and truncated trailing spaces/dots are made portable.
  Existing assigned output folders are preserved.
- Queue preparation validates every item and source before freezing inputs,
  so an invalid later item does not leave copies from earlier items.

- Authored JSON that impersonates a project evidence blob is rejected before
  saving, so an imported value cannot leave the project unreadable.

- Comparing takes and detecting cuts in a take whose original lies outside the
  project and Comfy folders now answer only this computer, as downloading that
  original already did. Another machine could otherwise read frames of any image
  or video on the Spool computer.
- `python -m spool` agent commands reach a Spool on this computer directly when
  `http_proxy` is set for other traffic, instead of failing through the proxy.
- **Find existing Deadline job** works again. It failed on every call, so a
  Deadline render whose submission was uncertain could not be resolved.
- A Deadline receipt whose artifact or execution ID is not the ID Spool's worker
  writes is rejected. A forged ID could make collection copy a file outside the
  project.
- A Deadline receipt that is valid JSON of the wrong shape is recorded as invalid
  instead of stopping collection of every later receipt and project.
- Reopening a project after Spool stopped in the middle of a save restores the
  last published snapshot. The interrupted save could be rolled into the fresh
  copy and, on the next save, undo work published from another computer.
- Applying a workflow or using a take no longer stores another copy of the
  project's workflows each time. Repeated without a save in between, it grew the
  project until it could not be opened.
- `python -m spool prune --confirm` no longer removes previews the edit uses when
  their file names contain spaces or accented letters.
- Opening a project no longer runs script hidden in its clip, take or media IDs,
  take numbers or track numbers. The studio now escapes them like names, so an
  imported project or shared project folder cannot act as the studio.
- `run_spool.bat` finds Spool with the Windows portable build's Python, whose
  `._pth` file leaves the Spool folder off Python's module path.
- Importing footage again after an interrupted import works. A review copy, poster
  or waveform cut short by a timeout or a stopped Spool was kept and reused, so
  that file could never be imported again.
- MP4 export works for a Windows account whose name contains an apostrophe.
- **Delete from disk** saves your edits first. An edit not yet saved was replaced
  by the reply, and one still saving made the delete report a conflict.
- A Deadline task that the farm retried no longer adds its second render to the
  clip as an extra take; the accepted result stays the only take.
- A project folder Spool cannot open, such as one a newer Spool upgraded, is
  listed as unavailable instead of stopping the project list and every other
  project's renders. A folder whose upgrade fails is retried less and less often,
  not every few seconds with a new backup each time.
- `python -m spool prune --confirm` and `reclaim --confirm` keep their working copy
  in a private temporary folder and remove it afterwards. Another user of the
  computer could plant a database at the shared path they used, which a run then
  published into the project.
- Projects created, opened or imported at the same moment all stay in the project
  list. One could drop another from the list, leaving its folder unreachable.
- Files whose names contain a percent sign followed by two hex digits, such as
  `a%41.mp4`, play, export and collect. Their names were decoded a second time
  and pointed at a different file.
- The studio shows footage whose file name contains `#`, `?` or `%`, such as an
  imported `Take #3.mp4`. Its address was cut at that character.
- A Comfy Cloud workflow whose result is an image is refused before it renders.
  Cloud results are collected as video, so the paid render could never arrive.
- Importing a file that is not readable media says so and keeps nothing, instead
  of a generic server error with the file left in the project.
- A project folder at the root of a drive or network share (`E:\`,
  `\\nas\projects\`) can use its media. Every path in it was refused as outside
  the project.
- `python -m spool command` reports a missing or invalid `--file` as a JSON error
  (`invalid_request`) instead of a Python traceback.
- A waveform is drawn again when its audio file is replaced at the same path,
  instead of showing the old sound.
- Standalone Spool starts, and its Comfy connection status loads, from a checkout
  close to the drive root such as `C:\Spool` or `/opt/spool`.
- On macOS and Linux the saved Comfy Cloud key file is private from the moment it
  is written; it was briefly readable by other users of the computer.

## 0.1.1 (2026-11-03)

### Directing tools

- **Add transition** at a cut (the button on the cut, the clip menu or **T**)
  renders the move between two shots as one continuous take, 4 seconds by default.
  Its prompt is a timeline around what you write for the middle, with an
  instruction to keep one take; optional suggestions add wording.
- **Extend shot…** in the clip menu (or **E**) adds the next moment of a shot as its own
  clip, attached to the shot: they draw joined on the timeline, move together, and
  the extension renders at the shot's size (up to 0.9 MP). The inspector has no
  Extend button.
- An extension joins its shot without a jump: Spool makes a joined copy of each
  take as it arrives, dissolving out of the shot's last 2 frames, measuring where
  the new frames start and easing out H3's brightness dip. The viewer and both
  exports play it; the take's file is kept as rendered.
- A new local workflow, **MiniMax H3 · Continue Between Clips**, anchors the last
  second of the clip before and the first second of the clip after, with their
  sound, so movement carries through transitions and extensions instead of
  restarting from a still frame. It is the default for both, and its
  encoder sees the first and last frame of the take. The directing tools offer only
  MiniMax H3 workflows.
- A workflow's video input can read only the start or end of its clip (`span`),
  and **Use take** starts a directed clip's take after its anchored frames.
- **MiniMax H3 · Recast**, a built-in workflow, puts other people into a shot and
  keeps its set, camera, movement and sound (after H3 Recast and the BFS character
  swap LoRA). Drop it on a clip, add a picture of the new person and say who
  becomes who.
- **MiniMax H3 · Regenerate**, a built-in workflow, refines any clip at a higher
  resolution with the Open-H3-Regenerate refiner.
- A workflow dropped on a clip that takes the clip as video no longer also puts a
  frame of it in a reference input.
- A **Cast** tab keeps characters with pictures; `@Name` in a prompt fills the
  workflow's reference inputs and becomes the tag the model reads.
- Prompt checks under the prompt, and `@` suggestions from the cast. Editing
  instructions such as "no cuts" are not flagged as negative phrasing.
- **Draft** renders quick takes for workflows that can finish their own drafts, such
  as the new **MiniMax H3 · Draft and Final**. **Make final** refines the chosen
  draft to full size with the Open-H3-Regenerate refiner, so the final keeps the
  draft's motion and framing. Other workflows offer no Draft.
- Image and video inputs can read the clip before or after a shot when it is
  queued (`previous` and `next` shot inputs), also through `set_shot_inputs`.
- The local MiniMax H3 Reference to Video workflow shows its **Turbo (4 steps)**
  switch.
- Agents can set the cast (`set_cast`) and queue draft variants.
- API version 2: the project document has a `cast`, which older studios would not
  keep.

### Online demo

- An [online demo](https://doubletwisted.github.io/ComfyUI-Spool/demo/) of the
  studio opens a finished project in the browser. Edits reset on reload, and
  generating takes needs Spool with ComfyUI.

### Studio

- The same kind of control looks the same in every panel: tab bars, track names
  and toggles, single-choice filters (media type now matches workflow location),
  Grid and List icons, search fields, section titles and panel buttons. Audio
  clip names use the video clips' type and read over the volume line.
- The audio inspector's level slider shows its track again, its fields follow the
  Inputs tab's label-left rows, and it names the audio by its track (A1 or A2).
- Generate reads "1 take" and "1 clip", not "1 takes" and "1 clips".
- The take rail stays beside the viewer when the selected clip has no takes, so the
  viewer no longer changes size as you select clips. Imported footage is labelled
  **Footage** in the inspector, with a line on how to generate from it.
- Using a take that is plain footage no longer shows a warning about missing
  executable metadata; the inspector calls it **Footage** and says how to generate.
- A clip with a take on the way says **Generating** in the viewer, from the moment
  Generate is pressed, instead of "Not generated yet", and an extension without a take shows the end of the shot it
  continues.

### Timeline

- Track headers show just V1, A1, A2 and so on, without "Clip audio" and
  "Soundtrack" under them, and keep the eye, mute and solo right of the name. A1
  keeps mute and solo when a higher video track's audio lane is hidden.
- An empty A2 lane is plain, without the dashed "Add audio" box that looked like
  a clip on the track. The waveform button adds audio, and files still drop onto
  A2.
- The mouse wheel zooms the timeline around the pointer, without Ctrl, and zooms
  out past the end of the edit. Shift+wheel pans; Alt+wheel scrolls the tracks.
- Adding, removing or trimming clips no longer changes the timeline's zoom; clips
  stay the same size on screen. During a clip drag the wheel scrolls the tracks.

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
