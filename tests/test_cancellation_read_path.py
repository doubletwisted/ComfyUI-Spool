"""Cancellation checks read published state without entering a writer transaction."""

import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import commands
from spool.ownership import file_lock
from spool.projects import ProjectStore, Workspace
from spool.store import Store


class CancellationObserved(Exception):
    def __init__(self, done):
        self.done = done


class CheckOnlyAdapter:
    async def cancel(self, attempt, context):
        # Stop before command persistence or external delivery. Everything through
        # the actual cancellation preflight has read the real project store.
        if context["stage"] != "check":
            raise AssertionError("Only the cancellation check should run")
        raise CancellationObserved(context["done"])


class CancellationReadPathTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.workspace = Workspace(self.root / "writer")
        self.project = self.workspace.create(
            {"clips": [{"id": "clip", "name": "Shot", "takes": []}], "media": []}, self.root / "project"
        )
        self.store = self.workspace.for_project(self.project["id"])
        self.assertIsInstance(self.store, ProjectStore)
        self.attempt = self.store.intent(
            self.project["id"], {"id": "clip", "name": "Shot"}, {"capture": {}, "target": "deadline"}
        )
        self.submission = self.store.submission(self.attempt["id"], {})
        self.store.acknowledge(self.submission["id"], "owned-job")
        self.store.transition(self.attempt["id"], "farm_running")
        self.envelope = {
            "operationId": "cancel",
            "revision": self.project["revision"],
            "actor": "test",
            "scope": {"projectId": self.project["id"], "clipIds": ["clip"], "capabilities": ["cancel"]},
            "action": "cancel",
            "arguments": {"attemptId": self.attempt["id"]},
        }
        self.plan(self.store)

    def plan(self, store):
        def apply(db, document):
            store.claim_cancellation(db, self.envelope["operationId"])
            store.transition(self.attempt["id"], "cancel_requested", db=db, expected="farm_running")
            return {"attemptId": self.attempt["id"], "jobId": "owned-job", "status": "cancel_requested"}, False

        return store.command(
            self.envelope["operationId"],
            self.project["id"],
            self.project["revision"],
            self.envelope,
            apply,
        )

    def preflight(self, store):
        with patch.object(commands, "adapter_for", return_value=CheckOnlyAdapter()):
            with self.assertRaises(CancellationObserved) as observed:
                commands.execute(store, None, self.project["id"], self.envelope)
        return observed.exception.done

    def other_store(self):
        workspace = Workspace(self.root / "reader")
        workspace.open_folder(self.store.root)
        return workspace.for_project(self.project["id"])

    @staticmethod
    def file_state(path):
        stat = path.stat()
        return path.read_bytes(), stat.st_mtime_ns, stat.st_ino

    def test_preflight_keeps_publication_manifest_backups_and_writer_checkpoint_unchanged(self):
        self.store.finish_cancellation("cancel")
        self.assertTrue(self.preflight(self.store))
        # Pin an old timestamp so another checkpoint write is detected even on
        # filesystems whose clock resolution would hide two quick writes.
        os.utime(self.store.stamp, ns=(1_000_000_000, 1_000_000_000))
        snapshot = self.file_state(self.store.snapshot)
        publication = self.store.signature()
        manifest = self.file_state(self.store.manifest)
        checkpoint = self.file_state(self.store.stamp)
        backups = list((self.store.root / ".spool" / "backups").glob("*"))

        for _ in range(3):
            self.assertTrue(self.preflight(self.store))

        self.assertEqual(self.file_state(self.store.snapshot), snapshot)
        self.assertEqual(self.store.signature(), publication)
        self.assertEqual(self.file_state(self.store.manifest), manifest)
        self.assertEqual(list((self.store.root / ".spool" / "backups").glob("*")), backups)
        self.assertEqual(self.file_state(self.store.stamp), checkpoint)

    def test_warm_preflight_finishes_while_the_local_writer_lock_is_held(self):
        self.store.finish_cancellation("cancel")
        self.assertTrue(self.preflight(self.store))
        finished = threading.Event()
        results, errors = [], []

        def poll():
            try:
                results.append(self.preflight(self.store))
            except BaseException as error:
                errors.append(error)
            finally:
                finished.set()

        thread = threading.Thread(target=poll)
        with file_lock(self.store.local_lock):
            thread.start()
            completed_without_writer = finished.wait(2)
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(results, [True])
        self.assertTrue(completed_without_writer, "Cancellation preflight needlessly waits for the writer lock")

    def test_preflight_refreshes_an_acknowledgement_from_another_workspace(self):
        reader = self.other_store()
        self.assertFalse(self.preflight(reader))
        self.store.finish_cancellation("cancel", "delivery unconfirmed")
        self.assertFalse(self.preflight(reader))

        self.store.finish_cancellation("cancel")
        snapshot = self.file_state(self.store.snapshot)
        publication = self.store.signature()
        manifest = self.file_state(self.store.manifest)
        checkpoint = self.file_state(reader.stamp)
        for _ in range(3):
            self.assertTrue(self.preflight(reader))
        self.assertEqual(self.file_state(self.store.snapshot), snapshot)
        self.assertEqual(self.store.signature(), publication)
        self.assertEqual(self.file_state(self.store.manifest), manifest)
        self.assertEqual(self.file_state(reader.stamp), checkpoint)

    def test_supplied_transaction_sees_unpublished_acknowledgement_and_legacy_sent_state(self):
        # The planner must observe its own writes, while an existing reader must
        # keep the older generation until its context ends.
        with self.store.reading() as published:
            self.assertFalse(self.store.cancellation_done(published, self.attempt["id"]))
            with self.store.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("UPDATE effects SET state='sent' WHERE operation_id='cancel'")
                self.assertTrue(self.store.cancellation_done(db, self.attempt["id"]))
                self.assertFalse(self.store.cancellation_done(published, self.attempt["id"]))
            self.assertFalse(self.store.cancellation_done(published, self.attempt["id"]))
        self.assertTrue(self.preflight(self.store))

    def test_plain_store_keeps_false_true_missing_and_query_errors(self):
        store = Store(self.root / "legacy")
        project = store.create({"clips": [{"id": "clip", "name": "Shot", "takes": []}], "media": []})
        attempt = store.intent(project["id"], {"id": "clip", "name": "Shot"}, {"capture": {}})
        envelope = {"actor": "test", "action": "cancel", "arguments": {"attemptId": attempt["id"]}}

        def apply(db, document):
            store.claim_cancellation(db, "cancel")
            store.transition(attempt["id"], "cancel_requested", db=db)
            return {"attemptId": attempt["id"], "status": "cancel_requested"}, False

        store.command("cancel", project["id"], project["revision"], envelope, apply)
        for error, expected in (("delivery unconfirmed", False), (None, True)):
            store.finish_cancellation("cancel", error)
            with store.reading() as db:
                self.assertIs(store.cancellation_done(db, attempt["id"]), expected)
                for missing in ("missing-attempt", "", None):
                    self.assertIs(store.cancellation_done(db, missing), False)
                with self.assertRaises(sqlite3.ProgrammingError):
                    store.cancellation_done(db, object())

    def test_real_cancel_delivery_and_replay_preserve_result_and_send_once(self):
        # Only the farm boundary is replaced; the adapter, command replay and
        # cancellation acknowledgement all use their real implementation.
        envelope = {**self.envelope, "operationId": "delivered-cancel"}
        with (
            patch("spool.farm.job_value", return_value=self.submission["id"]) as ownership,
            patch("spool.farm.fail_job") as delivery,
        ):
            result = commands.execute(self.store, None, self.project["id"], envelope)
            snapshot = self.file_state(self.store.snapshot)
            replay = commands.execute(self.store, None, self.project["id"], envelope)
        self.assertEqual(result, replay)
        self.assertEqual(result["status"], "cancel_requested")
        self.assertEqual(self.file_state(self.store.snapshot), snapshot)
        ownership.assert_called_once_with("owned-job", "SpoolSubmissionId")
        delivery.assert_called_once_with("owned-job")
        self.assertTrue(self.preflight(self.store))


if __name__ == "__main__":
    unittest.main()
