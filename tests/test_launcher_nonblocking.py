"""Launcher storage and filesystem work stays off the host event loop."""

import asyncio
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool.launcher import ComfyLauncher
from spool.store import Conflict, Store


class Gate:
    """Hold a storage worker, either for a fixed time or until released."""

    def __init__(self, hold=None):
        self.hold = hold
        self.entered = threading.Event()
        self.released = threading.Event()

    def wait(self):
        self.entered.set()
        if self.hold is not None:
            time.sleep(self.hold)
        elif not self.released.wait(10):
            raise TimeoutError("The test gate was not released")

    def release(self):
        self.released.set()


class BlockingStore(Store):
    """A real SQLite store whose chosen synchronous call can be held in its worker."""

    def __init__(self, root):
        super().__init__(root)
        self.block = None

    def _hold(self, method, key=None):
        block = self.block
        if block and block[0] == method and (block[1] is None or block[1] == key):
            block[2].wait()

    def setting(self, key):
        self._hold("setting", key)
        return super().setting(key)

    def set_setting(self, key, value):
        self._hold("set_setting", key)
        return super().set_setting(key, value)

    def host(self, include_definitions=True):
        self._hold("host", include_definitions)
        return super().host(include_definitions)


class LauncherNonblockingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.file = self.root / ("Comfy startup.bat" if os.name == "nt" else "Comfy startup.sh")
        self.file.write_text("test fixture", encoding="utf-8")
        self.store = BlockingStore(self.root / "store")
        self.launcher = ComfyLauncher(self.store)

    def settings(self, **values):
        return {"startupFile": str(self.file), "comfyUrl": "http://127.0.0.1:8195", "autoStart": False, **values}

    async def assert_loop_progress(self, operation, minimum=0.45):
        """Run operation while a heartbeat proves the loop turns during its blocked worker."""
        stamps = []
        stop = threading.Event()

        async def heartbeat():
            while not stop.is_set():
                stamps.append(time.monotonic())
                await asyncio.sleep(0.005)

        beat = asyncio.create_task(heartbeat())
        try:
            await asyncio.sleep(0.03)
            started = time.monotonic()
            result = await operation()
            elapsed = time.monotonic() - started
            await asyncio.sleep(0.05)
        finally:
            stop.set()
            await beat
        gap = max((later - earlier for earlier, later in zip(stamps, stamps[1:])), default=0)
        self.assertGreaterEqual(elapsed, minimum)
        self.assertLess(gap, minimum * 0.75)
        return result

    async def test_status_settings_and_host_reads_do_not_stall_the_loop(self):
        self.launcher.probe = AsyncMock(return_value=("stopped", None))
        for method, key in (("setting", "comfy_startup"), ("host", False)):
            with self.subTest(method=method):
                gate = Gate(hold=0.5)
                self.store.block = (method, key, gate)
                try:
                    status = await self.assert_loop_progress(self.launcher.status)
                finally:
                    self.store.block = None
                self.assertEqual(status["state"], "stopped")
                self.assertTrue(gate.entered.is_set())

    async def test_probe_without_an_address_reads_settings_off_loop(self):
        app = web.Application()

        async def health(request):
            return web.json_response({"executor": True, "storePath": str(self.store.root)})

        app.router.add_get("/spool/api/health", health)
        async with TestServer(app) as server:
            self.launcher.save(self.settings(comfyUrl=str(server.make_url("/"))))
            gate = Gate(hold=0.5)
            self.store.block = ("setting", "comfy_startup", gate)
            try:
                state, error = await self.assert_loop_progress(self.launcher.probe)
            finally:
                self.store.block = None
        self.assertEqual((state, error), ("connected", None))
        self.assertTrue(gate.entered.is_set())

    async def test_startup_file_scan_does_not_stall_the_loop(self):
        portable = self.root / "ComfyUI_windows_portable"
        (portable / "python_embeded").mkdir(parents=True)
        (portable / "python_embeded" / "python.exe").write_bytes(b"")
        (portable / "run_spool.bat").write_text("", encoding="utf-8")
        (portable / "run_Deadline.bat").write_text("", encoding="utf-8")
        checkout = portable / "ComfyUI" / "custom_nodes" / "Spool" / "spool" / "launcher.py"
        gate = Gate(hold=0.5)
        real_glob = Path.glob

        def glob(path, pattern):
            if pattern == "run*.bat":
                gate.wait()
            return real_glob(path, pattern)

        self.launcher.probe = AsyncMock(return_value=("stopped", None))
        with (
            patch("spool.launcher.__file__", str(checkout)),
            patch.object(Path, "glob", glob),
        ):
            status = await self.assert_loop_progress(self.launcher.status)
        self.assertEqual(status["startupFiles"], [str(portable / "run_spool.bat")])
        self.assertTrue(gate.entered.is_set())

    async def test_start_spawn_does_not_stall_the_loop(self):
        self.launcher.save(self.settings())
        gate = Gate(hold=0.5)
        process = Mock(poll=lambda: None)
        spawned = []

        def popen(*args, **kwargs):
            gate.wait()
            spawned.append((args, kwargs))
            return process

        with (
            patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))),
            patch("spool.launcher.subprocess.Popen", side_effect=popen),
        ):
            status = await self.assert_loop_progress(self.launcher.start)
        self.assertEqual(status["state"], "starting")
        self.assertEqual(len(spawned), 1)
        self.assertIs(self.launcher.process, process)

    async def test_lifecycle_settings_read_does_not_stall_the_loop(self):
        gate = Gate(hold=0.5)
        self.store.block = ("setting", "comfy_startup", gate)
        lifecycle = self.launcher.lifecycle(None)
        with patch.object(self.launcher, "start", new_callable=AsyncMock) as start:
            try:
                await self.assert_loop_progress(lambda: anext(lifecycle))
            finally:
                await lifecycle.aclose()
            start.assert_not_awaited()
        self.assertTrue(gate.entered.is_set())

    async def test_blocked_status_leaves_an_unrelated_http_request_responsive(self):
        gate = Gate()
        self.addCleanup(gate.release)
        self.store.block = ("setting", "comfy_launch", gate)
        self.launcher.probe = AsyncMock(return_value=("stopped", None))
        app = web.Application()

        async def status(request):
            return web.json_response(await self.launcher.status())

        async def ping(request):
            return web.json_response({"ok": True})

        app.router.add_get("/status", status)
        app.router.add_get("/ping", ping)
        async with TestClient(TestServer(app)) as client:
            blocked = asyncio.create_task(client.get("/status"))
            await asyncio.to_thread(gate.entered.wait, 5)
            response = await asyncio.wait_for(client.get("/ping"), 0.5)
            self.assertEqual(response.status, 200)
            self.assertFalse(blocked.done())
            gate.release()
            self.assertEqual((await blocked).status, 200)

    async def test_cancelled_start_drains_spawn_before_releasing_startup(self):
        self.launcher.save(self.settings())
        gate = Gate()
        self.addCleanup(gate.release)
        process = Mock(poll=lambda: None)
        spawned = []

        def popen(*args, **kwargs):
            gate.wait()
            spawned.append((args, kwargs))
            return process

        with (
            patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))),
            patch("spool.launcher.subprocess.Popen", side_effect=popen),
        ):
            task = asyncio.create_task(self.launcher.start())
            await asyncio.to_thread(gate.entered.wait, 5)
            task.cancel()
            await asyncio.sleep(0.05)
            # The launch worker still owns startup while it is about to spawn.
            self.assertFalse(task.done())
            self.assertEqual(spawned, [])
            gate.release()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(len(spawned), 1)
            self.assertIs(self.launcher.process, process)
            self.assertEqual(self.store.setting("comfy_launch")["state"], "starting")
            with patch("spool.launcher.subprocess.Popen") as second_spawn:
                status = await self.launcher.start()
            second_spawn.assert_not_called()
        self.assertEqual(status["state"], "starting")
        self.assertEqual(len(spawned), 1)

    async def test_cancelled_status_drains_the_launch_state_write(self):
        self.store.set_setting("comfy_launch", {"state": "starting", "created": time.time()})
        gate = Gate()
        self.addCleanup(gate.release)
        self.launcher.probe = AsyncMock(return_value=("connected", None))
        replace = self.launcher._replace_launch

        def held_replace(*args):
            gate.wait()
            return replace(*args)

        with patch.object(self.launcher, "_replace_launch", held_replace):
            task = asyncio.create_task(self.launcher.status())
            self.assertTrue(await asyncio.to_thread(gate.entered.wait, 5))
            task.cancel()
            await asyncio.sleep(0.05)
            self.assertFalse(task.done())
            gate.release()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(self.store.setting("comfy_launch")["state"], "connected")

    async def test_settings_saved_during_start_keep_the_startup_reservation(self):
        self.launcher.save(self.settings())
        gate = Gate()
        self.addCleanup(gate.release)
        process = Mock(poll=lambda: None)
        spawned = []

        def popen(*args, **kwargs):
            gate.wait()
            spawned.append((args, kwargs))
            return process

        with (
            patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))),
            patch("spool.launcher.subprocess.Popen", side_effect=popen),
        ):
            task = asyncio.create_task(self.launcher.start())
            await asyncio.to_thread(gate.entered.wait, 5)
            with self.assertRaises(Conflict):
                await asyncio.to_thread(self.launcher.save, self.settings(comfyUrl="http://127.0.0.1:8188"))
            await asyncio.to_thread(self.launcher.save, self.settings())
            second = ComfyLauncher(self.store)
            with patch.object(second, "probe", AsyncMock(return_value=("stopped", None))):
                status = await second.start()
            self.assertEqual(status["state"], "starting")
            gate.release()
            self.assertEqual((await task)["state"], "starting")
        self.assertEqual(len(spawned), 1)
        self.assertEqual(self.launcher.settings()["comfyUrl"], "http://127.0.0.1:8195")

    async def test_delayed_status_write_preserves_a_new_launch_reservation(self):
        old = {"id": "old", "state": "starting", "created": time.time() - 300}
        self.store.set_setting("comfy_launch", old)
        self.launcher.probe = AsyncMock(return_value=("connected", None))
        gate = Gate()
        self.addCleanup(gate.release)
        replace = self.launcher._replace_launch

        def held_replace(*args):
            gate.wait()
            return replace(*args)

        with patch.object(self.launcher, "_replace_launch", held_replace):
            status = asyncio.create_task(self.launcher.status())
            try:
                self.assertTrue(await asyncio.to_thread(gate.entered.wait, 5))
                next_launcher = ComfyLauncher(self.store)
                with patch("spool.launcher.subprocess.Popen", return_value=Mock(poll=lambda: None)):
                    started = await asyncio.to_thread(
                        next_launcher._launch, self.settings(), "new", self.store.root / "logs" / "new.log"
                    )
                self.assertTrue(started)
                self.assertEqual(self.store.setting("comfy_launch")["id"], "new")
            finally:
                gate.release()
                await status
        self.assertEqual(self.store.setting("comfy_launch")["id"], "new")

    async def test_delayed_spawn_failure_preserves_a_new_launch_reservation(self):
        gate = Gate()
        self.addCleanup(gate.release)
        spawn_error = OSError("old spawn failed")
        calls = []

        def popen(*args, **kwargs):
            calls.append(True)
            if len(calls) == 1:
                gate.wait()
                raise spawn_error
            return Mock(poll=lambda: None)

        with patch("spool.launcher.subprocess.Popen", side_effect=popen):
            first = asyncio.create_task(
                asyncio.to_thread(self.launcher._launch, self.settings(), "old", self.store.root / "logs" / "old.log")
            )
            try:
                self.assertTrue(await asyncio.to_thread(gate.entered.wait, 5))
                # An expired reservation may be replaced while its spawn worker
                # is still waiting on the operating system or a network drive.
                reservation = self.store.setting("comfy_launch")
                self.store.set_setting("comfy_launch", {**reservation, "created": time.time() - 300})
                next_launcher = ComfyLauncher(self.store)
                self.assertTrue(
                    await asyncio.to_thread(
                        next_launcher._launch, self.settings(), "new", self.store.root / "logs" / "new.log"
                    )
                )
            finally:
                gate.release()
                with self.assertRaisesRegex(ValueError, "old spawn failed"):
                    await first
        self.assertEqual(self.store.setting("comfy_launch")["id"], "new")
        self.assertEqual(self.store.setting("comfy_launch")["state"], "starting")
