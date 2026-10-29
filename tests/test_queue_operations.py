import asyncio
import json
import copy
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from spool import attempts, requests
from spool.execution import LocalExecutor
from spool.media import Media
from spool.ownership import ExecutorLock
from spool.store import Conflict, Store, empty_project


class QueueOperationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(self.root / "store")
        for kind in ("input", "output", "temp"):
            (self.root / kind).mkdir()
        Image.new("RGB", (8, 8), "red").save(self.root / "input" / "source.png")
        self.media = Media(self.store.root, self.root / "input", self.root / "output", self.root / "temp")
        document = empty_project()
        document["clips"] = [{"id": "shot", "name": "Shot", "revision": 1, "takes": [], "takeId": "original"}]
        project = self.store.create(document)
        self.recipe = {
            "prompt": {
                "load": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
                "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "ordinary"}},
            },
            "bindings": [],
            "result": {"nodeId": "save", "group": "images", "index": 0},
        }
        self.project = self.store.capture(project["id"], 0, "shot", self.recipe)
        self.items = [{"clipId": "shot", "count": 2}]

    def test_standalone_recovers_receipt_without_host(self):
        from spool.collection import Collector
        from spool import receipts

        project = self.accept()
        attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        Image.new("RGB", (8, 8), "blue").save(self.root / "output" / "finished.png")
        history = {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"save": {"images": [{"filename": "finished.png"}]}},
        }
        artifacts, primary = self.media.collect(attempt, history, False)
        receipts.write(self.store.root / "artifacts" / attempt["id"], attempt, artifacts, primary, history)
        Collector(self.store, self.media).scan()
        Collector(self.store, self.media).scan()
        saved = self.store.get(project["id"])
        self.assertEqual(saved["document"]["jobs"][0]["status"], "complete")
        self.assertEqual(len(saved["document"]["clips"][0]["takes"]), 1)
        self.assertEqual(saved["document"]["clips"][0]["takeId"], "original")

    def test_graph_handoff_preserves_identity_and_consumes_once(self):
        value = self.store.handoff(
            self.project["id"], {"revision": self.project["revision"], "clipId": "shot", "action": "capture"}
        )
        self.assertEqual(value["payload"]["workflowVersion"], self.project["document"]["clips"][0]["workflowVersion"])
        self.store.finish_handoff(value["id"], {"prompt": self.recipe["prompt"]})
        with self.assertRaises(Conflict):
            self.store.finish_handoff(value["id"], {"prompt": {}})

    def test_prepare_handoff_supports_new_shot_and_rejects_stale_graph_request(self):
        data = {
            "revision": self.project["revision"],
            "action": "prepare",
            "workflow": {"nodes": []},
            "name": "New workflow",
        }
        value = self.store.handoff(self.project["id"], data)
        self.assertEqual(value["payload"]["workflow"], {"nodes": []})
        self.assertEqual(self.store.get(self.project["id"])["document"]["jobs"], [])
        with self.assertRaises(Conflict):
            self.store.handoff(self.project["id"], {**data, "revision": -1})
        with self.assertRaises(ValueError):
            self.store.handoff(self.project["id"], {**data, "workflow": {}})

    def tearDown(self):
        self.temp.cleanup()

    def accept(self, operation="op-1", store=None):
        return requests.accept(
            store or self.store, self.media, self.project["id"], self.project["revision"], self.items, operation
        )

    def test_retry_after_response_loss_and_later_edit_preserves_batch(self):
        accepted = self.accept()
        identities = [j["id"] for j in accepted["document"]["jobs"]]
        self.store.save(self.project["id"], self.project["revision"], self.project["document"])
        with patch.object(self.media, "freeze_asset", side_effect=AssertionError("A retry must not freeze again")):
            retried = self.accept()
        self.assertEqual([j["id"] for j in retried["document"]["jobs"]], identities)
        self.assertTrue(all(j["status"] == attempts.WAITING for j in retried["document"]["jobs"]))
        self.assertEqual(len(self.store.events(self.project["id"])["events"]), 1)

    def test_batch_shares_frozen_bytes_but_keeps_distinct_requests(self):
        with patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze:
            prepared = requests.prepare(self.store, self.media, self.project, [{"clipId": "shot", "count": 16}])
        self.assertEqual(freeze.call_count, 1)
        assets = [request["assets"][0] for _, request in prepared]
        self.assertEqual(len({a["frozen"] for a in assets}), 1)
        self.assertEqual(len({request["outputNamespace"] for _, request in prepared}), 16)
        frozen = self.media.host_roots["input"] / assets[0]["frozen"]
        before = frozen.read_bytes()
        Image.new("RGB", (8, 8), "blue").save(self.root / "input" / "source.png")
        self.assertEqual(frozen.read_bytes(), before)
        again = requests.prepare(self.store, self.media, self.project, self.items)
        self.assertNotEqual(again[0][1]["assets"][0]["frozen"], assets[0]["frozen"])
        self.assertNotEqual(again[0][1]["assets"][0]["sha256"], assets[0]["sha256"])

    def test_batch_freezes_different_asset_overrides_separately(self):
        Image.new("RGB", (8, 8), "blue").save(self.root / "input" / "other.png")
        recipe = {**self.recipe, "bindings": [{"key": "image", "nodeId": "load", "input": "image", "asset": True}]}
        project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        items = [{"clipId": "shot", "count": 2}, {"clipId": "shot", "count": 2, "values": {"image": "other.png"}}]
        with patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze:
            prepared = requests.prepare(self.store, self.media, project, items)
        self.assertEqual(freeze.call_count, 2)
        assets = [request["assets"][0] for _, request in prepared]
        self.assertEqual(assets[0]["frozen"], assets[1]["frozen"])
        self.assertEqual(assets[2]["frozen"], assets[3]["frozen"])
        self.assertNotEqual(assets[0]["sha256"], assets[2]["sha256"])

    def test_repeated_shot_input_is_baked_once_per_batch(self):
        document = copy.deepcopy(self.project["document"])
        document["clips"][0].update(
            {
                "in": 0,
                "out": 24,
                "takes": [
                    {
                        "id": "original",
                        "media": {"id": "source", "kind": "image", "file": "assets/black.png", "frames": 120},
                    }
                ],
            }
        )
        project = self.store.save(self.project["id"], self.project["revision"], document)
        recipe = {
            **self.recipe,
            "bindings": [{"key": "image", "nodeId": "load", "input": "image", "asset": True, "slot": "image"}],
        }
        project = self.store.capture(project["id"], project["revision"], "shot", recipe)
        items = [{"clipId": "shot", "count": 16, "shotInputs": [{"key": "image", "source": "original"}]}]
        with (
            patch.object(self.media, "bake_shot", wraps=self.media.bake_shot) as bake,
            patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze,
        ):
            prepared = requests.prepare(self.store, self.media, project, items)
        self.assertEqual((bake.call_count, freeze.call_count), (1, 1))
        self.assertEqual(len({r["shotInputs"][0]["file"] for _, r in prepared}), 1)
        self.assertTrue(all(r["shotInputs"][0]["takeId"] == "original" for _, r in prepared))

    def test_concurrent_duplicate_operations_accept_once(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.accept(store=Store(self.store.root)), range(4)))
        self.assertTrue(all(len(p["document"]["jobs"]) == 2 for p in results))
        self.assertEqual(len(self.store.pending()), 2)

    def test_operation_id_cannot_change_payload_or_project(self):
        self.accept()
        with self.assertRaises(Conflict):
            requests.accept(
                self.store,
                self.media,
                self.project["id"],
                self.project["revision"],
                [{"clipId": "shot", "count": 1}],
                "op-1",
            )
        other = self.store.create()
        with self.assertRaises(Conflict):
            requests.accept(self.store, self.media, other["id"], other["revision"], self.items, "op-1")

    def test_revision_rechecked_after_freezing(self):
        freeze = self.media.freeze_asset

        def delayed(value):
            current = self.store.get(self.project["id"])
            self.store.save(current["id"], current["revision"], current["document"])
            return freeze(value)

        with patch.object(self.media, "freeze_asset", side_effect=delayed), self.assertRaises(Conflict):
            self.accept()
        self.assertEqual(self.store.pending(), [])
        self.assertIsNone(
            self.store.operation(
                "op-1",
                self.project["id"],
                {"revision": self.project["revision"], "items": self.items, "actor": "human"},
            )
        )

    def test_batch_insertion_rolls_back_on_second_attempt_failure(self):
        insert = self.store._intent
        count = 0

        def interrupted(*args):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated interruption")
            return insert(*args)

        with patch.object(self.store, "_intent", side_effect=interrupted), self.assertRaises(OSError):
            self.accept()
        self.assertEqual(self.store.pending(), [])
        self.assertEqual(self.store.events(self.project["id"])["events"], [])

    def test_conditional_claim_has_one_owner(self):
        identity = self.accept()["document"]["jobs"][0]["id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(
                pool.map(lambda session: Store(self.store.root).claim(identity, session), ["host-a", "host-b"])
            )
        self.assertEqual(sum(results), 1)
        self.assertIn(self.store.owner(identity), {"host-a", "host-b"})

    def test_exclusive_lock_releases_on_close(self):
        first, second = ExecutorLock(self.store.root), ExecutorLock(self.store.root)
        first.acquire()
        try:
            with self.assertRaisesRegex(RuntimeError, "Another Comfy"):
                second.acquire()
        finally:
            first.close()
        second.acquire()
        second.close()

    def test_folder_mismatch_cannot_freeze_for_another_host(self):
        self.store.publish_host(
            {"roots": {kind: str(self.root / "different" / kind) for kind in self.media.host_roots}}, "host-a"
        )
        with self.assertRaisesRegex(Conflict, "different media folders"):
            self.accept()
        self.assertEqual(self.store.pending(), [])

    def test_input_preview_checks_files_without_attempts_or_freeze_copies(self):
        document = self.project["document"]
        document["clips"][0].update({"in": 12, "out": 48})
        self.project = self.store.save(self.project["id"], self.project["revision"], document)
        before = copy.deepcopy(self.project)
        preview = requests.preview(self.store, self.media, self.project["id"], self.project["revision"], "shot")
        self.assertEqual(preview["assets"][0]["frozen"], "source.png")
        self.assertEqual(preview["shotSeconds"], 1.5)
        self.assertEqual(self.store.get(self.project["id"]), before)
        self.assertFalse((self.media.host_roots["input"] / "spool-frozen").exists())
        with self.assertRaises(Conflict):
            requests.preview(self.store, self.media, self.project["id"], self.project["revision"] - 1, "shot")
        (self.media.host_roots["input"] / "source.png").unlink()
        with self.assertRaises(OSError):
            requests.preview(self.store, self.media, self.project["id"], self.project["revision"], "shot")
        self.assertEqual(self.store.pending(), [])

    def test_progress_only_annotates_matching_local_attempt_without_persistence(self):
        project = self.accept()
        identity = project["document"]["jobs"][0]["id"]
        self.store.transition(identity, attempts.QUEUED)
        project = self.store.get(self.project["id"])
        observed = {
            "promptId": project["document"]["jobs"][0]["promptId"],
            "nodes": [{"id": "save", "value": 2, "max": 8}],
        }
        executor = LocalExecutor(self.store, self.media, None, None, progress=lambda: observed)
        result = executor.annotate_progress(copy.deepcopy(project))
        self.assertEqual(result["document"]["jobs"][0]["nodeProgress"][0]["label"], "SaveImage")
        self.assertNotIn("nodeProgress", result["document"]["jobs"][1])
        self.assertEqual(self.store.get(self.project["id"]), project)
        observed["promptId"] = "unrelated-prompt"
        self.assertEqual(executor.annotate_progress(copy.deepcopy(project)), project)
        self.store.transition(identity, attempts.FAILED, error="fixture failure")
        finished = self.store.get(self.project["id"])["document"]["jobs"][0]["finishedAt"]
        self.assertIsNotNone(finished)
        self.assertEqual(self.store.get(self.project["id"])["document"]["jobs"][0]["finishedAt"], finished)

    def test_legacy_database_is_backed_up_and_migrated_without_data_loss(self):
        db = sqlite3.connect(self.store.path)
        for row in db.execute("SELECT id,capture FROM workflows").fetchall():
            capture = self.store._load(row[1], db)
            db.execute("UPDATE workflows SET capture=? WHERE id=?", (json.dumps(capture), row[0]))
        db.execute("DROP TABLE blobs")
        db.execute("PRAGMA user_version=0")
        db.commit()
        db.close()
        migrated = Store(self.store.root)
        self.assertEqual(migrated.get(self.project["id"]), self.project)
        backups = list((self.store.root / "backups").glob("schema-0-*.sqlite3"))
        self.assertEqual(len(backups), 1)
        backup = sqlite3.connect(backups[0])
        try:
            self.assertEqual(backup.execute("SELECT COUNT(*) FROM workflows").fetchone()[0], 1)
        finally:
            backup.close()

    def test_frozen_hash_tamper_does_not_reach_the_host_queue(self):
        project = self.accept()
        identity = project["document"]["jobs"][0]["id"]
        attempt = self.store.attempt(identity)
        asset = attempt["request"]["assets"][0]
        (self.media.host_roots["input"] / asset["frozen"]).write_bytes(b"changed")
        queued = []
        server = SimpleNamespace(
            number=0,
            prompt_queue=SimpleNamespace(put=queued.append),
            node_replace_manager=SimpleNamespace(apply_replacements=lambda prompt: None),
            trigger_on_prompt=lambda p: p,
        )

        async def validate(*args):
            return True, None, ["save"], {}

        executor = LocalExecutor(self.store, self.media, server, validate)
        asyncio.run(executor.dispatch(attempt))
        self.assertEqual(queued, [])
        self.assertNotEqual(self.store.attempt(identity)["status"], attempts.QUEUED)
        self.assertEqual(self.store.workflow(self.project["document"]["clips"][0]["workflowVersion"]), self.recipe)


if __name__ == "__main__":
    unittest.main()
