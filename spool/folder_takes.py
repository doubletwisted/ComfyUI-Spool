"""Discover completed files in clip folders without changing the chosen take."""

import json
import logging
import subprocess
import time
import uuid

from . import ledger
from .media import VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, contained
from .store import Conflict
from . import sidecars


class FolderTakes:
    def __init__(self):
        self.observed = {}

    def scan(self, store, media, project_id):
        revision = store.revision(project_id)
        document = store.projected(project_id)
        indexed = store.setting("output_index") or {}
        known = {m.get("originalFile", m.get("file")) for m in ledger.media_records(document)} | set(indexed)
        attempts = store.scan_attempts()
        for attempt in attempts:
            if attempt.get("result"):
                result = json.loads(attempt["result"])
                known.update(a.get("originalFile", a.get("file")) for a in result.get("artifacts", []))
        owners = {}
        for clip in document.get("clips", []):
            if clip.get("outputFolder"):
                owners.setdefault(clip["outputFolder"], []).append(clip)
        ready = []
        for folder, clips in owners.items():
            directory = contained(store.root, folder)
            if not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS | IMAGE_EXTENSIONS:
                    continue
                relative = path.relative_to(store.root).as_posix()
                if relative in known or any(a["take_id"][:8] in path.stem for a in attempts):
                    continue
                stat = path.stat()
                signature = (stat.st_size, stat.st_mtime_ns)
                key = (project_id, relative)
                previous = self.observed.get(key)
                self.observed[key] = signature
                if previous != signature or not stat.st_size or time.time() - stat.st_mtime < 5:
                    continue
                try:
                    metadata = media.describe(path, fps=document.get("fps", 24))
                    override = sidecars.read(path)
                    if override:
                        metadata["workflowData"] = media.prepare_workflow(override)
                    elif metadata.get("workflow") or metadata.get("prompt"):
                        metadata["workflowData"] = media.prepare_workflow(
                            {key: metadata[key] for key in ("workflow", "prompt") if key in metadata}
                        )
                    if (path.stat().st_size, path.stat().st_mtime_ns) != signature:
                        continue
                except (ValueError, OSError, subprocess.SubprocessError):
                    # A renderer may still have the container open; retry the same
                    # file after it stops changing and ffprobe can read it.
                    continue
                identity = str(uuid.uuid5(uuid.UUID(project_id), relative))
                metadata["id"] = "media-" + identity
                for clip in clips:
                    number = (
                        max(
                            [t.get("number", 0) for t in clip.get("takes", [])]
                            + [a["request"].get("takeNumber", 0) for a in attempts if a["clip_id"] == clip["id"]]
                            + [0]
                        )
                        + 1
                    )
                    take = {"id": "take-" + identity, "number": number, "media": metadata}
                    clip.setdefault("takes", []).append(take)
                ready.append((relative, "take-" + identity))
        if not ready:
            return
        try:
            # A project that changed meanwhile is rescanned on the next pass.
            with store.editing(project_id, revision) as edit:
                edit.save(document)
                indexed.update(dict(ready))
                edit.setting("output_index", indexed)
                edit.event("takes.discovered", {"files": [path for path, _ in ready]})
        except Conflict:
            return
        logging.info("Spool discovered %d completed takes in %s", len(ready), store.root)
