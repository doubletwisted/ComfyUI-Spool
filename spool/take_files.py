"""Permanent take deletion, with project ownership checks and crash recovery."""
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote

from . import ledger, sidecars
from .media import STAGED_PREFIX, contained, EXTENSIONS, staged_relative
from .ownership import atomic_replace
from .store import Conflict, encode, uid


def paths(root, metadata):
    found = {Path(value).resolve() if Path(value).is_absolute() else contained(root, value).resolve()
             for key in ("originalFile", "file", "poster") if (value := metadata.get(key))}
    original = sidecars.media_path(root, metadata)
    if original:
        found.add(original.resolve().with_suffix(".json"))
    return found


def plan(store, document, clip_id, take_ids):
    clip = next((c for c in document["clips"] if c["id"] == clip_id), None)
    if not clip or not isinstance(take_ids, list) or not take_ids or any(not isinstance(i, str) for i in take_ids):
        raise ValueError("Select the takes to delete")
    ids = set(take_ids)
    available = {t["id"]: t for t in clip["takes"] if not t.get("placeholder") and t["id"] not in clip.get("hiddenTakeIds", [])}
    if not ids <= available.keys():
        raise ValueError("Some selected takes are no longer available")
    if clip.get("takeId") in ids:
        raise ValueError("The take in the edit is kept. Choose another take before deleting it.")
    root, files, originals, media_ids = store.root.resolve(), set(), set(), set()
    records = [t["media"] for c in document["clips"] for t in c.get("takes", [])]
    records += [c.get("media", {}) for c in document.get("audioClips", [])] + document.get("media", [])
    values = {m[key] for m in records for key in ("originalFile", "file", "poster") if m.get(key)}

    def resolve(value):
        path = Path(value)
        relative = not path.is_absolute()
        path = (root / unquote(value) if relative else path).resolve()
        if relative and (path == root or not path.is_relative_to(root)):
            raise ValueError("Media path escapes its storage root")
        return value, path

    with ThreadPoolExecutor(max_workers=8) as pool:
        resolved = dict(pool.map(resolve, values))

    def media_paths(metadata):
        result = {resolved[metadata[key]] for key in ("originalFile", "file", "poster") if metadata.get(key)}
        original = metadata.get("originalFile") or metadata.get("file")
        if original:
            result.add(resolved[original].with_suffix(".json"))
        return result

    for identity in ids:
        metadata = available[identity]["media"]
        source = resolved[metadata.get("originalFile") or metadata["file"]]
        if not source.is_relative_to(root) or source.relative_to(root).parts[0] not in ("output", "input", ".spool") or source.suffix.lower() not in EXTENSIONS:
            raise ValueError("Delete from disk only manages media owned by this project; archive this take instead.")
        originals.add(source)
        media_ids.add(metadata["id"])
        files.add(source)
        files.add(source.with_suffix(".json"))
        for path in media_paths(metadata):
            if path.is_relative_to(root / ".spool/previews"):
                files.add(path)
    for other in document["clips"]:
        for take in other.get("takes", []):
            if other["id"] == clip_id and take["id"] in ids:
                continue
            if media_paths(take["media"]) & files:
                raise ValueError("A selected file is also used by another take in " + other.get("name", "this clip") + ". Archive it instead.")
    for audio in document.get("audioClips", []):
        if media_paths(audio.get("media", {})) & files:
            raise ValueError("A selected file is used by timeline audio. Archive it instead.")
    # Input values name project files in Comfy's staging namespace.
    for other in document["clips"]:
        for binding in other.get("bindings", []):
            value = other.get("inputValues", {}).get(binding["key"])
            if not binding.get("asset") or not isinstance(value, str):
                continue
            if value.startswith(STAGED_PREFIX):
                relative = staged_relative(value)
                candidate = contained(root, relative).resolve() if relative else None
            elif Path(value).is_absolute():
                candidate = Path(value).resolve()
            else:
                candidate = None
            if candidate in originals:
                raise ValueError("A selected file is a generation input. Archive it instead.")
    for metadata in document.get("media", []):
        if media_paths(metadata) & files:
            if resolved[metadata.get("originalFile") or metadata["file"]] not in originals:
                raise ValueError("A selected file is shared with another media-pool asset. Archive it instead.")
            media_ids.add(metadata["id"])
    for source in files:
        if not source.is_relative_to(root):
            raise ValueError("Take file escapes the project folder")
        if source.exists() and not source.is_file():
            raise ValueError("A take file path is a directory")
    return sorted(ids), sorted(media_ids), sorted(files)


def finish(root, directory, manifest, committed):
    for entry in manifest["files"]:
        original = contained(root, entry["original"]).resolve()
        staged = contained(directory, entry["staged"]).resolve()
        if not original.is_relative_to(root.resolve()) or not staged.is_relative_to(directory.resolve()):
            raise ValueError("Take deletion recovery path escapes its folder")
        if not staged.exists():
            continue
        if committed:
            staged.unlink()
        else:
            if original.exists():
                raise ValueError("A take file reappeared during deletion. Recovery kept the staged original at " + str(staged))
            atomic_replace(staged, original)
    (directory / "manifest.json").unlink()
    directory.rmdir()


def recover(store):
    directory = store.root / ".spool/take-deletions"
    if not directory.exists():
        return
    if not directory.resolve().is_relative_to(store.root.resolve()):
        raise ValueError("Take deletion folder escapes the project")
    for path in directory.glob("*/manifest.json"):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        committed = set(manifest["takeIds"]) <= store.deleted_take_ids(manifest["projectId"])
        try:
            finish(store.root, path.parent, manifest, committed)
        except OSError:
            if not committed:
                raise
            logging.warning("Spool take deletion awaits filesystem release: %s", path.parent)


def delete(store, project_id, revision, clip_id, take_ids):
    recover(store)
    project = store.get(project_id)
    if project["revision"] != revision:
        raise Conflict("This project changed. Reload before deleting takes.")
    ids, media_ids, files = plan(store, project["document"], clip_id, take_ids)
    directory = store.root / ".spool/take-deletions" / uid()
    if not directory.resolve().is_relative_to(store.root.resolve()):
        raise ValueError("Take deletion folder escapes the project")
    manifest = {"projectId": project_id, "takeIds": ids, "files": [
        {"original": source.relative_to(store.root).as_posix(), "staged": str(index) + source.suffix}
        for index, source in enumerate(files) if source.is_file()]}
    try:
        with store.editing(project_id, revision, "This project changed. Reload before deleting takes.") as edit:
            directory.mkdir(parents=True)
            pending = directory / "manifest.partial"
            pending.write_text(encode(manifest), encoding="utf-8")
            atomic_replace(pending, directory / "manifest.json")
            for entry in manifest["files"]:
                source, staged = contained(store.root, entry["original"]), contained(directory, entry["staged"])
                if not source.resolve().is_relative_to(store.root.resolve()):
                    raise ValueError("Take file escapes the project folder")
                atomic_replace(source, staged)
            document = ledger.authored(project["document"])
            document["deletedTakeIds"] = sorted(set(document.get("deletedTakeIds", [])) | set(ids))
            document["deletedMediaIds"] = sorted(set(document.get("deletedMediaIds", [])) | set(media_ids))
            edit.save(document)
            edit.event("takes.deleted_from_disk", {"clipId": clip_id, "takeIds": ids, "files": [e["original"] for e in manifest["files"]]})
    except Exception:
        # Publication can fail after a local SQLite commit. The durable project
        # snapshot decides whether a restart should restore or finish the files.
        recover(store)
        raise
    pending = 0
    try:
        finish(store.root, directory, manifest, True)
    except OSError:
        pending = sum((directory / entry["staged"]).exists() for entry in manifest["files"])
        logging.warning("Spool take deletion awaits filesystem release: %s", directory)
    return {"project": store.get(project_id), "deleted": ids, "pendingFiles": pending}
