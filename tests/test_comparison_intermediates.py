"""Comparison sheets keep their export while removing only their own frame files."""

import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageOps

from spool.media import Media


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required for frame extraction")
class ComparisonIntermediateTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.media = Media(self.root / "project", self.root / "input", self.root / "output", self.root / "temp", "film")
        self.exports = self.media.root / "exports"
        self.clip = {"in": 2, "out": 10, "takes": []}
        self.sources = {}
        for identity, color in (("red", "red"), ("blue", "blue")):
            source = self.media.root / "assets" / (identity + ".png")
            Image.new("RGB", (64, 32), color).save(source)
            self.sources[source] = source.read_bytes()
            self.clip["takes"].append(
                {
                    "id": identity,
                    "media": {
                        "kind": "image",
                        "file": "assets/" + source.name,
                        "frames": 24,
                        "duration": 1,
                        "width": 64,
                        "height": 32,
                        "fps": 24,
                        "audio": False,
                    },
                }
            )
        exported = self.media.export_frame(self.clip["takes"][0]["media"], 0, 24)
        self.user_frame = self.exports / exported["filename"]
        Image.new("RGB", (3, 3), "green").save(self.exports / "comparison-previous.png")
        (self.exports / "spool-frame-unrelated.png").write_bytes(b"An unrelated user file")
        self.kept = {path: path.read_bytes() for path in self.exports.iterdir()}
        self.cache_entries = set(self.media.cache.iterdir())

    def compare(self):
        return self.media.comparison(self.clip, ["red", "blue"], 24)

    def assert_kept(self):
        for path, data in {**self.sources, **self.kept}.items():
            self.assertEqual(path.read_bytes(), data, str(path))

    def assert_only_new(self, paths):
        self.assertEqual(set(self.exports.iterdir()) - set(self.kept), set(paths))
        self.assertEqual(set(self.media.cache.iterdir()), self.cache_entries)
        self.assert_kept()

    def test_success_keeps_the_sheet_and_existing_exports_without_frame_intermediates(self):
        result = self.compare()
        sheet = self.exports / result["url"].rsplit("/", 1)[1]
        self.assertTrue(result["url"].startswith("/spool/media/film/exports/comparison-"))
        self.assertEqual([take["takeId"] for take in result["takes"]], ["red", "blue"])
        self.assertEqual([take["sampleFrame"] for take in result["takes"]], [5, 5])
        with Image.open(sheet) as image:
            self.assertEqual(image.size, (768, 256))
            self.assertEqual(image.getpixel((192, 108)), (255, 0, 0))
            self.assertEqual(image.getpixel((576, 108)), (0, 0, 255))
        self.assert_only_new([sheet])

        later = self.compare()
        later_sheet = self.exports / later["url"].rsplit("/", 1)[1]
        self.assertNotEqual(sheet, later_sheet)
        self.assert_only_new([sheet, later_sheet])

    def test_failed_later_extraction_removes_completed_and_partial_intermediates(self):
        run = subprocess.run
        generated = []
        original_error = subprocess.CalledProcessError(9, ["ffmpeg"], stderr=b"Extraction failed")

        def extract(command, *args, **kwargs):
            output = Path(command[-1])
            generated.append(output)
            if len(generated) == 2:
                output.write_bytes(b"Partial frame")
                raise original_error
            return run(command, *args, **kwargs)

        with patch("spool.media.subprocess.run", side_effect=extract):
            with self.assertRaises(subprocess.CalledProcessError) as raised:
                self.compare()
        self.assertIs(raised.exception, original_error)
        self.assertEqual(len(generated), 2)
        self.assertTrue(all(not path.exists() for path in generated))
        self.assert_only_new([])

    def test_composition_failure_removes_the_extracted_frame(self):
        error = ValueError("Composition failed")
        with patch("spool.media.ImageOps.contain", side_effect=error):
            with self.assertRaises(ValueError) as raised:
                self.compare()
        self.assertIs(raised.exception, error)
        self.assert_only_new([])

    def test_denied_cleanup_preserves_the_original_extraction_error(self):
        original_error = subprocess.TimeoutExpired(["ffmpeg"], 60)
        generated = []
        denied_paths = []
        unlink = os.unlink

        def extract(command, *args, **kwargs):
            output = Path(command[-1])
            generated.append(output)
            output.write_bytes(b"Partial frame")
            raise original_error

        def denied(path, *args, **kwargs):
            if Path(path).name in {output.name for output in generated}:
                denied_paths.append(path)
                raise PermissionError("Intermediate is temporarily locked")
            return unlink(path, *args, **kwargs)

        with patch("spool.media.subprocess.run", side_effect=extract), patch.object(os, "unlink", denied):
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                self.compare()
        self.assertIs(raised.exception, original_error)
        self.assertTrue(denied_paths, "Cleanup must encounter an actual denied filesystem deletion")
        self.assertTrue(generated[0].is_file())
        self.assert_kept()

    def test_final_save_failure_has_no_frame_intermediates(self):
        error = OSError("Comparison destination is full")
        save = Image.Image.save

        def failed(image, destination, *args, **kwargs):
            if Path(destination).parent == self.exports:
                raise error
            return save(image, destination, *args, **kwargs)

        with patch.object(Image.Image, "save", failed):
            with self.assertRaises(OSError) as raised:
                self.compare()
        self.assertIs(raised.exception, error)
        self.assert_only_new([])

    def test_first_comparison_creates_the_durable_export_folder(self):
        media = Media(self.root / "fresh", *self.media.host_roots.values())
        take = self.clip["takes"][0]
        clip = {
            **self.clip,
            "takes": [{**take, "media": {**take["media"], "originalFile": str(next(iter(self.sources)))}}],
        }
        self.assertFalse((media.root / "exports").exists())
        result = media.comparison(clip, [take["id"]], 24)
        self.assertTrue((media.root / "exports" / result["url"].rsplit("/", 1)[1]).is_file())
        self.assertFalse(list(media.cache.glob("spool-comparison-*")))
        self.assert_kept()

    def test_concurrent_comparisons_keep_both_sheets_and_remove_only_their_frames(self):
        barrier = threading.Barrier(2)
        contain = ImageOps.contain

        def overlap(*args, **kwargs):
            barrier.wait(10)
            return contain(*args, **kwargs)

        with patch("spool.media.ImageOps.contain", side_effect=overlap), ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: self.compare(), range(2)))
        sheets = [self.exports / result["url"].rsplit("/", 1)[1] for result in results]
        self.assertEqual(len(set(sheets)), 2)
        self.assert_only_new(sheets)


if __name__ == "__main__":
    unittest.main()
