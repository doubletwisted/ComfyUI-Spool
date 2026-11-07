"""Deadline recovery lookup failures are service errors, not generic Spool bugs."""

import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool import attempts, commands, requests
from spool.errors import Unavailable
from spool.execution_targets import DEADLINE_LOOKUP_UNAVAILABLE, adapter_for
from spool.media import Media
from spool.projects import Workspace
from spool.routes import register
from spool.store import Conflict, Store, empty_project

JOB = "a" * 24
SECRET = "deadlinecommand failed: C:\\private\\agent\\stderr token=secret"


def deadline_recipe(output):
    return {
        "prompt": {
            "save": {"class_type": "SaveImage", "inputs": {"images": [], "filename_prefix": "ordinary"}},
            "submit": {
                "class_type": "DeadlineSubmit",
                "inputs": {"batch_count": 1, "chunk_size": 1, "output_directory": str(output)},
            },
        },
        "bindings": [],
        "result": {"nodeId": "save", "group": "images", "index": 0},
    }


def deadline_document():
    document = empty_project()
    document["clips"] = [{"id": "shot", "name": "Shot", "revision": 1, "takes": [], "takeId": "original"}]
    return document


def assert_safe_unavailable(test, error):
    message = str(error)
    test.assertIsInstance(error, Unavailable)
    test.assertEqual((error.status, error.code), (503, "unavailable"))
    test.assertEqual(message, DEADLINE_LOOKUP_UNAVAILABLE)
    test.assertIn("Retry submission recovery", message)
    test.assertNotIn("secret", message)
    test.assertNotIn("stderr", message)
    test.assertNotIn("C:\\", message)


class DeadlineRecoveryLookupTests(unittest.TestCase):
    def setUp(self):
        self.adapter = adapter_for({"target": "deadline"})
        self.attempt = {"id": "attempt", "status": attempts.WAITING, "request": {"target": "deadline"}}
        self.submission = {"id": "submission", "external_id": None}

    def recover(self):
        return self.adapter.recover(self.attempt, {"submission": self.submission})

    def test_failed_find_lookup_is_unavailable_with_safe_message_and_cause(self):
        for error in (
            RuntimeError(SECRET),
            OSError(SECRET),
            subprocess.TimeoutExpired(["deadlinecommand"], 30),
        ):
            with self.subTest(error=type(error).__name__):
                with patch("spool.farm.deadline_command", side_effect=error):
                    with self.assertRaises(Unavailable) as caught:
                        self.recover()
                self.assertIs(caught.exception.__cause__, error)
                assert_safe_unavailable(self, caught.exception)

    def test_failed_identity_lookup_is_unavailable_with_safe_message_and_cause(self):
        error = RuntimeError(SECRET)
        with patch("spool.farm.deadline_command", side_effect=[JOB, error]) as external:
            with self.assertRaises(Unavailable) as caught:
                self.recover()
        self.assertIs(caught.exception.__cause__, error)
        assert_safe_unavailable(self, caught.exception)
        self.assertEqual(external.call_args_list[0].args[0], ["-GetJobIdsFilter", "ExtraInfo0=spool:submission"])
        self.assertEqual(
            external.call_args_list[1].args[0],
            ["-GetJobExtraInfoKeyValue", JOB, "SpoolSubmissionId"],
        )

    def test_matching_job_is_returned(self):
        with patch("spool.farm.deadline_command", side_effect=[JOB, "submission", "attempt"]):
            self.assertEqual(self.recover(), {"jobId": JOB})

    def test_no_match_is_not_a_failure(self):
        with patch("spool.farm.deadline_command", return_value="") as external:
            self.assertEqual(self.recover(), {"jobId": None})
        self.assertEqual(external.call_count, 1)

    def test_multiple_matches_are_a_conflict_not_unavailable(self):
        with patch("spool.farm.deadline_command", return_value=JOB + "\n" + "b" * 24) as external:
            with self.assertRaises(Conflict) as caught:
                self.recover()
        self.assertNotIsInstance(caught.exception, Unavailable)
        self.assertIn("Multiple jobs match", str(caught.exception))
        self.assertEqual(external.call_count, 1)

    def test_mismatched_job_ownership_is_invalid_not_unavailable(self):
        for values in (["other-submission"], ["submission", "other-attempt"]):
            with self.subTest(values=values):
                with patch("spool.farm.deadline_command", side_effect=[JOB, *values]):
                    with self.assertRaises(ValueError) as caught:
                        self.recover()
                self.assertNotIsInstance(caught.exception, Unavailable)
                self.assertIn("identity failed ownership verification", str(caught.exception))

    def test_missing_submission_is_invalid_not_unavailable(self):
        with self.assertRaisesRegex(ValueError, "no Deadline submission"):
            self.adapter.recover(self.attempt, {})

    def test_a_failed_lookup_can_be_retried(self):
        with patch("spool.farm.deadline_command", side_effect=RuntimeError(SECRET)):
            with self.assertRaises(Unavailable):
                self.recover()
        with patch("spool.farm.deadline_command", side_effect=[JOB, "submission", "attempt"]):
            self.assertEqual(self.recover(), {"jobId": JOB})


class DeadlineRecoveryCommandTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        for kind in ("input", "output", "temp"):
            (root / kind).mkdir()
        self.store = Store(root / "store")
        self.media = Media(self.store.root, root / "input", root / "output", root / "temp")
        self.project = self.store.create(deadline_document())
        self.project = self.store.capture(
            self.project["id"], self.project["revision"], "shot", deadline_recipe(root / "farm")
        )
        self.project = requests.accept(
            self.store,
            self.media,
            self.project["id"],
            self.project["revision"],
            [{"clipId": "shot", "count": 1}],
            "queue",
        )
        self.attempt = self.store.attempt(self.project["document"]["jobs"][0]["id"])
        self.submission = self.store.submission(self.attempt["id"], {})
        self.envelope = {
            "operationId": "recover-1",
            "revision": self.project["revision"],
            "actor": "agent:test",
            "scope": {"projectId": self.project["id"], "clipIds": ["shot"], "capabilities": ["recover"]},
            "action": "recover_submission",
            "arguments": {"attemptId": self.attempt["id"]},
        }

    def execute(self, **changes):
        return commands.execute(self.store, self.media, self.project["id"], {**self.envelope, **changes})

    def assert_untouched(self):
        self.assertIsNone(self.store.operation(self.envelope["operationId"], self.project["id"], self.envelope))
        self.assertIsNone(self.store.submission_for(self.attempt["id"])["external_id"])
        self.assertEqual(self.store.attempt(self.attempt["id"])["status"], attempts.WAITING)

    def test_failed_find_lookup_returns_unavailable_and_records_nothing(self):
        error = RuntimeError(SECRET)
        with patch("spool.farm.deadline_command", side_effect=error) as external:
            with self.assertRaises(Unavailable) as caught:
                self.execute()
        self.assertIs(caught.exception.__cause__, error)
        assert_safe_unavailable(self, caught.exception)
        self.assertEqual(external.call_count, 1)
        self.assertEqual(external.call_args.args[0], ["-GetJobIdsFilter", "ExtraInfo0=spool:" + self.submission["id"]])
        self.assert_untouched()

    def test_failed_identity_lookup_returns_unavailable_and_records_nothing(self):
        error = RuntimeError(SECRET)
        with patch("spool.farm.deadline_command", side_effect=[JOB, error]) as external:
            with self.assertRaises(Unavailable) as caught:
                self.execute()
        self.assertIs(caught.exception.__cause__, error)
        assert_safe_unavailable(self, caught.exception)
        self.assertEqual(external.call_count, 2)
        self.assert_untouched()

    def test_retry_after_a_failed_lookup_adopts_the_same_submission(self):
        with patch("spool.farm.deadline_command", side_effect=RuntimeError(SECRET)):
            with self.assertRaises(Unavailable):
                self.execute()
        with patch("spool.farm.deadline_command", side_effect=[JOB, self.submission["id"], self.attempt["id"]]):
            result = self.execute()
        self.assertEqual(
            (result["attemptId"], result["jobId"], result["status"], result["note"]),
            (self.attempt["id"], JOB, "adopted", "No automatic resubmission"),
        )
        self.assertEqual(self.store.submission_for(self.attempt["id"])["external_id"], JOB)
        self.assertIsNotNone(self.store.operation(self.envelope["operationId"], self.project["id"], self.envelope))

    def test_no_match_remains_submission_uncertain(self):
        with patch("spool.farm.deadline_command", return_value=""):
            result = self.execute()
        self.assertEqual((result["jobId"], result["status"]), (None, "submission_uncertain"))
        self.assertIsNone(self.store.submission_for(self.attempt["id"])["external_id"])

    def test_multiple_matches_are_a_conflict_not_service_unavailable(self):
        with patch("spool.farm.deadline_command", return_value=JOB + "\n" + "b" * 24):
            with self.assertRaises(Conflict) as caught:
                self.execute(operationId="recover-conflict")
        self.assertNotIsInstance(caught.exception, Unavailable)
        self.assertIsNone(
            self.store.operation(
                "recover-conflict", self.project["id"], {**self.envelope, "operationId": "recover-conflict"}
            )
        )
        self.assertIsNone(self.store.submission_for(self.attempt["id"])["external_id"])

    def test_ownership_mismatch_is_invalid_not_service_unavailable(self):
        with patch("spool.farm.deadline_command", side_effect=[JOB, "other-submission"]):
            with self.assertRaises(ValueError) as caught:
                self.execute(operationId="recover-ownership")
        self.assertNotIsInstance(caught.exception, Unavailable)
        self.assertIsNone(
            self.store.operation(
                "recover-ownership", self.project["id"], {**self.envelope, "operationId": "recover-ownership"}
            )
        )
        self.assertIsNone(self.store.submission_for(self.attempt["id"])["external_id"])


class DeadlineRecoveryHttpTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        for kind in ("input", "output", "temp"):
            (root / kind).mkdir()
        self.workspace = Workspace(root / "app")
        project = self.workspace.create(deadline_document())
        self.store = self.workspace.for_project(project["id"])
        media = Media(self.workspace.root, root / "input", root / "output", root / "temp")
        project = self.store.capture(project["id"], project["revision"], "shot", deadline_recipe(root / "farm"))
        project = requests.accept(
            self.store, media, project["id"], project["revision"], [{"clipId": "shot", "count": 1}], "queue"
        )
        self.project = project
        self.attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        self.submission = self.store.submission(self.attempt["id"], {})
        self.base = "/spool/api/projects/" + project["id"]
        self.envelope = {
            "operationId": "recover-http",
            "revision": project["revision"],
            "actor": "agent:test",
            "scope": {"projectId": project["id"], "clipIds": ["shot"], "capabilities": ["recover"]},
            "action": "recover_submission",
            "arguments": {"attemptId": self.attempt["id"]},
        }
        self.server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(self.server, self.workspace, media)
        self.server.app.cleanup_ctx.clear()
        self.server.app.add_routes(self.server.routes)

    async def asyncSetUp(self):
        self.client = TestClient(TestServer(self.server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def post_recovery(self):
        return await self.client.post(self.base + "/commands", json=self.envelope)

    async def test_lookup_failure_is_a_503_without_mutating_or_resubmitting(self):
        with patch("spool.farm.deadline_command", side_effect=RuntimeError(SECRET)) as external:
            response = await self.post_recovery()
        value = await response.json()
        self.assertEqual(response.status, 503)
        self.assertEqual(value["code"], "unavailable")
        self.assertEqual(value["error"], DEADLINE_LOOKUP_UNAVAILABLE)
        self.assertNotIn("secret", value["error"])
        self.assertEqual(external.call_count, 1)
        self.assertIsNone(self.store.operation(self.envelope["operationId"], self.project["id"], self.envelope))
        self.assertIsNone(self.store.submission_for(self.attempt["id"])["external_id"])
        self.assertEqual(self.store.attempt(self.attempt["id"])["status"], attempts.WAITING)

    async def test_retry_after_a_503_adopts_the_job(self):
        with patch("spool.farm.deadline_command", side_effect=RuntimeError(SECRET)):
            self.assertEqual((await self.post_recovery()).status, 503)
        with patch("spool.farm.deadline_command", side_effect=[JOB, self.submission["id"], self.attempt["id"]]):
            response = await self.post_recovery()
        value = await response.json()
        self.assertEqual((response.status, value["status"], value["jobId"]), (200, "adopted", JOB))
        self.assertEqual(self.store.submission_for(self.attempt["id"])["external_id"], JOB)


if __name__ == "__main__":
    unittest.main()
