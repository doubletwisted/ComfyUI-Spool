# Commands and project inspection

All paths below are relative to the verified host URL. Escape path IDs and query values. The CLI is a thin HTTP client and performs no hidden editing.

## Read the right view

`GET /spool/api/projects/{project}/status?limit=50&offset=0` returns revision, shot inputs/bindings, selected takes, notes, jobs and recoverable results. Follow `nextOffset` for all shots. Each shot includes at most 50 recent takes; jobs and recovery lists are also bounded. Use `GET /spool/api/projects/{project}` for the full projected document when the task needs exhaustive history, shot routing or timeline geometry.

`python -m spool events PROJECT --url URL --since EVENT_ID --limit 50` reads the event stream. `focus ... --view VIEW_ID` reads a particular editor's transient focus; it may be stale or unavailable. Do not infer the intended clip solely from the first returned shot.

Both CLI `status` and `shot --clip CLIP_ID` return an envelope, not a bare clip:

```json
{"projectId":"project-id","revision":12,"shots":[{"id":"clip-id","inputs":{},"notes":[],"takes":[]}],"audioClips":[],"jobs":[],"nextOffset":null}
```

This abbreviated shape omits other fields. Select the shot by ID within `shots`.
The full project route instead returns `{id,revision,document,recipes,...}`.
Typed edit commands usually return an action result such as `{clipId,action}`
or a note result, not a refreshed project. Re-read state for the next revision.
Prepare returns an experiment plan; queue returns the status envelope.

## Mutation envelope

POST `/spool/api/projects/{project}/commands`, or save UTF-8 JSON and use CLI `command --file`:

```json
{
  "operationId": "a-new-uuid",
  "revision": 12,
  "actor": "agent:spool-control",
  "scope": {
    "projectId": "project-id",
    "clipIds": ["clip-id"],
    "capabilities": ["inputs"]
  },
  "action": "set_inputs",
  "arguments": {"clipId": "clip-id", "values": {"verified-binding-key": 0.65}}
}
```

Replace every placeholder from fresh state. Scope is a command contract, not authentication. Include only needed capabilities and clips. Each new logical operation gets a new UUID; retries retain the exact envelope. Read the response and fetch state to verify the intended effect.

| Action | Capability | Arguments and behavior |
| --- | --- | --- |
| `set_inputs` | `inputs` | `{clipId, values}`; merges literal values by existing binding key. An empty string empties an `optional` media binding. |
| `set_shot_inputs` | `inputs` | `{clipId, inputs}`; replaces the entire routing list, so preserve unrelated entries. |
| `apply_workflow` | `workflow` | `{clipId, workflowVersion}`; uses an existing project recipe as the library does: resets bindings/values to its defaults, sets the recipe's execution target, resets seed behavior to Fixed and removes old shot routing and take setup. Built-in recipes leave media sources empty. |
| `brief` | `edit` | `{text}`; changes the project brief. |
| `feedback` | `feedback` | `{clipId, takeId, verdict}` where verdict is `keep`, `reject`, `revise` or `unrated`; does not select a take. |
| `choose_take` | `choose_take` | `{clipId, takeId}`; puts the take in the edit and, like Use take, shortens the clip to a shorter take (a gap keeps following clips in place). It does not adopt the take's workflow; use the full adoption flow in generation.md for that. |
| `cancel` | `cancel` | `{attemptId}`; scope includes the attempt's clip. Targeted adapter support depends on execution state. |
| `recover_submission` | `recover` | `{attemptId}`; finds an existing owned Deadline submission; does not authorize a new render. |

Obtain binding keys from status or the recipe; do not guess by node label, index or filename. Preserve integer and boolean types. For large seeds, use Python integers with `spool.wire.wire` when sending JSON, or retain the wire tag `{"__spool_int__":"18446744073709551615"}`. Do not round 64-bit seeds through JavaScript `Number`. The CLI handles transport conversion but prints unwrapped JSON integers: parse its stdout with Python, not JavaScript `JSON.parse`. For JavaScript transformations, save the tagged HTTP response instead. The Comfy graph editing path can reject unsafe integer widgets; do not round them to get past validation.

Shot input routing entries use `{key, source, ...}`. All supported picture slots (`image`, `video`, `firstFrame`, `lastFrame`, `reference`) accept `original` or `selected`. A video example is `{key:"verified-key", source:"selected"}` on a binding whose slot is `video`; it bakes the selected take and current trim. Audio also accepts `{key,source:"clip",clipId}` or `{key,source:"track",track:"source"|"music",lane:1}`. Inspect `spool/requests.py` for slot-specific settings before constructing them.

Literal uploaded paths and shot routes for the same key compete. Changing a literal alone does not disable routing. Switch file/routing together in one revision-checked authored save when both must change; worked-operations.md has an example. If using separate typed commands, preserve unrelated routes and read the new revision between them.

## Notes

Read `shots[].notes` or `audioClips[].notes` first. Use capability `notes`, the project ID and explicit clip ID:

- `add_note`: `{clipId, text}`.
- `edit_note`: `{clipId, noteId, expectedText, text}`.
- `address_note`: `{clipId, noteId, expectedText, summary}`.
- `reopen_note`: `{clipId, noteId, expectedText}`; creates a new open entry, preserving historical evidence.

`expectedText` must exactly match the stored entry, not a paraphrase or `noteDraft`. The completion summary states what was verified. Do not address a request for good output based solely on successful queue submission.

## Failures

| Observation | Next action |
| --- | --- |
| Typed command response lost or timed out | Keep the persisted envelope; retry that exact operation ID and payload to resolve acceptance. |
| 409 revision conflict | Read the error and fresh project. Reapply only the intended change with a new operation ID after checking whether the old operation was accepted. |
| Operation ID already used with different payload | Recover the original envelope. Do not turn an uncertain submission into a new batch. |
| 400 validation error before an effect | Correct the named input/source/scope; inspect state before constructing a new operation. Do not classify every 400 as proof of no mutation. |
| Cancellation preflight failed | Same-envelope retry is allowed after the read-only ownership lookup recovers. |
| Cancellation delivery is unconfirmed | Read its durable diagnostic and owned job state. Do not resend with a new ID. |
| Capture/use-take response failed | Re-read project and sidecar: project commit can precede a failed sidecar write. Do not simply replace the revision and repeat. |
| Creation/import/upload/export response lost | Inspect resulting projects, library entries or artifacts. These endpoints have no command operation-ID replay guarantee. |
| Missing file, unavailable host or unsupported graph serialization | Restore the named prerequisite or use the supported editor path; do not substitute another source/target silently. |

HTTP errors normally contain `{error}`; a project conflict can include `{current}`. Transport errors contain no authoritative acceptance result. Never issue global ComfyUI interrupt to cancel a single Spool attempt.
