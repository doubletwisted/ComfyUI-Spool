"""Projects on Windows network paths, reached through this computer's administrative share.

Real projects usually live on SMB shares (\\\\server\\share\\...). Paths there differ from
drive paths in ways local tests never see, such as SQLite URIs with a host. These tests
open projects through \\\\localhost\\<drive>$ so the gate exercises the same path forms.
"""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from spool.projects import Workspace
from spool.store import SCHEMA_VERSION

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "project-schema5.spool"


def network_path(local):
    local = Path(local).resolve()
    return Path("\\\\localhost\\" + local.drive.rstrip(":") + "$" + str(local)[len(local.drive) :])


@unittest.skipUnless(os.name == "nt", "UNC paths are a Windows path form")
class UncProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        if not network_path(self.root).is_dir():
            self.skipTest("This computer's administrative share is not reachable")
        self.workspace = Workspace(self.root / "workspace")

    def tearDown(self):
        self.temp.cleanup()

    def test_a_project_created_on_a_network_path_saves_and_reopens(self):
        folder = network_path(self.root / "Shot #1 50% done")
        project = self.workspace.create({"project": "UNC", "clips": []}, folder=folder)
        store = self.workspace.for_project(project["id"])
        saved = store.save(project["id"], project["revision"], {**project["document"], "project": "Renamed"})
        reopened = Workspace(self.root / "other-workspace").open_folder(folder)
        self.assertEqual(reopened["revision"], saved["revision"])
        self.assertEqual(reopened["document"]["project"], "Renamed")

    def test_an_older_project_on_a_network_path_upgrades_with_a_backup(self):
        local = self.root / "older"
        local.mkdir()
        shutil.copyfile(FIXTURE, local / "project.spool")
        project = self.workspace.open_folder(network_path(local))
        self.assertTrue(project["document"]["clips"])
        manifest = json.loads((local / "project.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["formatVersion"], SCHEMA_VERSION)
        self.assertTrue(any((local / ".spool" / "backups").glob("project-schema5-*.spool")))


if __name__ == "__main__":
    unittest.main()
