import asyncio
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestServer, TestClient
from PIL import Image

from spool import requests, templates
from spool.cloud import CloudExecutor, execution_prompt, storage_call
from spool.collection import Collector
from spool.media import Media
from spool.store import Store, empty_project
from spool.routes import register


class CloudSDKTests(unittest.IsolatedAsyncioTestCase):
    """Use the real AsyncComfy client against a controlled v2 HTTP server."""

    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.store = Store(self.root / "store")
        for kind in ("input", "output", "temp"):
            (self.root / kind).mkdir()
        self.media = Media(self.store.root, self.root / "input", self.root / "output", self.root / "temp")
        Image.new("RGB", (32, 32), "red").save(self.root / "input" / "source.png")
        video = self.root / "sample.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=32x32:r=24:d=0.5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(video),
            ],
            check=True,
            capture_output=True,
        )
        self.video = video.read_bytes()
        document = empty_project()
        document["clips"] = [
            {
                "id": "shot",
                "name": "SDK shot",
                "in": 0,
                "out": 12,
                "count": 1,
                "revision": 1,
                "takeId": "original",
                "takes": [
                    {
                        "id": "original",
                        "number": 1,
                        "media": {"id": "original", "kind": "image", "frames": 12, "file": "assets/black.png"},
                    }
                ],
            }
        ]
        self.project = self.store.create(document)
        capture = templates.cloud_capture("api_ltx2_5_i2v")
        capture.pop("definitions")
        for i, binding in enumerate(capture["bindings"]):
            binding["key"] = "control-" + str(i)
            if binding.get("asset"):
                capture["prompt"][binding["nodeId"]]["inputs"][binding["input"]] = "source.png"
        self.output_id = capture["result"]["nodeId"]
        shot = self.project["document"]["clips"][0]
        shot.update(
            workflowVersion="sdk-recipe",
            bindings=capture["bindings"],
            inputValues={b["key"]: capture["prompt"][b["nodeId"]]["inputs"][b["input"]] for b in capture["bindings"]},
        )
        self.project = self.store.save(
            self.project["id"], self.project["revision"], self.project["document"], {"sdk-recipe": capture}
        )
        self.submissions, self.uploads, self.downloads = [], [], 0
        self.job_status, self.download_error, self.submit_error, self.free_tier = "succeeded", False, False, False
        app = web.Application()
        app.router.add_head("/api/v2/assets/by-hash/{hash}", self.head_asset)
        app.router.add_post("/api/v2/assets", self.upload)
        app.router.add_post("/api/v2/jobs", self.submit)
        app.router.add_get("/api/v2/jobs/cloud-job", self.get_job)
        app.router.add_post("/api/v2/jobs/cloud-job/cancel", self.cancel)
        app.router.add_get("/api/v2/assets/cloud-output/content", self.download)
        self.server = TestServer(app)
        await self.server.start_server()
        self.addAsyncCleanup(self.server.close)
        self.address = str(self.server.make_url("")).rstrip("/")
        self.environment = patch.dict(os.environ, {"COMFY_BASE_URL": self.address})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.key = patch("spool.cloud.cloud_key", return_value="comfyui-sdk-fixture")
        self.key.start()
        self.addCleanup(self.key.stop)
        self.collector = Collector(self.store, self.media)
        self.executor = CloudExecutor(self.store, self.media, self.collector)

    def job(self, status):
        date = "2026-10-20T12:00:00Z"
        outputs = (
            [
                {
                    "node_id": self.output_id,
                    "name": "result.mp4",
                    "type": "video",
                    "content_type": "video/mp4",
                    "size_bytes": len(self.video),
                    "id": "cloud-output",
                    "hash": None,
                    "url": self.address + "/api/v2/assets/cloud-output/content",
                    "url_expires_at": "2027-01-01T00:00:00Z",
                    "job_id": "cloud-job",
                }
            ]
            if status == "succeeded"
            else []
        )
        return {
            "id": "cloud-job",
            "status": status,
            "created_at": date,
            "started_at": date,
            "completed_at": date if outputs else None,
            "expires_at": "2027-01-01T00:00:00Z",
            "queue_position": None,
            "progress": None,
            "outputs": outputs,
            "error": None,
            "urls": {
                "self": "/api/v2/jobs/cloud-job",
                "events": "/api/v2/jobs/cloud-job/events",
                "cancel": "/api/v2/jobs/cloud-job/cancel",
            },
        }

    async def head_asset(self, request):
        return web.Response(status=404)

    async def upload(self, request):
        self.assertEqual(request.headers["Authorization"], "Bearer comfyui-sdk-fixture")
        parts, data = await request.multipart(), {}
        async for part in parts:
            data[part.name] = bytes(await part.read())
        self.uploads.append(data)
        return web.json_response(
            {
                "id": "input-asset",
                "hash": data["expected_hash"].decode(),
                "size_bytes": len(data["file"]),
                "content_type": "image/png",
                "file_path": "source.png",
                "created_at": "2026-10-20T12:00:00Z",
                "url": self.address + "/input",
                "url_expires_at": "2027-01-01T00:00:00Z",
            },
            status=201,
        )

    async def submit(self, request):
        self.submissions.append({"key": request.headers["Idempotency-Key"], "body": await request.json()})
        if self.submit_error:
            return web.json_response({"code": "internal_error", "message": "Controlled ambiguous submit"}, status=500)
        if self.free_tier:
            # The reply Comfy Cloud gave a free-tier key on 2026-10-26.
            return web.json_response(
                {"code": "forbidden", "message": "API key authentication is not available for free tier accounts"},
                status=403,
            )
        return web.json_response(self.job("queued"), status=201)

    async def get_job(self, request):
        return web.json_response(self.job(self.job_status))

    async def cancel(self, request):
        self.job_status = "canceled"
        return web.json_response(self.job("canceled"))

    async def download(self, request):
        self.downloads += 1
        if self.download_error:
            return web.Response(status=500)
        return web.Response(body=self.video, content_type="video/mp4")

    async def accept(self, operation="sdk-operation"):
        result = await asyncio.to_thread(
            requests.accept,
            self.store,
            self.media,
            self.project["id"],
            self.project["revision"],
            [{"clipId": "shot", "count": 1}],
            operation,
            "human",
        )
        identity = result["document"]["jobs"][-1]["id"]
        return self.store.attempt(identity)

    async def test_sdk_upload_submit_restart_download_receipt_and_idempotent_ingestion(self):
        attempt = await self.accept()
        self.assertEqual(attempt["request"]["target"], "cloud")
        await self.executor.observe(attempt)
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "queued")
        self.assertEqual(self.submissions[0]["key"], attempt["id"])
        body = self.submissions[0]["body"]
        self.assertEqual(body["extra_data"], {"api_key_comfy_org": "comfyui-sdk-fixture"})
        source = next(n for n in body["workflow"].values() if n["class_type"] == "LoadImage")
        self.assertEqual(source["inputs"]["image"]["__type"], "core/ASSET")
        self.assertTrue(self.uploads)
        restarted = CloudExecutor(self.store, self.media, self.collector)
        await restarted.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")
        self.assertTrue(self.media.receipt_path(attempt).is_file())
        project = self.store.get(self.project["id"])
        clip = project["document"]["clips"][0]
        self.assertEqual(clip["takeId"], "original")
        self.assertEqual(len(clip["takes"]), 2)
        generated = next(t for t in clip["takes"] if t.get("generated"))
        self.assertEqual(self.media.resolve(generated["media"]["originalFile"]).read_bytes(), self.video)
        await restarted.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(len(self.submissions), 1)
        self.assertEqual(len(self.store.get(self.project["id"])["document"]["clips"][0]["takes"]), 2)
        for value in [
            self.store.export_project(self.project["id"]),
            self.store.dispatch_record(attempt["id"]),
            json.loads(self.media.receipt_path(attempt).read_text(encoding="utf-8")),
        ]:
            self.assertNotIn("comfyui-sdk-fixture", json.dumps(value))

    async def test_download_failure_retries_collection_without_resubmitting(self):
        attempt = await self.accept()
        await self.executor.observe(attempt)
        self.download_error = True
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "collection_pending")
        self.download_error = False
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")
        self.assertEqual(len(self.submissions), 1)

    async def check_flux3_capture(self, template_id, generator):
        capture = templates.cloud_capture(template_id)
        capture.pop("definitions")
        for index, binding in enumerate(capture["bindings"]):
            binding["key"] = "flux-" + str(index)
            if binding.get("asset"):
                capture["prompt"][binding["nodeId"]]["inputs"][binding["input"]] = "source.png"
        self.output_id = capture["result"]["nodeId"]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", capture)
        attempt = await self.accept()
        await self.executor.observe(attempt)
        submitted = self.submissions[0]["body"]["workflow"]
        self.assertTrue(any(node["class_type"] == generator for node in submitted.values()))
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")
        self.assertTrue(self.media.receipt_path(attempt).is_file())
        clip = self.store.get(self.project["id"])["document"]["clips"][0]
        self.assertEqual(clip["takeId"], "original")
        generated = next(take for take in clip["takes"] if take.get("generated"))
        self.assertEqual(self.media.resolve(generated["media"]["originalFile"]).read_bytes(), self.video)

    async def test_flux3_image_to_video_upload_and_take_ingestion(self):
        await self.check_flux3_capture("api_bfl_flux3_i2v", "Flux3ImageToVideoNode")
        self.assertTrue(self.uploads)

    async def test_flux3_text_to_video_submission_and_take_ingestion(self):
        await self.check_flux3_capture("api_bfl_flux3_t2v", "Flux3TextToVideoNode")
        self.assertFalse(self.uploads)

    async def test_flux3_builtin_http_capture_allows_a_bound_missing_example_image(self):
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.store, self.media)
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        async with TestClient(TestServer(server.app)) as client:
            catalog = await (await client.get("/spool/api/templates")).json()
            self.assertEqual(sum(row["family"] == "FLUX 3" for row in catalog), 2)
            capture = await (await client.get("/spool/api/templates/api_bfl_flux3_i2v/capture")).json()
            for index, binding in enumerate(capture["bindings"]):
                binding["key"] = "flux-" + str(index)
            response = await client.post(
                "/spool/api/projects/" + self.project["id"] + "/capture/shot",
                json={"revision": self.project["revision"], "capture": capture},
            )
            self.assertEqual(response.status, 200, await response.text())
            project = await response.json()
            recipe = project["recipes"][project["document"]["clips"][0]["workflowVersion"]]
            self.assertTrue(recipe["inputRecovery"]["missing"])
            self.assertTrue(
                any(binding["slot"] == "firstFrame" for binding in recipe["bindings"] if binding.get("asset"))
            )

    def reference_shot(self, values):
        capture = templates.cloud_capture("api_minimax_h3_r2v")
        capture.pop("definitions")
        self.output_id = capture["result"]["nodeId"]
        shot = self.project["document"]["clips"][0]
        shot.update(
            workflowVersion="reference-recipe",
            bindings=capture["bindings"],
            inputValues={
                **{b["key"]: capture["prompt"][b["nodeId"]]["inputs"][b["input"]] for b in capture["bindings"]},
                **values,
            },
        )
        self.project = self.store.save(
            self.project["id"], self.project["revision"], self.project["document"], {"reference-recipe": capture}
        )

    async def test_reference_to_video_sends_only_the_chosen_references(self):
        (self.root / "input" / "motion.mp4").write_bytes(self.video)
        # The image sits in the second slot; it is sent as Image 1.
        self.reference_shot({"4/image": "source.png", "7/file": "motion.mp4"})
        attempt = await self.accept()
        await self.executor.observe(attempt)
        submitted = self.submissions[0]["body"]["workflow"]
        self.assertEqual(
            sorted(n["class_type"] for n in submitted.values()),
            ["LoadImage", "LoadVideo", "MinimaxHailuo03ReferenceNode", "SaveVideo"],
        )
        references = {k: v for k, v in submitted["2"]["inputs"].items() if ".reference_" in k}
        self.assertEqual(
            references, {"model.reference_images.image_1": ["3", 0], "model.reference_videos.video_1": ["7", 0]}
        )
        self.assertEqual(len(self.uploads), 2)
        request = self.store.attempt(attempt["id"])["request"]
        self.assertEqual(request["omittedInputs"], ["4/image", "5/image", "6/image", "8/audio"])
        self.assertEqual(request["inputValues"]["3/image"], "source.png")
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")

    async def test_reference_to_video_needs_an_image_or_video(self):
        (self.root / "input" / "voice.wav").write_bytes(b"RIFF")
        self.reference_shot({"8/audio": "voice.wav"})
        with self.assertRaisesRegex(ValueError, "Add a reference image or video"):
            await self.accept()
        self.assertFalse(self.submissions)

    async def test_ambiguous_submission_is_never_automatically_repeated(self):
        self.submit_error = True
        attempt = await self.accept()
        await self.executor.observe(attempt)
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "uncertain")
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(len(self.submissions), 1)

    async def test_free_tier_rejection_fails_once_and_suggests_partner_nodes(self):
        self.free_tier = True
        attempt = await self.accept()
        await self.executor.observe(attempt)
        stored = self.store.attempt(attempt["id"])
        self.assertEqual(stored["status"], "failed")
        self.assertIn("free tier", stored["error"])
        self.assertIn("Local ComfyUI · Partner Nodes", stored["error"])
        self.assertNotIn("comfyui-sdk-fixture", stored["error"])
        await self.executor.observe(stored)
        self.assertEqual(len(self.submissions), 1)

    async def test_cancel_before_a_job_id_was_recorded_ends_cancelled(self):
        self.submit_error = True
        attempt = await self.accept()
        await self.executor.observe(attempt)
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "uncertain")
        self.store.transition(attempt["id"], "cancel_requested")
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancelled")
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancelled")
        self.assertEqual(len(self.submissions), 1)

    async def test_claimed_cloud_job_cancels_through_sdk(self):
        attempt = await self.accept()
        await self.executor.observe(attempt)
        self.job_status = "running"
        self.store.transition(attempt["id"], "cancel_requested")
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "cancelled")
        self.assertEqual(self.downloads, 0)

    async def test_standalone_http_queue_collects_without_a_local_comfy_executor(self):
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.store, self.media)
        server.app.add_routes(server.routes)
        complete = asyncio.Event()
        loop = asyncio.get_running_loop()
        ingest = Collector.ingest

        def observed_ingest(collector, attempt):
            result = ingest(collector, attempt)
            if result:
                loop.call_soon_threadsafe(complete.set)
            return result

        with patch.object(Collector, "ingest", observed_ingest):
            await self.check_standalone_completion(server, complete)

    async def check_standalone_completion(self, server, complete):
        async with TestClient(TestServer(server.app)) as client:
            health = await (await client.get("/spool/api/health")).json()
            self.assertFalse(health["executor"])
            response = await client.post(
                "/spool/api/projects/" + self.project["id"] + "/queue",
                json={
                    "revision": self.project["revision"],
                    "items": [{"clipId": "shot", "count": 1}],
                    "operationId": "standalone-cloud",
                },
            )
            self.assertEqual(response.status, 200)
            identity = (await response.json())["document"]["jobs"][0]["id"]
            await asyncio.wait_for(complete.wait(), 10)
            self.assertEqual(self.store.attempt(identity)["status"], "complete")
            self.assertEqual(len(self.submissions), 1)
            self.assertFalse(self.store.host()["connected"])

    async def test_slow_cloud_storage_and_finalization_leave_loop_available(self):
        for name in ("setting", "claim", "dispatched", "set_setting", "transition", "finish_download"):
            with self.subTest(name=name):
                attempt = await self.accept("slow-" + name)
                loop, loop_thread = asyncio.get_running_loop(), threading.get_ident()
                entered, release = asyncio.Event(), threading.Event()
                target = self.executor if name == "finish_download" else self.store
                original = getattr(target, name)

                def blocked(*args, **kwargs):
                    self.assertNotEqual(threading.get_ident(), loop_thread)
                    loop.call_soon_threadsafe(entered.set)
                    self.assertTrue(release.wait(5), "Test did not release Cloud storage")
                    return original(*args, **kwargs)

                async def render():
                    await self.executor.observe(attempt)
                    await self.executor.observe(self.store.attempt(attempt["id"]))

                with patch.object(target, name, side_effect=blocked):
                    task = asyncio.create_task(render())
                    try:
                        await asyncio.wait_for(entered.wait(), 5)
                        self.assertFalse(task.done())
                    finally:
                        release.set()
                        await task
                self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")

    async def test_storage_cancellation_waits_for_the_inflight_write(self):
        loop = asyncio.get_running_loop()
        entered, released = asyncio.Event(), threading.Event()
        finished = threading.Event()

        def write():
            loop.call_soon_threadsafe(entered.set)
            self.assertTrue(released.wait(5))
            finished.set()

        task = asyncio.create_task(storage_call(write))
        await asyncio.wait_for(entered.wait(), 5)
        task.cancel()
        # A queued loop callback runs after cancellation has reached storage_call.
        turn = loop.create_future()
        loop.call_soon(turn.set_result, None)
        await turn
        self.assertFalse(task.done())
        released.set()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(finished.is_set())

    async def test_source_checksum_change_prevents_cloud_submission(self):
        attempt = await self.accept()
        asset = attempt["request"]["assets"][0]
        (self.root / "input" / asset["frozen"]).write_bytes(b"changed")
        await self.executor.observe(attempt)
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "failed")
        self.assertFalse(self.submissions)

    async def test_late_success_after_cancel_request_is_still_collected(self):
        attempt = await self.accept()
        await self.executor.observe(attempt)
        self.store.transition(attempt["id"], "cancel_requested")
        await self.executor.observe(self.store.attempt(attempt["id"]))
        self.assertEqual(self.store.attempt(attempt["id"])["status"], "complete")


class CloudTemplateTests(unittest.TestCase):
    def test_cloud_api_captures_run_without_local_schemas_or_serialization(self):
        for row in templates.CATALOG.values():
            if row["section"] != "cloud":
                continue
            capture = templates.cloud_capture(row["id"])
            graph = execution_prompt(capture["prompt"], capture["result"]["nodeId"])
            self.assertEqual(sum(n["class_type"] == "SaveVideo" for n in graph.values()), 1, row["id"])
            self.assertFalse(any("Loader" in n["class_type"] for n in graph.values()), row["id"])
            self.assertTrue(all(capture["definitions"].get(n["class_type"]) for n in graph.values()), row["id"])
            self.assertEqual(capture["executionTarget"], "cloud")
