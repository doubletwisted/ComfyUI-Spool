"""Editable timeline export as OpenTimelineIO JSON, written directly so Spool needs no OTIO package.

Clips reference the original files in place: a shot keeps its offset into its source, so
editors can trim back into the full file. References are plain paths, as Resolve writes them;
Resolve rejects a timeline whose media are file:// URLs on a network share. global_start_time
stays unset: Resolve builds the timeline at the project rate, and without a start time it maps
clips by time rather than by frame number when that rate differs. Spool interprets every source frame once on the
sequence clock, so a clip whose source rate differs carries a LinearTimeWarp. Gain and fades
have no OTIO schema and travel as Spool metadata only."""

import json
import re
import uuid
from pathlib import Path
from .timing import rate


def _time(value, fps):
    return {"OTIO_SCHEMA": "RationalTime.1", "rate": float(fps), "value": float(value)}


def _range(start, duration):
    return {"OTIO_SCHEMA": "TimeRange.1", "start_time": start, "duration": duration}


def _item(schema, name, source_range, enabled=True, metadata=None):
    return {
        "OTIO_SCHEMA": schema,
        "name": name,
        "metadata": metadata or {},
        "source_range": source_range,
        "effects": [],
        "markers": [],
        "enabled": enabled,
    }


def timecode_frames(value, fps):
    """Frames of an HH:MM:SS:FF source timecode; ';' marks drop-frame at 29.97 or 59.94."""
    match = re.fullmatch(r"(\d+):(\d\d):(\d\d)([:;.,])(\d\d)", str(value or "").strip())
    if not match:
        return 0
    hours, minutes, seconds, separator, frames = match.groups()
    base = round(fps)
    total = ((int(hours) * 60 + int(minutes)) * 60 + int(seconds)) * base + int(frames)
    if separator in ";," and base in (30, 60):
        dropped = 2 * base // 30
        whole_minutes = int(hours) * 60 + int(minutes)
        total -= dropped * (whole_minutes - whole_minutes // 10)
    return total


def _timecode(probe):
    for tags in [probe.get("format", {}).get("tags", {}), *(s.get("tags", {}) for s in probe.get("streams", []))]:
        for key, value in tags.items():
            if key.lower() == "timecode":
                return value
    return None


def export_timeline(plan, *, root, fps, width, height, name, sources, resolve, probe, image_extensions):
    tracks = plan.get("tracks", [])
    if not any(t.get("clips") for t in tracks):
        raise ValueError("Add a clip before exporting.")
    references = {}

    def reference(file):
        if file not in references:
            original = sources.get(file)
            path = Path(original["path"] if original else resolve(file))
            entry = {"path": path, "offset": original["offset"] if original else 0, "rate": float(fps), "timecode": 0}
            media = {
                "OTIO_SCHEMA": "ExternalReference.1",
                "name": path.name,
                "metadata": {},
                "target_url": str(path.resolve()),
                "available_range": None,
            }
            if path.suffix.lower() not in image_extensions:
                details = probe(path)
                video = next(
                    (
                        s
                        for s in details["streams"]
                        if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")
                    ),
                    None,
                )
                native = (
                    rate((original or {}).get("fps") or (video or {}).get("avg_frame_rate"), fps)
                    if video
                    else float(fps)
                )
                entry.update(rate=native, timecode=timecode_frames(_timecode(details), native))
                count = str((video or {}).get("nb_frames", ""))
                length = (
                    int(count)
                    if count.isdigit()
                    else round(float(details.get("format", {}).get("duration", 0)) * native)
                )
                if length > 0:
                    media["available_range"] = _range(_time(entry["timecode"], native), _time(length, native))
            entry["media"] = media
            references[file] = entry
        return references[file]

    def clip(item):
        source = reference(item["file"])
        native, frames = source["rate"], int(item["out"]) - int(item["in"])
        start = source["timecode"] + source["offset"] + int(item["in"])
        if int(item["in"]) < 0 or frames <= 0:
            raise ValueError("A clip has invalid trim points.")
        metadata = {"spool": {k: item[k] for k in ("id", "takeId", "gainDb", "fadeIn", "fadeOut") if k in item}}
        result = _item(
            "Clip.1",
            item.get("name") or source["path"].stem,
            _range(_time(start, native), _time(frames, fps)),
            bool(item.get("enabled", True)),
            metadata,
        )
        result["media_reference"] = source["media"]
        if abs(native - fps) > 1e-6:
            result["effects"].append(
                {
                    "OTIO_SCHEMA": "LinearTimeWarp.1",
                    "name": "",
                    "metadata": {},
                    "enabled": True,
                    "effect_name": "LinearTimeWarp",
                    "time_scalar": fps / native,
                }
            )
        return result

    def gap(frames):
        return _item("Gap.1", "", _range(_time(0, fps), _time(frames, fps)))

    children = []
    for index, track in enumerate(tracks):
        kind = "Video" if track.get("kind") == "video" else "Audio"
        items, position = [], 0
        for item in sorted(track.get("clips", []), key=lambda c: int(c["start"])):
            start = int(item["start"])
            if start < position:
                raise ValueError("Clips overlap on " + str(track.get("name")) + ".")
            if start > position:
                items.append(gap(start - position))
            items.append(clip(item))
            position = start + int(item["out"]) - int(item["in"])
        # The first video track runs to the end of the range, so the timeline keeps its length.
        if index == 0 and kind == "Video" and int(plan.get("duration", 0)) > position:
            items.append(gap(int(plan["duration"]) - position))
        children.append(
            {
                **_item(
                    "Track.1", track.get("name") or kind[0] + str(index + 1), None, bool(track.get("enabled", True))
                ),
                "kind": kind,
                "children": items,
            }
        )
    timeline = {
        "OTIO_SCHEMA": "Timeline.1",
        "name": name or "Spool",
        "global_start_time": None,
        "metadata": {"spool": {"fps": fps, "width": width, "height": height}},
        "tracks": {**_item("Stack.1", "tracks", None), "children": children},
    }
    output_dir = root / "exports"
    output_dir.mkdir(exist_ok=True)
    stem = re.sub(r"[^\w.-]+", "-", name or "spool").strip("-.") or "spool"
    output = output_dir / f"{stem}-{uuid.uuid4().hex[:10]}.otio"
    pending = output.with_name(output.name + ".partial")
    pending.write_text(json.dumps(timeline, indent=2, ensure_ascii=False), encoding="utf-8")
    pending.replace(output)
    return {"filename": output.name, "path": str(output), "timeline": timeline}
