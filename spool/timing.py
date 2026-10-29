"""Source-frame clocks shared by review, generation inputs and sequence export."""

from fractions import Fraction


def rate(value, fallback):
    if value in (None, "", "0/0", "N/A"):
        return float(fallback)
    result = float(Fraction(str(value)))
    return result if result > 0 else float(fallback)


def frames_filter(fps, start=0, end=None):
    trim = f"trim=start_frame={int(start)}" + (f":end_frame={int(end)}" if end is not None else "")
    return trim + f",settb=AVTB,setpts=N/({fps}*TB)"


def tempo_filter(speed):
    filters = []
    while speed > 2:
        filters.append("atempo=2")
        speed /= 2
    while speed < 0.5:
        filters.append("atempo=0.5")
        speed *= 2
    return ",".join([*filters, f"atempo={speed}"])


def interpret(document, records):
    """Upgrade legacy trims to source frames; sequence placement follows new lengths."""
    fps = document.get("fps", 24)
    factors = {}
    old_frames = {}
    for media in records:
        if not media.get("fps") or media.get("frameRateMode") == "interpret":
            continue
        native = rate(media["fps"], fps)
        old = media.get("sequenceFps", fps)
        factors[id(media)] = native / old
        old_frames[id(media)] = media["frames"]
        source_range = media.get("sourceRange")
        if source_range:
            start = source_range.get("start", 0)
            end = start + source_range.get("frames", media["frames"])
            source_range["start"] = round(start * native / old)
            source_range["frames"] = max(1, round(end * native / old) - source_range["start"])
            frames = source_range["frames"]
        else:
            count = media.get("sourceFrameCount")
            frames = (
                int(count)
                if str(count).isdigit()
                else max(1, round(media.get("duration", media["frames"] / old) * native))
            )
        media.update(
            frameRateMode="interpret",
            frames=frames,
            sequenceFps=fps,
            sourceDuration=media.get("duration", frames / native),
            duration=frames / fps,
        )
    for clip in document.get("clips", []):
        take = next((t for t in clip.get("takes", []) if t["id"] == clip.get("takeId")), None)
        if not take or take.get("placeholder") or take["media"].get("frameRateMode") != "interpret":
            continue
        factor = factors.get(id(take["media"]), 1) if clip.get("frameRateMode") != "interpret" else 1
        start, end = round(clip.get("in", 0) * factor), round(clip.get("out", 0) * factor)
        frames = take["media"]["frames"]
        if clip.get("frameRateMode") != "interpret" and clip.get("out") == old_frames.get(id(take["media"])):
            end = frames
        clip["in"] = min(start, max(0, frames - 1))
        clip["out"] = max(clip["in"] + 1, min(end, frames))
        clip["frameRateMode"] = "interpret"
    for clip in document.get("audioClips", []):
        media = clip.get("media", {})
        if media.get("frameRateMode") == "interpret":
            factor = factors.get(id(media), 1) if clip.get("frameRateMode") != "interpret" else 1
            clip["in"] = min(round(clip["in"] * factor), max(0, media["frames"] - 1))
            clip["out"] = max(clip["in"] + 1, min(round(clip["out"] * factor), media["frames"]))
            clip["frameRateMode"] = "interpret"
    return document
