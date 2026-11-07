"""A Cloud observation batch settles before its failure reaches the lifecycle."""

import asyncio
import os
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from spool import attempts, requests
from spool.cloud import CloudExecutor
from spool.collection import Collector
from spool.media import Media
from spool.store import Store, empty_project


class ObservationAdapter:
    """A local Cloud adapter double whose observations can be held or failed."""

    def __init__(self):
        self.held = set()
        self.entered = {}
        self.released = {}
        self.failures = {}
        self.failed = {}
        self.calls = defaultdict(int)
        self.active = defaultdict(int)
        self.maximum_active = defaultdict(int)
        self.cancelled = set()

    def hold(self, identity):
        self.held.add(identity)
        self.entered[identity] = asyncio.Event()
        self.released[identity] = asyncio.Event()

    def fail(self, identity, message):
        self.failures[identity] = message
        self.failed[identity] = asyncio.Event()

    def release(self, identity):
        self.released[identity].set()

    def recover(self, attempt, context):
        identity = attempt["id"]
        if identity in self.failures:
            self.failed[identity].set()
            error = self.failures[identity]
            raise error if isinstance(error, BaseException) else RuntimeError(error)
        return {"observe": True}

    async def observe(self, attempt, context):
        identity = attempt["id"]
        self.calls[identity] += 1
        self.active[identity] += 1
        self.maximum_active[identity] = max(self.maximum_active[identity], self.active[identity])
        try:
            if identity in self.held:
                self.entered[identity].set()
                await self.released[identity].wait()
            return {"job": SimpleNamespace(id="cloud-job", status="running"), "status": attempts.RUNNING}
        except asyncio.CancelledError:
            self.cancelled.add(identity)
            raise
        finally:
            self.active[identity] -= 1


class CloudObservationBatchTests(unittest.IsolatedAsyncioTestCase):
    ENDPOINT = "https://cloud.example.test"

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.store = Store(self.root / "store")
        for kind in ("input", "output", "temp"):
            (self.root / kind).mkdir()
        self.media = Media(self.store.root, self.root / "input", self.root / "output", self.root / "temp")
        self.environment = patch.dict(os.environ, {"COMFY_BASE_URL": self.ENDPOINT})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.key = patch("spool.cloud.cloud_key", return_value="comfyui-observation-fixture")
        self.key.start()
        self.addCleanup(self.key.stop)
        self.available = patch("spool.cloud.available", return_value=True)
        self.available.start()
        self.addCleanup(self.available.stop)

        document = empty_project()
        document["clips"] = [{"id": "shot", "name": "Shot", "revision": 1, "takes": [], "takeId": "original"}]
        project = self.store.create(document)
        capture = {
            "prompt": {"save": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "observation"}}},
            "bindings": [],
            "result": {"nodeId": "save", "group": "videos", "index": 0},
            "executionTarget": "cloud",
        }
        self.project = self.store.capture(project["id"], project["revision"], "shot", capture)
        self.project = requests.accept(
            self.store,
            self.media,
            self.project["id"],
            self.project["revision"],
            [{"clipId": "shot", "count": 2}],
            "observation-batches",
        )
        self.held_id, self.failing_id = [job["id"] for job in self.project["document"]["jobs"]]
        self.store.set_setting(
            "cloud:" + self.held_id,
            {"jobId": "held-cloud-job", "endpoint": self.ENDPOINT},
        )
        self.executor = CloudExecutor(self.store, self.media, Collector(self.store, self.media))
        self.adapter = ObservationAdapter()
        self.executor.adapter = self.adapter

    def accept_more(self, operation):
        project = self.store.get(self.project["id"])
        self.project = requests.accept(
            self.store,
            self.media,
            project["id"],
            project["revision"],
            [{"clipId": "shot", "count": 1}],
            operation,
        )
        return self.project["document"]["jobs"][-1]["id"]

    async def await_events(self, *events):
        await asyncio.wait_for(asyncio.gather(*(event.wait() for event in events)), 5)

    async def allow_failure_to_surface(self):
        # The old gather future completed with the first failure after a turn or two.
        for _ in range(20):
            await asyncio.sleep(0)

    async def test_batch_drains_held_observation_before_reporting_failure(self):
        self.adapter.hold(self.held_id)
        self.adapter.fail(self.failing_id, "observation failed")
        task = asyncio.create_task(self.executor.run_once())
        await self.await_events(self.adapter.entered[self.held_id], self.adapter.failed[self.failing_id])
        await self.allow_failure_to_surface()

        self.assertFalse(task.done(), "run_once reported the failure while another observation was still running")
        self.assertEqual(self.adapter.active[self.held_id], 1)

        self.adapter.release(self.held_id)
        with self.assertRaisesRegex(RuntimeError, "observation failed"):
            await asyncio.wait_for(task, 5)
        self.assertEqual(self.store.attempt(self.held_id)["status"], attempts.RUNNING)
        self.assertEqual(self.adapter.active[self.held_id], 0)
        self.assertEqual(self.adapter.maximum_active[self.held_id], 1)

    async def test_next_pass_does_not_overtake_a_running_batch(self):
        self.adapter.hold(self.held_id)
        self.adapter.fail(self.failing_id, "first pass failed")
        first = asyncio.create_task(self.executor.run_once())
        await self.await_events(self.adapter.entered[self.held_id], self.adapter.failed[self.failing_id])
        await self.allow_failure_to_surface()

        self.assertFalse(first.done(), "the failed batch handed control to the next pass before it settled")
        self.adapter.release(self.held_id)
        with self.assertRaisesRegex(RuntimeError, "first pass failed"):
            await asyncio.wait_for(first, 5)

        before = self.adapter.calls[self.held_id]
        second = asyncio.create_task(self.executor.run_once())
        with self.assertRaisesRegex(RuntimeError, "first pass failed"):
            await asyncio.wait_for(second, 5)
        self.assertGreater(self.adapter.calls[self.held_id], before)
        self.assertEqual(self.adapter.maximum_active[self.held_id], 1)
        self.assertEqual(self.adapter.active[self.held_id], 0)

    async def test_all_observations_settle_and_every_failure_is_reported(self):
        extra_id = self.accept_more("observation-batches-extra")
        self.adapter.hold(self.held_id)
        self.adapter.fail(self.failing_id, "first failure")
        self.adapter.fail(extra_id, "second failure")
        task = asyncio.create_task(self.executor.run_once())
        await self.await_events(
            self.adapter.entered[self.held_id],
            self.adapter.failed[self.failing_id],
            self.adapter.failed[extra_id],
        )
        await self.allow_failure_to_surface()

        self.assertFalse(task.done(), "run_once reported failures before the held observation settled")
        self.adapter.release(self.held_id)
        with self.assertRaises(ExceptionGroup) as raised:
            await asyncio.wait_for(task, 5)
        self.assertEqual(
            sorted(str(error) for error in raised.exception.exceptions),
            ["first failure", "second failure"],
        )
        self.assertEqual(self.store.attempt(self.held_id)["status"], attempts.RUNNING)
        self.assertEqual(self.adapter.active[self.held_id], 0)
        self.assertEqual(self.adapter.maximum_active[self.held_id], 1)

    async def test_parent_cancellation_leaves_no_orphan_observations(self):
        self.adapter.hold(self.held_id)
        self.adapter.fail(self.failing_id, "failure before cancellation")
        task = asyncio.create_task(self.executor.run_once())
        await self.await_events(self.adapter.entered[self.held_id], self.adapter.failed[self.failing_id])
        await self.allow_failure_to_surface()

        self.assertFalse(task.done(), "run_once settled the batch before the held observation finished")
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertIn(self.held_id, self.adapter.cancelled)
        self.assertEqual(self.adapter.active[self.held_id], 0)
        await self.allow_failure_to_surface()
        self.assertEqual(self.adapter.active[self.held_id], 0)

    async def test_child_cancellation_drains_and_reports_other_failures(self):
        extra_id = self.accept_more("observation-cancelled-child")
        self.adapter.hold(self.held_id)
        self.adapter.fail(self.failing_id, asyncio.CancelledError("child cancelled"))
        self.adapter.fail(extra_id, "ordinary failure beside cancellation")
        task = asyncio.create_task(self.executor.run_once())
        await self.await_events(
            self.adapter.entered[self.held_id],
            self.adapter.failed[self.failing_id],
            self.adapter.failed[extra_id],
        )
        self.assertFalse(task.done())
        with self.assertLogs(level="ERROR") as logged:
            self.adapter.release(self.held_id)
            with self.assertRaises(asyncio.CancelledError) as raised:
                await asyncio.wait_for(task, 5)
        self.assertIsInstance(raised.exception.__cause__, ExceptionGroup)
        self.assertEqual(
            [str(error) for error in raised.exception.__cause__.exceptions],
            ["ordinary failure beside cancellation"],
        )
        self.assertIn("ordinary failure beside cancellation", "\n".join(logged.output))
        self.assertEqual(self.adapter.active[self.held_id], 0)

    async def test_lifecycle_releases_ownership_when_task_has_failed(self):
        entered, closed = asyncio.Event(), asyncio.Event()

        async def failed_batch():
            entered.set()
            raise BaseExceptionGroup("unexpected batch failure", [RuntimeError("failure"), asyncio.CancelledError()])

        self.executor.run_once = failed_batch
        self.executor.ownership = SimpleNamespace(acquire=lambda: None, close=closed.set)
        lifecycle = self.executor.lifecycle(None)
        await anext(lifecycle)
        await self.await_events(entered)
        with self.assertRaises(BaseExceptionGroup):
            await lifecycle.aclose()
        self.assertTrue(closed.is_set(), "Executor ownership must close even when awaiting its task fails")
