# Studio runtime

`spool/editor.py` serves `ui/editor.html` unchanged. That document loads
`ui/bootstrap.js`, which owns the loading/error barrier before importing the
runtime. `ui/editor.js` owns editing state, rendering, gestures, playback,
dialogs and the Comfy bridge in one private initialization scope.

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
