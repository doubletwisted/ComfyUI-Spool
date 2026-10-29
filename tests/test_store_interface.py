import re
import tempfile
import unittest
from pathlib import Path

from spool.store import Conflict, Store

SPOOL = Path(__file__).resolve().parent.parent / "spool"


class StoreInterfaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(Path(self.directory.name))
        self.project = self.store.create()

    def test_editing_saves_the_next_revision_with_its_event_and_setting(self):
        with self.store.editing(self.project["id"], self.project["revision"]) as edit:
            edit.document["brief"] = "Moonlit harbour"
            edit.save()
            edit.event("brief.changed", {"brief": "Moonlit harbour"})
            edit.setting("last-brief", "Moonlit harbour")
        saved = self.store.get(self.project["id"])
        self.assertEqual(
            (saved["revision"], saved["document"]["brief"]), (self.project["revision"] + 1, "Moonlit harbour")
        )
        self.assertEqual(self.store.setting("last-brief"), "Moonlit harbour")
        self.assertEqual(self.store.events(self.project["id"])["events"][-1]["kind"], "brief.changed")

    def test_a_stale_revision_changes_nothing(self):
        with self.assertRaisesRegex(Conflict, "Reload"):
            with self.store.editing(self.project["id"], self.project["revision"] + 1) as edit:
                edit.save()
        self.assertEqual(self.store.get(self.project["id"])["revision"], self.project["revision"])

    def test_a_failing_block_rolls_back_its_save(self):
        with self.assertRaises(RuntimeError):
            with self.store.editing(self.project["id"], self.project["revision"]) as edit:
                edit.document["brief"] = "Half written"
                edit.save()
                edit.setting("half", True)
                raise RuntimeError("publication failed")
        saved = self.store.get(self.project["id"])
        self.assertEqual(saved["revision"], self.project["revision"])
        self.assertNotEqual(saved["document"].get("brief"), "Half written")
        self.assertIsNone(self.store.setting("half"))

    def test_leaving_without_save_keeps_the_revision(self):
        with self.store.editing(self.project["id"], self.project["revision"]):
            pass
        self.assertEqual(self.store.get(self.project["id"])["revision"], self.project["revision"])

    def test_project_tables_stay_inside_the_storage_modules(self):
        # The Store's operations are its interface; launcher.py writes the machine's app settings.
        storage = {"store.py", "projects.py", "launcher.py"}
        for path in SPOOL.glob("*.py"):
            source = path.read_text(encoding="utf-8-sig")
            if path.name not in storage:
                self.assertNotRegex(source, r"\.execute\(", path.name)
            if path.name not in ("store.py", "projects.py"):  # projects.py is the project-folder Store
                self.assertIsNone(re.search(r"\._(write_document|event)\(", source), path.name)


if __name__ == "__main__":
    unittest.main()
