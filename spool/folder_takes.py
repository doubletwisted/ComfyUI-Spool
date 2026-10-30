"""Discover completed files in clip folders without changing the chosen take."""

import copy
import hashlib
import logging
import os
import subprocess
import time
import uuid
from pathlib import Path

from . import ledger
from .media import VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, contained
from .store import Conflict
from . import sidecars


class FolderTakes:
    def __init__(self):
        self.observed = {}
        self.snapshots = {}

    def scan(self, store, media, project_id):
        state = store.sync_state(project_id)
        revision = state["revision"]
        key = (str(store.root), project_id)
        checkpoint = (revision, state["cursor"])
        cached = self.snapshots.get(key)
        if cached is None or cached[0] != checkpoint:
            document = ledger.editor_project({"document": store.projected(project_id)})["document"]
            inventory = store.folder_inventory(project_id)
            self.snapshots[key] = (checkpoint, document, inventory)
        else:
            _, document, inventory = cached
        document = copy.deepcopy(document)
        indexed = store.setting("output_index") or {}
        external = store.setting("external_file_index") or {}
        known = (
            {m.get("originalFile", m.get("file")) for m in ledger.media_records(document)} | set(indexed) | inventory[0]
        )
        authored_takes = {
            t["id"]: t for c in document.get("clips", []) for t in c.get("takes", []) if not t.get("generated")
        }
        owners = {}
        for clip in document.get("clips", []):
            if clip.get("outputFolder"):
                owners.setdefault(clip["outputFolder"], []).append(clip)
        ready, refreshed = [], set()
        for folder, clips in owners.items():
            directory = contained(store.root, folder)
            if not directory.is_dir():
                continue
            # A directory listing carries each entry's type, so files on a share are not stat'ed one by one.
            with os.scandir(directory) as entries:
                files = [
                    Path(entry.path)
                    for entry in entries
                    if entry.is_file() and Path(entry.name).suffix.lower() in VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
                ]
            for path in files:
                if any(prefix in path.stem for prefix in inventory[2]):
                    continue
                relative = path.relative_to(store.root).as_posix()
                legacy = authored_takes.get(indexed.get(relative)) if relative not in external else None
                if relative in known and relative not in external and not legacy:
                    continue
                stat = path.stat()
                signature = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
                entry = external.get(relative)
                if legacy:
                    entry = {"takeId": legacy["id"], "mediaId": legacy["media"]["id"], "signature": [], "sha256": None}
                if entry and entry["signature"] == list(signature):
                    continue
                key = (project_id, relative)
                previous = self.observed.get(key)
                self.observed[key] = signature
                if previous != signature or not stat.st_size or time.time() - stat.st_mtime < 5:
                    continue
                with path.open("rb") as source:
                    digest = hashlib.file_digest(source, "sha256").hexdigest()
                renamed = next(
                    (
                        old
                        for old, held in external.items()
                        if stat.st_ino
                        and old != relative
                        and held["signature"][:2] == list(signature[:2])
                        and held["sha256"] == digest
                        and not contained(store.root, old).exists()
                        and contained(store.root, old).parent == path.parent
                    ),
                    None,
                )
                if renamed:
                    entry = external.pop(renamed)
                preserved = bool(legacy or renamed or entry and entry["sha256"] == digest)
                try:
                    metadata = media.describe(path, fps=document.get("fps", 24))
                    override = sidecars.read(path)
                    if override:
                        metadata["workflowData"] = media.prepare_workflow(override)
                    elif metadata.get("workflow") or metadata.get("prompt"):
                        metadata["workflowData"] = media.prepare_workflow(
                            {key: metadata[key] for key in ("workflow", "prompt") if key in metadata}
                        )
                    if (
                        path.stat().st_dev,
                        path.stat().st_ino,
                        path.stat().st_size,
                        path.stat().st_mtime_ns,
                        path.stat().st_ctime_ns,
                    ) != signature:
                        continue
                except (ValueError, OSError, subprocess.SubprocessError):
                    # A renderer may still have the container open; retry the same
                    # file after it stops changing and ffprobe can read it.
                    continue
                identity = str(uuid.uuid4())
                take_id = entry["takeId"] if preserved else "take-" + identity
                metadata["id"] = entry["mediaId"] if preserved else "media-" + identity
                if entry:
                    refreshed.add(entry["mediaId"])
                    for record in ledger.media_records(document):
                        if record["id"] != entry["mediaId"]:
                            continue
                        if preserved:
                            record.clear()
                            record.update(metadata)
                        else:
                            # A replacement is a new take. Never play its bytes as the
                            # old selected take, even when it reused the same path.
                            missing = ".spool/missing/" + entry["mediaId"] + path.suffix
                            if record.get("file") == relative:
                                record["file"] = missing
                            record["originalFile"] = missing
                            record["replacedFile"] = relative
                            record.pop("evidence", None)
                            record.pop("embeddedGraph", None)
                if not preserved:
                    for clip in clips:
                        number = (
                            max([t.get("number", 0) for t in clip.get("takes", [])] + [inventory[1].get(clip["id"], 0)])
                            + 1
                        )
                        clip.setdefault("takes", []).append({"id": take_id, "number": number, "media": metadata})
                external[relative] = {
                    "takeId": take_id,
                    "mediaId": metadata["id"],
                    "signature": list(signature),
                    "sha256": digest,
                }
                if renamed:
                    indexed.pop(renamed, None)
                ready.append((relative, take_id))
        if not ready:
            return
        try:
            # A project that changed meanwhile is rescanned on the next pass.
            with store.editing(project_id, revision, cursor=state["cursor"]) as edit:
                edit.forget_media_evidence(refreshed)
                edit.save(document)
                indexed.update(dict(ready))
                edit.setting("output_index", indexed)
                edit.setting("external_file_index", external)
                edit.event("takes.discovered", {"files": [path for path, _ in ready]})
        except Conflict:
            return
        logging.info("Spool discovered %d completed takes in %s", len(ready), store.root)
