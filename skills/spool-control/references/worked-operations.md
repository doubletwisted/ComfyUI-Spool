# Worked operations

These examples are building blocks, not instructions to execute every operation.
Use the verified host and IDs for the user's task. Run from the Spool checkout;
keep temporary scripts, before snapshots and command envelopes in a task-specific
scratch folder. Do not save credentials in them.

## HTTP without losing exact integers

The existing CLI covers status, shots, events, focus, commands and comparisons.
For other endpoints, this Python helper uses Spool's own wire implementation.
Save it as `spool_http.py` beside your temporary script. Run that script from the
checkout so the helper resolves the production `spool` package.

```python
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path.cwd()))
from spool.wire import wire, unwire


def request(base, path, body=None, method="GET"):
    payload = json.dumps(wire(body), allow_nan=False).encode() if body is not None else None
    req = Request(base.rstrip("/") + path, data=payload, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=120) as response:
            return unwire(json.load(response))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def save_json(path, value):
    Path(path).write_text(json.dumps(wire(value), ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
```

`request` does not retry. On an error, use commands.md to determine whether the
operation may already have taken effect. `save_json` retains tagged integers,
so its files can safely pass through JavaScript. Parse plain CLI output with
Python before saving it this way.

## Switch a reference file atomically

Upload the requested reference through the raw `/input` endpoint and use its
returned `file`. The following pattern updates the literal and removes
only that binding's competing route in the same save. `BASE`, `PROJECT`, `CLIP`,
`KEY` and `STAGED_FILE` below must come from the task and verified API responses.

For the upload itself, send file bytes with an escaped filename; do not pass
them through the JSON helper:

```python
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

source = Path(SOURCE_PATH)
upload = Request(
    BASE.rstrip("/") + "/spool/api/projects/" + quote(PROJECT, safe="") + "/input",
    data=source.read_bytes(),
    method="POST",
    headers={"Content-Type": "application/octet-stream", "X-Filename": quote(source.name, safe="")},
)
with urlopen(upload, timeout=120) as response:
    STAGED_FILE = json.load(response)["file"]
```

Upload completion does not change the shot. Apply the assignment next:

```python
from urllib.parse import quote
from spool_http import request, save_json
from spool.ledger import authored

path = "/spool/api/projects/" + quote(PROJECT, safe="")
project = request(BASE, path)
save_json("before-source-switch.json", project)
clip = next(c for c in project["document"]["clips"] if c["id"] == CLIP)
binding = next(b for b in clip["bindings"] if b["key"] == KEY)
assert binding.get("asset"), "Use the verified media binding"
clip.setdefault("inputValues", {})[KEY] = STAGED_FILE
clip["shotInputs"] = [s for s in clip.get("shotInputs", []) if s["key"] != KEY]
clip["revision"] = clip.get("revision", 0) + 1
saved = request(BASE, path, {"revision": project["revision"], "document": authored(project["document"])}, "PUT")
save_json("after-source-switch.json", saved)
actual = next(c for c in saved["document"]["clips"] if c["id"] == CLIP)
assert actual["inputValues"][KEY] == STAGED_FILE
assert not any(s["key"] == KEY for s in actual.get("shotInputs", []))
```

Compare the before/after selected takes, trims and unrelated routes. If a 409
occurs, start again from fresh state and reapply this targeted change. A successful
source switch does not authorize generation. For a timeline source, use the
`set_shot_inputs` command with the complete preserved routing list instead.

## Split a shot and prepare an export offline

Fetch a full project and write `snapshot.json` using `save_json`. The Node example
below uses production timeline operations. Save it as `plan-edit.mjs` and run it
from the checkout:

```text
node PATH/plan-edit.mjs PATH/snapshot.json CLIP_ID SEQUENCE_CUT_FRAME RANGE_START RANGE_END PATH/OUTPUT_DIRECTORY
```

```javascript
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

const T = await import(pathToFileURL(path.resolve('ui/timeline.js')));
const L = await import(pathToFileURL(path.resolve('ui/ledger.js')));
const [input, clipId, cutText, startText, endText, output] = process.argv.slice(2);
const [cut, start, end] = [cutText, startText, endText].map(Number);
if (![cut, start, end].every(Number.isInteger)) throw Error('Use integer sequence frames');
const snapshot = JSON.parse(fs.readFileSync(input, 'utf8'));
const doc = structuredClone(snapshot.document);
const row = T.layout(doc).find(r => r.clip.id === clipId);
if (!row) throw Error('Clip not found');
const createdId = randomUUID();
const split = T.splitClip(doc, cut, createdId, clipId);
if (split.error) throw Error(split.error);
if (start < 0 || end <= start || end > T.total(doc)) throw Error('Invalid export range');
const resolution = doc.resolution;
if (!resolution?.width || !resolution?.height) throw Error('Resolve export dimensions first');
fs.mkdirSync(output, {recursive: true});
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
save('edit-request.json', {revision: snapshot.revision, document: L.authored(doc)});
save('export-plan.json', {...T.exportPlan(doc, {start, end}), projectId: snapshot.id,
                           fps: doc.fps, width: resolution.width, height: resolution.height});
save('geometry.json', {createdId, before: T.layout(snapshot.document).map(r =>
  ({id: r.clip.id, start: r.start, end: r.end, in: r.clip.in, out: r.clip.out})),
  after: T.layout(doc).map(r => ({id: r.clip.id, start: r.start, end: r.end,
                                in: r.clip.in, out: r.clip.out}))});
```

This writes plans only; it sends no HTTP requests. Review the geometry, then PUT
`edit-request.json` to the verified project route. Verify the split, lineage,
unchanged total duration and unaffected clips in the saved response. If any
concurrent edit or recipe preparation changes the result, rebuild the export
plan from fresh saved state rather than exporting the stale snapshot.

When export is requested, POST the verified plan to `/spool/api/export?projectId=PROJECT`.
For this explicit range, expected duration is `(RANGE_END-RANGE_START)/fps`.
Inspect the downloaded file and audio as described in editing.md. Do not treat
the written plan or an HTTP response as evidence of a finished, reviewed video.

## Prepare, execute and evaluate a bounded variation

Use a complete command envelope from commands.md. For a strength comparison,
choose `mode:"explore"` and two explicit variants with the verified strength key,
keeping the saved seed fixed. Persist the queue envelope before sending it.

1. Call `prepare_experiment`; verify `takeCount`, resolved seed, changed values
   and intended clip IDs. Preparation does not modify the saved controls.
2. If the plan still matches the user's authorized count/target, create a new
   `queue_experiment` operation at that revision and send it once.
3. On response loss, replay the unchanged queue envelope. Inspect the same
   attempts; do not mint a second batch ID.
4. Follow those attempt IDs through collection. Compare returned media against
   the specific defect or improvement being tested.
5. Record feedback and adopt a result through the editor's **Use take** flow
   only when choosing a result is in scope. Otherwise leave both takes available
   and the original selection unchanged.

For a note-driven task, address its exact open entry only after the relevant
edit or media outcome is verified. Preserve an open note when only submission
was achieved or the result still fails the requested criterion.
