"""Owned path imports stay portable; external references and upload scope stay intact."""

import asyncio
import copy
import io
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

from spool.collection import Collector
from spool.media import Media, _probe
from spool.projects import Workspace
from spool.routes import register


FFMPEG, FFPROBE = shutil.which("ffmpeg"), shutil.which("ffprobe")


@unittest.skipUnless(FFMPEG and FFPROBE, "needs ffmpeg and ffprobe")
class PathImportPortabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = tempfile.TemporaryDirectory()
        cls.source = Path(cls.sources.name) / "outside.mp4"
        subprocess.run(
            [
                FFMPEG,
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x48:r=12:d=0.5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                str(cls.source),
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )

    @classmethod
    def tearDownClass(cls):
        cls.sources.cleanup()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.workspace = Workspace(self.root / "app")
        roots = [self.root / name for name in ("input", "output", "temp")]
        for path in roots:
            path.mkdir()
        self.base_media = Media(self.workspace.root, *roots)
        self.project = self.workspace.create(
            {"project": "Portable path import", "fps": 12, "clips": [], "media": []}, self.root / "project"
        )
        self.store = self.workspace.for_project(self.project["id"])
        self.media = self.base_media.for_project(self.store, self.project["id"])

    def originals(self, footage):
        return [footage["source"], *footage["shots"], *([footage["audio"]] if footage["audio"] else [])]

    def assert_owned_originals(self, footage, media):
        records = self.originals(footage)
        self.assertGreaterEqual(len(records), 3, "The video fixture must exercise source, shot and audio")
        original = records[0]["originalFile"]
        self.assertTrue(original.startswith("input/video/"))
        self.assertFalse(Path(original).is_absolute())
        for record in records:
            self.assertEqual(record["originalFile"], original)
            self.assertEqual(media.resolve(original).read_bytes(), self.source.read_bytes())
            self.assertTrue(media.resolve(record["file"]).is_file())

    def test_copied_originals_survive_moving_and_reopening_the_project(self):
        before = self.source.read_bytes()
        kept = self.media.keep_input(self.source)
        self.assertEqual(self.media.keep_input(self.source), kept)
        self.assertNotEqual(kept, self.source)
        footage = self.media.import_footage(kept, detect=False)
        self.assert_owned_originals(footage, self.media)
        self.assertEqual(self.source.read_bytes(), before)
        shot = footage["shots"][0]
        document = copy.deepcopy(self.project["document"])
        document["media"] = [footage["source"], footage["audio"]]
        document["clips"] = [
            {
                "id": "shot",
                "name": "Imported",
                "in": 0,
                "out": shot["frames"],
                "takeId": "take",
                "takes": [{"id": "take", "number": 0, "original": True, "media": shot}],
            }
        ]
        self.store.save(self.project["id"], self.project["revision"], document)
        moved = self.root / "another-mount" / "project"
        moved.parent.mkdir()
        shutil.move(str(self.store.root), moved)
        reopened = Workspace(self.root / "other-app")
        project = reopened.open_folder(moved)
        media = self.base_media.for_project(reopened.for_project(project["id"]), project["id"])
        records = [*project["document"]["media"], project["document"]["clips"][0]["takes"][0]["media"]]
        for record in records:
            self.assertTrue(media.resolve(record["file"]).is_file())
            self.assertEqual(media.original_source(record)["path"], moved / record["originalFile"])
            self.assertTrue(media.original_source(record)["path"].is_file())
        baked = media.bake_shot(records[-1], 0, shot["frames"], 12, "video")
        self.assertEqual(int(_probe(media.input_source(baked["file"]))["streams"][0]["nb_frames"]), shot["frames"])

    def test_explicit_external_and_unscoped_references_stay_in_place(self):
        for media in (self.media, self.base_media):
            with self.subTest(project=media.project_id):
                footage = media.import_footage(self.source, detect=False)
                for record in self.originals(footage):
                    self.assertEqual(record["originalFile"], str(self.source))
        self.assertEqual(self.base_media.keep_input(self.source), self.source)
        self.assertFalse(any(path.is_file() for path in (self.store.root / "input").rglob("*")))

    def test_import_and_upload_routes_use_portable_paths_in_both_host_modes(self):
        async def check():
            async def idle(app):
                yield

            for embedded in (False, True):
                server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
                executor = (
                    SimpleNamespace(collector=Collector(self.workspace, self.base_media), poll=idle)
                    if embedded
                    else None
                )
                register(server, self.workspace, self.base_media, executor)
                server.app.cleanup_ctx.clear()
                server.app.add_routes(server.routes)
                with patch.object(Media, "prepare_playback"):
                    async with TestClient(TestServer(server.app)) as client:
                        response = await client.post(
                            "/spool/api/import-footage?projectId=" + self.project["id"],
                            json={"path": str(self.source), "detectCuts": False},
                        )
                        self.assertEqual(response.status, 200, await response.text())
                        self.assert_owned_originals(await response.json(), self.media)
                        image = io.BytesIO()
                        Image.new("RGB", (32, 16), "blue").save(image, format="PNG")
                        response = await client.post(
                            "/spool/api/upload?projectId=" + self.project["id"],
                            data=image.getvalue(),
                            headers={"X-Filename": "upload.png"},
                        )
                        self.assertEqual(response.status, 200, await response.text())
                        uploaded = await response.json()
                        self.assertTrue(uploaded["originalFile"].startswith("input/images/"))
                        self.assertEqual((uploaded["width"], uploaded["height"]), (32, 16))
                        self.assertTrue(self.media.resolve(uploaded["originalFile"]).is_file())

        asyncio.run(check())

    def test_nonlocal_path_import_is_refused_before_copying(self):
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.base_media)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            with patch.object(Media, "keep_input", side_effect=AssertionError("Must not copy for a nonlocal caller")):
                async with TestClient(TestServer(server.app)) as client:
                    response = await client.post(
                        "/spool/api/import-footage?projectId=" + self.project["id"],
                        json={"path": str(self.source), "detectCuts": False},
                        headers={"Host": "elsewhere.example"},
                    )
                    self.assertEqual(response.status, 403, await response.text())
            self.assertFalse(any(path.is_file() for path in (self.store.root / "input").rglob("*")))

        asyncio.run(check())


if __name__ == "__main__":
    unittest.main()
