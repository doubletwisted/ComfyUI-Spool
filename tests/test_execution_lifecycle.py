"""Execution ownership and interleavings across shared-project workspaces."""

import asyncio
import unittest
from types import SimpleNamespace

from spool import requests
from spool.execution import LocalExecutor
from spool.media import Media
from spool.projects import Workspace
import test_project_folders as fixtures


class ExecutionLifecycleTests(unittest.TestCase):
    setUp = fixtures.ProjectFolderTests.setUp
    tearDown = fixtures.ProjectFolderTests.tearDown

    def executor(self, workspace, media):
        queue = SimpleNamespace(get_history=lambda prompt_id: {}, get_current_queue=lambda: ([], []))
        return LocalExecutor(workspace, media, SimpleNamespace(prompt_queue=queue), None)

    def test_only_claiming_workspace_infers_loss_even_after_restart(self):
        project = requests.accept(
            self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}]
        )
        identity = project["document"]["jobs"][0]["id"]
        first = self.executor(self.workspace, self.base_media)
        self.assertTrue(self.store.claim(identity, first.session_id))
        self.store.transition(identity, "queued")
        other_workspace = Workspace(self.root / "other-app")
        other_workspace.open_folder(self.store.root)
        other_media = Media(other_workspace.root, *self.roots)
        other = self.executor(other_workspace, other_media)
        asyncio.run(other.reconcile())
        self.assertEqual(self.store.attempt(identity)["status"], "queued")
        restarted = self.executor(self.workspace, self.base_media)
        self.assertNotEqual(first.session_id, restarted.session_id)
        asyncio.run(restarted.reconcile())
        self.assertEqual(self.store.attempt(identity)["status"], "uncertain")

    def test_legacy_claim_does_not_prove_ownership(self):
        project = requests.accept(
            self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}]
        )
        identity = project["document"]["jobs"][0]["id"]
        self.store.claim(identity, "legacy-process-id")
        asyncio.run(self.executor(self.workspace, self.base_media).reconcile())
        self.assertEqual(self.store.attempt(identity)["status"], "dispatching")
