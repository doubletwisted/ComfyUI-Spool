"""First-shot recipes and the edit must publish as one durable transaction."""

import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import quote

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool import projects, requests, templates
from spool.media import Media
from spool.projects import Workspace
from spool.routes import register


class WorkflowSaveTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name).resolve()
        self.workspace = Workspace(root / "app")
        self.roots = [root / kind for kind in ("input", "output", "temp")]
        for path in self.roots:
            path.mkdir()
        self.workspace.publish_host(
            {"roots": dict(zip(("input", "output", "temp"), map(str, self.roots)))}, "workflow-save-qa"
        )
        self.media = Media(self.workspace.root, *self.roots)
        self.project = self.workspace.create({"project": "Atomic workflow QA", "clips": [], "media": [], "fps": 24})
        self.store = self.workspace.for_project(self.project["id"])
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(client_max_size=16 * 1024 * 1024))
        register(server, self.workspace, self.media)
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        # Every built-in the studio offers: the bundled Comfy templates and Spool's own workflows.
        self.captures = json.loads(
            (Path(__file__).resolve().parent.parent / "ui/builtin-captures.json").read_text(encoding="utf8")
        )["templates"]
        self.captures.update({identity: templates.own_capture(identity) for identity in templates.OWN})

    def clip(self, capture, version, identity="shot"):
        return {
            "id": identity,
            "name": identity,
            "in": 0,
            "out": 120,
            "revision": 1,
            "count": 1,
            "workflowVersion": version,
            "bindings": capture["bindings"],
            "inputValues": {
                b["key"]: capture["prompt"][b["nodeId"]]["inputs"][b["input"]] for b in capture["bindings"]
            },
            "takeId": identity + "-empty",
            "takes": [
                {
                    "id": identity + "-empty",
                    "number": 0,
                    "placeholder": True,
                    "media": {"id": identity + "-empty", "kind": "image", "file": "assets/black.png", "frames": 120},
                }
            ],
        }

    async def save(self, document, recipes, revision=None):
        body = json.dumps(
            {
                "revision": self.project["revision"] if revision is None else revision,
                "document": document,
                "workflowRecipes": recipes,
            }
        ).encode()
        return await self.client.put(
            "/spool/api/projects/" + self.project["id"],
            data=io.BytesIO(body),
            headers={"Content-Type": "application/json", "X-Spool-View": "editor"},
        )

    async def test_float_contract_accepts_fraction_when_saved_default_is_an_integer(self):
        Image.new("RGB", (8, 8), "red").save(self.roots[0] / "float-source.png")
        capture = {
            "workflow": {"nodes": []},
            "prompt": {
                "load": {"class_type": "LoadImage", "inputs": {"image": "float-source.png"}},
                "noise": {"class_type": "ImageAddNoise", "inputs": {"image": ["load", 0], "seed": 1, "strength": 1}},
                "save": {"class_type": "SaveImage", "inputs": {"images": ["noise", 0]}},
            },
            "bindings": [
                {"key": "strength", "nodeId": "noise", "input": "strength", "contract": {"inputType": "FLOAT"}},
                {"key": "seed", "nodeId": "noise", "input": "seed", "contract": {"inputType": "INT"}},
            ],
            "result": {"nodeId": "save", "group": "images", "index": 0},
        }
        clip = self.clip(capture, "float-recipe")
        clip["inputValues"]["strength"] = 0.65
        response = await self.save({**self.project["document"], "clips": [clip]}, {"float-recipe": capture})
        self.assertEqual(response.status, 200, await response.text())
        project = self.store.get(self.project["id"])
        prepared = requests.prepare(
            self.store, self.media.for_project(self.store, project["id"]), project, [{"clipId": "shot", "count": 1}]
        )[0][1]
        self.assertEqual(prepared["prompt"]["noise"]["inputs"]["strength"], 0.65)
        for value in (True, "0.65"):
            project["document"]["clips"][0]["inputValues"]["strength"] = value
            with self.assertRaisesRegex(ValueError, "different literal type"):
                requests.prepare(
                    self.store,
                    self.media.for_project(self.store, project["id"]),
                    project,
                    [{"clipId": "shot", "count": 1}],
                )
        project["document"]["clips"][0]["inputValues"].update(strength=0.65, seed=1.5)
        with self.assertRaisesRegex(ValueError, "different literal type"):
            requests.prepare(
                self.store, self.media.for_project(self.store, project["id"]), project, [{"clipId": "shot", "count": 1}]
            )

    async def test_all_builtins_publish_shot_and_recipe_once_without_example_assets(self):
        document = copy.deepcopy(self.project["document"])
        for index, (identity, capture) in enumerate(self.captures.items()):
            version = "recipe-" + identity
            document["clips"].append(self.clip(capture, version, identity))
            document["clips"][-1]["workflow"] = identity
            document["clips"][-1]["takes"][0]["workflowSnapshot"] = capture
            document.setdefault("importedWorkflows", []).append({"id": identity, "name": identity, "data": capture})
            with patch("spool.projects.atomic_replace", wraps=projects.atomic_replace) as publish:
                response = await self.save(document, {version: capture})
                self.assertEqual(response.status, 200, await response.text())
                self.assertEqual(publish.call_count, 1, identity)
            self.project = await response.json()
            self.assertEqual(self.project["revision"], index + 1)
            self.assertEqual(self.project["document"]["clips"][-1]["workflowVersion"], version)
            self.assertEqual(self.project["recipes"][version]["result"]["nodeId"], capture["result"]["nodeId"])
            for binding in capture["bindings"]:
                if binding.get("asset"):
                    self.assertEqual(self.project["document"]["clips"][-1]["inputValues"][binding["key"]], "")
        reopened = Workspace(self.workspace.root).get(self.project["id"])
        self.assertEqual(len(reopened["recipes"]), 23)
        self.assertEqual(len(self.store.export_project(self.project["id"])["recipes"]), 23)
        self.assertEqual(reopened["document"]["jobs"], [])

    async def test_invalid_or_stale_capture_rolls_back_both_workflow_and_shot(self):
        capture = self.captures["video_ltx2_5_t2v"]
        document = copy.deepcopy(self.project["document"])
        document["clips"] = [self.clip(capture, "valid"), self.clip(capture, "invalid", "other")]
        invalid = copy.deepcopy(capture)
        invalid["result"]["nodeId"] = "not-a-node"
        response = await self.save(document, {"valid": capture, "invalid": invalid})
        self.assertEqual(response.status, 400, await response.text())
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM workflows").fetchone()[0], 0)
        self.assertEqual(self.store.get(self.project["id"])["document"]["clips"], [])
        response = await self.save(document, {"valid": capture}, revision=999)
        self.assertEqual(response.status, 409)
        self.assertEqual(self.store.get(self.project["id"])["revision"], 0)

    async def test_immutable_recipe_cannot_be_replaced_or_saved_without_its_clip(self):
        capture = self.captures["video_ltx2_5_t2v"]
        document = copy.deepcopy(self.project["document"])
        document["clips"] = [self.clip(capture, "saved")]
        response = await self.save(document, {"saved": capture})
        self.project = await response.json()
        changed = copy.deepcopy(capture)
        prompt = next(b for b in capture["bindings"] if b["role"] == "positive")
        changed["prompt"][prompt["nodeId"]]["inputs"][prompt["input"]] = "Different prompt"
        response = await self.save(document, {"saved": changed})
        self.assertEqual(response.status, 409, await response.text())
        document["clips"] = []
        response = await self.save(document, {"unreferenced": capture})
        self.assertEqual(response.status, 400, await response.text())
        self.assertEqual(self.store.workflow("saved")["prompt"], capture["prompt"])

    async def test_atomically_saved_recipe_queues_with_the_new_clip_identity(self):
        capture = {
            "workflow": {"nodes": []},
            "prompt": {
                "solid": {
                    "class_type": "EmptyImage",
                    "inputs": {"width": 16, "height": 16, "batch_size": 1, "color": 0},
                },
                "save": {"class_type": "SaveImage", "inputs": {"images": ["solid", 0], "filename_prefix": "atomic-qa"}},
            },
            "bindings": [],
            "result": {"nodeId": "save", "group": "images", "index": 0},
        }
        document = copy.deepcopy(self.project["document"])
        document["clips"] = [self.clip(capture, "cpu-recipe")]
        response = await self.save(document, {"cpu-recipe": capture})
        self.assertEqual(response.status, 200, await response.text())
        self.project = await response.json()
        media = self.media.for_project(self.store, self.project["id"])
        queued = requests.accept(
            self.store, media, self.project["id"], self.project["revision"], [{"clipId": "shot", "count": 1}]
        )
        attempt = self.store.attempt(queued["document"]["jobs"][0]["id"])
        self.assertEqual(attempt["clip_id"], "shot")
        self.assertEqual(attempt["request"]["capture"]["prompt"], capture["prompt"])

    async def test_empty_template_source_can_be_replaced_and_previewed(self):
        capture = self.captures["video_ltx2_5_i2v"]
        document = copy.deepcopy(self.project["document"])
        document["clips"] = [self.clip(capture, "image-recipe")]
        response = await self.save(document, {"image-recipe": capture})
        self.assertEqual(response.status, 200, await response.text())
        self.project = await response.json()
        image = io.BytesIO()
        Image.new("RGB", (16, 16), "red").save(image, format="PNG")
        response = await self.client.post(
            "/spool/api/projects/" + self.project["id"] + "/input",
            data=image.getvalue(),
            headers={"X-Filename": "chosen.png"},
        )
        self.assertEqual(response.status, 200, await response.text())
        value = (await response.json())["file"]
        document = self.project["document"]
        binding = next(b for b in capture["bindings"] if b.get("asset"))
        document["clips"][0]["inputValues"][binding["key"]] = value
        response = await self.save(document, {})
        self.assertEqual(response.status, 200, await response.text())
        response = await self.client.get("/spool/api/input/" + quote(value, safe=""))
        self.assertEqual(response.status, 200, await response.text() if response.status != 200 else "")
        self.assertEqual(await response.read(), image.getvalue())
        # Another host, or a cleaned Comfy input folder, has no staged copy yet.
        (self.roots[0] / value).unlink()
        response = await self.client.get("/spool/api/input/" + quote(value, safe=""))
        self.assertEqual(response.status, 200, await response.text() if response.status != 200 else "")
        self.assertEqual(await response.read(), image.getvalue())


if __name__ == "__main__":
    unittest.main()
