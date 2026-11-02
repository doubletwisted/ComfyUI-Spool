# Online demo

The online demo is the real studio on GitHub Pages, opened on one recorded
project. Visitors can play the edit, look through takes, trim, move and split
clips, choose takes, delete takes and write notes. Everything that needs Spool
on a computer says so and does nothing: generating takes, Use take, ComfyUI,
import, export and file actions. Reloading the page resets the project.

## How it works

The studio runs unchanged. `pages/build.py assemble` copies `ui/` and rewrites
its absolute `/spool/` paths to the Pages path (for example
`/ComfyUI-Spool/demo/spool/`), so no service worker is needed. The page loads
`pages/demo-api.js` before the studio. It replaces `fetch` for `/spool/api/`
only:

- Reads replay replies recorded from a real Spool: the project, capabilities,
  workflows, templates, take details, media evidence and playback copies. Error
  replies are recorded too, so a take without details fails as it does on a host.
- The project lives in memory. A save (`PUT`) replaces the document and raises
  the revision; a poll with the current `X-Spool-Since` gets the
  revision-and-jobs reply the host sends. Choosing a take is an ordinary save,
  so take review works without anything special.
- Delete takes follows `take_files.plan`: it refuses the take in the edit and
  takes that are not available, then records `deletedTakeIds` and
  `deletedMediaIds`, as the host does, without touching files.
- Every other request gets a 403 with code `demo_unavailable` and a message that
  names ComfyUI and the install page. The studio shows it like any other failed
  request. Use take is declined rather than imitated: it prepares inputs and
  writes sidecars on the host.

Library posters and the inspector's input pictures are images the studio loads
by address, not through `fetch`. The recording saves them as static files at
their API paths. An input name contains an escaped slash (`%2F`), so each is
saved under both the escaped and the unescaped path.

The fake mirrors four host replies: the project, the unchanged-project poll, the
save and take deletion. If one of those routes changes shape, change
`pages/demo-api.js` in the same commit.

## Recording the project

The recording is data, not code. It stays out of Git and is published as
`spool-demo-data.zip` on the `demo-data` release.

1. Copy the project folder somewhere local. Leave out `.spool/previews`,
   `.spool/deadline` and `.spool/backups`, then copy back any previews the
   project still names (the recorder lists them as unavailable).
2. Start a standalone Spool on a free port with its own storage, using a Python
   that has `comfyui_workflow_templates` installed (ComfyUI's own does), and open
   the folder with `POST /spool/api/open-project`. Give it an `--input-root`
   that holds the source pictures the takes' workflows load (for the coral
   project, a copy of ComfyUI's `input/coral-video-src`), or those takes'
   workflows cannot be read.
3. Record:

   ```powershell
   python pages/build.py record --host http://127.0.0.1:PORT --project ID --data DIR --name "Coral Palace"
   ```

   The demo leaves the launch film out of the coral project, which starts at
   the soundtrack's drop. `--leave-out` removes clips by name (pool media no
   remaining clip uses go too), `--move-to-end` appends a clip to V1, and
   `--close-gaps` removes every gap and unmutes the shots' own audio:

   ```powershell
   python pages/build.py record --host http://127.0.0.1:PORT --project ID --data DIR --name "Coral Palace" `
     --leave-out "Film v14 · to the drop" --leave-out "Film v14 · export and end card" `
     --leave-out "Launch film v14 soundtrack" --move-to-end c11 --close-gaps --inputs-like c26
   ```

   Only five coral shots were set up for generation. `--inputs-like c26` gives
   the others the workflow of the take in their edit, as Use take would, with
   c26's inputs (First frame, Prompt, Seed, Duration) filled from that
   workflow, so every shot shows its inputs in the demo.

   These change only the recording, never the project. `--keep-media` records
   the replies again and reuses media already in DIR.

   It asks the host for every playback copy at the project size and waits for
   them. It re-encodes video to 960 pixels wide (H.264, a keyframe every 12
   frames, same frames and timing) and shrinks the posters.

   It also removes this computer from the replies: no Cloud key, no folders, no
   file manager. Values that are whole absolute paths keep only their last two
   parts. If an absolute path remains anywhere else, recording stops and lists
   it; add `--scrub FROM=>TO` pairs for those.
4. Check it locally:

   ```powershell
   python pages/build.py assemble --data DIR --out SITE --base /ComfyUI-Spool/demo/
   python pages/smoke.py --site SITE
   python pages/serve.py --site SITE
   ```

   `serve.py` serves the site under its base path with byte ranges, as Pages
   does, so video seeks.
5. Zip the contents of DIR as `spool-demo-data.zip`, replace the asset on the
   `demo-data` release, and run the **Online demo** workflow by hand.

Record again when the project format or one of the recorded routes changes. The
data has its own format number (`DATA_FORMAT` in `pages/build.py`), and
assembling refuses a mismatch.

## Deploying

`.github/workflows/pages.yml` runs for each published `v*` release and by hand.
It assembles the studio from the commit being built over the downloaded data,
runs `pages/smoke.py`, and deploys to Pages. The smoke check fails the deploy if
the studio does not load the project, or if it asks during startup for a route
the demo does not answer. That is how a studio change that needs a new recorded
reply is caught before visitors see it.

Pages must use **GitHub Actions** as its source (Settings → Pages). The site
root redirects to `demo/`.

## Size

The coral demo records to about 240 MB: playback copies, review copies, input
pictures and posters, for 11 shots and their takes. Pages allows 1 GB per site
and about 100 GB of traffic a month. The browser loads media only when the
studio shows it, so a visit usually costs far less than the whole project.
