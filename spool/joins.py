"""A seamless join for an extension's take, made once when its render is collected.

An extension workflow is given the shot's last frames (a `previous` video span) and
renders them again before it continues. Cutting from the shot straight to that
re-render shows a small jump: the re-render differs a little in detail, it can drift a
frame from the frames it was given, and its first new frames often dip in brightness.

The joined copy fixes all three in the take itself, so the viewer and both exports only
play it. Its overlap is the shot's own frames, the last `BLEND` of them dissolve into
the re-render, its new frames start exactly where the shot ends, and the first `SETTLE`
new frames are eased back to the shot's brightness. The studio shows it from `BLEND`
frames before the cut while the shot is still the one it was made from
(ui/timeline.js:joinedTake). The render and its receipt stay untouched; the copy lives
in the project cache and is recorded as the take media's `join`.
"""

import logging
import subprocess

from PIL import Image, ImageChops, ImageStat

from .media import _probe
from .system import find_tool

BLEND = 2  # frames the shot dissolves into the extension over, before the cut
SETTLE = 8  # new frames whose brightness is eased back to the shot's
DRIFT = 2  # how far, in frames, a re-render may slip from the frames it was given
PROBE = (640, 360)  # small enough to be quick, large enough to tell slow motion apart


def plan(request):
    """The shot an extension continues, if the request is one: a single `previous` video
    span read from the shot's end, long enough to hold the blend and the drift."""
    inputs = request.get("shotInputs") or []
    if len(inputs) != 1 or inputs[0].get("source") != "previous":
        return None
    shot = inputs[0]
    settings = shot.get("settings") or {}
    overlap = settings.get("frames")
    if settings.get("slot") != "video" or settings.get("frame") != "last" or type(overlap) is not int:
        return None
    if overlap < BLEND + DRIFT + 1:
        return None
    asset = next(
        (a for a in request.get("assets", []) if f"{a.get('nodeId')}/{a.get('input')}" == shot.get("key")), None
    )
    if not asset or not asset.get("frozen"):
        return None
    return {
        "overlap": overlap,
        "frozen": asset["frozen"],
        "parent": {
            "clipId": shot.get("clipId"),
            "takeId": shot.get("takeId"),
            "in": shot.get("in"),
            "out": shot.get("out"),
        },
    }


def _frames(ffmpeg, path, size, gray=False):
    """Decoded frames of a video at `size`, one PIL image each, in order."""
    width, height = size
    mode, channels = ("L", 1) if gray else ("RGB", 3)
    command = [
        ffmpeg, "-v", "error", "-i", str(path), "-map", "0:v:0", "-fps_mode", "passthrough",
        "-vf", f"scale={width}:{height}:flags=area+accurate_rnd+full_chroma_int:in_color_matrix=auto,format={'gray' if gray else 'rgb24'}",
        "-f", "rawvideo", "-",
    ]  # fmt: skip
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        length = width * height * channels
        while True:
            data = process.stdout.read(length)
            if len(data) < length:
                break
            yield Image.frombytes(mode, size, data)
    finally:
        process.kill()
        process.wait()


def _difference(a, b):
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]


def measure(ffmpeg, guide, render, overlap):
    """Where the render's new frames start: one after its frame most like the shot's last."""
    shot = list(_frames(ffmpeg, guide, PROBE, gray=True))
    if len(shot) != overlap:
        raise ValueError("The shot's frames given to the extension are not the length the request recorded")
    nearest = overlap - 1
    window = range(nearest - DRIFT, nearest + DRIFT + 1)
    found = {}
    for index, image in enumerate(_frames(ffmpeg, render, PROBE, gray=True)):
        if index in window:
            found[index] = _difference(image, shot[-1])
        if index >= window.stop:
            break
    if len(found) != len(window):
        raise ValueError("The extension take is too short to join")
    # Ties go to the frame the workflow intends, so a still shot keeps its plain cut.
    best = min(found, key=lambda k: (round(found[k], 1), abs(k - nearest)))
    return best + 1


def gains(ffmpeg, guide, render, head):
    """Per-channel gains for the first SETTLE new frames: the brightness eases from the
    shot's last frame to the render's own, SETTLE frames after the cut."""
    shot = list(_frames(ffmpeg, guide, (160, 90)))[-1]
    means = {}
    for index, image in enumerate(_frames(ffmpeg, render, (160, 90))):
        if head <= index <= head + SETTLE:
            means[index] = ImageStat.Stat(image).mean
        if index >= head + SETTLE:
            break
    if len(means) != SETTLE + 1:
        return []
    start, end = ImageStat.Stat(shot).mean, means[head + SETTLE]
    result = []
    for k in range(SETTLE):
        u = (k + 1) / (SETTLE + 1)
        want = [s * (1 - u) + e * u for s, e in zip(start, end)]
        result.append([max(0.92, min(1.08, w / m)) if m > 1 else 1.0 for w, m in zip(want, means[head + k])])
    return result


def _graded(image, gain):
    if all(abs(g - 1) < 0.002 for g in gain):
        return image
    return Image.merge(
        "RGB", [band.point(lambda v, g=g: min(255, round(v * g))) for band, g in zip(image.split(), gain)]
    )


def build(media, request, primary, joining):
    """Write the joined copy of `primary` and return its media record, or None."""
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        return None
    render = media.resolve(primary["originalFile"])
    guide = media.host_roots["input"] / joining["frozen"]
    if not render.is_file() or not guide.is_file():
        return None
    # The copy takes the shot's own size: the workflow stretched the shot to its render size,
    # and a copy that kept that size would be fitted into the shot's frame with bars beside it.
    shot_video = next(s for s in _probe(guide)["streams"] if s["codec_type"] == "video")
    overlap, frames = joining["overlap"], primary["frames"]
    size = (int(shot_video["width"]), int(shot_video["height"]))
    head = measure(ffmpeg, guide, render, overlap)
    shift, grade = head - overlap, gains(ffmpeg, guide, render, head)
    shot = list(_frames(ffmpeg, guide, size))
    target = media.cache / "joins" / f"{primary['artifactId']}.mp4"
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_name(target.stem + ".partial.mp4")
    encoder = subprocess.Popen(
        [
            ffmpeg, "-v", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
            "-r", str(request.get("sequenceFps", 24)), "-i", "-",
            "-i", str(render), "-map", "0:v:0", "-map", "1:a?", "-c:a", "copy",
            "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p",
            "-c:v", "libx264", "-crf", "14", "-preset", "medium",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
            "-movflags", "+faststart", str(pending),
        ],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )  # fmt: skip
    source = _frames(ffmpeg, render, size)
    state = {"index": -1, "frame": None}

    def at(wanted):
        """The render's frame `wanted` (read in order); past its end, its last frame."""
        while state["index"] < wanted:
            following = next(source, None)
            if following is None:
                break
            state["index"], state["frame"] = state["index"] + 1, following
        return state["frame"]

    try:
        for j in range(frames):
            if j < overlap - BLEND:
                picture = shot[j]
            elif j < overlap:
                picture = Image.blend(shot[j], at(j + shift), (j - (overlap - BLEND) + 1) / (BLEND + 1))
            else:
                picture = at(j + shift)
                if j - overlap < len(grade):
                    picture = _graded(picture, grade[j - overlap])
            encoder.stdin.write(picture.tobytes())
        encoder.stdin.close()
        if encoder.wait() != 0:
            raise ValueError("Could not write the joined extension take: " + encoder.stderr.read().decode()[-300:])
    except BaseException:
        encoder.kill()
        encoder.wait()
        pending.unlink(missing_ok=True)
        raise
    finally:
        source.close()
    pending.replace(target)
    record = media.describe(target, name=primary.get("name"), fps=request.get("sequenceFps", 24))
    keep = ("id", "kind", "file", "originalFile", "poster", "name", "frames", "fps", "width", "height", "duration")
    return {
        **{key: record[key] for key in keep if key in record},
        "audio": record.get("audio", False),
        "sequenceFps": record.get("sequenceFps"),
        "overlap": overlap,
        "blend": BLEND,
        "drift": shift,
        "parent": joining["parent"],
    }


def attach(media, request, result):
    """`result` with its primary video joined to the shot it extends, when it is an extension.
    A join that cannot be made leaves the take as it rendered."""
    primary = result.get("primary") or {}
    joining = plan(request) if primary.get("kind") == "video" and "join" not in primary else None
    if not joining:
        return result
    try:
        join = build(media, request, primary, joining)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        logging.warning("Spool could not join extension take %s: %s", request.get("takeId"), error)
        return result
    if not join:
        return result
    joined = {**primary, "join": join}
    return {
        **result,
        "primary": joined,
        "artifacts": [joined if a.get("artifactId") == joined.get("artifactId") else a for a in result["artifacts"]],
    }
