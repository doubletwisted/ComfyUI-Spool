"""Adapter decisions need target I/O, not access to a project store."""

import asyncio
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from spool import attempts
from spool.execution_targets import adapter_for


class ExecutionAdapterTests(unittest.TestCase):
    def test_prepare_keeps_the_frozen_request_and_returns_target_checks(self):
        request = {
            "target": "deadline",
            "projectId": "project",
            "clipId": "clip",
            "takeId": "take",
            "attemptId": "attempt",
            "fingerprint": "frozen",
            "assets": [],
            "launcherNodeId": "submit",
            "prompt": {"submit": {"inputs": {"output_directory": "farm"}}, "save": {"inputs": {}}},
            "capture": {"result": {"nodeId": "save"}, "resultOnly": True},
        }
        attempt = {"id": "attempt", "take_id": "take", "prompt_id": "prompt", "request": request}
        original = copy.deepcopy(request)
        for target in ("local", "deadline"):
            request["target"] = target
            adapter = adapter_for(request)
            prepared = adapter.prepare(attempt, {})
            prepared["payload"]["prompt"]["save"]["inputs"]["hook"] = True
            self.assertNotIn("hook", request["prompt"]["save"]["inputs"])
            self.assertEqual(prepared["output"], "submit" if target == "deadline" else "save")
            self.assertEqual(prepared["resultOnly"], target == "local")
        request["target"] = "deadline"
        self.assertEqual(request, original)

    def test_cloud_recovery_never_treats_lost_acknowledgment_as_new_work(self):
        adapter = adapter_for({"target": "cloud"})
        for status in attempts.PENDING:
            result = adapter.recover({"status": status}, {"state": None})
            self.assertEqual(result.get("observe", False), status in {attempts.INTENT, attempts.WAITING})
        result = adapter.recover({"status": attempts.QUEUED}, {"state": {"jobId": "known"}})
        self.assertTrue(result["observe"])

    def test_deadline_cancel_plan_requires_the_checked_job_identity(self):
        adapter = adapter_for({"target": "deadline"})
        attempt = {"id": "attempt", "status": attempts.FARM_RUNNING}
        context = {
            "stage": "plan",
            "submission": {"id": "owned", "external_id": "job"},
            "done": False,
            "delivery": ("owned", "another-job"),
        }
        with patch("spool.farm.deadline_command") as external:
            with self.assertRaisesRegex(ValueError, "changed during cancellation"):
                asyncio.run(adapter.cancel(attempt, context))
            external.assert_not_called()
            context["delivery"] = ("owned", "job")
            result = asyncio.run(adapter.cancel(attempt, context))
            self.assertTrue(result["claim"])
            self.assertEqual(result["status"], attempts.CANCEL_REQUESTED)
            external.assert_not_called()

    def test_cloud_cancel_preserves_terminal_jobs_and_sends_only_once(self):
        adapter = adapter_for({"target": "cloud"})
        for status, sent in (("succeeded", False), ("running", True)):
            job = SimpleNamespace(status=status, cancel=AsyncMock(return_value="cancelled-job"))
            result = asyncio.run(adapter.cancel({}, {"stage": "send", "job": job, "state": {}}))
            self.assertEqual(result["sent"], sent)
            self.assertEqual(job.cancel.await_count, int(sent))
        job = SimpleNamespace(status="running", cancel=AsyncMock())
        result = asyncio.run(adapter.cancel({}, {"stage": "send", "job": job, "state": {"cancelSent": True}}))
        self.assertFalse(result["sent"])
        job.cancel.assert_not_called()
