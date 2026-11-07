"""A joined extension's audio follows its video and the plain take's interpreted timing.

Joined frame `j` shows render frame `j + shift`; the copy's audio must advance by the measured
shift and play at the sequence rate, then last exactly as long as the joined video. A render
without audio stays without one.
"""

import array
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool import joins
from spool.media import Media
from spool.timing import tempo_filter

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
SIZE = (320, 192)
RATE = 25  # the render's own frame rate; the sequence below runs at 24
FPS = 24
FRAMES = 125  # five seconds at 25 fps, interpreted as 125 frames at 24 fps
BEEP = 2.0
BEEP_LENGTH = 0.1


def encode(path, source, frames, beep=None):
    """`frames` frames of a moving pattern from pattern frame `source`, plus an optional beep."""
    graph = (
        f"testsrc2=size={SIZE[0]}x{SIZE[1]}:rate={RATE},"
        f"trim=start_frame={source}:end_frame={source + frames},setpts=PTS-STARTPTS"
    )
    command = [FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", graph]
    if beep is not None:
        tone = f"aevalsrc=0.8*sin(2*PI*1000*t)*between(t\\,{beep}\\,{beep + BEEP_LENGTH}):s=48000:d={frames / RATE}"
        command += ["-f", "lavfi", "-i", tone, "-c:a", "aac", "-b:a", "192k"]
    command += ["-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p"]
    if beep is not None:
        command += ["-shortest"]
    command.append(str(path))
    subprocess.run(command, check=True)


def probe(path):
    result = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def durations(path):
    streams = probe(path)["streams"]
    video = next((s for s in streams if s["codec_type"] == "video"), None)
    audio = next((s for s in streams if s["codec_type"] == "audio"), None)
    return (
        float(video["duration"]) if video and "duration" in video else None,
        float(audio["duration"]) if audio and "duration" in audio else None,
    )


def beep_time(path, audio_filter=None):
    """When the first loud sample starts in the first audio stream."""
    command = [FFMPEG, "-v", "error", "-i", str(path), "-map", "0:a:0"]
    if audio_filter:
        command += ["-af", audio_filter]
    command += ["-ac", "1", "-ar", "48000", "-f", "f32le", "-"]
    data = subprocess.run(command, check=True, capture_output=True).stdout
    samples = array.array("f")
    samples.frombytes(data)
    return next(index for index, sample in enumerate(samples) if abs(sample) > 0.2) / 48000


def plain_beep_time(path):
    """When the plain take's audio has its beep after the sequence rate retimes it."""
    return beep_time(path, tempo_filter(FPS / RATE))


def request(frozen, overlap=22):
    return {
        "takeId": "take-1",
        "sequenceFps": FPS,
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


@unittest.skipUnless(FFMPEG and FFPROBE, "ffmpeg and ffprobe are required")
class JoinAudioRetimingTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp, ignore_errors=True)
        for name in ("project", "input", "output", "temp"):
            (self.temp / name).mkdir()
        self.media = Media(*(self.temp / n for n in ("project", "input", "output", "temp")), project_id="p")
        # The shot is pattern frames 100..121; the extension is given its last 22.
        encode(self.temp / "input" / "guide.mp4", 100, 22)
        self.render_path = self.temp / "project" / "output" / "take.mp4"

    def render(self, drift, beep=BEEP):
        """A 25 fps extension take: the 22 given frames rendered again, slipped by `drift`."""
        (self.temp / "project" / "output").mkdir(exist_ok=True)
        encode(self.render_path, 100 - drift, FRAMES, beep)
        primary = {
            "artifactId": "a1",
            "kind": "video",
            "width": SIZE[0],
            "height": SIZE[1],
            "frames": FRAMES,
            "duration": FRAMES / RATE,
            "audio": beep is not None,
            "fps": f"{RATE}/1",
            "sequenceFps": FPS,
            "originalFile": "output/take.mp4",
        }
        return {"primary": primary, "artifacts": [dict(primary)]}

    def attached(self, drift, beep=BEEP):
        result = joins.attach(self.media, request("guide.mp4", overlap=22), self.render(drift, beep))
        return result, result["primary"]["join"]

    def test_the_audio_is_retimed_and_follows_the_measured_shift(self):
        for drift in (-1, 0, 1):
            with self.subTest(drift=drift):
                result, join = self.attached(drift)
                self.assertTrue(join["audio"])
                self.assertEqual(join["frames"], FRAMES, "interpreted source frames are preserved")
                self.assertEqual(result["primary"]["originalFile"], "output/take.mp4", "the render is untouched")
                joined = self.media.resolve(join["originalFile"])
                video, audio = durations(joined)
                self.assertAlmostEqual(video, FRAMES / FPS, delta=0.04, msg="the join keeps the take's frame clock")
                self.assertAlmostEqual(audio, video, delta=0.04, msg="the join's audio lasts its own video")
                # A stream copy would still be five seconds; the plain take lasts 125/24.
                self.assertGreater(audio, 5.15)
                # Joined frame j is render frame j + drift, retimed at 24/25 speed.
                expected = plain_beep_time(self.render_path) - drift / FPS
                self.assertAlmostEqual(beep_time(joined), expected, delta=0.015, msg="audio follows the video shift")
                self.assertAlmostEqual(
                    durations(self.render_path)[1], FRAMES / RATE, delta=0.04, msg="the source audio is unchanged"
                )

    def test_a_render_without_audio_joins_without_one(self):
        result, join = self.attached(0, beep=None)
        self.assertFalse(join["audio"])
        self.assertEqual(join["frames"], FRAMES)
        self.assertFalse(
            any(s["codec_type"] == "audio" for s in probe(self.media.resolve(join["originalFile"]))["streams"])
        )
        self.assertEqual(result["primary"]["originalFile"], "output/take.mp4")
        self.assertTrue(list(joins._frames(FFMPEG, self.media.resolve(join["originalFile"]), SIZE)))


if __name__ == "__main__":
    unittest.main()
