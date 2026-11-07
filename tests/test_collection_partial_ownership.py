"""Collection copies own their temporary files; another collector never shares them.

These checks use real project stores, project folders and farm receipt files. No
Comfy, Cloud or Deadline service is contacted.
"""

import copy
import hashlib
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spool import attempts, farm_protocol, requests
from spool.farm import FarmCollector
from spool.media import Media
from spool.store import Store, empty_project

LOCAL_RECIPE = {
    "prompt": {
        "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "ordinary"}},
    },
    "bindings": [],
    "result": {"nodeId": "save", "group": "images", "index": 0},
}

FARM_RECIPE = {
    "prompt": {
        "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "ordinary"}},
        "submit": {
            "class_type": "DeadlineSubmit",
            "inputs": {"batch_count": 9, "chunk_size": 3, "output_directory": "unused-by-project-requests"},
        },
    },
    "bindings": [],
    "result": {"nodeId": "save", "group": "images", "index": 0},
}


class CollectionFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-collection-ownership-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = Store(self.root / "store")
        for kind in ("input", "output", "temp"):
            (self.root / kind).mkdir()
        document = empty_project()
        document["clips"] = [
            {"id": "shot", "name": "Shot", "revision": 1, "takes": [], "takeId": "original", "outputFolder": "output"}
        ]
        self.project = self.store.create(document)
        self.media = Media(
            self.store.root,
            self.root / "input",
            self.root / "output",
            self.root / "temp",
            project_id=self.project["id"],
        )
        self.identity = "operation-id"

    def accept(self, recipe, operation):
        project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        project = requests.accept(
            self.store,
            self.media,
            project["id"],
            project["revision"],
            [{"clipId": "shot", "count": 1}],
            operation,
        )
        self.project = project
        return self.store.attempt(project["document"]["jobs"][-1]["id"])

    def preserve_destination(self, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"previous successful artifact")
        unrelated = destination.with_name(destination.name + ".another-worker.partial")
        unrelated.write_bytes(b"another worker temporary")
        return unrelated

    def pending(self, destination):
        return destination.with_name(destination.name + "." + self.identity + ".partial")

    def fixed_partial(self, destination):
        return destination.with_name(destination.name + ".partial")

    def attach_source(self):
        self.source = self.root / "output" / "finished.png"
        Image.new("RGB", (8, 8), "blue").save(self.source)
        self.history = {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"save": {"images": [{"filename": "finished.png", "type": "output"}]}},
        }

    def assert_preserved(self, destination, unrelated):
        self.assertEqual(destination.read_bytes(), b"previous successful artifact")
        self.assertEqual(unrelated.read_bytes(), b"another worker temporary")
        self.assertFalse(self.pending(destination).exists())
        self.assertFalse(self.fixed_partial(destination).exists())
        self.assertEqual({path.name for path in destination.parent.glob("*.partial")}, {unrelated.name})

    def assert_published(self, destination, unrelated, expected):
        self.assertEqual(destination.read_bytes(), expected)
        self.assertEqual(unrelated.read_bytes(), b"another worker temporary")
        self.assertFalse(self.pending(destination).exists())
        self.assertFalse(self.fixed_partial(destination).exists())
        self.assertEqual({path.name for path in destination.parent.glob("*.partial")}, {unrelated.name})


class LocalCollectionOwnershipTests(CollectionFixture):
    def setUp(self):
        super().setUp()
        self.attempt = self.accept(LOCAL_RECIPE, "local-accept")
        self.attach_source()
        self.destination = self.media.result_path(self.attempt, "artifact-id", ".png", True)
        self.unrelated = self.preserve_destination(self.destination)

    def collect(self, media=None):
        return (media or self.media).collect(self.attempt, self.history, False)

    def test_failed_copy_removes_only_its_own_partial(self):
        error = OSError("injected copy failure")

        def copy(source, destination):
            self.assertEqual(Path(source), self.source)
            Path(destination).write_bytes(b"partially copied artifact")
            raise error

        with (
            patch("spool.media.uid", return_value=self.identity),
            patch("spool.media.shutil.copyfile", side_effect=copy),
        ):
            with self.assertRaises(OSError) as raised:
                self.collect()
        self.assertIs(raised.exception, error)
        self.assert_preserved(self.destination, self.unrelated)

    def test_failed_replace_removes_only_its_own_partial(self):
        error = PermissionError("injected replacement failure")
        original = Path.replace

        def replace(source, destination):
            if Path(source) == self.pending(self.destination):
                self.assertEqual(Path(destination), self.destination)
                raise error
            return original(source, destination)

        with (
            patch("spool.media.uid", return_value=self.identity),
            patch.object(Path, "replace", replace),
        ):
            with self.assertRaises(PermissionError) as raised:
                self.collect()
        self.assertIs(raised.exception, error)
        self.assert_preserved(self.destination, self.unrelated)

    def test_cleanup_failure_preserves_the_original_copy_error(self):
        error = OSError("original copy error")
        attempted = []
        original = Path.unlink

        def copy(source, destination):
            Path(destination).write_bytes(b"partially copied artifact")
            raise error

        def unlink(path, *args, **kwargs):
            if path == self.pending(self.destination):
                attempted.append(path)
                raise PermissionError("cleanup was denied")
            return original(path, *args, **kwargs)

        with (
            patch("spool.media.uid", return_value=self.identity),
            patch("spool.media.shutil.copyfile", side_effect=copy),
            patch.object(Path, "unlink", unlink),
        ):
            with self.assertRaises(OSError) as raised:
                self.collect()
        self.assertIs(raised.exception, error)
        self.assertEqual(attempted, [self.pending(self.destination)])

    def test_concurrent_collectors_use_distinct_partials_and_both_complete(self):
        second_media = Media(
            self.store.root,
            self.root / "input",
            self.root / "output",
            self.root / "temp",
            project_id=self.project["id"],
        )
        source_bytes = self.source.read_bytes()
        original_copy, original_replace = shutil.copyfile, Path.replace
        first_copied, second_writing, first_published = (
            threading.Event(),
            threading.Event(),
            threading.Event(),
        )
        pending_paths, results, errors = [], [], []

        def copyfile(source, destination, *args, **kwargs):
            destination = Path(destination)
            pending_paths.append(destination)
            if threading.current_thread().name == "second":
                if not first_copied.wait(5):
                    raise RuntimeError("The first collector never copied its artifact")
                data = Path(source).read_bytes()
                handle = destination.open("wb")
                try:
                    handle.write(data[:1])
                    handle.flush()
                    second_writing.set()
                    if not first_published.wait(5):
                        raise RuntimeError("The first collector never published its artifact")
                    handle.write(data[1:])
                finally:
                    handle.close()
                return len(data)
            result = original_copy(source, destination, *args, **kwargs)
            first_copied.set()
            return result

        def replace(source, destination):
            if threading.current_thread().name == "first" and Path(source).name.endswith(".partial"):
                if not second_writing.wait(5):
                    raise RuntimeError("The second collector never started its copy")
                try:
                    return original_replace(source, destination)
                finally:
                    first_published.set()
            return original_replace(source, destination)

        def run(media):
            try:
                results.append(self.collect(media))
            except BaseException as error:  # noqa: BLE001 - reported below with thread identity
                errors.append(error)

        with patch("spool.media.shutil.copyfile", copyfile), patch.object(Path, "replace", replace):
            threads = [
                threading.Thread(target=run, args=(media,), name=name)
                for media, name in ((self.media, "first"), (second_media, "second"))
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(10)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(len(set(pending_paths)), 2)
        self.assertEqual(len({path.name for path in pending_paths}), 2)
        self.assertTrue(all(path.name.endswith(".partial") for path in pending_paths))
        self.assert_published(self.destination, self.unrelated, source_bytes)
        for artifacts, primary in results:
            self.assertEqual(primary["sha256"], hashlib.sha256(source_bytes).hexdigest())
            self.assertEqual(primary["byteSize"], len(source_bytes))

    def test_successful_collection_keeps_its_destination_and_metadata(self):
        artifacts, primary = self.collect()
        source_bytes = self.source.read_bytes()
        self.assertEqual(primary, artifacts[-1])
        self.assertEqual(primary["file"], self.destination.relative_to(self.media.root).as_posix())
        self.assertEqual(primary["originalFile"], self.destination.relative_to(self.media.root).as_posix())
        self.assertEqual(primary["sha256"], hashlib.sha256(source_bytes).hexdigest())
        self.assertEqual(primary["byteSize"], len(source_bytes))
        self.assertEqual((primary["nodeId"], primary["group"], primary["index"]), ("save", "images", 0))
        self.assert_published(self.destination, self.unrelated, source_bytes)


class FarmCollectionOwnershipTests(CollectionFixture):
    def setUp(self):
        super().setUp()
        self.attempt = self.accept(FARM_RECIPE, "farm-accept")
        self.package = self.stage(self.attempt)
        self.store.acknowledge(self.submission["id"], "job-" + self.attempt["id"])
        self.store.transition(self.attempt["id"], attempts.FARM_RUNNING)
        self.attempt = self.store.attempt(self.attempt["id"])
        self.receipt = self.finish(self.package)
        self.execution_id = self.receipt["executionId"]
        self.artifact = self.receipt["artifacts"][0]
        self.source = farm_protocol.contained(self.result_root, self.artifact["path"])
        self.destination = self.media.result_path(
            self.attempt, self.artifact["artifactId"], self.source.suffix.lower(), True, self.execution_id
        )
        self.unrelated = self.preserve_destination(self.destination)

    def stage(self, attempt):
        request = attempt["request"]
        root = Path(request["prompt"][request["launcherNodeId"]]["inputs"]["output_directory"]).resolve()
        package = {
            "schemaVersion": 2,
            **{key: request[key] for key in ("projectId", "clipId", "takeId", "attemptId", "fingerprint")},
            "variationIndex": 0,
            "resultRoot": str(root),
            "result": request["capture"]["result"],
            "assets": copy.deepcopy(request["assets"]),
            "stagedPrompt": {
                key: copy.deepcopy(value)
                for key, value in request["prompt"].items()
                if key != request["launcherNodeId"]
            },
        }
        submission = self.store.submission(attempt["id"], package)
        package["submissionId"] = submission["id"]
        directory = root / "spool-submissions" / submission["id"]
        farm_protocol.atomic_json(directory / "request.json", package)
        farm_protocol.atomic_json(
            directory / "ack.json",
            {
                **{key: package[key] for key in ("schemaVersion", "submissionId", "attemptId", "fingerprint")},
                "jobId": "job-" + attempt["id"],
            },
        )
        self.result_root, self.submission = root, submission
        return package

    def finish(self, package):
        physical = farm_protocol.prepare_execution(package, package["stagedPrompt"], self.media.host_roots["input"], 0)
        filename = physical["executionId"] + ".png"
        Image.new("RGB", (8, 8), "blue").save(self.root / "output" / filename)
        history = {
            "prompt": [0, "worker-prompt", physical["prompt"]],
            "status": {"status_str": "success", "completed": True},
            "outputs": {"save": {"images": [{"filename": filename, "type": "output"}]}},
        }
        receipt = farm_protocol.finalize(
            package,
            physical,
            "worker-prompt",
            history,
            self.media.host_roots,
            "render-01",
            "job-" + self.attempt["id"],
        )
        farm_protocol.verify(package, receipt, package["resultRoot"])
        return receipt

    def collector(self, store=None, media=None):
        store = store or self.store
        collector = FarmCollector(store, media or self.media)
        collector.observed_at[store.submission_for(self.attempt["id"])["id"]] = time.monotonic()
        return collector

    def test_failed_copy_removes_only_its_own_partial(self):
        error = OSError("injected farm copy failure")

        def copy(source, destination):
            Path(destination).write_bytes(b"partially copied farm artifact")
            raise error

        with (
            patch("spool.media.uid", return_value=self.identity),
            patch("spool.farm.shutil.copyfile", side_effect=copy),
        ):
            with self.assertRaises(OSError) as raised:
                self.collector().collect(self.attempt)
        self.assertIs(raised.exception, error)
        self.assert_preserved(self.destination, self.unrelated)

    def test_checksum_failure_removes_only_its_own_partial(self):
        original = farm_protocol.checksum

        def checksum(path):
            return "0" * 64 if Path(path).name.endswith(".partial") else original(path)

        with (
            patch("spool.media.uid", return_value=self.identity),
            patch("spool.farm.farm_protocol.checksum", side_effect=checksum),
        ):
            with self.assertRaisesRegex(ValueError, "changed checksum"):
                self.collector().collect(self.attempt)
        self.assert_preserved(self.destination, self.unrelated)

    def test_failed_replace_removes_only_its_own_partial(self):
        error = PermissionError("injected farm replacement failure")
        original = Path.replace

        def replace(source, destination):
            if Path(source) == self.pending(self.destination):
                self.assertEqual(Path(destination), self.destination)
                raise error
            return original(source, destination)

        with (
            patch("spool.media.uid", return_value=self.identity),
            patch.object(Path, "replace", replace),
        ):
            with self.assertRaises(PermissionError) as raised:
                self.collector().collect(self.attempt)
        self.assertIs(raised.exception, error)
        self.assert_preserved(self.destination, self.unrelated)

    def test_concurrent_collectors_use_distinct_partials_and_both_complete(self):
        second_store = Store(self.store.root)
        second_media = Media(
            second_store.root,
            self.root / "input",
            self.root / "output",
            self.root / "temp",
            project_id=self.project["id"],
        )
        first, second = self.collector(), self.collector(second_store, second_media)
        source_bytes = self.source.read_bytes()
        original_copy = shutil.copyfile
        original_checksum = farm_protocol.checksum
        first_copied, second_writing, first_verified = (
            threading.Event(),
            threading.Event(),
            threading.Event(),
        )
        pending_paths, errors = [], []
        original_describe = Media.describe

        def describe(media, path, *args, **kwargs):
            metadata = original_describe(media, path, *args, **kwargs)
            # Both collectors describe the same artifact bytes. Keep the one
            # random review identity stable so duplicate acceptance compares the
            # same evidence instead of a per-collector ID.
            metadata["id"] = "shared-artifact"
            return metadata

        def copyfile(source, destination, *args, **kwargs):
            destination = Path(destination)
            pending_paths.append(destination)
            if threading.current_thread().name == "second":
                if not first_copied.wait(5):
                    raise RuntimeError("The first collector never copied its artifact")
                data = Path(source).read_bytes()
                handle = destination.open("wb")
                try:
                    handle.write(data[:1])
                    handle.flush()
                    second_writing.set()
                    if not first_verified.wait(5):
                        raise RuntimeError("The first collector never verified its artifact")
                    handle.write(data[1:])
                finally:
                    handle.close()
                return len(data)
            result = original_copy(source, destination, *args, **kwargs)
            first_copied.set()
            return result

        def checksum(path):
            if threading.current_thread().name == "first" and Path(path).name.endswith(".partial"):
                if not second_writing.wait(5):
                    raise RuntimeError("The second collector never started its copy")
                try:
                    return original_checksum(path)
                finally:
                    first_verified.set()
            return original_checksum(path)

        def run(collector):
            try:
                collector.collect(self.attempt)
            except BaseException as error:  # noqa: BLE001 - reported below with thread identity
                errors.append(error)

        with (
            patch.object(Media, "describe", describe),
            patch("spool.farm.shutil.copyfile", copyfile),
            patch("spool.farm.farm_protocol.checksum", side_effect=checksum),
        ):
            threads = [
                threading.Thread(target=run, args=(collector,), name=name)
                for collector, name in ((first, "first"), (second, "second"))
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(10)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(errors, [])
        self.assertEqual(len(set(pending_paths)), 2)
        self.assertTrue(all(path.name.endswith(".partial") for path in pending_paths))
        self.assert_published(self.destination, self.unrelated, source_bytes)
        self.assertEqual(self.store.attempt(self.attempt["id"])["status"], attempts.COMPLETE)
        execution = self.store.execution(self.execution_id)
        self.assertIsNotNone(execution)
        self.assertEqual(execution["receipt"]["primaryArtifactId"], self.receipt["primaryArtifactId"])
        saved = execution["receipt"]["artifacts"][0]
        self.assertEqual(saved["sha256"], self.artifact["sha256"])
        self.assertEqual(saved["file"], self.destination.relative_to(self.media.root).as_posix())

    def test_successful_ingestion_keeps_its_farm_receipt_and_destination(self):
        self.collector().collect(self.attempt)
        source_bytes = self.source.read_bytes()
        self.assert_published(self.destination, self.unrelated, source_bytes)
        self.assertEqual(self.store.attempt(self.attempt["id"])["status"], attempts.COMPLETE)
        execution = self.store.execution(self.execution_id)
        self.assertIsNotNone(execution)
        self.assertEqual(execution["receipt"]["primaryArtifactId"], self.receipt["primaryArtifactId"])
        saved = execution["receipt"]["artifacts"][0]
        self.assertEqual(saved["sha256"], self.artifact["sha256"])
        self.assertEqual(saved["byteSize"], self.artifact["byteSize"])
        self.assertEqual(saved["file"], self.destination.relative_to(self.media.root).as_posix())


if __name__ == "__main__":
    unittest.main()
