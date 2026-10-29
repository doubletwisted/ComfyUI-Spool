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
| `brief` | `edit` |
| `feedback` | `feedback` |
| `choose_take` | `choose_take` |
| `cancel` | `cancel` |
| `recover_submission` | `recover` |
| `add_note`, `edit_note`, `address_note`, `reopen_note` | `notes` |

Commands outside their scope are refused. To retry after a lost response, send the
identical envelope with the same operation ID; a changed payload under the same
ID is a conflict. A queue retry never creates a second batch. On a revision
conflict, read the project again and reapply the change.

Integers beyond JavaScript's safe range, such as 64-bit seeds, travel as
`{"__spool_int__": "18446744073709551615"}`. The CLI converts them.

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
