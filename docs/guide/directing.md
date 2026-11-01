# Directing tools

Directing tools make new shots from the edit itself: a transition between two
shots, the next moment of a shot, a new middle for part of a shot, or the same
shot with another actor, camera or effect. Each tool makes an ordinary clip with
an ordinary workflow, so its takes, seeds and **Edit in Comfy** work as for any
other clip. A clip made this way carries a coloured badge on the timeline and a
card at the top of the inspector that offers the same choices again.

| Tool | Where | Shortcut | Workflows |
| --- | --- | --- | --- |
| Add transition | The ✦ button on a cut, or the clip menu | **T** at the nearest cut | LTX 2.5 First-Last Frame (local), MiniMax H3 and LTX 2.5 First-Last Frame (Cloud) |
| Extend shot | The clip menu | **E** | MiniMax H3 or LTX 2.5 Image to Video (local), MiniMax H3 Max or LTX 2.5 Image to Video (Cloud) |
| Retake part | The clip menu | **R** | The transition workflows |
| Recast | The clip menu or the inspector, also for several selected clips | – | MiniMax H3 ControlNet Union (local) |
| Re-angle, Add effect | The clip menu or the inspector, also for several selected clips | – | MiniMax H3 Reference to Video (local or Cloud) |

Every dialog has **Add**, which only changes the edit, and **Add and generate**,
which also queues one take. Generating never chooses a take for you.

## Frames from the clips beside a shot

Transitions, extensions and retakes read their start and end frames from the clips
around them when you press **Generate**, not when you add them. Choosing another
take, trimming or reordering the neighbouring shots therefore changes what the
next take starts and ends on. The inspector shows these inputs as **Last frame of
the clip before** and **First frame of the clip after**, with a preview of the
frame. A tool that needs a neighbour refuses to generate until that neighbour has
a take. **Use take** on a directed clip keeps its workflow and these links, so
the next take still follows the edit.

The new clip uses the picture shape of the shot it joins, so a workflow whose
default is square still matches widescreen footage. Generated takes start on the
neighbour's frame; the clip skips that repeated frame so the cut stays clean.

## Transitions

Hover a cut between two touching shots on the same track and press ✦, or press
**T** to use the cut nearest the playhead. Each style tile plays its effect between
the two real frames. Choose a style, optionally add a direction ("the smoke is
red"), a length and a model. The transition is inserted at the cut and the shots
after it move later.

Styles: Morph, Smoke, Whip pan, Zoom through, Light flash, Ink bloom, Water wave,
Glitch and Dissolve. The inspector card switches the style of an existing
transition and rewrites its prompt; the prompt stays editable below.

## Extend a shot

**Extend shot** adds a clip after the selected shot that starts on its last frame,
as trimmed in the edit. Describe what happens next. The shot's own prompt, if it
has one, is added as context.

## Retake part of a shot

**Retake part** shows the shot as a filmstrip. Drag the highlighted part (or use
the arrow keys) and set its length in whole seconds. Spool splits the shot around
that part and gives the middle a first-and-last-frame workflow joining the frames
on either side. The middle keeps its original footage as a take, so you can switch
back at any time.

## Recast, re-angle and effects

**Re-angle** and **Add effect** run the shot through MiniMax H3 Reference to Video
with the shot itself as the reference video and its sound kept. **Recast** runs it
through MiniMax H3 ControlNet Union: the shot's pose drives the movement and the
cast member's pictures give the person. Say **Where** it happens; Spool fills it
from the shot's prompt when it has one. A frame of the shot is not passed as a
picture, because the model would bring back the old actor. The take has new sound.
Select several shots to change them all at once; each gets its
own clip workflow and keeps its footage as a take.

- **Recast** replaces the main person with a cast member. It runs on local ComfyUI
  or Deadline; Comfy Cloud has no pose-control workflow in Spool yet.
- **Re-angle** films the same moment from another camera: low, high, close-up,
  wide, side, over the shoulder, a slow orbit or top down.
- **Add effect** adds rain, snow, neon night, golden hour, fire, fog, magic
  sparks or a disintegration, and keeps the rest of the shot.

Reference to video is heavy: a seven-second shot takes many minutes on one GPU.
Use **Draft** (below) or the workflow's **Turbo (4 steps)** control to try ideas
first.

## Cast

The **Cast** tab in the left sidebar keeps characters, props and places with up to
four pictures each and a short description. Drop pictures on **New cast member**,
then rename it; names are one word and unique.

Write `@Name` in any prompt. When the clip generates, Spool puts that member's
pictures into the workflow's empty reference image inputs and replaces `@Name`
with the tag the model reads, such as `<Picture 2>` (or `Image 2` for the
MiniMax H3 Cloud node). Pictures you chose yourself keep the first places. A
workflow without reference inputs receives the name and description instead. The
prompt field suggests names as you type `@`, and chips under it show what each
mention becomes.

## Prompt checks

Under the prompt, Spool lists problems it can see before you spend GPU time: an
`@name` that is not in the cast, a `<Picture 3>` or `<Video 1>` with no input
behind it, prompts over 220 words, quality tags such as "8k", "no …" phrasing,
more cuts than the length allows, several camera moves in one shot, and, for
models that make sound, a prompt that never says what we hear. The checks are
advice; they never block **Generate**.

## Drafts

**Draft** beside **Generate** renders quick takes: at most 0.25 megapixels, the
smallest size of the same shape for Cloud models, and a workflow's turbo switch
on. Draft takes carry a **Draft** badge. **Make final** on a draft renders again
with that take's seed and the clip's current settings at full quality. The
picture can change between draft and final, because resolution changes what a
seed produces.

## Where it runs

The directing tools run wherever their workflow runs: local ComfyUI, Comfy Cloud,
or Deadline for local workflows. Standalone Spool adds and edits these clips but
needs a paired ComfyUI or Comfy Cloud to generate.
