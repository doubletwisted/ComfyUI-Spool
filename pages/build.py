"""Build the online demo: a static copy of the studio over a recorded project.

    python pages/build.py record --host http://127.0.0.1:8207 --project ID --data DIR
    python pages/build.py assemble --data DIR --out DIR --base /ComfyUI-Spool/demo/

`record` reads one project from a running Spool and writes its replies and the
media the studio plays to DIR. `assemble` combines DIR with this checkout's
`ui/` into a site that needs no backend: `pages/demo-api.js` answers the
studio's requests in the page. See docs/dev/demo.md.
"""

import argparse
import copy
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FORMAT = 1
# Document keys that name a file the studio loads. Originals (`originalFile`)
# are only opened by host-only routes, so the demo leaves them out.
MEDIA_KEYS = {"file", "poster", "wave"}
MEDIA_PREFIXES = (".spool/", "_playback/", "input/", "output/", "assets/")
ABSOLUTE_PATH = re.compile(r"(?<![A-Za-z])[A-Za-z]:\\\\?[A-Za-z0-9_]|\\\\[A-Za-z0-9_]|(?:^|[\s\"'])/(?:Users|home)/")
DEMO_UNAVAILABLE = "Not in the online demo"


def project_schema():
    """The project schema this checkout of Spool writes (`SCHEMA_VERSION`)."""
    found = re.search(r"^SCHEMA_VERSION = (\d+)$", (ROOT / "spool" / "store.py").read_text(encoding="utf-8"), re.M)
    return int(found.group(1))


def get(host, path, body=None, view=False):
    headers = {"Content-Type": "application/json"}
    if view:
        headers["X-Spool-View"] = "editor"
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(host + "/spool/api/" + path, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as reply:
        return json.loads(reply.read())


def get_or_error(host, path):
    """A reply, or the host's error reply so the demo fails the same way."""
    try:
        return get(host, path)
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read())
        except ValueError:
            body = {"error": error.reason}
        return {"__demoStatus": error.code, "body": body}


def key(method, path):
    return method + " " + path


def media_records(document):
    yield from document.get("media", [])
    for clip in document.get("clips", []):
        for take in clip.get("takes", []):
            if take.get("media"):
                yield take["media"]
    for clip in document.get("audioClips", []):
        if clip.get("media"):
            yield clip["media"]


def media_paths(value, found, field=None):
    if isinstance(value, dict):
        for name, item in value.items():
            media_paths(item, found, name)
    elif isinstance(value, list):
        for item in value:
            media_paths(item, found, field)
    elif isinstance(value, str) and field in MEDIA_KEYS and value.startswith(MEDIA_PREFIXES):
        found.add(value)


def prepare_preview(host, project, media, size):
    deadline = time.monotonic() + 900
    while True:
        value = get(host, f"projects/{project}/media/{urllib.parse.quote(media)}/preview", size, view=True)
        if value.get("state") != "preparing":
            return value
        if time.monotonic() > deadline:
            raise RuntimeError("Playback preparation timed out for " + media)
        time.sleep(1)


WHOLE_PATH = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\|/(?:Users|home|mnt|Volumes)/)[^\n]*$")


def scrub(value, replacements):
    """Replace this computer's paths in recorded text; report any that remain.

    A value that is a whole absolute path keeps only its last two parts, so a
    loader still shows `coral-video-src\\c26.png` without naming the machine.
    """
    if isinstance(value, dict):
        return {name: scrub(item, replacements) for name, item in value.items()}
    if isinstance(value, list):
        return [scrub(item, replacements) for item in value]
    if isinstance(value, str):
        for before, after in replacements:
            value = value.replace(before, after)
        if WHOLE_PATH.match(value):
            separator = "\\" if "\\" in value else "/"
            value = separator.join([part for part in re.split(r"[\\/]", value) if part][-2:])
    return value


def remaining_paths(value, found, where=""):
    if isinstance(value, dict):
        for name, item in value.items():
            remaining_paths(item, found, where + "." + name)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            remaining_paths(item, found, where + f"[{index}]")
    elif isinstance(value, str) and ABSOLUTE_PATH.search(value) and len(value) < 400:
        found.append((where, value))


def demo_edit(document, leave_out, move_to_end, close_gaps, overlay=()):
    """Shape the recorded edit for the demo without touching the real project.

    `leave_out` names video and audio clips to remove; pool media no remaining
    clip uses go with them. `move_to_end` appends video clips to the end of V1.
    `close_gaps` removes every gap, for an edit that no longer follows a
    soundtrack; the shots' own audio is then heard. `overlay` is a list of
    (name, seconds): each clip moves to V2 and starts there, over V1. V1 closes
    up behind it only with `close_gaps`.
    """
    names = {c["name"] for c in document["clips"]} | {c["name"] for c in document.get("audioClips", [])}
    unknown = set(leave_out) | set(move_to_end) | {name for name, _ in overlay}
    if unknown - names:
        raise SystemExit("No clip named " + ", ".join(sorted(unknown - names)))
    removed = [c for c in document["clips"] if c["name"] in leave_out]
    for clip in removed:
        # The next clip on the track keeps its place behind the removed one.
        track = document["clips"][document["clips"].index(clip) + 1 :]
        following = next((c for c in track if c.get("videoTrack", 1) == clip.get("videoTrack", 1)), None)
        if following:
            following["gapBefore"] = following.get("gapBefore", 0) + clip.get("gapBefore", 0) + clip["out"] - clip["in"]
        document["clips"].remove(clip)
    document["audioClips"] = [c for c in document.get("audioClips", []) if c["name"] not in leave_out]
    for name in move_to_end:
        clip = next(c for c in document["clips"] if c["name"] == name)
        document["clips"].remove(clip)
        clip["videoTrack"], clip["gapBefore"] = 1, 0
        last = max((i for i, c in enumerate(document["clips"]) if c.get("videoTrack", 1) == 1), default=-1)
        document["clips"].insert(last + 1, clip)
    if close_gaps:
        for clip in document["clips"]:
            clip["gapBefore"] = 0
        document["tailGap"], document["videoTailGaps"] = 0, {}
        document["audioTracks"]["sourceMuted"] = False
    if overlay:
        fps, end = document.get("fps", 24), 0
        for name, seconds in sorted(overlay, key=lambda item: item[1]):
            clip = next(c for c in document["clips"] if c["name"] == name)
            start = round(seconds * fps)
            if start < end:
                raise SystemExit(f"{name} would start at {seconds}s, before the V2 clip ahead of it ends")
            document["clips"].remove(clip)
            clip["videoTrack"], clip["gapBefore"] = 2, start - end
            document["clips"].append(clip)
            end = start + clip["out"] - clip["in"]
    if leave_out:
        prune_media(document)
    tracks = [c.get("videoTrack", 1) for c in document["clips"]]
    document["videoTracks"] = max(tracks, default=1)
    document["videoTailGaps"] = {k: v for k, v in document.get("videoTailGaps", {}).items() if int(k) in tracks}
    length = max(
        (sum(c.get("gapBefore", 0) + c["out"] - c["in"] for c in document["clips"] if c.get("videoTrack", 1) == track))
        for track in set(tracks) or {1}
    )
    document["exportRange"] = {"start": 0, "end": length}


def prune_media(document):
    """Leave out pool media that no clip or take in the edit uses."""
    used = {
        value
        for item in document["clips"] + document.get("audioClips", [])
        for media in [item.get("media", {})] + [t.get("media", {}) for t in item.get("takes", [])]
        for value in (media.get("id"), media.get("originalFile"))
        if value
    }
    document["media"] = [m for m in document.get("media", []) if {m.get("id"), m.get("originalFile")} & used]


def use_edit(current, path):
    """Record the edit saved from a demo page instead of the host's.

    The file is what the demo answers for the project (saved in the browser; see
    docs/dev/demo.md). Its edit fields replace the host's; records such as jobs
    stay the host's, and its recipes join the host's.
    """
    saved = json.loads(Path(path).read_text(encoding="utf-8"))
    fields = json.loads((ROOT / "tests" / "fixtures" / "document_fields.json").read_text(encoding="utf-8"))["edit"]
    edit, document = saved.get("document", saved), current["document"]
    for field in fields:
        if field in edit:
            document[field] = edit[field]
        else:
            document.pop(field, None)
    current["recipes"] = {**(current.get("recipes") or {}), **(saved.get("recipes") or {})}
    prune_media(document)


def limit_takes(document, most):
    """Keep at most `most` takes per clip: the take in the edit and the latest
    others the take rail shows. Hidden takes go, so their media do too."""
    for clip in document["clips"]:
        hidden = set(clip.get("hiddenTakeIds") or [])
        shown = [t for t in clip["takes"] if t["id"] != clip.get("takeId") and t["id"] not in hidden]
        kept = {clip.get("takeId")} | {t["id"] for t in shown[max(0, len(shown) - (most - 1)) :] if most > 1}
        if len(kept & {t["id"] for t in clip["takes"]}) < len(clip["takes"]):
            clip["takes"] = [t for t in clip["takes"] if t["id"] in kept]
            clip.pop("hiddenTakeIds", None)
            print(f"Kept {len(clip['takes'])} takes of {clip['name']}", flush=True)


def overlay_spec(value):
    name, _, seconds = value.rpartition("@")
    try:
        return name, float(seconds)
    except ValueError:
        raise SystemExit(f"--overlay takes CLIP@SECONDS, not {value!r}") from None


def give_inputs(current, replies, project, model_name):
    """Set up shots that have no inputs the way `model_name` is set up.

    Each shot takes the workflow of the take in its edit, as Use take would, and
    the model shot's inputs where its own workflow has the same nodes. Values
    come from the shot's own workflow. The demo shows these shots ready to
    generate; the recorded project is not changed.
    """
    document, recipes = current["document"], current.setdefault("recipes", {})
    model = next((c for c in document["clips"] if c["name"] == model_name), None)
    if not model or not model.get("bindings"):
        raise SystemExit("--inputs-like needs a clip with inputs: " + model_name)
    model_prompt = recipes[model["workflowVersion"]]["prompt"]
    for clip in document["clips"]:
        if clip.get("bindings"):
            continue
        path = f"projects/{project}/take-workflow/{urllib.parse.quote(clip['id'])}/{urllib.parse.quote(clip['takeId'])}"
        capture = replies.get(key("GET", path))
        if not isinstance(capture, dict) or "__demoStatus" in capture or not capture.get("prompt"):
            print("No workflow to set up", clip["name"], file=sys.stderr)
            continue
        prompt = capture["prompt"]
        bindings = [
            copy.deepcopy(b)
            for b in model["bindings"]
            if prompt.get(b["nodeId"], {}).get("class_type") == model_prompt[b["nodeId"]]["class_type"]
            and b["input"] in prompt[b["nodeId"]].get("inputs", {})
        ]
        if len(bindings) != len(model["bindings"]):
            print("Different workflow, left as is:", clip["name"], file=sys.stderr)
            continue
        version = str(uuid.uuid5(uuid.NAMESPACE_URL, "spool-demo/" + clip["id"] + "/" + clip["takeId"]))
        capture = {**capture, "bindings": bindings}
        recipes[version] = capture
        replies[key("GET", "workflows/" + version)] = capture
        clip.update(
            workflowVersion=version,
            bindings=bindings,
            inputValues={b["key"]: prompt[b["nodeId"]]["inputs"][b["input"]] for b in bindings},
            generationBase=(capture.get("provenance") or {}).get("takeBase")
            or {"takeId": clip["takeId"], "source": "Embedded take metadata"},
        )
        print("Set up", clip["name"], "like", model_name, flush=True)


def record(args):
    host, project, data = args.host.rstrip("/"), args.project, Path(args.data)
    if data.exists() and not args.keep_media:
        shutil.rmtree(data)
    (data / "api").mkdir(parents=True, exist_ok=True)
    replies = {}

    def keep(method, path, value):
        replies[key(method, path)] = value

    current = get(host, f"projects/{project}", view=True)
    document = current["document"]
    overlay = [overlay_spec(value) for value in args.overlay]
    if args.leave_out or args.move_to_end or args.close_gaps or overlay:
        demo_edit(document, args.leave_out, args.move_to_end, args.close_gaps, overlay)
    if args.edit:
        use_edit(current, args.edit)
    if args.max_takes:
        limit_takes(document, args.max_takes)
    keep("GET", f"projects/{project}", current)
    for path in ("capabilities", "builtin-workflows", "templates", "comfy"):
        keep("GET", path, get(host, path))

    versions = {c.get("workflowVersion") for c in document["clips"]} | set(current.get("recipes") or {})
    for clip in document["clips"]:
        for take in clip.get("takes", []):
            if take.get("placeholder"):
                continue
            path = f"projects/{project}/takes/{urllib.parse.quote(take['id'])}"
            keep("GET", path, get_or_error(host, path))
            # Use take reads the take's workflow before it puts the take in the edit.
            path = f"projects/{project}/take-workflow/{urllib.parse.quote(clip['id'])}/{urllib.parse.quote(take['id'])}"
            keep("GET", path, get_or_error(host, path))
            versions.add((take.get("batch") or {}).get("workflowVersion"))
    for version in sorted(v for v in versions if v):
        path = "workflows/" + urllib.parse.quote(version)
        keep("GET", path, get_or_error(host, path))
    if args.inputs_like:
        give_inputs(current, replies, project, args.inputs_like)

    size = {**document["resolution"], "fps": document["fps"]}
    records = {m["id"]: m for m in media_records(document) if m.get("id")}
    for index, (identity, media) in enumerate(sorted(records.items()), 1):
        if media.get("kind") in ("video", "image"):
            print(f"Preparing playback {index}/{len(records)}: {media.get('name')}", flush=True)
            path = f"projects/{project}/media/{urllib.parse.quote(identity)}/preview"
            keep("POST", path, prepare_preview(host, project, identity, size))
        path = f"projects/{project}/media/{urllib.parse.quote(identity)}/evidence"
        keep("GET", path, get_or_error(host, path))

    # Host facts the studio reads, made neutral: no key, no folders, no Comfy.
    for name in ("capabilities", "comfy"):
        value = replies[key("GET", name)]
        value.update({"hasApiKey": False, "apiKeySource": None})
        value.pop("sessionId", None)
    replies[key("GET", "capabilities")].update({"clipFolderReveal": False, "fileManager": None})
    replies[key("GET", "comfy")]["startupFiles"] = []
    current["folder"] = ""
    if args.name:
        current["document"]["project"] = args.name

    found = set()
    for reply in replies.values():
        media_paths(reply, found)
        if isinstance(reply, dict) and isinstance(reply.get("file"), str):
            found.add(reply["file"])
    replacements = [tuple(pair.split("=>", 1)) for pair in args.scrub]
    replies = scrub(replies, replacements)
    left = []
    remaining_paths(replies, left)
    for where, text in left:
        print("Local path left in", where + ":", text[:160], file=sys.stderr)
    if left and not args.allow_paths:
        raise SystemExit("Recorded replies still name local paths; add --scrub FROM=>TO pairs")

    media_root = data / "media"
    if args.keep_media and media_root.is_dir():
        for stale in [f for f in media_root.rglob("*") if f.is_file()]:
            if stale.relative_to(media_root).as_posix() not in found:
                stale.unlink()
    for index, relative in enumerate(sorted(found), 1):
        target = media_root / relative
        if args.keep_media and target.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        address = host + "/spool/media/" + urllib.parse.quote(project) + "/" + urllib.parse.quote(relative)
        try:
            with urllib.request.urlopen(address, timeout=300) as reply, target.open("wb") as out:
                shutil.copyfileobj(reply, out)
        except urllib.error.HTTPError as error:
            target.unlink(missing_ok=True)
            print("Media unavailable on the host:", relative, error.code, file=sys.stderr)
            continue
        if target.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv") and not args.keep_video:
            shrink(target, args.video_width)
        print(f"Media {index}/{len(found)}: {relative} {target.stat().st_size // 1024} KiB", flush=True)

    record_static(host, current, replies, data / "static")
    (data / "api" / "replies.json").write_text(json.dumps(replies, separators=(",", ":")), encoding="utf-8")
    manifest = {
        "format": DATA_FORMAT,
        "schema": project_schema(),
        "project": project,
        "recorded": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (data / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(f.stat().st_size for f in data.rglob("*") if f.is_file())
    print(f"Recorded {len(replies)} replies and {len(found)} files, {total / 2**20:.1f} MiB", flush=True)


INPUT_FILE = re.compile(r"\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|flac)$", re.IGNORECASE)


def input_names(value, found):
    if isinstance(value, dict):
        for item in value.values():
            input_names(item, found)
    elif isinstance(value, list):
        for item in value:
            input_names(item, found)
    elif isinstance(value, str) and INPUT_FILE.search(value) and not WHOLE_PATH.match(value):
        found.add(value)


def record_static(host, current, replies, root):
    """Files the studio loads by address, as images, rather than through fetch:
    workflow library posters and the inspector's input pictures."""
    wanted = {}
    ids = [t["id"] for t in replies[key("GET", "templates")]] + list(
        replies[key("GET", "builtin-workflows")]["templates"]
    )
    for template in ids:
        wanted["templates/" + urllib.parse.quote(template, safe="") + "/webp"] = "poster"
    names = set()
    for clip in current["document"]["clips"]:
        input_names(clip.get("inputValues"), names)
    input_names(current.get("recipes"), names)
    for name in names:
        wanted["input/" + urllib.parse.quote(name, safe="")] = "input"
    for path, kind in sorted(wanted.items()):
        try:
            with urllib.request.urlopen(host + "/spool/api/" + path, timeout=120) as reply:
                body = reply.read()
        except urllib.error.HTTPError:
            continue
        if kind == "poster":
            body = small_poster(body)
        elif path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            body = small_picture(body)
        # Pages may or may not decode an escaped slash, so both spellings exist.
        for spelling in {path, urllib.parse.unquote(path)}:
            target = root / "spool" / "api" / spelling
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        print(f"Static {path} {len(body) // 1024} KiB", flush=True)


def small_picture(body, width=960):
    """Input pictures show as inspector thumbnails; full-size PNGs are ~10 MB."""
    import io

    from PIL import Image

    with Image.open(io.BytesIO(body)) as image:
        if image.width <= width:
            return body
        format = image.format
        small = image.resize((width, max(2, round(image.height * width / image.width))), Image.LANCZOS)
        out = io.BytesIO()
        small.save(out, format, optimize=True)
        return out.getvalue() if out.tell() < len(body) else body


def small_poster(body, width=320):
    """Library posters are animated WebP of up to 2 MB; the demo keeps them small."""
    import io

    from PIL import Image, ImageSequence

    with Image.open(io.BytesIO(body)) as image:
        height = max(2, round(image.height * width / image.width))
        frames = [
            frame.convert("RGB").resize((width, height), Image.LANCZOS) for frame in ImageSequence.Iterator(image)
        ]
        durations = [frame.info.get("duration", 100) for frame in ImageSequence.Iterator(image)]
        out = io.BytesIO()
        frames[0].save(out, "WEBP", save_all=True, append_images=frames[1:], duration=durations, loop=0, quality=55)
        return out.getvalue() if out.tell() < len(body) else body


def shrink(path, width):
    """Re-encode for the web: same frames and timing, smaller picture, seekable."""
    temporary = path.with_name(path.stem + ".demo" + path.suffix)
    command = [
        "ffmpeg", "-v", "error", "-y", "-i", str(path),
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", f"scale='min({width},iw)':-2",
        "-c:v", "libx264", "-preset", "medium", "-crf", "27", "-pix_fmt", "yuv420p", "-g", "12",
        "-fps_mode", "passthrough",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart", str(temporary),
    ]  # fmt: skip
    subprocess.run(command, check=True)
    if temporary.stat().st_size < path.stat().st_size:
        temporary.replace(path)
    else:
        temporary.unlink()


STUDIO_PATH = re.compile(r"""(['"`(])/spool/""")


def assemble(args):
    data, out, base = Path(args.data), Path(args.out), args.base
    if not base.startswith("/") or not base.endswith("/"):
        raise SystemExit("--base must start and end with /")
    manifest = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
    if manifest["format"] != DATA_FORMAT:
        raise SystemExit(f"Demo data format {manifest['format']} needs a matching build script")
    if manifest.get("schema") != project_schema():
        # The studio would open a project older than the one it expects. Record
        # again with a host on this commit (docs/dev/demo.md).
        raise SystemExit(
            f"The demo was recorded at project schema {manifest.get('schema')} and Spool is at {project_schema()}."
            " Record the demo again."
        )
    if out.exists():
        shutil.rmtree(out)
    studio = out / "spool" / "ui"
    studio.mkdir(parents=True)
    prefix = base + "spool/"
    for source in (ROOT / "ui").iterdir():
        if source.is_dir():
            continue
        target = studio / source.name
        if source.suffix in (".js", ".css", ".html"):
            target.write_text(
                STUDIO_PATH.sub(lambda m: m.group(1) + prefix, source.read_text(encoding="utf-8")), encoding="utf-8"
            )
        else:
            shutil.copy2(source, target)
    shutil.copytree(data / "media", out / "spool" / "media" / manifest["project"])
    shutil.copy2(data / "api" / "replies.json", out / "replies.json")
    if (data / "static").is_dir():
        shutil.copytree(data / "static", out, dirs_exist_ok=True)

    page = (studio / "editor.html").read_text(encoding="utf-8")
    config = json.dumps({"base": base, "project": manifest["project"], "unavailable": DEMO_UNAVAILABLE})
    head = (
        f'<link rel="stylesheet" href="{base}demo.css" />\n'
        f"<script>window.SPOOL_DEMO = {config};</script>\n"
        f'<script src="{base}demo-api.js"></script>\n'
    )
    if "</head>" not in page:
        raise SystemExit("ui/editor.html has no </head>")
    page = page.replace("</head>", head + "</head>", 1)
    page = page.replace("<title>Spool — Studio</title>", "<title>Spool — Online demo</title>")
    (out / "index.html").write_text(page, encoding="utf-8")
    for name in ("demo-api.js", "demo.css"):
        shutil.copy2(ROOT / "pages" / name, out / name)
    left = [p for p in studio.glob("*.js") if STUDIO_PATH.search(p.read_text(encoding="utf-8"))]
    if left:
        raise SystemExit("Studio paths left unrewritten in " + ", ".join(p.name for p in left))
    print("Assembled", out)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    rec = commands.add_parser("record", help="record a project from a running Spool")
    rec.add_argument("--host", required=True)
    rec.add_argument("--project", required=True)
    rec.add_argument("--data", required=True)
    rec.add_argument("--scrub", action="append", default=[], metavar="FROM=>TO", help="replace a local path prefix")
    rec.add_argument("--allow-paths", action="store_true", help="record even if local paths remain")
    rec.add_argument("--name", help="project name shown in the demo")
    rec.add_argument("--leave-out", action="append", default=[], metavar="CLIP", help="remove a clip by name")
    rec.add_argument("--move-to-end", action="append", default=[], metavar="CLIP", help="append a clip to V1")
    rec.add_argument(
        "--overlay", action="append", default=[], metavar="CLIP@SECONDS", help="move a clip to V2, starting there"
    )
    rec.add_argument("--edit", metavar="FILE", help="record the edit saved from a demo page")
    rec.add_argument("--max-takes", type=int, metavar="N", help="keep at most N takes per clip")
    rec.add_argument("--inputs-like", metavar="CLIP", help="give shots without inputs the inputs of this clip")
    rec.add_argument("--close-gaps", action="store_true", help="remove every gap and hear the shots' own audio")
    rec.add_argument("--video-width", type=int, default=960)
    rec.add_argument("--keep-video", action="store_true", help="copy video without re-encoding")
    rec.add_argument("--keep-media", action="store_true", help="record replies again, keeping media already in DIR")
    asm = commands.add_parser("assemble", help="build the static site from recorded data")
    asm.add_argument("--data", required=True)
    asm.add_argument("--out", required=True)
    asm.add_argument("--base", default="/ComfyUI-Spool/demo/")
    args = parser.parse_args()
    record(args) if args.command == "record" else assemble(args)


if __name__ == "__main__":
    main()
