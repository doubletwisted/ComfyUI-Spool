"""Playback queue coordination, cache identity and legacy cleanup, without timed sleeps."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

from PIL import Image

from spool.media import Media
from spool.playback import PlaybackQueue
from spool.projects import Workspace
from spool import ledger


class PlaybackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.media = Media(self.root, self.root, self.root, self.root)
        self.source = self.root / "source.png"
        Image.new("RGB", (8, 8)).save(self.source)
        self.record = {"id": "source", "kind": "image", "file": "source.png"}

    def test_cache_key_fingerprint_size_rate_and_version(self):
        key = self.media.preview_path(self.record, 960, 540, 24)
        self.assertEqual(
            key, self.media.preview_path({**self.record, "id": "shot", "sourceRange": {"start": 24}}, 960, 540, 24)
        )
        self.assertNotEqual(key, self.media.preview_path(self.record, 960, 540, 30))
        self.assertNotEqual(key, self.media.preview_path(self.record, 1280, 720, 24))
        with patch("spool.media.PLAYBACK_VERSION", "next-format"):
            self.assertNotEqual(key, self.media.preview_path(self.record, 960, 540, 24))
        self.assertEqual(key, self.media.preview_path(self.record, 960, 540, 24.0))
        stamp = self.source.stat()
        os.utime(self.source, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1000000))
        self.assertNotEqual(key, self.media.preview_path(self.record, 960, 540, 24))
        changed = self.media.preview_path(self.record, 960, 540, 24)
        self.source.write_bytes(self.source.read_bytes() + b"extra")
        self.assertNotEqual(changed, self.media.preview_path(self.record, 960, 540, 24))
        other = self.root / "other.png"
        other.write_bytes(self.source.read_bytes())
        self.assertNotEqual(
            self.media.preview_path(self.record, 960, 540, 24),
            self.media.preview_path({**self.record, "file": "other.png"}, 960, 540, 24),
        )
        self.assertNotEqual(key.parent, self.media.cache / "previews")

    def test_preparation_orders_chosen_takes_before_other_sources(self):
        queue = PlaybackQueue()
        self.addCleanup(queue.close)
        self.media.playback = queue
        chosen = {**self.record, "id": "chosen"}
        other = {**self.record, "id": "other", "file": "other.png"}
        document = {
            "clips": [
                {
                    "takeId": "chosen-take",
                    "takes": [{"id": "other-take", "media": other}, {"id": "chosen-take", "media": chosen}],
                }
            ],
            "resolution": {"width": 1280, "height": 720},
            "fps": 30,
        }
        with patch.object(queue, "submit") as submit:
            self.media.prepare_playback(document)
        self.assertEqual(submit.call_args_list[0].args, (self.media, chosen, 1280, 720, 30))
        self.assertTrue(any(call.args[1] == other for call in submit.call_args_list))
        # The chosen take is listed twice in the document but checked once.
        self.assertEqual(len(submit.call_args_list), 2)

    def test_project_roots_are_resolved_once_they_exist(self):
        from spool import media as media_module

        later = self.root / "later"
        with patch.object(media_module, "RESOLVED_ROOTS", {}) as held:
            media_module.contained(later, "a.png")
            self.assertNotIn(str(later), held)
            later.mkdir()
            self.assertEqual(media_module.contained(later, "a.png"), later.resolve() / "a.png")
            self.assertIn(str(later), held)
            with self.assertRaisesRegex(ValueError, "escapes"):
                media_module.contained(later, "../outside.png")

    def test_legacy_quality_is_dropped_and_old_playback_is_evictable(self):
        workspace = Workspace(self.root / "workspace")
        project = workspace.create({"clips": [], "previewQuality": "quarter"})
        store = workspace.for_project(project["id"])
        self.assertNotIn("previewQuality", project["document"])
        self.assertNotIn("previewQuality", ledger.authored({"clips": [], "previewQuality": "half"}))
        old = store.cache / "previews" / ("a" * 24 + ".mp4")
        old.write_bytes(b"obsolete playback")
        report = store.prune(confirm=True, budget=0, grace=0)
        self.assertEqual(report["evicted"], [old.relative_to(store.root).as_posix()])
        self.assertFalse(old.exists())

    def test_queue_bounds_work_deduplicates_and_retries_failures(self):
        queue = PlaybackQueue()
        self.addCleanup(queue.close)
        entered, release, second_entered = Event(), Event(), Event()
        original = self.media.preview

        def encode(record, *args):
            if record["id"] == "first":
                entered.set()
                if not release.wait(10):
                    raise AssertionError("Encoder not released")
            else:
                second_entered.set()
            return original(record, *args)

        first = {**self.record, "id": "first"}
        with patch.object(self.media, "preview", encode):
            pending = queue.submit(self.media, first, 960, 540, 24)
            try:
                self.assertTrue(entered.wait(2))
                self.assertIs(queue.submit(self.media, self.record, 960, 540, 24), pending)
                second = queue.submit(self.media, self.record, 1280, 720, 24)
                self.assertFalse(second_entered.is_set())
                self.assertEqual(queue.status(self.media, self.record, 960, 540, 24), {"state": "preparing"})
            finally:
                release.set()
            pending.result(timeout=10)
            second.result(timeout=10)
            self.assertTrue(second_entered.is_set())
            self.assertEqual(queue.status(self.media, self.record, 960, 540, 24)["state"], "ready")
        with patch.object(self.media, "preview", side_effect=ValueError("encoder failed")):
            failed = queue.submit(self.media, self.record, 320, 180, 24)
            with self.assertRaisesRegex(ValueError, "encoder failed"):
                failed.result(timeout=10)
            with self.assertRaisesRegex(ValueError, "encoder failed"):
                queue.status(self.media, self.record, 320, 180, 24)
        queue.submit(self.media, self.record, 320, 180, 24).result(timeout=10)

    def test_shutdown_reaps_active_encoder_and_removes_partial_output(self):
        queue = PlaybackQueue()
        self.media.playback = queue
        source = self.root / "video.mp4"
        source.write_bytes(b"video fixture")
        record = {"id": "video", "kind": "video", "file": source.name, "fps": "24/1"}
        entered, release = Event(), Event()
        process = Mock(returncode=-15)
        process.kill.side_effect = release.set

        def communicate(**kwargs):
            entered.set()
            if not release.wait(10):
                raise AssertionError("Encoder was not stopped")
            return b"", b"terminated"

        process.communicate.side_effect = communicate

        def start(command, **kwargs):
            Path(command[-1]).write_bytes(b"partial video")
            return process

        def old_run(command, **kwargs):
            start(command)
            communicate()
            raise subprocess.CalledProcessError(-15, command)

        shutdown = queue.executor.shutdown

        def join(**kwargs):
            # Check ordering without blocking shutdown on a deliberately held encode.
            process.kill.assert_called_once()
            shutdown(**kwargs)

        with (
            patch("spool.media.find_tool", return_value="ffmpeg"),
            patch("subprocess.Popen", side_effect=start),
            patch("subprocess.run", side_effect=old_run),
            patch.object(queue.executor, "shutdown", side_effect=join),
        ):
            pending = queue.submit(self.media, record, 960, 540, 24)
            try:
                self.assertTrue(entered.wait(5))
                queue.close()
                self.assertTrue(pending.done())
                self.assertIsInstance(pending.exception(), subprocess.CalledProcessError)
                process.communicate.assert_called_once()
                self.assertEqual(list(self.media.playback_cache.glob("*.mp4")), [])
            finally:
                release.set()
                shutdown(wait=True, cancel_futures=True)
