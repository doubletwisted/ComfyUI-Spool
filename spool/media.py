import copy
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import unquote

from PIL import Image, ImageDraw, ImageOps

from .cuts import detect_cuts, scene_scores
from .export import export_sequence
from .interchange import export_timeline
from .workflows import workflow_metadata
from .store import uid
from .system import find_tool
from .workflow_inputs import sources
from .ownership import file_lock, atomic_replace
from .timing import rate, frames_filter, tempo_filter

PLAYBACK_VERSION = "playback-2"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".opus"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS | AUDIO_EXTENSIONS


def _probe(source):
    ffprobe = find_tool("ffprobe")
    if not ffprobe:
        raise ValueError("Install ffprobe for native media review")
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=30,
    )
    return json.loads(result.stdout)


def _rate(value):
    numerator, _, denominator = str(value).partition("/")
    rate = float(numerator) / float(denominator or 1)
    if rate <= 0:
        raise ValueError("The video has no usable frame rate")
    return rate


def _video_stream(probe):
    return next(
        (
            s
            for s in probe["streams"]
            if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")
        ),
        None,
    )


def _review_probe(path, fps, run=None):
    run = run or subprocess.run
    probe = _probe(path)
    duration = int(_video_stream(probe)["nb_frames"]) / fps
    if (
        any(s["codec_type"] == "audio" for s in probe["streams"])
        and float(probe["format"]["duration"]) > duration + 0.03
    ):
        # -shortest can leave buffered AAC packets beyond the final video frame.
        pending = path.with_name(path.stem + "-" + uid() + ".mp4")
        try:
            run(
                [
                    find_tool("ffmpeg"),
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    str(path),
                    "-map",
                    "0",
                    "-c",
                    "copy",
                    "-t",
                    str(duration),
                    "-movflags",
                    "+faststart",
                    str(pending),
                ],
                check=True,
                capture_output=True,
                timeout=300,
            )
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)
        probe = _probe(path)
    return probe


SAVER_GROUPS = {
    "SaveImage": {"images"},
    "PreviewImage": {"images"},
    "SaveVideo": {"images", "videos"},
    "VHS_VideoCombine": {"gifs"},
}


def contained(root, relative):
    """Resolve a stored relative path, refusing anything outside its root.

    The comparison is lexical after normalisation: `Path.resolve()` returns the
    extended-length form for a path whose parent exists and the plain form for one
    whose parent does not, so `is_relative_to` compared mismatched strings and
    containment depended on whether a directory had already been created.
    """
    base = Path(root).resolve()
    target = Path(os.path.normpath(os.path.join(str(base), unquote(relative))))
    key, prefix = os.path.normcase(str(target)), os.path.normcase(str(base))
    if key == prefix or not key.startswith(prefix + os.sep):
        raise ValueError("Media path escapes its storage root")
    return target


# Comfy input names of files Spool staged from a project folder: spool-projects/<project>/<path>.
STAGED_PREFIX = "spool-projects/"


def staged_relative(value):
    """The project-relative path a staged Comfy input name points to, or None."""
    if not isinstance(value, str) or not value.startswith(STAGED_PREFIX):
        return None
    parts = value.removesuffix(" [input]").split("/", 2)
    return parts[2] if len(parts) == 3 else None


def sha256(path):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def check_frozen(path, asset, message="A frozen input changed before execution"):
    """Refuse a frozen input whose bytes no longer match what was frozen."""
    if Path(path).stat().st_size != asset["byteSize"] or sha256(path) != asset["sha256"]:
        raise ValueError(message)


class Media:
    def __init__(self, root, input_root, output_root, temp_root, project_id=None, playback_cache=None, playback=None):
        self.root = Path(root).resolve()
        self.playback = playback
        self.playback_cache = Path(playback_cache) if playback_cache else self.root / "cache" / "previews"
        self.project_id = project_id
        self.cache = self.root / ".spool" if project_id else self.root
        self.cache.mkdir(parents=True, exist_ok=True)
        self.host_roots = {
            "input": Path(input_root).resolve(),
            "output": Path(output_root).resolve(),
            "temp": Path(temp_root).resolve(),
        }
        (self.root / "assets").mkdir(exist_ok=True)
        black = self.root / "assets" / "black.png"
        if not black.exists():
            Image.new("RGB", (16, 16)).save(black)

    def for_project(self, store, project_id):
        if self.root == store.root:
            return self
        return Media(
            store.root,
            *self.host_roots.values(),
            project_id=project_id,
            playback_cache=store.runtime.parent / "previews",
            playback=self.playback,
        )

    def prepare_playback(self, document):
        if self.playback is None:
            return
        from .ledger import media_records

        size = document.get("resolution") or {"width": 960, "height": 540}
        records = []
        for clip in document.get("clips", []):
            records.extend(
                t["media"]
                for t in clip.get("takes", [])
                if t.get("id") == clip.get("takeId") and not t.get("placeholder")
            )
        records.extend(media_records(document))
        for record in records:
            if record.get("kind") not in ("image", "video") and not (
                record.get("kind") == "audio" and record.get("fps")
            ):
                continue
            try:
                self.playback.submit(self, record, size["width"], size["height"], document.get("fps", 24))
            except (ValueError, OSError):
                # Missing sources do not prevent opening a project.
                continue

    def input_source(self, value):
        """The file a Comfy input value names: the project file Spool staged it from, else Comfy's input folder."""
        name = value.removesuffix(" [input]")
        prefix = STAGED_PREFIX + str(self.project_id) + "/"
        if self.project_id and name.startswith(prefix):
            return contained(self.root, name.removeprefix(prefix))
        return contained(self.host_roots["input"], name)

    def input_destination(self, name, unique=False):
        extension = Path(name).suffix.lower()
        kind = "images" if extension in IMAGE_EXTENSIONS else "audio" if extension in AUDIO_EXTENSIONS else "video"
        filename = Path(name).name
        if unique:
            filename = Path(filename).stem + "-" + uid()[:8] + extension
        return contained(self.root, "input/" + kind + "/" + filename)

    def keep_input(self, source):
        source = Path(source).resolve()
        if not self.project_id or source.is_relative_to(self.root / "input"):
            return source
        if source.suffix.lower() not in EXTENSIONS or not source.is_file():
            raise ValueError("Input file is missing or unsupported")
        with source.open("rb") as handle:
            checksum = hashlib.file_digest(handle, "sha256").hexdigest()
        target = self.input_destination(source.name)
        target = target.with_name(target.stem + "-" + checksum[:16] + target.suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            pending = target.with_name(uid() + ".partial")
            try:
                shutil.copyfile(source, pending)
                with pending.open("rb") as handle:
                    if hashlib.file_digest(handle, "sha256").hexdigest() != checksum:
                        raise ValueError("Input changed while being copied")
                pending.replace(target)
            finally:
                pending.unlink(missing_ok=True)
        return target

    def stage_input(self, source):
        source = Path(source).resolve()
        if not source.is_relative_to(self.root):
            source = self.keep_input(source)
        name = STAGED_PREFIX + self.project_id + "/" + source.relative_to(self.root).as_posix()
        target = contained(self.host_roots["input"], name)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or (target.stat().st_size, target.stat().st_mtime_ns) != (
            source.stat().st_size,
            source.stat().st_mtime_ns,
        ):
            pending = target.with_name(uid() + ".partial")
            shutil.copy2(source, pending)
            pending.replace(target)
        return name

    def prepare_input(self, value):
        if self.project_id:
            return self.stage_input(self.input_source(value))
        return value.removesuffix(" [input]")

    def receipt_path(self, attempt):
        return (
            self.cache / "receipts" / attempt["id"] / "receipt.json"
            if self.project_id
            else self.root / "artifacts" / attempt["id"] / "receipt.json"
        )

    def result_path(self, attempt, artifact_id, extension, primary, execution_id=None):
        if self.project_id:
            if primary:
                folder = contained(self.root, attempt["request"]["outputFolder"])
                name = "take-" + str(attempt["request"]["takeNumber"]).zfill(3) + "-" + attempt["take_id"][:8]
                if execution_id:
                    name += "-" + execution_id[:8]
                return folder / (name + extension)
            return self.receipt_path(attempt).parent / (artifact_id + extension)
        folder = self.root / "artifacts" / attempt["id"]
        if execution_id:
            folder /= execution_id
        return folder / (artifact_id + extension)

    def resolve(self, relative):
        path = (
            contained(self.playback_cache, relative.removeprefix("_playback/"))
            if relative.startswith("_playback/")
            else contained(self.root, relative)
        )
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            raise ValueError("Source media is missing or unsupported")
        return path

    def describe(self, path, name=None, fps=24):
        """Review media at the project's sequence rate. Footage referenced in place keeps its absolute original path."""
        path = Path(path)
        relative = path.relative_to(self.root).as_posix() if path.is_relative_to(self.root) else str(path)
        result = {
            "id": uid(),
            "file": relative,
            "originalFile": relative,
            "name": name or path.name,
            "audio": False,
            "sequenceFps": fps,
        }
        if path.suffix.lower() in IMAGE_EXTENSIONS:
            with Image.open(path) as image:
                if getattr(image, "n_frames", 1) > 1:
                    raise ValueError("Animated image review is not supported yet. Import a video instead.")
                result.update(
                    {
                        "kind": "image",
                        "width": image.width,
                        "height": image.height,
                        "frames": round(5 * fps),
                        "poster": relative,
                    }
                )
            return result
        probe = _probe(path)
        streams = probe["streams"]
        video = _video_stream(probe)
        audio = any(s["codec_type"] == "audio" for s in streams)
        duration = float(probe["format"].get("duration", video.get("duration", 0) if video else 0))
        if duration <= 0:
            raise ValueError("The artifact has no measurable duration")
        result.update(
            {
                "kind": "video" if video else "audio",
                "duration": duration,
                "frames": max(1, round(duration * fps)),
                "audio": audio,
                "probe": probe,
            }
        )
        result.update(workflow_metadata(probe))
        previews = self.cache / "previews"
        previews.mkdir(exist_ok=True)
        ffmpeg = find_tool("ffmpeg")
        if not ffmpeg:
            raise ValueError("Install ffmpeg for native media review")
        if video:
            result.update(
                {
                    "width": video["width"],
                    "height": video["height"],
                    "fps": video.get("avg_frame_rate"),
                    "timeBase": video.get("time_base"),
                    "sourceFrameCount": video.get("nb_frames"),
                }
            )
            # Named from the source and the review settings, so re-describing the same
            # file reuses its proxy instead of leaving another copy behind.
            signature = json.dumps(
                [str(path.resolve()), path.stat().st_size, path.stat().st_mtime_ns, 960, 540, fps, "interpret-frames-1"]
            )
            proxy = previews / (path.stem + "-" + hashlib.sha256(signature.encode()).hexdigest()[:24] + ".mp4")
            if not proxy.exists():
                subprocess.run(
                    [
                        ffmpeg,
                        "-v",
                        "error",
                        "-y",
                        "-i",
                        str(path),
                        "-map",
                        "0:v:0",
                        "-map",
                        "0:a?",
                        "-vf",
                        frames_filter(fps)
                        + ",scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2",
                        "-r",
                        str(fps),
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-g",
                        "6",
                        "-bf",
                        "0",
                        "-preset",
                        "ultrafast",
                        "-c:a",
                        "aac",
                        "-af",
                        tempo_filter(fps / rate(video.get("avg_frame_rate"), fps)) + ",apad",
                        "-shortest",
                        "-movflags",
                        "+faststart",
                        str(proxy),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=300,
                )
            result["file"] = proxy.relative_to(self.root).as_posix()
            proxy_probe = _review_probe(proxy, fps)
            proxy_video = next(s for s in proxy_probe["streams"] if s["codec_type"] == "video")
            result["frames"] = int(proxy_video["nb_frames"])
            result.update(
                sourceFrameCount=result["frames"],
                sourceDuration=duration,
                duration=result["frames"] / fps,
                frameRateMode="interpret",
            )
            result["review"] = {
                "fps": fps,
                "frames": result["frames"],
                "width": 960,
                "height": 540,
                "duration": result["frames"] / fps,
                "frameRateMode": "interpret",
            }
            poster = proxy.with_suffix(".jpg")
            if not poster.exists():
                subprocess.run(
                    [ffmpeg, "-v", "error", "-y", "-i", str(proxy), "-frames:v", "1", str(poster)],
                    check=True,
                    capture_output=True,
                    timeout=30,
                )
            result["poster"] = poster.relative_to(self.root).as_posix()
        if audio:
            wave = previews / (
                path.stem
                + "-"
                + hashlib.sha256((str(path.resolve()) + "-wave-1").encode()).hexdigest()[:24]
                + "-wave.png"
            )
            if not wave.exists():
                subprocess.run(
                    [
                        ffmpeg,
                        "-v",
                        "error",
                        "-y",
                        "-i",
                        str(path),
                        "-filter_complex",
                        "aformat=channel_layouts=mono,showwavespic=s=1280x80:colors=0x91dab1",
                        "-frames:v",
                        "1",
                        str(wave),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=60,
                )
            result["wave"] = wave.relative_to(self.root).as_posix()
            if not video:
                result["poster"] = result["wave"]
        return result

    def import_footage(self, source, fps=None, detect=True):
        """Reference a local video in place and split its review proxy into one file per detected shot.

        Shots carry no audio; the source's own audio track is returned separately for the soundtrack lane."""
        source = Path(source)
        if not source.is_absolute() or not source.is_file() or source.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError("Enter the full path of a video file")
        video = _video_stream(_probe(source))
        if not video:
            raise ValueError("The file has no video stream")
        fps = fps or _rate(video["avg_frame_rate"])
        whole = self.describe(source, source.name, fps)
        ffmpeg = find_tool("ffmpeg")
        proxy = self.root / whole["file"]
        cuts = detect_cuts(scene_scores(ffmpeg, proxy, self.cache / "previews" / "cut-scores"), fps) if detect else []
        folder = self.cache / "shots" / uid()
        folder.mkdir(parents=True)
        command = [
            ffmpeg,
            "-v",
            "error",
            "-y",
            "-i",
            str(proxy),
            "-an",
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
        ]
        if cuts:
            command += [
                "-force_key_frames",
                "expr:" + "+".join(f"eq(n,{cut})" for cut in cuts),
                "-f",
                "segment",
                "-segment_frames",
                ",".join(map(str, cuts)),
                "-reset_timestamps",
                "1",
                str(folder / "%03d.mp4"),
            ]
        else:
            command.append(str(folder / "000.mp4"))
        subprocess.run(command, check=True, capture_output=True, timeout=600)
        shots = []
        for index, (start, end) in enumerate(zip([0, *cuts], [*cuts, whole["frames"]])):
            file = folder / f"{index:03d}.mp4"
            count = int(_probe(file)["streams"][0]["nb_frames"])
            if count != end - start:
                raise ValueError(
                    f"Shot {index + 1} has {count} frames instead of {end - start}; the source could not be split exactly"
                )
            poster = file.with_suffix(".jpg")
            subprocess.run(
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-y",
                    "-ss",
                    str(count / 2 / fps),
                    "-i",
                    str(file),
                    "-frames:v",
                    "1",
                    str(poster),
                ],
                check=True,
                capture_output=True,
                timeout=30,
            )
            shots.append(
                {
                    "id": uid(),
                    "kind": "video",
                    "name": f"Shot {index + 1:02d}",
                    "file": file.relative_to(self.root).as_posix(),
                    "originalFile": str(source),
                    "poster": poster.relative_to(self.root).as_posix(),
                    "frames": count,
                    "duration": count / fps,
                    "audio": False,
                    "sequenceFps": fps,
                    "fps": whole["fps"],
                    "width": whole["width"],
                    "height": whole["height"],
                    "sourceRange": {"start": start, "frames": count},
                    "sourceFrameCount": whole["sourceFrameCount"],
                    "sourceDuration": whole["sourceDuration"],
                    "frameRateMode": "interpret",
                    "review": {**whole["review"], "frames": count, "duration": count / fps},
                }
            )
        audio = None
        if whole["audio"]:
            track = self.cache / "previews" / (source.stem + "-" + uid() + "-audio.m4a")
            subprocess.run(
                [
                    ffmpeg,
                    "-v",
                    "error",
                    "-y",
                    "-i",
                    str(proxy),
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "256k",
                    str(track),
                ],
                check=True,
                capture_output=True,
                timeout=300,
            )
            audio = self.describe(track, source.stem + " audio", fps)
            audio["originalFile"] = str(source)
            audio.update(
                fps=whole["fps"],
                frames=whole["frames"],
                duration=whole["duration"],
                sourceFrameCount=whole["sourceFrameCount"],
                sourceDuration=whole["sourceDuration"],
                frameRateMode="interpret",
                review={"frameRateMode": "interpret"},
            )
        return {"fps": fps, "source": whole, "shots": shots, "audio": audio}

    def reported(self, record):
        file_type = record.get("type", "output")
        if file_type not in self.host_roots:
            raise ValueError("Unsupported saver storage type")
        name = record["filename"]
        if Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError("Saver filename must be a basename")
        source = contained(self.host_roots[file_type], str(Path(record.get("subfolder", "")) / name))
        if not source.is_file() or source.suffix.lower() not in EXTENSIONS:
            raise ValueError("Reported artifact is missing or unsupported")
        return source

    def collect(self, attempt, history, review=True):
        request = attempt["request"]
        target = self.receipt_path(attempt).parent
        target.mkdir(parents=True, exist_ok=True)
        artifacts = []
        selection = request["capture"]["result"]
        primary = None
        for node_id, outputs in history.get("outputs", {}).items():
            node = request["prompt"].get(node_id)
            if not node:
                continue
            for group in SAVER_GROUPS.get(node["class_type"], set()):
                records = outputs.get(group, [])
                for index, record in enumerate(records):
                    if not isinstance(record, dict) or "filename" not in record:
                        continue
                    source = self.reported(record)
                    artifact_id = uid()
                    selected = (node_id, group, index) == (selection["nodeId"], selection["group"], selection["index"])
                    destination = self.result_path(attempt, artifact_id, source.suffix.lower(), selected)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    pending = destination.with_suffix(destination.suffix + ".partial")
                    shutil.copyfile(source, pending)
                    pending.replace(destination)
                    metadata = (
                        self.describe(destination, fps=request.get("sequenceFps", 24))
                        if review
                        else {
                            "id": artifact_id,
                            "file": destination.relative_to(self.root).as_posix(),
                            "originalFile": destination.relative_to(self.root).as_posix(),
                        }
                    )
                    with destination.open("rb") as handle:
                        checksum = hashlib.file_digest(handle, "sha256").hexdigest()
                    metadata.update(
                        {
                            "artifactId": artifact_id,
                            "nodeId": node_id,
                            "group": group,
                            "index": index,
                            "record": record,
                            "byteSize": destination.stat().st_size,
                            "sha256": checksum,
                        }
                    )
                    artifacts.append(metadata)
                    if selected:
                        primary = metadata
        if primary is None:
            raise ValueError("Chosen result artifact was not reported by the successful prompt")
        return artifacts, primary

    def review_receipt(self, receipt, fps):
        artifacts = []
        for artifact in receipt["artifacts"]:
            if "kind" in artifact:
                artifacts.append(artifact)
            else:
                artifacts.append(
                    {
                        **self.describe(self.resolve(artifact["originalFile"]), fps=fps),
                        **{k: v for k, v in artifact.items() if k not in ("file", "originalFile")},
                    }
                )
        return {
            **receipt,
            "artifacts": artifacts,
            "primary": next(a for a in artifacts if a["artifactId"] == receipt["primary"]["artifactId"]),
        }

    def prepare_workflow(self, capture, strict=False, allow_external=True):
        """Relocate explicit source files in a working copy; historical graphs remain intact."""
        prepared = copy.deepcopy(capture)
        for field in ("workflow", "prompt"):
            if field in capture:
                prepared[field] = copy.deepcopy(capture[field])
        recovered, missing, assigned = [], [], {}
        input_map = self.cache / "input-map.json"
        aliases = json.loads(input_map.read_text(encoding="utf-8")) if self.project_id and input_map.exists() else {}
        remembered = {}
        for identity, name, editor, api, editor_value, api_value in sources(prepared):
            values = list(dict.fromkeys(v for v in (api_value, editor_value) if v))
            candidates, absolute, owned = [], [], []
            for value in values:
                if value in aliases:
                    path = contained(self.root, aliases[value])
                    if path.is_file():
                        owned.append(path)
            for value in values:
                root, filename = self.host_roots["input"], value
                for kind in self.host_roots:
                    suffix = " [" + kind + "]"
                    if value.endswith(suffix):
                        root, filename = self.host_roots[kind], value.removesuffix(suffix)
                        break
                path = Path(filename)
                prefix = STAGED_PREFIX + str(self.project_id) + "/"
                if self.project_id and filename.startswith(prefix):
                    candidates.append(contained(self.root, filename.removeprefix(prefix)))
                if path.is_absolute():
                    absolute.append(path)
                elif "://" not in filename:
                    candidate = (root / filename).resolve()
                    if candidate != root and candidate.is_relative_to(root):
                        candidates.append(candidate)
            # An absolute worker path is evidence of the original source. Never
            # substitute a different local file merely because its basename matches.
            choices = absolute or candidates
            if prepared.get("provenance", {}).get("takeBase") and owned:
                choices = owned
            source = next(
                (
                    p.resolve()
                    for p in choices
                    if (allow_external or p.resolve().is_relative_to(self.host_roots["input"]))
                    and p.is_file()
                    and p.suffix.lower() in EXTENSIONS
                ),
                None,
            )
            if source is None:
                source = next((p for p in owned if p.is_file()), None)
            if source is None:
                missing.append({"nodeId": identity, "input": name, "sources": values})
                continue
            if self.project_id:
                kept = self.keep_input(source)
                relative = self.stage_input(kept)
                remembered[api_value or editor_value] = kept.relative_to(self.root).as_posix()
                recovered.append(
                    {
                        "nodeId": identity,
                        "input": name,
                        "source": str(source),
                        "file": relative,
                        "projectFile": kept.relative_to(self.root).as_posix(),
                    }
                )
            elif source.is_relative_to(self.host_roots["input"]):
                relative = source.relative_to(self.host_roots["input"]).as_posix()
                parts = Path(relative).parts
                if parts[0] == "spool-imported" and len(parts) == 3 and len(parts[1]) == 64:
                    with source.open("rb") as handle:
                        if hashlib.file_digest(handle, "sha256").hexdigest() != parts[1]:
                            raise ValueError("Recovered reference no longer matches its content hash: " + str(source))
            else:
                with source.open("rb") as handle:
                    checksum = hashlib.file_digest(handle, "sha256").hexdigest()
                target = contained(self.host_roots["input"], "spool-imported/" + checksum + "/" + source.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    pending = target.with_name(uid() + ".partial")
                    try:
                        shutil.copyfile(source, pending)
                        with pending.open("rb") as handle:
                            if hashlib.file_digest(handle, "sha256").hexdigest() != checksum:
                                raise ValueError("Reference changed while being imported: " + str(source))
                        pending.replace(target)
                    finally:
                        pending.unlink(missing_ok=True)
                with target.open("rb") as handle:
                    if hashlib.file_digest(handle, "sha256").hexdigest() != checksum:
                        raise ValueError("Recovered reference no longer matches its content hash: " + str(target))
                relative = target.relative_to(self.host_roots["input"]).as_posix()
                recovered.append(
                    {
                        "nodeId": identity,
                        "input": name,
                        "source": str(source),
                        "file": relative,
                        "sha256": checksum,
                        "byteSize": target.stat().st_size,
                    }
                )
            if editor is not None and editor_value is not None:
                key = id(editor)
                if key in assigned and assigned[key] != relative:
                    raise ValueError("Shared subgraph source needs an explicit input mapping: " + identity)
                assigned[key] = relative
                editor["widgets_values"][0] = relative
                if isinstance(editor.get("widgets_values_named"), dict):
                    editor["widgets_values_named"][name] = relative
            if api is not None:
                api["inputs"][name] = relative
        # Empty selections are editable; strict recovery checks named sources.
        unavailable = [item for item in missing if item["sources"]]
        if strict and unavailable:
            first = unavailable[0]
            raise ValueError(
                "Reference file unavailable for node "
                + first["nodeId"]
                + " / "
                + first["input"]
                + ": "
                + ", ".join(first["sources"])
                + ". Restore the source file or reconnect its drive, then prepare again."
            )
        if remembered:
            with file_lock(self.cache / "input-map.lock"):
                aliases = json.loads(input_map.read_text(encoding="utf-8")) if input_map.exists() else {}
                aliases.update(remembered)
                pending = input_map.with_name(uid() + ".partial")
                try:
                    pending.write_text(json.dumps(aliases, ensure_ascii=False), encoding="utf-8")
                    atomic_replace(pending, input_map)
                finally:
                    pending.unlink(missing_ok=True)
        previous = capture.get("inputRecovery", {}).get("recovered", [])
        prepared["inputRecovery"] = {
            "recovered": previous + [r for r in recovered if r not in previous],
            "missing": missing,
        }
        if prepared.get("workflow") and "nodes" not in prepared["workflow"] and prepared.get("prompt"):
            prepared["workflow"] = copy.deepcopy(prepared["prompt"])
        return prepared

    def freeze_asset(self, value):
        if not isinstance(value, str):
            raise ValueError("An asset binding must contain a Comfy input filename")
        source = self.input_source(value)
        if self.project_id:
            source = self.keep_input(source)
            target = self.cache / "frozen" / (uid() + source.suffix.lower())
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            return self.stage_input(target)
        if not source.is_file():
            raise ValueError("Bound input asset does not exist in Comfy's input directory")
        target = contained(self.host_roots["input"], "spool-frozen/" + uid() + source.suffix.lower())
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(source, target)
        return target.relative_to(self.host_roots["input"]).as_posix()

    def bake_shot(self, metadata, start, end, fps, slot, frame=None, audio=False):
        if not 0 <= start < end <= metadata["frames"] or slot not in (
            "video",
            "image",
            "firstFrame",
            "lastFrame",
            "reference",
        ):
            raise ValueError("Choose a verified image/video slot and a valid shot range")
        source = self.original_source(metadata)
        source_fps = (
            rate(source["fps"] or _video_stream(_probe(source["path"]))["avg_frame_rate"], fps)
            if metadata["kind"] == "video"
            else fps
        )
        first = source["offset"] + start
        offset = first / source_fps
        duration = (end - start) / fps
        if metadata["kind"] == "image" and slot == "video":
            raise ValueError("An image cannot supply a video slot")
        if slot != "video" and metadata["kind"] == "video":
            frame = "first" if slot == "firstFrame" else "last" if slot == "lastFrame" else frame
            if frame not in ("first", "last", "middle"):
                raise ValueError("Choose First, Last or Middle frame for this image slot")
            first += 0 if frame == "first" else end - start - 1 if frame == "last" else (end - start - 1) // 2
            offset = first / source_fps
        with source["path"].open("rb") as handle:
            source_hash = hashlib.file_digest(handle, "sha256").hexdigest()
        settings = {
            "sourceSha256": source_hash,
            "offsetSeconds": offset,
            "durationSeconds": duration,
            "fps": fps,
            "slot": slot,
            "frame": frame,
            "audio": bool(audio),
            "startFrame": first,
            "frames": end - start,
            "policy": "source-frames-interpret-v1",
        }
        key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()
        output = contained(self.host_roots["input"], "spool-baked/" + key + (".mp4" if slot == "video" else ".png"))
        output.parent.mkdir(exist_ok=True)
        if not output.exists():
            pending = output.with_name(output.stem + "-" + uid() + output.suffix)
            try:
                if metadata["kind"] == "image":
                    with Image.open(source["path"]) as image:
                        ImageOps.exif_transpose(image).save(pending)
                else:
                    ffmpeg = find_tool("ffmpeg")
                    if not ffmpeg:
                        raise ValueError("Install ffmpeg to bake original shot inputs")
                    command = [ffmpeg, "-v", "error", "-y", "-i", str(source["path"]), "-map", "0:v:0"]
                    if slot == "video":
                        command += [
                            "-vf",
                            frames_filter(fps, first, first + end - start),
                            "-r",
                            str(fps),
                            "-c:v",
                            "libx264",
                            "-crf",
                            "18",
                            "-pix_fmt",
                            "yuv420p",
                        ]
                        command += (
                            [
                                "-map",
                                "0:a?",
                                "-af",
                                f"atrim=start={offset}:duration={(end - start) / source_fps},asetpts=PTS-STARTPTS,"
                                + tempo_filter(fps / source_fps)
                                + f",apad,atrim=duration={duration}",
                                "-c:a",
                                "aac",
                            ]
                            if audio
                            else ["-an"]
                        )
                    else:
                        command += ["-vf", f"trim=start_frame={first},setpts=PTS-STARTPTS", "-frames:v", "1"]
                    subprocess.run([*command, str(pending)], check=True, capture_output=True, timeout=1800)
                pending.replace(output)
            finally:
                pending.unlink(missing_ok=True)
        return {
            "file": output.relative_to(self.host_roots["input"]).as_posix(),
            "settings": settings,
            "sourceMediaId": metadata["id"],
        }

    def original_source(self, metadata):
        original = metadata.get("originalFile", metadata["file"])
        source = Path(original) if Path(original).is_absolute() else self.resolve(original)
        if not source.is_file() or source.suffix.lower() not in EXTENSIONS:
            raise ValueError("Original media is missing. Restore the source file before exporting.")
        native = metadata.get("fps")
        return {"path": source, "offset": metadata.get("sourceRange", {}).get("start", 0), "fps": native}

    def bake_audio(self, segments, fps, frames):
        ffmpeg = find_tool("ffmpeg")
        if not ffmpeg:
            raise ValueError("Install ffmpeg to prepare generation audio")
        if fps <= 0 or frames <= 0:
            raise ValueError("Audio inputs require a positive shot duration")
        duration = frames / fps
        command = [ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-t", str(duration), "-i", "anullsrc=r=48000:cl=stereo"]
        filters, labels, sources = [], ["[0:a]"], []
        for index, segment in enumerate(segments, 1):
            metadata = segment["media"]
            original = metadata.get("originalFile", metadata["file"])
            path = Path(original) if Path(original).is_absolute() else self.resolve(original)
            if not path.is_file() or path.suffix.lower() not in AUDIO_EXTENSIONS | VIDEO_EXTENSIONS:
                raise ValueError("Original audio is missing. Restore the source file.")
            if not any(s["codec_type"] == "audio" for s in _probe(path)["streams"]):
                raise ValueError("The chosen source has no audio stream")
            length = (segment["out"] - segment["in"]) / fps
            position = segment["start"] / fps
            native = rate(metadata.get("fps"), fps)
            speed = fps / native
            offset = (metadata.get("sourceRange", {}).get("start", 0) + segment["in"]) / native
            audio = segment.get("audio", {})
            fade_in = min(max(0, audio.get("fadeIn", 0) / fps), length / 2)
            fade_out = min(max(0, audio.get("fadeOut", 0) / fps), length / 2)
            skip = max(0, -position)
            overlap = min(length - skip, duration - max(0, position))
            command += ["-ss", str(offset + skip * speed), "-t", str(overlap * speed), "-i", str(path)]
            chain = (
                f"[{index}:a]asetpts=PTS-STARTPTS,"
                + tempo_filter(speed)
                + f",apad,atrim=duration={overlap},asetpts=PTS+{skip}/TB,aresample=48000,aformat=channel_layouts=stereo,volume={max(-60, min(6, audio.get('gainDb', 0)))}dB"
            )
            if fade_in:
                chain += f",afade=t=in:st=0:d={fade_in}"
            if fade_out:
                chain += f",afade=t=out:st={length - fade_out}:d={fade_out}"
            chain += f",asetpts=PTS-STARTPTS,adelay={round(max(0, position) * 48000)}S:all=1,apad[a{index}]"
            filters.append(chain)
            labels.append(f"[a{index}]")
            with path.open("rb") as handle:
                checksum = hashlib.file_digest(handle, "sha256").hexdigest()
            sources.append(
                {
                    "sourceMediaId": metadata["id"],
                    "sourceSha256": checksum,
                    "offsetSeconds": offset,
                    "durationSeconds": length,
                    "startSeconds": position,
                    "speed": speed,
                    "audio": audio,
                }
            )
        settings = {
            "slot": "audio",
            "fps": fps,
            "durationSeconds": duration,
            "sources": sources,
            "policy": "interpreted-original-audio-v1",
        }
        key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()
        output = contained(self.host_roots["input"], "spool-baked/" + key + ".wav")
        output.parent.mkdir(exist_ok=True)
        if not output.exists():
            pending = output.with_name(output.stem + "-" + uid() + output.suffix)
            filters.append(
                "".join(labels)
                + f"amix=inputs={len(labels)}:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1,atrim=duration={duration}[mix]"
            )
            try:
                result = subprocess.run(
                    [
                        *command,
                        "-filter_complex",
                        ";".join(filters),
                        "-map",
                        "[mix]",
                        "-c:a",
                        "pcm_s16le",
                        "-ar",
                        "48000",
                        "-t",
                        str(duration),
                        str(pending),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=1800,
                )
                if result.returncode:
                    raise ValueError(result.stderr[-1200:] or "Could not prepare generation audio")
                pending.replace(output)
            finally:
                pending.unlink(missing_ok=True)
        return {"file": output.relative_to(self.host_roots["input"]).as_posix(), "settings": settings}

    def find_cuts(self, metadata, fps, start, end, width=960, height=540):
        if metadata["kind"] != "video":
            raise ValueError("Select a video clip to detect cuts")
        file = metadata["file"]
        if (
            metadata.get("frameRateMode") == "interpret"
            and metadata.get("review", {}).get("frameRateMode") != "interpret"
        ):
            if self.playback:
                self.playback.submit(self, metadata, width, height, fps).result()
                file = self.preview_result(metadata, width, height, fps)["file"]
            else:
                file = self.preview(metadata, width, height, fps)["file"]
            offset = metadata.get("sourceRange", {}).get("start", 0)
            start, end = start + offset, end + offset
        scores = scene_scores(find_tool("ffmpeg"), self.resolve(file), self.cache / "previews" / "cut-scores")
        return detect_cuts(scores[int(start) : int(end)], fps)

    def preview_path(self, metadata, width, height, fps):
        source = self.original_source(metadata)["path"].resolve()
        stat = source.stat()
        signature = json.dumps(
            [str(source), stat.st_size, stat.st_mtime_ns, width, height, float(fps), PLAYBACK_VERSION]
        )
        key = hashlib.sha256(signature.encode()).hexdigest()[:24]
        extension = ".png" if metadata["kind"] == "image" else ".mp4"
        return self.playback_cache / (key + extension)

    def preview(self, metadata, width, height, fps):
        """Cache a timeline-sized playback source, shared by shots from the same original."""
        source = self.original_source(metadata)
        run = self.playback.run if self.playback is not None else subprocess.run
        output = self.preview_path(metadata, width, height, fps)
        output.parent.mkdir(parents=True, exist_ok=True)
        if not output.exists():
            pending = output.with_name(output.stem + "-" + uid() + output.suffix)
            try:
                if metadata["kind"] == "image":
                    with Image.open(source["path"]) as image:
                        picture = ImageOps.exif_transpose(image).convert("RGBA")
                        picture.thumbnail((width, height), Image.Resampling.LANCZOS)
                        picture.save(pending)
                else:
                    ffmpeg = find_tool("ffmpeg")
                    if not ffmpeg:
                        raise ValueError("Install ffmpeg for video playback")
                    native = rate(source["fps"] or _video_stream(_probe(source["path"]))["avg_frame_rate"], fps)
                    run(
                        [
                            ffmpeg,
                            "-v",
                            "error",
                            "-y",
                            "-i",
                            str(source["path"]),
                            "-map",
                            "0:v:0",
                            "-map",
                            "0:a?",
                            "-vf",
                            frames_filter(fps)
                            + f",scale=w='min({width},iw)':h='min({height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                            "-r",
                            str(fps),
                            "-c:v",
                            "libx264",
                            "-threads",
                            "2",
                            "-crf",
                            "18",
                            "-preset",
                            "ultrafast",
                            "-pix_fmt",
                            "yuv420p",
                            "-g",
                            str(max(1, round(fps))),
                            "-bf",
                            "0",
                            "-c:a",
                            "aac",
                            "-af",
                            tempo_filter(fps / native) + ",apad",
                            "-shortest",
                            "-movflags",
                            "+faststart",
                            str(pending),
                        ],
                        check=True,
                        capture_output=True,
                        timeout=1800,
                    )
                    _review_probe(pending, fps, run)
                pending.replace(output)
            finally:
                pending.unlink(missing_ok=True)
        return self.preview_result(metadata, width, height, fps)

    def preview_result(self, metadata, width, height, fps):
        output = self.preview_path(metadata, width, height, fps)
        return {
            "state": "ready",
            "file": "_playback/" + output.name,
            "width": width,
            "height": height,
            "offset": metadata.get("sourceRange", {}).get("start", 0) / fps,
        }

    def export_frame(self, metadata, frame, fps):
        frame = int(frame)
        if metadata["kind"] not in ("video", "image") or not 0 <= frame < metadata["frames"]:
            raise ValueError("Choose a frame inside the footage")
        ffmpeg = find_tool("ffmpeg")
        if not ffmpeg:
            raise ValueError("Install ffmpeg to export frames")
        original = self.original_source(metadata)
        folder = self.root / "exports"
        folder.mkdir(exist_ok=True)
        output = folder / f"spool-frame-{frame:06d}-{uid()[:8]}.png"
        command = [ffmpeg, "-v", "error", "-y"]
        if metadata["kind"] == "video":
            command += [
                "-i",
                str(original["path"]),
                "-vf",
                f"trim=start_frame={original['offset'] + frame},setpts=PTS-STARTPTS",
            ]
        else:
            command += ["-i", str(original["path"])]
        command += ["-map", "0:v:0", "-frames:v", "1", str(output)]
        subprocess.run(command, check=True, capture_output=True, timeout=60)
        if not output.is_file():
            raise ValueError("The source has no frame at this position")
        return {
            "url": ("/spool/media/" + self.project_id + "/exports/" if self.project_id else "/spool/media/exports/")
            + output.name,
            "filename": output.name,
        }

    def comparison(self, clip, take_ids, fps):
        if not isinstance(take_ids, list) or not 1 <= len(take_ids) <= 12 or len(set(take_ids)) != len(take_ids):
            raise ValueError("Choose 1-12 distinct takes to compare")
        takes = [
            next((t for t in clip["takes"] if t["id"] == identity and not t.get("placeholder")), None)
            for identity in take_ids
        ]
        if any(t is None for t in takes):
            raise ValueError("A comparison take is unavailable for this shot")
        columns = min(4, len(takes))
        canvas = Image.new("RGB", (columns * 384, ((len(takes) + columns - 1) // columns) * 256), "#181818")
        drawing = ImageDraw.Draw(canvas)
        evidence = []
        for index, take in enumerate(takes):
            metadata = take["media"]
            frame = min(
                metadata["frames"] - 1,
                max(0, (clip.get("in", 0) + min(clip.get("out", metadata["frames"]), metadata["frames"]) - 1) // 2),
            )
            result = self.export_frame(metadata, frame, fps)
            with Image.open(self.root / "exports" / result["filename"]) as image:
                tile = ImageOps.contain(image.convert("RGB"), (384, 216))
                x, y = index % columns * 384, index // columns * 256
                canvas.paste(tile, (x + (384 - tile.width) // 2, y + (216 - tile.height) // 2))
                drawing.text((x + 8, y + 224), take["id"][:32], fill="white")
            evidence.append(
                {
                    "takeId": take["id"],
                    "sampleFrame": frame,
                    **{k: metadata.get(k) for k in ("kind", "duration", "width", "height", "fps", "audio")},
                }
            )
        target = self.root / "exports" / ("comparison-" + uid() + ".png")
        canvas.save(target)
        return {
            "url": ("/spool/media/" + self.project_id + "/exports/" if self.project_id else "/spool/media/exports/")
            + target.name,
            "takes": evidence,
            "note": "Representative original frames; review playback for motion quality",
        }

    def export(self, data, metadata=()):
        files = {c["file"] for c in [*data.get("clips", []), *data.get("audioClips", [])]}
        sources = {m["file"]: self.original_source(m) for m in metadata if m["file"] in files}
        result = export_sequence(
            data, root=self.root, resolve=self.resolve, probe=_probe, image_extensions=IMAGE_EXTENSIONS, sources=sources
        )
        result["url"] = "/spool/media/" + (self.project_id + "/" if self.project_id else "") + result["url"]
        return result

    def export_timeline(self, data, metadata=()):
        files = {c["file"] for t in data.get("tracks", []) for c in t.get("clips", [])}
        sources = {m["file"]: self.original_source(m) for m in metadata if m["file"] in files}
        return export_timeline(
            data,
            root=self.root,
            fps=float(data.get("fps", 24)),
            width=int(data.get("width", 960)),
            height=int(data.get("height", 540)),
            name=data.get("name"),
            sources=sources,
            resolve=self.resolve,
            probe=_probe,
            image_extensions=IMAGE_EXTENSIONS,
        )
