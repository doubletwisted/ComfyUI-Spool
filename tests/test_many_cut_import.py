"""Bounded split commands retain exact cuts and the review files' short GOPs."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.media import Media, _SPLIT_COMMAND_BUDGET, _command_length, _probe, _split_commands, sha256

FFPROBE = shutil.which("ffprobe")
FFMPEG = shutil.which("ffmpeg", path=str(Path(FFPROBE).parent)) if FFPROBE else None
FFMPEG_FOLDER = str(Path(FFPROBE).parent) if FFPROBE else None
WINDOWS_COMMAND_LIMIT = 32767


def _frame_color(index):
    return (16 + (index % 10) * 24, 16 + ((index // 10) % 10) * 24, 16 + ((index // 100) % 10) * 24)


def _make_source(path, rate, frames, audio=False):
    images = path.parent / (path.stem + "-frames")
    images.mkdir()
    for index in range(frames):
        Image.new("RGB", (64, 36), _frame_color(index)).save(images / f"{index:05d}.png")
    command = [FFMPEG, "-v", "error", "-y", "-framerate", rate, "-i", str(images / "%05d.png")]
    if audio:
        command += [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:a",
            "aac",
            "-shortest",
        ]
    command += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "6", "-bf", "0", str(path)]
    subprocess.run(command, check=True, capture_output=True, timeout=120)
    shutil.rmtree(images)
    return path


class SplitCommandTests(unittest.TestCase):
    def assert_plan(self, commands, cuts, frames):
        reconstructed, start, first = [], 0, 0
        for command in commands:
            length = len(subprocess.list2cmdline(command).encode("utf-16-le")) // 2 + 1
            self.assertEqual(_command_length(command), length)
            self.assertLess(length, WINDOWS_COMMAND_LIMIT)
            self.assertLessEqual(length, _SPLIT_COMMAND_BUDGET)
            self.assertEqual(command[command.index("-g") + 1], "6")
            count = int(command[command.index("-frames:v") + 1])
            local = []
            if "-segment_frames" in command:
                local = list(map(int, command[command.index("-segment_frames") + 1].split(",")))
                expression = command[command.index("-force_key_frames") + 1]
                self.assertTrue(expression.startswith("expr:"))
                self.assertEqual([int(value) for value in re.findall(r"eq\(n,(\d+)\)", expression)], local)
                self.assertEqual(int(command[command.index("-segment_start_number") + 1]), first)
            else:
                self.assertEqual(Path(command[-1]).name, f"{first:03d}.mp4")
            if start:
                reconstructed.append(start)
                self.assertIn("-copyts", command)
                self.assertLess(int(command[command.index("-ss") + 1][:-2]), start * 1_000_000 * 1001 // 30000)
            reconstructed.extend(start + cut for cut in local)
            start += count
            first += len(local) + 1
        self.assertEqual(reconstructed, cuts)
        self.assertEqual(start, frames)

    def test_1800_and_20000_cut_plans_bound_both_lists_and_encode_every_frame_once(self):
        # Structural command evidence with a consistent large proxy frame count;
        # this does not claim to encode an 1800-shot import or its posters.
        for count in (1800, 20000):
            with self.subTest(cuts=count):
                cuts = [10000 + index * 10 for index in range(count)]
                frames = cuts[-1] + 1000
                commands = list(
                    _split_commands(
                        "C:/tools/ffmpeg.exe",
                        Path("C:/source clip's żółć 🧵/proxy.mp4"),
                        Path("C:/project ' ü 🧵/shots"),
                        cuts,
                        frames,
                        Fraction(30000, 1001),
                        Fraction(1, 30000),
                    )
                )
                self.assertGreater(len(commands), 1)
                self.assertLess(len(commands), count // 100)
                self.assert_plan(commands, cuts, frames)

    def test_budget_includes_quoted_paths_and_surrogate_pairs(self):
        folder = Path("C:/" + "long folder 🧵 ' " * 300 + "/shots")
        commands = list(
            _split_commands(
                "ffmpeg",
                Path("source clip's ü.mp4"),
                folder,
                list(range(1, 5000)),
                5001,
                Fraction(30000, 1001),
                Fraction(1, 30000),
            )
        )
        self.assertGreaterEqual(len(commands), 4)
        self.assert_plan(commands, list(range(1, 5000)), 5001)
        with self.assertRaisesRegex(ValueError, "path is too long"):
            list(_split_commands("ffmpeg", Path("🧵" * 13000), folder, [], 1, None, None))

    def test_frame_target_meets_at_cuts_and_keeps_a_long_shot_whole(self):
        with patch("spool.media._SPLIT_BATCH_FRAMES", 100):
            commands = list(
                _split_commands(
                    "ffmpeg",
                    Path("proxy.mp4"),
                    Path("shots"),
                    [7, 99, 123, 500, 550],
                    600,
                    Fraction(30000, 1001),
                    Fraction(1, 30000),
                )
            )
        self.assertEqual([int(c[c.index("-frames:v") + 1]) for c in commands], [99, 24, 377, 100])
        self.assert_plan(commands, [7, 99, 123, 500, 550], 600)


@unittest.skipUnless(FFMPEG and FFPROBE, "ffmpeg and ffprobe are required")
class ManyCutImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Scoped to this Python process; the machine PATH is never modified.
        cls.path = patch.dict(os.environ, {"PATH": FFMPEG_FOLDER + os.pathsep + os.environ.get("PATH", "")})
        cls.path.start()
        cls.fixtures = tempfile.TemporaryDirectory(prefix="spool-many-cut-fixtures-")
        cls.addClassCleanup(cls.fixtures.cleanup)
        cls.addClassCleanup(cls.path.stop)
        folder = Path(cls.fixtures.name)
        cls.sources = {
            "30": (_make_source(folder / "source clip's żółć 30.mp4", "30000/1001", 600, audio=True), 600),
            "24": (_make_source(folder / "source clip's żółć 24.mp4", "24000/1001", 480), 480),
        }

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spool-many-cut-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project ' ü"
        self.root.mkdir()
        for name in ("input", "output", "temp"):
            (self.root / name).mkdir()
        self.media = Media(self.root / "store", self.root / "input", self.root / "output", self.root / "temp")

    def import_with_cuts(self, source, cuts, fps):
        with patch("spool.media.scene_scores", return_value=[]), patch("spool.media.detect_cuts", return_value=cuts):
            return self.media.import_footage(source, fps=fps)

    def test_worst_many_cut_batch_executes_with_a_real_full_length_source(self):
        source = self.root / "parser-source.mp4"
        frames = 28020
        subprocess.run(
            [
                FFMPEG,
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=red:s=64x36:r=30000/1001",
                "-frames:v",
                str(frames),
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-g",
                "6",
                "-bf",
                "0",
                str(source),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
        stream = _probe(source)["streams"][0]
        folder = self.root / "parser-shots"
        folder.mkdir()
        cuts = [10000 + index * 10 for index in range(1800)]
        commands = list(
            _split_commands(
                FFMPEG,
                source,
                folder,
                cuts,
                frames,
                Fraction(stream["avg_frame_rate"]),
                Fraction(stream["time_base"]),
                int(stream.get("start_pts", 0)),
            )
        )
        command = max(commands, key=_command_length)
        local_cuts = command[command.index("-segment_frames") + 1].split(",")
        self.assertGreater(len(local_cuts), 100)
        self.assertLessEqual(_command_length(command), _SPLIT_COMMAND_BUDGET)
        result = subprocess.run(command, capture_output=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace")[-2000:])
        segments = sorted(folder.glob("*.mp4"), key=lambda path: int(path.stem))
        self.assertEqual(len(segments), len(local_cuts) + 1)
        # A single decoder checks the entire real batch without one ffprobe
        # process per shot. Relative numeric names need no path escaping.
        manifest = folder / "verify.ffconcat"
        manifest.write_text("ffconcat version 1.0\n" + "".join(f"file '{path.name}'\n" for path in segments))
        counted = subprocess.run(
            [
                FFPROBE,
                "-v",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(manifest),
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=nb_read_frames",
                "-of",
                "json",
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
        self.assertEqual(
            int(json.loads(counted.stdout)["streams"][0]["nb_read_frames"]),
            int(command[command.index("-frames:v") + 1]),
        )

    def shot_color(self, path, frame, width=960, height=540):
        raw = subprocess.run(
            [
                FFMPEG,
                "-v",
                "error",
                "-i",
                str(path),
                "-vf",
                f"select=eq(n\\,{frame})",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ],
            check=True,
            capture_output=True,
            timeout=60,
        ).stdout
        offset = ((height // 2) * width + width // 2) * 3
        return tuple(raw[offset : offset + 3])

    def assert_color(self, actual, expected):
        self.assertEqual(len(actual), 3)
        for got, want in zip(actual, expected):
            # Below half the 24-level frame step, so an adjacent frame fails.
            self.assertLessEqual(abs(got - want), 8, (actual, expected))

    def assert_short_gop(self, path, count):
        frames = json.loads(
            subprocess.run(
                [
                    FFPROBE,
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_frames",
                    "-show_entries",
                    "frame=key_frame",
                    "-of",
                    "json",
                    str(path),
                ],
                check=True,
                capture_output=True,
                timeout=60,
            ).stdout
        )["frames"]
        self.assertEqual(len(frames), count)
        keys = [index for index, frame in enumerate(frames) if frame["key_frame"]]
        self.assertEqual(keys[0], 0)
        self.assertLessEqual(max(b - a for a, b in zip(keys, [*keys[1:], count])), 6)

    def test_fractional_imports_cross_batches_with_exact_ranges_colors_and_short_gops(self):
        cases = {"30": [7, 143, 213, 391, 512], "24": [5, 129, 211, 317, 401]}
        for key, cuts in cases.items():
            with self.subTest(rate=key):
                source, frame_count = self.sources[key]
                before = sha256(source)
                rate = 30000 / 1001 if key == "30" else 24000 / 1001
                whole_before = self.media.describe(source, fps=rate)
                proxy = self.media.resolve(whole_before["file"])
                proxy_before = sha256(proxy)
                real_run, batches = subprocess.run, []

                def capture(command, **options):
                    if "-frames:v" in command and "-c:v" in command:
                        batches.append(command)
                    return real_run(command, **options)

                with (
                    patch("spool.media._SPLIT_BATCH_FRAMES", 180),
                    patch("spool.media.subprocess.run", side_effect=capture),
                ):
                    result = self.import_with_cuts(source, cuts, rate)
                self.assertGreaterEqual(len(batches), 3)
                whole = result["source"]
                self.assertEqual(whole["frames"], frame_count)
                self.assertEqual(
                    [(s["sourceRange"]["start"], s["frames"]) for s in result["shots"]],
                    [(start, end - start) for start, end in zip([0, *cuts], [*cuts, frame_count])],
                )
                self.assertEqual(sum(s["frames"] for s in result["shots"]), frame_count)
                self.assertEqual(
                    [s["name"] for s in result["shots"]], [f"Shot {i + 1:02d}" for i in range(len(cuts) + 1)]
                )
                for index, shot in enumerate(result["shots"]):
                    file = self.media.resolve(shot["file"])
                    self.assertEqual(file.name, f"{index:03d}.mp4")
                    self.assertFalse(Path(shot["file"]).is_absolute())
                    self.assertTrue(self.media.resolve(shot["poster"]).is_file())
                    self.assertEqual(int(_probe(file)["streams"][0]["nb_frames"]), shot["frames"])
                    self.assertFalse(shot["audio"])
                    self.assertFalse(any(s["codec_type"] == "audio" for s in _probe(file)["streams"]))
                    self.assertEqual(shot["sourceFrameCount"], frame_count)
                    self.assertEqual(shot["review"]["frames"], shot["frames"])
                    self.assertEqual(shot["originalFile"], str(source))
                    start = shot["sourceRange"]["start"]
                    self.assert_color(self.shot_color(file, 0), _frame_color(start))
                    self.assert_color(
                        self.shot_color(file, shot["frames"] - 1), _frame_color(start + shot["frames"] - 1)
                    )
                    self.assert_short_gop(file, shot["frames"])
                self.assertEqual(sha256(source), before)
                self.assertEqual(sha256(proxy), proxy_before)
                folder = self.media.resolve(result["shots"][0]["file"]).parent
                self.assertEqual({path.suffix for path in folder.iterdir()}, {".mp4", ".jpg"})
                self.assertEqual(result["audio"] is not None, key == "30")
                if result["audio"] is not None:
                    self.assertEqual(result["audio"]["kind"], "audio")
                    self.assertEqual(result["audio"]["originalFile"], str(source))
                    self.assertEqual(result["audio"]["frames"], frame_count)
                    self.assertTrue(self.media.resolve(result["audio"]["file"]).is_file())

    def test_large_fractional_offsets_seek_to_the_exact_boundary(self):
        # A local temporary 64x36 proxy proves seek/PTS math far beyond the small
        # import fixture, without committing a binary or encoding large posters.
        frame_count, cuts = 10053, [10000, 10007, 10023, 10043]
        for clock in ("30000/1001", "24000/1001"):
            with self.subTest(clock=clock):
                source = self.root / (clock.replace("/", "-") + ".mp4")
                pixels = b"".join(bytes(_frame_color(n)) * (64 * 36) for n in range(frame_count))
                subprocess.run(
                    [
                        FFMPEG,
                        "-v",
                        "error",
                        "-y",
                        "-f",
                        "rawvideo",
                        "-pix_fmt",
                        "rgb24",
                        "-s",
                        "64x36",
                        "-r",
                        clock,
                        "-i",
                        "-",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "ultrafast",
                        "-pix_fmt",
                        "yuv420p",
                        "-g",
                        "6",
                        "-bf",
                        "0",
                        str(source),
                    ],
                    input=pixels,
                    check=True,
                    capture_output=True,
                    timeout=120,
                )
                del pixels
                before = sha256(source)
                stream = _probe(source)["streams"][0]
                folder = source.with_suffix("")
                folder.mkdir()
                with patch("spool.media._SPLIT_BATCH_FRAMES", 10005):
                    commands = list(
                        _split_commands(
                            FFMPEG,
                            source,
                            folder,
                            cuts,
                            frame_count,
                            Fraction(clock),
                            Fraction(stream["time_base"]),
                        )
                    )
                self.assertGreater(len(commands), 1)
                for command in commands:
                    subprocess.run(command, check=True, capture_output=True, timeout=120)
                for index, (start, end) in enumerate(zip([0, *cuts], [*cuts, frame_count])):
                    file = folder / f"{index:03d}.mp4"
                    self.assertEqual(int(_probe(file)["streams"][0]["nb_frames"]), end - start)
                    self.assert_color(self.shot_color(file, 0, 64, 36), _frame_color(start))
                    self.assert_color(self.shot_color(file, end - start - 1, 64, 36), _frame_color(end - 1))
                    self.assert_short_gop(file, end - start)
                self.assertEqual(sha256(source), before)

    def test_zero_and_one_cut_imports_keep_the_same_shot_contract(self):
        source, frame_count = self.sources["24"]
        fps = 24000 / 1001
        whole = self.media.import_footage(source, fps=fps, detect=False)
        one = self.import_with_cuts(source, [123], fps)
        for result, expected in ((whole, [(0, frame_count)]), (one, [(0, 123), (123, frame_count - 123)])):
            self.assertEqual([(s["sourceRange"]["start"], s["frames"]) for s in result["shots"]], expected)
            for shot in result["shots"]:
                self.assert_short_gop(self.media.resolve(shot["file"]), shot["frames"])

    def test_project_owned_original_and_all_shot_paths_stay_relative_across_batches(self):
        media = Media(
            self.root / "owned", self.root / "input", self.root / "output", self.root / "temp", project_id="project"
        )
        source, frame_count = self.sources["30"]
        kept = media.keep_input(source)
        before = sha256(kept)
        with (
            patch("spool.media._SPLIT_BATCH_FRAMES", 180),
            patch("spool.media.scene_scores", return_value=[]),
            patch("spool.media.detect_cuts", return_value=[7, 213, 391, 512]),
        ):
            result = media.import_footage(kept, fps=30000 / 1001)
        for item in [result["source"], *result["shots"], result["audio"]]:
            self.assertFalse(Path(item["file"]).is_absolute())
            self.assertTrue(item["originalFile"].startswith("input/video/"))
            self.assertEqual(media.resolve(item["originalFile"]), kept)
        self.assertEqual(sum(s["frames"] for s in result["shots"]), frame_count)
        self.assertEqual(sha256(kept), before)

    def test_large_import_production_seam_captures_all_batches_before_verification(self):
        source, _ = self.sources["30"]
        for count in (1800, 20000):
            with self.subTest(cuts=count):
                cuts = [10000 + index * 10 for index in range(count)]
                frames = cuts[-1] + 1000
                proxy = self.media.cache / "previews" / "large simulated proxy.mp4"
                proxy.parent.mkdir(exist_ok=True)
                proxy.write_bytes(b"mocked proxy with a consistent large frame count")
                captured = []

                class StopBeforePosters(Exception):
                    pass

                def probe(path):
                    if Path(path).parent.parent.name == "shots":
                        raise StopBeforePosters()
                    return {
                        "streams": [
                            {
                                "codec_type": "video",
                                "avg_frame_rate": "30000/1001",
                                "time_base": "1/30000",
                                "nb_frames": str(frames),
                            }
                        ]
                    }

                def capture(command, **options):
                    captured.append(command)
                    (Path(command[-1]).parent / "incomplete.mp4").write_bytes(b"owned partial")

                with (
                    patch.object(
                        self.media,
                        "describe",
                        return_value={"frames": frames, "file": proxy.relative_to(self.media.root).as_posix()},
                    ),
                    patch("spool.media._probe", side_effect=probe),
                    patch("spool.media.subprocess.run", side_effect=capture),
                    patch("spool.media.scene_scores", return_value=[]),
                    patch("spool.media.detect_cuts", return_value=cuts),
                    self.assertRaises(StopBeforePosters),
                ):
                    self.media.import_footage(source, fps=30000 / 1001)
                SplitCommandTests().assert_plan(captured, cuts, frames)
                self.assertEqual(list((self.media.cache / "shots").glob("*")), [])
                self.assertEqual(proxy.read_bytes(), b"mocked proxy with a consistent large frame count")

    def test_failures_remove_only_the_owned_operation_folder_and_audio_partial(self):
        source, _ = self.sources["30"]
        fps = 30000 / 1001
        whole = self.media.describe(source, fps=fps)
        proxy = self.media.resolve(whole["file"])
        source_hash, proxy_hash = sha256(source), sha256(proxy)
        other = self.media.cache / "shots" / "another-operation"
        other.mkdir(parents=True)
        sentinel = other / "keep.mp4"
        sentinel.write_bytes(b"another import's asset")
        previews_before = {p.name for p in proxy.parent.iterdir()}
        real_run, real_probe, real_describe = subprocess.run, _probe, self.media.describe
        for failure in ("batch2", "verification", "poster", "audio", "audio-describe"):
            with self.subTest(failure=failure):
                batches = []

                def run(command, **options):
                    target = Path(command[-1])
                    is_split = "-frames:v" in command and "-c:v" in command
                    if is_split:
                        batches.append(command)
                    fail = (
                        (failure == "batch2" and is_split and len(batches) == 2)
                        or (failure == "poster" and target.suffix == ".jpg" and target.parent.parent.name == "shots")
                        or (failure == "audio" and target.name.endswith("-audio.m4a"))
                    )
                    if fail:
                        target.with_name("injected.partial" if is_split else target.name).write_bytes(b"partial")
                        raise subprocess.CalledProcessError(1, command, stderr=b"injected failure")
                    return real_run(command, **options)

                def probe(path):
                    result = real_probe(path)
                    if failure == "verification" and Path(path).parent.parent.name == "shots":
                        result["streams"][0]["nb_frames"] = "999"
                    return result

                def describe(path, *args, **kwargs):
                    if failure == "audio-describe" and str(path).endswith("-audio.m4a"):
                        raise ValueError("injected audio verification failure")
                    return real_describe(path, *args, **kwargs)

                with (
                    patch("spool.media._SPLIT_BATCH_FRAMES", 180),
                    patch("spool.media.subprocess.run", side_effect=run),
                    patch("spool.media._probe", side_effect=probe),
                    patch.object(self.media, "describe", side_effect=describe),
                    self.assertRaises((ValueError, subprocess.CalledProcessError)),
                ):
                    self.import_with_cuts(source, [7, 143, 213, 391, 512], fps)
                if failure == "batch2":
                    self.assertEqual(len(batches), 2)
                self.assertEqual(list((self.media.cache / "shots").iterdir()), [other])
                self.assertEqual(sentinel.read_bytes(), b"another import's asset")
                self.assertEqual({p.name for p in proxy.parent.iterdir()}, previews_before)
                self.assertEqual(sha256(source), source_hash)
                self.assertEqual(sha256(proxy), proxy_hash)

    def test_duplicate_and_invalid_cuts_still_fail_without_publishing_shots(self):
        source, frame_count = self.sources["24"]
        for cuts in ([123, 123], [0], [-1], [frame_count], [frame_count + 1], [123, 60]):
            with self.subTest(cuts=cuts), self.assertRaises(ValueError):
                self.import_with_cuts(source, cuts, 24000 / 1001)
            self.assertEqual(list((self.media.cache / "shots").glob("*")), [])


if __name__ == "__main__":
    unittest.main()
