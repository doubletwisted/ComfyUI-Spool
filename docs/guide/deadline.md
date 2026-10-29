# Deadline (experimental)

Spool can render takes on a Thinkbox Deadline farm through
[ComfyUI-Deadline-Plugin](https://github.com/doubletwisted/ComfyUI-Deadline-Plugin).
Support is experimental: it relies on helper methods inside that plugin, so a
plugin update can need a matching Spool update.

## Setup

1. Install ComfyUI-Deadline-Plugin on the ComfyUI that runs Spool, and its
   Deadline plugin in your repository, as that project describes. Spool finds
   `deadlinecommand` on PATH, in the folder named by `DEADLINE_PATH`, or in
   Deadline 10's default location on Windows, macOS or Linux.
2. Keep the Spool project on storage the workers can read and write, at the same
   path on the workers as on the Spool computer. Spool stages each submission
   inside the project folder and does not use Deadline's path mapping, so a farm
   that mixes macOS and Windows machines is not supported.
3. Select the clip and set **Execute on** to **Deadline** in the inspector. Choose
   the **Pool**, **Group**, **Priority** and **Workers** (a comma-separated list;
   empty means any worker). Pools and groups are the ones ComfyUI read from the
   farm when it started.
4. **Generate**. The inspector names the route as **Deadline**.

**Execute on** offers Deadline only for local workflows, and only when the plugin is
loaded. Without Deadline's client on the computer it is shown as not available.
Spool adds a Submit to Deadline node with these settings to each take's request
when you generate; the clip's workflow does not change, and neither do the
workflows saved with its takes. A clip on Deadline stays there when you give it
another local workflow, and **Local ComfyUI** switches it back while remembering
the settings.

A workflow can instead carry its own **Submit to Deadline** node: click **Edit in
Comfy**, add one and set it up, then **Apply to clip**. Its settings are used and
the clip always renders on Deadline. No changes to the Submit node, the worker
plugin or the repository are needed.

## What happens on the farm

Spool submits one job per take, with execution-only batch and chunk sizes of one;
the saved graph keeps its own settings. Each job carries a standard Deadline
PreTaskScript and tags that identify the Spool submission and take.

On the worker, that script:

- checks the frozen workflow and input files against their recorded size and hash,
- gives every task attempt its own output folder,
- keeps the exact seeds Spool froze,
- copies the outputs and writes a receipt listing them, with their hashes, before
  the task completes.

Job scripts follow Deadline's
[pre- and post-job/task script](https://docs.thinkboxsoftware.com/products/deadline/10.4/1_User%20Manual/manual/job-scripts.html)
contract. Submission files live under
`<project output>/spool-submissions/<submissionId>/` and receipts under
`spool-receipts/`.

## Collecting results

Spool checks each receipt's project, shot, take, submission and job identity, the
reported files, their sizes and their SHA256 hashes. It copies the originals into
the clip's folder before making review media. Then:

- A completed job without a receipt waits for collection.
- An invalid receipt is recorded once and cannot hide a later valid one.
- A retried task stays inspectable but never replaces the accepted result or adds
  a second take.
- Failed or suspended jobs ask for attention in **Renders** and are never
  resubmitted on their own.

**Cancel** cancels an owned job. If the connection drops after
the stop request, use **Cancel** again to retry unconfirmed delivery.
Spool rechecks ownership and the attempt's current status; confirmed deliveries
are not sent again. This never submits another render. If the connection drops after
submission, **Find existing Deadline job** searches for the tagged job instead of
submitting again; several matches need an operator. Progress comes from the
worker's own reports and is not estimated.

## Tested so far

Real farm runs covered CPU image (LoadImage to SaveImage) and video (LoadVideo to
SaveVideo, with audio) jobs, restarts of the coordinating ComfyUI, finishing
while it was offline, and a retried task. Synthetic tests cover out-of-order
arrival, corrupt files, ownership and missing outputs. VHS or custom savers on a
farm, warm workers and simultaneous multi-worker races are untested.

## Older jobs

Pre-release versions of Spool submitted Deadline jobs through a patched Submit node
and worker. Those jobs remain collectable; new installations need no patches.
