# Directing tools

Directing tools make new shots from the edit itself: a transition between two
shots, the next moment of a shot, a new middle for part of a shot, or the same
shot with another actor, camera or effect. Each tool makes an ordinary clip with
an ordinary workflow, so its takes, seeds and **Edit in Comfy** work as for any
other clip. A clip made this way carries a small label on the timeline and a
card at the top of the inspector that shows what it joins.

| Tool | Where | Shortcut | Workflows |
| --- | --- | --- | --- |
| Add transition | The button on a cut, or the clip menu | **T** at the nearest cut | MiniMax H3 Continue Between Clips (local), MiniMax H3 First-Last Frame (Cloud) |
| Extend shot | The clip menu or the inspector | **E** | MiniMax H3 Continue Between Clips or MiniMax H3 Image to Video (local), MiniMax H3 Max Image to Video (Cloud) |
| Retake part | The clip menu | **R** | The transition workflows |
| Recast | The clip menu or the inspector, also for several selected clips | – | MiniMax H3 ControlNet Union (local) |
| Re-angle, Add effect | The clip menu or the inspector, also for several selected clips | – | MiniMax H3 Reference to Video (local or Cloud) |

Every dialog has **Add**, which only changes the edit, and **Add and generate**,
which also queues one take. Generating never chooses a take for you.

## Footage from the clips beside a shot

Transitions, extensions and retakes read the clips around them when you press
**Generate**, not when you add them. Choosing another take, trimming or reordering
the neighbouring shots therefore changes what the next take joins. A tool that
needs a neighbour refuses to generate until that neighbour has a take. **Use
take** on a directed clip keeps its workflow and these links, so the next take
still follows the edit.

The first local model in each dialog, **MiniMax H3 · Local**, uses Spool's
**Continue Between Clips** workflow. It anchors the last second of the clip before
and the first second of the clip after, with their sound, at the two ends of the
new clip, so a movement that is under way at the cut carries on instead of starting
again from a still frame. The inspector shows these inputs as **Last second of the
clip before** and **First second of the clip after**. The take repeats those
anchored seconds; the clip skips them, so the edit shows only the new middle and
the cut lands on the next frame of the movement.

The other models read single frames: **Last frame of the clip before** and
**First frame of the clip after**. Each dialog says which the chosen model sees.
The directing tools offer only MiniMax H3: it reads the direction through a
language model and holds one take where other models cut or dissolve.

The new clip uses the picture shape of the shot it joins, so a workflow whose
default is square still matches widescreen footage.

MiniMax H3 renders 24 frames a second in fixed steps, so a transition or retake
with motion is a little shorter or longer than the length you asked for (4 s gives
4.04 s). Continue Between Clips expects a 24 fps edit.

## Transitions

Hover a cut between two touching shots on the same track and press its button, or
press **T** to use the cut nearest the playhead. Say what happens in between, set
a length (4 seconds by default) and a model. The transition is inserted at the cut
and the shots after it move later.

A transition is one continuous take from the last frame of the first shot to the
first frame of the second. Spool writes the prompt as a timeline: the footage it
opens on, what you wrote for the middle, the footage it arrives in, and an
instruction to keep one take with no cuts or dissolves. What you write decides
whether the take holds:

- Describe how the camera and the people get from one frame to the other, in
  order: who moves where, how the camera follows, what comes into view.
- Name what the second shot opens on, as it really looks: "a coral-covered
  balustrade with columns behind it", not just "the palace".
- Join shots that can meet in one move. A first-person shot does not turn into a
  shot of the same person facing the camera; an empty reef does not become a
  close-up in a second. Reorder the edit so neighbours share a place or a subject.
- Give the move time: about 4 seconds for a turn and a reveal, 3 for a small
  change of framing.

Even with a good path, MiniMax H3 often continues the first shot and then cuts or
dissolves into the opening footage of the next one instead of moving the camera
there. The more the two framings differ, the more likely this is. Which takes hold
depends on the seed more than on the wording, so generate several takes (the
**Takes** field beside Generate) and watch each one at half speed before you use
it: a dissolve is easy to miss at full speed. In our tests on shots that connect,
about one take in six held without a cut or dissolve. Under the
field are a few suggestions (camera move, match the motion, push through, whip
pan, morph); each adds its wording to the field, where you can edit it.

## Extend a shot

**Extend shot** adds a clip after the selected shot that carries on from its end,
as trimmed in the edit: from its last second with MiniMax H3 Continue Between
Clips, or from its last frame with the other models. Describe what happens next.
The shot's own prompt, if it has one, is added as context.

## Retake part of a shot

**Retake part** shows the shot as a filmstrip. Drag the highlighted part (or use
the arrow keys) and set its length. Spool splits the shot around that part and
gives the middle a workflow that joins the footage on either side; with motion it
keeps a second of the shot on each side to anchor. The middle keeps its original
footage as a take, so you can switch back at any time, and **Use take** puts either
take back where it belongs in the shot.

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
- **Re-angle** films the same moment from another camera. Describe the camera;
  suggestions such as low angle, close-up or over the shoulder fill in the words.
- **Add effect** changes the weather, light or surroundings and keeps the rest of
  the shot. Describe the change; rain, snow, fog, night and golden hour are
  offered as suggestions.

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
behind it, prompts over 220 words, quality tags such as "8k", "no …" phrasing
(except editing instructions such as "no cuts", which video models follow),
more cuts than the length allows, several camera moves in one shot, and, for
models that make sound, a prompt that never says what we hear. The checks are
advice; they never block **Generate**.

## Drafts

**Draft** beside **Generate** is offered for workflows that can finish their own
drafts. In Spool's built-ins that is **MiniMax H3 · Draft and Final**, image or
text to video with an optional first and last frame.

A draft renders quickly at the workflow's **Draft resolution** (0.4 megapixels
unless you change it) with its turbo switch on, and carries a **Draft** badge.
**Make final** on a draft does not render the shot again: it upscales that draft
to the **Final resolution**, encodes it and refines it in three steps with the
Open-H3-Regenerate refiner, the way NVIDIA's Open-H3-Regenerate-2K does. The final
keeps the draft's motion, framing and timing, gains detail, keeps the draft's
sound, and arrives as a new take with a **Final** badge. A different resolution
with the same seed would give a different video, which is why other workflows
offer no Draft.

The finish needs `minimax_h3_open_regenerate_2k_refiner_rank_384_bf16.safetensors`
in `models/loras` ([Kijai/MiniMax-H3-experimental](https://huggingface.co/Kijai/MiniMax-H3-experimental/tree/main/loras),
under the MiniMax H3 Community License). It starts from sigma 0.8, which stays
closer to the draft than the reference 0.909. A 5-second final at 1344 x 768 took
about five minutes on one RTX 4090.

## Where it runs

The directing tools run wherever their workflow runs: local ComfyUI, Comfy Cloud,
or Deadline for local workflows. Standalone Spool adds and edits these clips but
needs a paired ComfyUI or Comfy Cloud to generate.
