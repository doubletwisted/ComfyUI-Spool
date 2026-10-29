import asyncio
import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool import sidecars, take_workflow, requests, receipts
from spool.collection import Collector
from spool.graph_inputs import named_bindings
from spool.media import Media
from spool.projects import Workspace
from spool.routes import register


def setup(image="first.png", seed=42):
    graph = {
        "version": 0.4,
        "nodes": [
            {
                "id": "load",
                "type": "LoadImage",
                "pos": [12, 34],
                "widgets_values": [image],
                "widgets_values_named": {"image": image},
            },
            {
                "id": "seed",
                "type": "PrimitiveInt",
                "widgets_values": [seed, "fixed"],
                "widgets_values_named": {"value": seed, "control_after_generate": "fixed"},
            },
        ],
        "links": [],
        "groups": [{"title": "Original layout"}],
    }
    prompt = {
        "load": {"class_type": "LoadImage", "inputs": {"image": image}},
        "seed": {"class_type": "PrimitiveInt", "inputs": {"value": seed}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "result"}},
    }
    return {
        "workflow": graph,
        "prompt": prompt,
        "result": {"nodeId": "save", "group": "images", "index": 0},
        "bindings": [],
    }


class SidecarTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.workspace = Workspace(self.root / "app")
        self.roots = [self.root / kind for kind in ("input", "output", "temp")]
        for root in self.roots:
            root.mkdir()
        Image.new("RGB", (16, 16), "red").save(self.roots[0] / "first.png")
        self.media_base = Media(self.workspace.root, *self.roots)
        self.workspace.publish_host({"roots": {k: str(v) for k, v in self.media_base.host_roots.items()}}, "test")
        project = self.workspace.create(
            {
                "project": "Sidecars",
                "clips": [
                    {
                        "id": "shot",
                        "name": "Shot",
                        "takeId": "take",
                        "in": 0,
                        "out": 24,
                        "takes": [
                            {
                                "id": "take",
                                "number": 1,
                                "media": {
                                    "id": "media",
                                    "kind": "video",
                                    "file": "assets/black.png",
                                    "originalFile": "input/video/take.mp4",
                                    "frames": 120,
                                    "prompt": setup("embedded.png")["prompt"],
                                },
                            }
                        ],
                    }
                ],
                "media": [],
            }
        )
        self.id = project["id"]
        self.store = self.workspace.for_project(self.id)
        self.media = self.media_base.for_project(self.store, self.id)
        self.source = self.store.root / "input/video/take.mp4"
        self.source.write_bytes(b"video")
        self.capture = setup()

    def write(self, capture=None, **kwargs):
        return sidecars.write(
            self.source, capture or self.capture, lock_root=self.store.root / ".spool/locks", **kwargs
        )

    @patch(
        "spool.media._probe",
        return_value={"format": {"tags": {"prompt": json.dumps(setup("embedded.png")["prompt"])}}, "streams": []},
    )
    def test_same_stem_json_overrides_metadata_without_changing_evidence(self, probe):
        before = self.store.all_evidence(self.id)
        self.write()
        capture = take_workflow.resolve(self.store, self.id, "shot", "take")
        self.assertEqual(capture["prompt"], self.capture["prompt"])
        self.assertEqual(capture["provenance"]["source"], "Workflow sidecar")
        self.assertEqual(capture["workflow"]["groups"], [{"title": "Original layout"}])
        self.assertTrue(capture["preferWorkflow"])
        self.assertFalse(capture["sidecar"]["needsSerialization"])
        self.assertEqual(before, self.store.all_evidence(self.id))
        self.assertNotIn("spoolWorkflow", capture["workflow"].get("extra", {}))

    def test_external_graph_edit_invalidates_the_cached_api_instead_of_using_metadata(self):
        self.write()
        path = self.source.with_suffix(".json")
        graph = json.loads(path.read_text())
        graph["nodes"][0]["widgets_values"][0] = "changed.png"
        path.write_text(json.dumps(graph))
        capture = take_workflow.resolve(self.store, self.id, "shot", "take")
        self.assertIsNone(capture["prompt"])
        self.assertTrue(capture["sidecar"]["needsSerialization"])
        self.assertEqual(capture["workflow"]["nodes"][0]["widgets_values"][0], "changed.png")

    def test_plain_normal_workflow_and_invalid_sidecar_are_explicit(self):
        path = self.source.with_suffix(".json")
        path.write_text(json.dumps(self.capture["workflow"]))
        self.assertTrue(sidecars.read(self.source)["sidecar"]["needsSerialization"])
        path.write_text("{unfinished")
        with self.assertRaisesRegex(ValueError, "sidecar take.json"):
            take_workflow.resolve(self.store, self.id, "shot", "take")

    def test_media_original_is_used_instead_of_the_review_proxy(self):
        self.write()
        self.assertFalse((self.store.root / "assets/black.json").exists())
        self.assertIsNotNone(take_workflow.resolve(self.store, self.id, "shot", "take")["sidecar"])

    def test_exact_seed_and_named_widget_values_survive_the_normal_file(self):
        capture = setup(seed=18446744073709551615)
        capture["prompt"]["seed"]["inputs"]["value"] -= 1
        self.write(capture)
        graph = json.loads(self.source.with_suffix(".json").read_text())
        self.assertEqual(graph["nodes"][1]["widgets_values"][0], 18446744073709551614)
        self.assertEqual(sidecars.read(self.source)["prompt"]["seed"]["inputs"]["value"], 18446744073709551614)
        self.assertEqual(graph["nodes"][0]["pos"], [12, 34])

    def test_exposed_subgraph_control_updates_its_parent_widget(self):
        capture = setup()
        capture["workflow"] = {
            "nodes": [{"id": 5, "type": "inner", "widgets_values": ["old"], "widgets_values_named": {"prompt": "old"}}],
            "definitions": {
                "subgraphs": [
                    {
                        "id": "inner",
                        "inputs": [{"name": "prompt"}],
                        "links": [{"id": 7, "origin_id": -10, "origin_slot": 0, "target_id": 8, "target_slot": 0}],
                        "nodes": [{"id": 8, "type": "CLIPTextEncode", "inputs": [{"name": "text", "link": 7}]}],
                    }
                ]
            },
        }
        capture["prompt"] = {"5:8": {"class_type": "CLIPTextEncode", "inputs": {"text": "actual prompt"}}}
        self.assertEqual(named_bindings(capture["workflow"], capture["prompt"])[0]["widgetNodeId"], "5")
        self.write(capture)
        self.assertEqual(sidecars.read(self.source)["workflow"]["nodes"][0]["widgets_values"], ["actual prompt"])

    def test_sorted_named_metadata_does_not_assign_the_wrong_widget_index(self):
        capture = setup(seed=91)
        capture["workflow"] = json.loads(json.dumps(capture["workflow"], sort_keys=True))
        capture["prompt"]["seed"]["inputs"]["value"] = 123
        self.write(capture)
        saved = sidecars.read(self.source)
        self.assertEqual(saved["workflow"]["nodes"][1]["widgets_values"], [123, "fixed"])

    def test_current_api_reference_wins_over_an_old_owned_editor_alias(self):
        first = self.media.prepare_workflow(setup(), True)
        Image.new("RGB", (16, 16), "blue").save(self.roots[0] / "second.png")
        second = self.media.prepare_workflow(setup("second.png"), True)
        first["prompt"]["load"]["inputs"]["image"] = second["prompt"]["load"]["inputs"]["image"]
        first["provenance"] = {"takeBase": {"takeId": "take"}}
        prepared = self.media.prepare_workflow(first, True)
        self.assertEqual(prepared["prompt"]["load"]["inputs"]["image"], second["prompt"]["load"]["inputs"]["image"])
        self.assertEqual(
            prepared["workflow"]["nodes"][0]["widgets_values"][0], second["prompt"]["load"]["inputs"]["image"]
        )

    def test_compare_and_swap_protects_manual_edits_and_retry_never_overwrites(self):
        self.write()
        old = sidecars.read(self.source)["sidecar"]["sha256"]
        edited = setup(seed=99)
        self.write(edited, expected=old)
        with self.assertRaisesRegex(ValueError, "sidecar changed"):
            self.write(expected=old)
        self.assertFalse(self.write(replace=False))
        self.assertEqual(sidecars.read(self.source)["prompt"]["seed"]["inputs"]["value"], 99)

    def test_linked_apply_persists_the_editable_file_and_rejects_stale_file(self):
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.media_base)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                capture = copy.deepcopy(self.capture)
                capture["provenance"] = {"spoolLink": {"projectId": self.id, "clipId": "shot", "sidecarSha": ""}}
                response = await client.post(
                    "/spool/api/projects/" + self.id + "/capture/shot",
                    json={"revision": 0, "capture": capture, "resetInputs": True, "saveSidecar": True},
                )
                self.assertEqual(response.status, 200, await response.text())
                saved = await response.json()
                read = sidecars.read(self.source)
                self.assertEqual(
                    read["sidecar"]["sha256"],
                    saved["recipes"][saved["document"]["clips"][0]["workflowVersion"]]["sidecar"]["sha256"],
                )
                response = await client.post(
                    "/spool/api/projects/" + self.id + "/capture/shot",
                    json={"revision": saved["revision"], "capture": capture, "resetInputs": True, "saveSidecar": True},
                )
                self.assertEqual(response.status, 400)
                self.assertEqual(self.store.revision(self.id), saved["revision"])

        asyncio.run(check())

    def test_generated_take_gets_an_editable_sidecar_with_frozen_inputs(self):
        capture = self.media.prepare_workflow(self.capture, True)
        project = self.store.capture(self.id, 0, "shot", capture)
        queued = requests.accept(self.store, self.media, self.id, project["revision"], [{"clipId": "shot", "count": 1}])
        attempt = self.store.attempt(queued["document"]["jobs"][0]["id"])
        Image.new("RGB", (16, 16), "red").save(self.roots[1] / "result.png")
        history = {
            "prompt": [0, attempt["prompt_id"], attempt["request"]["prompt"]],
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"save": {"images": [{"filename": "result.png", "type": "output"}]}},
        }
        artifacts, primary = self.media.collect(attempt, history, False)
        receipt = self.media.receipt_path(attempt)
        receipts.write(receipt.parent, attempt, artifacts, primary, history)
        Collector(self.workspace, self.media_base).ingest(attempt)
        result = sidecars.read(self.media.resolve(primary["originalFile"]))
        self.assertEqual(result["prompt"]["load"]["inputs"]["image"], attempt["request"]["assets"][0]["frozen"])
        self.assertEqual(result["workflow"]["nodes"][0]["widgets_values"][0], attempt["request"]["assets"][0]["frozen"])

    def test_a_take_made_without_optional_inputs_keeps_them_in_its_workflow(self):
        loader = lambda node: {
            "id": node,
            "type": "LoadImage",
            "widgets_values": [""],
            "widgets_values_named": {"image": ""},
        }
        graph = {
            "version": 0.4,
            "nodes": [
                loader("ref1"),
                loader("ref2"),
                {"id": "gen", "type": "Reference"},
                {"id": "save", "type": "SaveVideo"},
            ],
            "links": [],
        }
        # The recipe still names a reference that was removed before this run.
        prompt = {
            "ref1": {"class_type": "LoadImage", "inputs": {"image": ""}},
            "ref2": {"class_type": "LoadImage", "inputs": {"image": "removed-reference.png"}},
            "gen": {"class_type": "Reference", "inputs": {"image_1": ["ref1", 0], "image_2": ["ref2", 0], "seed": 1}},
            "save": {"class_type": "SaveVideo", "inputs": {"video": ["gen", 0], "filename_prefix": "result"}},
        }
        slot = lambda key, node: {
            "key": key,
            "nodeId": node,
            "input": "image",
            "asset": True,
            "optional": True,
            "group": "Images",
            "omit": [node],
        }
        rules = [{"anyOf": ["Images"], "message": "Add an image."}]
        capture = {
            "workflow": graph,
            "prompt": prompt,
            "bindings": [slot("one", "ref1"), slot("two", "ref2")],
            "inputRules": rules,
            "result": {"nodeId": "save", "group": "videos", "index": 0},
        }
        ran = copy.deepcopy(prompt)
        ran["ref1"]["inputs"]["image"] = "frozen.png"
        ran["gen"]["inputs"]["seed"] = 7
        del ran["ref2"], ran["gen"]["inputs"]["image_2"]
        attempt = {
            "id": "attempt",
            "take_id": "made",
            "request": {"capture": capture, "prompt": ran, "omittedInputs": ["two"]},
        }
        sidecars.write_result(self.store, self.media, attempt, {"primary": {"originalFile": "input/video/take.mp4"}})
        kept = sidecars.read(self.source)
        self.assertEqual(kept["prompt"]["gen"]["inputs"], {"image_1": ["ref1", 0], "image_2": ["ref2", 0], "seed": 7})
        self.assertEqual(
            (kept["prompt"]["ref1"]["inputs"]["image"], kept["prompt"]["ref2"]["inputs"]["image"]), ("frozen.png", "")
        )
        self.assertEqual((kept["inputRules"], [b["optional"] for b in kept["bindings"]]), (rules, [True, True]))


if __name__ == "__main__":
    unittest.main()
