"""Cloud download ownership with local byte fixtures; no SDK or service calls."""

import asyncio
import errno
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from spool import receipts, requests
from spool.cloud import CloudExecutor
from spool.media import Media
from spool.projects import Workspace


class CloudCollectionPartialTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for kind in ("input", "output", "temp"):
            (self.root / kind).mkdir()
        self.workspace = Workspace(self.root / "app")
        project = self.workspace.create(
            {"project": "Cloud ownership", "clips": [{"id": "shot", "name": "Shot", "takes": []}]},
            self.root / "Film",
        )
        self.store = self.workspace.for_project(project["id"])
        self.media = Media(
            self.store.root, self.root / "input", self.root / "output", self.root / "temp", project_id=project["id"]
        )
        recipe = {
            "prompt": {"save": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "cloud"}}},
            "bindings": [],
            "result": {"nodeId": "save", "group": "videos", "index": 0},
            "executionTarget": "cloud",
        }
        project = self.store.capture(project["id"], project["revision"], "shot", recipe)
        with patch("spool.cloud.available", return_value=True):
            project = requests.accept(
                self.store, self.media, project["id"], project["revision"], [{"clipId": "shot", "count": 1}], "cloud"
            )
        self.attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        self.executor = CloudExecutor(self.workspace, self.media, None)
        self.destination = self.media.result_path(self.attempt, "any-id", ".mp4", True)
        self.destination.parent.mkdir(parents=True, exist_ok=True)
        self.destination.write_bytes(b"previous successful download")
        self.unrelated = self.destination.with_name(self.destination.name + ".other-worker.partial")
        self.unrelated.write_bytes(b"another worker")
        self.data = b"download byte fixture" * 10
        self.paths = []

    def job(self, download):
        output = SimpleNamespace(name="result.mp4", id="output", size_bytes=len(self.data), to_file=download)
        return SimpleNamespace(id="job", get_outputs=lambda node: [output])

    async def collect(self, download, executor=None):
        await (executor or self.executor).collect(
            self.attempt, self.media, self.job(download), "https://fixture.invalid"
        )

    def assert_preserved(self):
        self.assertEqual(self.destination.read_bytes(), b"previous successful download")
        self.assertEqual(self.unrelated.read_bytes(), b"another worker")
        self.assertEqual(set(self.destination.parent.glob("*.partial")), {self.unrelated})

    async def test_two_workspaces_download_without_sharing_a_partial(self):
        second_workspace = Workspace(self.root / "second-app")
        second_workspace.open_folder(self.store.root)
        second = CloudExecutor(second_workspace, self.media, None)
        # These independent workspaces can both legally own their Cloud loop.
        self.executor.ownership.acquire()
        second.ownership.acquire()
        self.addCleanup(self.executor.ownership.close)
        self.addCleanup(second.ownership.close)
        first_written, second_open, first_finished = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def first_download(path):
            self.paths.append(path)
            path.write_bytes(self.data)
            first_written.set()
            await asyncio.wait_for(second_open.wait(), 5)

        async def second_download(path):
            await asyncio.wait_for(first_written.wait(), 5)
            self.paths.append(path)
            with path.open("wb") as handle:
                handle.write(self.data[:1])
                handle.flush()
                second_open.set()
                await asyncio.wait_for(first_finished.wait(), 5)
                handle.write(self.data[1:])

        async def first_collect():
            try:
                await self.collect(first_download)
            finally:
                first_finished.set()

        results = await asyncio.gather(first_collect(), self.collect(second_download, second), return_exceptions=True)
        self.assertEqual(results, [None, None])
        self.assertEqual(len(set(self.paths)), 2)
        self.assertEqual(self.destination.read_bytes(), self.data)
        self.assertEqual(set(self.destination.parent.glob("*.partial")), {self.unrelated})
        result = receipts.verify(self.attempt, self.media.receipt_path(self.attempt), self.media)
        self.assertEqual(result["primary"]["file"], self.destination.relative_to(self.media.root).as_posix())
        self.assertEqual(result["primary"]["byteSize"], len(self.data))

    async def test_download_failure_cleans_only_owned_partial(self):
        error = OSError("download failed")

        async def download(path):
            self.paths.append(path)
            path.write_bytes(self.data[:1])
            raise error

        with self.assertRaises(OSError) as caught:
            await self.collect(download)
        self.assertIs(caught.exception, error)
        self.assert_preserved()

    async def test_replacement_failure_preserves_destination_and_cleans_owned_partial(self):
        error = OSError(errno.EIO, "replacement failed")
        original = Path.replace

        async def download(path):
            self.paths.append(path)
            path.write_bytes(self.data)

        def replace(path, target):
            if target == self.destination:
                raise error
            return original(path, target)

        with patch.object(Path, "replace", replace):
            with self.assertRaises(OSError) as caught:
                await self.collect(download)
        self.assertIs(caught.exception, error)
        self.assert_preserved()

    async def test_denied_cleanup_retains_original_download_error(self):
        error = OSError("original download failure")
        original = Path.unlink

        async def download(path):
            self.paths.append(path)
            path.write_bytes(self.data[:1])
            raise error

        def unlink(path, *args, **kwargs):
            if path in self.paths:
                raise PermissionError("cleanup denied")
            return original(path, *args, **kwargs)

        with patch.object(Path, "unlink", unlink):
            with self.assertRaises(OSError) as caught:
                await self.collect(download)
        self.assertIs(caught.exception, error)
        self.assertEqual(self.destination.read_bytes(), b"previous successful download")
        self.assertEqual(self.unrelated.read_bytes(), b"another worker")


if __name__ == "__main__":
    unittest.main()
