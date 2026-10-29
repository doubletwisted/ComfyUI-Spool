# Generation

A clip can carry a workflow. Its inputs appear in the inspector, and every
**Generate** adds new takes to the clip. Spool saves a version of the workflow
with the clip, so later changes in ComfyUI never alter a clip until you apply
them.

## Adding a workflow

Open **Workflows** in the left sidebar. **Local Workflows** run open-weight models
on your ComfyUI; **Cloud Workflows** use Partner Nodes. Workflows you add to the
project appear under **Project Workflows**. Search narrows the list, and
**Local + Cloud**, **Local** and **Cloud** under it choose where workflows run. The
filter button beside the search shows the task chips and marks a task filter in use.

- **Click** a card to add a shot at the end of the timeline.
- **Drag** it to a cut or empty space to insert a shot there.
- **Drop** it on a clip to replace that clip's workflow, keeping its takes and
  timing.

Built-in workflows choose their output and expose their main inputs without
questions. Example source images are not included: pick your own source in the
inspector before generating.

Some built-in workflows are Spool's own versions with more of their media inputs
connected. The inspector shows them as they fill (see
[Optional and repeated inputs](#optional-and-repeated-inputs)).

| Workflow | Media inputs |
| --- | --- |
| MiniMax H3 · Reference to Video (Cloud) | Up to 4 reference images, a reference video and a reference audio clip |
| MiniMax H3 Max · Reference to Video (Cloud) | Up to 2 reference images and a reference video |
| FLUX 3 · Image to Video (Cloud) | Up to 10 keyframes |
| MiniMax H3 · Reference to Video (local) | Up to 9 reference images, a reference video with its soundtrack, and a reference audio clip |
| MiniMax H3 · Multi-Frame Reference (local) | A reference image and three guide frames with their times, all optional |
| MiniMax H3 · ControlNet Union (local) | The control video, and up to 9 reference images |

The local MiniMax nodes read a reference video's frames as 24 fps. **Use timeline
video** gives them the clip at the project frame rate; choose 24 fps files
otherwise.

### Your own workflows

- **+ Current Comfy Graph** (or **Project → Add current workflow**) adds the graph
  open in ComfyUI.
- **+ Import .json** adds a saved workflow file. You can also drag a ComfyUI
  workflow tab or a `.json` file onto the timeline.
- **Browse all Comfy templates…** opens ComfyUI's full template chooser.

Spool asks **Capture inputs from this workflow?** and lists the source and prompt
controls it found.
**Capture** shows the checked controls on the clip; **Use saved settings** keeps
the whole workflow as it is, with no controls exposed. If the workflow has
several outputs, choose the one that makes the take. Cancel adds nothing.

An imported graph that ComfyUI has not prepared yet shows **Prepare in Comfy**.
Spool opens it in a ComfyUI tab, reads its settings and returns. Preparing never
starts a render. A workflow saved only as an API prompt has no editable graph;
import its original workflow to edit it in ComfyUI.

When an imported workflow refers to input files elsewhere, for example on a
render farm, Spool copies the files it can reach into ComfyUI's inputs. A missing
file is named, never replaced by another file with the same name: restore it and
prepare again.

Footage made in ComfyUI carries its workflow. For a clip without a workflow,
**Open workflow in Comfy** opens the selected take's embedded graph. Capture its
inputs before generating from it.

## Clip inputs

The inspector shows the selected clip's creative inputs. Each image, video or
audio input is one row with a thumbnail, its name and the chosen file.

- **Images:** paste (Ctrl+V when the row has focus), drop a file, or click the row
  to browse. Replacing an image can be undone.
- **Video:** the folder button chooses a file; the timeline button (**Use timeline
  video**) uses the clip's take in the edit with its current trim. Spool cuts the trimmed part from the original
  at full resolution.
- **Image from a video:** choose the first, middle or last frame of the trim.
- **Audio:** the original or selected shot, another clip, or the A1 or A2 lane
  under this clip. Spool renders it to a 48 kHz stereo WAV of the shot's length.
- **Prompt, duration, size, seed:** typed values. Seeds and other whole numbers
  keep every digit, including 64-bit seeds.

A required source left empty blocks **Generate** until you choose one. The text
beside Generate says what is missing.

### Optional and repeated inputs

Some workflows take several inputs of one kind, such as reference images. The
inspector shows the ones you have filled plus one empty slot; filling it shows
the next, up to the workflow's limit. Inputs marked **Optional** can stay empty.

- **Remove** empties an optional input. Later inputs of the same kind move up, so
  the numbering in the inspector stays continuous. Remove can be undone.
- Workflows that refer to references by number in the prompt, such as MiniMax's
  "Image 1" or "Video 2", count them in the order the inspector shows.
- Some workflows need at least one input from a set. MiniMax Reference to Video
  needs a reference image or video, and FLUX 3 Image to Video a keyframe; Generate
  says so until one is added.
- An empty guide frame in Multi-Frame Reference is skipped, so the video is guided
  only by the frames you chose.

Spool leaves an empty optional input out of the request, so the node runs as if
that input were never connected.

Inputs you add are copied into the project, so a clip keeps working when the
original file moves.

## Edit in Comfy

**Edit in Comfy** opens the clip's workflow in a ComfyUI tab, with its layout,
groups, notes and subgraphs. That tab's toolbar shows **Spool · clip name · Apply
to clip**.

- **Apply to clip** brings your changes back to the clip. There is no automatic
  sync; ComfyUI's Ctrl+S saves ComfyUI's own copy only.
- Add and connect a **Load Image** (or another supported loader) and choose its
  file. After Apply, it appears in the inspector with the node's title. Rename
  nodes in ComfyUI, for example "Style reference", to label their fields.
  Removing or disconnecting a loader removes its field.
- Switching ComfyUI workflow tabs during Apply cancels it, so a different graph
  can never be applied to the clip.

Apply can be undone. Takes that already exist keep the workflow they were made
with.

**Reload workflow from take** restores the workflow and inputs that made the
selected take. Either action appears only when the clip has something to open or
restore; a clip without a workflow shows where to find one instead.

### Workflow files beside takes

A normal ComfyUI workflow named `take.json` next to `take.mp4` is that take's
workflow. Spool writes one when it collects a render and when you Apply. Edit the
JSON to change what **Use take** loads; an invalid file shows an error instead of
being ignored.

## Seeds and take counts

Choose seed behaviour beside the seed: **Fixed**, **Increment**, **Decrement** or
**Randomize**. Set the number of **Takes** beside Generate. Several takes show
their exact seeds before they are submitted. The displayed seed moves on only
after the render is accepted.

Each take is numbered when it is requested, not when it finishes.

## Where takes render

The inspector names the route for each clip:

- **Local ComfyUI:** the default for ordinary workflows.
- **Comfy Cloud:** the default for Cloud workflows. **Execute on** switches a
  Cloud workflow to **Local ComfyUI · Partner Nodes** instead.
- **Deadline:** any workflow containing one **Submit to Deadline** node. See
  [Deadline](deadline.md).

When you click Generate, Spool saves each take's exact workflow, inputs and files
before sending it. Results are copied into the clip's folder and checked against
that record before they become takes. New takes never replace the take in the
edit.

## Renders

**Renders** in the top bar opens a panel beside the studio; you can keep editing
while it is open. It groups takes by shot, with each one's stage, progress and
time. Expand a row for its seed, worker, output path and execution record.

- **Cancel request** stops queued work. A local render that is already running is
  cancelled from ComfyUI's queue; Spool records what ComfyUI reports.
- **Retry submission** appears only when Spool could not confirm a submission.
  **Find existing Deadline job** looks for a farm job that was accepted before
  the connection was lost. Neither starts a second render.
- **Retry collection** appears when a finished render could not be collected.
- **Clear from queue** and **Clear finished** tidy the list. Takes, files and
  records stay.
- Results whose shot was deleted are listed under **Results from removed shots**.

## Comfy Cloud

Cloud workflows run on Comfy Cloud through the official
[`comfy-sdk`](https://docs.comfy.org/development/api-development/sdks). They do not
need a local GPU, models, or a running ComfyUI.

- Running on Comfy Cloud needs a Comfy plan that allows API keys. A free account
  gets "API key authentication is not available for free tier accounts". Set
  **Execute on** to **Local ComfyUI · Partner Nodes** instead: the workflow runs on
  your ComfyUI, which needs no GPU for these nodes, and the Partner Node is paid
  with Comfy credits.
- Enter your key in **Project → Comfy settings… → Comfy Cloud API Key**. The field
  is write-only; leaving it blank keeps the saved key. Without a saved key Spool
  uses `COMFY_API_KEY`.
- The same key pays for Partner Nodes when a Cloud workflow runs on your ComfyUI.
- `COMFY_BASE_URL` selects another Comfy Developer Platform deployment.
- Input files are uploaded as Cloud assets. Only the chosen output's part of the
  graph is submitted.
- If Spool restarts, it resumes watching submitted jobs and downloads their
  results. A submission interrupted before Comfy Cloud returned a job ID is marked
  uncertain and never resubmitted on its own.

Without the `comfy-sdk` package, Cloud workflows show **Cloud unavailable**.

## Clip notes

**Notes** at the bottom of the inspector hold requests for a clip, for you or an
agent. **Add note** (or Ctrl+Enter) posts one. Tick **Addressed** when it is done;
addressed notes move to a collapsed history with who completed them and when, and
agents add a short summary. **Reopen** makes a new open copy.

The timeline shows an amber count of open notes on each clip. Notes never start a
render, and agents act on them only when asked.

## Limitations

- **Inputs.** Spool exposes inputs it can identify from installed node
  definitions and the graph's connections: media sources, prompts, seeds, frame
  counts and sizes. Selectors, unclear roles, text generated inside the graph and
  seconds-to-frames formulas stay in the saved settings. Edit them in ComfyUI.
- **Files.** Spool stages files for LoadImage, LoadImageMask, LoadAudio, LoadVideo
  and VHS_LoadVideo. Other loaders with file inputs are refused. Models and
  custom-node dependencies must already be installed where the render runs.
- **Results.** Spool collects SaveImage, PreviewImage, SaveVideo and
  VHS_VideoCombine video outputs. VHS `meta_batch` is not supported.
- **Old takes.** Opening the workflow of an imported or historical take does not
  map its saved values back into widgets; its exact recorded workflow stays
  available.
- **Interrupted renders.** A render lost mid-run cannot resume. Spool marks it
  uncertain and never re-renders on its own.
- **Linked editing** between Spool and ComfyUI needs both on the same address
  (same browser origin).
