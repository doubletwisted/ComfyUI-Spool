import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import requests
from spool.media import Media, sha256
from spool.store import Store


class RequestRejectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root / "store")
        for folder in ("input", "output", "temp"):
            (self.root / folder).mkdir()
        (self.root / "input" / "source.png").write_bytes(b"unchanged source")
        self.media = Media(self.store.root, self.root / "input", self.root / "output", self.root / "temp")
        self.project = self.store.create(
            {
                "project": "Queue rejection",
                "clips": [
                    {"id": identity, "name": identity, "in": 0, "out": 24, "takes": []}
                    for identity in ("first", "second")
                ],
                "media": [],
            }
        )
        for identity in ("first", "second"):
            self.capture(identity)

    def capture(self, identity, filename="source.png"):
        self.project = self.store.capture(
            self.project["id"],
            self.project["revision"],
            identity,
            {
                "workflow": {"nodes": [], "links": []},
                "prompt": {
                    "load": {"class_type": "LoadImage", "inputs": {"image": filename}},
                    "save": {
                        "class_type": "SaveImage",
                        "inputs": {"images": ["load", 0], "filename_prefix": "test"},
                    },
                },
                "bindings": [],
                "result": {"nodeId": "save", "group": "images", "index": 0},
            },
        )

    def items(self, count=1):
        return [{"clipId": "first", "count": 1}, {"clipId": "second", "count": count}]

    def snapshots(self):
        return set((self.root / "input" / "spool-frozen").glob("*"))

    def test_later_invalid_item_creates_no_snapshots_and_keeps_accepted_ones(self):
        accepted = requests.prepare(self.store, self.media, self.project, self.items())
        before = {path: path.read_bytes() for path in self.snapshots()}
        with patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze:
            with self.assertRaisesRegex(ValueError, "1-16"):
                requests.prepare(self.store, self.media, self.project, self.items(0))
            freeze.assert_not_called()
        self.assertEqual({path: path.read_bytes() for path in self.snapshots()}, before)
        self.assertEqual(accepted[0][1]["assets"][0]["frozen"], accepted[1][1]["assets"][0]["frozen"])

    def test_later_missing_input_creates_no_snapshot(self):
        self.capture("second", "missing.png")
        with patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze:
            with self.assertRaises((ValueError, FileNotFoundError)):
                requests.prepare(self.store, self.media, self.project, self.items())
            freeze.assert_not_called()
        self.assertEqual(self.snapshots(), set())

    def test_accepted_batch_shares_one_snapshot_and_a_new_batch_gets_new_bytes(self):
        with patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze:
            accepted = requests.prepare(self.store, self.media, self.project, self.items())
            self.assertEqual(freeze.call_count, 1)
        first = accepted[0][1]["assets"][0]
        frozen = self.root / "input" / first["frozen"]
        self.assertEqual(first["sha256"], sha256(frozen))
        for _, request in accepted:
            self.assertEqual(request["assets"][0]["frozen"], first["frozen"])
            self.assertEqual(request["prompt"]["load"]["inputs"]["image"], first["frozen"])
        (self.root / "input" / "source.png").write_bytes(b"later source")
        later = requests.prepare(self.store, self.media, self.project, self.items())
        self.assertEqual(frozen.read_bytes(), b"unchanged source")
        self.assertNotEqual(later[0][1]["assets"][0]["frozen"], first["frozen"])

    def test_preview_never_creates_a_snapshot(self):
        with patch.object(self.media, "freeze_asset", wraps=self.media.freeze_asset) as freeze:
            prepared = requests.prepare(self.store, self.media, self.project, self.items(), freeze=False)
            freeze.assert_not_called()
        self.assertEqual(prepared[0][1]["prompt"]["load"]["inputs"]["image"], "source.png")
        self.assertEqual(self.snapshots(), set())


if __name__ == "__main__":
    unittest.main()
