"""Schema-5 compatibility, compact storage and durable publication boundaries."""

import copy
import hashlib
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch

from spool import durable, maintenance, receipts
from spool.projects import ProjectStore, Workspace
from spool.store import Conflict, SCHEMA_VERSION, Store, encode

FIXTURES = Path(__file__).parent / "fixtures"


def without_probe_tags(value):
    if isinstance(value, list):
        return [without_probe_tags(v) for v in value]
    if not isinstance(value, dict):
        return value
    result = {k: without_probe_tags(v) for k, v in value.items()}
    if isinstance(result.get("probe"), dict) and isinstance(result["probe"].get("format"), dict):
        result["probe"]["format"].pop("tags", None)
    return result


class ProjectFormatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / "project"
        self.folder.mkdir()
        self.path = self.folder / "project.spool"
        shutil.copyfile(FIXTURES / "project-schema5.spool", self.path)
        self.expected = json.loads((FIXTURES / "project-schema5-reads.json").read_text(encoding="utf-8"))
        self.project_id = self.expected["get"]["id"]
        self.attempt_id = self.expected["attempt"]["id"]

    def store(self):
        return Store(self.folder, filename="project.spool")

    def test_fixture_migration_preserves_every_read_contract(self):
        store = self.store()
        actual = {
            "get": store.get(self.project_id),
            "projected": store.projected(self.project_id),
            "attempt": store.attempt(self.attempt_id),
            "scan_attempts": store.scan_attempts(),
            "export": store.export_project(self.project_id),
            "evidence": store.all_evidence(self.project_id),
            "execution": store.execution("execution"),
            "dispatch": store.dispatch_record(self.attempt_id),
        }
        # Attempt.result remains a JSON string; compare its decoded value too.
        for values in (actual, self.expected):
            for row in [values["attempt"], *values["scan_attempts"]]:
                row["result"] = json.loads(row["result"])
        self.assertEqual(actual, without_probe_tags(self.expected))
        self.assertEqual(
            store.evidence(self.project_id, "media")["workflow"],
            self.expected["execution"]["receipt"]["primary"]["workflow"],
        )
        with store.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], SCHEMA_VERSION)
            request = json.loads(db.execute("SELECT request FROM attempts").fetchone()[0])
            capture = json.loads(db.execute("SELECT capture FROM workflows").fetchone()[0])
            self.assertEqual(request["capture"], capture)
            result = db.execute("SELECT result FROM attempts").fetchone()[0]
            self.assertEqual(result, db.execute("SELECT receipt FROM executions").fetchone()[0])
            receipt = json.loads(
                db.execute("SELECT data FROM blobs WHERE hash=?", (json.loads(result)["__spool_blob__"],)).fetchone()[0]
            )
            self.assertNotIn("primary", receipt)
            self.assertEqual(receipt["primaryArtifactId"], "artifact")
            for row in db.execute("SELECT hash,data FROM blobs"):
                self.assertEqual(row[0], hashlib.sha256(encode(json.loads(row[1])).encode()).hexdigest())

    def test_blob_reads_are_independent_and_receipt_conflicts_compare_hashes(self):
        store = self.store()
        first = store.attempt(self.attempt_id)
        original = copy.deepcopy(first)
        first["request"]["capture"]["workflow"]["nodes"].clear()
        self.assertEqual(store.attempt(self.attempt_id), original)
        receipt = store.execution("execution")["receipt"]
        self.assertTrue(store.accept_execution(self.attempt_id, "execution", None, receipt))
        changed = copy.deepcopy(receipt)
        changed["history"]["messages"].append(["different evidence"])
        with self.assertRaises(Conflict):
            store.accept_execution(self.attempt_id, "execution", None, changed)

    def test_history_tuple_keeps_exact_prompt_metadata_and_messages(self):
        store = self.store()
        value = self.expected["execution"]["receipt"]
        value["history"]["prompt"] = [
            7,
            "exact-prompt",
            {"node": {"inputs": {"seed": 2**64 - 1}}},
            {"extra_pnginfo": {"workflow": {"nodes": []}}},
            ["node"],
        ]
        with store.connect() as db:
            packed = store._dump(db, value, receipt=True)
            self.assertEqual(store._load(packed, db), without_probe_tags(value))
            compact = json.loads(
                db.execute("SELECT data FROM blobs WHERE hash=?", (json.loads(packed)["__spool_blob__"],)).fetchone()[0]
            )
            self.assertNotIn("prompt", compact["history"])

    def test_probe_metadata_is_extracted_before_tags_are_removed(self):
        store = self.store()
        graph = {"nodes": [{"id": 1, "type": "SaveImage"}]}
        prompt = {"1": {"class_type": "SaveImage", "inputs": {}}}
        value = {
            "probe": {
                "streams": [{"codec_type": "video"}],
                "format": {"duration": "1", "tags": {"comment": json.dumps({"workflow": graph, "prompt": prompt})}},
            }
        }
        original = copy.deepcopy(value)
        with store.connect() as db:
            result = store._load(store._dump(db, value), db)
        self.assertEqual(value, original)
        self.assertEqual(result, {**without_probe_tags(value), "workflow": graph, "prompt": prompt})
        project = store.create({"clips": [], "media": [{"id": "tagged", "kind": "video", **value}]})
        record = project["document"]["media"][0]
        self.assertEqual(record["evidence"], ["probe", "workflow", "prompt"])
        self.assertTrue(record["embeddedGraph"])

    def test_interrupted_step_rolls_back_and_reopens_cleanly(self):
        original = Store._dump
        calls = []

        def interrupt(store, db, value, **kwargs):
            packed = original(store, db, value, **kwargs)
            calls.append(packed)
            if len(calls) == 3:
                raise RuntimeError("interrupted")
            return packed

        with patch.object(Store, "_dump", interrupt), self.assertRaisesRegex(RuntimeError, "interrupted"):
            self.store()
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 5)
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='blobs'").fetchone())
        self.assertEqual(self.store().attempt(self.attempt_id)["request"], self.expected["attempt"]["request"])

    def test_project_upgrade_keeps_published_backup_and_writes_manifest(self):
        before = self.path.read_bytes()
        workspace = Workspace(self.root / "workspace")
        ProjectStore(self.folder, workspace)
        backups = list((self.folder / ".spool/backups").glob("project-schema5-*.spool"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)
        manifest = json.loads((self.folder / "project.json").read_text())
        self.assertEqual(
            manifest,
            {
                "format": "spool-project",
                "formatVersion": SCHEMA_VERSION,
                "projectId": self.project_id,
                "writtenBy": "0.1.0",
            },
        )

    def test_newer_manifest_refuses_before_sqlite_or_directory_creation(self):
        durable.atomic_json(self.folder / "project.json", {"format": "spool-project", "formatVersion": 999})
        before = set(self.folder.rglob("*"))
        with patch("spool.projects.sqlite3.connect", side_effect=AssertionError("Must read manifest first")):
            with self.assertRaisesRegex(ValueError, "newer extension"):
                ProjectStore(self.folder)
        self.assertEqual(set(self.folder.rglob("*")), before)

    def test_newer_sqlite_without_manifest_also_refuses_without_writes(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("PRAGMA user_version=999")
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ValueError, "newer extension"):
            ProjectStore(self.folder)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.folder.iterdir()), [self.path])

    def test_current_folder_without_manifest_gets_one_on_next_write(self):
        self.store()
        workspace = Workspace(self.root / "workspace")
        store = ProjectStore(self.folder, workspace)
        self.assertFalse(store.manifest.exists())
        current = store.get(self.project_id)
        store.save(self.project_id, current["revision"], current["document"])
        self.assertEqual(json.loads(store.manifest.read_text())["formatVersion"], SCHEMA_VERSION)

    def test_failed_project_migration_keeps_the_published_snapshot(self):
        before = self.path.read_bytes()
        workspace = Workspace(self.root / "workspace")
        with patch.object(Store, "_migration6", side_effect=RuntimeError("interrupted")):
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                ProjectStore(self.folder, workspace)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse((self.folder / "project.json").exists())
        store = ProjectStore(self.folder, workspace)
        self.assertEqual(store.attempt(self.attempt_id)["request"], self.expected["attempt"]["request"])

    def test_maintenance_reports_do_not_migrate_create_or_recover(self):
        before = {p.relative_to(self.folder): p.read_bytes() for p in self.folder.rglob("*") if p.is_file()}
        with patch("spool.projects.take_files.recover", side_effect=AssertionError("Must not recover")):
            for run in (maintenance.run, maintenance.run_prune):
                self.assertEqual(run(["--storage", str(self.folder), "--json"]), 0)
        self.assertEqual(
            {p.relative_to(self.folder): p.read_bytes() for p in self.folder.rglob("*") if p.is_file()}, before
        )
        self.assertFalse((self.folder / ".spool").exists())

    def test_unknown_export_version_refuses_before_any_write(self):
        store = self.store()
        workspace = Workspace(self.root / "workspace")
        for version in (0, 2, "1", True, None):
            value = {"spoolVersion": version, "document": {"clips": []}}
            with patch.object(store, "connect", side_effect=AssertionError("No writes allowed")):
                with self.assertRaisesRegex(ValueError, "export version"):
                    store.import_project(value)
            with patch("spool.projects.tempfile.mkdtemp", side_effect=AssertionError("No folders allowed")):
                with self.assertRaisesRegex(ValueError, "export version"):
                    workspace.import_project(value)


class DurableWriteTests(unittest.TestCase):
    def test_fsync_precedes_unique_atomic_replace_and_failures_clean_up(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "receipt.json"
            target.write_bytes(b"old")
            events, pending_names = [], []
            replace = durable.atomic_replace

            def publish(pending, path):
                self.assertEqual(events[-1], "fsync")
                self.assertEqual(target.read_bytes(), b"old")
                pending_names.append(pending.name)
                events.append("replace")
                replace(pending, path)

            with patch.object(durable.os, "fsync", side_effect=lambda fd: events.append("fsync")):
                with patch.object(durable, "atomic_replace", publish):
                    durable.write(target, b"new")
                self.assertEqual(target.read_bytes(), b"new")
                with patch.object(durable, "atomic_replace", side_effect=OSError("disconnected")):
                    with self.assertRaises(OSError):
                        durable.write(target, b"lost")
            self.assertEqual(target.read_bytes(), b"new")
            self.assertEqual(list(Path(folder).glob("*.partial")), [])
            self.assertNotEqual(pending_names[0], "receipt.partial")

    def test_local_schema2_is_compact_and_schema1_remains_readable(self):
        # Reuse real artifact verification, including checksums and containment.
        from test_receipts import ReceiptTests

        fixture = ReceiptTests()
        fixture.setUp()
        try:
            on_disk = json.loads(fixture.path.read_text())
            self.assertEqual(on_disk["schemaVersion"], 2)
            self.assertNotIn("primary", on_disk)
            self.assertEqual(receipts.verify(fixture.attempt, fixture.path, fixture.media), fixture.receipt)
            fixture.corrupt(lambda value: None)  # writes and verifies schema 1
        finally:
            fixture.tearDown()


if __name__ == "__main__":
    unittest.main()
