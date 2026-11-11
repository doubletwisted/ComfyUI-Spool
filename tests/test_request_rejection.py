import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from spool import requests
from spool.media import Media, sha256
from spool.projects import Workspace
from spool.store import Conflict, Store


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

    def edit_after_preparing(self):
        """Save the project between freezing and acceptance, as another editor can."""
        original = requests.prepare

        def prepared(*args, **kwargs):
            value = original(*args, **kwargs)
            project = self.store.get(self.project["id"])
            self.store.save(project["id"], project["revision"], project["document"])
            return value

        return patch("spool.requests.prepare", side_effect=prepared)

    def test_rejected_acceptance_removes_the_snapshots_it_froze(self):
        with self.edit_after_preparing():
            with self.assertRaisesRegex(Conflict, "changed while preparing"):
                requests.accept(self.store, self.media, self.project["id"], self.project["revision"], self.items())
        self.assertEqual(self.snapshots(), set())
        self.assertEqual((self.root / "input" / "source.png").read_bytes(), b"unchanged source")
        self.assertEqual(self.store.get(self.project["id"])["document"]["jobs"], [])

    def test_a_failed_freeze_removes_the_snapshots_already_made(self):
        (self.root / "input" / "other.png").write_bytes(b"other source")
        self.capture("second", "other.png")
        original, made = self.media.freeze_asset, []

        def freeze(value):
            if made:
                raise OSError("No space left on device")
            made.append(original(value))
            return made[-1]

        with patch.object(self.media, "freeze_asset", side_effect=freeze):
            with self.assertRaisesRegex(OSError, "No space"):
                requests.accept(self.store, self.media, self.project["id"], self.project["revision"], self.items())
        self.assertEqual(len(made), 1)
        self.assertEqual(self.snapshots(), set())

    def test_a_failure_after_acceptance_keeps_the_snapshots_its_attempts_use(self):
        original = self.store.accept_queue

        def accepted_then_failed(*args):
            original(*args)
            raise OSError("Could not write project.json")

        with patch.object(self.store, "accept_queue", side_effect=accepted_then_failed):
            with self.assertRaisesRegex(OSError, "project.json"):
                requests.accept(self.store, self.media, self.project["id"], self.project["revision"], self.items())
        jobs = self.store.get(self.project["id"])["document"]["jobs"]
        frozen = {
            self.root / "input" / a["frozen"] for j in jobs for a in self.store.attempt(j["id"])["request"]["assets"]
        }
        self.assertEqual(len(jobs), 2)
        self.assertEqual(len(frozen), 1)
        self.assertEqual(self.snapshots(), frozen)

    def test_a_replay_accepted_first_keeps_its_snapshots_and_removes_the_duplicate(self):
        barrier, original = threading.Barrier(2), requests.prepare

        def prepared(*args, **kwargs):
            value = original(*args, **kwargs)
            barrier.wait(timeout=5)
            return value

        def queue():
            return requests.accept(
                self.store, self.media, self.project["id"], self.project["revision"], self.items(), "same-operation"
            )

        with patch("spool.requests.prepare", side_effect=prepared), ThreadPoolExecutor(2) as pool:
            results = [future.result() for future in [pool.submit(queue), pool.submit(queue)]]
        jobs = results[0]["document"]["jobs"]
        self.assertEqual(len(jobs), 2)
        frozen = {
            self.root / "input" / a["frozen"] for j in jobs for a in self.store.attempt(j["id"])["request"]["assets"]
        }
        self.assertEqual(self.snapshots(), frozen)


class ProjectFolderRejectionTests(unittest.TestCase):
    """A project freezes into its own folder and stages that copy for Comfy."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.roots = [self.root / kind for kind in ("input", "output", "temp")]
        for path in self.roots:
            path.mkdir()
        Image.new("RGB", (8, 8), "red").save(self.roots[0] / "source.png")
        self.workspace = Workspace(self.root / "app")
        self.workspace.publish_host({"roots": dict(zip(("input", "output", "temp"), map(str, self.roots)))}, "test")
        project = self.workspace.create(
            {"project": "Rejected queue", "clips": [{"id": "shot", "name": "Shot", "in": 0, "out": 24, "takes": []}]},
            self.root / "projects" / "Rejected queue",
        )
        self.store = self.workspace.for_project(project["id"])
        self.media = Media(self.workspace.root, *self.roots).for_project(self.store, project["id"])
        capture = {
            "workflow": {"nodes": []},
            "prompt": {
                "load": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
                "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "test"}},
            },
            "bindings": [],
            "result": {"nodeId": "save", "group": "images", "index": 0},
        }
        self.project = self.store.capture(project["id"], project["revision"], "shot", capture)

    def snapshots(self):
        return set((self.store.root / ".spool" / "frozen").glob("*")) | set(
            (self.roots[0] / "spool-projects").rglob("frozen/*")
        )

    def test_rejected_acceptance_removes_the_project_and_staged_snapshots(self):
        original = requests.prepare

        def prepared(*args, **kwargs):
            value = original(*args, **kwargs)
            self.assertEqual(len(self.snapshots()), 2)
            project = self.store.get(self.project["id"])
            self.store.save(project["id"], project["revision"], project["document"])
            return value

        with patch("spool.requests.prepare", side_effect=prepared):
            with self.assertRaises(Conflict):
                requests.accept(
                    self.store,
                    self.media,
                    self.project["id"],
                    self.project["revision"],
                    [{"clipId": "shot", "count": 1}],
                )
        self.assertEqual(self.snapshots(), set())
        self.assertTrue((self.roots[0] / "source.png").is_file())
        # The project's own copy of the input is shared with later requests and stays.
        self.assertEqual(len(list((self.store.root / "input").rglob("source*.png"))), 1)

    def test_a_failed_staging_removes_the_frozen_project_copy(self):
        original = self.media.stage_input

        def stage(source):
            if Path(source).parent.name == "frozen":
                raise OSError("No space left on device")
            return original(source)

        with patch.object(self.media, "stage_input", side_effect=stage):
            with self.assertRaisesRegex(OSError, "No space"):
                requests.accept(
                    self.store,
                    self.media,
                    self.project["id"],
                    self.project["revision"],
                    [{"clipId": "shot", "count": 1}],
                )
        self.assertEqual(self.snapshots(), set())

    def test_accepted_requests_keep_their_snapshots(self):
        project = requests.accept(
            self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "shot", "count": 1}]
        )
        asset = self.store.attempt(project["document"]["jobs"][0]["id"])["request"]["assets"][0]
        self.assertTrue((self.roots[0] / asset["frozen"]).is_file())
        self.assertEqual(len(self.snapshots()), 2)


if __name__ == "__main__":
    unittest.main()
