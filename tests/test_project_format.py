"""Schema-5 compatibility, compact storage and durable publication boundaries."""

import copy
import hashlib
import json
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from contextlib import closing
from unittest.mock import patch

from PIL import Image, PngImagePlugin

from spool import durable, ledger, maintenance, receipts, sidecars, take_workflow
from spool.projects import ProjectStore, Workspace
from spool.store import Conflict, SCHEMA_VERSION, Store, encode, read_only_uri
from pathlib import PurePosixPath, PureWindowsPath

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


def without_embedded_copies(value):
    """Compare the fields retained in routine reads against the schema-5 oracle."""
    if isinstance(value, list):
        return [without_embedded_copies(v) for v in value]
    if not isinstance(value, dict):
        return value
    result = {k: without_embedded_copies(v) for k, v in value.items() if k not in ("evidence", "embeddedGraph")}
    if result.get("kind") in ("image", "video", "audio"):
        result.pop("workflow", None)
        result.pop("prompt", None)
    history = result.get("history", {}).get("prompt")
    if isinstance(history, list) and len(history) > 3:
        history[3].get("extra_pnginfo", {}).pop("workflow", None)
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

    def media_file(self):
        artifact = self.expected["execution"]["receipt"]["primary"]
        tags = PngImagePlugin.PngInfo()
        for key in ("workflow", "prompt"):
            tags.add_text(key, json.dumps(artifact[key]))
        Image.new("RGB", (2, 2)).save(self.folder / "fixture.png", pnginfo=tags)

    def store(self):
        return Store(self.folder, filename="project.spool")

    def test_read_only_uris_open_shares_and_unusual_names(self):
        # SQLite refuses a URI host, so pathlib's file://server/share form fails for every UNC project.
        self.assertEqual(
            read_only_uri(PureWindowsPath("//server/share/projects/Shot #1/project.spool")),
            "file:////server/share/projects/Shot%20%231/project.spool?mode=ro&immutable=1",
        )
        self.assertEqual(
            read_only_uri(PureWindowsPath("C:/Spool/a%b/project.spool")),
            "file:///C:/Spool/a%25b/project.spool?mode=ro&immutable=1",
        )
        self.assertEqual(
            read_only_uri(PurePosixPath("/srv/x?y/p.spool")), "file:///srv/x%3Fy/p.spool?mode=ro&immutable=1"
        )
        folder = self.root / "Shot #1 50% done"
        folder.mkdir()
        with closing(sqlite3.connect(folder / "p.spool")) as db:
            db.execute("PRAGMA user_version=6")
        with closing(sqlite3.connect(read_only_uri(folder / "p.spool"), uri=True)) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 6)

    def test_fixture_migration_preserves_every_read_contract(self):
        self.media_file()
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
        self.assertEqual(without_embedded_copies(actual), without_embedded_copies(without_probe_tags(self.expected)))
        self.assertEqual(actual["export"], without_probe_tags(self.expected["export"]))
        self.assertEqual(actual["evidence"], without_probe_tags(self.expected["evidence"]))
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
        receipt = self.expected["execution"]["receipt"]
        self.assertTrue(store.accept_execution(self.attempt_id, "execution", None, receipt))
        changed = copy.deepcopy(receipt)
        changed["history"]["messages"].append(["different evidence"])
        with self.assertRaises(Conflict):
            store.accept_execution(self.attempt_id, "execution", None, changed)

    def test_history_tuple_keeps_exact_prompt_metadata_and_messages(self):
        self.media_file()
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
            self.assertEqual(store._load(packed, db, media="resolve"), without_probe_tags(value))
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

    def test_embedded_metadata_is_file_owned_for_every_reader(self):
        self.media_file()
        store = self.store()
        artifact = self.expected["execution"]["receipt"]["primary"]
        record = copy.deepcopy(artifact)
        record["workflowData"] = {key: record[key] for key in ("workflow", "prompt")}
        project = store.create({"clips": [{"id": "imported", "takes": [{"id": "take", "media": record}]}]})
        project_id = project["id"]
        with store.connect() as db:
            packed = db.execute("SELECT evidence FROM media_evidence WHERE project_id=?", (project_id,)).fetchone()[0]
            held = store._load(packed, db, media="references")
            self.assertIn("__spool_media__", held["workflow"])
            self.assertIn("__spool_media__", held["workflowData"]["workflow"])
            receipt = store._load(db.execute("SELECT result FROM attempts").fetchone()[0], db, media="references")
            self.assertIn("__spool_media__", receipt["artifacts"][0]["workflow"])
        # Replacing the embedded metadata proves these readers consult the file,
        # rather than returning an old graph from SQLite or a process cache.
        graph = {"nodes": [{"id": 1, "type": "SaveImage", "pos": [100, 200]}], "links": []}
        tags = PngImagePlugin.PngInfo()
        tags.add_text("workflow", json.dumps(graph))
        tags.add_text("prompt", json.dumps(artifact["prompt"]))
        Image.new("RGB", (2, 2)).save(self.folder / "fixture.png", pnginfo=tags)
        self.assertEqual(store.evidence(project_id, "media")["workflow"], graph)
        self.assertEqual(store.all_evidence(project_id)["media"]["workflowData"]["workflow"], graph)
        exported = store.export_project(project_id)["document"]["clips"][0]["takes"][0]["media"]
        self.assertEqual(exported["workflow"], graph)
        capture = take_workflow.resolve(store, project_id, "imported", "take")
        self.assertEqual(capture["workflow"], graph)
        sidecars.write(self.folder / "fixture.png", capture, lock_root=self.root / "locks")
        self.assertEqual(sidecars.read(self.folder / "fixture.png")["workflow"], graph)
        (self.folder / "fixture.json").unlink()
        (self.folder / "fixture.png").unlink()
        self.assertEqual(store.get(project_id)["id"], project_id)
        for reader in (
            lambda: store.evidence(project_id, "media"),
            lambda: store.all_evidence(project_id),
            lambda: store.export_project(project_id),
            lambda: take_workflow.resolve(store, project_id, "imported", "take"),
        ):
            with self.assertRaisesRegex(ValueError, "Source media is missing"):
                reader()

    def test_video_evidence_reads_container_metadata(self):
        from spool.system import find_tool

        store = self.store()
        artifact = copy.deepcopy(self.expected["execution"]["receipt"]["primary"])
        artifact["file"] = artifact["originalFile"] = "fixture.mp4"
        artifact["kind"] = "video"
        metadata = {key: artifact[key] for key in ("workflow", "prompt")}
        subprocess.run(
            [
                find_tool("ffmpeg"),
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=s=16x16:r=24",
                "-t",
                "0.125",
                "-metadata",
                "comment=" + json.dumps(metadata),
                "-movflags",
                "use_metadata_tags",
                str(self.folder / "fixture.mp4"),
            ],
            check=True,
            capture_output=True,
        )
        project = store.create({"clips": [], "media": [artifact]})
        for key, value in metadata.items():
            self.assertEqual(store.evidence(project["id"], "media")[key], value)
        self.assertEqual(store.all_evidence(project["id"])["media"]["workflow"], metadata["workflow"])

    def test_independent_sidecar_values_stay_stored(self):
        self.media_file()
        store = self.store()
        artifact = copy.deepcopy(self.expected["execution"]["receipt"]["primary"])
        prepared = {key: artifact.pop(key) for key in ("workflow", "prompt")}
        artifact["workflowData"] = {**prepared, "sidecar": {"name": "fixture.json"}}
        project = store.create({"clips": [], "media": [artifact]})
        (self.folder / "fixture.png").unlink()
        self.assertEqual(store.evidence(project["id"], "media")["workflowData"], artifact["workflowData"])

    def test_projection_shares_blobs_only_within_one_response(self):
        store = self.store()
        first = store.get(self.project_id)
        compact = ledger.editor_project(first)["document"]["clips"][0]["takes"][0]
        self.assertTrue(compact["media"]["embeddedGraph"])
        self.assertIn("workflow", compact["media"]["evidence"])
        first["document"]["clips"][0]["takes"][0]["request"]["capture"]["workflow"]["nodes"].clear()
        self.assertEqual(store.get(self.project_id)["recipes"], self.expected["get"]["recipes"])
        self.assertTrue(
            store.projected(self.project_id)["clips"][0]["takes"][0]["workflowSnapshot"]["workflow"]["nodes"]
        )

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

    def test_interrupted_commit_or_publication_discards_unpublished_working_state(self):
        connect = sqlite3.connect

        class InterruptedCommit(sqlite3.Connection):
            def commit(self):
                super().commit()
                if self.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
                    raise KeyboardInterrupt("Committed but not published")

            def __exit__(self, *args):
                committed = self.in_transaction and args[0] is None
                result = super().__exit__(*args)
                if committed and self.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
                    raise KeyboardInterrupt("Committed but not published")
                return result

        for operation in ("write", "migration"):
            for interruption in ("commit", "replace"):
                with self.subTest(operation=operation, interruption=interruption):
                    folder = self.root / (operation + "-" + interruption)
                    folder.mkdir()
                    shutil.copyfile(FIXTURES / "project-schema5.spool", folder / "project.spool")
                    workspace = Workspace(self.root / (folder.name + "-workspace"))
                    store = ProjectStore(folder, workspace, migrate=False, writable=True)
                    # Prime a valid checkpoint, including for the schema-5 snapshot.
                    with store.connect():
                        pass
                    if operation == "write":
                        store = ProjectStore(folder, workspace)
                    before = store.snapshot.read_bytes()

                    def interrupted_connect(path, *args, **kwargs):
                        if path == store.runtime:
                            kwargs["factory"] = InterruptedCommit
                        return connect(path, *args, **kwargs)

                    failure = (
                        patch("spool.projects.sqlite3.connect", interrupted_connect)
                        if interruption == "commit"
                        else patch(
                            "spool.projects.atomic_replace", side_effect=KeyboardInterrupt("Publication stopped")
                        )
                    )
                    with failure, self.assertRaises(KeyboardInterrupt):
                        if operation == "migration":
                            ProjectStore(folder, workspace)
                        else:
                            project = store.get(self.project_id)
                            project["document"]["project"] = "Unpublished edit"
                            store.save(self.project_id, project["revision"], project["document"])
                    self.assertEqual(store.snapshot.read_bytes(), before)
                    with patch.object(Store, "_migration6", autospec=True, side_effect=Store._migration6) as migrate:
                        reopened = ProjectStore(folder, workspace)
                    self.assertEqual(migrate.call_count, int(operation == "migration"))
                    project = reopened.get(self.project_id)
                    self.assertEqual(project["document"]["project"], self.expected["get"]["document"]["project"])
                    self.assertEqual(reopened.attempt(self.attempt_id)["request"], self.expected["attempt"]["request"])
                    published = Store(folder, migrate=False, filename="project.spool").get(self.project_id)
                    self.assertEqual(project["document"], published["document"])
                    with reopened.connect() as db:
                        working = reopened._load(db.execute("SELECT document FROM projects").fetchone()[0], db)
                    self.assertEqual(working["project"], published["document"]["project"])
                    self.assertEqual(json.loads(reopened.stamp.read_text()), reopened.signature())

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
