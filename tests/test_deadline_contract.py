"""Tests the installed Submit node, stager and job files without submitting jobs."""
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import test_farm_protocol as fixtures

# These tests run the real ComfyUI-Deadline-Plugin checked out beside Spool.
PLUGIN = Path(__file__).resolve().parents[2] / "ComfyUI-Deadline-Plugin"
NO_PLUGIN = "needs ComfyUI-Deadline-Plugin checked out beside the Spool checkout"
if PLUGIN.is_dir():
    sys.path.insert(0, str(PLUGIN / "tests"))
    from test_reuse_endpoint import new_plugin, ComfyUIError


@unittest.skipUnless(PLUGIN.is_dir(), NO_PLUGIN)
class DeadlineContractTests(unittest.TestCase):
    setUp = fixtures.FarmProtocolTests.setUp
    tearDown = fixtures.FarmProtocolTests.tearDown
    accept = fixtures.FarmProtocolTests.accept
    package = fixtures.FarmProtocolTests.package
    def test_tagged_worker_preserves_frozen_deadline_seed_inputs(self):
        package = self.package(self.farm_attempts[0])
        for kind in ("DeadlineSeed", "DeadlineDistributedSeed", "DistributedSeed"):
            package["stagedPrompt"][kind] = {"class_type": kind, "inputs": {"seed": 144997952638744}}
        package["stagedPrompt"]["DistributedSeed"]["inputs"].update(task_id=7, batch_mode=True)
        worker = new_plugin(submission_id=package["submissionId"], input_manifest_file="",
                            GetPluginInfoEntryWithDefault=lambda key, default: "spool_request.json" if key == "SpoolRequestFile" else default,
                            GetJob=lambda: types.SimpleNamespace(JobId="owned-job"), GetCurrentTaskId=lambda: "0")
        prompt, metadata, _ = worker._prepare_variation_prompt(package["stagedPrompt"], 0)
        self.assertEqual(prompt, package["stagedPrompt"])
        self.assertEqual([s["actual_seed"] for s in metadata["seeds"]], [144997952638744] * 3)
        physical = fixtures.protocol.prepare_execution(package, prompt, self.media.host_roots["input"], 0)
        self.assertEqual(physical["prompt"]["DeadlineSeed"], package["stagedPrompt"]["DeadlineSeed"])
        with self.assertRaises(ComfyUIError):
            worker._prepare_variation_prompt(package["stagedPrompt"], 1)
        prompt["DeadlineSeed"]["inputs"]["seed"] += 1
        with self.assertRaisesRegex(ValueError, "Worker transformations"):
            fixtures.protocol.prepare_execution(package, prompt, self.media.host_roots["input"], 0)

    def test_ordinary_worker_keeps_variation_seed_behavior(self):
        worker = new_plugin(submission_id="ordinary", input_manifest_file="",
                            GetJob=lambda: types.SimpleNamespace(JobId="ordinary-job"), GetCurrentTaskId=lambda: "3")
        original = {"seed": {"class_type": "DeadlineSeed", "inputs": {"seed": 41, "task_id": 3, "batch_mode": True}}}
        prompt, metadata, _ = worker._prepare_variation_prompt(original, 2)
        self.assertEqual(prompt["seed"]["inputs"], {"seed": 43, "task_id": 0, "batch_mode": False})
        self.assertEqual(original["seed"]["inputs"]["seed"], 41)
        self.assertEqual(metadata["actual_seed"], 43)

    # Reuse media/project fixture, not inherited test methods.
    def test_submit_node_carries_one_take_and_durable_ack(self):
        namespace = types.ModuleType("deadline_contract_fixture")
        namespace.__path__ = [str(PLUGIN)]
        sys.modules[namespace.__name__] = namespace
        spec = importlib.util.spec_from_file_location(namespace.__name__ + ".deadline_submit", PLUGIN / "deadline_submit.py")
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        attempt = self.farm_attempts[0]
        package = self.package(attempt)
        package.pop("stagedPrompt")
        commands = []
        def command(args):
            commands.append(args)
            job_text = Path(args[0]).read_text()
            plugin_text = Path(args[1]).read_text()
            self.assertIn("Frames=0-0", job_text)
            self.assertIn("ChunkSize=1", job_text)
            self.assertIn("SpoolSubmissionId=" + package["submissionId"], job_text)
            self.assertIn("SpoolRequestFile=spool_request.json", plugin_text)
            aux = next(Path(p) for p in args[2:] if Path(p).name == "spool_request.json")
            staged = json.loads(aux.read_text())
            self.assertEqual(staged["takeId"], attempt["take_id"])
            self.assertNotIn("submit", staged["stagedPrompt"])
            return "JobID=owned-job"
        # Keep the installed node's output-root validation inside this fixture.
        folder_paths = types.ModuleType("folder_paths")
        folder_paths.get_output_directory = lambda: str(self.root / "farm")
        settings = {"output_roots": [str(self.root / "farm")], "input_roots": [str(self.media.host_roots["input"])], "drive_mappings": {}}
        with patch.dict(sys.modules, {"folder_paths": folder_paths}), patch.object(module.DeadlineCommandHelper, "get_farm_settings", return_value=settings), patch.object(module.InputAssetStager, "_get_local_input_directory", return_value=str(self.media.host_roots["input"])), patch.object(module.DeadlineCommandHelper, "call_deadline_command", side_effect=command):
            result = module.DeadlineSubmitNode().submit_to_deadline(str(self.root / "farm"), 1, 1, 50, "none", "none", "Contract", prompt=attempt["request"]["prompt"], extra_pnginfo={"spoolSubmission": package})
        self.assertEqual(result, ("owned-job",))
        ack = json.loads((self.root / "farm" / "spool-submissions" / package["submissionId"] / "ack.json").read_text())
        self.assertEqual(ack["jobId"], "owned-job")
        self.assertEqual(len(commands), 1)


if __name__ == "__main__":
    unittest.main()
