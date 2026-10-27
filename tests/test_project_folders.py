"""Project folder durability, portable inputs, discovery and exact receipt collection."""
import asyncio
import copy
import gzip
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool import commands, farm_protocol, receipts, requests, sidecars, take_files, ledger
from spool.wire import unwire, wire
from spool.collection import Collector
from spool.execution import LocalExecutor
from spool.folder_takes import FolderTakes
from spool.media import Media
from spool.projects import Workspace
from spool.routes import register
from spool.store import Conflict, Store


class ProjectFolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.workspace = Workspace(self.root / "app")
        self.roots = [self.root / kind for kind in ("input", "output", "temp")]
        for path in self.roots:
            path.mkdir()
        Image.new("RGB", (16, 16), "red").save(self.roots[0] / "frame.png")
        self.workspace.publish_host({"roots": dict(zip(("input", "output", "temp"), map(str, self.roots)))}, "test")
        self.base_media = Media(self.workspace.root, *self.roots)
        self.project = self.workspace.create({"project": "Shot project", "clips": [{"id": "clip-a", "name": "Desert walk", "in": 0, "out": 24,
            "takeId": "original", "takes": [{"id": "original", "number": 1, "media": {"id": "original-media", "kind": "image", "file": "assets/black.png", "frames": 120}}]}], "media": []}, self.root / "projects" / "Shot project")
        self.store = self.workspace.for_project(self.project["id"])
        self.media = self.base_media.for_project(self.store, self.project["id"])
        self.capture = {"workflow": {"nodes": []}, "prompt": {"load": {"class_type": "LoadImage", "inputs": {"image": "frame.png"}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "ordinary"}}},
            "bindings": [{"key": "image", "nodeId": "load", "input": "image", "asset": True, "slot": "firstFrame"}],
            "result": {"nodeId": "save", "group": "images", "index": 0}}
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", self.media.prepare_workflow(self.capture, True))

    def test_queue_clearing_is_durable_without_removing_takes_or_executions(self):
        self.project = requests.accept(self.store, self.media, self.project['id'], self.project['revision'], [{'clipId': 'clip-a', 'count': 1}])
        attempt_id = self.project['document']['jobs'][0]['id']
        self.store.transition(attempt_id, 'failed', error='Render failed')
        execution = self.store.attempt(attempt_id)
        original = copy.deepcopy(self.project['document']['clips'])
        self.project['document']['clearedRenderIds'] = [attempt_id]
        saved = self.store.save(self.project['id'], self.project['revision'], self.project['document'])
        old_editor = copy.deepcopy(saved['document'])
        old_editor.pop('clearedRenderIds')
        self.store.save(saved['id'], saved['revision'], old_editor)
        reopened = Workspace(self.workspace.root).for_project(saved['id']).get(saved['id'])
        self.assertEqual(reopened['document']['clearedRenderIds'], [attempt_id])
        self.assertEqual(reopened['document']['clips'], original)
        self.assertEqual(reopened['document']['jobs'][0]['status'], 'failed')
        self.assertEqual(self.store.attempt(attempt_id), execution)

    def tearDown(self):
        self.temp.cleanup()

    def test_project_file_contains_all_edit_data_and_machine_store_contains_none(self):
        self.assertTrue((self.store.root / "project.spool").is_file())
        self.assertFalse((self.store.root / "project.spool-wal").exists())
        with self.workspace.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM projects").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM workflows").fetchone()[0], 0)
        other = Workspace(self.root / "another-computer")
        reopened = other.open_folder(self.store.root)
        self.assertEqual(reopened["document"], self.project["document"])
        self.assertEqual(reopened["recipes"], self.project["recipes"])
        self.assertEqual(other.for_project(reopened["id"]).path.name, "project.spool")

    def test_two_working_caches_refresh_and_reject_stale_save(self):
        other = Workspace(self.root / "another-computer")
        opened = other.open_folder(self.store.root)
        document = copy.deepcopy(self.project["document"])
        document["project"] = "Renamed"
        self.store.save(self.project["id"], self.project["revision"], document)
        self.assertEqual(other.get(opened["id"])["document"]["project"], "Renamed")
        with self.assertRaises(Conflict):
            other.for_project(opened["id"]).save(opened["id"], opened["revision"], opened["document"])

    def test_focus_is_shared_by_local_views_without_publishing_the_project(self):
        project_id = self.project['id']
        signature = self.store.signature()
        with patch.object(self.store, 'get', side_effect=AssertionError('Focus must not load workflows or takes')), patch('spool.projects.atomic_replace', side_effect=AssertionError('Focus must not publish a project snapshot')):
            self.store.publish_focus(project_id, 'dock', {'clipId': 'clip-a', 'frame': 7})
            self.assertEqual(self.store.focused(project_id, 'dock')['frame'], 7)
            self.store.publish_focus(project_id, 'editor', {'clipId': 'clip-a', 'frame': 12})
            with self.assertRaises(Conflict):
                self.store.focused(project_id)
            with self.assertRaises(ValueError):
                self.store.publish_focus(project_id, 'missing', {'clipId': 'removed-clip'})
            with self.assertRaises(KeyError):
                self.store.publish_focus('missing-project', 'dock', {})
        self.assertEqual(self.store.signature(), signature)
        other_view = Workspace(self.workspace.root)
        reopened = other_view.open_folder(self.store.root)
        self.assertEqual(other_view.for_project(reopened['id']).focused(project_id, 'editor')['frame'], 12)
        other_machine = Workspace(self.root / 'another-computer')
        reopened = other_machine.open_folder(self.store.root)
        with self.assertRaises(Conflict):
            other_machine.for_project(reopened['id']).focused(project_id, 'editor')
        with self.workspace.connect() as db:
            db.execute('UPDATE focus SET updated=0')
        with self.assertRaises(Conflict):
            self.store.focused(project_id, 'dock')

    def test_failed_publication_restores_last_acknowledged_document(self):
        document = copy.deepcopy(self.project["document"])
        document["project"] = "Must not survive"
        original = Path.replace
        def replace(path, target):
            if Path(target) == self.store.snapshot:
                raise OSError("Share disconnected")
            return original(path, target)
        with patch.object(Path, "replace", replace):
            with self.assertRaises(OSError):
                self.store.save(self.project["id"], self.project["revision"], document)
        self.assertEqual(self.store.get(self.project["id"])["document"]["project"], "Shot project")

    def test_rejected_import_removes_only_its_owned_folder_and_never_registers_it(self):
        parent = self.root / "import-projects"
        existing = parent / "Untitled Spool project"
        existing.mkdir(parents=True)
        sentinel = existing / "keep.png"
        sentinel.write_bytes(b"existing media")
        self.workspace.set_setting("projects_directory", str(parent))
        folders = self.workspace.folders()
        snapshot = self.store.snapshot.read_bytes()
        exported = self.store.export_project(self.project["id"])
        invalid_recipe = copy.deepcopy(exported)
        version = invalid_recipe["document"]["clips"][0]["workflowVersion"]
        invalid_recipe["recipes"][version]["prompt"] = {}
        invalid_folder = copy.deepcopy(exported)
        # The first clip creates its output directory before the second is rejected.
        invalid_folder["document"]["clips"].append({"id": "escape", "name": "Escape", "takes": [], "outputFolder": str(existing)})
        invalid_document = copy.deepcopy(exported)
        invalid_document["document"]["invalidNumber"] = float("inf")
        for failure, value in (("recipe", invalid_recipe), ("folder", invalid_folder), ("document", invalid_document)):
            with self.subTest(failure=failure):
                original = copy.deepcopy(value)
                with self.assertRaises(ValueError):
                    self.workspace.import_project(value)
                self.assertEqual(value, original)
                self.assertEqual(self.workspace.folders(), folders)
                self.assertEqual(set(self.workspace.opened), {self.project["id"]})
                self.assertEqual(list(parent.iterdir()), [existing])
                self.assertEqual(sentinel.read_bytes(), b"existing media")
                self.assertEqual(self.store.snapshot.read_bytes(), snapshot)
                self.assertEqual(Workspace(self.workspace.root).get(self.project["id"]), self.project)

    def test_failed_import_publication_or_registration_removes_the_destination(self):
        parent = self.root / "imports"
        self.workspace.set_setting("projects_directory", str(parent))
        exported = self.store.export_project(self.project["id"])
        folders = self.workspace.folders()
        replace = Path.replace
        publications = []
        def disconnected(path, target):
            if Path(target).name == "project.spool":
                publications.append(Path(target))
                if len(publications) == 2:
                    raise OSError("Import publication disconnected")
            return replace(path, target)
        with patch.object(Path, "replace", disconnected):
            with self.assertRaisesRegex(OSError, "Import publication disconnected"):
                self.workspace.import_project(exported)
        self.assertEqual(len(publications), 2, "Fail the imported document, after schema initialization")
        self.assertEqual(list(parent.iterdir()), [])
        self.assertEqual(self.workspace.folders(), folders)
        with patch.object(self.workspace, "set_setting", side_effect=OSError("Registry unavailable")):
            with self.assertRaisesRegex(OSError, "Registry unavailable"):
                self.workspace.import_project(exported)
        self.assertEqual(list(parent.iterdir()), [])
        self.assertEqual(Workspace(self.workspace.root).folders(), folders)
        self.assertEqual(set(self.workspace.opened), {self.project["id"]})
        self.assertEqual(self.store.get(self.project["id"]), self.project)

    def test_import_registers_only_a_durable_complete_project(self):
        exported = self.store.export_project(self.project["id"])
        original = copy.deepcopy(exported)
        set_setting = self.workspace.set_setting
        checked = []
        def register(key, value):
            if key == "project_folders":
                new = value[-1]
                reader = Workspace(self.root / "import-reader")
                durable = reader.open_folder(new["folder"])
                self.assertEqual(durable["id"], new["id"])
                clip = durable["document"]["clips"][0]
                self.assertIn(clip["workflowVersion"], durable["recipes"])
                self.assertEqual(clip["takeId"], "original")
                checked.append(durable)
            return set_setting(key, value)
        with patch.object(self.workspace, "set_setting", register):
            imported = self.workspace.import_project(exported)
        self.assertEqual(checked, [imported])
        self.assertNotEqual(imported["id"], self.project["id"])
        self.assertEqual(exported, original)
        self.assertEqual(len(self.workspace.list()), 2)
        self.assertEqual(Workspace(self.workspace.root).get(imported["id"]), imported)
        self.assertEqual(self.store.get(self.project["id"]), self.project)

    def input_command(self, action, arguments, identity="input-edit"):
        return {"operationId": identity, "revision": self.project["revision"], "actor": "agent:test",
                "scope": {"projectId": self.project["id"], "clipIds": ["clip-a"], "capabilities": ["inputs"]},
                "action": action, "arguments": {"clipId": "clip-a", **arguments}}

    def test_input_actions_use_the_project_transaction_and_survive_reopen(self):
        recipe = copy.deepcopy(self.capture)
        recipe["prompt"]["load"]["inputs"].update({"strength": 1, "seed": 18446744073709551615})
        recipe["bindings"] += [{"key": "strength", "nodeId": "load", "input": "strength", "contract": {"inputType": "FLOAT"}},
                               {"key": "seed", "nodeId": "load", "input": "seed", "contract": {"inputType": "INT"}}]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", recipe)
        queued = requests.accept(self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        attempt = self.store.attempt(queued["document"]["jobs"][0]["id"])
        seed = 18446744073709551614
        actions = [("set_inputs", {"values": {"strength": .25, "seed": seed}}),
                   ("set_shot_inputs", {"inputs": [{"key": "image", "source": "selected"}]})]
        for action, arguments in actions:
            data = self.input_command(action, arguments, action)
            with patch.object(self.store, "workflow", side_effect=AssertionError("Use the existing command transaction")):
                result = commands.execute(self.store, self.media, self.project["id"], data)
            self.project = Workspace(self.workspace.root).get(self.project["id"])
            self.assertEqual(result["revision"], self.project["revision"])
            self.assertEqual(commands.execute(self.store, self.media, self.project["id"], data), result)
        clip = self.project["document"]["clips"][0]
        self.assertEqual(clip["inputValues"]["strength"], .25)
        self.assertEqual(clip["inputValues"]["seed"], seed)
        self.assertEqual(clip["shotInputs"], actions[1][1]["inputs"])
        self.assertEqual(clip["takeId"], "original")
        self.assertEqual(self.store.attempt(attempt["id"]), attempt, "Input edits must preserve already frozen attempts")
        self.assertEqual(attempt["request"]["prompt"]["load"]["inputs"]["strength"], 1)

    def test_input_type_failures_and_stale_revisions_are_atomic(self):
        recipe = copy.deepcopy(self.capture)
        literals = {"strength": 1, "steps": 4, "flag": True, "gain": 1.0}
        recipe["prompt"]["load"]["inputs"].update(literals)
        recipe["bindings"] += [{"key": key, "nodeId": "load", "input": key, "contract": {"inputType": kind}}
                               for key, kind in (("strength", "FLOAT"), ("steps", "INT"), ("flag", "BOOLEAN"), ("gain", "FLOAT"))]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "clip-a", recipe)
        for key, value in (("steps", 1.5), ("steps", True), ("flag", 1), ("strength", False), ("gain", True), ("strength", "0.25")):
            with self.subTest(key=key, value=value):
                data = self.input_command("set_inputs", {"values": {"strength": .5, key: value}})
                snapshot = self.store.snapshot.read_bytes()
                with self.assertRaisesRegex(ValueError, "literal type"):
                    commands.execute(self.store, self.media, self.project["id"], data)
                self.assertEqual(self.store.snapshot.read_bytes(), snapshot)
                self.assertEqual(Workspace(self.workspace.root).get(self.project["id"]), self.project)
                with self.store.connect() as db:
                    self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 0)
        valid = self.input_command("set_inputs", {"values": {"strength": .5, "gain": 2}})
        result = commands.execute(self.store, self.media, self.project["id"], valid)
        saved = self.store.get(self.project["id"])
        stale_actions = [("set_inputs", {"values": {"strength": .75}}),
                         ("set_shot_inputs", {"inputs": [{"key": "image", "source": "original"}]})]
        for action, arguments in stale_actions:
            with self.assertRaises(Conflict):
                commands.execute(self.store, self.media, self.project["id"], self.input_command(action, arguments, action))
        self.assertEqual(Workspace(self.workspace.root).get(saved["id"]), saved)
        self.assertEqual(commands.execute(self.store, self.media, self.project["id"], valid), result)

    def test_shot_input_validation_and_recipe_ownership_leave_no_operation(self):
        for inputs in ([{"key": "missing", "source": "selected"}], [{"key": "image", "source": "track", "track": "music"}]):
            with self.assertRaises(ValueError):
                commands.execute(self.store, self.media, self.project["id"], self.input_command("set_shot_inputs", {"inputs": inputs}))
        version = self.project["document"]["clips"][0]["workflowVersion"]
        with self.store.connect() as db:
            db.execute("UPDATE workflows SET project_id='other-project' WHERE id=?", (version,))
        snapshot = self.store.snapshot.read_bytes()
        for action, arguments in (("set_inputs", {"values": {"image": "frame.png"}}),
                                  ("set_shot_inputs", {"inputs": [{"key": "image", "source": "selected"}]})):
            with self.assertRaisesRegex(ValueError, "executable workflow"):
                commands.execute(self.store, self.media, self.project["id"], self.input_command(action, arguments))
        self.assertEqual(self.store.snapshot.read_bytes(), snapshot)
        self.assertEqual(Workspace(self.workspace.root).get(self.project["id"]), self.project)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 0)

    def test_failed_input_publication_can_retry_without_a_ghost_operation(self):
        data = self.input_command("set_shot_inputs", {"inputs": [{"key": "image", "source": "selected"}]})
        snapshot = self.store.snapshot.read_bytes()
        with patch("spool.projects.atomic_replace", side_effect=OSError("Project share disconnected")):
            with self.assertRaisesRegex(OSError, "Project share disconnected"):
                commands.execute(self.store, self.media, self.project["id"], data)
        self.assertEqual(self.store.snapshot.read_bytes(), snapshot)
        reopened = Workspace(self.workspace.root)
        store = reopened.for_project(self.project["id"])
        self.assertEqual(store.get(self.project["id"]), self.project)
        with store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM operations").fetchone()[0], 0)
        result = commands.execute(store, self.media, self.project["id"], data)
        saved = Workspace(self.workspace.root).get(self.project["id"])
        self.assertEqual(saved["revision"], result["revision"])
        self.assertEqual(saved["document"]["clips"][0]["shotInputs"], data["arguments"]["inputs"])
        self.assertEqual(saved["document"]["clips"][0]["takeId"], "original")

    def test_read_only_refresh_records_checkpoint_and_copies_snapshot_once(self):
        self.store.stamp.write_text("null")
        copyfile = shutil.copyfile
        copies = []
        def copied(source, target, *args, **kwargs):
            if Path(source) == self.store.snapshot:
                copies.append(str(source))
            return copyfile(source, target, *args, **kwargs)
        signature = self.store.signature()
        with patch("spool.projects.shutil.copyfile", copied):
            for _ in range(3):
                self.store.get(self.project["id"])
                self.store.publish_focus(self.project["id"], "reader", {"clipId": "clip-a"})
        self.assertEqual(len(copies), 1)
        self.assertEqual(json.loads(self.store.stamp.read_text()), signature)
        self.assertEqual(self.store.signature(), signature)
        # Another editor publishes a new checkpoint; the next read refreshes once.
        other = Workspace(self.root / "other-reader")
        project = other.open_folder(self.store.root)
        project["document"]["project"] = "Other editor"
        other.for_project(project["id"]).save(project["id"], project["revision"], project["document"])
        copies.clear()
        with patch("spool.projects.shutil.copyfile", copied):
            for _ in range(3):
                self.assertEqual(self.store.get(project["id"])["document"]["project"], "Other editor")
        self.assertEqual(len(copies), 1)

    def test_folder_copy_and_corrupted_local_stamp_rebuild_without_old_inputs(self):
        copied = self.root / "moved-project"
        shutil.copytree(self.store.root, copied)
        other = Workspace(self.root / "new-machine")
        project = other.open_folder(copied)
        store = other.for_project(project["id"])
        store.stamp.write_text("{interrupted")
        media = self.base_media.for_project(store, project["id"])
        shutil.rmtree(self.roots[0] / "spool-projects")
        self.roots[0].joinpath("frame.png").unlink()
        # Original metadata filenames still resolve through the owned source map.
        capture = media.prepare_workflow(self.capture, True)
        self.assertTrue((self.roots[0] / capture["prompt"]["load"]["inputs"]["image"]).is_file())
        self.assertEqual(store.get(project["id"])["document"], project["document"])

    def test_discovery_does_not_overwrite_an_intervening_human_edit(self):
        folder = self.store.root / self.project["document"]["clips"][0]["outputFolder"]
        path = folder / "outside.png"
        Image.new("RGB", (16, 16), "blue").save(path)
        os.utime(path, (time.time() - 20,) * 2)
        watcher = FolderTakes()
        watcher.scan(self.store, self.media, self.project["id"])
        describe = self.media.describe
        def edited(*args, **kwargs):
            current = self.store.get(self.project["id"])
            current["document"]["clips"][0]["name"] = "Human edit"
            self.store.save(current["id"], current["revision"], current["document"])
            return describe(*args, **kwargs)
        with patch.object(self.media, "describe", edited):
            watcher.scan(self.store, self.media, self.project["id"])
        clip = self.store.clip(self.project["id"], "clip-a")
        self.assertEqual(clip["name"], "Human edit")
        self.assertEqual(len(clip["takes"]), 1)
        watcher.scan(self.store, self.media, self.project["id"])
        self.assertEqual(len(self.store.clip(self.project["id"], "clip-a")["takes"]), 2)

    def test_concurrent_saves_have_one_winner(self):
        def save(name):
            document = copy.deepcopy(self.project["document"])
            document["project"] = name
            try:
                self.store.save(self.project["id"], self.project["revision"], document)
                return "saved"
            except Conflict:
                return "conflict"
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(save, ("One", "Two"))), ["conflict", "saved"])

    def test_portable_inputs_and_frozen_request_survive_host_input_removal(self):
        project = requests.accept(self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        value = attempt["request"]["prompt"]["load"]["inputs"]["image"]
        self.assertIn("/.spool/frozen/", value)
        shutil.rmtree(self.roots[0] / "spool-projects")
        self.roots[0].joinpath("frame.png").unlink()
        restored = self.media.prepare_workflow({"prompt": attempt["request"]["prompt"]}, True)
        self.assertTrue((self.roots[0] / restored["prompt"]["load"]["inputs"]["image"]).is_file())
        requests.preview(self.store, self.media, self.project["id"], self.project["revision"], "clip-a")

    def test_completed_folder_files_discover_once_preserve_selection_and_deleted_takes(self):
        folder = self.store.root / self.project["document"]["clips"][0]["outputFolder"]
        path = folder / "outside-render.png"
        Image.new("RGB", (16, 16), "blue").save(path)
        os.utime(path, (time.time() - 20,) * 2)
        watcher = FolderTakes()
        watcher.scan(self.store, self.media, self.project["id"])
        self.assertEqual(len(self.store.clip(self.project["id"], "clip-a")["takes"]), 1)
        watcher.scan(self.store, self.media, self.project["id"])
        saved = self.store.get(self.project["id"])
        clip = saved["document"]["clips"][0]
        self.assertEqual(len(clip["takes"]), 2)
        self.assertEqual(clip["takeId"], "original")
        clip["takes"] = [clip["takes"][0]]
        self.store.save(saved["id"], saved["revision"], saved["document"])
        watcher.scan(self.store, self.media, self.project["id"])
        self.assertEqual(len(self.store.clip(self.project["id"], "clip-a")["takes"]), 1)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required")
    def test_completed_external_mp4_uses_sidecar_setup_and_project_preview_cache(self):
        folder = self.store.root / self.project["document"]["clips"][0]["outputFolder"]
        path = folder / "deadline-external.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=24:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
        capture = {**self.capture, "workflow": {"nodes": [{"id": "load", "type": "LoadImage", "widgets_values": ["frame.png"]}], "links": []}}
        sidecars.write(path, capture, lock_root=self.store.root / ".spool" / "locks")
        os.utime(path, (time.time() - 20,) * 2)
        watcher = FolderTakes()
        watcher.scan(self.store, self.media, self.project["id"])
        watcher.scan(self.store, self.media, self.project["id"])
        take = self.store.clip(self.project["id"], "clip-a")["takes"][-1]
        self.assertEqual(take["media"]["frames"], 24)
        self.assertTrue(take["media"]["file"].startswith(".spool/previews/"))
        self.assertTrue(take["media"]["originalFile"].startswith("output/Desert walk/"))
        self.assertEqual(self.store.evidence(self.project["id"], take["media"]["id"])["workflowData"]["prompt"]["save"], self.capture["prompt"]["save"])

    def test_local_result_goes_to_clip_folder_and_receipt_recovery_is_portable(self):
        project = requests.accept(self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        Image.new("RGB", (16, 16), "blue").save(self.roots[1] / "result.png")
        history = {"status": {"completed": True, "status_str": "success"}, "outputs": {"save": {"images": [{"filename": "result.png", "type": "output"}]}}}
        artifacts, primary = self.media.collect(attempt, history, False)
        self.assertTrue(primary["originalFile"].startswith("output/Desert walk/take-002-"))
        receipt = self.media.receipt_path(attempt)
        receipts.write(receipt.parent, attempt, artifacts, primary, history)
        collector = Collector(self.workspace, self.base_media)
        self.assertTrue(collector.ingest(attempt))
        self.assertFalse(collector.ingest(attempt))
        self.assertEqual(self.store.clip(self.project["id"], "clip-a")["takeId"], "original")
        saved = self.store.get(self.project["id"])
        result = take_files.delete(self.store, saved["id"], saved["revision"], "clip-a", [attempt["take_id"]])
        self.assertFalse((self.store.root / primary["originalFile"]).exists())
        self.assertNotIn(attempt["take_id"], [t["id"] for t in result["project"]["document"]["clips"][0]["takes"]])
        self.assertFalse(collector.ingest(attempt))
        stale = self.store.save(saved["id"], result["project"]["revision"], saved["document"])
        self.assertNotIn(attempt["take_id"], [t["id"] for t in stale["document"]["clips"][0]["takes"]])
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")

    def test_deadline_root_is_derived_from_project_and_verified_results_reach_clip_folder(self):
        capture = copy.deepcopy(self.capture)
        capture["prompt"]["submit"] = {"class_type": "DeadlineSubmit", "inputs": {"output_directory": "", "batch_count": 8, "chunk_size": 4}}
        saved = self.store.capture(self.project["id"], self.project["revision"], "clip-a", self.media.prepare_workflow(capture, True))
        project = requests.accept(self.store, self.media, saved["id"], saved["revision"], [{"clipId": "clip-a", "count": 1}])
        attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        request = attempt["request"]
        root = Path(request["prompt"]["submit"]["inputs"]["output_directory"])
        self.assertEqual(root, self.store.root / ".spool" / "deadline")
        self.assertEqual(request["prompt"]["submit"]["inputs"]["batch_count"], 1)
        package = {"schemaVersion": 2, **{k: request[k] for k in ("projectId", "clipId", "takeId", "attemptId", "fingerprint")},
            "variationIndex": 0, "result": request["capture"]["result"], "assets": copy.deepcopy(request["assets"]), "resultRoot": str(root)}
        submission = self.store.submission(attempt["id"], package)
        package["submissionId"] = submission["id"]
        package["stagedPrompt"] = {k: copy.deepcopy(v) for k, v in request["prompt"].items() if k != "submit"}
        for asset in package["assets"]:
            asset["staged"] = asset["frozen"]
        directory = root / "spool-submissions" / submission["id"]
        farm_protocol.atomic_json(directory / "request.json", package)
        farm_protocol.atomic_json(directory / "ack.json", {**{k: package[k] for k in ("schemaVersion", "submissionId", "attemptId", "fingerprint")}, "jobId": "test-job"})
        execution = farm_protocol.prepare_execution(package, package["stagedPrompt"], self.roots[0], 0)
        Image.new("RGB", (16, 16), "blue").save(self.roots[1] / "farm.png")
        history = {"prompt": [0, "worker", execution["prompt"]], "status": {"completed": True, "status_str": "success"},
            "outputs": {"save": {"images": [{"filename": "farm.png", "type": "output"}]}}}
        farm_protocol.finalize(package, execution, "worker", history, self.media.host_roots, "test-worker", "test-job")
        with patch("spool.farm.deadline_command", return_value=""):
            Collector(self.workspace, self.base_media).scan()
        result = self.store.attempt(attempt["id"])
        self.assertEqual(result["status"], "complete")
        self.assertTrue(json.loads(result["result"])["primary"]["originalFile"].startswith("output/Desert walk/"))
        signature = self.store.signature()
        with patch("spool.farm.deadline_command", return_value=""):
            for _ in range(3):
                Collector(self.workspace, self.base_media).scan()
        self.assertEqual(self.store.signature(), signature, "Observed receipts and acknowledgements must not republish an unchanged project")

    def test_repeated_status_observations_do_not_publish_snapshots_but_new_errors_do(self):
        project = requests.accept(self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        identity = project["document"]["jobs"][0]["id"]
        self.store.transition(identity, 'running')
        signature = self.store.signature()
        self.store.transition(identity, 'running')
        self.assertEqual(self.store.signature(), signature)
        self.store.transition(identity, 'running', error='Worker disconnected')
        changed = self.store.signature()
        self.assertNotEqual(changed, signature)
        self.store.transition(identity, 'running', error='Worker disconnected')
        self.assertEqual(self.store.signature(), changed)
        self.store.transition(identity, 'running', error=None)
        self.assertIsNone(self.store.attempt(identity)['error'])

    def test_prune_uses_project_cache_and_compaction_publishes_locally(self):
        previews = self.store.root / ".spool" / "previews"
        disposable = previews / "unused.jpg"
        disposable.write_bytes(b"unused")
        original = self.store.root / "input" / "images" / "keep.png"
        original.write_bytes(b"original")
        report = self.store.prune(confirm=True, budget=0, grace=0)
        self.assertIn(".spool/previews/unused.jpg", report["evicted"])
        self.assertTrue(original.exists())
        with self.store.connect() as db:
            db.execute("CREATE TABLE disposable(data BLOB)")
            db.execute("INSERT INTO disposable VALUES(?)", (b"x" * 1000000,))
        with self.store.connect() as db:
            db.execute("DROP TABLE disposable")
        self.assertGreater(self.store.compact(), 0)
        self.assertEqual(self.store.get(self.project["id"])["document"], self.project["document"])

    def test_project_http_scope_uploads_media_and_isolates_project_paths(self):
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                project_id = self.project["id"]
                response = await client.post('/spool/api/projects/' + project_id + '/input', data=(self.roots[0] / 'frame.png').read_bytes(), headers={'X-Filename': 'pasted.png'})
                self.assertEqual(response.status, 200, await response.text())
                value = await response.json()
                self.assertIn('spool-projects/' + project_id + '/input/images/', value['file'])
                response = await client.get('/spool/media/' + project_id + '/assets/black.png')
                self.assertEqual(response.status, 200)
                response = await client.get('/spool/media/' + project_id + '/%2e%2e/app.sqlite3')
                self.assertIn(response.status, (400, 404))
        asyncio.run(check())

    def test_large_project_http_compresses_without_changing_the_document(self):
        project = self.store.get(self.project['id'])
        project['document']['brief'] = 'A long project brief. ' * 5000
        self.store.save(project['id'], project['revision'], project['document'])
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app), auto_decompress=False) as client:
                path = '/spool/api/projects/' + project['id']
                response = await client.get(path, headers={'Accept-Encoding': 'identity'})
                plain = await response.read()
                self.assertNotIn('Content-Encoding', response.headers)
                response = await client.get(path, headers={'Accept-Encoding': 'gzip'})
                compressed = await response.read()
                self.assertEqual(response.headers['Content-Encoding'], 'gzip')
                self.assertEqual(response.headers['Vary'], 'Accept-Encoding')
                self.assertLess(len(compressed), len(plain) // 10)
                self.assertEqual(json.loads(gzip.decompress(compressed)), json.loads(plain))
                response = await client.post(path + '/focus/dock', json={'clipId': 'clip-a'}, headers={'Accept-Encoding': 'gzip'})
                self.assertEqual(await response.json(), {'ok': True})
                self.assertNotIn('Content-Encoding', response.headers)
        asyncio.run(check())

    def test_editor_http_projection_keeps_workflow_evidence_available_and_saves_portably(self):
        project = requests.accept(self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        metadata = {"id": "generated-media", "kind": "image", "file": "assets/black.png", "originalFile": "assets/black.png", "frames": 120,
                    "probe": {"tag": "kept " * 30000}, "workflow": self.capture["workflow"], "prompt": self.capture["prompt"]}
        receipt = {"primary": metadata, "artifacts": [metadata]}
        self.store.accept_execution(attempt["id"], "execution", None, receipt)
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                path = '/spool/api/projects/' + project['id']
                full = unwire(await (await client.get(path)).json())
                compact = unwire(await (await client.get(path, headers={"X-Spool-View": "editor"})).json())
                self.assertEqual(compact, ledger.editor_project(full))
                self.assertLess(len(json.dumps(compact)), len(json.dumps(full)) // 5)
                row = await (await client.get(path + '/media/generated-media/evidence')).json()
                self.assertEqual(row["probe"], metadata["probe"])
                all_evidence = await (await client.get(path + '/evidence')).json()
                portable = ledger.compose(compact['document'], all_evidence)
                rendered = next(t for t in portable['clips'][0]['takes'] if t.get('generated'))
                self.assertEqual(rendered['media'], metadata)
                self.assertEqual(rendered['artifacts'], [metadata])
                response = await client.put(path, headers={"X-Spool-View": "editor"}, json={"revision": compact['revision'], "document": ledger.authored(compact['document'])})
                self.assertEqual(response.status, 200)
                saved = await response.json()
                self.assertEqual(saved['document']['clips'][0]['takeId'], 'original')
                self.assertNotIn('probe', next(t for t in saved['document']['clips'][0]['takes'] if t.get('generated'))['media'])
                # Exact/full exports and execution receipts retain everything.
                full_after = await (await client.get(path)).json()
                self.assertEqual(next(t for t in full_after['document']['clips'][0]['takes'] if t.get('generated'))['media'], metadata)
                self.assertEqual(json.loads(self.store.attempt(attempt['id'])['result']), receipt)
        asyncio.run(check())

    def test_idle_sync_skips_projection_and_detects_edits_and_same_revision_receipts(self):
        project_id = self.project['id']
        project = requests.accept(self.store, self.media, project_id, self.project['revision'], [{'clipId': 'clip-a', 'count': 1}])
        attempt = self.store.attempt(project['document']['jobs'][0]['id'])
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                path = '/spool/api/projects/' + project_id
                headers = {'X-Spool-View': 'editor'}
                full = await (await client.get(path, headers=headers)).json()
                headers['X-Spool-Since'] = full['syncToken']
                signature = self.store.signature()
                with patch.object(self.store, 'get', side_effect=AssertionError('Idle sync must not rebuild the project')):
                    for _ in range(3):
                        response = await client.get(path, headers=headers)
                        self.assertEqual(response.status, 200, await response.text())
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        delta = await response.json()
                        self.assertNotIn('document', delta)
                        self.assertLess(len(json.dumps(delta)), 1024)
                        self.assertEqual(delta['syncToken'], full['syncToken'])
                self.assertEqual(self.store.signature(), signature, 'Polling must not publish a snapshot')
                # An error update can change presentation without an edit revision or event.
                self.store.transition(attempt['id'], attempt['status'], error='Waiting for operator')
                changed = await (await client.get(path, headers=headers)).json()
                self.assertEqual(changed['revision'], full['revision'])
                self.assertEqual(changed['document']['jobs'][0]['error'], 'Waiting for operator')
                self.assertNotEqual(changed['syncToken'], full['syncToken'])
                headers['X-Spool-Since'] = changed['syncToken']
                metadata = {'id': 'sync-render', 'kind': 'image', 'file': 'assets/black.png', 'frames': 12}
                self.store.accept_execution(attempt['id'], 'sync-receipt', None, {'primary': metadata, 'artifacts': [metadata]})
                arrived = await (await client.get(path, headers=headers)).json()
                self.assertEqual(arrived['revision'], full['revision'])
                self.assertEqual(arrived['document']['jobs'][0]['status'], 'complete')
                self.assertTrue(any(t['id'] == attempt['take_id'] for t in arrived['document']['clips'][0]['takes']))
                self.assertEqual(arrived['document']['clips'][0]['takeId'], 'original')
                headers['X-Spool-Since'] = arrived['syncToken']
                # A second computer publishes an edit; the first reader must refresh its checkpoint.
                other = Workspace(self.root / 'sync-other-computer')
                reopened = other.open_folder(self.store.root)
                reopened['document']['project'] = 'Remote edit'
                other.for_project(project_id).save(project_id, reopened['revision'], reopened['document'])
                edited = await (await client.get(path, headers=headers)).json()
                self.assertGreater(edited['revision'], arrived['revision'])
                self.assertEqual(edited['document']['project'], 'Remote edit')
                # Ordinary clients and exports always receive the complete representation.
                response = await client.get(path, headers={'X-Spool-Since': edited['syncToken']})
                self.assertIn('document', await response.json())
        asyncio.run(check())

    def test_sync_checkpoint_cache_skips_database_locks_and_isolates_progress(self):
        project = requests.accept(self.store, self.media, self.project['id'], self.project['revision'], [{'clipId': 'clip-a', 'count': 1}])
        state = self.store.sync_state(project['id'])
        state['jobs'][0]['farmProgress'] = {'percent': 50}
        with patch.object(self.store, 'connect', side_effect=AssertionError('An unchanged checkpoint must not wait for the database lock')):
            cached = self.store.sync_state(project['id'])
            self.assertNotIn('farmProgress', cached['jobs'][0])
            cached['jobs'].clear()
            self.assertEqual(len(self.store.sync_state(project['id'])['jobs']), 1)
        self.store.transition(project['document']['jobs'][0]['id'], 'queued')
        self.assertEqual(self.store.sync_state(project['id'])['jobs'][0]['status'], 'queued')

    def test_sync_cache_does_not_label_a_racing_snapshot_as_already_read(self):
        other = Workspace(self.root / 'sync-racing-computer')
        remote = other.open_folder(self.store.root)
        original = Store.sync_state
        reads = []
        def read(project_id):
            if not reads:
                remote['document']['project'] = 'Published during check'
                other.for_project(project_id).save(project_id, remote['revision'], remote['document'])
            reads.append(project_id)
            return original(self.store, project_id)
        with patch('spool.store.Store.sync_state', side_effect=read):
            first = self.store.sync_state(remote['id'])
            self.assertGreater(first['revision'], remote['revision'])
            self.assertEqual(self.store.sync_state(remote['id']), first)
            self.assertEqual(len(reads), 2, 'A changed publication must be read before its signature is cached')
            self.assertEqual(self.store.sync_state(remote['id']), first)
            self.assertEqual(len(reads), 2)

    def test_unchanged_sync_keeps_local_and_deadline_progress_live(self):
        project = requests.accept(self.store, self.media, self.project['id'], self.project['revision'], [{'clipId': 'clip-a', 'count': 2}])
        local, farm = project['document']['jobs']
        self.store.transition(local['id'], 'queued')
        # A synthetic farm request exercises observations without submitting a scheduler job.
        with self.store.connect() as db:
            db.execute("UPDATE attempts SET request=json_set(request,'$.target','deadline') WHERE id=?", (farm['id'],))
        observed = {'promptId': local['promptId'], 'nodes': [{'id': 'load', 'value': 1, 'max': 10}]}
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            executor = LocalExecutor(self.workspace, self.base_media, server, None, progress=lambda: observed)
            farm_observation = {'percent': 10, 'worker': 'QA', 'message': 'Rendering', 'observedAt': 1}
            executor.collector.farms['qa'] = SimpleNamespace(observations={farm['id']: farm_observation})
            register(server, self.workspace, self.base_media, executor)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                path = '/spool/api/projects/' + project['id']
                headers = {'X-Spool-View': 'editor'}
                full = await (await client.get(path, headers=headers)).json()
                headers['X-Spool-Since'] = full['syncToken']
                observed['nodes'][0]['value'] = 7
                farm_observation.update(percent=55, observedAt=2)
                with patch.object(self.store, 'get', side_effect=AssertionError('Live progress must not load render evidence')):
                    delta = await (await client.get(path, headers=headers)).json()
                    jobs = {j['id']: j for j in delta['jobs']}
                    self.assertEqual(delta['syncToken'], full['syncToken'])
                    self.assertEqual(jobs[local['id']]['status'], 'running')
                    self.assertEqual(jobs[local['id']]['nodeProgress'], [{'id': 'load', 'value': 7, 'max': 10, 'label': 'LoadImage'}])
                    self.assertEqual(jobs[farm['id']]['farmProgress']['percent'], 55)
                    observed.clear()
                    executor.collector.farms.clear()
                    reset = await (await client.get(path, headers=headers)).json()
                    self.assertTrue(all('nodeProgress' not in j and 'farmProgress' not in j for j in reset['jobs']))
        asyncio.run(check())

    def test_generated_take_selection_keeps_ownership_without_loading_all_recipes_first(self):
        project = requests.accept(self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "clip-a", "count": 1}])
        attempt = self.store.attempt(project["document"]["jobs"][0]["id"])
        metadata = {"id": "render", "kind": "image", "file": "assets/black.png", "frames": 12}
        self.store.accept_execution(attempt["id"], "execution", None, {"primary": metadata, "artifacts": [metadata]})
        other = copy.deepcopy(project["document"]["clips"][0])
        other["id"] = "other-clip"
        other["outputFolder"] = "output/Other"
        project["document"]["clips"].append(other)
        project = self.store.save(project["id"], project["revision"], project["document"])
        with self.assertRaisesRegex(ValueError, "no longer available"):
            self.store.capture(project["id"], project["revision"], "other-clip", None, take_id=attempt["take_id"])
        with patch.object(self.store, "get", wraps=self.store.get) as read:
            selected = self.store.capture(project["id"], project["revision"], "clip-a", None, take_id=attempt["take_id"])
            self.assertEqual(read.call_count, 1, "Only the final response needs the full project")
        clip = selected["document"]["clips"][0]
        self.assertEqual(clip["takeId"], attempt["take_id"])
        self.assertEqual(clip["out"] - clip["in"], 12)
        self.assertEqual(clip["takes"][-1]["media"], metadata)

    def test_picture_preview_skips_audio_usage_with_a_shared_media_id(self):
        project = self.store.get(self.project['id'])
        picture = project['document']['clips'][0]['takes'][0]['media']
        project['document']['audioClips'] = [{'id': 'audio-use', 'track': 'music', 'name': 'Audio use', 'start': 0, 'in': 0, 'out': 24, 'media': {**picture, 'kind': 'audio'}}]
        project = self.store.save(project['id'], project['revision'], project['document'])
        # JSON key ordering visits audioClips before clips; id alone is ambiguous.
        self.assertEqual(self.store.media_record(project['id'], picture['id'])['kind'], 'audio')
        self.assertEqual(self.store.media_record(project['id'], picture['id'], ('video', 'image'))['kind'], picture['kind'])
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                response = await client.post('/spool/api/projects/' + project['id'] + '/media/' + picture['id'] + '/preview', json={'divisor': 1, 'width': 96, 'height': 64, 'fps': 24})
                self.assertEqual(response.status, 200, await response.text())
                result = await response.json()
                self.assertTrue(result['file'].endswith('.png'))
        asyncio.run(check())

    def test_project_response_serialization_does_not_block_other_requests(self):
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                entered, release = Event(), Event()
                def slow_wire(value):
                    entered.set()
                    release.wait(3)
                    return wire(value)
                with patch('spool.routes.wire', slow_wire):
                    pending = asyncio.create_task(client.get('/spool/api/projects/' + self.project['id']))
                    try:
                        self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                        response = await client.get('/spool/ui/project-edit.js')
                        self.assertEqual(response.status, 200)
                        await response.read()
                        self.assertFalse(pending.done(), 'Serialization must not freeze the HTTP event loop')
                    finally:
                        release.set()
                    response = await pending
                    self.assertEqual(response.status, 200)
                    await response.read()
        asyncio.run(check())

    def test_slow_project_storage_does_not_block_other_http_requests(self):
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                for method, verb, suffix in [('get', 'GET', ''), ('save', 'PUT', ''), ('capture', 'POST', '/use-take/clip-a')]:
                    with self.subTest(operation=method):
                        project = self.store.get(self.project['id'])
                        payload = {'revision': project['revision'], 'document': project['document']} if method == 'save' else {'revision': project['revision'], 'takeId': 'original'} if method == 'capture' else None
                        entered, release = Event(), Event()
                        original = getattr(self.store, method)
                        def slow_storage(*args, **kwargs):
                            entered.set()
                            release.wait(3)
                            return original(*args, **kwargs)
                        with patch.object(self.store, method, side_effect=slow_storage):
                            pending = asyncio.create_task(client.request(verb, '/spool/api/projects/' + self.project['id'] + suffix, json=payload))
                            try:
                                self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                                response = await client.get('/spool/ui/project-edit.js')
                                self.assertEqual(response.status, 200)
                                await response.read()
                                self.assertFalse(pending.done(), 'Blocked storage must not freeze the HTTP event loop')
                            finally:
                                release.set()
                            response = await pending
                            self.assertEqual(response.status, 200)
                            await response.read()
        asyncio.run(check())


if __name__ == "__main__":
    unittest.main()
