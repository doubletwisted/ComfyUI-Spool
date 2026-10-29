import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image, PngImagePlugin

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.media import Media
from spool.routes import register
from spool.store import Store, Conflict
from spool.take_workflow import resolve


def prompt(image="S04.png", text="S04 wrist check"):
    return {
        "105:114": {"class_type": "LoadImage", "inputs": {"image": image}},
        "text": {"class_type": "CLIPTextEncode", "inputs": {"text": text}},
        "seed": {"class_type": "PrimitiveInt", "inputs": {"value": 18446744073709551615}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["105:114", 0], "filename_prefix": "old-output"}},
    }


def document():
    workflow = {
        "nodes": [{"id": 105, "type": "subgraph"}],
        "definitions": {
            "subgraphs": [
                {"id": "subgraph", "nodes": [{"id": 114, "type": "LoadImage", "widgets_values": ["S15.png", "image"]}]}
            ]
        },
    }
    takes = [
        {
            "id": "s04",
            "number": 4,
            "media": {
                "id": "m04",
                "kind": "image",
                "name": "S04.png",
                "file": "assets/black.png",
                "frames": 24,
                "workflow": workflow,
                "prompt": prompt(),
            },
        },
        {
            "id": "plain",
            "number": 5,
            "media": {"id": "plain-media", "kind": "image", "file": "assets/black.png", "frames": 120},
        },
    ]
    return {
        "project": "Take setup QA",
        "clips": [
            {
                "id": "shot",
                "name": "Wrist check",
                "takeId": "plain",
                "in": 12,
                "out": 60,
                "takes": takes,
                "bindings": [],
                "inputValues": {},
                "revision": 1,
                "shotInputs": [{"key": "wrong-source", "source": "selected"}],
                "seedKey": "old-seed",
            },
            {"id": "following", "takes": [], "in": 0, "out": 24, "gapBefore": 8},
        ],
    }


def embedded_fixture(root):
    target = root / "assets" / "black.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    tags = PngImagePlugin.PngInfo()
    for key in ("workflow", "prompt"):
        tags.add_text(key, json.dumps(document()["clips"][0]["takes"][0]["media"][key]))
    Image.new("RGB", (16, 16)).save(target, pnginfo=tags)


class TakeWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name))
        embedded_fixture(self.store.root)
        self.project = self.store.create(document())
        self.id = self.project["id"]

    def test_embedded_inputs_override_stale_subgraph_widgets(self):
        before = self.store.all_evidence(self.id)
        capture = resolve(self.store, self.id, "shot", "s04")
        self.assertEqual(capture["prompt"], prompt())
        self.assertEqual(capture["workflow"]["definitions"]["subgraphs"][0]["nodes"][0]["widgets_values"][0], "S04.png")
        self.assertEqual(capture["result"], {"nodeId": "save", "group": "images", "index": 0})
        self.assertEqual(capture["provenance"]["takeBase"]["takeId"], "s04")
        self.assertEqual(self.store.all_evidence(self.id), before)

    def test_picture_and_recipe_commit_together_with_trim_compensation(self):
        capture = resolve(self.store, self.id, "shot", "s04")
        capture["bindings"] = [{"key": "image", "nodeId": "105:114", "input": "image", "asset": True}]
        project = self.store.capture(self.id, 0, "shot", capture, take_id="s04")
        clip, following = project["document"]["clips"]
        self.assertEqual(
            (clip["takeId"], clip["generationBase"]["takeId"], clip["in"], clip["out"], following["gapBefore"]),
            ("s04", "s04", 0, 24, 32),
        )
        self.assertEqual(clip["inputValues"], {"image": "S04.png"})
        self.assertNotIn("shotInputs", clip)
        self.assertNotIn("seedKey", clip)
        reopened = Store(Path(self.temp.name)).get(self.id)
        self.assertEqual(reopened, project)
        with self.assertRaises(Conflict):
            self.store.capture(self.id, 0, "shot", None, take_id="plain")
        self.assertEqual(self.store.get(self.id), project)

    def test_plain_take_clears_unrelated_generation_setup(self):
        capture = resolve(self.store, self.id, "shot", "s04")
        first = self.store.capture(self.id, 0, "shot", capture, take_id="s04")
        self.assertIsNone(resolve(self.store, self.id, "shot", "plain"))
        last = self.store.capture(self.id, first["revision"], "shot", None, take_id="plain")["document"]["clips"][0]
        self.assertEqual(last["takeId"], "plain")
        self.assertNotIn("workflowVersion", last)
        self.assertEqual(last["inputValues"], {})

    def test_linked_capture_resets_source_assignments_in_the_same_revision(self):
        capture = resolve(self.store, self.id, "shot", "s04")
        project = self.store.capture(self.id, 0, "shot", capture, reset_inputs=True)
        clip = project["document"]["clips"][0]
        self.assertNotIn("shotInputs", clip)
        self.assertNotIn("seedKey", clip)
        self.assertEqual(clip["seedMode"], "same")
        self.assertEqual(clip["takeId"], "plain")
        self.assertEqual(self.store.workflow(clip["workflowVersion"])["prompt"], prompt())

    def test_invalid_capture_or_wrong_take_cannot_change_the_edit(self):
        capture = resolve(self.store, self.id, "shot", "s04")
        with self.assertRaisesRegex(ValueError, "belong"):
            self.store.capture(self.id, 0, "shot", capture, take_id="plain")
        capture["result"]["nodeId"] = "missing"
        with self.assertRaises(ValueError):
            self.store.capture(self.id, 0, "shot", capture, take_id="s04")
        self.assertEqual(self.store.get(self.id), self.project)

    def test_observed_then_dispatch_then_frozen_request_precedence(self):
        take = {
            "id": "generated",
            "number": 8,
            "generated": True,
            "request": {
                "attemptId": "attempt",
                "capture": {"prompt": prompt("stale.png")},
                "prompt": prompt("frozen.png"),
            },
            "media": {"id": "native", "name": "native.png", "prompt": prompt("embedded.png")},
        }
        result = {"history": {"prompt": [0, "pid", prompt("observed.png"), {}]}}
        dispatch = {"payload": {"prompt": prompt("dispatch.png")}}
        store = SimpleNamespace(
            clip=lambda *_: {"takes": [take]},
            attempt=lambda _: {
                "project_id": "project",
                "take_id": "generated",
                "id": "attempt",
                "result": json.dumps(result),
            },
            dispatch_record=lambda _: dispatch,
        )
        self.assertEqual(resolve(store, "project", "shot", "generated")["prompt"], prompt("observed.png"))
        result.clear()
        self.assertEqual(resolve(store, "project", "shot", "generated")["prompt"], prompt("dispatch.png"))
        dispatch.clear()
        self.assertEqual(resolve(store, "project", "shot", "generated")["prompt"], prompt("frozen.png"))

    def test_imported_execution_uses_embedded_actual_values_before_old_request(self):
        take = {
            "id": "imported",
            "importedExecution": {"prompt": prompt("old-request.png")},
            "media": {"id": "imported-media", "prompt": prompt("worker-actual.png")},
        }
        store = SimpleNamespace(clip=lambda *_: {"takes": [take]})
        capture = resolve(store, "project", "shot", "imported")
        self.assertEqual(capture["prompt"], prompt("worker-actual.png"))
        self.assertEqual(capture["provenance"]["source"], "Embedded take metadata")

    def test_farm_continuation_retains_the_launcher_with_observed_worker_inputs(self):
        launcher = {"class_type": "DeadlineSubmit", "inputs": {"output_directory": "farm-output"}}
        take = {
            "id": "farm",
            "generated": True,
            "request": {
                "attemptId": "attempt",
                "target": "deadline",
                "prompt": {**prompt("old.png"), "submit": launcher},
            },
            "media": {"id": "farm-media"},
        }
        result = {"observedPrompt": prompt("actual.png")}
        store = SimpleNamespace(
            clip=lambda *_: {"takes": [take]},
            attempt=lambda _: {"project_id": "project", "take_id": "farm", "result": json.dumps(result)},
            dispatch_record=lambda _: None,
        )
        capture = resolve(store, "project", "shot", "farm")
        self.assertEqual(capture["prompt"], {**prompt("actual.png"), "submit": launcher})


class TakeWorkflowRoutes(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.store = Store(root / "store")
        embedded_fixture(self.store.root)
        self.project = self.store.create(document())
        self.media = Media(self.store.root, root / "input", root / "output", root / "temp")
        (root / "input").mkdir()
        Image.new("RGB", (16, 16), "red").save(root / "input" / "S04.png")
        Image.new("RGB", (16, 16), "blue").save(root / "input" / "S15.png")
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.store, self.media)
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.path = "/spool/api/projects/" + self.project["id"]

    async def test_exact_take_input_and_atomic_adoption(self):
        response = await self.client.get(self.path + "/take-workflow/shot/s04")
        self.assertEqual(response.status, 200)
        capture = await response.json()
        self.assertEqual(capture["prompt"]["105:114"]["inputs"]["image"], "S04.png")
        response = await self.client.post(
            self.path + "/use-take/shot", json={"revision": 0, "takeId": "s04", "capture": capture}
        )
        self.assertEqual(response.status, 200, await response.text())
        clip = (await response.json())["document"]["clips"][0]
        self.assertEqual(clip["takeId"], clip["generationBase"]["takeId"])
        self.assertEqual(self.store.workflow(clip["workflowVersion"])["prompt"], prompt())

    async def test_missing_actual_input_never_uses_stale_widget_file(self):
        (self.media.host_roots["input"] / "S04.png").unlink()
        response = await self.client.get(self.path + "/take-workflow/shot/s04")
        self.assertEqual(response.status, 400)
        self.assertIn("S04.png", (await response.json())["error"])
        self.assertEqual(self.store.get(self.project["id"]), self.project)


if __name__ == "__main__":
    unittest.main()
