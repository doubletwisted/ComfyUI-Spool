import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.media import Media
from spool.routes import register
from spool.store import Store
from spool.workflow_inputs import compact_groups, input_problem, leave_out


def capture(path, api_name="worker/reference.png"):
    return {"workflow": {"nodes": [{"id": 114, "type": "LoadImage", "widgets_values": [str(path), "image"]}], "links": []},
            "prompt": {"114": {"class_type": "LoadImage", "inputs": {"image": api_name}},
                       "92": {"class_type": "SaveImage", "inputs": {"images": ["114", 0], "filename_prefix": "unchanged"}}},
            "bindings": [{"key": "frame", "nodeId": "114", "input": "image", "asset": True}],
            "result": {"nodeId": "92", "group": "images", "index": 0}}


class WorkflowInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.input = self.root / "input"
        self.input.mkdir()
        self.source = self.root / "worker" / "reference.png"
        self.source.parent.mkdir()
        Image.new("RGB", (8, 8), "red").save(self.source)
        self.media = Media(self.root, self.input, self.root / "output", self.root / "temp")

    def test_explicit_worker_source_copies_once_and_preserves_history(self):
        original = capture(self.source)
        before = copy.deepcopy(original)
        prepared = self.media.prepare_workflow(original, True)
        name = prepared["prompt"]["114"]["inputs"]["image"]
        self.assertTrue(name.startswith("spool-imported/"))
        self.assertEqual((self.input / name).read_bytes(), self.source.read_bytes())
        self.assertEqual(prepared["workflow"]["nodes"][0]["widgets_values"][0], name)
        self.assertEqual(original, before)
        self.assertEqual(prepared["prompt"]["92"], before["prompt"]["92"])
        self.assertEqual(self.media.prepare_workflow(original, True), prepared)
        self.source.unlink()
        self.assertEqual(self.media.prepare_workflow(prepared, True), prepared)
        self.assertEqual(len(list(self.input.rglob("*.png"))), 1)

    def test_same_basename_never_overwrites_a_different_reference(self):
        other = self.root / "other" / self.source.name
        other.parent.mkdir()
        Image.new("RGB", (8, 8), "blue").save(other)
        local = self.input / self.source.name
        Image.new("RGB", (8, 8), "green").save(local)
        before = local.read_bytes()
        first = self.media.prepare_workflow(capture(self.source), True)
        second = self.media.prepare_workflow(capture(other), True)
        self.assertNotEqual(first["prompt"]["114"], second["prompt"]["114"])
        self.assertEqual(local.read_bytes(), before)

    def test_missing_worker_path_does_not_fall_back_to_a_local_namesake(self):
        Image.new("RGB", (8, 8)).save(self.input / self.source.name)
        graph = capture(self.root / "offline" / self.source.name, self.source.name)
        prepared = self.media.prepare_workflow(graph)
        self.assertEqual(prepared["inputRecovery"]["missing"][0]["nodeId"], "114")
        self.assertEqual(prepared["workflow"], graph["workflow"])
        with self.assertRaisesRegex(ValueError, "Reference file unavailable.*114"):
            self.media.prepare_workflow(graph, True)

    def test_empty_source_is_editable_but_remains_unconfigured(self):
        graph = capture("", "")
        before = copy.deepcopy(graph)
        prepared = self.media.prepare_workflow(graph, True)
        self.assertEqual(prepared["workflow"], before["workflow"])
        self.assertEqual(prepared["prompt"], before["prompt"])
        self.assertEqual(prepared["inputRecovery"]["missing"], [{"nodeId": "114", "input": "image", "sources": []}])
        self.assertFalse(prepared["inputRecovery"]["recovered"])
        self.assertEqual(graph, before)
        self.assertFalse(list(self.input.rglob("*")))
        graph["prompt"]["missing"] = {"class_type": "LoadImage", "inputs": {"image": "unavailable.png"}}
        with self.assertRaisesRegex(ValueError, "Reference file unavailable.*missing"):
            self.media.prepare_workflow(graph, True)

    def test_existing_relative_and_output_annotated_inputs(self):
        (self.input / "local.png").write_bytes(self.source.read_bytes())
        prepared = self.media.prepare_workflow({"prompt": {"1": {"class_type": "LoadImage", "inputs": {"image": "local.png"}}}}, True)
        self.assertEqual(prepared["prompt"]["1"]["inputs"]["image"], "local.png")
        self.media.host_roots["output"].mkdir()
        (self.media.host_roots["output"] / "output.png").write_bytes(self.source.read_bytes())
        output = self.media.prepare_workflow({"prompt": {"1": {"class_type": "LoadImage", "inputs": {"image": "output.png [output]"}}}}, True)
        self.assertTrue(output["prompt"]["1"]["inputs"]["image"].startswith("spool-imported/"))

    def test_subgraph_loader_uses_its_expanded_execution_address(self):
        original = capture(self.source)
        loader = original["workflow"]["nodes"][0]
        original["workflow"] = {"nodes": [{"id": 105, "type": "subgraph-id"}], "definitions": {"subgraphs": [{"id": "subgraph-id", "nodes": [loader]}]}}
        original["prompt"]["105:114"] = original["prompt"].pop("114")
        prepared = self.media.prepare_workflow(original, True)
        self.assertEqual(prepared["prompt"]["105:114"]["inputs"]["image"], prepared["workflow"]["definitions"]["subgraphs"][0]["nodes"][0]["widgets_values"][0])

    def test_external_recovery_requires_a_local_caller(self):
        prepared = self.media.prepare_workflow(capture(self.source), allow_external=False)
        self.assertTrue(prepared["inputRecovery"]["missing"])
        self.assertFalse(list(self.input.rglob("*.png")))
        graph = {"prompt": {"1": {"class_type": "LoadImage", "inputs": {"image": "../worker/reference.png"}}}}
        self.assertTrue(self.media.prepare_workflow(graph)["inputRecovery"]["missing"])

    def test_changed_content_addressed_input_is_not_overwritten(self):
        graph = capture(self.source)
        prepared = self.media.prepare_workflow(graph, True)
        target = self.input / prepared["prompt"]["114"]["inputs"]["image"]
        target.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "content hash"):
            self.media.prepare_workflow(graph, True)
        with self.assertRaisesRegex(ValueError, "content hash"):
            self.media.prepare_workflow(prepared, True)
        self.assertEqual(target.read_bytes(), b"changed")


class OptionalInputTests(unittest.TestCase):
    """The shared rules for optional and grouped media inputs, and what a request leaves out."""
    fixture = json.loads((Path(__file__).parent / "fixtures/optional_inputs.json").read_text(encoding="utf-8"))

    def prompt(self):
        loader = lambda: {"class_type": "LoadImage", "inputs": {"image": ""}}
        nodes = {node: loader() for node in ("1", "11", "12", "13", "31")}
        nodes.update({"21": {"class_type": "LoadVideo", "inputs": {"file": ""}}, "22": {"class_type": "LoadVideo", "inputs": {"file": ""}},
                      "32": {"class_type": "ImageScale", "inputs": {"image": ["31", 0], "width": 512, "height": 512}},
                      "40": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": "A walk"}},
                      "50": {"class_type": "Generator", "inputs": {"first": ["1", 0], "prompt": ["40", 0], "last": ["32", 0], "seed": 4,
                                                                   **{"image_" + str(i): [n, 0] for i, n in enumerate(("11", "12", "13"), 1)},
                                                                   **{"video_" + str(i): [n, 0] for i, n in enumerate(("21", "22"), 1)}}},
                      "60": {"class_type": "SaveVideo", "inputs": {"video": ["50", 0], "filename_prefix": "out"}}})
        return nodes

    def test_shared_cases(self):
        bindings, rules = self.fixture["bindings"], self.fixture["rules"]
        for case in self.fixture["cases"]:
            with self.subTest(case["name"]):
                values, settings = compact_groups(bindings, case["values"], case["settings"])
                self.assertEqual({"values": values, "settings": settings}, case["compacted"])
                self.assertEqual(input_problem(bindings, values, settings, rules), case["problem"])
                prompt = self.prompt()
                self.assertEqual(leave_out(prompt, bindings, values, settings, "60"), case["omitted"])
                left = {b["nodeId"] for b in bindings if b["key"] in case["omitted"]}
                self.assertFalse(left & set(prompt))
                self.assertEqual("32" in prompt, "last" not in case["omitted"])
                links = [value[0] for node in prompt.values() for value in node["inputs"].values() if isinstance(value, list)]
                self.assertTrue(set(links) <= set(prompt))

    def test_a_gap_moves_later_inputs_into_the_first_slots(self):
        bindings = self.fixture["bindings"]
        values, settings = compact_groups(bindings, {"ref2": "b.png", "ref3": "c.png", "first": "a.png"}, [])
        prompt = self.prompt()
        leave_out(prompt, bindings, values, settings, "60")
        self.assertEqual(sorted(k for k in prompt["50"]["inputs"] if k.startswith("image_")), ["image_1", "image_2"])
        self.assertEqual((values["ref1"], values["ref2"], values["ref3"]), ("b.png", "c.png", ""))

    def test_the_output_is_never_left_out(self):
        bindings = [{"key": "save", "nodeId": "60", "input": "filename_prefix", "asset": True, "optional": True, "omit": ["60"]}]
        with self.assertRaisesRegex(ValueError, "cannot remove the clip output"):
            leave_out(self.prompt(), bindings, {"save": ""}, [], "60")

    def test_nodes_removed_in_comfy_are_ignored(self):
        bindings = [{"key": "gone", "nodeId": "99", "input": "image", "asset": True, "optional": True, "omit": ["99", "98"]}]
        prompt = self.prompt()
        self.assertEqual(leave_out(prompt, bindings, {"gone": ""}, [], "60"), ["gone"])
        self.assertEqual(prompt, self.prompt())


class WorkflowInputRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.store = Store(self.root / "store")
        self.source = self.root / "worker.png"
        Image.new("RGB", (16, 16), "red").save(self.source)
        self.input = self.root / "input"
        self.input.mkdir()
        self.media = Media(self.store.root, self.input, self.root / "output", self.root / "temp")
        self.project = self.store.create({"project": "Recovery QA", "clips": [{"id": "shot", "takeId": "original", "revision": 1, "takes": []}]})
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.store, self.media)
        # This fixture exercises routes, not background receipt collection.
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_import_json_capture_override_and_graph_handoff(self):
        original = capture(self.source)
        response = await self.client.post('/spool/api/projects/' + self.project['id'] + '/import-workflow', data=json.dumps(original), headers={'X-Spool-Revision': '0'})
        self.assertEqual(response.status, 200, await response.text())
        imported = (await response.json())['workflow']['data']
        self.assertEqual(imported['provenance']['originalDocument'], original)
        self.assertTrue(imported['inputRecovery']['recovered'])
        response = await self.client.post('/spool/api/projects/' + self.project['id'] + '/capture/shot', json={'revision': 1, 'capture': original, 'overrides': {'frame': 'worker/reference.png'}})
        self.assertEqual(response.status, 200, await response.text())
        project = await response.json()
        frame = project['document']['clips'][0]['inputValues']['frame']
        self.assertTrue(frame.startswith('spool-imported/'))
        response = await self.client.post('/spool/api/projects/' + self.project['id'] + '/handoffs', json={'revision': 2, 'clipId': 'shot', 'action': 'open', 'workflow': original['workflow']})
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual((await response.json())['payload']['workflow']['nodes'][0]['widgets_values'][0], frame)
        self.assertEqual(self.store.get(self.project['id'])['revision'], 2)

    async def test_bridge_preparation_and_missing_reference_do_not_edit_project(self):
        response = await self.client.post('/spool/api/prepare-workflow', json=capture(self.source))
        self.assertEqual(response.status, 200, await response.text())
        result = await response.json()
        self.assertEqual(result['inputRecovery']['recovered'][0]['sha256'], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.source.unlink()
        response = await self.client.post('/spool/api/prepare-workflow', json=capture(self.source))
        self.assertEqual(response.status, 400)
        self.assertIn('Reference file unavailable', (await response.json())['error'])
        self.assertEqual(self.store.get(self.project['id']), self.project)

    async def test_empty_source_can_open_through_bridge_or_handoff(self):
        graph = capture("", "")
        response = await self.client.post('/spool/api/prepare-workflow', json=graph)
        self.assertEqual(response.status, 200, await response.text())
        prepared = await response.json()
        self.assertEqual(prepared['prompt'], graph['prompt'])
        response = await self.client.post('/spool/api/projects/' + self.project['id'] + '/handoffs', json={
            'revision': 0, 'clipId': 'shot', 'action': 'open', 'workflow': graph['workflow'], 'prompt': graph['prompt']})
        self.assertEqual(response.status, 200, await response.text())
        payload = (await response.json())['payload']
        self.assertEqual(payload['workflow']['nodes'][0]['widgets_values'][0], '')
        self.assertEqual(payload['prompt']['114']['inputs']['image'], '')
        self.assertEqual(self.store.get(self.project['id']), self.project)

    async def test_cross_origin_request_does_not_copy_external_files(self):
        response = await self.client.post('/spool/api/prepare-workflow', json=capture(self.source), headers={'Origin': 'http://another-origin.invalid'})
        self.assertEqual(response.status, 403)
        self.assertFalse(list(self.input.rglob('*.png')))
        self.assertEqual(self.store.get(self.project['id']), self.project)


if __name__ == '__main__':
    unittest.main()
