# Editing

The studio has a library sidebar on the left (**Workflows** and **Media**), the
viewer in the middle, the inspector on the right and the timeline below. The
status bar along the bottom shows the latest message, the save state (click it to
save now or retry) and the Comfy connection. Small arrows in the panel headers
hide a panel; a matching arrow at the viewer's edge
brings it back. A hidden sidebar leaves a thin icon rail: **Workflows** and
**Media** open the sidebar over the viewer until you click elsewhere, and the
bottom button docks it again. Spool remembers a hidden sidebar. On narrow windows
the sidebar opens as a drawer.

## Clips and tracks

A clip is one shot on a video track. Its takes are the candidate results for that
shot; one of them is in the edit. Linked audio from that take plays on **A1**
under the clip. **A2** is the soundtrack lane for independent audio.

- **+ Track** adds video tracks (V2, V3 and so on). Higher enabled tracks cover
  lower ones; the sound of all enabled tracks mixes together.
- Click a track label to choose where new clips go. Drop footage or workflows on
  a lane, or drag a clip up or down to another track.
- The eye beside a V track hides its picture and linked sound without changing
  timing. Right-click a track header for **Delete track**; one video track always
  stays.
- Drag the lower edge of a track header to resize that lane. Double-click the edge
  to reset it. Lane sizes are remembered for each project in this browser.

## Selecting

- Click a clip to select it. **Ctrl-click** adds or removes clips, **Shift-click**
  selects a range on one track, **Ctrl+A** selects every clip.
- Drag across empty timeline space to box-select; hold Ctrl to add to the
  selection. **Esc** clears it.
- On macOS, the studio lists Cmd and Option where other systems show Ctrl and
  Alt; Ctrl and Cmd both work.

Selection belongs to the browser tab. It survives a reload but is not part of the
saved project.

## Moving and trimming

- **Drag a clip** to move it. A selected group moves together and keeps its
  spacing. Video dropped over other footage overwrites it: covered parts are
  trimmed or split, the rest stays where it was, and the clip's old place becomes
  a gap.
- **Alt-drag** a clip to drag a copy.
- **Drag an edge** to trim. Following clips stay in place, leaving a gap. Hold
  **Shift** to ripple (following clips move), or **Alt** on a shared cut to roll
  both sides. Trims stop at the limits of the source footage.
- Hold **S** while dragging a clip to slip its source inside the clip, or **D** to
  slide it between its neighbours.
- **B** splits at the playhead; **,** and **.** nudge the selected cut by a frame
  (with Shift, five).
- With snapping on (**N** toggles it), edges snap to the nearest cut within seven
  screen pixels. Drag further for an intentional overwrite.
- Hold the **middle mouse button** and drag to pan the timeline. **Esc** during the
  pan returns to where you started.

**Delete** removes the selection and leaves a gap; **Shift+Delete** ripple
deletes. **Ctrl+D** duplicates. **Disable clip** in the right-click menu (or
**Ctrl+Shift+D**) bypasses clips without moving them: they are dimmed, crossed out
and left out of playback and export.

**Ctrl+Z** undoes and **Ctrl+Shift+Z** (or **Ctrl+Y**) redoes. Every gesture,
including a group move, is one undo step.

## Audio

- **Add audio** (the waveform button) places the full sound of an audio or video
  file on A2. You can also drop a Media item onto A1 or A2, or right-click it for
  **Use audio only**.
- Right-click a clip or its A1 audio for **Unlink audio and video**. The audio
  becomes an independent A1 clip with the same trims, level and fades, and stays
  put when the video is moved, trimmed or replaced. Undo restores the link.
- Each lane has mute and solo. Clips have gain and fades.

## Takes

The **Takes** rail beside the viewer lists the selected clip's takes from top to
bottom, so **↑** and **↓** in Source step through them in the order you see. When a
clip has no takes yet, or the window is narrower than 1100 pixels, takes show as a
strip under the viewer instead. New, unreviewed takes carry a **New** badge, and
the clip shows a blue count on the timeline. A take stops being new once you
review it in Source or Compare, or use it; hovering does not count.

Takes generated from the same inputs form one batch. When a clip has more than
one batch, each starts with a heading that names what changed from the batch
before it (for example **Prompt changed**), with its time and take count;
imported footage has its own heading. Seeds may differ within a batch. Renders
still in progress appear below the list with their stage and progress.

- Move across a take thumbnail to scrub the whole take in the main viewer. Moving
  away restores what was there; nothing is chosen.
- **Source** reviews a take on its own, with its own playhead (**Q** switches
  between Source and the edit; **1** to **9** pick a take). **Compare** (**C**)
  shows two takes side by side.
- **Use take** (on the take you point at or review, or **Enter** in Source) puts
  the take in the edit. It also loads that take's workflow and inputs for the
  next Generate.
- Select takes with their checkboxes, Ctrl-click or Shift-click. **Delete** takes
  them off this clip but keeps their files, with undo. **Permanently delete**
  removes their files after a confirmation and cannot be undone. The take in the
  edit is always kept, and files used elsewhere are protected.
- Drag a take thumbnail onto a video track to turn it into its own clip.
- Right-click a take for **Reveal in Explorer** (**Reveal in Finder** on macOS,
  **Show in folder** on Linux) or **Download** (the original file, not the
  review copy).

The amber bar in Source marks the part of the take the edit uses, which can be
shorter than the take.

## Viewer

- **Space** plays and pauses, the arrow keys step frames and cuts, **Home** and
  **End** jump to the ends, **F** goes fullscreen.
- Playback copies prepare in the background when you import footage, receive takes
  or open a project. One copy per source uses the project size without enlarging
  the original, at the project frame rate. The viewer shows **Preparing…** until
  it is ready. Copies stay in this computer's workspace cache beside its working
  database; shared project folders keep originals, import proxies and shot files.
  Export always reads the originals. Older `.spool/previews` playback copies are
  unused and can be reclaimed with `python -m spool prune`.
  Newly received takes prepare without an edit. Reviewing a replacement file uses
  its new playback copy. Closing the host stops unfinished playback encoding;
  it can prepare again next time.
- Right-click the viewer for **Export frame** (a full-resolution PNG), **Fit to
  viewer** and **Fullscreen**.

## Media

The **Media** tab lists the project's footage, images and audio, with filters,
search and grid or list views.

- **Import footage…** adds files. Drop files onto the sidebar or the timeline.
- **Project → Import video from path…** reads a video where it is, without copying
  it, and splits it at detected hard cuts. Each shot becomes a clip whose first
  take is **Original clip**; the source audio goes once on A2.
- **Detect cuts in selected clip…** (in **Project**, or a clip's right-click menu)
  finds hard cuts inside the clip, shows the count and splits on request.
- Copy an image, click the media pool or the timeline and press **Ctrl+V**. In the
  pool this adds a library image; on the timeline it adds a five-second still clip.
- Remove a media item with its trash button, its right-click menu, or Delete when
  its card has focus. Clips already using it keep working.

## Frame rate and size

**Project → Project settings…** sets the export resolution. The frame rate can be
chosen until media is added; after that it stays fixed so timing is preserved.
The first video imported into an empty project sets the frame rate.

Spool plays every decoded source frame once at the project frame rate. Five
seconds of 25 fps footage (125 frames) plays in 4.17 seconds on a 30 fps timeline.
Linked audio follows the speed change with its pitch preserved. Original files
are never changed.

## Export

**Export** writes an MP4 of the sequence with its audio mix.

- The range defaults to **Picture length**: from the start to the end of the last
  video clip.
- Drag the amber Start and End markers on the ruler, or press **I** and **O** at
  the playhead. **Range** opens the export settings without rendering.
- The Export dialog takes seconds or `HH:MM:SS:FF` and shows the exact duration.
  **Entire timeline** includes everything, **Selected clips** fits the selection.

Gaps export as black. Track mute and solo and clip gain and fades apply; the
viewer's mute does not.

### Timeline for another editor

Choose **OpenTimelineIO (.otio)** as the format to continue the edit in DaVinci
Resolve, Premiere Pro, Kdenlive or another editor that imports OTIO. The file
keeps every video track, covered clips, trims, gaps and the audio lanes (A1 per
video track, A2 soundtrack) for the export range. Disabled clips and tracks, muted
clips and muted or un-soloed lanes arrive disabled rather than removed.

- Clips point at the original files where they are, at full resolution; nothing is
  copied. A shot of an imported video points into the whole source file, so the
  editor can trim past the shot's ends. Move the media with the `.otio` file, or
  relink it in the editor.
- Footage at another frame rate carries a speed change, matching how Spool plays
  each source frame once. Source timecode is respected.
- In DaVinci Resolve, set the project's timeline frame rate to the Spool sequence
  rate before **File › Import › Timeline**. Resolve builds the imported timeline
  at the project rate, so a 30 fps sequence in a 24 fps project is converted and
  trims round to the nearest frame. Resolve names clips after their files.
- Gain, fades, transitions and the export resolution are not carried; set them
  in the editor. **Include audio tracks** off leaves only the video tracks.
- The file downloads and is also kept in the project's `exports` folder.
