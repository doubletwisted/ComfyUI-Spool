"""A publication is identified by its contents, not by a timestamp that may repeat."""

import json
import os
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing, contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import spool.projects as projects
from spool.projects import ProjectStore, Workspace
from spool.store import Conflict


class SnapshotPublicationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.folder = self.root / "projects" / "Film"
        self.writer = Workspace(self.root / "writer")
        self.project = self.writer.create({"project": "Alpha", "clips": [], "media": []}, self.folder)
        self.project_id = self.project["id"]
        self.reader = Workspace(self.root / "reader")
        opened = self.reader.open_folder(self.folder)
        self.assertEqual(opened["document"]["project"], "Alpha")
        # FAT32/HFS+ round timestamps to one or two seconds. Pinning the mtime to the
        # value a reader already knows reproduces the stale-cache case on every filesystem.
        self.baseline = self.snapshot().stat()

    def snapshot(self):
        return self.folder / "project.spool"

    def manifest(self):
        return self.folder / "project.json"

    def save(self, workspace, name):
        store = workspace.for_project(self.project_id)
        current = store.get(self.project_id)
        return store.save(self.project_id, current["revision"], {**current["document"], "project": name})

    def flatten_timestamp(self):
        os.utime(self.snapshot(), ns=(self.baseline.st_atime_ns, self.baseline.st_mtime_ns))
        stat = self.snapshot().stat()
        self.assertEqual((stat.st_mtime_ns, stat.st_size), (self.baseline.st_mtime_ns, self.baseline.st_size))

    @contextmanager
    def fixed_stat_identity(self, *, coarse=True):
        """Model a share that reports the same identity for every replacement."""
        original = Path.stat
        fixed = {
            name: getattr(self.baseline, name) for name in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        }
        for name in ("st_mtime_ns", "st_ctime_ns"):
            fixed[name] = fixed[name] // 1_000_000 * 1_000_000 + (0 if coarse else 123)

        def stat(path, *args, **kwargs):
            result = original(path, *args, **kwargs)
            if path == self.snapshot():
                values = {name: getattr(result, name) for name in dir(result) if name.startswith("st_")}
                return SimpleNamespace(**{**values, **fixed})
            return result

        with patch.object(Path, "stat", stat):
            yield

    def test_publication_uuid_alone_detects_replacement_with_every_stat_field_fixed(self):
        store = self.reader.for_project(self.project_id)
        with self.fixed_stat_identity():
            before = store.signature()
            self.assertEqual(store.get(self.project_id)["revision"], 0)
            self.save(self.writer, "Bravo")
            after = store.signature()
            self.assertEqual(after[:-1], before[:-1])
            self.assertNotEqual(after[-1], before[-1])
            self.assertEqual(store.get(self.project_id)["document"]["project"], "Bravo")
            with self.assertRaises(Conflict):
                store.save(self.project_id, 0, {**self.project["document"], "project": "Stale"})

    def test_only_high_resolution_unchanged_identities_reuse_the_marker_cache(self):
        store = self.reader.for_project(self.project_id)
        for coarse, expected_reads in ((False, 1), (True, 5)):
            with self.subTest(coarse=coarse), self.fixed_stat_identity(coarse=coarse):
                store.publication_cache = None
                with patch.object(store, "read_publication", wraps=store.read_publication) as read:
                    signatures = [store.signature() for _ in range(5)]
                self.assertTrue(all(signature == signatures[0] for signature in signatures))
                self.assertEqual(read.call_count, expected_reads)

    def test_a_present_marker_table_without_an_identity_is_not_a_legacy_snapshot(self):
        store = self.reader.for_project(self.project_id)
        with closing(sqlite3.connect(self.snapshot())) as db, db:
            db.execute("DELETE FROM spool_publication")
        with (
            self.fixed_stat_identity(),
            self.assertRaisesRegex(sqlite3.DatabaseError, "identity is missing or invalid"),
        ):
            with store.connect():
                pass

    def test_marker_read_errors_cannot_authorize_a_stale_runtime_save(self):
        store = self.reader.for_project(self.project_id)
        original = sqlite3.connect
        snapshot_uri = projects.read_only_uri(self.snapshot())

        class FailedMarker:
            def __init__(self, db):
                self.db = db

            def execute(self, sql, *args):
                if sql.startswith("SELECT publication FROM spool_publication"):
                    raise sqlite3.OperationalError("Injected marker disk I/O error")
                return self.db.execute(sql, *args)

            def close(self):
                self.db.close()

        def connect(path, *args, **kwargs):
            db = original(path, *args, **kwargs)
            return FailedMarker(db) if path == snapshot_uri else db

        failures = []
        with self.fixed_stat_identity():
            with patch.object(projects.sqlite3, "connect", connect):
                try:
                    with store.connect():
                        pass
                except sqlite3.Error as error:
                    failures.append(error)
            self.save(self.writer, "Bravo")
            with patch.object(projects.sqlite3, "connect", connect):
                try:
                    store.save(self.project_id, 0, {**self.project["document"], "project": "Stale"})
                except sqlite3.Error as error:
                    failures.append(error)
            # With the old fallback both failed reads become the same trusted None
            # identity, so the second operation publishes revision zero over Bravo.
            self.assertEqual(self.writer.get(self.project_id)["document"]["project"], "Bravo")
            self.assertEqual(len(failures), 2)
            self.assertTrue(all("Injected marker" in str(error) for error in failures))
            self.assertEqual(store.get(self.project_id)["document"]["project"], "Bravo")

    def test_a_paused_marker_handle_serializes_with_snapshot_replacement(self):
        store = self.reader.for_project(self.project_id)
        writer_store = self.writer.for_project(self.project_id)
        store.publication_cache = None
        opened = threading.Event()
        release = threading.Event()
        writer_waiting = threading.Event()
        writer_done = threading.Event()
        replacing = threading.Event()
        errors = []
        observed = []
        original_connect = sqlite3.connect
        original_lock = projects.file_lock
        original_replace = projects.atomic_replace
        snapshot_uri = projects.read_only_uri(self.snapshot())

        class PausedMarker:
            def __init__(self, db):
                self.db = db

            def execute(self, sql, *args):
                if sql.startswith("SELECT publication FROM spool_publication"):
                    opened.set()
                    if not release.wait(10):
                        raise RuntimeError("Paused marker read was not released")
                return self.db.execute(sql, *args)

            def close(self):
                self.db.close()

        def connect(path, *args, **kwargs):
            db = original_connect(path, *args, **kwargs)
            if path == snapshot_uri and threading.current_thread().name == "marker-reader":
                return PausedMarker(db)
            return db

        @contextmanager
        def file_lock(path):
            if path == writer_store.lock_file and threading.current_thread().name == "snapshot-writer":
                writer_waiting.set()
            with original_lock(path):
                yield

        def replace(pending, target):
            if target == self.snapshot():
                replacing.set()
            return original_replace(pending, target)

        def reader():
            try:
                observed.append(store.signature())
            except Exception as error:
                errors.append(error)

        def writer():
            try:
                self.save(self.writer, "Bravo")
            except Exception as error:
                errors.append(error)
            finally:
                writer_done.set()

        threads = [
            threading.Thread(target=reader, name="marker-reader"),
            threading.Thread(target=writer, name="snapshot-writer"),
        ]
        with (
            patch.object(projects.sqlite3, "connect", connect),
            patch.object(projects, "file_lock", file_lock),
            patch.object(projects, "atomic_replace", replace),
        ):
            try:
                threads[0].start()
                self.assertTrue(opened.wait(5), "Reader must hold an actual SQLite snapshot handle")
                threads[1].start()
                self.assertTrue(writer_waiting.wait(5), "Writer must attempt the project lock")
                # Longer than atomic_replace's Windows sharing-violation retry budget:
                # the writer must wait before replacement, not exhaust that retry.
                self.assertFalse(writer_done.wait(2.5), "Publication must wait for the marker handle to close")
                self.assertFalse(replacing.is_set(), "Replacement must not run against an open marker handle")
            finally:
                release.set()
                for thread in threads:
                    if thread.ident is not None:
                        thread.join(10)
        self.assertTrue(all(not thread.is_alive() for thread in threads), "Nested project locks must not deadlock")
        self.assertEqual(errors, [])
        self.assertEqual(len(observed), 1)
        self.assertTrue(replacing.is_set())
        self.assertEqual(self.writer.get(self.project_id)["document"]["project"], "Bravo")

    def test_same_size_and_timestamp_publications_are_visible_to_another_workspace(self):
        reader_store = self.reader.for_project(self.project_id)
        state = reader_store.sync_state(self.project_id)
        self.assertEqual(state["revision"], 0)
        previous = reader_store.signature()
        previous_publication = reader_store.signature()[-1]
        for revision, name in enumerate(("Bravo", "Cello", "Delta"), start=1):
            with self.subTest(revision=revision):
                self.save(self.writer, name)
                self.flatten_timestamp()
                publication = reader_store.signature()[-1]
                self.assertNotEqual(publication, previous_publication)
                self.assertNotEqual(reader_store.signature(), previous)
                self.assertEqual(reader_store.get(self.project_id)["document"]["project"], name)
                self.assertEqual(reader_store.sync_state(self.project_id)["revision"], revision)
                previous, previous_publication = reader_store.signature(), publication

    def test_two_independent_writers_alternate_with_the_same_timestamp_and_size(self):
        other = Workspace(self.root / "other-writer")
        other.open_folder(self.folder)
        for revision, (workspace, name) in enumerate(
            ((self.writer, "Bravo"), (other, "Cello"), (self.writer, "Delta")), start=1
        ):
            with self.subTest(revision=revision):
                self.assertEqual(self.save(workspace, name)["revision"], revision)
                self.flatten_timestamp()
                self.assertEqual(
                    Workspace(self.root / ("observer-%d" % revision)).open_folder(self.folder)["document"]["project"],
                    name,
                )

    def test_a_reader_holding_an_old_revision_cannot_overwrite_the_publication(self):
        opened = self.reader.open_folder(self.folder)
        old_document, old_revision = opened["document"], opened["revision"]
        self.save(self.writer, "Bravo")
        self.flatten_timestamp()
        reader_store = self.reader.for_project(self.project_id)
        with self.assertRaises(Conflict):
            reader_store.save(self.project_id, old_revision, {**old_document, "project": "Stale"})
        self.assertEqual(reader_store.get(self.project_id)["document"]["project"], "Bravo")
        self.assertEqual(self.writer.for_project(self.project_id).get(self.project_id)["document"]["project"], "Bravo")

    def test_a_legacy_snapshot_and_manifest_still_read_and_gain_an_identity(self):
        # A folder written before this change has no marker in its snapshot and the old
        # four-field manifest. A reader must still open it.
        with closing(sqlite3.connect(self.snapshot())) as db, db:
            db.execute("DROP TABLE spool_publication")
        value = json.loads(self.manifest().read_text(encoding="utf-8"))
        self.assertEqual(set(value), {"format", "formatVersion", "projectId", "writtenBy"})
        value["writtenByFutureSpool"] = {"ignored": True}
        self.manifest().write_text(json.dumps(value), encoding="utf-8")

        legacy = Workspace(self.root / "legacy-reader")
        opened = legacy.open_folder(self.folder)
        store = legacy.for_project(self.project_id)
        self.assertEqual(opened["document"]["project"], "Alpha")
        self.assertIsNone(store.signature()[-1])

        self.save(self.writer, "Bravo")
        self.flatten_timestamp()
        self.assertEqual(store.get(self.project_id)["document"]["project"], "Bravo")
        self.assertIsInstance(store.signature()[-1], str)
        written = json.loads(self.manifest().read_text(encoding="utf-8"))
        self.assertEqual(set(written), {"format", "formatVersion", "projectId", "writtenBy"})

    def test_a_failed_publication_keeps_the_previous_snapshot_and_identity(self):
        store = self.reader.for_project(self.project_id)
        before = store.signature()
        snapshot = self.snapshot().read_bytes()
        manifest = self.manifest().read_bytes()
        original = projects.atomic_replace

        def disconnected(pending, target):
            if Path(target) == self.snapshot():
                raise OSError("Share disconnected")
            return original(pending, target)

        with patch("spool.projects.atomic_replace", side_effect=disconnected):
            with self.assertRaisesRegex(OSError, "Share disconnected"):
                self.save(self.writer, "Bravo")
        self.assertEqual(self.snapshot().read_bytes(), snapshot)
        self.assertEqual(self.manifest().read_bytes(), manifest)
        self.assertEqual(store.signature(), before)
        self.assertEqual(store.get(self.project_id)["document"]["project"], "Alpha")

        self.save(self.writer, "Cello")
        self.flatten_timestamp()
        self.assertEqual(store.get(self.project_id)["document"]["project"], "Cello")

    def test_a_crash_between_snapshot_and_manifest_does_not_leave_a_stale_identity(self):
        store = self.reader.for_project(self.project_id)
        before = store.signature()
        manifest = self.manifest().read_bytes()

        def disconnected(store, db):
            raise OSError("Manifest share disconnected")

        with patch.object(ProjectStore, "write_manifest", disconnected):
            with self.assertRaisesRegex(OSError, "Manifest share disconnected"):
                self.save(self.writer, "Bravo")
        # The snapshot was replaced atomically, so it is the new publication even though
        # the manifest and the local checkpoint were not updated.
        self.assertEqual(self.manifest().read_bytes(), manifest)
        self.assertNotEqual(store.signature(), before)
        self.assertEqual(Workspace(self.root / "after-crash").open_folder(self.folder)["document"]["project"], "Bravo")

        reopened = Workspace(self.root / "after-crash").for_project(self.project_id)
        self.assertIsInstance(reopened.signature()[-1], str)
        with self.assertRaises(Conflict):
            reopened.save(self.project_id, 0, {"project": "Stale", "clips": [], "media": []})
        self.assertEqual(reopened.get(self.project_id)["document"]["project"], "Bravo")


if __name__ == "__main__":
    unittest.main()
