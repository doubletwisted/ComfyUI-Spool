# Directing tools

Directing tools make new shots from the edit itself: a transition between two
shots or the next moment of a shot. Each tool
makes an ordinary clip with
an ordinary workflow, so its takes, seeds and **Edit in Comfy** work as for any
other clip. A clip made this way carries a small label on the timeline and a
card at the top of the inspector that shows what it joins.

| Tool | Where | Shortcut | Workflows |
| --- | --- | --- | --- |
| Add transition | The button on a cut, or the clip menu | **T** at the nearest cut | MiniMax H3 Continue Between Clips (local), MiniMax H3 First-Last Frame (Cloud) |
| Extend shot | The clip menu or the inspector | **E** | MiniMax H3 Continue Between Clips or MiniMax H3 Image to Video (local), MiniMax H3 Max Image to Video (Cloud) |

Every dialog has **Add**, which only changes the edit, and **Add and generate**,
which also queues one take. Generating never chooses a take for you.

## Footage from the clips beside a shot

Transitions and extensions read the clips around them when you press
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

MiniMax H3 renders 24 frames a second in fixed steps, so a transition or extension
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

## Recast and Regenerate

These two are workflows in the library, not tools with dialogs. Drop one on a
clip: the clip keeps its takes and **Use timeline video** feeds it the clip's own
footage. Fill the inputs in the inspector and press **Generate**.

**MiniMax H3 · Recast** puts other people into a shot and keeps the rest: the set,
the camera, the movement and the shot's sound. It follows
[H3 Recast](https://github.com/Bambushu/h3-recast) and needs the BFS character swap
LoRA (`minimax_h3_character_swap_v1.0_ref2va_r64_gl.safetensors`, from
[Civitai](https://civitai.com/models/2027766?modelVersionId=3401556), login needed)
in `models/loras`.

- **Character** is a picture of the new person. Spool edits them into the shot's
  first frame with Qwen-Image-Edit, and that frame shows the model who goes where.
- **Scene reference** replaces that edit with your own frame, made in any image
  editor. It has to be a frame of this shot with everyone edited into their new look.
- **Person 1** to **Person 3**, left to right as they stand, one sentence each with
  *becomes*: `the woman in the red dress becomes a woman with short blonde hair in a
  green dress`. Write a line for everyone in the shot, also those who stay as they
  are, or they get new clothes.

Big changes land (hair colour, age, clothes); small ones fall back to the shot.
Hands, accessories and lips come from the shot. A 7-second shot at 0.9 megapixels
took about 14 minutes on one RTX 4090.

**MiniMax H3 · Regenerate** sharpens a finished clip at a higher resolution in three
steps with the Open-H3-Regenerate refiner, the same finish as **Make final**, for a
clip that was not made as a draft. **Strength** says how much it may change (0.25
keeps motion and framing). Describe the shot in **Prompt**. It is made for MiniMax H3
clips; other footage may change more.

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
