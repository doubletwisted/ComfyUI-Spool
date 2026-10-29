import copy
import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool import take_files, projects
from spool.media import Media
from spool.routes import register
from spool.projects import Workspace, ProjectStore
from spool.store import Conflict, encode


class TakeFileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.workspace = Workspace(self.root / "app")
        takes = [
            {
                "id": name,
                "number": index + 1,
                "media": {
                    "id": "media-" + name,
                    "kind": "video",
                    "name": name + ".mp4",
                    "frames": 120,
                    "originalFile": "output/Shot/" + name + ".mp4",
                    "file": ".spool/previews/" + name + ".mp4",
                    "poster": ".spool/previews/" + name + ".jpg",
                },
            }
            for index, name in enumerate(["chosen", "one", "two"])
        ]
        self.project = self.workspace.create(
            {
                "project": "Cleanup",
                "clips": [{"id": "shot", "name": "Shot", "takeId": "chosen", "takes": takes, "in": 0, "out": 48}],
                "media": [copy.deepcopy(takes[1]["media"])],
            }
        )
        self.id = self.project["id"]
        self.store = self.workspace.for_project(self.id)
        for take in takes:
            for path in take_files.paths(self.store.root, take["media"]) | {
                self.store.root / ("output/Shot/" + take["id"] + ".json")
            }:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(take["id"].encode())

    def source(self, name="one"):
        return self.store.root / ("output/Shot/" + name + ".mp4")

    def test_planning_resolves_each_distinct_media_path_once(self):
        document = copy.deepcopy(self.project["document"])
        document["media"] *= 50
        original = Path.resolve
        calls = []

        def resolve(path, *args, **kwargs):
            calls.append(str(path))
            return original(path, *args, **kwargs)

        with patch.object(Path, "resolve", resolve):
            ids, media_ids, files = take_files.plan(self.store, document, "shot", ["one"])
        self.assertEqual(ids, ["one"])
        self.assertEqual(media_ids, ["media-one"])
        self.assertEqual(len(files), 4)
        self.assertEqual(calls.count(str(self.source())), 1)

    def test_relative_media_alias_cannot_escape_through_a_directory_link(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "one.mp4").write_bytes(b"keep")
        link = self.store.root / "output" / "linked"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError as error:
            self.skipTest("Directory symlinks unavailable: " + str(error))
        document = copy.deepcopy(self.project["document"])
        document["clips"][0]["takes"][1]["media"]["originalFile"] = "output/linked/one.mp4"
        with self.assertRaisesRegex(ValueError, "escapes"):
            take_files.plan(self.store, document, "shot", ["one"])
        self.assertEqual((outside / "one.mp4").read_bytes(), b"keep")

    def test_disk_delete_removes_media_sidecar_proxy_poster_and_pool_entry(self):
        result = take_files.delete(self.store, self.id, 0, "shot", ["one"])
        self.assertFalse(self.source().exists())
        self.assertFalse(self.source().with_suffix(".json").exists())
        self.assertFalse((self.store.root / ".spool/previews/one.mp4").exists())
        self.assertFalse((self.store.root / ".spool/previews/one.jpg").exists())
        self.assertTrue(self.source("chosen").exists())
        self.assertEqual(result["project"]["revision"], 1)
        self.assertEqual(result["project"]["document"]["deletedTakeIds"], ["one"])
        self.assertFalse(result["project"]["document"]["media"])
        self.assertEqual(result["pendingFiles"], 0)

    def test_stale_revision_and_active_take_do_not_touch_files(self):
        with self.assertRaises(Conflict):
            take_files.delete(self.store, self.id, 99, "shot", ["one"])
        with self.assertRaisesRegex(ValueError, "take in the edit"):
            take_files.delete(self.store, self.id, 0, "shot", ["chosen", "one"])
        self.assertTrue(self.source().exists())
        self.assertTrue(self.source("chosen").exists())
        self.assertEqual(self.store.revision(self.id), 0)

    def test_shared_takes_and_audio_are_protected(self):
        document = copy.deepcopy(self.project["document"])
        document["clips"].append(
            {
                **copy.deepcopy(document["clips"][0]),
                "id": "other",
                "name": "Other shot",
                "takes": [document["clips"][0]["takes"][1]],
                "takeId": "one",
            }
        )
        project = self.store.save(self.id, 0, document)
        with self.assertRaisesRegex(ValueError, "another take"):
            take_files.delete(self.store, self.id, project["revision"], "shot", ["one"])
        self.assertTrue(self.source().exists())

    def test_audio_and_shared_workflow_sidecar_are_protected(self):
        document = copy.deepcopy(self.project["document"])
        document["audioClips"] = [{"id": "audio", "media": document["clips"][0]["takes"][1]["media"]}]
        saved = self.store.save(self.id, 0, document)
        with self.assertRaisesRegex(ValueError, "timeline audio"):
            take_files.delete(self.store, self.id, saved["revision"], "shot", ["one"])
        document.pop("audioClips")
        document["clips"][0]["takes"][2]["media"]["originalFile"] = "output/Shot/one.mov"
        saved = self.store.save(self.id, saved["revision"], document)
        with self.assertRaisesRegex(ValueError, "another take"):
            take_files.delete(self.store, self.id, saved["revision"], "shot", ["one"])
        self.assertTrue(self.source().with_suffix(".json").exists())

    def test_external_files_and_input_dependencies_are_protected(self):
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"outside")
        document = copy.deepcopy(self.project["document"])
        document["clips"][0]["takes"][1]["media"]["originalFile"] = str(outside)
        project = self.store.save(self.id, 0, document)
        with self.assertRaisesRegex(ValueError, "owned by this project"):
            take_files.delete(self.store, self.id, project["revision"], "shot", ["one"])
        self.assertTrue(outside.exists())
        document = copy.deepcopy(self.project["document"])
        document["clips"][0].update(
            {"bindings": [{"key": "input", "asset": True}], "inputValues": {"input": str(self.source())}}
        )
        project = self.store.save(self.id, project["revision"], document)
        with self.assertRaisesRegex(ValueError, "generation input"):
            take_files.delete(self.store, self.id, project["revision"], "shot", ["one"])

    def test_old_documents_cannot_resurrect_deleted_membership(self):
        take_files.delete(self.store, self.id, 0, "shot", ["one"])
        saved = self.store.save(self.id, 1, self.project["document"])
        self.assertNotIn("one", [t["id"] for t in saved["document"]["clips"][0]["takes"]])
        self.assertEqual(saved["document"]["deletedTakeIds"], ["one"])
        stale = copy.deepcopy(self.project["document"])
        stale["clips"][0]["takeId"] = "one"
        with self.assertRaisesRegex(ValueError, "deleted from disk"):
            self.store.save(self.id, saved["revision"], stale)

    def test_failed_database_publication_restores_all_files(self):
        original = projects.atomic_replace

        def fail_snapshot(pending, target):
            if target == self.store.snapshot:
                raise OSError("NAS disconnected")
            return original(pending, target)

        with patch.object(projects, "atomic_replace", side_effect=fail_snapshot):
            with self.assertRaisesRegex(OSError, "NAS disconnected"):
                take_files.delete(self.store, self.id, 0, "shot", ["one", "two"])
        self.assertTrue(self.source().exists())
        self.assertTrue(self.source().with_suffix(".json").exists())
        self.assertTrue(self.source("two").exists())
        self.assertEqual(self.store.revision(self.id), 0)

    def test_failed_move_restores_previously_staged_files(self):
        original = take_files.atomic_replace

        def fail_move(source, target):
            if source == self.source():
                raise PermissionError("Video is still open")
            return original(source, target)

        with patch.object(take_files, "atomic_replace", side_effect=fail_move):
            with self.assertRaises(PermissionError):
                take_files.delete(self.store, self.id, 0, "shot", ["one"])
        self.assertTrue(self.source().exists())
        self.assertTrue((self.store.root / ".spool/previews/one.jpg").exists())
        self.assertEqual(self.store.revision(self.id), 0)

    def test_crash_recovery_restores_uncommitted_files_and_finishes_committed_deletion(self):
        directory = self.store.root / ".spool/take-deletions/interrupted"
        directory.mkdir(parents=True)
        manifest = {
            "projectId": self.id,
            "takeIds": ["one"],
            "files": [{"original": "output/Shot/one.mp4", "staged": "0.mp4"}],
        }
        (directory / "manifest.json").write_text(encode(manifest))
        self.source().replace(directory / "0.mp4")
        ProjectStore(self.store.root, self.workspace)
        self.assertTrue(self.source().exists())
        self.assertFalse(directory.exists())
        take_files.delete(self.store, self.id, 0, "shot", ["one"])
        directory.mkdir()
        (directory / "manifest.json").write_text(encode(manifest))
        (directory / "0.mp4").write_bytes(b"pending deletion")
        ProjectStore(self.store.root, self.workspace)
        self.assertFalse(directory.exists())


class TakeFileRoutes(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.workspace = Workspace(root / "app")
        self.metadata = {
            "id": "media",
            "kind": "video",
            "originalFile": "output/Shot/a space \u0142.mp4",
            "file": ".spool/previews/proxy.mp4",
        }
        self.project = self.workspace.create(
            {
                "project": "File actions",
                "clips": [
                    {
                        "id": "shot",
                        "takeId": "take",
                        "takes": [{"id": "take", "media": self.metadata}],
                        "in": 0,
                        "out": 48,
                    }
                ],
            }
        )
        self.store = self.workspace.for_project(self.project["id"])
        self.original = self.store.root / self.metadata["originalFile"]
        self.original.parent.mkdir(parents=True, exist_ok=True)
        self.original.write_bytes(b"original video bytes")
        proxy = self.store.root / self.metadata["file"]
        proxy.parent.mkdir(parents=True, exist_ok=True)
        proxy.write_bytes(b"preview bytes")
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.workspace, Media(self.workspace.root, root / "input", root / "output", root / "temp"))
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.path = "/spool/api/projects/" + self.project["id"] + "/take-file/shot/take"

    async def test_download_streams_original_with_attachment_filename(self):
        result = await self.client.get(self.path)
        self.assertEqual(result.status, 200, await result.text())
        self.assertEqual(await result.read(), b"original video bytes")
        self.assertIn("attachment;", result.headers["Content-Disposition"])
        self.assertIn("%C5%82.mp4", result.headers["Content-Disposition"])
        result = await self.client.get(self.path, headers={"Range": "bytes=0-7"})
        self.assertEqual(result.status, 206)
        self.assertEqual(await result.read(), b"original")
        self.assertEqual(self.store.get(self.project["id"]), self.project)

    @unittest.skipUnless(os.name == "nt", "Windows streaming workaround")
    async def test_windows_streaming_delivers_ranges_head_and_ui_without_native_sendfile(self):
        loop = asyncio.get_running_loop()
        with (
            patch("aiohttp.web_fileresponse.NOSENDFILE", False),
            patch.object(loop, "sendfile", side_effect=AssertionError("Native sendfile is unavailable")) as native,
        ):
            result = await self.client.get(self.path, headers={"Range": "bytes=2-9", "Accept-Encoding": "gzip"})
            self.assertEqual(result.status, 206)
            self.assertEqual(await result.read(), b"iginal v")
            self.assertEqual(result.headers["Content-Range"], "bytes 2-9/20")
            self.assertNotIn("Content-Encoding", result.headers)
            head = await self.client.head(self.path)
            self.assertEqual(head.headers["Content-Length"], "20")
            self.assertEqual(await head.read(), b"")
            cached = await self.client.get(self.path, headers={"If-None-Match": head.headers["Etag"]})
            self.assertEqual(cached.status, 304)
            self.assertEqual(await cached.read(), b"")
            result = await self.client.get("/spool/ui/bootstrap.js")
            self.assertEqual(result.status, 200)
            self.assertIn(b"initializeEditor", await result.read())
            result = await self.client.get("/spool/media/" + self.project["id"] + "/" + self.metadata["file"])
            self.assertEqual(await result.read(), b"preview bytes")
            with patch("spool.routes.templates.asset", return_value=self.original):
                result = await self.client.get("/spool/api/templates/api_ltx2_5_i2v/webp")
                self.assertEqual(result.status, 200)
                self.assertEqual(await result.read(), b"original video bytes")
            native.assert_not_called()

    async def test_reveal_selects_original_and_rejects_cross_origin(self):
        with patch("spool.system.show") as launch:
            result = await self.client.post(self.path + "/reveal", json={})
            self.assertEqual(result.status, 200, await result.text())
            launch.assert_called_once_with(self.original, select=True)
            launch.reset_mock()
            result = await self.client.post(
                self.path + "/reveal", headers={"Origin": "https://elsewhere.invalid"}, json={}
            )
            self.assertEqual(result.status, 403)
            launch.assert_not_called()

    async def test_unknown_take_missing_original_and_traversal_are_rejected(self):
        with patch("spool.system.show") as launch:
            self.assertEqual(
                (await self.client.get(self.path.replace("/take-file/shot/take", "/take-file/shot/unknown"))).status,
                404,
            )
            self.original.unlink()
            self.assertEqual((await self.client.get(self.path)).status, 400)
            self.assertEqual((await self.client.post(self.path + "/reveal", json={})).status, 400)
            launch.assert_not_called()
        document = self.project["document"]
        document["clips"][0]["takes"][0]["media"]["originalFile"] = "../outside.mp4"
        self.store.save(self.project["id"], 0, document)
        self.assertEqual((await self.client.get(self.path)).status, 400)

    async def test_open_clip_folder_uses_stable_identity_and_supports_empty_shots(self):
        document = self.project["document"]
        original_folder = document["clips"][0]["outputFolder"]
        document["clips"][0]["name"] = "Renamed shot"
        document["clips"].append({"id": "empty", "name": "Empty shot", "takes": [], "in": 0, "out": 48})
        saved = self.store.save(self.project["id"], self.project["revision"], document)
        empty_folder = self.store.root / saved["document"]["clips"][1]["outputFolder"]
        empty_folder.rmdir()
        with patch("spool.system.show") as launch:
            for clip_id, folder in (("shot", self.store.root / original_folder), ("empty", empty_folder)):
                result = await self.client.post(
                    "/spool/api/projects/" + self.project["id"] + "/clip-folder/" + clip_id + "/reveal", json={}
                )
                self.assertEqual(result.status, 200, await result.text())
                launch.assert_called_with(folder.resolve())
                self.assertTrue(folder.is_dir())
        self.assertEqual(self.store.get(self.project["id"]), saved)
        with patch("spool.system.file_manager", return_value="Finder"):
            capabilities = await (await self.client.get("/spool/api/capabilities?types=")).json()
        self.assertEqual((capabilities["fileManager"], capabilities["clipFolderReveal"]), ("Finder", True))
        with patch("spool.system.file_manager", return_value=None), patch("spool.system.show") as launch:
            capabilities = await (await self.client.get("/spool/api/capabilities?types=")).json()
            self.assertEqual((capabilities["fileManager"], capabilities["clipFolderReveal"]), (None, False))
            result = await self.client.post(
                "/spool/api/projects/" + self.project["id"] + "/clip-folder/shot/reveal", json={}
            )
            self.assertEqual(result.status, 400)
            launch.assert_not_called()

    async def test_open_clip_folder_rejects_unknown_clip_cross_origin_and_invalid_folder(self):
        path = "/spool/api/projects/" + self.project["id"] + "/clip-folder/shot/reveal"
        with patch("spool.system.show") as launch:
            self.assertEqual((await self.client.post(path.replace("/shot/", "/unknown/"), json={})).status, 400)
            self.assertEqual(
                (await self.client.post(path, headers={"Origin": "https://elsewhere.invalid"}, json={})).status, 403
            )
            for folder in ("output", "input/images", "../outside", "output/../../outside"):
                with (
                    self.subTest(folder=folder),
                    patch.object(self.store, "clip", return_value={"outputFolder": folder}),
                ):
                    result = await self.client.post(path, json={})
                    self.assertEqual(result.status, 400, await result.text())
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
