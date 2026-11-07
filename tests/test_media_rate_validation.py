"""ffprobe frame rates must be usable: invalid clocks fail as ValueError; real rates keep timing."""

import asyncio
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool.media import Media, _rate
from spool.projects import Workspace
from spool.routes import register

FFMPEG, FFPROBE = shutil.which("ffmpeg"), shutil.which("ffprobe")


def video_probe(rate, *, include_rate=True):
    stream = {
        "codec_type": "video",
        "nb_frames": "24",
        "width": 64,
        "height": 36,
        "time_base": "1/24",
    }
    if include_rate:
        stream["avg_frame_rate"] = rate
    return {"streams": [stream], "format": {"duration": "1"}}


class RateValidationTests(unittest.TestCase):
    def test_zero_denominator_nonfinite_and_invalid_rates_are_rejected(self):
        for value in ("0/0", "1/0", "-1/0", "nan", "NaN", "inf", "-inf", "", "N/A", "x/1", "1/2/3", "24/", None):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "no usable frame rate"):
                _rate(value)

    def test_zero_and_negative_rates_are_rejected(self):
        for value in ("0", "0/1", "0.0", "-24", "-24/1"):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "no usable frame rate"):
                _rate(value)

    def test_positive_integer_float_and_rational_rates_are_preserved(self):
        cases = (
            (24, 24.0),
            ("24/1", 24.0),
            ("25", 25.0),
            ("23.976", 23.976),
            ("24000/1001", 24000 / 1001),
            ("30000/1001", 30000 / 1001),
            ("60000/1001", 60000 / 1001),
        )
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(_rate(value), expected)


class ImportRateValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-rate-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("input", "output", "temp"):
            (self.root / name).mkdir()
        self.media = Media(self.root / "store", self.root / "input", self.root / "output", self.root / "temp")
        self.source = self.root / "input" / "probe.mp4"
        self.source.write_bytes(b"ffprobe is mocked for this fixture")

    def test_import_rejects_unusable_probe_rate_before_describing(self):
        for value in ("0/0", "1/0", "nan", "inf"):
            with (
                self.subTest(value=value),
                patch("spool.media._probe", return_value=video_probe(value)),
                patch.object(Media, "describe", side_effect=AssertionError("Describe must not run")),
            ):
                with self.assertRaisesRegex(ValueError, "no usable frame rate"):
                    self.media.import_footage(self.source, detect=False)
        self.assertFalse((self.root / "store" / "shots").exists())

    def test_import_rejects_a_probe_without_a_frame_rate(self):
        with (
            patch("spool.media._probe", return_value=video_probe(None, include_rate=False)),
            patch.object(Media, "describe", side_effect=AssertionError("Describe must not run")),
        ):
            with self.assertRaisesRegex(ValueError, "no usable frame rate"):
                self.media.import_footage(self.source, detect=False)


class ImportRouteValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-rate-route-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = Workspace(self.root / "app")
        for name in ("input", "output", "temp"):
            (self.root / name).mkdir()
        self.media = Media(self.workspace.root, *(self.root / name for name in ("input", "output", "temp")))
        self.source = self.root / "input" / "probe.mp4"
        self.source.write_bytes(b"ffprobe is mocked for this fixture")

    def test_import_footage_route_reports_an_unusable_probe_rate_as_a_validation_error(self):
        async def check():
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.workspace, self.media)
            server.app.cleanup_ctx.clear()
            server.app.add_routes(server.routes)
            with patch("spool.media._probe", return_value=video_probe("0/0")):
                async with TestClient(TestServer(server.app)) as client:
                    response = await client.post(
                        "/spool/api/import-footage",
                        json={"path": str(self.source), "detectCuts": False},
                    )
                    self.assertEqual(response.status, 400)
                    self.assertEqual(
                        await response.json(),
                        {"error": "The video has no usable frame rate", "code": "invalid_request"},
                    )

        asyncio.run(check())


@unittest.skipUnless(FFMPEG and FFPROBE, "ffmpeg and ffprobe are required")
class FractionalImportTimingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-rate-fractional-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("input", "output", "temp"):
            (self.root / name).mkdir()
        self.media = Media(self.root / "store", self.root / "input", self.root / "output", self.root / "temp")
        self.source = self.root / "input" / "fractional.mp4"
        subprocess.run(
            [
                FFMPEG,
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=64x36:r=30000/1001:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(self.source),
            ],
            check=True,
            timeout=120,
        )

    def test_import_keeps_a_positive_fractional_source_rate(self):
        result = self.media.import_footage(self.source, detect=False)
        expected = 30000 / 1001
        source, shot = result["source"], result["shots"][0]
        self.assertAlmostEqual(result["fps"], expected, places=9)
        self.assertAlmostEqual(_rate(source["fps"]), expected, places=9)
        self.assertEqual(source["sequenceFps"], result["fps"])
        self.assertEqual(shot["fps"], source["fps"])
        self.assertEqual(shot["frames"], source["frames"])
        self.assertAlmostEqual(shot["duration"], shot["frames"] / expected, places=9)
        self.assertEqual(shot["review"]["fps"], result["fps"])
        self.assertAlmostEqual(shot["review"]["duration"], shot["duration"], places=9)


if __name__ == "__main__":
    unittest.main()
