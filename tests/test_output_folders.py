"""Output ownership uses portable new names without moving existing media."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from spool.projects import Workspace, folder_name
from spool.store import uid


class OutputFolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = Workspace(self.root / "app")

    def create(self, names):
        project = self.workspace.create(
            {
                "project": "Folder names",
                "clips": [{"id": str(i), "name": name, "takes": []} for i, name in enumerate(names)],
                "media": [],
            },
            self.root / "project",
        )
        return self.workspace.for_project(project["id"]), project

    def test_case_variants_and_duplicate_names_have_distinct_folders(self):
        store, project = self.create(["Intro", "intro", "INTRO", "Intro"])
        folders = [clip["outputFolder"] for clip in project["document"]["clips"]]
        self.assertEqual(folders[0], "output/Intro")
        self.assertEqual(len({folder.casefold() for folder in folders}), len(folders))
        self.assertTrue(all((store.root / folder).is_dir() for folder in folders))
        self.assertEqual(len(list((store.root / "output").iterdir())), len(folders))

    def test_allocating_a_new_clip_keeps_assigned_paths_and_retries_suffix_collisions(self):
        store, project = self.create(["Intro", "intro-aaaaaaaa"])
        before = [clip["outputFolder"] for clip in project["document"]["clips"]]
        document = copy.deepcopy(project["document"])
        document["clips"][0]["name"] = "Renamed"
        document["clips"].append({"id": "new", "name": "intro", "takes": []})
        allocated = iter(["aaaaaaaa-first", "bbbbbbbb-second"])
        with patch("spool.projects.uid", side_effect=lambda: next(allocated, uid())):
            saved = store.save(project["id"], project["revision"], document)
        folders = [clip["outputFolder"] for clip in saved["document"]["clips"]]
        self.assertEqual(folders[:2], before)
        self.assertEqual(folders[2], "output/intro-bbbbbbbb")

    def test_existing_shared_output_folders_are_preserved(self):
        store, project = self.create(["Original"])
        document = copy.deepcopy(project["document"])
        duplicate = copy.deepcopy(document["clips"][0])
        duplicate["id"] = "duplicate"
        document["clips"].append(duplicate)
        saved = store.save(project["id"], project["revision"], document)
        self.assertEqual([clip["outputFolder"] for clip in saved["document"]["clips"]], ["output/Original"] * 2)

    def test_truncation_cannot_leave_a_trailing_space_or_dot(self):
        for character in (" ", "."):
            with self.subTest(character=character):
                name = "a" * 99 + character + "discarded"
                self.assertEqual(folder_name(name), "a" * 99)

    def test_windows_console_device_names_are_portable(self):
        names = ["CONIN$", "conin$.png", "CONOUT$", "conout$.txt"]
        store, project = self.create(names)
        folders = [clip["outputFolder"] for clip in project["document"]["clips"]]
        self.assertEqual(folders[0], "output/Untitled")
        self.assertTrue(all(Path(folder).name.startswith("Untitled") for folder in folders))
        self.assertTrue(all((store.root / folder).is_dir() for folder in folders))


if __name__ == "__main__":
    unittest.main()
