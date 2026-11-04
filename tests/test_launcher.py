import asyncio
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from aiohttp import web
from aiohttp.test_utils import TestServer, TestClient

from spool.launcher import ComfyLauncher, local_url
from spool.store import Store, Conflict
from spool.routes import register
from spool.media import Media


class LauncherTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.file = self.root / ("Comfy startup.bat" if os.name == "nt" else "Comfy startup.sh")
        self.file.write_text("test fixture", encoding="utf-8")
        self.store = Store(self.root / "store")
        self.launcher = ComfyLauncher(self.store)

    def settings(self, **values):
        return {"startupFile": str(self.file), "comfyUrl": "http://127.0.0.1:8195", "autoStart": False, **values}

    async def test_default_off_and_saved_settings_survive_reopen(self):
        self.assertFalse(self.launcher.settings()["autoStart"])
        with patch.object(self.launcher, "start", new_callable=AsyncMock) as start:
            lifecycle = self.launcher.lifecycle(None)
            await anext(lifecycle)
            await lifecycle.aclose()
            start.assert_not_awaited()
        self.launcher.save(self.settings(autoStart=True))
        reopened = ComfyLauncher(Store(self.store.root))
        self.assertTrue(reopened.settings()["autoStart"])
        with patch.object(reopened, "start", new_callable=AsyncMock) as start:
            lifecycle = reopened.lifecycle(None)
            await anext(lifecycle)
            await lifecycle.aclose()
            start.assert_awaited_once()

    async def test_local_address_and_startup_file_validation(self):
        self.assertEqual(local_url("http://localhost:8195/"), "http://127.0.0.1:8195")
        for address in (
            "https://127.0.0.1:8195",
            "http://example.com",
            "http://127.0.0.1:8195/spool",
            "http://user@localhost:8195",
        ):
            with self.assertRaises(ValueError):
                self.launcher.save(self.settings(comfyUrl=address))
        with self.assertRaises(ValueError):
            self.launcher.save(self.settings(startupFile="missing.bat"))
        hostile = self.root / "comfy&other.bat"
        hostile.touch()
        with self.assertRaises(ValueError):
            self.launcher.save(self.settings(startupFile=str(hostile)))

    async def test_matching_live_host_is_reused_and_other_store_is_rejected(self):
        data = {"executor": True, "storePath": str(self.store.root)}
        app = web.Application()

        async def health(request):
            return web.json_response(data)

        app.router.add_get("/spool/api/health", health)
        async with TestServer(app) as server:
            self.launcher.save(self.settings(comfyUrl=str(server.make_url("/"))))
            with patch("spool.launcher.subprocess.Popen") as spawn:
                self.assertEqual((await self.launcher.start())["state"], "connected")
                spawn.assert_not_called()
                data["storePath"] = "another-store"
                with self.assertRaisesRegex(ValueError, "different host"):
                    await self.launcher.start()
                spawn.assert_not_called()

    async def test_two_clients_start_once_with_correct_folder_environment_and_hidden_window(self):
        self.launcher.save(self.settings())
        second = ComfyLauncher(self.store)
        with (
            patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))),
            patch.object(second, "probe", AsyncMock(return_value=("stopped", None))),
            patch("spool.launcher.subprocess.Popen", return_value=Mock(poll=lambda: None)) as spawn,
        ):
            result = await asyncio.gather(self.launcher.start(), second.start())
            self.assertEqual([r["state"] for r in result], ["starting", "starting"])
            spawn.assert_called_once()
            self.assertEqual(spawn.call_args.kwargs["cwd"], self.file.parent.resolve())
            self.assertEqual(spawn.call_args.kwargs["env"]["SPOOL_STORAGE"], str(self.store.root))
            if os.name == "nt":
                self.assertIn('/d /s /c ""' + str(self.file.resolve()) + '""', spawn.call_args.args[0])
                self.assertTrue(spawn.call_args.kwargs["creationflags"] & 0x08000000)
            else:
                self.assertEqual(spawn.call_args.args[0], ["/bin/sh", str(self.file.resolve())])
                self.assertTrue(spawn.call_args.kwargs["start_new_session"])

    @unittest.skipIf(os.name == "nt", "POSIX startup files")
    async def test_posix_startup_file_must_be_a_script_or_executable(self):
        program = self.root / "comfy"
        program.write_text("#!/bin/sh\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "ComfyUI Desktop"):
            self.launcher.save(self.settings(startupFile=str(program)))
        program.chmod(0o755)
        self.launcher.save(self.settings(startupFile=str(program)))
        with (
            patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))),
            patch("spool.launcher.subprocess.Popen", return_value=Mock(poll=lambda: None)) as spawn,
        ):
            await self.launcher.start()
        self.assertEqual(spawn.call_args.args[0], [str(program.resolve())])

    async def test_boot_timeout_and_failed_spawn_expose_log_and_allow_manual_retry(self):
        self.launcher.save(self.settings())
        with (
            patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))),
            patch("spool.launcher.subprocess.Popen", side_effect=OSError("fixture failure")),
        ):
            with self.assertRaisesRegex(ValueError, "could not start"):
                await self.launcher.start()
            self.assertEqual((await self.launcher.status())["state"], "error")
        self.store.set_setting("comfy_launch", {"state": "starting", "created": time.time() - 200})
        with patch.object(self.launcher, "probe", AsyncMock(return_value=("stopped", None))):
            self.assertEqual((await self.launcher.status())["state"], "error")

    async def test_starting_host_cannot_be_reconfigured_to_another_launcher(self):
        self.launcher.save(self.settings())
        self.store.set_setting("comfy_launch", {"state": "starting", "created": time.time()})
        with self.assertRaises(Conflict):
            self.launcher.save(self.settings(comfyUrl="http://127.0.0.1:8188"))
        self.launcher.save(self.settings(autoStart=True))

    async def test_address_change_preserves_roots_and_requires_stopped_host(self):
        config = {"roots": {"input": "input", "output": "output", "temp": "temp"}, "comfyUrl": "http://127.0.0.1:8195"}
        self.store.publish_host(config, "host")
        with self.assertRaises(Conflict):
            self.launcher.save(self.settings(comfyUrl="http://127.0.0.1:8188"))
        self.store.retire_host("host")
        self.launcher.save(self.settings(comfyUrl="http://127.0.0.1:8188"))
        changed = {**config, "comfyUrl": "http://127.0.0.1:8188"}
        self.store.publish_host(changed, "new-host")
        self.assertEqual(self.store.host()["configuration"], changed)

    async def test_startup_routes_reject_cross_origin_mutations(self):
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(
            server, self.store, Media(self.store.root, self.root / "input", self.root / "output", self.root / "temp")
        )
        server.app.add_routes(server.routes)
        async with TestClient(TestServer(server.app)) as client:
            response = await client.put(
                "/spool/api/comfy/settings", json=self.settings(), headers={"Origin": "http://elsewhere.example"}
            )
            self.assertEqual(response.status, 403)
            self.assertIsNone(self.store.setting("comfy_startup"))
            response = await client.put("/spool/api/comfy/settings", json=self.settings())
            self.assertEqual(response.status, 200)
            with patch("spool.launcher.subprocess.Popen") as spawn:
                response = await client.post(
                    "/spool/api/comfy/start", json={}, headers={"Origin": "http://elsewhere.example"}
                )
                self.assertEqual(response.status, 403)
                spawn.assert_not_called()


class ShallowCheckoutTests(unittest.TestCase):
    def test_status_works_for_a_checkout_near_the_drive_root(self):
        with tempfile.TemporaryDirectory() as folder:
            launcher = ComfyLauncher(Store(Path(folder)))
            launcher.probe = AsyncMock(return_value=("stopped", None))
            # Outside ComfyUI_windows_portable/ComfyUI/custom_nodes there may be no fourth parent.
            with patch("spool.launcher.__file__", os.path.join(os.path.abspath(os.sep), "spool", "launcher.py")):
                status = asyncio.run(launcher.status())
        self.assertEqual(status["state"], "stopped")


class StandaloneScriptTests(unittest.TestCase):
    def test_windows_script_finds_spool_with_an_isolated_python(self):
        # ComfyUI portable's python_embeded has a ._pth file, which runs Python like -I:
        # the current folder is not on sys.path, so "-m spool" alone finds nothing.
        root = Path(__file__).resolve().parent.parent
        script = (root / "run_spool.bat").read_text(encoding="utf-8")
        code = re.search(r'^"%PY%" %FLAGS% -c "([^"]+)" --open %\*$', script, re.M).group(1)
        result = subprocess.run(
            [sys.executable, "-I", "-c", code, "--help"], cwd=root, capture_output=True, text=True, timeout=60
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage: python -m spool", result.stdout)
