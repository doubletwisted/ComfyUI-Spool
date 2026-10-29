"""Project folders are durable; SQLite working files stay on the editing computer."""

import copy
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from . import take_files
from .media import Media
from .ownership import file_lock, atomic_replace
from .store import Store, Conflict, uid


def folder_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", str(name)).strip(" .")[:100]
    if not name or name.upper().split(".")[0] in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *["COM" + str(i) for i in range(1, 10)],
        *["LPT" + str(i) for i in range(1, 10)],
    }:
        name = "Untitled"
    return name


class ProjectStore(Store):
    def __init__(self, folder, workspace):
        self.workspace = workspace
        folder = Path(folder).resolve()
        (folder / ".spool").mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(str(folder).encode()).hexdigest()
        cache = workspace.root / "cache" / key
        cache.mkdir(parents=True, exist_ok=True)
        self.runtime = cache / "working.sqlite3"
        self.stamp = cache / "checkpoint.json"
        self.snapshot = folder / "project.spool"
        self.lock_file = folder / ".spool" / "project.lock"
        super().__init__(folder, filename="project.spool")
        self.focus_store = workspace
        self.sync_cache = None
        self.cache = self.root / ".spool"
        for name in ("input/images", "input/audio", "input/video", "output", ".spool/previews", ".spool/receipts"):
            (folder / name).mkdir(parents=True, exist_ok=True)
        take_files.recover(self)

    def signature(self):
        stat = self.snapshot.stat()
        return [stat.st_mtime_ns, stat.st_size]

    @contextmanager
    def connect(self):
        with file_lock(self.lock_file):
            signature = self.signature() if self.snapshot.exists() else None
            try:
                saved = json.loads(self.stamp.read_text()) if self.stamp.exists() else None
            except json.JSONDecodeError:
                saved = None
            if signature is None or not self.runtime.exists() or saved != signature:
                for suffix in ("", "-wal", "-shm"):
                    self.runtime.with_name(self.runtime.name + suffix).unlink(missing_ok=True)
                if signature is not None:
                    shutil.copyfile(self.snapshot, self.runtime)
            db = sqlite3.connect(self.runtime, timeout=30)
            db.row_factory = sqlite3.Row
            before = db.total_changes
            schema = db.execute("PRAGMA schema_version").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            pages = db.execute("PRAGMA page_count").fetchone()[0]
            try:
                with db:
                    yield db
                changed = (
                    db.total_changes != before
                    or db.execute("PRAGMA schema_version").fetchone()[0] != schema
                    or db.execute("PRAGMA user_version").fetchone()[0] != version
                    or db.execute("PRAGMA page_count").fetchone()[0] != pages
                )
                if changed or signature is None:
                    # A failed publication invalidates the local working copy: the
                    # next reader restores the last durable, acknowledged state.
                    self.stamp.write_text("null")
                    local = self.runtime.with_name("snapshot-" + uid() + ".sqlite3")
                    pending = self.snapshot.with_name("project." + uid() + ".partial")
                    try:
                        backup = sqlite3.connect(local)
                        try:
                            db.backup(backup)
                            backup.execute("PRAGMA journal_mode=DELETE")
                        finally:
                            backup.close()
                        with local.open("rb") as source, pending.open("wb") as target:
                            shutil.copyfileobj(source, target)
                            target.flush()
                            os.fsync(target.fileno())
                        atomic_replace(pending, self.snapshot)
                        self.stamp.write_text(json.dumps(self.signature()))
                    finally:
                        local.unlink(missing_ok=True)
                        pending.unlink(missing_ok=True)
                elif saved != signature:
                    self.stamp.write_text(json.dumps(signature))
            except Exception:
                self.stamp.unlink(missing_ok=True)
                raise
            finally:
                db.close()

    def compact(self):
        before = self.snapshot.stat().st_size
        with self.connect() as db:
            db.execute("VACUUM")
        return before - self.snapshot.stat().st_size

    def host(self, include_definitions=True):
        return self.workspace.host(include_definitions)

    def _write_document(self, db, project_id, document):
        previous = db.execute("SELECT document FROM projects WHERE id=?", (project_id,)).fetchone()
        previous = json.loads(previous[0]) if previous else {}
        for key in ("deletedTakeIds", "deletedMediaIds", "clearedRenderIds"):
            values = sorted(set(previous.get(key, [])) | set(document.get(key, [])))
            if values:
                document[key] = values
        deleted = set(document.get("deletedTakeIds", []))
        media_ids = set(document.get("deletedMediaIds", []))
        for clip in document.get("clips", []):
            if clip.get("takeId") in deleted:
                raise ValueError("This take was deleted from disk. Reload before editing.")
            clip["takes"] = [
                t for t in clip.get("takes", []) if t["id"] not in deleted and t["media"]["id"] not in media_ids
            ]
        document["media"] = [m for m in document.get("media", []) if m["id"] not in media_ids]
        folders = {c.get("outputFolder") for c in document.get("clips", [])}
        existing_folders = {c.get("outputFolder") for c in previous.get("clips", [])}
        for clip in document.get("clips", []):
            if not clip.get("outputFolder"):
                name = "output/" + folder_name(clip.get("name", "Clip"))
                if name in folders:
                    name += "-" + uid()[:8]
                clip["outputFolder"] = name
                folders.add(name)
            if clip["outputFolder"] not in existing_folders:
                path = (self.root / clip["outputFolder"]).resolve()
                if path == self.root / "output" or not path.is_relative_to(self.root / "output"):
                    raise ValueError("Clip folder must be inside this project's output folder")
                path.mkdir(parents=True, exist_ok=True)
        pairing = self.workspace.host(include_definitions=False)["configuration"]
        if pairing:
            media = Media(
                self.root, *[pairing["roots"][kind] for kind in ("input", "output", "temp")], project_id=project_id
            )
            for clip in document.get("clips", []):
                for binding in clip.get("bindings", []):
                    value = clip.get("inputValues", {}).get(binding["key"])
                    if not binding.get("asset") or not isinstance(value, str) or not value:
                        continue
                    source = media.input_source(value)
                    if source.is_file():
                        clip["inputValues"][binding["key"]] = media.stage_input(source)
        return super()._write_document(db, project_id, document)

    def get(self, project_id):
        return {**super().get(project_id), "folder": str(self.root)}

    def sync_state(self, project_id):
        # Only an atomically published snapshot is durable. Unchanged polls need
        # not wait behind a reader or a writer still preparing its publication.
        key = (project_id, self.signature())
        cached = self.sync_cache
        if cached is not None and cached[0] == key:
            return copy.deepcopy(cached[1])
        state = super().sync_state(project_id)
        self.sync_cache = (key, copy.deepcopy(state))
        return state


class Workspace(Store):
    """Machine settings and a directory of opened projects, never their edit data."""

    def __init__(self, root):
        super().__init__(root, filename="app.sqlite3")
        self.opened = {}
        self.opening = threading.RLock()  # handlers open project stores from worker threads

    def folders(self):
        return self.setting("project_folders") or []

    def open_folder(self, folder):
        folder = Path(folder).resolve()
        if not (folder / "project.spool").is_file():
            raise ValueError("Choose a Spool project folder containing project.spool")
        store = ProjectStore(folder, self)
        projects = store.list()
        if len(projects) != 1:
            raise ValueError("A project folder must contain exactly one project")
        project_id = projects[0]["id"]
        folders = self.folders()
        old = next((row for row in folders if row["id"] == project_id), None)
        if old and Path(old["folder"]) != folder and (Path(old["folder"]) / "project.spool").exists():
            raise Conflict("This project is already open from another folder")
        self.set_setting(
            "project_folders",
            [row for row in folders if row["id"] != project_id] + [{"id": project_id, "folder": str(folder)}],
        )
        self.opened[project_id] = store
        return store.get(project_id)

    def for_project(self, project_id):
        row = next((r for r in self.folders() if r["id"] == project_id), None)
        if row is None:
            raise KeyError("Project not found")
        folder = Path(row["folder"])
        if not (folder / "project.spool").is_file():
            raise ValueError("Project folder is unavailable: " + str(folder))
        with self.opening:
            if project_id not in self.opened or self.opened[project_id].root != folder:
                self.opened[project_id] = ProjectStore(folder, self)
            return self.opened[project_id]

    def project_stores(self):
        return [
            self.for_project(row["id"]) for row in self.folders() if (Path(row["folder"]) / "project.spool").is_file()
        ]

    def create(self, document=None, folder=None):
        if folder is None:
            parent = Path(self.setting("projects_directory") or self.root / "projects")
            folder = parent / folder_name((document or {}).get("project", "Untitled Spool project"))
            if folder.exists():
                folder = folder.with_name(folder.name + "-" + uid()[:8])
        folder = Path(folder)
        if not folder.is_absolute():
            raise ValueError("Choose an absolute project folder path")
        if folder.exists() and any(folder.iterdir()):
            raise ValueError("Choose an empty folder for the new project")
        store = ProjectStore(folder, self)
        store.create(document)
        return self.open_folder(folder)

    def list(self):
        rows = []
        for held in self.folders():
            if not (Path(held["folder"]) / "project.spool").is_file():
                rows.append(
                    {"id": held["id"], "name": Path(held["folder"]).name, "folder": held["folder"], "unavailable": True}
                )
                continue
            rows += [{**row, "folder": held["folder"]} for row in self.for_project(held["id"]).list()]
        return rows

    def get(self, project_id):
        return self.for_project(project_id).get(project_id)

    def lookup(self, table, identity):
        for store in self.project_stores():
            try:
                return store.lookup(table, identity)
            except KeyError:
                continue
        raise KeyError("Project record not found")

    def import_project(self, value):
        parent = Path(self.setting("projects_directory") or self.root / "projects").resolve()
        parent.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix="Untitled Spool project-", dir=parent))
        try:
            store = ProjectStore(folder, self)
            project = store.import_project(value)
            self.set_setting("project_folders", [*self.folders(), {"id": project["id"], "folder": str(folder)}])
        except Exception:
            # Only this import's exclusively created destination belongs to us.
            if folder.resolve().parent == parent:
                shutil.rmtree(folder)
            raise
        self.opened[project["id"]] = store
        return project
