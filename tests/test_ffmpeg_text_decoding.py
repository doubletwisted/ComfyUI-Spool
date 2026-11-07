"""Real subprocess diagnostics survive Windows legacy text defaults."""

import contextlib
import locale
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spool.cuts import scene_scores
from spool.export import run_ffmpeg
from spool.media import Media


@contextlib.contextmanager
def legacy_text_default():
    # Windows normally supplies this default. Other CI platforms exercise that
    # same fallback without changing the encoding of the actual child process.
    if locale.getencoding().lower() == "cp1252":
        yield
    else:
        with patch("subprocess._text_encoding", return_value="cp1252"):
            yield


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe required")
class FFmpegTextDecodingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-\u0141-diagnostics-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.ffmpeg = shutil.which("ffmpeg")
        self.thread_errors = []
        hook = patch.object(threading, "excepthook", side_effect=self.thread_errors.append)
        hook.start()
        self.addCleanup(hook.stop)
        self.addCleanup(self.assertEqual, self.thread_errors, [])

    def test_export_failure_retains_the_unicode_source_in_the_validation_error(self):
        missing = self.root / "\u0141-missing.wav"
        with legacy_text_default(), self.assertRaises(ValueError) as caught:
            run_ffmpeg([self.ffmpeg, "-v", "error", "-i", str(missing), "-f", "null", "-"], "Export failed")
        self.assertIn(str(missing), str(caught.exception))
        self.assertFalse(missing.exists())

    def test_scene_failure_retains_decoded_diagnostics_and_does_not_cache_scores(self):
        corrupt = self.root / "\u0141-corrupt.mp4"
        original = b"not a valid movie"
        corrupt.write_bytes(original)
        cache = self.root / "scores"
        with legacy_text_default(), self.assertRaises(subprocess.CalledProcessError) as caught:
            scene_scores(self.ffmpeg, corrupt, cache)
        self.assertIsInstance(caught.exception.stderr, str)
        self.assertIn(str(corrupt), caught.exception.stderr)
        self.assertEqual(corrupt.read_bytes(), original)
        self.assertFalse(cache.exists())

    def test_bake_failure_after_probe_is_readable_cleans_pending_and_can_retry(self):
        (self.root / "input").mkdir()
        media = Media(self.root / "project", self.root / "input", self.root / "output", self.root / "temp")
        source = media.root / "\u0141-tone.wav"
        with wave.open(str(source), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(48000)
            wav.writeframes(b"\0\0" * 48000)
        original = source.read_bytes()
        segment = {"media": {"id": "tone", "file": source.name, "fps": 24}, "start": 0, "in": 0, "out": 24}
        real_run = subprocess.run
        moved = source.with_suffix(".held")
        failed_commands = []

        def disappear_after_validation(command, **kwargs):
            if "-filter_complex" in command and str(source) in command:
                # The real probe and checksum have already read valid audio.
                # Only this operation's source disappears for real FFmpeg.
                source.rename(moved)
                failed_commands.append(command)
                try:
                    return real_run(command, **kwargs)
                finally:
                    moved.rename(source)
            return real_run(command, **kwargs)

        with (
            legacy_text_default(),
            patch("spool.media.subprocess.run", side_effect=disappear_after_validation),
            self.assertRaises(ValueError) as caught,
        ):
            media.bake_audio([segment], 24, 24)
        self.assertEqual(len(failed_commands), 1)
        self.assertIn(str(source), str(caught.exception))
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(list((self.root / "input/spool-baked").iterdir()), [])
        with legacy_text_default():
            result = media.bake_audio([segment], 24, 24)
        output = self.root / "input" / result["file"]
        with wave.open(str(output), "rb") as wav:
            self.assertEqual(wav.getnframes(), 48000)
            self.assertEqual(wav.getnchannels(), 2)
        self.assertEqual(source.read_bytes(), original)

    def test_scene_score_stdout_still_parses_with_unicode_paths(self):
        source = self.root / "\u0141-valid.mp4"
        subprocess.run(
            [self.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=s=32x32:r=24:d=1", "-c:v", "libx264", str(source)],
            check=True,
            capture_output=True,
        )
        with legacy_text_default():
            scores = scene_scores(self.ffmpeg, source, self.root / "scores")
        self.assertEqual(scores, [0.0] * 24)

    def test_invalid_diagnostic_bytes_keep_the_failure_readable(self):
        # A process boundary fixture covers non-UTF-8 tool/build diagnostics;
        # the three other failure cases run the actual installed FFmpeg.
        command = [sys.executable, "-c", "import sys;sys.stderr.buffer.write(b'failure: \\xff\\x81');sys.exit(2)"]
        with legacy_text_default(), self.assertRaisesRegex(ValueError, "failure: \ufffd\ufffd"):
            run_ffmpeg(command, "Export failed")


if __name__ == "__main__":
    unittest.main()
