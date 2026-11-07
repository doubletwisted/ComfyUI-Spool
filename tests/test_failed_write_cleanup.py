"""Failed staging and final mux writes clean only their own unpublished files."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spool.export import export_sequence
from spool.media import Media


class InputStagingCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-stage-cleanup-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.media = Media(
            self.root / "project", self.root / "input", self.root / "output", self.root / "temp", project_id="p1"
        )
        self.source = self.media.root / "input/images/source.png"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"new source")
        self.target = self.root / "input/spool-projects/p1/input/images/source.png"
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(b"older published staged input")
        self.pending = self.target.with_name("owned-operation.partial")
        self.unrelated = self.target.with_name("unrelated.partial")
        self.unrelated.write_bytes(b"another operation's bytes")
        uid = patch("spool.media.uid", return_value="owned-operation")
        uid.start()
        self.addCleanup(uid.stop)

    def assert_preserved(self):
        self.assertEqual(self.source.read_bytes(), b"new source")
        self.assertEqual(self.target.read_bytes(), b"older published staged input")
        self.assertEqual(self.unrelated.read_bytes(), b"another operation's bytes")

    def failing_copy(self, error):
        def copy(source, destination):
            self.assertEqual(Path(source), self.source)
            self.assertEqual(Path(destination), self.pending)
            Path(destination).write_bytes(b"partial copied bytes")
            raise error

        return copy

    def test_a_partial_copy_failure_removes_only_its_pending_file(self):
        error = OSError("injected copy failure")
        with patch("spool.media.shutil.copy2", side_effect=self.failing_copy(error)):
            with self.assertRaises(OSError) as raised:
                self.media.stage_input(self.source)
        self.assertIs(raised.exception, error)
        self.assertFalse(self.pending.exists())
        self.assert_preserved()

    def test_a_replace_failure_removes_the_copied_pending_file(self):
        error = PermissionError("injected replacement failure")
        original_replace = Path.replace

        def replace(source, destination):
            if source == self.pending:
                self.assertEqual(Path(destination), self.target)
                self.assertEqual(source.read_bytes(), b"new source")
                raise error
            return original_replace(source, destination)

        with patch.object(Path, "replace", replace):
            with self.assertRaises(PermissionError) as raised:
                self.media.stage_input(self.source)
        self.assertIs(raised.exception, error)
        self.assertFalse(self.pending.exists())
        self.assert_preserved()

    def test_cleanup_failure_preserves_the_original_copy_exception(self):
        error = OSError("original copy error")
        original_unlink = Path.unlink
        attempted = []

        def unlink(path, *args, **kwargs):
            if path == self.pending:
                attempted.append(path)
                raise PermissionError("cleanup was denied")
            return original_unlink(path, *args, **kwargs)

        with (
            patch("spool.media.shutil.copy2", side_effect=self.failing_copy(error)),
            patch.object(Path, "unlink", unlink),
        ):
            with self.assertRaises(OSError) as raised:
                self.media.stage_input(self.source)
        self.assertIs(raised.exception, error)
        self.assertEqual(attempted, [self.pending])
        self.assert_preserved()

    def test_success_publishes_and_reuses_the_staged_input(self):
        with patch("spool.media.shutil.copy2", wraps=shutil.copy2) as copy:
            name = self.media.stage_input(self.source)
            self.assertEqual(self.media.stage_input(self.source), name)
        self.assertEqual(name, "spool-projects/p1/input/images/source.png")
        self.assertEqual(copy.call_count, 1)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertFalse(self.pending.exists())
        self.assertEqual(self.unrelated.read_bytes(), b"another operation's bytes")


class ExportMuxCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-export-cleanup-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "image.png"
        self.source.write_bytes(b"source image")
        self.folder = self.root / "exports"
        self.folder.mkdir()
        self.output = self.folder / "spool-0123456789.mp4"
        self.previous = self.folder / "previous-success.mp4"
        self.previous.write_bytes(b"successful export")
        self.unrelated = self.folder / "another-operation.partial.mp4"
        self.unrelated.write_bytes(b"unrelated in-progress export")
        self.commands = []

    def run_export(self, failure=None):
        def run(command, **kwargs):
            self.commands.append(command)
            destination = Path(command[-1])
            destination.write_bytes(b"partial mux bytes" if destination == self.output and failure else b"complete")
            if destination == self.output:
                if isinstance(failure, BaseException):
                    raise failure
                if failure:
                    return subprocess.CompletedProcess(command, 1, stdout="", stderr="injected mux failure")
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

        with (
            patch("spool.export.find_tool", return_value="fixture-ffmpeg"),
            patch("spool.export.subprocess.run", side_effect=run),
            patch("spool.export.uuid.uuid4", return_value=SimpleNamespace(hex="0123456789abcdef")),
        ):
            return export_sequence(
                {"audio": False, "clips": [{"file": "image.png", "in": 0, "out": 24}]},
                root=self.root,
                resolve=lambda name: self.root / name,
                probe=lambda source: {"streams": []},
                image_extensions={".png"},
            )

    def assert_preserved(self):
        self.assertEqual(self.source.read_bytes(), b"source image")
        self.assertEqual(self.previous.read_bytes(), b"successful export")
        self.assertEqual(self.unrelated.read_bytes(), b"unrelated in-progress export")
        # Clip and concat outputs are owned by TemporaryDirectory, independently
        # of the final mux output exposed under exports/.
        for command in self.commands[:-1]:
            self.assertFalse(Path(command[-1]).exists())

    def test_nonzero_mux_exit_removes_the_partial_mp4(self):
        with self.assertRaisesRegex(ValueError, "injected mux failure"):
            self.run_export("nonzero")
        self.assertEqual(len(self.commands), 3)
        self.assertFalse(self.output.exists())
        self.assert_preserved()

    def test_mux_timeout_removes_the_partial_mp4_and_preserves_the_timeout(self):
        error = subprocess.TimeoutExpired(["fixture-ffmpeg"], 180)
        with self.assertRaises(subprocess.TimeoutExpired) as raised:
            self.run_export(error)
        self.assertIs(raised.exception, error)
        self.assertFalse(self.output.exists())
        self.assert_preserved()

    def test_cleanup_failure_preserves_the_original_mux_exception(self):
        error = subprocess.TimeoutExpired(["fixture-ffmpeg"], 180)
        original_unlink = Path.unlink
        attempted = []

        def unlink(path, *args, **kwargs):
            if path == self.output:
                attempted.append(path)
                raise PermissionError("cleanup was denied")
            return original_unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", unlink):
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                self.run_export(error)
        self.assertIs(raised.exception, error)
        self.assertEqual(attempted, [self.output])
        self.assert_preserved()

    def test_success_keeps_the_complete_export_and_its_returned_url(self):
        result = self.run_export()
        self.assertEqual(result, {"url": "exports/spool-0123456789.mp4", "filename": "spool-0123456789.mp4"})
        self.assertEqual(self.output.read_bytes(), b"complete")
        self.assert_preserved()


if __name__ == "__main__":
    unittest.main()
