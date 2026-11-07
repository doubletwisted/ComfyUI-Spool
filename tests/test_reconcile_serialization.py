"""Manual reconciliation shares collection ownership with the host loops.

These checks use local files, real stores/collectors and an isolated HTTP host;
no Comfy, Cloud or Deadline service is contacted.
"""

import asyncio
import shutil
import subprocess
import threading
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool import attempts, receipts, requests
from spool.cloud import CloudExecutor, storage_call
from spool.collection import Collector
from spool.execution import LocalExecutor
from spool.media import Media
from spool.ownership import ExecutorBusy, ExecutorLock
from spool.projects import Workspace
from spool.routes import register
import test_farm_protocol as fixtures


class ReconcileSerializationTests(unittest.IsolatedAsyncioTestCase):
    setUp = fixtures.FarmProtocolTests.setUp
    tearDown = fixtures.FarmProtocolTests.tearDown
    accept = fixtures.FarmProtocolTests.accept
    package = fixtures.FarmProtocolTests.package
    finish = fixtures.FarmProtocolTests.finish

    async def wait_for(self, event):
        await asyncio.wait_for(event.wait(), 5)

    async def checkpoint(self):
        turn = asyncio.get_running_loop().create_future()
        asyncio.get_running_loop().call_soon(turn.set_result, None)
        await turn

    @contextmanager
    def watch_waiters(self, collector, waiting):
        """Notify when a production collection operation has reached a held lock."""
        loop, original = asyncio.get_running_loop(), collector.project_lock

        @contextmanager
        def observed(store):
            lock = original(store)
            if not lock.acquire(blocking=False):
                loop.call_soon_threadsafe(waiting.set)
                lock.acquire()
            try:
                yield
            finally:
                lock.release()

        with patch.object(collector, "project_lock", observed):
            yield

    def server(self):
        queue = SimpleNamespace(get_current_queue=lambda: ([], []), get_history=lambda prompt_id=None: {})
        return SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(), prompt_queue=queue)

    def executor(self, server=None):
        # An already submitted farm attempt must never go through submit again.
        for attempt in self.farm_attempts:
            self.store.transition(attempt["id"], attempts.FARM_RUNNING)
        return LocalExecutor(self.store, self.media, server or self.server(), validate=None)

    async def check_route_during_deadline_collection(self, embedded):
        attempt = self.farm_attempts[0]
        self.finish(attempt)
        server = self.server()
        executor = self.executor(server) if embedded else None
        collector = executor.collector if executor else Collector(self.store, self.media)
        loop = asyncio.get_running_loop()
        copying, waiting, release = asyncio.Event(), asyncio.Event(), threading.Event()
        original, copies = shutil.copyfile, []

        def held_copy(source, target, *args, **kwargs):
            if str(target).endswith(".partial"):
                copies.append(str(target))
                loop.call_soon_threadsafe(copying.set)
                self.assertTrue(release.wait(5), "Test did not release the farm artifact copy")
            return original(source, target, *args, **kwargs)

        with patch("spool.routes.Collector", return_value=collector):
            register(server, self.store, self.media, executor)
        # Run the production collection/local lifecycle alone, without launching
        # Comfy or Cloud clients in this isolated host.
        server.app.cleanup_ctx.clear()
        server.app.cleanup_ctx.append(executor.poll if executor else collector.lifecycle)
        server.app.add_routes(server.routes)
        with self.watch_waiters(collector, waiting), patch("spool.farm.shutil.copyfile", held_copy):
            async with TestClient(TestServer(server.app)) as client:
                request = None
                try:
                    await self.wait_for(copying)
                    request = asyncio.create_task(client.post("/spool/api/reconcile", json={}))
                    await self.wait_for(waiting)
                    self.assertFalse(request.done())
                    fast = await asyncio.wait_for(client.get("/spool/ui/bootstrap.js"), 2)
                    self.assertEqual(fast.status, 200)
                    self.assertEqual(len(copies), 1)
                finally:
                    release.set()
                    if request:
                        response = await asyncio.wait_for(request, 5)
                        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual(len(copies), 1, "Overlapping scans recopied the same farm artifact")
        self.assertEqual(self.store.attempt(attempt["id"])["status"], attempts.COMPLETE)
        project = self.store.get(self.project["id"])
        self.assertEqual(len(project["document"]["clips"][0]["takes"]), 1)
        self.assertEqual(project["document"]["clips"][0]["takeId"], "original")
        self.assertFalse(list(self.store.root.rglob("*.partial")))

    async def test_standalone_route_waits_for_periodic_deadline_collection(self):
        await self.check_route_during_deadline_collection(embedded=False)

    async def test_embedded_route_waits_for_local_loop_deadline_collection(self):
        await self.check_route_during_deadline_collection(embedded=True)

    def local_attempt(self):
        project = self.store.get(self.project["id"])
        project = self.store.capture(project["id"], project["revision"], "shot", self.recipe)
        project = requests.accept(
            self.store, self.media, project["id"], project["revision"], [{"clipId": "shot", "count": 1}], "local-result"
        )
        return self.store.attempt(project["document"]["jobs"][-1]["id"])

    def write_local_receipt(self, attempt, group="images", filename="finished.png"):
        history = {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"save": {group: [{"filename": filename, "type": "output"}]}},
        }
        artifacts, primary = self.media.collect(attempt, history, False)
        receipts.write(self.media.receipt_path(attempt).parent, attempt, artifacts, primary, history)
        return history

    async def check_ingestion_during_scan(self, cloud):
        if cloud:
            project = self.store.get(self.project["id"])
            recipe = {
                "prompt": {"save": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "cloud"}}},
                "bindings": [],
                "result": {"nodeId": "save", "group": "videos", "index": 0},
                "executionTarget": "cloud",
            }
            project = self.store.capture(project["id"], project["revision"], "shot", recipe)
            with patch("spool.cloud.available", return_value=True):
                project = requests.accept(
                    self.store,
                    self.media,
                    project["id"],
                    project["revision"],
                    [{"clipId": "shot", "count": 1}],
                    "cloud-receipt",
                )
            attempt = self.store.attempt(project["document"]["jobs"][-1]["id"])
            subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=24:d=0.125",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(self.root / "output" / "finished.mp4"),
                ],
                check=True,
                capture_output=True,
            )  # fmt: skip
            self.write_local_receipt(attempt, "videos", "finished.mp4")
            collector = Collector(self.store, self.media)
            executor = CloudExecutor(self.store, self.media, collector)
            observe = lambda: executor.observe(attempt)
        else:
            attempt = self.local_attempt()
            Image.new("RGB", (8, 8), "blue").save(self.root / "output" / "finished.png")
            history = self.write_local_receipt(attempt)
            executor = self.executor()
            self.store.claim(attempt["id"], executor.session_id)
            self.store.transition(attempt["id"], attempts.QUEUED)
            executor.server.prompt_queue.get_history = lambda prompt_id: {prompt_id: history}
            collector = executor.collector
            observe = executor.reconcile

        loop = asyncio.get_running_loop()
        reviewing, waiting, release = asyncio.Event(), asyncio.Event(), threading.Event()
        original, reviews = self.media.review_receipt, []

        def held_review(*args, **kwargs):
            reviews.append(args[0]["attemptId"])
            loop.call_soon_threadsafe(reviewing.set)
            self.assertTrue(release.wait(5), "Test did not release receipt review")
            return original(*args, **kwargs)

        with (
            self.watch_waiters(collector, waiting),
            patch.object(self.media, "review_receipt", held_review),
            patch("spool.cloud.cloud_key", side_effect=AssertionError("Receipt recovery must not use a Cloud key")),
        ):
            scan = asyncio.create_task(storage_call(collector.scan))
            observation = None
            try:
                await self.wait_for(reviewing)
                observation = asyncio.create_task(observe())
                await self.wait_for(waiting)
                self.assertFalse(observation.done())
                self.assertEqual(reviews, [attempt["id"]])
            finally:
                release.set()
                await asyncio.wait_for(scan, 5)
                if observation:
                    await asyncio.wait_for(observation, 5)
        self.assertEqual(reviews, [attempt["id"]], "Concurrent ingestion repeated media review/sidecar preparation")
        self.assertEqual(self.store.attempt(attempt["id"])["status"], attempts.COMPLETE)
        self.assertEqual(len(self.store.get(self.project["id"])["document"]["clips"][0]["takes"]), 1)

    async def test_cloud_receipt_ingestion_waits_for_scan(self):
        await self.check_ingestion_during_scan(cloud=True)

    async def test_local_observation_waits_for_scan(self):
        await self.check_ingestion_during_scan(cloud=False)

    async def test_cancelled_local_reconcile_retains_async_ownership_until_worker_finishes(self):
        executor = self.executor()
        loop = asyncio.get_running_loop()
        entered, release, finished = asyncio.Event(), threading.Event(), threading.Event()
        original, calls = executor.pending_attempts, []

        def held_pending():
            calls.append(True)
            if len(calls) == 1:
                loop.call_soon_threadsafe(entered.set)
                self.assertTrue(release.wait(5))
                finished.set()
            return original()

        with patch.object(executor, "pending_attempts", held_pending):
            first = asyncio.create_task(executor.reconcile())
            second = None
            try:
                await self.wait_for(entered)
                first.cancel()
                await self.checkpoint()
                # A second cancellation must not cancel the drain's own task.
                first.cancel()
                await self.checkpoint()
                second = asyncio.create_task(executor.reconcile())
                await self.checkpoint()
                self.assertFalse(first.done())
                self.assertTrue(executor.lock.locked())
                self.assertEqual(len(calls), 1)
            finally:
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await first
                if second:
                    await asyncio.wait_for(second, 5)
        self.assertTrue(finished.is_set())
        self.assertEqual(len(calls), 2)
        self.assertFalse(executor.lock.locked())

    async def test_local_lifecycle_drains_worker_before_retiring_host_and_releasing_process_lock(self):
        executor = self.executor()
        loop = asyncio.get_running_loop()
        entered, release, finished = asyncio.Event(), threading.Event(), threading.Event()
        original = executor.pending_attempts

        def held_pending():
            loop.call_soon_threadsafe(entered.set)
            self.assertTrue(release.wait(5))
            result = original()
            finished.set()
            return result

        with patch.object(executor, "pending_attempts", held_pending):
            lifecycle = executor.poll(None)
            await anext(lifecycle)
            closing = None
            try:
                await self.wait_for(entered)
                closing = asyncio.create_task(lifecycle.aclose())
                await self.checkpoint()
                self.assertFalse(closing.done())
                self.assertTrue(self.store.host()["connected"])
                competing = ExecutorLock(self.store.root)
                with self.assertRaises(ExecutorBusy):
                    competing.acquire()
            finally:
                release.set()
                if closing:
                    await asyncio.wait_for(closing, 5)
                else:
                    await lifecycle.aclose()
        self.assertTrue(finished.is_set())
        self.assertFalse(self.store.host()["connected"])
        competing = ExecutorLock(self.store.root)
        competing.acquire()
        competing.close()

    async def test_collector_lifecycle_drains_scan_before_closing(self):
        collector = Collector(self.store, self.media)
        loop = asyncio.get_running_loop()
        entered, release, finished = asyncio.Event(), threading.Event(), threading.Event()
        original = collector.scan

        def held_scan():
            loop.call_soon_threadsafe(entered.set)
            self.assertTrue(release.wait(5))
            original()
            finished.set()

        with patch.object(collector, "scan", held_scan):
            lifecycle = collector.lifecycle(None)
            await anext(lifecycle)
            closing = None
            try:
                await self.wait_for(entered)
                closing = asyncio.create_task(lifecycle.aclose())
                await self.checkpoint()
                self.assertFalse(closing.done())
                self.assertFalse(finished.is_set())
            finally:
                release.set()
                if closing:
                    await asyncio.wait_for(closing, 5)
                else:
                    await lifecycle.aclose()
        self.assertTrue(finished.is_set())

    async def test_different_projects_can_collect_while_one_project_is_blocked(self):
        workspace = Workspace(self.root / "multi-project-app")
        first = workspace.create({"project": "First", "clips": []})
        second = workspace.create({"project": "Second", "clips": []})
        first_store, second_store = workspace.for_project(first["id"]), workspace.for_project(second["id"])
        media = Media(workspace.root, *self.media.host_roots.values())
        collector = Collector(workspace, media)
        loop = asyncio.get_running_loop()
        entered, release = asyncio.Event(), threading.Event()
        original = first_store.scan_attempts

        def held_attempts(*args, **kwargs):
            loop.call_soon_threadsafe(entered.set)
            self.assertTrue(release.wait(5))
            return original(*args, **kwargs)

        with patch.object(first_store, "scan_attempts", held_attempts):
            blocked = asyncio.create_task(storage_call(collector.scan_project, first_store))
            try:
                await self.wait_for(entered)
                await asyncio.wait_for(storage_call(collector.scan_project, second_store), 2)
                self.assertFalse(blocked.done())
                self.assertIn(str(second_store.root), collector.retained_at)
            finally:
                release.set()
                await asyncio.wait_for(blocked, 5)

    async def test_failed_local_lifecycle_still_releases_ownership(self):
        executor = self.executor()
        entered = asyncio.Event()

        async def failed_run():
            entered.set()
            raise BaseExceptionGroup("loop failed", [RuntimeError("failure"), asyncio.CancelledError()])

        with patch.object(executor, "run", failed_run):
            lifecycle = executor.poll(None)
            await anext(lifecycle)
            await self.wait_for(entered)
            with self.assertRaises(BaseExceptionGroup):
                await lifecycle.aclose()
        self.assertFalse(executor.managed)
        self.assertFalse(self.store.host()["connected"])
        competing = ExecutorLock(self.store.root)
        competing.acquire()
        competing.close()
