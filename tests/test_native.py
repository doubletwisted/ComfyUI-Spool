import asyncio
import copy
import importlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from PIL import Image

package = types.ModuleType("native_spool")
package.__path__ = [str(Path(__file__).resolve().parent.parent)]
sys.modules[package.__name__] = package
store_module = importlib.import_module("native_spool.spool.store")
media_module = importlib.import_module("native_spool.spool.media")
execution_module = importlib.import_module("native_spool.spool.execution")
targets_module = importlib.import_module("native_spool.spool.execution_targets")
receipts_module = importlib.import_module("native_spool.spool.receipts")
ledger_module = importlib.import_module("native_spool.spool.ledger")
wire_module = importlib.import_module("native_spool.spool.wire")
Store, Conflict = store_module.Store, store_module.Conflict


def clip(identity="clip-a"):
    return {
        "id": identity,
        "name": identity,
        "revision": 1,
        "count": 1,
        "in": 0,
        "out": 24,
        "takeId": "original",
        "takes": [
            {"id": "original", "number": 1, "media": {"file": "assets/black.png", "kind": "image", "frames": 120}}
        ],
    }


def capture():
    return {
        "workflow": {"nodes": [{"id": 194, "type": "Subgraph"}]},
        "prompt": {
            "194:45": {"class_type": "LoadImage", "inputs": {"image": "original.png"}},
            "194:46": {"class_type": "SaveImage", "inputs": {"images": ["194:45", 0], "filename_prefix": "saved"}},
        },
        "bindings": [],
        "result": {"nodeId": "194:46", "group": "images", "index": 0},
    }


class Queue:
    def __init__(self):
        self.pending, self.running, self.history = [], [], {}

    def put(self, item):
        self.pending.append(item)

    def get_current_queue(self):
        return self.running, self.pending

    def get_history(self, prompt_id):
        return {prompt_id: self.history[prompt_id]} if prompt_id in self.history else {}

    def delete_queue_item(self, function):
        self.pending = [item for item in self.pending if not function(item)]


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.store = Store(root / "store")
        for name in ("input", "output", "temp"):
            (root / name).mkdir()
        Image.new("RGB", (8, 8), "red").save(root / "input" / "original.png")
        self.media = media_module.Media(self.store.root, root / "input", root / "output", root / "temp")
        self.root = root
        document = store_module.empty_project()
        document["clips"] = [clip()]
        self.project = self.store.create(document)
        self.base = capture()
        self.project = self.store.capture(self.project["id"], 0, "clip-a", self.base)
        self.queue = Queue()
        self.server = types.SimpleNamespace(
            number=0,
            prompt_queue=self.queue,
            node_replace_manager=types.SimpleNamespace(apply_replacements=lambda prompt: None),
            trigger_on_prompt=lambda value: value,
        )

        async def validate(identity, prompt, targets):
            return True, None, ["194:46"], {}

        self.executor = execution_module.LocalExecutor(self.store, self.media, self.server, validate)

    def tearDown(self):
        self.temp.cleanup()

    def submit(self):
        return asyncio.run(
            self.executor.queue(self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        )

    def test_cancel_drops_queued_local_work_and_interrupts_only_its_own_running_prompt(self):
        commands_module = importlib.import_module("native_spool.spool.commands")
        interrupts = []
        self.executor.interrupt = lambda: interrupts.append(True)

        def cancel(attempt_id, identity):
            project = self.store.get(self.project["id"])
            return commands_module.execute(
                self.store,
                self.media,
                self.project["id"],
                {
                    "operationId": identity,
                    "revision": project["revision"],
                    "actor": "human",
                    "scope": {"projectId": self.project["id"], "clipIds": ["clip-a"], "capabilities": ["cancel"]},
                    "action": "cancel",
                    "arguments": {"attemptId": attempt_id},
                },
            )

        queued = self.submit()["document"]["jobs"][-1]["id"]
        self.assertEqual(self.store.attempt(queued)["status"], "queued")
        self.assertEqual(cancel(queued, "cancel-queued")["status"], "cancel_requested")
        asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(queued)["status"], "cancelled")
        self.assertEqual(self.queue.pending, [])
        self.assertEqual(interrupts, [])

        running = self.submit()["document"]["jobs"][-1]["id"]
        self.queue.running, self.queue.pending = self.queue.pending, []
        cancel(running, "cancel-running")
        asyncio.run(self.executor.reconcile())
        self.assertEqual((self.store.attempt(running)["status"], len(interrupts)), ("cancel_requested", 1))
        prompt_id = self.store.attempt(running)["prompt_id"]
        self.queue.running = []
        self.queue.history[prompt_id] = {"status": {"completed": False, "status_str": "error"}, "outputs": {}}
        asyncio.run(self.executor.reconcile())
        self.assertEqual((self.store.attempt(running)["status"], len(interrupts)), ("cancelled", 1))

        finished = self.submit()["document"]["jobs"][-1]["id"]
        self.queue.pending = []
        cancel(finished, "cancel-finished")
        self.queue.history[self.store.attempt(finished)["prompt_id"]] = {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {},
        }
        asyncio.run(self.executor.reconcile())
        self.assertNotIn(self.store.attempt(finished)["status"], ("cancel_requested", "cancelled"))
        self.assertEqual(len(interrupts), 1)

    def test_cloud_key_is_private_execution_data_and_never_saved_in_project(self):
        with patch.object(targets_module, "cloud_key", return_value="comfyui-private-fixture"):
            result = self.submit()
        self.assertEqual(self.queue.pending[0][5], {"api_key_comfy_org": "comfyui-private-fixture"})
        self.assertNotIn("api_key_comfy_org", self.queue.pending[0][3])
        attempt_id = result["document"]["jobs"][0]["id"]
        self.assertNotIn("comfyui-private-fixture", json.dumps(self.store.dispatch_record(attempt_id)))
        self.assertNotIn("comfyui-private-fixture", json.dumps(result))
        self.assertNotIn("comfyui-private-fixture", json.dumps(self.store.attempt(attempt_id)["request"]))

    def test_result_only_workflow_validates_and_queues_only_selected_saver(self):
        captured = capture()
        captured["resultOnly"] = True
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", captured)
        targets_seen = []

        async def validate(identity, prompt, targets):
            targets_seen.append(targets)
            return True, None, targets, {}

        self.executor.validate = validate
        self.submit()
        self.assertEqual(targets_seen, [["194:46"]])
        self.assertEqual(self.queue.pending[0][4], ["194:46"])

    def success(self, attempt_id, file_type="temp", filename="result.png"):
        Image.new("RGB", (8, 8), "blue").save(self.root / file_type / filename)
        attempt = self.store.attempt(attempt_id)
        self.queue.history[attempt["prompt_id"]] = {
            "prompt": [0, attempt["prompt_id"], attempt["request"]["prompt"]],
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"194:46": {"images": [{"filename": filename, "subfolder": "", "type": file_type}]}},
        }
        self.queue.pending = [x for x in self.queue.pending if x[1] != attempt["prompt_id"]]
        return attempt

    def build_v3_store(self, directory, rows=60):
        directory.mkdir()
        document = store_module.empty_project()
        document["clips"] = [clip()]
        encoded = store_module.encode(document)
        db = sqlite3.connect(directory / "spool.sqlite3")
        try:
            db.executescript(
                "CREATE TABLE projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);"
                "CREATE TABLE revisions(project_id TEXT, revision INTEGER, document TEXT NOT NULL, PRIMARY KEY(project_id,revision));"
                "PRAGMA user_version=3;"
            )
            db.execute("INSERT INTO projects VALUES('p',1,?)", (encoded,))
            for revision in range(rows):
                db.execute("INSERT INTO revisions VALUES('p',?,?)", (revision, encoded))
            db.commit()
        finally:
            db.close()
        return directory

    def free_pages(self, path):
        db = sqlite3.connect(path)
        try:
            return db.execute("PRAGMA freelist_count").fetchone()[0]
        finally:
            db.close()

    def test_restart_and_conflict(self):
        reopened = Store(self.store.root)
        self.assertEqual(reopened.get(self.project["id"]), self.project)
        with self.assertRaises(Conflict):
            reopened.save(self.project["id"], 0, self.project["document"])

    def test_retired_revision_ledger_is_never_created_and_never_read(self):
        # A save used to write a second full copy of the document into `revisions`,
        # which nothing in the extension ever read.
        with self.store.connect() as db:
            names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn("revisions", names)
        saved = self.store.save(self.project["id"], self.project["revision"], self.project["document"])
        self.assertEqual(saved["revision"], self.project["revision"] + 1)
        with self.store.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], store_module.SCHEMA_VERSION)
            self.assertEqual(
                db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='revisions'").fetchone()[0],
                0,
            )

    def test_scan_attempts_reads_attempts_without_decoding_a_document(self):
        # The 2 s receipt scan used to call list() and get() per project: on the real
        # store that decoded every project document 30 times a minute, forever.
        document = store_module.empty_project()
        document["media"] = [
            {
                "id": "media-1",
                "kind": "video",
                "name": "shot.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": []},
            }
        ]
        project = self.store.create(document)
        self.assertEqual(self.store.scan_attempts(), [])
        attempt = self.store.intent(
            project["id"],
            document["clips"][0] if document["clips"] else {"id": "c", "name": "c", "takes": []},
            {
                "target": "local",
                "capture": {"prompt": {"1": {"class_type": "KSampler", "inputs": {}}}},
                "inputValues": {},
            },
        )
        rows = self.store.scan_attempts()
        self.assertEqual([row["id"] for row in rows], [attempt["id"]])
        self.assertEqual(rows[0]["request"]["target"], "local")

    def test_narrow_reads_answer_without_the_ledger_or_recipes(self):
        document = store_module.empty_project()
        document["media"] = [
            {"id": "media-1", "kind": "video", "name": "shot.mp4", "file": "uploads/a.mp4", "frames": 24}
        ]
        document["clips"] = [clip()]
        project = self.store.create(document)
        self.assertTrue(self.store.exists(project["id"]))
        self.assertFalse(self.store.exists("absent"))
        self.assertEqual(self.store.revision(project["id"]), project["revision"])
        self.assertEqual(self.store.document(project["id"])["clips"][0]["id"], "clip-a")
        self.assertEqual(self.store.clip(project["id"], "clip-a")["name"], "clip-a")
        with self.assertRaises(ValueError):
            self.store.clip(project["id"], "absent")
        self.assertEqual([m["file"] for m in self.store.take_media(project["id"])], ["assets/black.png"])
        self.assertEqual(self.store.active_attempts(project["id"]), 0)
        with self.assertRaises(KeyError):
            self.store.document("absent")

    def test_prune_reports_and_only_evicts_unreferenced_previews(self):
        previews = self.store.root / "previews"
        previews.mkdir(exist_ok=True)
        (self.store.root / "uploads").mkdir(exist_ok=True)
        # One preview a document references, one nothing does, and an upload that may be
        # the only copy of something.
        referenced = previews / "shot-abc.mp4"
        referenced.write_bytes(b"referenced" * 100)
        orphan = previews / "shot-orphan.mp4"
        orphan.write_bytes(b"orphan" * 1000)
        upload = self.store.root / "uploads" / "original.mp4"
        upload.write_bytes(b"upload" * 100)
        document = store_module.empty_project()
        document["media"] = [
            {"id": "media-1", "kind": "video", "name": "shot.mp4", "file": "previews/shot-abc.mp4", "frames": 24}
        ]
        self.store.create(document)
        report = self.store.prune()
        self.assertEqual(report["unreferenced"], 1)
        self.assertGreaterEqual(report["unreferencedBytes"], 6000)
        self.assertEqual(report["evicted"], [])
        self.assertTrue(orphan.is_file(), "a report must not remove anything")
        # Over budget and past the grace window, the orphan goes and the referenced file stays.
        evicted = self.store.prune(confirm=True, budget=1, grace=0)
        self.assertEqual(evicted["evicted"], ["previews/shot-orphan.mp4"])
        self.assertFalse(orphan.exists())
        self.assertTrue(referenced.is_file(), "a referenced preview must survive")
        self.assertTrue(upload.is_file(), "uploads are never removed")
        self.assertEqual(evicted["folders"]["uploads"]["files"], 1)
        # The grace window protects a preview that is still being written.
        fresh = previews / "shot-fresh.mp4"
        fresh.write_bytes(b"fresh" * 1000)
        self.assertEqual(self.store.prune(confirm=True, budget=1, grace=600)["evicted"], [])
        self.assertTrue(fresh.is_file())

    def test_prune_evicts_disposable_cut_scores_but_preserves_source(self):
        scores = self.store.root / "previews" / "cut-scores" / "scan.json"
        scores.parent.mkdir(parents=True)
        scores.write_text('{"scores":[0,0.5]}')
        source = self.store.root / "uploads" / "source.mp4"
        source.parent.mkdir()
        source.write_bytes(b"original footage")
        report = self.store.prune()
        self.assertEqual(report["unreferenced"], 1)
        self.assertTrue(scores.is_file())
        self.assertEqual(
            self.store.prune(confirm=True, budget=0, grace=0)["evicted"], ["previews/cut-scores/scan.json"]
        )
        self.assertTrue(source.is_file())

    def test_project_listing_does_not_decode_documents(self):
        document = store_module.empty_project()
        document["project"] = "Listing QA"
        document["media"] = [
            {
                "id": "m",
                "kind": "video",
                "name": "a.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": []},
            }
        ]
        created = self.store.create(document)
        listed = self.store.list()
        entry = next(item for item in listed if item["id"] == created["id"])
        self.assertEqual(entry["name"], "Listing QA")
        self.assertEqual(entry["revision"], created["revision"])
        self.assertEqual(sorted(entry), ["id", "name", "revision"])
        self.assertEqual([item["id"] for item in listed][-1], created["id"], "newest project last")
        # A document without a name falls back rather than breaking the dialog.
        with self.store.connect() as db:
            db.execute("UPDATE projects SET document=? WHERE id=?", ('{"clips":[]}', created["id"]))
        self.assertEqual(
            next(item for item in self.store.list() if item["id"] == created["id"])["name"], "Untitled Spool project"
        )

    def test_narrow_reads_include_generated_takes_and_their_media(self):
        # Generated takes live in the attempt ledger, not in the stored document, so a
        # read that answers about clips or media must project them. Reading only the
        # stored document silently hid every generated take.
        self.submit()
        attempt_id = self.store.pending()[0]
        self.success(attempt_id)
        asyncio.run(self.executor.reconcile())
        projected = self.store.get(self.project["id"])["document"]
        generated = [t for c in projected["clips"] for t in c["takes"] if t.get("generated")]
        self.assertEqual(len(generated), 1)
        take_id = generated[0]["id"]
        stored = self.store.document(self.project["id"])
        self.assertEqual(
            [t for c in stored["clips"] for t in c["takes"] if t.get("generated")],
            [],
            "the stored document holds no generated takes",
        )
        clip = self.store.clip(self.project["id"], "clip-a")
        self.assertIn(take_id, [t["id"] for t in clip["takes"]])
        media = self.store.take_media(self.project["id"])
        self.assertIn(generated[0]["media"]["file"], [m["file"] for m in media])
        self.assertEqual(
            self.store.media_record(self.project["id"], generated[0]["media"]["id"])["file"],
            generated[0]["media"]["file"],
        )

    def test_evidence_merges_across_records_and_saves(self):
        # Two records can share a media id, and a save can carry only part of the
        # payload; neither may drop evidence that is already stored.
        document = store_module.empty_project()
        document["media"] = [
            {
                "id": "media-1",
                "kind": "video",
                "name": "a.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": []},
            }
        ]
        document["clips"] = [
            {
                **clip(),
                "takes": [
                    {
                        "id": "original",
                        "number": 1,
                        "media": {
                            "id": "media-1",
                            "kind": "video",
                            "name": "a.mp4",
                            "file": "uploads/a.mp4",
                            "frames": 24,
                            "workflow": {"nodes": [{"id": 1}]},
                        },
                    }
                ],
            }
        ]
        project = self.store.create(document)
        held = self.store.evidence(project["id"], "media-1")
        self.assertEqual(sorted(held), ["mediaId", "probe", "workflow"], "both records contribute to one entry")
        self.assertTrue(self.store.document(project["id"])["media"][0]["embeddedGraph"])
        # A partial save must not drop the graph, and a graph replaced by API-only
        # metadata must clear the marker.
        partial = self.store.get(project["id"])["document"]
        partial["media"][0]["probe"] = {"streams": [{"codec_type": "video"}]}
        saved = self.store.save(project["id"], project["revision"], partial)
        self.assertEqual(sorted(self.store.evidence(project["id"], "media-1")), ["mediaId", "probe", "workflow"])
        for record in ledger_module.media_records(saved["document"]):
            if record["id"] == "media-1":
                record["workflow"] = {"save": {"class_type": "SaveImage", "inputs": {}}}
        again = self.store.save(project["id"], saved["revision"], saved["document"])
        self.assertFalse(
            any(record.get("embeddedGraph") for record in ledger_module.media_records(again["document"])),
            "a graph replaced by API-only metadata no longer advertises an editable graph",
        )
        self.assertFalse(ledger_module.embedded_graph({"workflow": None}))
        self.assertFalse(ledger_module.embedded_graph({"workflow": "text"}))
        self.assertFalse(ledger_module.embedded_graph({"workflowData": {"nodes": []}}))
        self.assertTrue(ledger_module.embedded_graph({"workflowData": {"workflow": {"nodes": []}}}))

    def test_a_failed_migration_leaves_the_old_version_so_it_retries(self):
        old = self.root / "retry-store"
        old.mkdir()
        document = store_module.empty_project()
        document["media"] = [
            {
                "id": "media-1",
                "kind": "video",
                "name": "a.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": []},
            }
        ]
        db = sqlite3.connect(old / "spool.sqlite3")
        try:
            db.executescript(
                "CREATE TABLE projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);"
                "CREATE TABLE revisions(project_id TEXT, revision INTEGER, document TEXT NOT NULL, PRIMARY KEY(project_id,revision));"
                "PRAGMA user_version=3;"
            )
            db.execute("INSERT INTO projects VALUES('p',4,?)", (store_module.encode(document),))
            db.commit()
        finally:
            db.close()
        original = Store.split_media_evidence
        try:
            Store.split_media_evidence = lambda self, db, version: (_ for _ in ()).throw(RuntimeError("interrupted"))
            with self.assertRaises(RuntimeError):
                Store(old)
        finally:
            Store.split_media_evidence = original
        db = sqlite3.connect(old / "spool.sqlite3")
        try:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            db.close()
        self.assertEqual(version, 4, "only the completed numbered steps are committed")
        self.assertNotIn("revisions", tables, "the completed retirement step stays committed")
        # Reopening retries and completes.
        reopened = Store(old)
        self.assertNotIn("probe", reopened.get("p")["document"]["media"][0])
        self.assertEqual(reopened.evidence("p", "media-1")["probe"], {"streams": []})

    def test_reclaim_reports_without_migrating(self):
        old = self.root / "report-store"
        old.mkdir()
        db = sqlite3.connect(old / "spool.sqlite3")
        try:
            db.executescript(
                "CREATE TABLE revisions(project_id TEXT, revision INTEGER, document TEXT NOT NULL, PRIMARY KEY(project_id,revision));"
                "PRAGMA user_version=3;"
            )
            db.execute("INSERT INTO revisions VALUES('p',0,?)", ("y" * 5000,))
            db.commit()
        finally:
            db.close()
        store = Store(old, migrate=False)
        report = store.reclaim()
        self.assertEqual([(r["table"], r["rows"]) for r in report["retired"]], [("revisions", 1)])
        self.assertEqual(report["retired"][0]["payloadBytes"], 5000)
        with store.connect() as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM revisions").fetchone()[0], 1, "a report must not drop the table"
            )
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 3)

    def test_media_evidence_leaves_the_working_document_and_returns_on_demand(self):
        # A probe and an embedded graph are evidence, not edit state. They used to
        # ride inside every copy, save, poll and undo snapshot of the document.
        evidence = {
            "probe": {"streams": [{"codec_type": "video"}]},
            "workflow": {"nodes": [{"id": 7}]},
            "prompt": {"1": {"class_type": "KSampler"}},
            "provenance": {"source": "container tag"},
            "workflowData": {"workflow": {"nodes": []}},
        }
        record = {
            "id": "media-1",
            "kind": "video",
            "name": "shot.mp4",
            "file": "uploads/a.mp4",
            "frames": 240,
            "width": 1920,
            "height": 1080,
            "audio": True,
            **evidence,
        }
        document = store_module.empty_project()
        document["media"] = [dict(record)]
        document["clips"] = [{**clip(), "takes": [{"id": "original", "number": 1, "media": dict(record)}]}]
        project = self.store.create(document)
        working = self.store.get(project["id"])["document"]
        self.assertEqual(working["media"][0]["evidence"], ["probe", "workflow", "prompt", "workflowData", "provenance"])
        for key in ledger_module.EVIDENCE_KEYS:
            self.assertNotIn(key, working["media"][0])
            self.assertNotIn(key, working["clips"][0]["takes"][0]["media"])
        held = self.store.evidence(project["id"], "media-1")
        self.assertEqual(held["mediaId"], "media-1")
        for key, value in evidence.items():
            self.assertEqual(held[key], value)
        with self.assertRaises(KeyError):
            self.store.evidence(project["id"], "absent")

    def test_a_slim_save_keeps_evidence_and_a_legacy_save_refreshes_it(self):
        document = store_module.empty_project()
        document["media"] = [
            {
                "id": "media-1",
                "kind": "video",
                "name": "shot.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": []},
            }
        ]
        project = self.store.create(document)
        saved = self.store.save(project["id"], project["revision"], self.store.get(project["id"])["document"])
        self.assertEqual(self.store.evidence(project["id"], "media-1")["probe"], {"streams": []})
        # An editor that still sends evidence inline refreshes the stored copy.
        legacy = self.store.get(saved["id"])["document"]
        legacy["media"][0]["probe"] = {"streams": [{"codec_type": "audio"}]}
        self.store.save(saved["id"], saved["revision"], legacy)
        self.assertEqual(self.store.evidence(saved["id"], "media-1")["probe"], {"streams": [{"codec_type": "audio"}]})

    def test_export_carries_evidence_and_import_splits_it_again(self):
        document = store_module.empty_project()
        document["media"] = [
            {
                "id": "media-1",
                "kind": "video",
                "name": "shot.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": [{"codec_type": "video"}]},
                "workflow": {"nodes": [{"id": 3}]},
            }
        ]
        project = self.store.create(document)
        exported = self.store.export_project(project["id"])["document"]
        self.assertEqual(exported["media"][0]["probe"], {"streams": [{"codec_type": "video"}]})
        self.assertNotIn("evidence", exported["media"][0])
        imported = self.store.import_project({"document": exported, "recipes": {}})
        self.assertNotIn("probe", self.store.get(imported["id"])["document"]["media"][0])
        self.assertEqual(self.store.evidence(imported["id"], "media-1")["workflow"], {"nodes": [{"id": 3}]})

    def test_opening_a_version_4_store_moves_evidence_out_of_its_documents(self):
        old = self.root / "evidence-store"
        old.mkdir()
        document = store_module.empty_project()
        document["media"] = [
            {
                "id": "media-1",
                "kind": "video",
                "name": "shot.mp4",
                "file": "uploads/a.mp4",
                "frames": 24,
                "probe": {"streams": []},
            }
        ]
        db = sqlite3.connect(old / "spool.sqlite3")
        try:
            db.executescript(
                "CREATE TABLE projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);"
                "PRAGMA user_version=4;"
            )
            db.execute("INSERT INTO projects VALUES('p',7,?)", (store_module.encode(document),))
            db.commit()
        finally:
            db.close()
        reopened = Store(old)
        self.assertEqual(reopened.get("p")["revision"], 7)
        self.assertNotIn("probe", reopened.get("p")["document"]["media"][0])
        self.assertEqual(reopened.get("p")["document"]["media"][0]["evidence"], ["probe"])
        self.assertEqual(reopened.evidence("p", "media-1")["probe"], {"streams": []})

    def test_opening_an_old_store_retires_the_revision_ledger_and_reclaims_the_file(self):
        old = self.build_v3_store(self.root / "old-store")
        reopened = Store(old)
        with reopened.connect() as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='revisions'").fetchone()[0],
                0,
            )
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], store_module.SCHEMA_VERSION)
        self.assertEqual(reopened.get("p")["document"]["clips"][0]["id"], "clip-a")
        report = reopened.reclaim(confirm=True)
        self.assertEqual(report["reclaimed"], 0)
        self.assertEqual(report["freePages"], 0)

    def test_retiring_a_large_ledger_compacts_the_file_once(self):
        # Schema 6 compacts after the packing migration, even for small projects.
        small = self.build_v3_store(self.root / "small-store")
        Store(small)
        self.assertEqual(self.free_pages(small / "spool.sqlite3"), 0)
        large = self.build_v3_store(self.root / "large-store")
        original = Store.COMPACT_AFTER_RETIREMENT
        try:
            Store.COMPACT_AFTER_RETIREMENT = 0
            Store(large)
        finally:
            Store.COMPACT_AFTER_RETIREMENT = original
        self.assertEqual(self.free_pages(large / "spool.sqlite3"), 0)

    def test_reclaim_reports_without_deleting_until_confirmed(self):
        old = self.root / "dry-store"
        old.mkdir()
        db = sqlite3.connect(old / "spool.sqlite3")
        try:
            db.executescript(
                "CREATE TABLE revisions(project_id TEXT, revision INTEGER, document TEXT NOT NULL, PRIMARY KEY(project_id,revision));"
                "PRAGMA user_version=3;"
            )
            db.execute("INSERT INTO revisions VALUES('p',0,?)", ("x" * 200000,))
            db.commit()
        finally:
            db.close()
        store = Store.__new__(Store)
        store.root, store.path, store.read_only = old, old / "spool.sqlite3", False
        dry = store.reclaim()
        self.assertEqual([(r["table"], r["rows"]) for r in dry["retired"]], [("revisions", 1)])
        self.assertEqual(dry["reclaimed"], 0)
        with store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM revisions").fetchone()[0], 1)
        done = store.reclaim(confirm=True)
        self.assertEqual(done["retired"][0]["payloadBytes"], 200000)
        self.assertGreater(done["reclaimed"], 0)

    def test_result_is_idempotent_unselected_and_out_of_order(self):
        p = self.submit()
        p = self.submit()
        first, second = [j["id"] for j in p["document"]["jobs"]]
        self.success(second)
        asyncio.run(self.executor.reconcile())
        self.success(first, filename="earlier.png")
        asyncio.run(self.executor.reconcile())
        asyncio.run(self.executor.reconcile())
        p = Store(self.store.root).get(self.project["id"])
        self.assertEqual(p["document"]["clips"][0]["takeId"], "original")
        self.assertEqual(len(p["document"]["clips"][0]["takes"]), 3)

    def test_edit_save_and_undo_cannot_erase_collected_takes(self):
        p = self.submit()
        self.success(p["document"]["jobs"][0]["id"])
        asyncio.run(self.executor.reconcile())
        stale = copy.deepcopy(self.project["document"])
        stale["clips"][0]["in"] = 2
        current = self.store.save(self.project["id"], self.project["revision"], stale)
        self.assertEqual(len(current["document"]["clips"][0]["takes"]), 2)
        self.assertEqual(current["document"]["clips"][0]["in"], 2)

    def test_frozen_asset_and_prompt_and_original_unchanged(self):
        p = self.submit()
        attempt = self.store.attempt(p["document"]["jobs"][0]["id"])
        frozen = self.root / "input" / attempt["request"]["prompt"]["194:45"]["inputs"]["image"]
        original_bytes = frozen.read_bytes()
        Image.new("RGB", (8, 8), "green").save(self.root / "input" / "original.png")
        self.assertEqual(frozen.read_bytes(), original_bytes)
        self.assertEqual(self.store.workflow(self.project["document"]["clips"][0]["workflowVersion"]), self.base)
        self.assertNotEqual(attempt["request"]["prompt"]["194:46"]["inputs"]["filename_prefix"], "saved")

    def test_uncertain_dispatch_does_not_repeat(self):
        p = self.submit()
        self.queue.pending = []
        asyncio.run(self.executor.reconcile())
        asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(p["document"]["jobs"][0]["id"])["status"], "uncertain")
        self.assertEqual(self.queue.pending, [])

    def test_accepted_job_before_status_persistence_reconciles(self):
        original = self.store.transition

        def crash(identity, status, *args, **kwargs):
            if status == "queued":
                raise RuntimeError("Stopped before queue acknowledgment")
            return original(identity, status, *args, **kwargs)

        with patch.object(self.store, "transition", side_effect=crash), self.assertLogs(level="ERROR"):
            p = self.submit()
        identity = p["document"]["jobs"][0]["id"]
        self.assertEqual(self.store.attempt(identity)["status"], "uncertain")
        asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(identity)["status"], "queued")
        self.assertEqual(len(self.queue.pending), 1)

    def test_crash_after_claim_before_send_never_repeats_dispatch(self):
        with (
            patch.object(self.store, "dispatched", side_effect=RuntimeError("Stopped before send")),
            self.assertLogs(level="ERROR"),
        ):
            project = self.submit()
        identity = project["document"]["jobs"][0]["id"]
        asyncio.run(self.executor.reconcile())
        asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(identity)["status"], "uncertain")
        self.assertEqual(self.queue.pending, [])

    def test_linked_binding_rejected_opaque_ids_kept(self):
        invalid = copy.deepcopy(self.base)
        invalid["bindings"] = [{"key": "images", "nodeId": "194:46", "input": "images"}]
        with self.assertRaises(ValueError):
            store_module.validate_capture(invalid)
        self.assertIn("194:45", self.store.workflow(self.project["document"]["clips"][0]["workflowVersion"])["prompt"])

    def test_partial_validation_cannot_queue_wrong_primary(self):
        async def validate(*args):
            return True, None, ["other"], {"194:46": {"errors": ["invalid primary"]}}

        self.executor.validate = validate
        p = self.submit()
        self.assertEqual(p["document"]["jobs"][0]["status"], "failed")
        self.assertEqual(self.queue.pending, [])
        self.assertIn("194:46", self.store.dispatch_record(p["document"]["jobs"][0]["id"])["validation"]["nodeErrors"])

    def test_hooks_and_validation_observed_separately(self):
        def hook(value):
            value["prompt"]["194:46"]["inputs"]["changed"] = "hook"
            value["partial_execution_targets"] = ["194:46"]
            return value

        self.server.trigger_on_prompt = hook
        p = self.submit()
        identity = p["document"]["jobs"][0]["id"]
        self.assertNotIn("changed", self.store.attempt(identity)["request"]["prompt"]["194:46"]["inputs"])
        observed = self.store.dispatch_record(identity)["payload"]
        self.assertEqual(observed["prompt"]["194:46"]["inputs"]["changed"], "hook")
        self.assertEqual(observed["partial_execution_targets"], ["194:46"])
        self.assertEqual(p["document"]["jobs"][0]["status"], "failed")
        self.assertEqual(self.queue.pending, [])

    def test_hook_cannot_change_frozen_seed(self):
        self.base["prompt"]["194:45"]["inputs"]["seed"] = 42
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", self.base)

        def hook(payload):
            payload["prompt"]["194:45"]["inputs"]["seed"] = 99
            return payload

        self.server.trigger_on_prompt = hook
        project = self.submit()
        job = project["document"]["jobs"][0]
        self.assertEqual(job["status"], "failed")
        self.assertIn("host hook changed the frozen workflow", job["error"])
        self.assertEqual(self.store.attempt(job["id"])["request"]["prompt"]["194:45"]["inputs"]["seed"], 42)
        self.assertEqual(self.queue.pending, [])

    def test_deadline_and_meta_batch_rejected_before_hooks(self):
        for node_type, inputs in [
            ("DeadlineSubmit", {}),
            ("SaveAndSubmitNode", {}),
            ("VHS_BatchManager", {}),
            ("VHS_VideoCombine", {"meta_batch": ["batch", 0]}),
        ]:
            changed = copy.deepcopy(self.base)
            changed["prompt"]["launcher"] = {"class_type": node_type, "inputs": inputs}
            self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", changed)
            self.server.trigger_on_prompt = lambda value: self.fail("Launcher must not reach hooks")
            with self.assertRaises(ValueError):
                self.submit()
        self.assertEqual(self.store.pending(), [])

    def test_failed_partial_artifacts_are_not_ready(self):
        p = self.submit()
        attempt = self.success(p["document"]["jobs"][0]["id"])
        self.queue.history[attempt["prompt_id"]]["status"]["status_str"] = "error"
        asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "failed")
        self.assertEqual(len(self.store.get(self.project["id"])["document"]["clips"][0]["takes"]), 1)

    def test_containment_and_missing_output(self):
        for path in ("../spool.sqlite3", str(self.root / "outside.png")):
            with self.assertRaises(ValueError):
                self.media.resolve(path)
        with self.assertRaises(ValueError):
            self.media.reported({"filename": "../outside.png", "type": "temp"})
        p = self.submit()
        attempt = self.success(p["document"]["jobs"][0]["id"])
        (self.root / "temp" / "result.png").unlink()
        asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "collection_pending")

    def test_exact_integer_wire_and_capture(self):
        value = 18446744073709551615
        self.assertEqual(wire_module.unwire(json.loads(json.dumps(wire_module.wire({"seed": value})))), {"seed": value})
        changed = copy.deepcopy(self.base)
        changed["prompt"]["194:45"]["inputs"]["seed"] = value
        changed["bindings"] = [{"key": "seed", "nodeId": "194:45", "input": "seed"}]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", changed)
        p = self.submit()
        self.assertEqual(
            self.store.attempt(p["document"]["jobs"][0]["id"])["request"]["prompt"]["194:45"]["inputs"]["seed"], value
        )

    def test_duplicate_edit_references_keep_origin(self):
        p = self.submit()
        identity = p["document"]["jobs"][0]["id"]
        duplicate = copy.deepcopy(p["document"]["clips"][0])
        duplicate.update({"id": "clip-b", "takeOwnerId": "clip-a", "in": 4})
        p["document"]["clips"].append(duplicate)
        self.store.save(p["id"], p["revision"], p["document"])
        self.success(identity)
        asyncio.run(self.executor.reconcile())
        p = self.store.get(p["id"])
        self.assertEqual(len(p["document"]["clips"][1]["takes"]), 2)
        self.assertEqual(p["document"]["clips"][1]["in"], 4)
        self.assertEqual(self.store.attempt(identity)["clip_id"], "clip-a")

    def test_receipt_after_crash_recovers_without_comfy_history(self):
        p = self.submit()
        attempt = self.success(p["document"]["jobs"][0]["id"])
        artifacts, primary = self.media.collect(attempt, self.queue.history[attempt["prompt_id"]])
        receipts_module.write(
            self.store.root / "artifacts" / attempt["id"],
            attempt,
            artifacts,
            primary,
            self.queue.history[attempt["prompt_id"]],
        )
        self.queue.history.clear()
        reopened = execution_module.LocalExecutor(
            Store(self.store.root), self.media, self.server, self.executor.validate
        )
        asyncio.run(reopened.reconcile())
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")

    def test_live_and_recovery_ingestion_share_acceptance_and_retry(self):
        p = self.submit()
        attempt = self.success(p["document"]["jobs"][0]["id"])
        with patch.object(self.media, "review_receipt", side_effect=OSError("interrupted review")):
            asyncio.run(self.executor.reconcile())
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "collection_pending")
        receipt = self.store.root / "artifacts" / attempt["id"] / "receipt.json"
        self.assertTrue(receipt.is_file())
        # Both observers can confirm the same accepted execution. Its boolean is
        # idempotent acceptance, not a claim that this caller inserted the row.
        review, together = self.media.review_receipt, Barrier(2)

        def concurrent_review(*args):
            together.wait(timeout=5)
            return review(*args)

        with (
            patch.object(self.media, "review_receipt", side_effect=concurrent_review),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            accepted = list(
                pool.map(
                    lambda _: execution_module.Collector(Store(self.store.root), self.media).ingest(attempt), range(2)
                )
            )
        self.assertEqual(accepted, [True, True])
        before = self.store.attempt(attempt["id"])["result"]
        asyncio.run(self.executor.reconcile())
        self.executor.collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["result"], before)
        result = json.loads(before)
        self.assertEqual(result["primary"]["id"], result["primary"]["artifactId"])
        with self.store.connect() as db:
            self.assertEqual(
                db.execute("SELECT count(*) FROM executions WHERE attempt_id=?", (attempt["id"],)).fetchone()[0], 1
            )
        self.assertEqual(len(self.store.get(p["id"])["document"]["clips"][0]["takes"]), 2)

    def test_duplicate_of_fork_retains_each_source_and_future_arrivals(self):
        p = self.submit()
        self.success(p["document"]["jobs"][0]["id"])
        asyncio.run(self.executor.reconcile())
        p = self.store.get(p["id"])
        b = copy.deepcopy(p["document"]["clips"][0])
        b.update({"id": "clip-b", "takeSourceIds": ["clip-a"]})
        p["document"]["clips"].append(b)
        p = self.store.save(p["id"], p["revision"], p["document"])
        p = asyncio.run(self.executor.queue(p["id"], p["revision"], [{"clipId": "clip-b", "count": 2}]))
        fork_jobs = [j for j in p["document"]["jobs"] if j["clipId"] == "clip-b"]
        self.success(fork_jobs[0]["id"], filename="b1.png")
        asyncio.run(self.executor.reconcile())
        p = self.store.get(p["id"])
        c = copy.deepcopy(p["document"]["clips"][1])
        c.update({"id": "clip-c", "takeSourceIds": ["clip-b", "clip-a"], "in": 3})
        p["document"]["clips"].append(c)
        p = self.store.save(p["id"], p["revision"], p["document"])
        self.success(fork_jobs[1]["id"], filename="b2.png")
        asyncio.run(self.executor.reconcile())
        p = Store(self.store.root).get(p["id"])
        self.assertEqual(len(p["document"]["clips"][1]["takes"]), 4)
        self.assertEqual(len(p["document"]["clips"][2]["takes"]), 4)
        self.assertEqual(p["document"]["clips"][2]["in"], 3)
        self.assertEqual(p["document"]["clips"][2]["takeId"], "original")

    def test_rejected_project_import_leaves_no_partial_project_or_recipes(self):
        document = store_module.empty_project()
        document["clips"] = [clip("first"), clip("second")]
        for c in document["clips"]:
            c["workflowVersion"] = c["id"]
        document["media"] = [{"id": "evidence", "kind": "image", "probe": {"streams": []}}]
        backup = {"document": document, "recipes": {"first": capture(), "second": {"prompt": {}}}}

        def counts():
            with self.store.connect() as db:
                return [
                    db.execute("SELECT count(*) FROM " + table).fetchone()[0]
                    for table in ("projects", "workflows", "media_evidence")
                ]

        before = counts()
        with self.assertRaises(ValueError):
            self.store.import_project(backup)
        self.assertEqual(counts(), before)
        backup["recipes"]["second"] = capture()
        write = self.store._write_document

        def interrupted(*args):
            write(*args)
            raise OSError("interrupted after writing evidence")

        with patch.object(self.store, "_write_document", side_effect=interrupted), self.assertRaises(OSError):
            self.store.import_project(backup)
        self.assertEqual(counts(), before)
        restored = self.store.import_project(backup)
        self.assertEqual(restored["revision"], 2)
        self.assertEqual(len(restored["recipes"]), 2)
        self.assertEqual(self.store.evidence(restored["id"], "evidence")["probe"], {"streams": []})

    def test_project_backup_restores_recipes_exact_controls_and_chosen_media(self):
        changed = copy.deepcopy(self.base)
        changed["prompt"]["194:45"]["inputs"]["seed"] = 18446744073709551615
        changed["bindings"] = [{"key": "seed", "nodeId": "194:45", "input": "seed"}]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", changed)
        p = self.submit()
        self.success(p["document"]["jobs"][0]["id"])
        asyncio.run(self.executor.reconcile())
        p = self.store.get(p["id"])
        chosen = p["document"]["clips"][0]["takes"][-1]
        p["document"]["clips"][0]["takeId"] = chosen["id"]
        p = self.store.save(p["id"], p["revision"], p["document"])
        backup = wire_module.unwire(wire_module.wire(self.store.export_project(p["id"])))
        imported = self.store.import_project(backup)
        c = imported["document"]["clips"][0]
        self.assertNotEqual(imported["id"], p["id"])
        self.assertEqual(c["takeId"], chosen["id"])
        self.assertEqual(c["takes"][-1]["media"], chosen["media"])
        self.assertEqual(c["takes"][-1]["importedExecution"]["clipId"], "clip-a")
        self.assertEqual(c["inputValues"]["seed"], 18446744073709551615)
        self.assertIn(c["workflowVersion"], imported["recipes"])
        self.assertEqual(self.store.workflow(c["workflowVersion"]), changed)

    def test_integer_bindings_reject_float_transport(self):
        changed = copy.deepcopy(self.base)
        changed["prompt"]["194:45"]["inputs"]["seed"] = 7
        changed["bindings"] = [{"key": "seed", "nodeId": "194:45", "input": "seed"}]
        self.project = self.store.capture(
            self.project["id"], self.project["revision"], "clip-a", changed, {"seed": 7.0}
        )
        with self.assertRaisesRegex(ValueError, "literal type"):
            self.submit()
        self.assertEqual(self.queue.pending, [])

    def test_hooks_cannot_change_frozen_files_or_isolated_saver_path(self):
        for node_id, name, value in [("194:45", "image", "original.png"), ("194:46", "filename_prefix", "fixed")]:

            def hook(payload):
                payload["prompt"][node_id]["inputs"][name] = value
                return payload

            self.server.trigger_on_prompt = hook
            p = self.submit()
            job = p["document"]["jobs"][-1]
            self.assertEqual(job["status"], "failed")
            self.assertEqual(self.store.dispatch_record(job["id"])["payload"]["prompt"][node_id]["inputs"][name], value)
        self.assertEqual(self.queue.pending, [])

    @unittest.skipUnless(
        shutil.which("ffmpeg") and shutil.which("ffprobe"), "Synthetic video adapter check requires ffmpeg/ffprobe"
    )
    def test_vhs_gifs_video_adapter_collects_exact_synthetic_record(self):
        changed = copy.deepcopy(self.base)
        changed["prompt"]["194:46"] = {
            "class_type": "VHS_VideoCombine",
            "inputs": {"images": ["194:45", 0], "filename_prefix": "VHS", "format": "video/h264-mp4"},
        }
        changed["result"]["group"] = "gifs"
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", changed)
        p = self.submit()
        attempt = self.store.attempt(p["document"]["jobs"][0]["id"])
        source = self.root / "output" / "vhs.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=16x16:r=24:d=0.25",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(source),
            ],
            check=True,
        )
        self.queue.history[attempt["prompt_id"]] = {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"194:46": {"gifs": [{"filename": "vhs.mp4", "subfolder": "", "type": "output"}]}},
        }
        self.queue.pending.clear()
        asyncio.run(self.executor.reconcile())
        asyncio.run(self.executor.reconcile())
        p = Store(self.store.root).get(p["id"])
        media = p["document"]["clips"][0]["takes"][-1]["media"]
        self.assertEqual(media["group"], "gifs")
        self.assertEqual(media["kind"], "video")
        self.assertEqual(media["fps"], "24/1")
        self.assertEqual(media["frames"], 6)
        self.assertEqual(self.media.resolve(media["originalFile"]).read_bytes(), source.read_bytes())
        self.assertEqual(len(p["document"]["clips"][0]["takes"]), 2)


if __name__ == "__main__":
    unittest.main()
