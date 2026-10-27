# Spool - Video Timeline for ComfyUI

Spool is a video editor that lives inside ComfyUI. Lay out shots on a timeline,
generate takes for each shot with your own workflows, review them side by side
and choose the take that goes in the edit. Takes can render on this computer, on
Comfy Cloud, or on a Thinkbox Deadline farm.

Your workflows work as they are: Spool needs no custom nodes in the graph.

![The Spool studio: a three-shot sequence, with two takes of the selected shot below the viewer and its workflow inputs on the right](docs/images/studio.webp)

Version 0.1.0 is an early release. It is developed and tested on Windows.

## What you can do

- **Edit a sequence.** Video tracks, linked clip audio and a soundtrack lane.
  Trim, ripple, roll, slip, slide, split, duplicate and disable clips, with
  snapping, box selection and undo.
- **Generate takes per shot.** Add a built-in workflow, the graph open in
  ComfyUI or a workflow file. Spool exposes its main inputs (sources, prompt,
  seed, duration, size) on the clip, and each Generate adds new takes.
- **Review and choose.** Scrub takes, compare two side by side, then **Use take**.
  New results never replace the take in the edit on their own.
- **Edit the workflow in ComfyUI.** **Edit in Comfy** opens the clip's workflow
  in a ComfyUI tab; **Apply to clip** brings your changes back.
- **Keep everything in a project folder.** Footage, inputs, takes and the edit
  live together and can sit on shared storage.
- **Export** the sequence, a range or a single frame.
- **Automate** with a scoped command API, a CLI and an agent skill.

## Requirements

- ComfyUI 0.39.0 or newer. Tested with ComfyUI 0.42.1 and frontend 1.55.18.
- Python 3.11 or newer. On older Python, Spool disables itself and logs why.
- `ffmpeg` and `ffprobe` on the PATH of the process running ComfyUI. They are
  used for import, previews and export.
- For Comfy Cloud: the `comfy-sdk` package from `requirements.txt` and a Comfy
  API key.

If something is missing, the studio shows **Setup needed** in its top bar and
ComfyUI's startup log says what to install.

## Install

**ComfyUI Manager or the Comfy Registry:** search for **Spool** and install
`spool-timeline`. With comfy-cli: `comfy node install spool-timeline`.

**Manually:** clone into `ComfyUI/custom_nodes` and install the dependency with
the Python that runs ComfyUI:

```powershell
cd ComfyUI/custom_nodes
git clone https://github.com/doubletwisted/ComfyUI-Spool Spool
python -m pip install -r Spool/requirements.txt
```

On the Windows portable build, use `python_embeded\python.exe -m pip install ...`
instead of `python`. Restart ComfyUI and reload the browser tab.

## Quick start

1. Click **Open Spool ↗** in ComfyUI's top bar. The studio opens in its own tab.
2. Click **New project**, or choose **Project → Open project folder…**.
3. Open **Workflows** in the left sidebar and click a card to add a shot. You can
   also drag a ComfyUI workflow tab or a workflow `.json` file onto the timeline,
   or import footage under **Media**.
4. Select the clip. Fill in its inputs in the inspector on the right: choose a
   source image or video, write the prompt, set the duration and seed.
5. Set the number of **Takes** and click **Generate**. Follow progress under
   **Renders**.
6. Review the new takes in **Source**, compare them, and click **Use take** to put
   one in the edit.
7. Trim and arrange the clips, add a soundtrack, then **Export** an MP4.

The [user guide](docs/guide/README.md) covers each step in detail.

## Where your work is saved

Each project is a folder. It holds `project.spool` (the edit, workflow versions
and render records), the inputs you add, and one output folder per clip with its
takes. Open a project folder from another computer, or from a network share, to
continue working. See [Projects and storage](docs/guide/projects.md).

Spool's own settings and the list of opened projects are kept in
`ComfyUI/user/spool`. Set `SPOOL_STORAGE` to move them. The Comfy Cloud API key is
stored outside every project, in `%LOCALAPPDATA%\Spool` on Windows and
`~/.config/Spool` elsewhere.

## Comfy Cloud

Cloud workflows in the library run on Comfy Cloud by default. Enter your key in
**Project → Comfy settings…**, or set `COMFY_API_KEY`. Cloud runs and
Partner Nodes spend credits from that key. Spool does not need a local GPU or a
running ComfyUI to render on Cloud.

Running on Comfy Cloud needs a Comfy plan that allows API keys. With a free
account, set **Execute on** to **Local ComfyUI · Partner Nodes**: the same
workflow then runs on your ComfyUI and pays for the Partner Node with Comfy
credits. See [Generation](docs/guide/generation.md#comfy-cloud).

## Deadline (experimental)

A workflow that contains one **Submit to Deadline** node from
[ComfyUI-Deadline-Plugin](https://github.com/doubletwisted/ComfyUI-Deadline-Plugin)
renders on your farm, one job per take. Results come back with the same checks as
local renders. See [Deadline](docs/deadline.md).

## Run Spool without ComfyUI

From the Spool folder, with Python, aiohttp and Pillow installed:

```powershell
python -m spool            # http://127.0.0.1:8190/spool/
```

Editing, import and export work while ComfyUI is stopped. Save your ComfyUI
launcher in **Project → Comfy settings…** and Spool can start it for you. Use `--port` to change
the port and `--storage` (or `SPOOL_STORAGE`) to choose the settings folder.

## Agents and scripts

Agents and scripts drive Spool through the same backend as the studio: inspect
shots, change inputs, edit the timeline, queue a bounded number of takes and
complete clip notes. Every command names its project, clips, capabilities and
take budget. See [Agents and automation](docs/automation.md) and the
[`spool-control` skill](skills/spool-control/SKILL.md).

## Known limitations

- Developed and tested on Windows. Reveal in Explorer and Open clip folder are
  Windows only; macOS and Linux are untested.
- Spool exposes inputs it can identify with confidence. Anything else stays in
  the workflow's saved settings, editable through **Edit in Comfy**.
- Spool stages files for LoadImage, LoadImageMask, LoadAudio, LoadVideo and
  VHS_LoadVideo. Workflows with other file loaders need those files in place.
- Results are collected from SaveImage, PreviewImage, SaveVideo and
  VHS_VideoCombine.
- A render lost mid-run is not resumed. Spool marks it uncertain and never
  re-renders on its own.

More detail: [limitations](docs/guide/generation.md#limitations).

## Security

Spool has no user accounts. Anyone who can reach ComfyUI's port can use it, so
start ComfyUI with `--listen` only on networks you trust. [SECURITY.md](SECURITY.md)
explains what each request may do and how to report a vulnerability.

## Contributing

Development setup, the test gate and browser checks are in
[CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

GPL-3.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
