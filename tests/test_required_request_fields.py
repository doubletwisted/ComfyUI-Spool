"""Required request fields fail as client errors before a route changes anything."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool.media import Media
from spool.projects import Workspace
from spool.routes import register


def capture():
    """A capture with no media inputs, so validation never stages a file."""
    return {
        "workflow": {"nodes": []},
        "prompt": {
            "solid": {
                "class_type": "EmptyImage",
                "inputs": {"width": 16, "height": 16, "batch_size": 1, "color": 0},
            },
            "save": {
                "class_type": "SaveImage",
                "inputs": {"images": ["solid", 0], "filename_prefix": "required-fields"},
            },
        },
        "bindings": [],
        "result": {"nodeId": "save", "group": "images", "index": 0},
    }


class RequiredRequestFieldTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        for kind in ("input", "output", "temp"):
            (root / kind).mkdir()
        self.workspace = Workspace(root / "app")
        self.project = self.workspace.create(
            {
                "project": "Required fields QA",
                "clips": [
                    {
                        "id": "shot",
                        "name": "shot",
                        "in": 0,
                        "out": 24,
                        "takeId": "original",
                        "takes": [
                            {
                                "id": "original",
                                "number": 0,
                                "media": {
                                    "id": "original",
                                    "kind": "image",
                                    "file": "output/Shot/original.png",
                                    "frames": 24,
                                },
                            },
                            {
                                "id": "spare",
                                "number": 1,
                                "media": {
                                    "id": "spare",
                                    "kind": "image",
                                    "file": "output/Shot/spare.png",
                                    "frames": 24,
                                },
                            },
                        ],
                    }
                ],
                "media": [],
            }
        )
        self.store = self.workspace.for_project(self.project["id"])
        for name in ("original", "spare"):
            path = self.store.root / "output" / "Shot" / (name + ".png")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
        self.media = Media(self.workspace.root, root / "input", root / "output", root / "temp")
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.workspace, self.media)
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.base = "/spool/api/projects/" + self.project["id"]

    def state(self):
        return self.store.get(self.project["id"])

    async def send(self, method, path, body):
        return await getattr(self.client, method.lower())(path, json=body)

    async def test_missing_revision_is_invalid_before_any_change(self):
        before = self.state()
        cases = [
            ("PUT", self.base, {"document": before["document"]}),
            ("POST", self.base + "/generation-preview", {"clipId": "shot"}),
            ("POST", self.base + "/capture/shot", {"capture": capture()}),
            ("POST", self.base + "/use-take/shot", {"takeId": "original"}),
            ("POST", self.base + "/delete-takes/shot", {"takeIds": ["spare"]}),
            ("POST", self.base + "/queue", {"items": [{"clipId": "shot", "count": 1}]}),
        ]
        for method, path, body in cases:
            response = await self.send(method, path, body)
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (400, "invalid_request"), path)
            self.assertIn("revision", value["error"], path)
            self.assertEqual(self.state(), before, path)

    async def test_missing_required_body_fields_are_invalid_before_any_change(self):
        before = self.state()
        revision = before["revision"]
        cases = [
            ("PUT", self.base, {"revision": revision}, "document"),
            ("POST", self.base + "/generation-preview", {"revision": revision}, "clipId"),
            ("POST", self.base + "/capture/shot", {"revision": revision}, "capture"),
            ("POST", self.base + "/use-take/shot", {"revision": revision}, "takeId"),
            ("POST", self.base + "/delete-takes/shot", {"revision": revision}, "takeIds"),
        ]
        for method, path, body, field in cases:
            response = await self.send(method, path, body)
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (400, "invalid_request"), path)
            self.assertIn(field, value["error"], path)
            self.assertEqual(self.state(), before, path)

    async def test_missing_or_malformed_import_revision_header_is_invalid_before_import(self):
        before = self.state()
        body = json.dumps({"nodes": [], "links": []})
        for headers in (
            {"X-Filename": "empty.json"},
            {"X-Filename": "empty.json", "X-Spool-Revision": "not-a-number"},
            {"X-Filename": "empty.json", "X-Spool-Revision": ""},
        ):
            response = await self.client.post(self.base + "/import-workflow", data=body, headers=headers)
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (400, "invalid_request"), headers)
            self.assertIn("X-Spool-Revision", value["error"])
            self.assertEqual(self.state(), before)
        response = await self.client.post(
            self.base + "/import-workflow",
            data=body,
            headers={"X-Filename": "empty.json", "X-Spool-Revision": str(before["revision"])},
        )
        self.assertEqual(response.status, 200, await response.text())
        imported = await response.json()
        self.assertEqual(len(imported["project"]["document"]["importedWorkflows"]), 1)
        self.assertEqual(imported["project"]["revision"], before["revision"] + 1)

    async def test_stale_revision_still_conflicts(self):
        before = self.state()
        stale = before["revision"] + 1
        cases = [
            ("PUT", self.base, {"revision": stale, "document": before["document"]}),
            ("POST", self.base + "/generation-preview", {"revision": stale, "clipId": "shot"}),
            ("POST", self.base + "/capture/shot", {"revision": stale, "capture": capture()}),
            ("POST", self.base + "/use-take/shot", {"revision": stale, "takeId": "original"}),
            ("POST", self.base + "/delete-takes/shot", {"revision": stale, "takeIds": ["spare"]}),
            ("POST", self.base + "/queue", {"revision": stale, "items": [{"clipId": "shot", "count": 1}]}),
        ]
        for method, path, body in cases:
            response = await self.send(method, path, body)
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (409, "revision_conflict"), path)
            self.assertEqual(self.state(), before, path)
        response = await self.client.post(
            self.base + "/import-workflow",
            data=json.dumps({"nodes": [], "links": []}),
            headers={"X-Filename": "empty.json", "X-Spool-Revision": str(stale)},
        )
        value = await response.json()
        self.assertEqual((response.status, value["code"]), (409, "revision_conflict"))
        self.assertEqual(self.state(), before)

    async def test_malformed_body_and_payload_shapes_are_invalid(self):
        before = self.state()
        cases = [
            ("PUT", self.base, "[]"),
            ("PUT", self.base, "null"),
            ("POST", self.base + "/queue", '"queue"'),
            ("POST", self.base + "/capture/shot", "{}"),
        ]
        for method, path, raw in cases:
            response = await getattr(self.client, method.lower())(
                path, data=raw, headers={"Content-Type": "application/json"}
            )
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (400, "invalid_request"), path)
            self.assertEqual(self.state(), before, path)
        for body, field in (
            ({"revision": before["revision"], "document": None}, "document"),
            ({"revision": before["revision"], "capture": None}, "capture"),
        ):
            path = self.base if field == "document" else self.base + "/capture/shot"
            response = await self.send("PUT" if field == "document" else "POST", path, body)
            value = await response.json()
            self.assertEqual((response.status, value["code"]), (400, "invalid_request"), field)
            self.assertIn(field, value["error"])
            self.assertEqual(self.state(), before, field)

    async def test_valid_revisions_still_reach_each_route(self):
        before = self.state()
        response = await self.send("PUT", self.base, {"revision": before["revision"], "document": before["document"]})
        self.assertEqual(response.status, 200, await response.text())
        saved = await response.json()
        response = await self.send(
            "POST", self.base + "/capture/shot", {"revision": saved["revision"], "capture": capture()}
        )
        self.assertEqual(response.status, 200, await response.text())
        saved = await response.json()
        response = await self.send(
            "POST", self.base + "/generation-preview", {"revision": saved["revision"], "clipId": "shot"}
        )
        self.assertEqual(response.status, 200, await response.text())
        response = await self.send(
            "POST",
            self.base + "/queue",
            {"revision": saved["revision"], "items": [{"clipId": "shot", "count": 1}]},
        )
        self.assertEqual(response.status, 200, await response.text())
        queued = await response.json()
        self.assertEqual(len(queued["document"]["jobs"]), 1)
        response = await self.send(
            "POST", self.base + "/use-take/shot", {"revision": queued["revision"], "takeId": "original"}
        )
        self.assertEqual(response.status, 200, await response.text())
        chosen = await response.json()
        response = await self.send(
            "POST", self.base + "/delete-takes/shot", {"revision": chosen["revision"], "takeIds": ["spare"]}
        )
        self.assertEqual(response.status, 200, await response.text())
        deleted = await response.json()
        self.assertEqual(deleted["deleted"], ["spare"])
        self.assertEqual(deleted["project"]["revision"], chosen["revision"] + 1)


if __name__ == "__main__":
    unittest.main()
