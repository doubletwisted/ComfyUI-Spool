"""Uploads are written atomically: a rejected file leaves nothing in the input folder."""

import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool.media import Media
from spool.projects import Workspace
from spool.routes import register


def png():
    data = io.BytesIO()
    Image.new("RGB", (16, 16), "black").save(data, "PNG")
    return data.getvalue()


class UploadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.workspace = Workspace(root / "app")
        self.project = self.workspace.create({"project": "Upload QA", "clips": [], "media": []})
        self.input = root / "input"
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.workspace, Media(self.workspace.root, self.input, root / "output", root / "temp"))
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.store_root = self.workspace.for_project(self.project["id"]).root

    def written(self):
        return [
            p
            for base in (self.input, self.store_root / "input")
            if base.exists()
            for p in base.rglob("*")
            if p.is_file()
        ]

    async def test_oversized_uploads_leave_no_file_on_either_route(self):
        routes = [
            "/spool/api/upload?projectId=" + self.project["id"],
            "/spool/api/projects/" + self.project["id"] + "/input",
        ]
        with patch("spool.routes.UPLOAD_LIMIT", 1024):
            for route in routes:
                response = await self.client.post(route, data=png() + b"0" * 4096, headers={"X-Filename": "large.png"})
                self.assertEqual(response.status, 400, route)
                self.assertIn("smaller than", (await response.json())["error"])
        self.assertEqual(self.written(), [])

    async def test_accepted_upload_is_complete_and_has_no_partial_file(self):
        response = await self.client.post(
            "/spool/api/projects/" + self.project["id"] + "/input", data=png(), headers={"X-Filename": "still.png"}
        )
        self.assertEqual(response.status, 200, await response.text())
        files = self.written()
        self.assertTrue(files)
        self.assertFalse([p for p in files if p.name.endswith(".partial")])


if __name__ == "__main__":
    unittest.main()
