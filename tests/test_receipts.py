import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool import attempts, receipts
from spool.media import Media
from spool.store import Store


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        storage = self.root / "storage"
        storage.mkdir()
        self.media = Media(storage, self.root, self.root, self.root)
        Image.new("RGB", (8, 8), "blue").save(self.root / "source.png")
        self.attempt = {
            "id": "attempt-qa",
            "take_id": "take-qa",
            "prompt_id": "prompt-qa",
            "request": {
                "fingerprint": "frozen-request",
                "prompt": {"save": {"class_type": "SaveImage"}},
                "capture": {"result": {"nodeId": "save", "group": "images", "index": 0}},
            },
        }
        self.history = {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"save": {"images": [{"filename": "source.png", "type": "output"}]}},
        }
        artifacts, primary = self.media.collect(self.attempt, self.history)
        self.directory = storage / "artifacts" / self.attempt["id"]
        self.path = self.directory / "receipt.json"
        self.assertFalse(self.path.exists(), "Media collection must not write receipts")
        self.receipt = receipts.write(self.directory, self.attempt, artifacts, primary, self.history)

    def tearDown(self):
        self.temp.cleanup()

    def corrupt(self, mutate):
        value = json.loads(json.dumps(self.receipt))
        mutate(value)
        self.path.write_text(json.dumps(value), encoding="utf-8")
        return receipts.verify(self.attempt, self.path, self.media)

    def test_atomic_receipt_round_trip_and_no_partial(self):
        self.assertEqual(receipts.verify(self.attempt, self.path, self.media), self.receipt)
        self.assertEqual(self.receipt["schemaVersion"], 1)
        self.assertFalse((self.directory / "receipt.partial").exists())
        self.assertEqual(self.receipt["history"], self.history)

    def test_fingerprint_attempt_and_prompt_identity(self):
        for key in ["fingerprint", "attemptId", "promptId"]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "frozen attempt"):
                self.corrupt(lambda value: value.update({key: "wrong"}))

    def test_primary_must_be_selected_and_in_artifacts(self):
        with self.assertRaisesRegex(ValueError, "explicit result selection"):
            self.corrupt(lambda value: value["primary"].update({"artifactId": "not-present"}))
        with self.assertRaisesRegex(ValueError, "explicit result selection"):
            self.corrupt(lambda value: value["primary"].update({"index": 1}))

    def test_source_artifact_cannot_escape_attempt_namespace(self):
        source = self.media.root / "other.png"
        Image.new("RGB", (8, 8), "red").save(source)
        with self.assertRaisesRegex(ValueError, "outside this attempt"):
            self.corrupt(
                lambda value: value["artifacts"][0].update(
                    {"originalFile": "other.png", "byteSize": source.stat().st_size}
                )
            )

    def test_changed_size_and_missing_review_media(self):
        with self.assertRaisesRegex(ValueError, "changed size"):
            self.corrupt(lambda value: value["artifacts"][0].update({"byteSize": 1}))
        with self.assertRaisesRegex(ValueError, "missing or unsupported"):
            self.corrupt(lambda value: value["artifacts"][0].update({"file": "missing.png"}))

    def test_same_size_corruption_is_rejected(self):
        original = self.media.resolve(self.receipt["artifacts"][0]["originalFile"])
        content = bytearray(original.read_bytes())
        content[-1] ^= 1
        original.write_bytes(content)
        with self.assertRaisesRegex(ValueError, "checksum"):
            receipts.verify(self.attempt, self.path, self.media)

    def test_take_version_and_completion_are_verified(self):
        for field, value in [("takeId", "other"), ("schemaVersion", 999)]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.corrupt(lambda r: r.update({field: value}))
        with self.assertRaisesRegex(ValueError, "completion"):
            self.corrupt(lambda r: r["history"]["status"].update({"completed": False}))


class AttemptStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name))
        self.project = self.store.create()
        self.attempt = self.store.intent(
            self.project["id"], {"id": "clip-qa", "name": "QA"}, {"capture": {}, "prompt": {}}
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_retryable_collection_is_pending_until_complete(self):
        identity = self.attempt["id"]
        for status in [
            attempts.DISPATCHING,
            attempts.QUEUED,
            attempts.RUNNING,
            attempts.COLLECTING,
            attempts.COLLECTION_PENDING,
            attempts.COLLECTING,
        ]:
            self.store.transition(identity, status)
            self.assertIn(identity, self.store.pending())
        self.store.transition(identity, attempts.COMPLETE, result={"receipt": "chosen"})
        self.assertNotIn(identity, self.store.pending())
        with self.assertLogs(level="WARNING"):
            self.store.transition(identity, attempts.FAILED, result={"receipt": "late failure"})
        final = self.store.attempt(identity)
        self.assertEqual(final["status"], attempts.COMPLETE)
        self.assertEqual(json.loads(final["result"]), {"receipt": "chosen"})

    def test_transition_contract_is_advisory_for_crash_reconstruction(self):
        identity = self.attempt["id"]
        self.store.transition(identity, attempts.DISPATCHING)
        self.store.transition(identity, attempts.QUEUED)
        with self.assertLogs(level="WARNING") as logs:
            self.store.transition(identity, attempts.DISPATCHING)
        self.assertIn("queued -> dispatching", logs.output[0])
        self.assertEqual(self.store.attempt(identity)["status"], attempts.DISPATCHING)
        self.assertIn(identity, self.store.pending())


if __name__ == "__main__":
    unittest.main()
