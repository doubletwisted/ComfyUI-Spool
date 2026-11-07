# Full audit, 2026-11-04

## Summary

A read of the whole repository (backend, studio, Comfy page extension, demo,
launchers, CI and docs) found 44 problems that could be shown to be real. 29 are
fixed on branch `claude/full-audit-2026-11-04-hta0pw`, each in its own commit and
with a regression test where one can run in the gate. 11 need an owner decision,
because the fix would change documented behaviour or a stored format, or because
it is a trade-off. 4 are plausible but could not be confirmed here.

| Severity | Fixed | Needs decision | Unconfirmed | Total |
| --- | --- | --- | --- | --- |
| Critical | 0 | 0 | 0 | 0 |
| High | 6 | 1 | 0 | 7 |
| Medium | 12 | 4 | 0 | 16 |
| Low | 11 | 6 | 4 | 21 |

The most serious problems were:

- **Host files reachable from another machine.** Routes that are not local-only
  could read any image or video on the Spool computer: one was fixed (F-01), the
  larger one needs a decision (N-01).
- **A file write outside the project** from a forged Deadline receipt (F-02).
- **A crashed save rolling back another computer's work** (F-04).
- **Stored XSS** through project IDs and take numbers (F-05).
- **Find existing Deadline job** failing on every call (F-03).

## Methodology

1. Read `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/` and
   `tests/`, then installed the gate's tools as CI does
   (`python -m pip install aiohttp pillow -r requirements.txt -r requirements-dev.txt`
   and `npm ci`) and ran every gate command separately to get a full baseline
   instead of stopping at the first failure.
2. Reviewed the HTTP surface (`spool/routes.py`, local-control guard, entry points,
   CLI) directly, and ran four parallel read-only reviews of persistence, execution
   targets, media/host code and browser JavaScript. Every reported finding was
   re-run or re-read before it was accepted; two candidates were dropped as false
   (a "missing" public route that is documented, and an `executionId` traversal
   that the receipt namespace check already stopped).
3. For each confirmed defect: a failing test or repro first, the smallest fix, the
   test run with and without the fix, then the full gate before the commit.
4. Kept public behaviour and file formats unchanged. Where a fix would change
   either, it is listed under _Needs decision_ instead.

### What could and could not run in this sandbox (Linux, no GPU)

- **Ran:** the full gate (ruff, Prettier, ESLint, knip, `tsc`, every
  `tests/*_checks.mjs` and `tests/test_*.py`), ffmpeg/ffprobe media repros, and a
  standalone `python -m spool` host driven by headless Chromium for the studio XSS
  and media-address checks (live studio evidence, standalone host).
- **Node 22.23** here; the repository and CI use Node 24. All Node checks passed.
- **Not run:** browser checks and live checks against ComfyUI (no ComfyUI install
  or GPU), Deadline and Comfy Cloud (no farm or key; paid checks are opt-in), and
  Windows or macOS. Deadline and Cloud findings use the repository's own fixtures
  with `deadlinecommand` and the Cloud SDK patched: they are mocked results, not
  live evidence. Windows-only findings are marked _review-only_; where the cause
  can be shown on Linux (F-09 with `python -I`, F-21 with `/`) it was.

## Findings

Lines refer to the code before the fix (`main` at `7caf5c9`).

| ID | Severity | Area | Location | Finding | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | High | Security | `spool/routes.py:418`, `:938` | `/comparison` and `/detect-cuts` read takes' originals outside the project for non-local callers | fixed |
| F-02 | High | Security / Deadline | `spool/farm_protocol.py:177`, `spool/farm.py:156` | A receipt's `artifactId` names the ingestion copy's path: file write outside the project | fixed |
| F-03 | High | Deadline | `spool/commands.py:525` | `recover_submission` (**Find existing Deadline job**) raises `UnboundLocalError` on every call | fixed |
| F-04 | High | Data loss | `spool/projects.py:115` | A crashed save's `-journal` is rolled into the fresh working copy, undoing other computers' work | fixed |
| F-05 | High | Security / studio | `ui/timeline-renderer.js:299` and 27 more sinks | Stored XSS through clip/take/media IDs, take and track numbers | fixed |
| F-06 | Medium | Data loss | `spool/store.py:657` | `prune --confirm` deletes previews the edit uses when names hold spaces or non-ASCII | fixed |
| F-07 | Medium | Deadline | `spool/farm.py:130`, `spool/collection.py:76` | A receipt of the wrong JSON shape aborts every scan | fixed |
| F-08 | Medium | Persistence | `spool/store.py:1232` | Each capture re-wraps the packed document until reads hit `RecursionError` | fixed |
| F-09 | High | Launcher (Windows, review-only) | `run_spool.bat:17` | The portable build's `._pth` Python cannot find `spool` with `-m` | fixed |
| F-10 | Medium | Media | `spool/media.py:384`, `:444`, `:459` | An interrupted proxy/poster/waveform encode is reused forever | fixed |
| F-11 | Medium | Export | `spool/export.py:85` | MP4 export fails when the temp path holds an apostrophe | fixed |
| F-12 | Medium | Studio | `ui/take-actions.js:197` | **Delete from disk** replaces an unsaved draft or reports a false conflict | fixed |
| F-13 | Medium | Deadline | `spool/store.py:1158` | A retried farm task's copy becomes a second take | fixed |
| F-14 | Medium | Persistence | `spool/projects.py:342`, `:362` | One unopenable folder stops listing and rendering for every project; failing upgrades back up every tick | fixed |
| F-15 | Medium | Security | `spool/projects.py:54` | Confirmed maintenance trusts a working copy at a predictable shared temp path | fixed |
| F-16 | Low | Concurrency | `spool/projects.py:323`, `:392` | Concurrent create/open/import drop each other's registration | fixed |
| F-17 | Medium | Media | `spool/media.py:139` | Paths are URL-decoded twice (`a%41.mp4` resolves to `aA.mp4`) | fixed |
| F-18 | Medium | Studio | `ui/editor.js:232` | Media addresses are not encoded; a `#` in a file name breaks playback | fixed |
| F-19 | Medium | Cloud | `spool/requests.py:207`, `spool/cloud.py:189` | Cloud renders with an image result are paid for and never collected | fixed |
| F-20 | Low | Media / routes | `spool/media.py:34`, `spool/routes.py:878` | Unreadable media answers 500 and the upload is kept | fixed |
| F-21 | Low | Paths (Windows, review-only) | `spool/media.py:140`, `spool/routes.py:101` | A project at a drive or share root refuses every media path | fixed |
| F-22 | Low | CLI | `spool/cli.py:51` | A missing or invalid `--file` prints a traceback, not the documented JSON error | fixed |
| F-23 | Low | Studio | `ui/exports.js:277` | Timeline export leaks a blob URL per export | fixed |
| F-24 | Low | Media | `spool/media.py:453` | Waveform cache ignores size and mtime: replaced audio keeps its old waveform | fixed |
| F-25 | Low | Startup | `spool/launcher.py:152`, `spool/__main__.py:19`, `spool/maintenance.py:11` | A shallow checkout raises `IndexError` | fixed |
| F-26 | Low | Security | `spool/credentials.py:37` | The Cloud key file is briefly created with umask permissions | fixed |
| F-27 | Low | CLI | `spool/cli.py:58` | `http_proxy` captures CLI requests to 127.0.0.1 | fixed |
| F-28 | Low | Tests | `tests/test_take_files.py:339`, `:360` | Clip-folder tests depend on `xdg-open`; one fails headless, one passes for the wrong reason | fixed |
| F-29 | Low | Docs | `docs/guide/deadline.md:54`, `docs/dev/durable-names.md:27`, `docs/dev/architecture.md:89` | Three docs contradict the code | fixed |
| N-01 | High | Security | `spool/requests.py:292-362`, `spool/routes.py:827` | Generation preview and queue bake host files for non-local callers; the copy is then served | needs-decision |
| N-02 | Medium | Security | `spool/routes.py:183` | DNS rebinding reaches every route that is not local-only | needs-decision |
| N-03 | Medium | Persistence | `spool/projects.py:96` | Snapshot change detection is `(mtime_ns, size)`: stale reads and lost updates on coarse timestamps | needs-decision |
| N-04 | Medium | Media / docs | `spool/routes.py:896`, `spool/media.py:567`, `docs/guide/editing.md:153` | Import by path copies the video, contradicting the guide, and records an absolute path to the copy | needs-decision |
| N-05 | Medium | Media | `spool/media.py:333`, `:371` | Rotated video and EXIF-rotated images report coded, not display, size | needs-decision |
| N-06 | Low | Media | `spool/joins.py:332` | An extension's joined copy keeps the render's audio without retiming it | needs-decision |
| N-07 | Low | Paths | `spool/projects.py:27`, `:258` | Clip output folders collide case-insensitively; a name can end in a space | needs-decision |
| N-08 | Low | Persistence | `spool/store.py:457` | A stored value shaped like `{"__spool_blob__": …}` makes the project unreadable | needs-decision |
| N-09 | Low | CI / supply chain | `.github/workflows/publish.yml:20` | `Comfy-Org/publish-node-action@main` runs unpinned with the registry token | needs-decision |
| N-10 | Low | Demo | `pages/demo-api.js:85` | The demo's delete-takes ignores media-pool and generation-input rules | needs-decision |
| N-11 | Low | Execution | `spool/requests.py:425` | A rejected queue request leaves its frozen input copies behind | needs-decision |
| U-01 | Low | Deadline (review-only) | `spool/farm.py:86` | A submission is timed from attempt creation and may be marked uncertain while still submitting | unconfirmed |
| U-02 | Low | Windows (review-only) | `spool/store.py:771` | A dry-run `prune`/`reclaim` holding `project.spool` open may make a live publish fail | unconfirmed |
| U-03 | Low | Comfy page | `web/template-browser.js:13` | Any loopback origin, on any port, may frame the template chooser and receive the capture | unconfirmed |
| U-04 | Low | Export | `spool/export.py:13` | A fixed 180 s ffmpeg timeout surfaces as a 500 for long exports | unconfirmed |

## Details of fixed findings

Each fix commit names the finding in its message. "Test" names the regression
test; it fails without the fix and passes with it.

**F-01 Comparison and cut detection read outside footage for remote callers.**
`/frame` and `/take-file` refuse footage outside the project and Comfy folders to
non-local callers, as the security guide promises, but `/comparison` and
`/detect-cuts` read the same originals. A client on another machine (or a
DNS-rebound page) could create a project whose take points at
`/home/user/private.png`, request a comparison and download the PNG sheet
(reproduced: 403 from `/frame`, 200 and the image from `/comparison`). Both routes
now apply the same rule. Test: `test_security.RouteGuardTests.test_frames_of_footage_outside_the_project_stay_on_this_computer`.

**F-02 Forged receipt IDs steer the ingestion copy.** `farm_protocol.verify`
checked only that artifact IDs were unique; `Media.result_path` joins them into
the destination. A receipt with `artifactId: "../../../../ESCAPED"` wrote
`ESCAPED.png` outside the store and the attempt completed. Anyone who can write
the farm share could choose the content and the place. Both IDs must now be the
32-hex `uuid4` the worker writes. Test:
`test_farm_protocol…test_receipt_identities_cannot_name_files_outside_the_attempt`.

**F-03 Find existing Deadline job.** `apply()` assigns `attempt` and `submission`
in its cancel branch, which makes both local to the whole function, so the
recover branch read unbound names (`UnboundLocalError` with and without a matching
job). An uncertain Deadline submission could not be resolved. Test:
`test_farm_protocol…test_find_existing_deadline_job_adopts_it_or_reports_still_uncertain`.

**F-04 Stale rollback journal.** The working copy refresh deleted the database and
its `-wal`/`-shm` but not `-journal`. After a writer died mid-transaction, the
journal was rolled into the newly copied snapshot and the next save published a
rolled-back project over another computer's revisions (reproduced with a real
crashed process). Test: `test_project_folders.CrashRecoveryTests`.

**F-05 Stored XSS.** IDs, workflow keys, take numbers and track numbers were joined
into `innerHTML` raw, next to escaped names. Imported projects and shared folders
keep them as written. Live check on a standalone host with headless Chromium: the
unpatched studio ran injected handlers from a clip ID and a take number; patched,
none ran. Inside ComfyUI the studio shares Comfy's origin. Test:
`tests/html_escape_checks.mjs`, a gate check that fails when one of these fields
reaches markup without `esc()` (it reported all 28 sites before the fix).

**F-06 Prune deletes referenced previews.** References were collected by an ASCII
token regex over stored JSON, so `Desert walk-….mp4` and `café-….mp4` (stored as
`café`) never matched and were evicted. Whole decoded JSON strings are now
matched as well. Test: `test_native…test_prune_keeps_referenced_previews_named_with_spaces_or_accents`.

**F-07 Wrong-shape receipts.** `{"artifacts": ["x"]}` raised `TypeError` past the
handlers that catch only `ValueError`/`KeyError`/`OSError`, aborting the scan for
every later receipt and project; the guide promises an invalid receipt cannot hide
a later valid one. Test: `test_farm_protocol…test_receipt_of_the_wrong_shape_does_not_block_a_later_valid_execution`.

**F-08 Capture re-wrapping.** `Store.capture` loaded the packed document with
`json.loads` and saved it, adding one blob layer per capture; after about 990
captures without an ordinary save, reads raised `RecursionError`. Test:
`test_store_interface.RepeatedCaptureTests`.

**F-09 `run_spool.bat` on the portable build (review-only).** A `._pth` file
makes CPython leave the current folder off `sys.path`, so `python -m spool` failed
with "No module named spool". The script now adds the folder and runs the package
with `runpy`. Shown on Linux with an embeddable-style interpreter and with
`python -I`, which has the same effect. Not run on Windows. Test:
`test_launcher.StandaloneScriptTests`.

**F-10 Interrupted encodes.** `describe()` encoded straight to the cache name and
reuses any file there; a timeout left a 4.9 MB truncated MP4 and every later
describe failed. Encodes now go to a unique pending name and are renamed into
place. Test: `test_media.InterruptedEncodeTests`.

**F-11 Apostrophe in the concat list.** `file '<path>'` was written unescaped; with
a temp folder under `O'Brien`, ffmpeg opened a different path. Test:
`test_media.ExportPathTests`.

**F-12 Delete from disk without flushing.** `projectEdit.change()` accepts the
reply when the draft did not change during the request, which replaced an edit
left unsaved after a failed save (mocked transport repro: the retried save wrote
the old name). The action now flushes first, as the other authored actions do;
`flush()` refuses while the draft is unsaved. No gate test: the take actions run
only in browser checks.

**F-13 Retried farm task as a second take.** Collection copies every execution's
primary into the clip folder, but the folder inventory knew only the winning
attempt's artifacts. Every recorded execution's artifacts are now known. Test:
`test_project_folders…test_a_retried_farm_task_does_not_become_a_second_take`.

**F-14 One unopenable folder.** `list`, `project_stores` and `lookup` raised on a
folder in a newer format, stopping the collector, dispatcher and Cloud loop for
all projects; a failing upgrade wrote a full backup on every 2 s scan (10 in
20 s). Such a folder is now listed as unavailable and skipped, with retries backing
off from 5 s to an hour unless its files change. Tests:
`test_project_folders.UnavailableFolderTests`.

**F-15 Shared maintenance cache.** Without a workspace, `prune`/`reclaim
--confirm` used `<tmp>/spool-maintenance/<sha256(folder)>` and trusted its
working copy; a planted database was published into the project. Writable runs now
use a private `mkdtemp` folder, removed afterwards. Test:
`test_project_folders.MaintenanceCacheTests`.

**F-16 Registration race.** `project_folders` was read and written back separately
from worker threads; 8 concurrent imports left 4–6 listed. It is now one
`BEGIN IMMEDIATE` transaction. Test:
`test_project_folders…test_projects_imported_at_once_all_stay_listed` (the race
fails it in most unfixed runs; fixed, it passes every run). Two existing import
tests used `set_setting` as their seam and were pointed at `register_folder`.

**F-17 Double URL decoding.** aiohttp decodes route paths once (including `%2F`);
`contained()` decoded again. `a%41.png` resolved to `aA.png`, and an upload named
`..%252F..%252Foutput%252Fclip%252F…` landed in a clip's output folder. Tests:
`test_uploads…test_upload_names_are_decoded_once`,
`…test_stored_names_holding_a_percent_sign_resolve_to_that_file`.

**F-18 Unencoded media addresses.** `url()` appended project paths unencoded;
an imported `Take #3.png` requested `…/Take ` (400, broken image). Each segment is
now encoded. Live check on a standalone host: 400 before, 200 after. No gate test.

**F-19 Cloud image results.** Freezing accepted SaveImage/PreviewImage for Cloud,
but Cloud collection accepts only video files, so the job rendered (paid) and then
polled as `collection_pending` forever. It is now refused when queued, and the
guide says so. Test: `test_queue_operations…test_cloud_refuses_an_image_result_it_could_never_collect`.

**F-20 to F-29, low.**

- F-20: ffprobe failures are a 400 (still a `SubprocessError` for existing
  handlers), and the upload is deleted. The message no longer carries ffprobe's
  absolute path.
- F-21: containment strips a root's trailing separator.
- F-22: the CLI reports `invalid_request` for an unreadable or invalid
  `--file` (guide and skill updated).
- F-23: the previous timeline blob URL is revoked when an export replaces it.
- F-24: the waveform key includes size and mtime.
- F-25: missing parents mean "not installed under ComfyUI".
- F-26: the key file is created `0600` with `os.open`.
- F-27: the CLI bypasses proxies for loopback hosts.
- F-28: both clip-folder tests stub the file manager.
- F-29: docs corrected.

Tests for F-20 to F-28 are in `test_uploads`, `test_unc_paths.RootFolderTests`,
`test_cli`, `test_media.WaveformCacheTests`, `test_launcher.ShallowCheckoutTests`,
`test_credentials` and `test_take_files`. F-23 has no gate test.

## Needs owner decision

**N-01 (High) Generation preview and queue copy host files for remote callers.**
Repro (`/generation-preview`, open route): create a project whose original take
is any image on the host, capture a one-loader workflow with a shot input, and
request a preview. Spool bakes the file into Comfy's input folder and returns its
name, and `GET /spool/api/input/<name>` (or ComfyUI's own `/view`) serves the
pixels to that caller. The same happens through `/queue` and the command API. A
fix means refusing non-local callers a request that reads an absolute original
outside the project and Comfy folders, which would stop remote collaborators on a
`--listen` host from generating from footage imported by path. Recommendation:
apply the take-download rule (`outside_footage` in `routes.py`) to request
preparation, and document it as a local-only case.

**N-02 (Medium) DNS rebinding.** The host-name check protects only local-only
routes. A page whose name re-resolves to 127.0.0.1 sends matching `Host` and
`Origin`, so it can read and edit projects, queue renders (spending Cloud credits)
and delete takes (reproduced: 200 on list and save, 403 on a local-only route).
ComfyUI's own routes have the same exposure. Refusing a loopback peer that names a
non-loopback host would stop it, but it breaks a same-machine reverse proxy that
preserves `Host`, a setup the security guide recommends.

**N-03 (Medium) Snapshot signatures.** Changes are detected by `(mtime_ns, size)`,
and SQLite snapshots rarely change size. On storage with 1–2 s timestamps (FAT32,
HFS+, some SMB servers) a reader kept revision 300 after 302 was published, and a
second host saved over newer work (simulated; 0 of 300 on ext4). A per-publication
token in `project.json` would fix it, but changes the manifest.

**N-04 (Medium) Import by path.** `docs/guide/editing.md` says this "reads a video
where it is, without copying it", but `keep_input` copies it into
`input/video/`, and the shots record an absolute `originalFile` for that copy, so
the project breaks when the folder is opened from another mount. Decide whether
to reference in place (and fix the copy) or keep the copy, then store a
project-relative path and correct the guide.

**N-05 (Medium) Rotation.** A 64×48 video with a 90° display matrix is described
as 64×48 while every render is 48×64; an EXIF-rotated JPEG likewise. The directing
tools take generation size from these fields. Fixing it changes recorded
`width`/`height` for newly described media.

**N-06 (Low) Joined copy audio.** A 25 fps render in a 24 fps sequence: the plain
take's audio is retimed (5.201 s) but the joined copy copies the stream (5.0 s), so
it drifts up to 0.2 s and ignores the measured shift.

**N-07 (Low) Folder names.** `Intro` and `intro` get separate folders that are one
directory on Windows and macOS, so a dropped file joins both clips. Truncation runs
after stripping, so a name can end in a space; `CONIN$` is not reserved. A fix
changes the folder names of new clips.

**N-08 (Low) Reserved markers.** An authored value equal to
`{"__spool_blob__": "<hash>"}` is read back as a storage reference; the save
commits and then every `get` fails. Escaping or rejecting reserved keys on write
changes what imports accept.

**N-09 (Low) Unpinned publish action.** `publish.yml` runs
`Comfy-Org/publish-node-action@main` with `REGISTRY_ACCESS_TOKEN`. Pin it to a
commit SHA. This was not changed here, because the workflow holds a secret and
publishes releases.

**N-10 (Low) Demo delete-takes.** The host also removes media-pool records that
share the deleted file, and refuses to delete generation inputs; the demo does
neither (demo `["media-b"]`, host `["media-b", "pool-1"]`). Mirror the rules in
`pages/demo-api.js` and `tests/demo_api_checks.mjs`, or document the simplification.

**N-11 (Low) Frozen copies of a rejected request.** Inputs are frozen before later
items are validated; three rejected requests left three copies in
`input/spool-frozen/`. Validating every item before freezing would change the
order in which errors are reported.

## Unconfirmed

- **U-01:** the 30 s uncertainty timer starts at attempt creation, not at
  submission (review-only).
- **U-02:** on Windows, SQLite opens files without delete sharing, so a long
  dry-run report may block a live publish beyond its retry window. Not testable
  here.
- **U-03:** `web/template-browser.js` accepts any loopback origin as its parent.
  It needs ComfyUI to test.
- **U-04:** the exception type is certain; whether real exports exceed 180 s was
  not measured.

## Improvements not done

These are not demonstrated defects:

- **Request fields.** Missing request fields (`data["revision"]`,
  `X-Spool-Revision`) answer 500 `internal_error` instead of 400.
- **Cloud and collection.**
  - The Cloud loop's `gather` has no `return_exceptions`, so one failed observation
    lets the next pass overlap the others.
  - `POST /reconcile` scans alongside the loop without a lock.
  - `DeadlineAdapter.recover`'s `RuntimeError` reaches the route as a 500.
- **Cloud settings.**
  - `COMFY_BASE_URL` accepts `http://` for remote hosts.
  - `key_status` reports `saved` for an empty key file.
- **Leftover files.**
  - `stage_input` leaves its `.partial` file on failure.
  - `collect` uses a fixed `.partial` name.
  - A failed export mux leaves a partial MP4.
  - Comparison PNGs accumulate in `exports/`.
  - `interchange.py` writes with a plain `replace`.
  - Atomic renames never fsync the directory.
- **Media tools.**
  - Windows text-mode subprocesses decode ffmpeg output with the locale code page.
  - `-force_key_frames` for about 1,800 cuts exceeds Windows' command-line limit.
  - `-fps_mode` needs ffmpeg 5.1 or newer, which is not documented.
  - `media._rate` would divide by zero on `0/0`; `timing.rate` is safer.
- **Event loop.** The launcher runs SQLite and file globbing on the event loop.
- **Storage housekeeping.**
  - `ProjectStore.reading()` holds the per-project read lock for the whole read.
  - `blobs` is never garbage-collected.
  - `cancellation_done` opens a writer connection just to read.
  - `derived_storage` reports backups at the root, not `.spool/backups`.
  - `reclaim` can report a negative `reclaimed` value.
- **Import.**
  - `import_project` creates `0700` folders with generic names.
  - A failed import leaves its cache folder behind.
- **Path containment.** `contained()` is lexical: a symlink inside a project folder
  can point outside it.
- **Studio.**
  - The escaping check covers ID, number and track fields; turning the
    reviewer's general concatenation scan into a gate check would cover more.
  - The studio has three copies of `esc`.
  - The flush error shown in the delete dialog says "before queueing or capturing".
- **Demo.** `pages/serve.py` answers an inverted byte range with a negative
  `Content-Length` (local dev tool only).
- **Repository policy.** AGENTS.md keeps outstanding work in GitHub issues. The
  _Needs decision_ items could be filed as issues if this report should not stay
  in the repository.

## Final test run

Baseline on `main` (`7caf5c9`): 80 of 81 gate commands passed. `test_take_files`
failed `test_open_clip_folder_uses_stable_identity_and_supports_empty_shots`
because this sandbox has no `xdg-open` (F-28).

Final run on the branch, after the last commit:

```text
$ python3 tests/run_architecture_checks.py
… 82 commands run (ruff format/check, Prettier, ESLint, knip, tsc,
  editor_contract_checks.py, 35 *_checks.mjs, 40 test_*.py files)
exit 0 — 454 Python tests OK, 8 skipped:
  5 need ComfyUI-Deadline-Plugin checked out beside the Spool checkout
  2 UNC paths are a Windows path form
  1 Windows streaming workaround
real 1m35.7s
```

Environment: Linux, Python 3.13.18, Node 22.23.4, ffmpeg from the distribution,
aiohttp 3.14.5, comfy-sdk 0.5.0.
