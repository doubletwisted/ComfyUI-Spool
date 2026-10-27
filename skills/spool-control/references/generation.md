# Workflows, generation and review

## Inspect and prepare

Read the clip's recipe, inputs, routing and selected source. `GET /spool/api/workflows/{version}` returns the immutable capture with executable prompt, editable workflow, bindings and chosen result. A valid recipe must name the intended output; a random save node is not sufficient. Separate a requested parameter change from a request to generate: saving a prompt or seed alone must not queue a take.

Saved execution routing may target local ComfyUI, Cloud or Deadline. Check host capabilities and the recipe/clip target before submitting. Deadline launcher nodes may determine routing. Do not substitute another target or paid service when one is unavailable.

For a source check, POST `/spool/api/projects/{project}/generation-preview` with `{revision, clipId}`. It can bake media through ffmpeg but does not queue a model render. Verify required local files, source choice, trim and output contract. A missing source is a preparation problem, not a reason to clear routing silently.

## Bounded experiments

Use the envelope in commands.md with capability `queue` and explicit `maxTakes` and `maxConcurrent`. `maxConcurrent` is an outstanding-job limit at submission; a batch exceeding it is rejected, not automatically scheduled in waves.

```json
{
  "action": "prepare_experiment",
  "arguments": {
    "mode": "repeat",
    "intent": "Two takes of the approved shot",
    "variants": [{"clipId": "clip-id", "count": 2}]
  }
}
```

This is the action/arguments portion, not a complete command. Preparation returns resolved values, differences and take count without queueing. It does not guarantee all execution-time compatibility or finish asset baking. To execute an authorized plan, create a complete `queue_experiment` envelope at the current saved revision and persist it before sending. Reuse that exact envelope after uncertain responses.

`repeat` uses saved inputs and rejects variant overrides. `explore` accepts `values` keyed by bound literal controls. Each variant has `count` from 1 to 16; there can be 1 to 100 explicit variants. Include optional `shotInputs` only when deliberately overriding routing. Seeds in repeat do not automatically advance as an editor seed-mode convenience might; specify intended seed variants explicitly in explore.

Poll status/events at a bounded cadence (for example every few seconds while active, backing off when waiting for a host). Track the returned attempt IDs rather than whichever jobs appear last. If the status window omits them, GET `/spool/api/attempts/{attempt}` for the individual record and verify its `project_id` and `clip_id`. Stop monitoring when all requested attempts are terminal or a failure needs intervention; do not spin indefinitely through uncertainty. Results attach as takes and preserve the current selection and trims.

For an iteration, state which observed defect the next input change addresses. Keep a seed fixed when comparing another control, or explicitly vary seeds when exploring alternatives. Do not silently change requested fractional values to integers, substitute a model, expand the take count or change execution target to make a failed request succeed.

## Review and adopt

Use CLI `compare PROJECT --url URL --clip CLIP --takes TAKE_A TAKE_B`, or POST `/spool/api/projects/{project}/comparison` with `{clipId,takeIds}` (1-12 distinct takes). The result is `{url,takes:[{takeId,sampleFrame,...}],note}`: a contact sheet of representative original frames, not a video comparison. Fetch its relative URL from the same host.

Compare against the user's criteria, not an unexplained overall score:

- Subject, identity, framing and requested action match the brief.
- Start/end frames and movement fit the adjacent shots and intended cut.
- Playback shows acceptable temporal consistency, without unwanted freezes, flashes or warping.
- Duration, dimensions and frame interpretation fit the edit.
- If sound matters, listen for timing, intelligibility, levels and cut/fade continuity.

Inspect start, middle, end and suspect moments, and watch motion for a motion-quality claim. A contact sheet cannot prove temporal or audio quality. Record useful feedback with concrete observations, then adopt only within the user's selection authority. If none meet the brief, say so and preserve the current take; another batch still needs remaining authorized budget.

`GET /spool/api/projects/{project}/take-file/{clip}/{take}` downloads a take's original. `GET /spool/api/projects/{project}/media/{media}/evidence` reads provenance. `POST /spool/api/projects/{project}/frame` with `{mediaId,frame}` exports a source frame. Preserve result evidence; feedback is separate from adoption.

Prefer the editor's **Use take** flow for full adoption. It resolves the take workflow, prepares bindings/output through `ui/workflow-setup.js`, and adjusts trim geometry. `GET /spool/api/projects/{project}/take-workflow/{clip}/{take}` returns a capture or null, but the returned capture is not always ready to POST: the non-sidecar resolver intentionally removes bindings, which the editor rebuilds. Posting it directly can leave the new recipe without exposed controls.

If automating the backend adoption, follow the current `takeWorkflowCapture` and `createWorkflowSetup` paths. `sidecar.needsSerialization` requires live Comfy serialization; preserve the sidecar hash and `provenance.takeBase` through preparation. Only then POST `/spool/api/projects/{project}/use-take/{clip}` with `{revision,takeId,capture}`. A null capture deliberately clears the previous executable recipe and input values. Adoption also clears old shot routing; verify the new generation setup and adjusted trims. A shorter take can create a compensating gap. Do not invent capture provenance or bypass a stale-sidecar error. The typed `choose_take` command only selects an ID; it does not reproduce this preparation or trim behavior.

## Import or edit a workflow

POST raw workflow JSON to `/spool/api/projects/{project}/import-workflow`, with `X-Filename` and `X-Spool-Revision`. This imports a library item; it does not generate or necessarily assign it to a clip. Apply an existing project recipe with `apply_workflow` only after accounting for its input/routing reset.

For graph authoring, use Spool **Edit in Comfy**, edit the saved original graph, then **Apply to clip**. Saving the graph alone does not apply it to the clip. Preserve groups, nested graphs, chosen outputs and verified bindings. Graph-only JSON requires ComfyUI's real serialization; do not infer an executable prompt from arbitrary widget arrays. Ordinary workflows require no new Spool nodes or graph rewrites.

Advanced capture uses `/spool/api/projects/{project}/capture/{clip}` with `{revision,capture,...}`. Read `spool/routes.py` and the current editor handler before using optional fields. Captures are immutable versions; do not mutate an existing recipe record.

## Recovery

Read jobs, events and recoverable results before resubmitting. `recover_submission` resolves a Deadline submit whose job identity was uncertain. Cancellation preflight failures can be retried with the same envelope. Once a cancellation send has been claimed, an uncertain external response is not safe to repeat blindly. Report the recorded diagnostic and inspect owned adapter state. Never delete receipts to force another take or auto-select a late result.
