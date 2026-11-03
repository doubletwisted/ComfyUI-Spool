"""Extension joins on synthetic video: the cut is measured, the overlap is the shot's own frames,
the new frames start where the shot ends, and their brightness dip is eased out."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import ImageChops, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool import joins
from spool.media import Media

FFMPEG = shutil.which("ffmpeg")
SIZE = (320, 192)


def encode(path, source, frames, extra=""):
    """`frames` frames of a moving test pattern starting at pattern frame `source`."""
    graph = (
        f"testsrc2=size={SIZE[0]}x{SIZE[1]}:rate=24,"
        f"trim=start_frame={source}:end_frame={source + frames},setpts=PTS-STARTPTS" + extra
    )
    subprocess.run(
        [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", graph]
        + ["-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )


def request(frozen, overlap=22):
    return {
        "takeId": "take-1",
        "sequenceFps": 24,
        "shotInputs": [
            {
                "clipId": "shot",
                "takeId": "shot-take",
                "in": 0,
                "out": 50,
                "key": "16/file",
                "source": "previous",
                "settings": {"slot": "video", "frame": "last", "frames": overlap},
            }
        ],
        "assets": [{"nodeId": "16", "input": "file", "frozen": frozen}],
    }


@unittest.skipUnless(FFMPEG, "ffmpeg is required")
class JoinTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp, ignore_errors=True)
        for name in ("project", "input", "output", "temp"):
            (self.temp / name).mkdir()
        self.media = Media(*(self.temp / n for n in ("project", "input", "output", "temp")), project_id="p")
        # The shot is pattern frames 0..49; the extension is given its last 22 (28..49).
        encode(self.temp / "input" / "guide.mp4", 28, 22)

    def render(self, drift, dip=True):
        """An extension take: the 22 given frames rendered again (slipped by `drift`), then new frames,
        the first of them darker, as H3 renders them."""
        (self.temp / "project" / "output").mkdir(exist_ok=True)
        path = self.temp / "project" / "output" / "take.mp4"
        darker = ",eq=brightness=-0.025:enable='between(n\\,{0}\\,{1})'".format(22 + drift, 27 + drift) if dip else ""
        encode(path, 28 - drift, 60, darker)
        result = {"primary": {"artifactId": "a1", "kind": "video", "width": SIZE[0], "height": SIZE[1], "frames": 60}}
        result["primary"]["originalFile"] = "output/take.mp4"
        result["artifacts"] = [dict(result["primary"])]
        return result

    def frames(self, path):
        return list(joins._frames(FFMPEG, path, SIZE))

    def test_a_request_that_is_not_an_extension_is_left_alone(self):
        self.assertIsNone(joins.plan({"shotInputs": []}))
        both = request("guide.mp4")
        both["shotInputs"].append({**both["shotInputs"][0], "source": "next"})
        self.assertIsNone(joins.plan(both))
        result = self.render(0)
        self.assertIs(joins.attach(self.media, {"shotInputs": []}, result), result)

    def test_the_cut_is_measured_where_the_render_slips(self):
        for drift in (-1, 0, 1):
            with self.subTest(drift=drift):
                self.render(drift)
                head = joins.measure(
                    FFMPEG, self.temp / "input" / "guide.mp4", self.temp / "project" / "output" / "take.mp4", 22
                )
                self.assertEqual(head, 22 + drift)

    def test_the_joined_copy_continues_the_shot_seamlessly(self):
        result = joins.attach(self.media, request("guide.mp4"), self.render(1))
        join = result["primary"]["join"]
        self.assertEqual(result["artifacts"][0], result["primary"], "the canonical artifact carries the join too")
        self.assertEqual((join["overlap"], join["blend"], join["drift"]), (22, joins.BLEND, 1))
        self.assertEqual(join["parent"], {"clipId": "shot", "takeId": "shot-take", "in": 0, "out": 50})
        self.assertEqual(result["primary"]["originalFile"], "output/take.mp4", "the render itself is untouched")
        joined = self.frames(self.media.resolve(join["originalFile"]))
        guide = self.frames(self.temp / "input" / "guide.mp4")
        render = self.frames(self.temp / "project" / "output" / "take.mp4")
        self.assertEqual(len(joined), 60, "the copy keeps the take's length")
        near = lambda a, b: ImageStat.Stat(ImageChops.difference(a, b)).mean[0] < 6
        self.assertTrue(
            all(near(joined[j], guide[j]) for j in range(22 - joins.BLEND)), "the overlap is the shot's own"
        )
        # The new frames start one later in the render, where it slipped.
        self.assertTrue(all(near(joined[j], render[j + 1]) for j in range(22 + joins.SETTLE, 59)))
        lum = lambda im: sum(ImageStat.Stat(im).mean) / 3
        self.assertLess(lum(render[23]), lum(guide[-1]) - 4, "the render dips")
        self.assertLess(abs(lum(joined[22]) - lum(guide[-1])), 3, "the joined copy does not")

    def test_a_join_that_cannot_be_made_leaves_the_take(self):
        result = self.render(0)
        self.assertIs(joins.attach(self.media, request("missing.mp4"), result), result)
        short = request("guide.mp4", overlap=30)
        self.assertIs(joins.attach(self.media, short, result), result)


if __name__ == "__main__":
    unittest.main()
