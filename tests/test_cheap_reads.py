"""Completion times and retained operation identities survive history expiry."""

import shutil
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import MagicMock, patch

from spool.collection import Collector
from spool.store import Store, OperationConflict, encode, fingerprint


class CheapReadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        shutil.copyfile(Path(__file__).parent / "fixtures/project-schema5.spool", root / "spool.sqlite3")
        self.store = Store(root)
        self.project = self.store.list()[0]["id"]

    def test_schema5_migrates_through7_and_retention_preserves_finish_and_cursor(self):
        before = self.store.get(self.project)["document"]["jobs"]
        with self.store.connect() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 7)
            self.assertIsNotNone(db.execute("SELECT finished_at FROM attempts").fetchone()[0])
            db.execute("UPDATE events SET created=1")
        cursor = self.store.sync_state(self.project)["cursor"]
        self.store.retain_history(now=90 * 86400)
        self.assertEqual(self.store.get(self.project)["document"]["jobs"], before)
        self.assertEqual(self.store.sync_state(self.project)["cursor"], cursor)
        self.assertEqual(len(self.store.events(self.project)["events"]), 1)

    def test_failed_seventh_migration_rolls_back_and_retries(self):
        import sqlite3

        root = Path(self.temp.name) / "retry"
        root.mkdir()
        shutil.copyfile(Path(__file__).parent / "fixtures/project-schema5.spool", root / "spool.sqlite3")
        original = Store._migration7

        def interrupted(store, db):
            original(store, db)
            raise RuntimeError("interrupted")

        with patch.object(Store, "_migration7", interrupted), self.assertRaisesRegex(RuntimeError, "interrupted"):
            Store(root)
        with closing(sqlite3.connect(root / "spool.sqlite3")) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 6)
            self.assertNotIn("finished_at", [r[1] for r in db.execute("PRAGMA table_info(attempts)")])
        with Store(root).reading() as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 7)

    def test_expired_commands_and_queues_never_execute_again(self):
        payload = {"actor": "test", "action": "test", "arguments": {}}
        with self.store.connect() as db:
            for identity in ("old-command", "old-queue"):
                db.execute(
                    "INSERT INTO operations VALUES(?,?,?,?,?,?,?)",
                    (identity, self.project, fingerprint(payload), encode(payload), "[]", "test", 1),
                )
            db.execute("INSERT INTO command_results VALUES(?,?)", ("old-command", encode({"ok": True})))
        self.store.retain_history(now=90 * 86400)
        with self.store.reading() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM command_results").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM operation_tombstones").fetchone()[0], 2)
        apply = MagicMock()
        for identity in ("old-command", "old-queue"):
            with self.assertRaises(OperationConflict):
                self.store.command(identity, self.project, 1, payload, apply)
            with self.assertRaises(OperationConflict):
                self.store.accept_queue(identity, self.project, 1, payload, [], "test")
        apply.assert_not_called()

    def test_unconfirmed_cancellation_keeps_its_replay_payload(self):
        with self.store.connect() as db:
            db.execute(
                "INSERT INTO operations VALUES(?,?,?,?,?,?,?)",
                ("cancel", self.project, "digest", "{}", "[]", "test", 1),
            )
            db.execute("INSERT INTO command_results VALUES(?,?)", ("cancel", "{}"))
            db.execute("INSERT INTO effects VALUES(?,'uncertain')", ("cancel",))
        self.store.retain_history(now=90 * 86400)
        self.assertEqual(self.store.operation_payload("cancel"), {})
        attempt = self.store.intent(self.project, {"id": "cancel-test", "name": "Test"}, {"capture": {}})
        with self.store.connect() as db:
            db.execute("UPDATE effects SET state='done' WHERE operation_id='cancel'")
            db.execute("UPDATE command_results SET result=? WHERE id='cancel'", (encode({"attemptId": attempt["id"]}),))
        self.store.retain_history(now=90 * 86400)
        self.assertEqual(self.store.operation_payload("cancel"), {})
        self.store.transition(attempt["id"], "cancelled")
        self.store.retain_history(now=90 * 86400)
        self.assertIsNone(self.store.operation_payload("cancel"))

    def test_terminal_transition_persists_finish_without_events(self):
        request = {"capture": {}, "inputValues": {}}
        attempt = self.store.intent(self.project, {"id": "test", "name": "Test"}, request)
        with patch("spool.store.time.time", return_value=123):
            self.store.transition(attempt["id"], "failed")
        with patch("spool.store.time.time", return_value=456):
            self.store.transition(attempt["id"], "failed", error="More detail")
        with self.store.connect() as db:
            db.execute("DELETE FROM events")
            row = db.execute("SELECT finished_at FROM attempts WHERE id=?", (attempt["id"],)).fetchone()
            self.assertEqual(row[0], 123)
        jobs = self.store.get(self.project)["document"]["jobs"]
        self.assertEqual(next(j for j in jobs if j["id"] == attempt["id"])["finishedAt"], 123)

    def test_collector_rechecks_settled_history_only_at_interval(self):
        store, media = MagicMock(), MagicMock()
        store.list.return_value = [{"id": "project"}]
        store.scan_attempts.return_value = []
        collector = Collector(store, media)
        collector.folders = MagicMock()
        with patch("spool.collection.time.monotonic", side_effect=[1, 2, 301]):
            for _ in range(3):
                collector.scan_project(store)
        self.assertEqual([c.kwargs["pending_only"] for c in store.scan_attempts.call_args_list], [False, True, False])
        store.retain_history.assert_called_once()


if __name__ == "__main__":
    unittest.main()
