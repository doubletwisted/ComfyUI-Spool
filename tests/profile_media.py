"""Reproducible media timings on generated footage; no user files or running host."""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.media import Media


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence")
    options = parser.parse_args()
    root = Path(options.evidence).resolve()
    root.mkdir(parents=True, exist_ok=True)
    source = root / "red-blue.mp4"
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not shutil.which("ffprobe"):
        parser.error("Install ffmpeg and ffprobe to profile media preparation")
    if not source.exists():
        subprocess.run(
            [
                ffmpeg,
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=960x540:r=24:d=12",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=960x540:r=24:d=12",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=24",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                "-map",
                "[v]",
                "-map",
                "2:a",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                str(source),
            ],
            check=True,
        )
    media = Media(root, root, root, root)
    steps = []
    original_run = subprocess.run
    calls = []

    def observed(command, *args, **kwargs):
        started = time.perf_counter()
        try:
            return original_run(command, *args, **kwargs)
        finally:
            stage = (
                "scene-scores" if any("metadata=print:file=-" in str(arg) for arg in command) else Path(command[0]).stem
            )
            calls.append({"stage": stage, "ms": round((time.perf_counter() - started) * 1000, 2)})

    def measure(label, operation):
        calls.clear()
        started = time.perf_counter()
        value = operation()
        steps.append({"label": label, "ms": round((time.perf_counter() - started) * 1000, 2), "processes": list(calls)})
        return value

    with patch("spool.media.subprocess.run", side_effect=observed):
        metadata = measure("describe-cold", lambda: media.describe(source))
        measure("describe-warm", lambda: media.describe(source))
        first = measure("cuts-cold", lambda: media.find_cuts(metadata, 24, 0, 576))
        repeated = measure("cuts-repeat", lambda: media.find_cuts(metadata, 24, 0, 576))
        trimmed = measure("cuts-trimmed", lambda: media.find_cuts(metadata, 24, 24, 552))
        reopened = Media(root, root, root, root)
        restored = measure("cuts-reopened", lambda: reopened.find_cuts(metadata, 24, 0, 576))
    assert first == repeated == restored == [288]
    assert trimmed == [264]
    result = {
        "footage": {"seconds": 24, "width": 960, "height": 540, "fps": 24, "audio": True},
        "cuts": first,
        "steps": steps,
    }
    (root / "measurements.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
