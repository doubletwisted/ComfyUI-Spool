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

    def test_authored_blob_marker_rejection_keeps_the_project_readable(self):
        for value in ({"__spool_blob__": "missing"}, [{"nested": {"__spool_blob__": "missing"}}]):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "evidence blob reference"):
                    with self.store.editing(self.project["id"], self.project["revision"]) as edit:
                        edit.document["brief"] = value
                        edit.save()
                self.assertEqual(self.store.get(self.project["id"]), self.project)

    def test_workflow_blob_marker_is_rejected_before_capture(self):
        with self.assertRaisesRegex(ValueError, "evidence blob reference"):
            self.store.create(
                {**self.project["document"], "importedWorkflows": [{"prompt": {"__spool_blob__": "missing"}}]}
            )
        self.assertEqual(self.store.get(self.project["id"]), self.project)

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


class RepeatedCaptureTests(unittest.TestCase):
    def test_repeated_workflow_assignment_does_not_wrap_stored_values_again(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        store = Store(Path(temp.name))
        graph = {"nodes": [{"id": 1, "type": "LoadImage"}], "links": []}
        project = store.create(
            {
                "project": "Captures",
                "clips": [{"id": "shot", "name": "Shot", "in": 0, "out": 24, "takes": []}],
                "media": [],
                "importedWorkflows": [{"id": "imported", "name": "Imported", "workflow": graph}],
            }
        )
        capture = {
            "workflow": {"nodes": []},
            "prompt": {
                "save": {"class_type": "SaveImage", "inputs": {"images": ["image", 0], "filename_prefix": "p"}},
                "image": {"class_type": "EmptyImage", "inputs": {"width": 64}},
            },
            "bindings": [],
            "result": {"nodeId": "save", "group": "images", "index": 0},
        }

        def blobs():
            with store.reading() as db:
                return db.execute("SELECT count(*) FROM blobs").fetchone()[0]

        revision = store.capture(project["id"], project["revision"], "shot", capture)["revision"]
        before = blobs()
        for _ in range(5):
            revision = store.capture(project["id"], revision, "shot", capture)["revision"]
        self.assertEqual(blobs(), before)
        self.assertEqual(store.get(project["id"])["document"]["importedWorkflows"][0]["workflow"], graph)


if __name__ == "__main__":
    unittest.main()
