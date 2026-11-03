# Online demo

The online demo is the real studio on GitHub Pages, opened on one recorded
project. Visitors can play the edit, look through takes, trim, move and split
clips, choose takes, Use take, delete takes and write notes. Everything that
needs Spool on a computer says so when clicked and does nothing: generating
takes, ComfyUI, import, export and file actions. Reloading the page resets the
project.

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
- Use take follows `Store.capture`: it puts the take in the edit with the
  studio's own `chooseTake` and adopts the recorded setup of the take. The host
  also freezes input files and writes sidecars; the demo has none.
- Every other request gets a 403 with code `demo_unavailable` and a message that
  names ComfyUI and the install page. The studio shows it like any other failed
  request.

Library posters and the inspector's input pictures are images the studio loads
by address, not through `fetch`. The recording saves them as static files at
their API paths. An input name contains an escaped slash (`%2F`), so each is
saved under both the escaped and the unescaped path.

The fake mirrors five host replies: the project, the unchanged-project poll, the
save, take deletion and Use take. If one of those routes changes shape, change
`pages/demo-api.js` and `tests/demo_api_checks.mjs` in the same commit.

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
     --leave-out "Launch film v14 soundtrack" --move-to-end c11 --close-gaps --inputs-like c26 `
     --overlay c26@10.5 --overlay c43@17.5 --overlay c57@24
   ```

   `--overlay CLIP@SECONDS` moves a clip to V2 at that time, so the demo shows
   a second track. With `--close-gaps`, V1 closes up behind it.

   Only five coral shots were set up for generation. `--inputs-like c26` gives
   the others the workflow of the take in their edit, as Use take would, with
   c26's inputs (First frame, Prompt, Seed, Duration) filled from that
   workflow, so every shot shows its inputs in the demo.

   These change only the recording, never the project. `--keep-media` records
   the replies again and reuses media already in DIR.

   The edit can also be arranged in the demo itself. Edit it in the browser,
   then save what the demo answers for the project from the browser console:

   ```js
   fetch(location.pathname + 'spool/api/projects/ID').then(r => r.blob()).then(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'demo-edit.json'; a.click(); })
   ```

   `--edit demo-edit.json` records that edit instead of the host's, in place of
   the options above. `--max-takes 4` keeps the take in the edit and the latest
   other takes the rail shows, up to four per clip; hidden takes and the media
   of every take left out stay out of the data. The coral demo is recorded
   with both:

   ```powershell
   python pages/build.py record --host http://127.0.0.1:PORT --project ID --data DIR --name "Coral Palace" `
     --keep-media --edit coral-demo-edit.json --max-takes 4
   ```

   It asks the host for every playback copy at the project size and waits for
   them. It re-encodes video to 960 pixels wide (H.264, a keyframe every 12
   frames, same frames and timing) and shrinks the posters.
   Recording stops if a take in the edit has no playback copy, or if a take's
   review or playback copy has fewer frames than the take: a damaged copy on the
   host re-encodes into a clean but shorter video that cannot be scrubbed to its
   end. Rebuild that copy from the take's original and record again.

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
   `demo-data` release, and run the **Online demo** workflow by hand. Wait a
   minute after the upload: a run that starts at once can still download the
   previous asset. Browsers keep the site's files for up to ten minutes, so check
   the result with a hard reload.

## Keeping it current

Each deploy builds the studio from the commit being released, so studio changes
reach the demo with the next release without recording again. Three things
catch the changes that need more:

- The data notes the project schema it was recorded at (`SCHEMA_VERSION` in
  `spool/store.py`). Assembling refuses data from another schema, so a release
  that changes the project format cannot deploy until the demo is recorded
  again.
- The smoke check fails when the studio asks during startup for a route the
  demo does not answer. Record again so the reply is in the data, or answer it
  in `pages/demo-api.js` if it changes the project.
- `tests/demo_api_checks.mjs` runs in the architecture checks and holds the
  mirrored host replies to their shapes.

The data has its own format number too (`DATA_FORMAT` in `pages/build.py`);
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

## Credits

The workflow library's posters in the demo come from Comfy-Org's
`comfyui-workflow-templates` packages, which are MIT licensed.

## Size

The coral demo records to about 130 MB: playback copies, review copies, input
pictures and posters, for 10 shots and up to four takes each. Pages allows 1 GB
per site and about 100 GB of traffic a month. The browser loads media only when
the studio shows it, so a visit usually costs far less than the whole project.
