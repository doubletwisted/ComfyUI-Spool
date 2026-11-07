"""Read-only maintenance pins private generations without obstructing publication."""

import contextlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import maintenance
from spool.errors import NotFound
from spool.projects import ProjectStore, Workspace, existing_project_lock
from spool.store import SCHEMA_VERSION, Conflict


ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).parent / "fixtures"
READ_STATE = "SELECT revision, json_extract(document,'$.project') FROM projects"

# Exercise the production CLI dispatcher. The only interception pauses a real
# source copy or SQLite reader, leaving its handle open until the writer finishes.
MAINTENANCE_CHILD = r"""
import contextlib
import json
import runpy
import sqlite3
import sys
import time
from pathlib import Path
from unittest.mock import patch

from spool.projects import ProjectStore
from spool.store import read_only_uri

mode, command, folder, ready_name, release_name, result_name = sys.argv[1:]
ready, release, result = map(Path, (ready_name, release_name, result_name))
observed = {}
query = "SELECT revision, json_extract(document,'$.project') FROM projects"

def wait():
    pending = ready.with_suffix(".partial")
    pending.write_text(json.dumps(observed))
    pending.replace(ready)
    deadline = time.monotonic() + 30
    while not release.exists():
        if time.monotonic() >= deadline:
            raise RuntimeError("writer did not release maintenance")
        time.sleep(0.01)

reading = ProjectStore.reading

@contextlib.contextmanager
def paused_reading(store):
    with reading(store) as db:
        if store.read_only and hasattr(store, "path") and "before" not in observed:
            observed["database"] = db.execute("PRAGMA database_list").fetchone()[2]
            observed["before"] = list(db.execute(query).fetchone())
            if mode == "reader":
                wait()
            yield db
            observed["after"] = list(db.execute(query).fetchone())
        else:
            yield db

def paused_copy(source, target, length=0):
    # Pause after consuming only a prefix: the remainder must still come from
    # this same immutable generation after project.spool has been replaced.
    target.write(source.read(4096))
    first = "source" not in observed
    if first:
        observed["source"] = str(source.name)
        wait()
    while chunk := source.read(65536):
        target.write(chunk)
    if first:
        target.flush()
        with contextlib.closing(sqlite3.connect(read_only_uri(Path(target.name)), uri=True)) as db:
            observed["copied"] = list(db.execute(query).fetchone())

sys.argv = ["spool", command, "--storage", folder, "--json"]
with contextlib.ExitStack() as stack:
    stack.enter_context(patch.object(ProjectStore, "reading", paused_reading))
    if mode == "copy":
        stack.enter_context(patch("spool.projects.shutil.copyfileobj", paused_copy))
    try:
        runpy.run_module("spool", run_name="__main__")
    except SystemExit as done:
        if done.code:
            raise
result.write_text(json.dumps(observed))
"""

WRITER_CHILD = r"""
import contextlib
import json
import sys
from pathlib import Path
from unittest.mock import patch
from spool.projects import Workspace
from spool.projects import file_lock

@contextlib.contextmanager
def observed_lock(path):
    if len(sys.argv) > 4 and path == Path(sys.argv[2]) / ".spool" / "project.lock":
        Path(sys.argv[4]).touch()
    with file_lock(path):
        yield

workspace = Workspace(sys.argv[1])
with patch("spool.projects.file_lock", observed_lock):
    current = workspace.open_folder(sys.argv[2])
    store = workspace.for_project(current["id"])
    saved = store.save(current["id"], current["revision"], {**current["document"], "project": sys.argv[3]})
print(json.dumps([saved["revision"], saved["document"]["project"]]))
"""


class MaintenancePublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = Workspace(self.root / "app")
        self.folder = self.root / "Film #1"
        self.project = self.workspace.create({"project": "Before", "clips": [], "media": []}, self.folder)

    def start_maintenance(self, mode, command):
        ready = self.root / (mode + command + "-ready.json")
        release = self.root / (mode + command + "-release")
        result = self.root / (mode + command + "-result.json")
        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                MAINTENANCE_CHILD,
                mode,
                command,
                str(self.folder),
                str(ready),
                str(release),
                str(result),
            ],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.monotonic() + 15
        try:
            while not ready.exists():
                if process.poll() is not None:
                    stdout, stderr = process.communicate()
                    self.fail(f"Maintenance exited before opening its handle: {stdout}\n{stderr}")
                if time.monotonic() >= deadline:
                    self.fail("Maintenance did not open its handle")
                time.sleep(0.01)
            # The ready file is written before the child starts waiting.
            observed = json.loads(ready.read_text())
            return process, release, result, observed
        except BaseException:
            release.touch()
            process.communicate(timeout=10)
            raise

    def publish(self, name):
        result = subprocess.run(
            [sys.executable, "-c", WRITER_CHILD, str(self.root / (name + "-app")), str(self.folder), name],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_cli_dry_run_reader_does_not_block_another_process_publication(self):
        for command in ("prune", "reclaim"):
            with self.subTest(command=command):
                process, release, result, observed = self.start_maintenance("reader", command)
                try:
                    database = Path(observed["database"])
                    saved = self.publish(command)
                    self.assertNotEqual(database, self.folder / "project.spool")
                    self.assertFalse(database.is_relative_to(self.folder))
                    self.assertTrue(database.is_file())
                    self.assertIsNone(process.poll(), "Maintenance must still hold its SQLite handle")
                    self.assertGreater(saved[0], observed["before"][0])
                finally:
                    release.touch()
                    stdout, stderr = process.communicate(timeout=15)
                self.assertEqual(process.returncode, 0, stdout + stderr)
                self.assertIsInstance(json.loads(stdout), dict)
                final = json.loads(result.read_text())
                self.assertEqual(final["before"], final["after"])
                self.assertFalse(database.parent.exists(), "Private generations must be cleaned up")
                with ProjectStore(self.folder, migrate=False).reading() as db:
                    self.assertEqual(list(db.execute(READ_STATE).fetchone()), saved)

    def test_slow_source_copy_coordinates_with_a_writer_and_retains_one_generation(self):
        self.assert_slow_copy_serializes_writer()

    def test_empty_lock_source_copy_coordinates_with_a_writer(self):
        (self.folder / ".spool" / "project.lock").write_bytes(b"")
        self.assert_slow_copy_serializes_writer()

    def assert_slow_copy_serializes_writer(self):
        process, release, result, observed = self.start_maintenance("copy", "reclaim")
        attempted = self.root / "writer-attempted"
        writer = subprocess.Popen(
            [
                sys.executable,
                "-c",
                WRITER_CHILD,
                str(self.root / "copy-app"),
                str(self.folder),
                "During copy",
                str(attempted),
            ],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 10
            while not attempted.exists():
                self.assertIsNone(writer.poll(), "Writer must try acquiring the project lock")
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            # Longer than atomic_replace's retry window: the writer waits on
            # the lock instead of trying to replace an open Windows source.
            with self.assertRaises(subprocess.TimeoutExpired):
                writer.communicate(timeout=2.2)
            self.assertIsNone(process.poll(), "The snapshot source handle must still be open")
        finally:
            release.touch()
            writer_stdout, writer_stderr = writer.communicate(timeout=15)
            stdout, stderr = process.communicate(timeout=15)
        self.assertEqual(writer.returncode, 0, writer_stdout + writer_stderr)
        saved = json.loads(writer_stdout)
        self.assertEqual(process.returncode, 0, stdout + stderr)
        final = json.loads(result.read_text())
        before = [self.project["revision"], "Before"]
        self.assertEqual(final["copied"], before)
        self.assertIn(final["before"], (before, saved))
        self.assertEqual(final["after"], final["before"])
        self.assertFalse(Path(final["database"]).parent.exists())
        with ProjectStore(self.folder, migrate=False).reading() as db:
            self.assertEqual(list(db.execute(READ_STATE).fetchone()), saved)

    def test_legacy_reports_do_not_create_migrate_recover_or_use_project_locks(self):
        folder = self.root / "legacy"
        folder.mkdir()
        shutil.copyfile(FIXTURES / "project-schema5.spool", folder / "project.spool")
        before = {p.relative_to(folder): p.read_bytes() for p in folder.rglob("*") if p.is_file()}
        with (
            patch("spool.projects.file_lock", side_effect=AssertionError("No project lock writes")),
            patch("spool.projects.take_files.recover", side_effect=AssertionError("No recovery")),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            for command in (maintenance.run, maintenance.run_prune):
                self.assertEqual(command(["--storage", str(folder), "--json"]), 0)
        self.assertEqual({p.relative_to(folder): p.read_bytes() for p in folder.rglob("*") if p.is_file()}, before)
        self.assertFalse((folder / ".spool").exists())

        # An existing but empty, read-only lock file must not acquire a byte.
        (folder / ".spool").mkdir()
        lock = folder / ".spool" / "project.lock"
        lock.touch()
        lock.chmod(0o444)
        self.addCleanup(lock.chmod, 0o666)
        with patch("spool.projects.file_lock", side_effect=AssertionError("No project lock writes")):
            store = ProjectStore(folder, migrate=False)
            with store.connect() as db:
                self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 5)
                self.assertIsNone(
                    db.execute("SELECT name FROM sqlite_master WHERE name='spool_publication'").fetchone()
                )
                with self.assertRaises(sqlite3.OperationalError):
                    db.execute("CREATE TABLE forbidden(id)")
        self.assertEqual(lock.read_bytes(), b"")

    def test_private_generations_clean_up_on_reader_copy_and_open_failures(self):
        store = ProjectStore(self.folder, migrate=False)
        with self.assertRaisesRegex(RuntimeError, "report interrupted"):
            with store.reading() as db:
                database = Path(db.execute("PRAGMA database_list").fetchone()[2])
                raise RuntimeError("report interrupted")
        self.assertFalse(database.parent.exists())

        temporary = tempfile.TemporaryDirectory
        generations = []
        path_open = Path.open
        handles = []

        def tracked_open(path, *args, **kwargs):
            handle = path_open(path, *args, **kwargs)
            if path in (store.snapshot, store.lock_file):
                handles.append(handle)
            return handle

        def tracked_temporary(*args, **kwargs):
            directory = temporary(*args, **kwargs)
            generations.append(Path(directory.name))
            return directory

        with (
            patch("spool.projects.tempfile.TemporaryDirectory", tracked_temporary),
            patch.object(Path, "open", tracked_open),
        ):
            with patch("spool.projects.shutil.copyfileobj", side_effect=OSError("copy interrupted")):
                with self.assertRaisesRegex(OSError, "copy interrupted"):
                    with store.reading():
                        self.fail("Incomplete copies must never be opened")
            with patch("spool.projects.sqlite3.connect", side_effect=sqlite3.DatabaseError("open interrupted")):
                with self.assertRaisesRegex(sqlite3.DatabaseError, "open interrupted"):
                    with store.reading():
                        self.fail("Unreadable snapshots must fail")
        self.assertEqual(len(generations), 2)
        self.assertTrue(all(not path.exists() for path in generations))
        self.assertEqual(len(handles), 4)
        self.assertTrue(all(handle.closed for handle in handles))

    def test_constructor_and_new_reads_validate_private_schema_before_reporting(self):
        folder = self.root / "newer"
        folder.mkdir()
        snapshot = folder / "project.spool"
        with contextlib.closing(sqlite3.connect(snapshot)) as db:
            db.execute(f"PRAGMA user_version={SCHEMA_VERSION + 1}")
        before = snapshot.read_bytes()
        connect = sqlite3.connect
        opened = []

        def private_connect(path, *args, **kwargs):
            self.assertNotIn("project.spool", str(path))
            db = connect(path, *args, **kwargs)
            opened.append(Path(db.execute("PRAGMA database_list").fetchone()[2]))
            return db

        with patch("spool.projects.sqlite3.connect", private_connect):
            with self.assertRaisesRegex(ValueError, "newer extension"):
                ProjectStore(folder, migrate=False)
        self.assertEqual(snapshot.read_bytes(), before)
        self.assertEqual(list(folder.iterdir()), [snapshot])
        self.assertEqual(len(opened), 1)
        self.assertFalse(opened[0].parent.exists())

        store = ProjectStore(self.folder, migrate=False)
        # A different publisher can change the format after construction.
        replacement = self.root / "newer.spool"
        shutil.copyfile(snapshot, replacement)
        replacement.replace(store.snapshot)
        with self.assertRaisesRegex(ValueError, "newer extension"):
            with store.reading():
                self.fail("A newer publication must never be reported as compatible")

    @unittest.skipUnless(os.name == "nt", "Native Windows read-only byte locks")
    def test_native_lock_failures_close_the_read_only_handle_without_copying(self):
        from unittest.mock import Mock

        lock = self.folder / ".spool" / "project.lock"
        path_open = Path.open
        opened = []

        def tracked_open(path, *args, **kwargs):
            handle = path_open(path, *args, **kwargs)
            if path == lock:
                opened.append(handle)
            return handle

        with patch.object(Path, "open", tracked_open):
            with patch("msvcrt.get_osfhandle", side_effect=OSError("handle unavailable")):
                with self.assertRaisesRegex(OSError, "handle unavailable"):
                    with existing_project_lock(lock):
                        self.fail("Handle errors must not allow uncoordinated copies")
            for error_code in (5, 87):
                kernel = Mock()
                kernel.LockFile.return_value = False
                with (
                    patch("ctypes.WinDLL", return_value=kernel),
                    patch("ctypes.get_last_error", return_value=error_code),
                ):
                    with self.assertRaises(OSError) as raised:
                        with existing_project_lock(lock):
                            self.fail("Lock errors must not allow uncoordinated copies")
                self.assertEqual(raised.exception.winerror, error_code)
                kernel.UnlockFile.assert_not_called()
            with (
                patch("ctypes.WinDLL", return_value=kernel),
                patch("ctypes.get_last_error", return_value=33),
                patch("spool.projects.time.monotonic", side_effect=(0, 31)),
            ):
                with self.assertRaisesRegex(Conflict, "busy in another editor"):
                    with existing_project_lock(lock):
                        self.fail("Timed-out locks must not allow uncoordinated copies")
            kernel.UnlockFile.assert_not_called()
        self.assertEqual(len(opened), 4)
        self.assertTrue(all(handle.closed for handle in opened))

    def test_missing_snapshot_does_not_create_project_or_local_cache(self):
        folder = self.root / "missing"
        with patch("spool.projects.tempfile.TemporaryDirectory", side_effect=AssertionError("No missing copy")):
            with self.assertRaises(NotFound):
                ProjectStore(folder, migrate=False)
            with contextlib.redirect_stderr(io.StringIO()):
                for command in (maintenance.run, maintenance.run_prune):
                    with self.assertRaises(SystemExit):
                        command(["--storage", str(folder), "--json"])
        self.assertFalse(folder.exists())


if __name__ == "__main__":
    unittest.main()
