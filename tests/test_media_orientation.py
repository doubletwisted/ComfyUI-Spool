import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageOps

from spool.media import Media, _video_display_size


class MediaOrientationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("input", "output", "temp"):
            (self.root / name).mkdir()
        self.media = Media(self.root / "store", self.root / "input", self.root / "output", self.root / "temp")

    def test_all_exif_orientations_match_pillows_decoded_dimensions(self):
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                path = self.root / "input" / f"orientation-{orientation}.jpg"
                image = Image.new("RGB", (64, 48), "red")
                exif = Image.Exif()
                exif[274] = orientation
                image.save(path, exif=exif)
                before = path.read_bytes()
                metadata = self.media.describe(path)
                with Image.open(path) as original:
                    display = ImageOps.exif_transpose(original)
                    self.assertEqual((metadata["width"], metadata["height"]), display.size)
                self.assertEqual(path.read_bytes(), before)
                self.assertEqual(metadata["frames"], 120)

    def test_legacy_rotation_and_matrix_precedence(self):
        stream = {"width": 64, "height": 48, "tags": {"rotate": "90"}}
        self.assertEqual(_video_display_size(stream), (48, 64))
        stream["side_data_list"] = [{"side_data_type": "Display Matrix", "rotation": 0}]
        self.assertEqual(_video_display_size(stream), (64, 48))
        stream["side_data_list"][0]["rotation"] = -90
        self.assertEqual(_video_display_size(stream), (48, 64))

    def test_arbitrary_and_invalid_rotations_do_not_invent_an_expanded_canvas(self):
        for rotation in (45, -45, 360, "invalid", "NaN", "Infinity"):
            with self.subTest(rotation=rotation):
                stream = {"width": 64, "height": 48, "tags": {"rotate": rotation}}
                self.assertEqual(_video_display_size(stream), (64, 48))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe")
    def test_real_display_matrices_match_ffmpegs_decoded_frame(self):
        source = self.root / "input" / "coded.mp4"
        ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
        subprocess.run(
            [
                ffmpeg,
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=64x48:r=2:d=1",
                "-c:v",
                "libx264",
                str(source),
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )
        for rotation, flipped in (
            (0, False),
            (90, False),
            (180, False),
            (270, False),
            (-90, False),
            (45, False),
            (90, True),
        ):
            with self.subTest(rotation=rotation, flipped=flipped):
                path = source.with_name(f"display-{rotation}-{flipped}.mp4")
                command = [ffmpeg, "-v", "error", "-y"]
                if flipped:
                    help_text = subprocess.run(
                        [ffmpeg, "-h", "full"], capture_output=True, check=True, timeout=30
                    ).stdout
                    if b"-display_hflip" not in help_text:
                        self.skipTest("this ffmpeg cannot create a reflected display-matrix fixture")
                    command += ["-display_rotation", str(rotation), "-display_hflip"]
                command += ["-i", str(source), "-map", "0", "-c", "copy"]
                if not flipped:
                    command += ["-metadata:s:v:0", f"rotate={rotation}"]
                command += [str(path)]
                subprocess.run(command, capture_output=True, check=True, timeout=30)
                raw = subprocess.run(
                    [ffmpeg, "-v", "error", "-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"],
                    capture_output=True,
                    check=True,
                    timeout=30,
                ).stdout
                probe = json.loads(
                    subprocess.run(
                        [ffprobe, "-v", "error", "-show_streams", "-of", "json", str(path)],
                        capture_output=True,
                        check=True,
                        timeout=30,
                    ).stdout
                )
                video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
                self.assertEqual((video["width"], video["height"]), (64, 48))
                with Image.open(io.BytesIO(raw)) as decoded:
                    metadata = self.media.describe(path)
                    self.assertEqual((metadata["width"], metadata["height"]), decoded.size)
                self.assertEqual(
                    (metadata["probe"]["streams"][0]["width"], metadata["probe"]["streams"][0]["height"]), (64, 48)
                )


if __name__ == "__main__":
    unittest.main()
