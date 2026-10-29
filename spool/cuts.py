"""Hard-cut detection from ffmpeg scene scores of a constant-frame-rate proxy."""

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

# A cut is an isolated spike: dark shots score low in absolute terms, while
# whip pans and dissolves raise their neighbours' scores too.
WINDOW = 4
RATIO = 8
MINIMUM = 0.04
SCORE_VERSION = 1


def scene_scores(ffmpeg, video, cache_dir=None):
    if not ffmpeg:
        raise ValueError("Install ffmpeg for cut detection")
    video = Path(video)
    stat = video.stat()
    cache, signature = None, None
    if cache_dir is not None:
        tool = Path(shutil.which(ffmpeg) or ffmpeg).resolve()
        tool_stat = tool.stat()
        signature = [
            SCORE_VERSION,
            os.path.normcase(str(video.resolve())),
            stat.st_size,
            stat.st_mtime_ns,
            str(tool),
            tool_stat.st_size,
            tool_stat.st_mtime_ns,
        ]
        key = hashlib.sha256(json.dumps(signature).encode()).hexdigest()
        cache = Path(cache_dir) / (key + ".json")
        try:
            stored = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(stored, dict) and stored.get("source") == signature:
                scores = stored.get("scores")
                if isinstance(scores, list) and all(
                    type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in scores
                ):
                    return scores
        except (OSError, ValueError):
            pass
    result = subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(video),
            "-an",
            "-vf",
            "select='gte(scene,0)',metadata=print:file=-",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=600,
    )
    scores = {
        int(frame): float(score)
        for frame, score in re.findall(r"frame:(\d+).*\r?\nlavfi\.scene_score=([0-9.]+)", result.stdout)
    }
    values = [scores.get(frame, 0.0) for frame in range(max(scores, default=-1) + 1)]
    current = video.stat()
    if (current.st_size, current.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns):
        raise ValueError("Video changed while detecting cuts. Try again.")
    if cache is not None:
        pending = None
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=cache.parent, suffix=".partial", delete=False
            ) as handle:
                pending = Path(handle.name)
                json.dump({"source": signature, "scores": values}, handle, separators=(",", ":"))
            pending.replace(cache)
        except OSError:
            pass  # Scores remain usable if the derived cache cannot be written.
        finally:
            if pending is not None:
                try:
                    pending.unlink(missing_ok=True)
                except OSError:
                    pass
    return values


def detect_cuts(scores, fps):
    """First frames of new shots, at least half a second from each other and the ends."""
    found = []
    for frame in range(1, len(scores)):
        near = scores[max(0, frame - WINDOW) : frame] + scores[frame + 1 : frame + WINDOW + 1]
        if scores[frame] >= MINIMUM and scores[frame] >= RATIO * (sum(near) / len(near) + 0.001):
            found.append(frame)
    spacing = max(1, round(fps / 2))
    cuts = []
    for frame in sorted(found, key=lambda f: -scores[f]):
        if spacing <= frame <= len(scores) - spacing and all(abs(frame - cut) >= spacing for cut in cuts):
            cuts.append(frame)
    return sorted(cuts)
