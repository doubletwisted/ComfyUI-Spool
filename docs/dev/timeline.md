# Timeline operations

`ui/timeline.js` owns layout, placement, gesture resolution, clip and soundtrack
edits, take-choice trim compensation and the export plan. It has no browser or
editor globals. Operations mutate the document supplied by the caller. IDs for
split, duplicate and soundtrack additions come from the caller.

`beginEdit(document, options)` copies the initial document and clip, captures
the following gap and snapping points, and returns the session consumed by
`applyEdit(document, session, deltaFrames)`. Repeated applications use the same
initial geometry; they do not accumulate deltas. Soundtrack snapping receives
the enabled flag and tolerance in frames from the adapter's captured pixel scale.
Clip reorder uses `moveClip` with the insertion index after excluding that clip.

The studio owners keep pointer thresholds (`timeline-pointer.js`), selection
(`clip-selection.js`), playback (`viewer.js`), trim preview (`trim-preview.js`)
and rendering (`timeline-renderer.js`, `audio-editor.js`) outside this module.
The composition runtime connects history, saving and messages. It snapshots before mutations and preserves
asynchronous take arrivals when restoring snapshots. The timeline module never
changes selection or chooses an arriving take.

`moveGroup(document, initialDocument, ids, deltaFrames)` translates selected video
and independent audio by one offset from their initial geometry. Linked A1 audio
shares the video's identity and occupancy. It chooses the nearest valid placement
that keeps starts nonnegative and avoids unselected clips on the same track.
Unselected positions stay fixed; gaps are rebuilt and the existing video sequence
end is retained when possible. Repeated moves do not accumulate offsets, and
current clip objects retain asynchronous take arrivals. `snapPoints` accepts one
ID or an array of IDs to exclude the whole moving selection.

Selection and its range anchor are composed through `ui/clip-selection.js`;
`ui/timeline-pointer.js` owns marquee geometry.
Selected IDs persist only in session view state, never in the shared document.
Batch mutations use one history snapshot. Edge, slip and slide gestures collapse
to one primary clip, preserving the existing editing rules below.

The existing rules are preserved: minimum duration and split margin are six
frames; snapping uses the first point within a strict seven-pixel tolerance;
normal trims preserve following positions using gaps; Shift ripple trims move
following clips; Alt rolls require a shared cut; soundtrack clips remain
independent. Normal deletion retains space and ripple deletion removes duration
while retaining an existing gap. Tail trimming only compensates an existing tail
gap. Export fills gaps and soundtrack overhang with black frames and uses track
mute/solo plus clip gain/fades, independently of monitor mute.

`timelinePlan(document, range)` is the editable counterpart of the export plan:
one entry per video track and audio lane, every clip cut to the range and nothing
flattened, so covered clips survive. Disabled or muted items keep their place with
`enabled: false`; audio that would overlap on a lane moves to an added lane.
`spool/interchange.py` maps it to OpenTimelineIO against the original files.

`splitAudio` accepts an optional clip ID so the editor's selected soundtrack
continues to own the split. Without it, the containing soundtrack is used.
`tests/timeline_checks.mjs` imports the production module with literal documents;
installed trim and runtime suites verify the adapters.

`unlinkAudio(document, clipId, newId)` snapshots the chosen take's audio onto A1
at the clip's exact sequence position and source range, with its current mix.
The authored video clip gets `audioDetached: true`; immutable take media is not
changed. Video edits and take changes do not move or replace the detached audio.
Playback/export suppress that video's embedded audio. Undo restores both fields.

Independent audio clips use `track: 'source'` for A1; absent track or `'music'`
means A2 for older documents. Placement, trims and roll neighbors respect tracks;
A1 placement also avoids occupied linked audio. Each lane's mute/solo controls
its mix. `addAudioClip` accepts a video with sound and stores an audio view of its
existing file. The editor requests `fullLength: true` for audio-only imports;
no video clip, file extraction or new backend adapter is required.
