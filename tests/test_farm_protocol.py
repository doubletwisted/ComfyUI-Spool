import copy
import os
import unittest
from unittest.mock import patch
from pathlib import Path

from PIL import Image

from spool import farm_protocol as protocol
from spool.collection import Collector
import test_queue_operations as fixtures


class FarmProtocolTests(unittest.TestCase):
    accept = fixtures.QueueOperationTests.accept
    tearDown = fixtures.QueueOperationTests.tearDown

    def setUp(self):
        fixtures.QueueOperationTests.setUp(self)
        observation = patch("spool.farm.deadline_command", return_value="JobStatus=Rendering")
        observation.start()
        self.addCleanup(observation.stop)
        recipe = copy.deepcopy(self.recipe)
        recipe["prompt"]["submit"] = {
            "class_type": "DeadlineSubmit",
            "inputs": {"batch_count": 9, "chunk_size": 3, "output_directory": str(self.root / "farm")},
        }
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        self.items = [{"clipId": "shot", "count": 2}]
        self.accept()
        self.farm_attempts = [
            self.store.attempt(j["id"]) for j in self.store.get(self.project["id"])["document"]["jobs"]
        ]

    def package(self, attempt):
        request = attempt["request"]
        value = {
            "schemaVersion": 2,
            **{k: request[k] for k in ("projectId", "clipId", "takeId", "attemptId", "fingerprint")},
            "variationIndex": 0,
            "resultRoot": str(self.root / "farm"),
            "result": request["capture"]["result"],
            "assets": copy.deepcopy(request["assets"]),
            "stagedPrompt": {k: copy.deepcopy(v) for k, v in request["prompt"].items() if k != "submit"},
        }
        submission = self.store.submission(attempt["id"], value)
        value["submissionId"] = submission["id"]
        for asset in value["assets"]:
            asset["staged"] = asset["frozen"]
        directory = self.root / "farm" / "spool-submissions" / submission["id"]
        protocol.atomic_json(directory / "request.json", value)
        protocol.atomic_json(
            directory / "ack.json",
            {
                **{k: value[k] for k in ("schemaVersion", "submissionId", "attemptId", "fingerprint")},
                "jobId": "job-" + attempt["id"],
            },
        )
        return value

    def finish(self, attempt):
        package = self.package(attempt)
        physical = protocol.prepare_execution(package, package["stagedPrompt"], self.media.host_roots["input"], 0)
        filename = physical["executionId"] + ".png"
        Image.new("RGB", (8, 8), "blue").save(self.root / "output" / filename)
        history = {
            "prompt": [0, "worker-prompt", physical["prompt"]],
            "status": {"status_str": "success", "completed": True},
            "outputs": {"save": {"images": [{"filename": filename, "type": "output"}]}},
        }
        receipt = protocol.finalize(
            package, physical, "worker-prompt", history, self.media.host_roots, "render-01", "job-" + attempt["id"]
        )
        protocol.verify(package, receipt, package["resultRoot"])
        return package, receipt

    def test_invalid_receipt_does_not_block_a_later_valid_execution(self):
        attempt = self.farm_attempts[0]
        self.finish(attempt)
        path = self.root / "farm" / "spool-receipts" / attempt["id"] / "000-invalid" / "receipt.json"
        path.parent.mkdir(parents=True)
        path.write_text("{unfinished", encoding="utf-8")
        collector = Collector(self.store, self.media)
        collector.scan()
        collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")
        events = self.store.events(self.project["id"])["events"]
        self.assertEqual(sum(e["kind"] == "receipt.rejected" for e in events), 1)

    def test_cancel_during_farm_observation_cannot_be_overwritten(self):
        attempt = self.farm_attempts[0]
        self.package(attempt)
        self.store.transition(attempt["id"], "farm_queued")
        collector = Collector(self.store, self.media)

        def observation(arguments):
            self.store.transition(attempt["id"], "cancel_requested", expected="farm_queued")
            return "JobStatus=Rendering"

        with patch("spool.farm.deadline_command", side_effect=observation):
            collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancel_requested")
        for farm in collector.farms.values():
            farm.observed_at.clear()
        with patch("spool.farm.deadline_command", return_value="JobStatus=Failed"):
            collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancelled")

    def test_unchanged_collected_receipts_skip_hashes_until_restart(self):
        attempt = self.farm_attempts[0]
        self.finish(attempt)
        collector = Collector(self.store, self.media)
        collector.scan()
        winner = self.store.attempt(attempt["id"])["result"]
        with patch("spool.farm_protocol.checksum", wraps=protocol.checksum) as checksum:
            for _ in range(3):
                collector.scan()
            self.assertEqual(checksum.call_count, 0)
            restarted = Collector(self.store, self.media)
            restarted.scan()
            self.assertEqual(checksum.call_count, 1)
            restarted.scan()
            self.assertEqual(checksum.call_count, 1)
        self.assertEqual(self.store.attempt(attempt["id"])["result"], winner)

    def test_changed_receipt_and_artifact_are_verified_without_replacing_winner(self):
        attempt = self.farm_attempts[0]
        package, receipt = self.finish(attempt)
        collector = Collector(self.store, self.media)
        collector.scan()
        winner = self.store.attempt(attempt["id"])["result"]
        path = self.root / "farm" / "spool-receipts" / attempt["id"] / receipt["executionId"] / "receipt.json"
        changed = copy.deepcopy(receipt)
        changed["worker"] = "different-worker"
        protocol.atomic_json(path, changed)
        with patch("spool.farm_protocol.checksum", wraps=protocol.checksum) as checksum:
            collector.scan()
            self.assertEqual(checksum.call_count, 1)
        with self.store.connect() as db:
            self.assertIn(
                "different evidence",
                db.execute("SELECT error FROM rejected_receipts WHERE path=?", (str(path.resolve()),)).fetchone()[0],
            )
        protocol.atomic_json(path, receipt)
        collector.scan()
        artifact = Path(package["resultRoot"]) / receipt["artifacts"][0]["path"]
        before = artifact.stat()
        changed_bytes = bytearray(artifact.read_bytes())
        changed_bytes[-1] ^= 1
        artifact.write_bytes(changed_bytes)
        os.utime(artifact, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000))
        with patch("spool.farm_protocol.checksum", wraps=protocol.checksum) as checksum:
            collector.scan()
            self.assertEqual(checksum.call_count, 1)
        self.assertEqual(self.store.attempt(attempt["id"])["result"], winner)

    def test_known_execution_id_in_another_path_cannot_bypass_verification(self):
        attempt = self.farm_attempts[0]
        _, receipt = self.finish(attempt)
        collector = Collector(self.store, self.media)
        collector.scan()
        path = self.root / "farm" / "spool-receipts" / attempt["id"] / "forged" / "receipt.json"
        receipt["observedPrompt"]["save"]["inputs"]["filename_prefix"] = "forged"
        protocol.atomic_json(path, receipt)
        with patch("spool.farm_protocol.verify", wraps=protocol.verify) as verify:
            collector.scan()
            self.assertEqual(verify.call_count, 1)
        with self.store.connect() as db:
            self.assertIsNotNone(
                db.execute("SELECT error FROM rejected_receipts WHERE path=?", (str(path.resolve()),)).fetchone()
            )
            self.assertEqual(db.execute("SELECT count(*) FROM executions").fetchone()[0], 1)

    def test_cached_winner_does_not_hide_late_executions(self):
        attempt = self.farm_attempts[0]
        self.finish(attempt)
        collector = Collector(self.store, self.media)
        collector.scan()
        winner = self.store.attempt(attempt["id"])["result"]
        self.finish(attempt)
        with patch("spool.farm_protocol.verify", wraps=protocol.verify) as verify:
            collector.scan()
            self.assertEqual(verify.call_count, 1)
            collector.scan()
            self.assertEqual(verify.call_count, 1)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM executions").fetchone()[0], 2)
        self.assertEqual(self.store.attempt(attempt["id"])["result"], winner)
        self.assertEqual(self.store.get(self.project["id"])["document"]["clips"][0]["takeId"], "original")

    def test_cache_cannot_skip_verification_when_execution_ledger_changes(self):
        attempt = self.farm_attempts[0]
        self.finish(attempt)
        collector = Collector(self.store, self.media)
        collector.scan()
        winner = self.store.attempt(attempt["id"])["result"]
        with self.store.connect() as db:
            db.execute("DELETE FROM executions")
        with patch("spool.farm_protocol.checksum", wraps=protocol.checksum) as checksum:
            collector.scan()
            self.assertEqual(checksum.call_count, 2)  # Source verification and ingestion copy.
            collector.scan()
            self.assertEqual(checksum.call_count, 2)
        self.assertEqual(self.store.attempt(attempt["id"])["result"], winner)

    def test_cancel_confirmation_stops_waiting_and_late_receipts_still_collect(self):
        attempt = self.farm_attempts[0]
        self.package(attempt)
        self.store.transition(attempt["id"], "cancel_requested")
        collector = Collector(self.store, self.media)
        with patch("spool.farm.deadline_command", return_value="JobStatus=Rendering"):
            collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancel_requested")
        collector = Collector(self.store, self.media)
        with patch("spool.farm.deadline_command", return_value="JobStatus=Failed"):
            collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancelled")
        finished = self.store.get(self.project["id"])["document"]["jobs"][0]["finishedAt"]
        self.assertIsNotNone(finished)
        collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancelled")
        self.assertEqual(self.store.get(self.project["id"])["document"]["jobs"][0]["finishedAt"], finished)
        self.finish(attempt)
        collector.scan()
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")
        self.assertEqual(self.store.get(self.project["id"])["document"]["clips"][0]["takeId"], "original")

    def test_out_of_order_and_late_retry_preserve_take_identity_and_choice(self):
        first, second = self.farm_attempts
        self.finish(second)
        Collector(self.store, self.media).scan()
        saved = self.store.get(self.project["id"])
        self.assertEqual(saved["document"]["clips"][0]["takes"][0]["id"], second["take_id"])
        self.assertEqual(saved["document"]["clips"][0]["takes"][0]["number"], 2)
        self.finish(first)
        Collector(self.store, self.media).scan()
        winner = self.store.attempt(first["id"])["result"]
        finished = self.store.get(self.project["id"])["document"]["jobs"][0]["finishedAt"]
        self.finish(first)
        Collector(self.store, self.media).scan()
        self.assertEqual(self.store.attempt(first["id"])["result"], winner)
        self.assertEqual(self.store.get(self.project["id"])["document"]["jobs"][0]["finishedAt"], finished)
        self.assertEqual(self.store.get(self.project["id"])["document"]["clips"][0]["takeId"], "original")
        self.assertEqual(
            [t["number"] for t in self.store.get(self.project["id"])["document"]["clips"][0]["takes"]], [1, 2]
        )
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM executions").fetchone()[0], 3)

    def test_receipt_wrong_owner_tamper_and_hook_changes_rejected(self):
        package, receipt = self.finish(self.farm_attempts[0])
        for key in ("attemptId", "takeId", "projectId", "submissionId"):
            wrong = copy.deepcopy(receipt)
            wrong[key] = "wrong"
            with self.assertRaises(ValueError):
                protocol.verify(package, wrong, package["resultRoot"])
        wrong = copy.deepcopy(receipt)
        wrong["observedPrompt"]["save"]["inputs"]["filename_prefix"] = "global"
        with self.assertRaises(ValueError):
            protocol.verify(package, wrong, package["resultRoot"])
        file = Path(package["resultRoot"]) / receipt["artifacts"][0]["path"]
        bytes_ = bytearray(file.read_bytes())
        bytes_[-1] ^= 1
        file.write_bytes(bytes_)
        with self.assertRaises(ValueError):
            protocol.verify(package, receipt, package["resultRoot"])

    def test_variation_assignment_and_dependency_integrity(self):
        package = self.package(self.farm_attempts[0])
        with self.assertRaises(ValueError):
            protocol.prepare_execution(package, package["stagedPrompt"], self.root / "input", 5)
        asset = self.root / "input" / package["assets"][0]["staged"]
        asset.write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            protocol.prepare_execution(package, package["stagedPrompt"], self.root / "input", 0)

    def test_worker_progress_updates_and_requeues_without_changing_the_edit(self):
        attempt = self.farm_attempts[0]
        self.package(attempt)
        collector = Collector(self.store, self.media)
        with patch(
            "spool.farm.deadline_command",
            side_effect=[
                "JobStatus=Active\nSingleTaskProgress=80 %",
                "TaskStatus=Rendering\nTaskProgress=85 %\nTaskSlaveName=render-02\nTaskRenderStatus=Step 17/20",
            ],
        ):
            collector.scan()
        project = collector.annotate_progress(self.store.get(self.project["id"]))
        job = next(j for j in project["document"]["jobs"] if j["id"] == attempt["id"])
        self.assertEqual(job["status"], "farm_running")
        self.assertEqual(job["farmProgress"]["percent"], 85)
        self.assertEqual(job["farmProgress"]["worker"], "render-02")
        self.assertEqual(job["farmProgress"]["message"], "Step 17/20")
        farm = next(iter(collector.farms.values()))
        farm.observed_at.clear()
        with patch(
            "spool.farm.deadline_command", side_effect=["JobStatus=Active", "TaskStatus=Queued\nTaskProgress=0 %"]
        ):
            collector.scan()
        project = collector.annotate_progress(self.store.get(self.project["id"]))
        job = next(j for j in project["document"]["jobs"] if j["id"] == attempt["id"])
        self.assertEqual(job["status"], "farm_queued")
        self.assertEqual(job["farmProgress"]["percent"], 0)
        self.assertEqual(project["document"]["clips"][0]["takeId"], "original")

    def test_unavailable_progress_does_not_invent_a_percentage_or_fail_the_job(self):
        attempt = self.farm_attempts[0]
        self.package(attempt)
        collector = Collector(self.store, self.media)
        with patch("spool.farm.deadline_command", return_value="JobStatus=Rendering"):
            collector.scan()
        project = collector.annotate_progress(self.store.get(self.project["id"]))
        job = next(j for j in project["document"]["jobs"] if j["id"] == attempt["id"])
        self.assertIsNone(job["farmProgress"]["percent"])
        self.assertEqual(job["status"], "farm_running")


if __name__ == "__main__":
    unittest.main()
