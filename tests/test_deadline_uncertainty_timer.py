"""Deadline submission grace periods through dispatch and periodic collection."""

import asyncio
import copy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import attempts, farm_protocol
from spool.collection import Collector
from spool.execution import LocalExecutor
import test_queue_operations as fixtures


class Clock:
    def __init__(self, wall):
        self.wall, self.elapsed = wall, 1000

    def time(self):
        return self.wall

    def monotonic(self):
        return self.elapsed

    def advance(self, seconds):
        self.wall += seconds
        self.elapsed += seconds


class DeadlineUncertaintyTimerTests(unittest.TestCase):
    tearDown = fixtures.QueueOperationTests.tearDown
    accept = fixtures.QueueOperationTests.accept

    def setUp(self):
        fixtures.QueueOperationTests.setUp(self)
        recipe = copy.deepcopy(self.recipe)
        recipe["prompt"]["submit"] = {
            "class_type": "DeadlineSubmit",
            "inputs": {
                "batch_count": 1,
                "chunk_size": 1,
                "job_name": "Submission timing",
                "output_directory": str(self.root / "farm"),
            },
        }
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        self.items = [{"clipId": "shot", "count": 1}]
        self.attempt = self.store.attempt(self.accept()["document"]["jobs"][0]["id"])
        # The attempt waited an hour for an executor. Only farm's clocks are replaced.
        self.clock = Clock(self.attempt["created"] + 3600)
        clock = patch("spool.farm.time", self.clock)
        clock.start()
        self.addCleanup(clock.stop)
        observation = patch("spool.farm.deadline_command", return_value="JobStatus=Rendering")
        observation.start()
        self.addCleanup(observation.stop)
        self.collector = Collector(self.store, self.media)
        self.commands = []
        self.server = types.SimpleNamespace(
            number=0,
            trigger_on_prompt=lambda payload: payload,
            node_replace_manager=types.SimpleNamespace(apply_replacements=lambda prompt: None),
            prompt_queue=types.SimpleNamespace(get_current_queue=lambda: ([], [])),
        )

    def status(self):
        return self.store.attempt(self.attempt["id"])["status"]

    def scan_status(self, collector=None):
        (collector or self.collector).scan()
        return self.status()

    def directory(self):
        row = self.store.submission_for(self.attempt["id"])
        return self.root / "farm" / "spool-submissions" / row["id"]

    def dispatch(self, validation=None, staging=None, submitting=None):
        # Exercise the real executor, adapter, package/marker/ack writer and collector.
        # Only the optional installed plugin and its external Deadline call are doubled.
        module = types.ModuleType("deadline_uncertainty_fixture")
        node = type(
            "DeadlineSubmit",
            (),
            {
                "__module__": module.__name__,
                "_prepare_output_directory": lambda _self, root: root,
                "_rewrite_prompt_asset_references": lambda _self, worker, assets: None,
            },
        )

        def stage(worker):
            if staging:
                staging()
            return str(self.media.host_roots["input"]), "", {}

        def job_files(directory):
            job, plugin = Path(directory) / "job.info", Path(directory) / "plugin.info"
            job.write_text("", encoding="utf-8")
            plugin.write_text("", encoding="utf-8")
            return str(job), str(plugin), []

        def command(arguments):
            self.commands.append(arguments)
            if submitting:
                submitting()
            return "JobID=owned-job"

        module.WorkflowProcessor = types.SimpleNamespace(
            prepare_for_worker=lambda prompt: {k: copy.deepcopy(v) for k, v in prompt.items() if k != "submit"}
        )
        module.InputAssetStager = lambda *_: types.SimpleNamespace(stage_referenced_assets=stage)
        module.DeadlineJobSubmitter = lambda *_: types.SimpleNamespace(_create_submission_files=job_files)
        module.DeadlineCommandHelper = types.SimpleNamespace(
            call_deadline_command=command, get_job_id_from_submission=lambda result: "owned-job"
        )

        async def validate(identity, prompt, targets):
            if validation:
                validation()
            return True, None, ["submit"] if "submit" in prompt else ["save"], {}

        executor = LocalExecutor(self.store, self.media, self.server, validate)
        with patch.dict(
            sys.modules,
            {module.__name__: module, "nodes": types.SimpleNamespace(NODE_CLASS_MAPPINGS={"DeadlineSubmit": node})},
        ):
            asyncio.run(executor.dispatch(self.attempt))
        return executor

    def test_old_queued_attempt_keeps_its_dispatch_claim_during_host_validation(self):
        statuses = []

        def validate():
            statuses.append(self.scan_status())
            self.clock.advance(120)
            statuses.append(self.scan_status())

        self.dispatch(validation=validate)
        self.assertTrue(statuses)
        self.assertEqual(set(statuses), {attempts.DISPATCHING})
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.status(), attempts.FARM_QUEUED)

    def test_slow_asset_staging_does_not_spend_submission_grace(self):
        statuses = []

        def stage():
            statuses.append(self.scan_status())
            self.clock.advance(120)
            statuses.append(self.scan_status())

        self.dispatch(staging=stage)
        self.assertEqual(statuses, [attempts.SUBMITTING, attempts.SUBMITTING])
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.status(), attempts.FARM_QUEUED)

    def test_package_before_submission_marker_does_not_start_grace(self):
        statuses = []
        write = farm_protocol.atomic_json

        def pause_before_marker(path, value):
            write(path, value)
            if path.name == "request.json":
                statuses.append(self.scan_status())
                self.clock.advance(120)
                statuses.append(self.scan_status())

        with patch("spool.deadline_job.farm_protocol.atomic_json", side_effect=pause_before_marker):
            self.dispatch()
        self.assertEqual(statuses, [attempts.SUBMITTING, attempts.SUBMITTING])
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.status(), attempts.FARM_QUEUED)

    def test_missing_response_gets_grace_then_uncertainty_without_resubmission(self):
        statuses = []

        def submit():
            statuses.append(self.scan_status())
            self.clock.advance(29)
            statuses.append(self.scan_status())
            self.clock.advance(2)
            statuses.append(self.scan_status())

        executor = self.dispatch(submitting=submit)
        self.assertEqual(statuses, [attempts.SUBMITTING, attempts.SUBMITTING, attempts.SUBMISSION_UNCERTAIN])
        with patch("spool.execution_targets.deadline_job.submit") as resubmit:
            asyncio.run(executor.reconcile())
            restarted = LocalExecutor(self.store, self.media, self.server, executor.validate)
            asyncio.run(restarted.dispatch(self.store.attempt(self.attempt["id"])))
            resubmit.assert_not_called()
        self.assertEqual(len(self.commands), 1)
        self.assertEqual(self.scan_status(), attempts.FARM_RUNNING)

    def test_acknowledgment_releases_active_timer(self):
        def submit():
            self.scan_status()

        self.dispatch(submitting=submit)
        farm = next(iter(self.collector.farms.values()))
        self.assertEqual(len(farm.submitting_at), 1)
        self.assertEqual(self.scan_status(), attempts.FARM_RUNNING)
        self.assertEqual(farm.submitting_at, {})

    def test_settled_history_observation_releases_active_timer(self):
        counts = []

        def submit():
            self.scan_status()
            farm = next(iter(self.collector.farms.values()))
            counts.append(len(farm.submitting_at))
            self.store.transition(self.attempt["id"], attempts.FAILED)
            self.collector.history_checked.clear()
            self.scan_status()
            counts.append(len(farm.submitting_at))

        self.dispatch(submitting=submit)
        self.assertEqual(counts, [1, 0])
        self.assertEqual(self.status(), attempts.FAILED)

    def test_restart_grants_fresh_grace_and_remembers_missing_marker(self):
        statuses = []

        def submit():
            statuses.append(self.scan_status())
            self.clock.advance(29)
            restarted = Collector(self.store, self.media)
            statuses.append(self.scan_status(restarted))
            # A temporarily lost share package must not reset evidence already observed.
            (self.directory() / "request.json").unlink()
            (self.directory() / "submitting.json").unlink()
            self.clock.advance(29)
            statuses.append(self.scan_status(restarted))
            self.clock.advance(2)
            statuses.append(self.scan_status(restarted))

        self.dispatch(submitting=submit)
        self.assertEqual(
            statuses,
            [attempts.SUBMITTING, attempts.SUBMITTING, attempts.SUBMITTING, attempts.SUBMISSION_UNCERTAIN],
        )
        self.assertEqual(len(self.commands), 1)


if __name__ == "__main__":
    unittest.main()
