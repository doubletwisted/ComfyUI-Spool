"""Nested save payloads fail at the HTTP boundary before staging or publication."""

import copy
import hashlib
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool.media import Media
from spool.projects import Workspace
from spool.routes import register


def capture():
    return {
        "workflow": {"nodes": []},
        "prompt": {
            "load": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0]}},
        },
        "bindings": [],
        "result": {"nodeId": "save", "group": "images", "index": 0},
    }


class NestedRequestShapeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.roots = [self.root / kind for kind in ("input", "output", "temp")]
        for root in self.roots:
            root.mkdir()
        Image.new("RGB", (8, 8), "red").save(self.roots[0] / "source.png")
        self.workspace = Workspace(self.root / "app")
        self.project = self.workspace.create(
            {
                "project": "Nested shape QA",
                "clips": [{"id": "shot", "name": "Original", "takes": [], "in": 0, "out": 24}],
                "media": [],
            }
        )
        self.store = self.workspace.for_project(self.project["id"])
        self.media = Media(self.workspace.root, *self.roots)
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.workspace, self.media)
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.base = "/spool/api/projects/" + self.project["id"]

    def files(self):
        return {
            str(file.relative_to(self.root)): hashlib.sha256(file.read_bytes()).hexdigest()
            for root in [*self.roots, self.store.root]
            for file in root.rglob("*")
            if file.is_file()
        }

    def body(self):
        return {"revision": self.project["revision"], "document": copy.deepcopy(self.project["document"])}

    def recipe_body(self):
        body = self.body()
        body["document"]["clips"][0]["workflowVersion"] = "recipe"
        body["workflowRecipes"] = {"recipe": capture()}
        return body

    async def rejected(self, body, field, path=None, method="put", spy=True):
        before = self.store.get(self.project["id"])
        files = self.files()
        preparation = (
            patch.object(Media, "prepare_workflow", side_effect=AssertionError("Preparation ran before validation"))
            if spy
            else nullcontext()
        )
        with preparation as prepare:
            response = await getattr(self.client, method)(path or self.base, json=body)
            value = await response.json()
            self.assertEqual((response.status, value.get("code")), (400, "invalid_request"), value)
            self.assertIn(field, value["error"])
            if prepare is not None:
                prepare.assert_not_called()
        self.assertEqual(self.store.get(self.project["id"]), before)
        self.assertEqual(self.files(), files)

    async def test_scalar_clip_is_invalid_before_mutation(self):
        body = self.body()
        body["document"]["clips"] = [1]
        await self.rejected(body, "clips", spy=False)

    async def test_null_recipe_map_is_invalid_before_preparation(self):
        body = self.body()
        body["workflowRecipes"] = None
        await self.rejected(body, "workflowRecipes", spy=False)

    async def test_clip_and_media_entries_need_objects_and_ids(self):
        for field, value in (
            ("clips", [None]),
            ("clips", [[]]),
            ("clips", [{}]),
            ("clips", [{"id": []}]),
            ("media", None),
            ("media", {}),
            ("media", [1]),
            ("media", [{}]),
            ("audioClips", None),
            ("audioClips", [1]),
            ("importedWorkflows", {}),
            ("importedWorkflows", [None]),
        ):
            with self.subTest(field=field, value=value):
                body = self.recipe_body()
                body["document"][field] = value
                await self.rejected(body, field)

    async def test_take_binding_and_input_containers_are_checked_before_recipes(self):
        for field, value in (
            ("takes", None),
            ("takes", [1]),
            ("takes", [{}]),
            ("takes", [{"id": "take", "media": None}]),
            ("takes", [{"id": "take", "media": {}}]),
            ("bindings", None),
            ("bindings", [1]),
            ("bindings", [{}]),
            ("inputValues", None),
            ("inputValues", []),
        ):
            with self.subTest(field=field, value=value):
                body = self.recipe_body()
                body["document"]["clips"][0][field] = value
                expected = (
                    "media"
                    if field == "takes"
                    and isinstance(value, list)
                    and value
                    and isinstance(value[0], dict)
                    and "media" in value[0]
                    else field
                )
                await self.rejected(body, expected)

    async def test_recipe_map_and_capture_containers_are_checked_before_preparation(self):
        for value in ([], "recipes", 1):
            with self.subTest(value=value):
                body = self.body()
                body["workflowRecipes"] = value
                await self.rejected(body, "workflowRecipes")
        for value, field in (
            (None, "workflow"),
            ([], "workflow"),
            ({**capture(), "bindings": None}, "bindings"),
            ({**capture(), "bindings": [1]}, "bindings"),
            ({**capture(), "bindings": [{}]}, "bindings"),
            ({**capture(), "provenance": []}, "provenance"),
            ({**capture(), "provenance": {"builtinTemplate": []}}, "builtinTemplate"),
            ({**capture(), "result": None}, "result"),
            ({**capture(), "result": {"nodeId": []}}, "nodeId"),
            ({**capture(), "prompt": {"load": 1}}, "prompt"),
            ({**capture(), "workflow": []}, "workflow"),
            ({**capture(), "workflow": {"nodes": [1]}}, "nodes"),
            ({**capture(), "workflow": {"nodes": [{"type": "LoadImage"}]}}, "id"),
            ({**capture(), "workflow": {"definitions": None}}, "definitions"),
            ({**capture(), "workflow": {"definitions": {"subgraphs": [1]}}}, "subgraphs"),
        ):
            with self.subTest(value=value):
                body = self.recipe_body()
                body["workflowRecipes"]["recipe"] = value
                await self.rejected(body, field)

    async def test_all_recipes_are_validated_before_the_first_one_stages_files(self):
        body = self.recipe_body()
        body["workflowRecipes"]["later"] = {**capture(), "result": None}
        await self.rejected(body, "result")

    async def test_later_input_recovery_is_validated_before_any_files_are_staged(self):
        for recovery in (None, {"recovered": {}}, {"recovered": None}):
            with self.subTest(recovery=recovery):
                body = self.recipe_body()
                body["workflowRecipes"]["later"] = {**capture(), "inputRecovery": recovery}
                await self.rejected(body, "inputRecovery", spy=False)

    async def test_capture_input_recovery_is_rejected_without_file_mutation(self):
        for recovery in (None, {"recovered": {}}, {"recovered": None}):
            with self.subTest(recovery=recovery):
                await self.rejected(
                    {"revision": self.project["revision"], "capture": {**capture(), "inputRecovery": recovery}},
                    "inputRecovery",
                    self.base + "/capture/shot",
                    "post",
                    spy=False,
                )

    async def test_capture_route_rejects_shapes_before_preparing_inputs(self):
        for value, field in ((None, "workflow"), ({**capture(), "bindings": [1]}, "bindings")):
            await self.rejected(
                {"revision": self.project["revision"], "capture": value},
                field,
                self.base + "/capture/shot",
                "post",
            )
        await self.rejected(
            {"revision": self.project["revision"], "capture": capture(), "overrides": []},
            "overrides",
            self.base + "/capture/shot",
            "post",
        )

    async def test_valid_recipe_stages_real_input_and_stale_save_still_conflicts(self):
        before = self.files()
        body = self.recipe_body()
        body["workflowRecipes"]["recipe"]["inputRecovery"] = {"recovered": []}
        response = await self.client.put(self.base, json=body)
        self.assertEqual(response.status, 200, await response.text())
        saved = await response.json()
        self.assertEqual(saved["revision"], self.project["revision"] + 1)
        self.assertEqual(saved["document"]["clips"][0]["name"], "Original")
        self.assertIn("recipe", saved["recipes"])
        self.assertTrue(list((self.store.root / "input").rglob("*.png")))
        self.assertNotEqual(self.files(), before)
        response = await self.client.put(self.base, json={"revision": body["revision"], "document": saved["document"]})
        value = await response.json()
        self.assertEqual((response.status, value["code"]), (409, "revision_conflict"))
        self.assertEqual(self.store.get(self.project["id"]), saved)

    async def test_capture_without_optional_overrides_still_succeeds(self):
        response = await self.client.post(
            self.base + "/capture/shot",
            json={"revision": self.project["revision"], "capture": capture(), "overrides": None},
        )
        self.assertEqual(response.status, 200, await response.text())

    async def test_minimal_save_defaults_match_the_demo_control(self):
        response = await self.client.put(
            self.base,
            json={
                "revision": self.project["revision"],
                "document": {"project": "Minimal valid save", "clips": [{"id": "empty", "in": 0, "out": 24}]},
                "workflowRecipes": {},
            },
        )
        self.assertEqual(response.status, 200, await response.text())
        saved = await response.json()
        self.assertEqual(saved["revision"], self.project["revision"] + 1)
        self.assertEqual(saved["document"]["clips"][0]["takes"], [])


if __name__ == "__main__":
    unittest.main()
