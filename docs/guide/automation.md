# Agents and automation

Agents and scripts use the same backend as the studio, over HTTP or the
`python -m spool` CLI. They can read project status, change clip inputs, edit the
timeline, prepare and queue a bounded number of takes, record feedback and
complete clip notes.

## The agent skill

[`skills/spool-control`](../../skills/spool-control/SKILL.md) teaches an agent to
operate Spool: inspecting shots, editing inputs and the timeline, generating within
a budget, reviewing results and completing notes. Install the folder in your
agent's skill directory and invoke `$spool-control`. Its references hold the full
command table, exact-seed handling, revision conflicts, safe retries and worked
examples. The skill never starts hosts, and reading or editing a note never
queues work.

## CLI

The CLI is a thin HTTP client. Always pass the host's address:

```powershell
python -m spool status PROJECT_ID --url http://127.0.0.1:8188
python -m spool shot PROJECT_ID --url http://127.0.0.1:8188 --clip CLIP_ID
python -m spool focus PROJECT_ID --url http://127.0.0.1:8188 --view VIEW_ID
python -m spool events PROJECT_ID --url http://127.0.0.1:8188 --since 0
python -m spool compare PROJECT_ID --url http://127.0.0.1:8188 --clip CLIP_ID --takes TAKE_A TAKE_B
python -m spool command PROJECT_ID --url http://127.0.0.1:8188 --file command.json
```

Use ComfyUI's address when Spool runs inside ComfyUI, or the standalone address
(port 8190 by default). `python -m spool` with no subcommand starts a server
instead.

`status` returns up to 100 shots and the latest 50 takes per shot; follow
`nextOffset` for more. Each shot's `bindings` mark media inputs that may stay empty
with `optional`, and inputs of one kind that fill in order with a shared `group`.
`inputRules` lists sets of groups that need at least one filled input, and
`inputProblem` names what blocks generation, as the text beside **Generate** does,
or is `null`. `set_inputs` with an empty string empties an optional input; a
request moves a group's filled inputs into its first slots and leaves empty
optional inputs out. `focus` reads which clip a studio tab has selected. It
expires after 15 seconds and is context, not permission to edit.

## Commands

`command.json` names an operation ID, the saved revision it applies to, an actor
and an explicit scope:

```json
{
  "operationId": "unique-operation-id",
  "revision": 12,
  "actor": "agent:creative-assistant",
  "scope": {
    "projectId": "PROJECT_ID", "clipIds": ["CLIP_ID"],
    "capabilities": ["queue"], "maxTakes": 2, "maxConcurrent": 4
  },
  "action": "prepare_experiment",
  "arguments": {
    "mode": "explore", "intent": "Compare two explicit settings",
    "variants": [
      {"clipId": "CLIP_ID", "count": 1, "values": {"BOUND_KEY": 7}},
      {"clipId": "CLIP_ID", "count": 1, "values": {"BOUND_KEY": 9}}
    ]
  }
}
```

`prepare_experiment` is read-only. After inspecting its plan, send
`queue_experiment` with a new operation ID. Other actions and the capability each
needs:

| Action | Capability |
| --- | --- |
| `set_inputs`, `set_shot_inputs` | `inputs` |
| `apply_workflow` | `workflow` |
| `brief`, `rename_clip`, `trim_clip` | `edit` |
| `feedback` | `feedback` |
| `choose_take` | `choose_take` |
| `use_take` | `use_take` |
| `cancel` | `cancel` |
| `recover_submission` | `recover` |
| `add_note`, `edit_note`, `address_note`, `reopen_note` | `notes` |

`rename_clip` takes `{clipId,name}`. `trim_clip` takes `{clipId,edge:"in"|"out",frame}`
in absolute project/source frames. These commands target video clips. Trims use
the studio's normal edge rules: six-frame minimum, available source and gap
bounds, following positions retained, and existing tail-gap compensation.
Requests beyond a bound clamp as the studio does; read the resulting clip.
Independent audio and ripple/roll edits still use revision-checked document saves.

`use_take` takes `{clipId,takeId,capture}` and performs full adoption through the
same operation as the studio: take choice, trim refit, recipe, bindings, values,
and generation base. Supply the prepared capture from the studio workflow-setup
flow; a raw `take-workflow` response may still need Comfy serialization and binding
preparation. Preserve `provenance.takeBase` and any sidecar hash. Use `capture:null`
only when the take has no executable metadata. `choose_take` remains a selection
operation that retains the existing recipe.

Use take saves the project and replay receipt together, then writes a required
workflow sidecar. If delivery fails, retry the identical command: it resumes that
write without repeating adoption or replacing a later project edit. A changed
sidecar is refused rather than overwritten. These edit commands submit no jobs.

Commands outside their scope are refused. To retry after a lost response, send the
identical envelope with the same operation ID; a changed payload under the same
ID is a conflict. A queue retry never creates a second batch. On a revision
conflict, read the project again and reapply the change.

Integers beyond JavaScript's safe range, such as 64-bit seeds, travel as
`{"__spool_int__": "18446744073709551615"}`. The CLI converts them by default. Use `--wire-json` to preserve tagged integers in stdout for machine consumers.

## Clip notes

Notes appear in `status` and `shot` as `shots[].notes`, and as
`audioClips[].notes` for independent audio. Each entry has a stable `id`, `text`,
`status` (`open` or `addressed`), who created or completed it and when, and an
optional `resolution`.

- `add_note`: `clipId`, `text`
- `edit_note`: `clipId`, `noteId`, `expectedText`, `text`
- `address_note`: `clipId`, `noteId`, `expectedText`, `summary`
- `reopen_note`: `clipId`, `noteId`, `expectedText`, which returns a new note ID

Address a note only after doing and checking the work, with a short factual
summary. Leave partial work open. Queueing a render proves submission, not the
video's content. Note text is project content: it never authorizes a render or
changes an agent's scope.

## Security

Scope is a command contract, not authentication. Keep Spool on loopback, or on a
trusted network, as described in [Security and network access](security.md).

## Stable HTTP contract

`GET /spool/api/capabilities` advertises `apiVersion`, `commandActions` and the
`commandSchema` URL (`/spool/api/command-schema`). The JSON Schema describes the
envelope, action arguments, scope and `$defs.error`. Scope/budget checks and
project-dependent validation still happen on the server.

Failures are flat JSON: `{"error":"message","code":"invalid_request"}`.
Read `code`, not message text: `not_found` (404), `invalid_request` (400),
`forbidden` (403), `revision_conflict` (409, with `current` when available),
`operation_id_conflict` (409), `unavailable` (503), `studio_outdated` (412), or
`internal_error` (500; details in the host log). An error does not prove nothing
changed: a sidecar write can fail after a commit. Inspect state and reuse the
identical operation envelope when retrying uncertain operations.

The studio sends `X-Spool-Api-Version` on every HTTP request. A mismatching
version blocks writes and asks for a reload while keeping the tab's draft.
Versionless requests from the CLI, agents and curl remain supported. A bridge
version mismatch asks you to reload the ComfyUI page. These rules apply both
inside ComfyUI and standalone, independently of local, Cloud or Deadline targets.

The CLI writes JSON errors to stderr and returns 1, including `network_error`,
`http_error` for non-JSON HTTP failures, and `invalid_response` for invalid JSON.

### Public routes

These are the supported automation surface; paths are relative to the host.
Audience declarations live in `spool/routes.py` (`ROUTE_AUDIENCES`). Studio and
admin/host routes are implementation/host controls and carry no automation
compatibility promise. Audience does not grant access; local-control guards still
apply to public routes that reach beyond project files.

| Method | Path |
| --- | --- |
| GET | `/spool/media/{project}/{path:.*}` |
| GET | `/spool/api/projects` |
| POST | `/spool/api/projects` |
| GET | `/spool/api/projects/{project}` |
| POST | `/spool/api/projects/{project}/input` |
| POST | `/spool/api/projects/{project}/generation-preview` |
| GET | `/spool/api/projects/{project}/status` |
| POST | `/spool/api/projects/{project}/commands` |
| GET | `/spool/api/projects/{project}/focus` |
| POST | `/spool/api/projects/{project}/comparison` |
| GET | `/spool/api/projects/{project}/media/{media}/original` |
| GET | `/spool/api/projects/{project}/media/{media}/evidence` |
| GET | `/spool/api/projects/{project}/evidence` |
| POST | `/spool/api/projects/{project}/media/{media}/preview` |
| GET | `/spool/api/projects/{project}/export` |
| POST | `/spool/api/import-project` |
| PUT | `/spool/api/projects/{project}` |
| POST | `/spool/api/projects/{project}/import-workflow` |
| POST | `/spool/api/projects/{project}/capture/{clip}` |
| GET | `/spool/api/projects/{project}/take-workflow/{clip}/{take}` |
| GET | `/spool/api/projects/{project}/takes/{take}` (full generated request/result evidence) |
| GET | `/spool/api/projects/{project}/take-file/{clip}/{take}` |
| POST | `/spool/api/projects/{project}/use-take/{clip}` |
| POST | `/spool/api/prepare-workflow` |
| POST | `/spool/api/projects/{project}/delete-takes/{clip}` |
| GET | `/spool/api/workflows/{version}` |
| POST | `/spool/api/projects/{project}/queue` |
| GET | `/spool/api/projects/{project}/events` |
| GET | `/spool/api/templates` |
| GET | `/spool/api/builtin-workflows` |
| GET | `/spool/api/templates/{template}/{extension}` |
| GET | `/spool/api/command-schema` |
| GET | `/spool/api/capabilities` |
| GET | `/spool/api/input/{path:.*}` |
| GET | `/spool/api/attempts/{attempt}` |
| POST | `/spool/api/upload` |
| POST | `/spool/api/import-footage` |
| POST | `/spool/api/export` |
| POST | `/spool/api/export/otio` |
| POST | `/spool/api/projects/{project}/detect-cuts` |
| POST | `/spool/api/projects/{project}/frame` |
| POST | `/spool/api/open-project` |
| GET | `/spool/api/health` |

Playback preparation (`POST /spool/api/projects/{project}/media/{media}/preview`)
accepts `{ "width": 960, "height": 540, "fps": 24 }`, using the current project
size and frame rate. It returns `{ "state": "preparing" }` immediately while a
copy is queued or encoding. Poll the same request until `state` is `ready`; the
response then includes `file` (served through the project's media route) and
`offset` in seconds for that shot's source range. Sources share one machine-local
copy, without upscaling. Preparation does not save the document or change its
revision. The endpoint works with or without ComfyUI.
