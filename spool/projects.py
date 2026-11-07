"""Project folders are durable; SQLite working files stay on the editing computer."""

import copy
import errno
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timezone
from contextlib import contextmanager, closing, nullcontext
from pathlib import Path

from .errors import NotFound
from . import take_files
from .media import Media
from .ownership import file_lock, atomic_replace
from .store import Store, Conflict, uid, SCHEMA_VERSION, encode, validate_import, read_only_uri
from .durable import atomic_json, write as durable_write
from . import __version__


@contextmanager
def existing_project_lock(path):
    """Coordinate a copy without creating or writing the project's lock file.

    Legacy folders can have no lock yet. They remain inspectable, but a writer
    opening one concurrently can still encounter the source-copy handle. Once
    a lock exists, hold its same byte until that handle has closed on Windows.
    """
    try:
        source = path.open("rb")
    except FileNotFoundError:
        yield
        return
    with source:
        if os.name == "nt":
            import ctypes
            import msvcrt
            from ctypes import wintypes

            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            lock, unlock = kernel.LockFile, kernel.UnlockFile
            for operation in (lock, unlock):
                operation.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD)
                operation.restype = wintypes.BOOL
            handle = msvcrt.get_osfhandle(source.fileno())

            def acquire():
                # Unlike CRT locking, LockFile accepts an rb handle, including
                # an empty file: locking beyond EOF does not extend it.
                if not lock(handle, 0, 0, 1, 0):
                    raise ctypes.WinError(ctypes.get_last_error())

            def release():
                if not unlock(handle, 0, 0, 1, 0):
                    raise ctypes.WinError(ctypes.get_last_error())

        else:
            import fcntl

            def acquire():
                fcntl.flock(source, fcntl.LOCK_EX | fcntl.LOCK_NB)

            def release():
                fcntl.flock(source, fcntl.LOCK_UN)

        deadline = time.monotonic() + 30
        while True:
            try:
                acquire()
                break
            except OSError as error:
                retryable = (
                    getattr(error, "winerror", None) in (32, 33)
                    if os.name == "nt"
                    else error.errno in (errno.EACCES, errno.EAGAIN)
                )
                if not retryable:
                    raise
                if time.monotonic() >= deadline:
                    raise Conflict("Project is busy in another editor. Try again.") from error
                time.sleep(0.05)
        try:
            yield
        finally:
            release()


@contextmanager
def private_snapshot(path):
    """Copy one immutable, atomically published generation to a private directory."""
    with tempfile.TemporaryDirectory(prefix="spool-maintenance-read-") as directory:
        local = Path(directory) / "read.sqlite3"
        with existing_project_lock(path.parent / ".spool" / "project.lock"):
            with path.open("rb") as source, local.open("xb") as target:
                shutil.copyfileobj(source, target)
        yield local


def folder_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", str(name)).strip(" .")[:100].rstrip(" .")
    if not name or name.upper().split(".")[0] in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "CONIN$",
        "CONOUT$",
        *["COM" + str(i) for i in range(1, 10)],
        *["LPT" + str(i) for i in range(1, 10)],
    }:
        name = "Untitled"
    return name


class ProjectStore(Store):
    def __init__(self, folder, workspace=None, *, migrate=True, writable=False):
        self.workspace = workspace
        self.migrate_on_open = migrate
        self.publication_lock = threading.Lock()
        self.publication_cache = None
        folder = Path(folder).resolve()
        self.manifest = folder / "project.json"
        self.check_manifest()
        self.snapshot = folder / "project.spool"
        read_only = not (migrate or writable)
        # Refuse newer SQLite formats before creating even the lock/cache folders.
        if self.snapshot.exists():
            with private_snapshot(self.snapshot) if read_only else nullcontext(self.snapshot) as path:
                with closing(sqlite3.connect(read_only_uri(path), uri=True)) as db:
                    if db.execute("PRAGMA user_version").fetchone()[0] > SCHEMA_VERSION:
                        raise ValueError("This Spool project needs a newer extension version")
        key = hashlib.sha256(str(folder).encode()).hexdigest()
        # Maintenance without a workspace trusts whatever working copy its cache holds, so
        # a writable one gets a folder of its own: another user could fill a shared path.
        self.private_cache = None
        if workspace:
            cache = workspace.root / "cache" / key
        elif migrate or writable:
            cache = self.private_cache = Path(tempfile.mkdtemp(prefix="spool-maintenance-"))
        else:
            cache = Path(tempfile.gettempdir()) / "spool-maintenance" / key  # never created when read-only
        self.runtime = cache / "working.sqlite3"
        self.stamp = cache / "checkpoint.json"
        self.read_runtime = cache / "read.sqlite3"
        self.read_stamp = cache / "read-checkpoint.json"
        self.local_lock = cache / "working.lock"
        self.read_lock = cache / "read.lock"
        self.lock_file = folder / ".spool" / "project.lock"
        if migrate or writable:
            (folder / ".spool").mkdir(parents=True, exist_ok=True)
            cache.mkdir(parents=True, exist_ok=True)
        super().__init__(folder, migrate=migrate, filename="project.spool")
        self.read_only = not (migrate or writable)
        self.focus_store = workspace or self
        self.sync_cache = None
        self.cache = self.root / ".spool"
        if migrate:
            for name in ("input/images", "input/audio", "input/video", "output", ".spool/previews", ".spool/receipts"):
                (folder / name).mkdir(parents=True, exist_ok=True)
            take_files.recover(self)

    def check_manifest(self):
        if not self.manifest.exists():
            return
        value = json.loads(self.manifest.read_text(encoding="utf-8"))
        version = value.get("formatVersion")
        if value.get("format") != "spool-project" or type(version) is not int or version < 1:
            raise ValueError("Invalid Spool project manifest")
        if version > SCHEMA_VERSION:
            raise ValueError("This Spool project needs a newer extension version (project format %d)" % version)

    def write_manifest(self, db):
        row = db.execute("SELECT id FROM projects LIMIT 1").fetchone()
        if row:
            value = {
                "format": "spool-project",
                "formatVersion": db.execute("PRAGMA user_version").fetchone()[0],
                "projectId": row[0],
                "writtenBy": __version__,
            }
            atomic_json(self.manifest, value)

    def signature(self, *, locked=False):
        """Name one published snapshot, not merely a timestamp and a size.

        FAT, HFS+ and some SMB servers give files a one- or two-second timestamp, and a
        SQLite snapshot usually keeps its size. A save in the same tick therefore used to
        look unchanged, so a reader kept an old revision and could later save over newer
        work. Every publication puts a fresh UUID in the snapshot itself. The stat fields
        still make an old snapshot without that marker detectable when it is replaced, and
        they let a reader reuse the cached marker without opening the share on every poll.
        Cache misses open SQLite under the project lock so its Windows handle cannot
        prevent a concurrent replacement. Callers holding that lock pass locked=True.
        """
        stat = self.snapshot.stat()
        fields = [stat.st_mtime_ns, stat.st_size, stat.st_dev, stat.st_ino, stat.st_ctime_ns]
        key = (stat.st_dev, stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size)
        # Whole-millisecond or whole-second timestamps are the filesystems where two
        # publications can share every visible stat field; there the marker is read each
        # time instead of trusted from the cache.
        cacheable = stat.st_ino != 0 and stat.st_mtime_ns % 1_000_000 and stat.st_ctime_ns % 1_000_000
        with self.publication_lock:
            if cacheable and self.publication_cache is not None and self.publication_cache[0] == key:
                return [*fields, self.publication_cache[1]]
        if not locked:
            with file_lock(self.lock_file):
                # Publication may have changed while waiting: stat and marker must
                # identify the same file, and a file lock must never be reacquired.
                return self.signature(locked=True)
        value = self.read_publication()
        # A snapshot is never edited in place: publications replace the file. File identity
        # lets unchanged polls avoid opening SQLite while a replacement still misses the cache.
        with self.publication_lock:
            if cacheable:
                self.publication_cache = (key, value)
        return [*fields, value]

    def read_publication(self):
        """Read under the project lock; only an absent legacy table has no identity."""
        with closing(sqlite3.connect(read_only_uri(self.snapshot), uri=True)) as db:
            exists = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='spool_publication'"
            ).fetchone()
            if not exists:
                return None
            row = db.execute("SELECT publication FROM spool_publication WHERE id=1").fetchone()
        if not row or not isinstance(row[0], str) or not row[0]:
            raise sqlite3.DatabaseError("Spool snapshot publication identity is missing or invalid")
        return row[0]

    def write_publication(self, path):
        """Stamp the copy that is about to replace project.spool, before it is visible.

        The marker is an additive table, not a schema-version change: older Spool readers
        ignore it, and the project document and manifest keep their existing shape.
        """
        token = uid()
        db = sqlite3.connect(path, timeout=30)
        try:
            db.execute("PRAGMA journal_mode=DELETE")
            db.execute(
                "CREATE TABLE IF NOT EXISTS spool_publication("
                "id INTEGER PRIMARY KEY CHECK(id=1), publication TEXT NOT NULL)"
            )
            db.execute("INSERT OR REPLACE INTO spool_publication VALUES(1,?)", (token,))
            db.commit()
        finally:
            db.close()
        return token

    @contextmanager
    def connect(self):
        if self.read_only:
            with self.reading() as db:
                yield db
            return
        notifications = []
        with file_lock(self.local_lock), file_lock(self.lock_file):
            self.check_manifest()
            signature = self.signature(locked=True) if self.snapshot.exists() else None
            try:
                saved = json.loads(self.stamp.read_text()) if self.stamp.exists() else None
            except json.JSONDecodeError:
                saved = None
            if signature is None or not self.runtime.exists() or saved != signature:
                # A crash leaves "-journal" beside the old copy; SQLite would roll it into the new one.
                for suffix in ("", "-journal", "-wal", "-shm"):
                    self.runtime.with_name(self.runtime.name + suffix).unlink(missing_ok=True)
                if signature is not None:
                    shutil.copyfile(self.snapshot, self.runtime)
            # Invalidate before any transaction (including a migration) can commit.
            # Only a successfully acknowledged publication makes this cache trusted.
            self.stamp.write_text("null")
            db = sqlite3.connect(self.runtime, timeout=30)
            db.row_factory = sqlite3.Row
            before = db.total_changes
            schema = db.execute("PRAGMA schema_version").fetchone()[0]
            version = db.execute("PRAGMA user_version").fetchone()[0]
            pages = db.execute("PRAGMA page_count").fetchone()[0]
            notify = self.workspace.project_changed if self.workspace else None
            tokens = self.change_tokens(db) if notify and version else {}
            try:
                if version > SCHEMA_VERSION:
                    raise ValueError("This Spool project needs a newer extension version")
                if self.migrate_on_open and signature is not None and version < SCHEMA_VERSION:
                    # This is the last published snapshot, before any migration runs.
                    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                    backup = self.root / ".spool" / "backups" / ("project-schema%d-%s.spool" % (version, timestamp))
                    durable_write(backup, self.snapshot.read_bytes())
                with db:
                    yield db
                changed = (
                    db.total_changes != before
                    or db.execute("PRAGMA schema_version").fetchone()[0] != schema
                    or db.execute("PRAGMA user_version").fetchone()[0] != version
                    or db.execute("PRAGMA page_count").fetchone()[0] != pages
                )
                if changed or signature is None:
                    local = self.runtime.with_name("snapshot-" + uid() + ".sqlite3")
                    pending = self.snapshot.with_name("project." + uid() + ".partial")
                    try:
                        backup = sqlite3.connect(local)
                        try:
                            db.backup(backup)
                            backup.execute("PRAGMA journal_mode=DELETE")
                        finally:
                            backup.close()
                        self.write_publication(local)
                        with local.open("rb") as source, pending.open("wb") as target:
                            shutil.copyfileobj(source, target)
                            target.flush()
                            os.fsync(target.fileno())
                        atomic_replace(pending, self.snapshot)
                        self.write_manifest(db)
                        self.stamp.write_text(json.dumps(self.signature(locked=True)))
                        if notify:
                            notifications = [
                                {"projectId": identity, "revision": token[0], "cursor": token[1]}
                                for identity, token in self.change_tokens(db).items()
                                if tokens.get(identity) != token
                            ]
                    finally:
                        local.unlink(missing_ok=True)
                        pending.unlink(missing_ok=True)
                else:
                    self.stamp.write_text(json.dumps(signature))
            except Exception:
                self.stamp.unlink(missing_ok=True)
                raise
            finally:
                db.close()
        # A reader must be able to see the publication before its invalidation.
        for value in notifications:
            try:
                notify(value)
            except Exception:
                logging.exception("Spool project notification failed; polling will recover")

    @staticmethod
    def change_tokens(db):
        return {
            row[0]: (row[1], row[2])
            for row in db.execute(
                "SELECT id,revision,(SELECT coalesce(max(cursor),0) FROM events WHERE project_id=projects.id) FROM projects"
            )
        }

    @contextmanager
    def reading(self):
        """Pin a local published generation; only refreshes need the share lock.

        Readers never open the replaceable working database. The local read lock
        also protects open handles from replacement on Windows, across processes.
        Writers use a different local file and can publish while a read is open.
        """
        if self.read_only:
            self.check_manifest()
            with private_snapshot(self.snapshot) as path:
                with closing(sqlite3.connect(read_only_uri(path), uri=True)) as db:
                    if db.execute("PRAGMA user_version").fetchone()[0] > SCHEMA_VERSION:
                        raise ValueError("This Spool project needs a newer extension version")
                    db.row_factory = sqlite3.Row
                    yield db
            return
        with file_lock(self.read_lock):
            self.check_manifest()
            signature = self.signature()
            try:
                saved = json.loads(self.read_stamp.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                saved = None
            if saved != signature or not self.read_runtime.exists():
                with file_lock(self.lock_file):
                    self.check_manifest()
                    signature = self.signature(locked=True)
                    pending = self.read_runtime.with_suffix(".partial")
                    try:
                        shutil.copyfile(self.snapshot, pending)
                        atomic_replace(pending, self.read_runtime)
                        atomic_json(self.read_stamp, signature)
                    finally:
                        pending.unlink(missing_ok=True)
            with closing(sqlite3.connect(read_only_uri(self.read_runtime), uri=True)) as db:
                db.row_factory = sqlite3.Row
                yield db

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

        # Allocate portable names even on a case-sensitive host. Assigned paths
        # stay unchanged, including shared folders in existing projects.
        def folder_key(value):
            return str((self.root / value).resolve()).casefold()

        folders = {folder_key(c["outputFolder"]) for c in document.get("clips", []) if c.get("outputFolder")}
        existing_folders = {c.get("outputFolder") for c in previous.get("clips", [])}
        for clip in document.get("clips", []):
            if not clip.get("outputFolder"):
                base = "output/" + folder_name(clip.get("name", "Clip"))
                name = base
                while folder_key(name) in folders:
                    name = base + "-" + uid()[:8]
                clip["outputFolder"] = name
                folders.add(folder_key(name))
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
        self.project_changed = None
        super().__init__(root, filename="app.sqlite3")
        self.opened = {}
        self.opening = threading.RLock()  # handlers open project stores from worker threads
        self.unavailable = {}  # folder -> (files, error, retry after, delay) for folders that failed to open

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

        def check(folders):
            old = next((row for row in folders if row["id"] == project_id), None)
            if old and Path(old["folder"]) != folder and (Path(old["folder"]) / "project.spool").exists():
                raise Conflict("This project is already open from another folder")

        self.register_folder(project_id, folder, check)
        self.opened[project_id] = store
        return store.get(project_id)

    def register_folder(self, project_id, folder, check=None):
        """Add one project folder to the list in a single transaction.

        Creating, opening and importing run in worker threads (and maybe another
        process); reading the list and writing it back separately lost entries.
        """
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT document FROM settings WHERE key='project_folders'").fetchone()
            folders = json.loads(row[0]) if row else []
            if check:
                check(folders)
            folders = [row for row in folders if row["id"] != project_id] + [{"id": project_id, "folder": str(folder)}]
            db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", ("project_folders", encode(folders)))

    def for_project(self, project_id):
        row = next((r for r in self.folders() if r["id"] == project_id), None)
        if row is None:
            raise NotFound("Project not found")
        folder = Path(row["folder"])
        if not (folder / "project.spool").is_file():
            raise ValueError("Project folder is unavailable: " + str(folder))
        with self.opening:
            if project_id not in self.opened or self.opened[project_id].root != folder:
                self.opened[project_id] = self.open_store(folder)
            return self.opened[project_id]

    def open_store(self, folder):
        """Open a project folder, waiting longer between attempts while it keeps failing.

        The receipt scan and dispatcher open every folder every few seconds, and each
        attempt at a failing migration first writes a backup of the snapshot. A changed
        snapshot or manifest is tried again at once.
        """

        def state(path):
            if not path.exists():
                return None
            stat = path.stat()
            return (stat.st_mtime_ns, stat.st_size, stat.st_dev, stat.st_ino, stat.st_ctime_ns)

        files = tuple(state(path) for path in (folder / "project.spool", folder / "project.json"))
        held = self.unavailable.get(str(folder))
        if held and held[0] == files and time.monotonic() < held[2]:
            raise held[1].with_traceback(None)
        try:
            store = ProjectStore(folder, self)
        except (ValueError, OSError, sqlite3.Error) as error:
            delay = min(3600, held[3] * 2) if held and held[0] == files else 5
            self.unavailable[str(folder)] = (files, error, time.monotonic() + delay, delay)
            logging.warning("Spool could not open the project folder %s: %s", folder, error)
            raise
        self.unavailable.pop(str(folder), None)
        return store

    def project_stores(self):
        """Every project folder that opens; one that cannot is skipped, not fatal to the others."""
        stores = []
        for row in self.folders():
            if (Path(row["folder"]) / "project.spool").is_file():
                try:
                    store = self.for_project(row["id"])
                    store.check_manifest()  # an already-open folder may have been upgraded since
                    stores.append(store)
                except (ValueError, OSError, sqlite3.Error):
                    continue
        return stores

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
            try:
                listed = self.for_project(held["id"]).list()
            except (ValueError, OSError, sqlite3.Error):
                # A newer format or damaged folder is listed as unavailable, not a failed list.
                listed = None
            if listed is None:
                rows.append(
                    {"id": held["id"], "name": Path(held["folder"]).name, "folder": held["folder"], "unavailable": True}
                )
                continue
            rows += [{**row, "folder": held["folder"]} for row in listed]
        return rows

    def get(self, project_id):
        return self.for_project(project_id).get(project_id)

    def lookup(self, table, identity):
        for store in self.project_stores():
            try:
                return store.lookup(table, identity)
            except KeyError:
                continue
        raise NotFound("Project record not found")

    def import_project(self, value):
        validate_import(value)
        parent = Path(self.setting("projects_directory") or self.root / "projects").resolve()
        parent.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix="Untitled Spool project-", dir=parent))
        try:
            store = ProjectStore(folder, self)
            project = store.import_project(value)
            self.register_folder(project["id"], folder)
        except Exception:
            # Only this import's exclusively created destination belongs to us.
            if folder.resolve().parent == parent:
                shutil.rmtree(folder)
            raise
        self.opened[project["id"]] = store
        return project
