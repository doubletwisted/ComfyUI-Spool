# Projects and storage

## Project folders

A project is a folder:

```text
My project/
  project.spool        the edit, workflow versions, takes and render records
  project.json         project identity and format version
  input/images/        images, audio and video you added
  input/audio/
  input/video/
  output/<clip name>/  each clip's takes and their workflow files
  .spool/              previews, frozen inputs and render receipts
```

**New project** creates one; **Project → Open project folder…** opens an existing
folder, including one on a network share. **Projects** lists the folders you have
opened. A clip keeps its folder when renamed.

`project.spool` is a SQLite snapshot. While you work, Spool edits a local copy in
`ComfyUI/user/spool/cache` and publishes the snapshot to the folder under a lock,
so the live database never runs on a network drive. The local cache can always be
rebuilt from the project folder.

**Download project file** in the top bar saves a project file; **Open project
file** imports one. The file contains the edit, workflow versions and media
records, with local paths but not the media itself. A rejected import leaves no
partial project.

When opening an older project, Spool keeps its previous project file in
`.spool/backups/project-schema<old>-<UTC timestamp>.spool` before upgrading it.
Keep that copy until you have checked the upgraded project. A newer project
format requires a newer Spool; it cannot be opened by an older installation.
Render evidence is shared inside the SQLite file to keep repeated saves smaller.

## Saving

Edits save automatically, and Spool checks every minute for anything still
pending. **Ctrl+S** saves at once, including a field you are typing in. Dialogs
have their own Save and Apply buttons.

If another tab or an agent saved the project first, Spool keeps your changes and
asks you to reload. A failed save keeps your draft until it succeeds; you can
download it in the meantime.

## Adding takes from outside

**Open clip folder** in the Takes header opens the selected clip's output folder
in Explorer, Finder or your Linux file manager, even before its first render.
Copy finished videos or images there and they appear as **New** takes once the
files stop changing (about five seconds). Their embedded metadata, or a `.json` workflow with the same name,
supplies the workflow. Adding a take this way never changes the edit.

Right-click a take and choose **Reveal in Explorer** (**Reveal in Finder** on
macOS, **Show in folder** on Linux) to find its file. Deleting or renaming files
there is not an edit and cannot be undone in Spool.

## Running without ComfyUI

On Windows, double-click `run_spool.bat` in the Spool folder. On macOS,
double-click `run_spool.command`; on Linux, run `sh run_spool.sh`. They use the
Python of the ComfyUI portable build (Windows), or a `venv` or `.venv` beside
ComfyUI as ComfyUI Desktop makes, and open the studio at
`http://127.0.0.1:8190/spool/`. If macOS will not open a downloaded
`run_spool.command`, Control-click it and choose **Open**, or run
`sh run_spool.sh` in Terminal. You can also run this from the Spool folder:

```powershell
python -m spool --open
```

Either way you need Python 3.11+ with aiohttp and Pillow, and ffmpeg on PATH. Inside `ComfyUI/custom_nodes`, it uses the same settings
folder as the ComfyUI extension (`ComfyUI/user/spool`). Options: `--open`, `--port`,
`--storage` (or `SPOOL_STORAGE`) for the settings folder, and `--host`. See
[Security and network access](security.md) before changing the host.

Editing, import, export and queueing work while ComfyUI is stopped. Queued renders
wait until a ComfyUI with Spool starts.

**Project → Comfy settings…** stores your ComfyUI launcher and its address. On
Windows the launcher is a `.bat`, `.cmd` or `.exe`; on macOS and Linux it is a
`.sh` or `.command` script or an executable file. ComfyUI Desktop cannot be
started this way: start it yourself and enter its address (by default
`http://127.0.0.1:8000`). **Save and connect** starts ComfyUI when it is not
running and reuses it when it is. The status bar shows **Start Comfy**, **Starting
Comfy…** or **Comfy connected**, and the dialog shows startup logs. **Start Comfy
automatically** is off by default. Closing Spool leaves ComfyUI running.

One ComfyUI owns each settings folder and dispatches its queued renders. Further
ComfyUI instances still start and run ordinary workflows; their Spool queue stays
off and their startup log names the owning address.

## Storage maintenance

```powershell
python -m spool prune --storage "D:/Projects/My project" --json
python -m spool reclaim --storage "D:/Projects/My project" --json
```

Both report what they would do. Add `--confirm` to act. `prune` removes previews
no clip uses; inputs and outputs are kept. `reclaim` also compacts the project
database and publishes a new snapshot.

## Diagnostics

The status in the top bar shows the current operation and how long it has taken.
Click it for **Copy diagnostics** or **Download log**. The log keeps the last 120
timings and errors in this browser tab. It never contains image data, request
bodies or workflow contents.

`/spool/api/health` reports the Spool version, the connected ComfyUI and missing
requirements.
