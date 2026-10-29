"""Slow project storage must not stall Comfy's event loop."""

import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool.execution import LocalExecutor
from spool.media import Media
from spool.projects import Workspace
from spool.routes import register


class NonBlockingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.workspace = Workspace(root / "app")
        self.media = Media(self.workspace.root, root / "input", root / "output", root / "temp")
        self.loop = asyncio.get_running_loop()
        self.loop_thread = threading.get_ident()
        self.entered = asyncio.Event()
        self.release = threading.Event()
        self.addCleanup(self.release.set)

    def blocked(self, *args, **kwargs):
        self.assertNotEqual(threading.get_ident(), self.loop_thread)
        self.loop.call_soon_threadsafe(self.entered.set)
        self.assertTrue(self.release.wait(5), "Test did not release blocked storage")
        return []

    async def test_a_slow_project_read_does_not_stall_other_requests(self):
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.workspace, self.media)
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        async with TestClient(TestServer(server.app)) as client:
            with patch.object(self.workspace, "list", side_effect=self.blocked):
                slow = asyncio.create_task(client.get("/spool/api/projects"))
                await asyncio.wait_for(self.entered.wait(), 5)
                fast = await asyncio.wait_for(client.get("/spool/ui/bootstrap.js"), 2)
                self.assertEqual(fast.status, 200)
                self.assertFalse(slow.done())
                self.release.set()
                self.assertEqual((await slow).status, 200)

    async def test_reconcile_reads_pending_attempts_off_the_event_loop(self):
        queue = SimpleNamespace(get_current_queue=lambda: ([], []), get_history=lambda prompt_id=None: {})
        executor = LocalExecutor(self.workspace, self.media, SimpleNamespace(prompt_queue=queue), validate=None)
        with patch.object(executor, "pending_attempts", side_effect=self.blocked):
            reconcile = asyncio.create_task(executor.reconcile())
            await asyncio.wait_for(self.entered.wait(), 5)
            self.assertFalse(reconcile.done())
            self.release.set()
            await asyncio.wait_for(reconcile, 5)


if __name__ == "__main__":
    unittest.main()
