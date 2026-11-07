"""OTIO publication retries sharing denials and owns only its unpublished file."""

import errno
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from spool.media import Media
from spool.durable import atomic_replace


class InterchangePublicationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="spool-otio-\u0141-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        roots = [self.root / name for name in ("input", "output", "temp")]
        for root in roots:
            root.mkdir()
        self.media = Media(self.root / "project", *roots)
        self.source = self.media.root / "source.png"
        Image.new("RGB", (8, 8), "red").save(self.source)
        self.source_bytes = self.source.read_bytes()
        self.plan = {
            "fps": 24,
            "width": 320,
            "height": 180,
            "name": "Cut \u0141",
            "duration": 24,
            "tracks": [
                {
                    "kind": "video",
                    "name": "V1",
                    "clips": [{"id": "clip", "file": "source.png", "in": 0, "out": 24, "start": 0}],
                }
            ],
        }
        self.prior = self.media.export_timeline(self.plan)
        self.exports = self.media.root / "exports"
        self.foreign = self.exports / "another-operation.partial"
        self.foreign.write_bytes(b"another writer's bytes")
        self.before = self.files()

    def files(self):
        return {path.name: path.read_bytes() for path in self.exports.iterdir() if path.is_file()}

    def assert_preserved(self):
        self.assertEqual(self.source.read_bytes(), self.source_bytes)
        for name, data in self.before.items():
            self.assertEqual((self.exports / name).read_bytes(), data)

    def assert_export(self, result):
        self.assertEqual(set(result), {"filename", "path", "timeline"})
        self.assertEqual(Path(result["path"]), self.exports / result["filename"])
        self.assertEqual(Path(result["filename"]).suffix, ".otio")
        self.assertEqual(json.loads(Path(result["path"]).read_text(encoding="utf-8")), result["timeline"])
        self.assertEqual(result["timeline"]["OTIO_SCHEMA"], "Timeline.1")
        self.assertEqual(result["timeline"]["name"], self.plan["name"])
        clip = result["timeline"]["tracks"]["children"][0]["children"][0]
        self.assertEqual(clip["media_reference"]["target_url"], str(self.source.resolve()))
        self.assertEqual(clip["source_range"]["duration"]["value"], 24)
        self.assert_preserved()

    def test_transient_sharing_denials_retry_and_publish_the_same_timeline(self):
        replace = Path.replace
        attempts = []

        def busy(source, target):
            attempts.append((source, Path(target)))
            if len(attempts) < 3:
                raise PermissionError(errno.EACCES, "injected transient sharing denial")
            return replace(source, target)

        with patch.object(Path, "replace", busy), patch("spool.durable.time.sleep"):
            result = self.media.export_timeline(self.plan)
        self.assertEqual(len(attempts), 3)
        self.assertEqual(len({source for source, _ in attempts}), 1)
        self.assertFalse(attempts[0][0].exists())
        self.assert_export(result)
        self.assertEqual(set(self.files()), set(self.before) | {result["filename"]})

    def test_failed_publication_removes_only_its_pending_file(self):
        error = OSError(errno.EIO, "injected publication failure")
        with patch.object(Path, "replace", side_effect=error):
            with self.assertRaises(OSError) as raised:
                self.media.export_timeline(self.plan)
        self.assertIs(raised.exception, error)
        self.assertEqual(self.files(), self.before)
        self.assert_preserved()

    def test_exhausted_sharing_retries_remove_only_the_owned_pending(self):
        error = PermissionError(errno.EACCES, "injected persistent sharing denial")
        with patch.object(Path, "replace", side_effect=error) as replace, patch("spool.durable.time.sleep"):
            with self.assertRaises(PermissionError) as raised:
                self.media.export_timeline(self.plan)
        self.assertIs(raised.exception, error)
        self.assertGreater(replace.call_count, 1)
        self.assertEqual(self.files(), self.before)
        self.assert_preserved()

    def fail_write(self, error):
        def write(value, handle, **kwargs):
            handle.write('{"unfinished":')
            raise error

        return write

    def test_partial_json_write_failure_is_cleaned_without_changing_prior_exports(self):
        error = OSError(errno.ENOSPC, "injected partial JSON write failure")
        with patch("spool.interchange.json.dump", side_effect=self.fail_write(error)):
            with self.assertRaises(OSError) as raised:
                self.media.export_timeline(self.plan)
        self.assertIs(raised.exception, error)
        self.assertEqual(self.files(), self.before)
        self.assert_preserved()

    def denied_cleanup(self, attempted):
        unlink = Path.unlink

        def denied(path, *args, **kwargs):
            if path.parent == self.exports and path != self.foreign and path.suffix == ".partial":
                attempted.append(path)
                raise PermissionError("injected cleanup denial")
            return unlink(path, *args, **kwargs)

        return denied

    def test_cleanup_denial_preserves_the_primary_write_error(self):
        error = OSError(errno.ENOSPC, "primary write failure")
        attempted = []
        with (
            patch("spool.interchange.json.dump", side_effect=self.fail_write(error)),
            patch.object(Path, "unlink", self.denied_cleanup(attempted)),
        ):
            with self.assertRaises(OSError) as raised:
                self.media.export_timeline(self.plan)
        self.assertIs(raised.exception, error)
        self.assertEqual(len(attempted), 1)
        self.assertEqual(attempted[0].read_text(encoding="utf-8"), '{"unfinished":')
        self.assertEqual(set(self.files()), set(self.before) | {attempted[0].name})
        self.assert_preserved()

    def test_cleanup_denial_preserves_the_primary_publication_error(self):
        error = OSError(errno.EIO, "primary publication failure")
        attempted = []
        with (
            patch.object(Path, "replace", side_effect=error),
            patch.object(Path, "unlink", self.denied_cleanup(attempted)),
        ):
            with self.assertRaises(OSError) as raised:
                self.media.export_timeline(self.plan)
        self.assertIs(raised.exception, error)
        self.assertEqual(len(attempted), 1)
        self.assertEqual(json.loads(attempted[0].read_text(encoding="utf-8"))["OTIO_SCHEMA"], "Timeline.1")
        self.assertEqual(set(self.files()), set(self.before) | {attempted[0].name})
        self.assert_preserved()

    def test_pending_name_collision_does_not_truncate_or_remove_another_writers_file(self):
        output = self.exports / ("Cut-\u0141-" + "a" * 10 + ".otio")
        output.write_bytes(Path(self.prior["path"]).read_bytes())
        pending = output.with_name(output.name + "." + "b" * 32 + ".partial")
        pending.write_bytes(b"pending bytes belonging to another operation")
        self.before = self.files()
        identities = [SimpleNamespace(hex="a" * 32), SimpleNamespace(hex="b" * 32)]
        with patch("spool.interchange.uuid.uuid4", side_effect=identities):
            with self.assertRaises(FileExistsError):
                self.media.export_timeline(self.plan)
        self.assertEqual(self.files(), self.before)
        self.assert_preserved()

    def test_concurrent_exports_own_distinct_partials_and_both_publish(self):
        barrier = threading.Barrier(2)
        pending_paths = []
        lock = threading.Lock()

        def publish(pending, output):
            self.assertEqual(json.loads(pending.read_text(encoding="utf-8"))["OTIO_SCHEMA"], "Timeline.1")
            with lock:
                pending_paths.append(pending)
            barrier.wait(timeout=5)
            return atomic_replace(pending, output)

        with patch("spool.interchange.atomic_replace", side_effect=publish), ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.media.export_timeline, self.plan) for _ in range(2)]
            results = [future.result(timeout=5) for future in futures]
        self.assertEqual(len(set(pending_paths)), 2)
        self.assertEqual(len({result["filename"] for result in results}), 2)
        for result in results:
            self.assert_export(result)
        self.assertTrue(all(not pending.exists() for pending in pending_paths))
        self.assertEqual(set(self.files()), set(self.before) | {result["filename"] for result in results})

    @unittest.skipUnless(os.name == "nt", "Native Windows delete-sharing semantics")
    def test_native_windows_sharing_denial_retries_real_rename(self):
        """Inject a real temporary reader without FILE_SHARE_DELETE; do not mock rename errors."""
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        ]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        denials = []
        replace = Path.replace

        def publish(pending, output):
            handle = kernel.CreateFileW(str(pending), 0x80000000, 3, None, 3, 0, None)
            if handle == wintypes.HANDLE(-1).value:
                raise ctypes.WinError(ctypes.get_last_error())
            release = threading.Event()

            def close_reader():
                release.wait(timeout=5)
                kernel.CloseHandle(handle)

            reader = threading.Thread(target=close_reader)
            reader.start()

            def observed_replace(source, target):
                try:
                    return replace(source, target)
                except PermissionError as error:
                    if source == pending:
                        denials.append(error.winerror)
                        release.set()
                    raise

            try:
                with patch.object(Path, "replace", observed_replace):
                    return atomic_replace(pending, output)
            finally:
                release.set()
                reader.join(timeout=5)
                self.assertFalse(reader.is_alive())

        with patch("spool.interchange.atomic_replace", side_effect=publish):
            result = self.media.export_timeline(self.plan)
        self.assertTrue(denials)
        self.assertTrue(all(code in (32, 33) for code in denials))
        self.assert_export(result)
        self.assertEqual(set(self.files()), set(self.before) | {result["filename"]})


if __name__ == "__main__":
    unittest.main()
