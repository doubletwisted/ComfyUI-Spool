# Studio runtime

`spool/editor.py` serves `ui/editor.html` unchanged. That document loads
`ui/bootstrap.js`, which owns the loading/error barrier before importing the
runtime. `ui/editor.js` composes editing state, UI actions and the Comfy bridge
with the rendering and lifecycle owners described below.

`initializeEditor` returns the same initialization promise within a document.
The bootstrap publishes the `window.spoolNative` interface only after the
project's authoritative baseline, dependencies, handlers and final render are
ready. Pointer and keyboard input remain blocked on failure; later polling cannot
release a failed startup. Project loading and runtime loading are covered by the
same timeout as styles, profiles and installed node definitions.

The [project-edit module](project-edit.md) owns revision, draft and receipt
adoption; the editor supplies its adapters. Browser storage holds per-view
preferences and undo history only. There is no browser generation worker or
browser-owned project persistence.

The runtime includes ordinary edge trimming, modifier gestures, real-take
filtering, modal dialog semantics and the bounded paused-seek guard
(`ui/video-seek-guard.js`). Dialog lookups are limited to this editor. Unload
releases the bridge, polling and layout observers. Edit operations live in
[`ui/timeline.js`](timeline.md).

The Comfy page extension and the studio import `/spool/ui/bridge.js` and
`/spool/ui/wire.js`. If Spool routes fail to register, these extension imports
fail and **Open Spool** is unavailable. This deliberately fails closed because
routes and scripts ship together. Bridge wire literals are frozen. `serve`
returns a cleanup function; the owner closes its channel. Client close rejects
pending calls.

Queue preflight, submission, persisted retry ownership and seed advancement live
in `ui/queue-submission.js`. `ui/input-actions.js` owns asynchronous input
replacement and explicit input choices, backed by `ui/input-replacement.js`
tokens. Both receive live getters and narrow actions; they never retain a
project snapshot across a transport boundary. Lifecycle checks import these
production modules with deferred transport and decoder dependencies.

`ui/dialogs.js` owns modal replacement/close cleanup, capture cancellation,
Escape/Tab handling and focus return. `ui/action-menu.js` owns menu DOM,
keyboard navigation, dismissal and focus return; callers still build actions.

`ui/viewer.js` owns picture presentation, comparison panes, playback clock,
video pool and eviction, bounded seeking, image decoding, preview preparation,
and audio players/mixing. Current document and pixel scale come from getters;
repaint/save/trim adapters keep the original operation order. Preview quality
and preparation policy are unchanged. Take-review transitions and viewer
zoom/gestures still belong to the composition runtime.

`ui/timeline-renderer.js` retains clip-lane nodes, markup memoization and the
geometry-only drag repaint. `ui/timeline-pointer.js` owns pointer thresholds,
clip/audio/fade gestures, marquee, scrub, panning, interruption cancellation and
release order. Its adapters explicitly read current interaction state and apply
selection, history, repaint and save actions.

`ui/inspector-renderer.js` builds the selected clip inspector and attaches its
controls. `ui/library-renderer.js` builds the media pool and its cards.
`ui/workflow-coordinator.js` retains workflow preparation/load caches and
coordinates workflow-library insertion and replacement.

The studio remains build-free. `tsconfig.json` checks the timeline, ledger,
project-edit, generation and extracted owners with `allowJs`, `checkJs` and
`noEmit`. `ui/types.js` holds shared document, clip, take, attempt and API result
JSDoc contracts. Run `npm run typecheck`; the architecture gate runs it too.
Strict inference is disabled for gradual checking of existing JavaScript; no
blanket `any` annotations or `@ts-nocheck` exclusions are used.

`ui/edit-actions.js` owns the authored actions that invalidate pending input
replacements: undo/redo restoration, deletion and prepared-workflow assignment.
Lifecycle checks now import every handler they exercise, with no source slicing
or VM evaluation.
