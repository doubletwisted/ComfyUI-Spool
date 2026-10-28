"""Private sequence export; the Media owner supplies storage, probing and formats."""
import math
import subprocess
import tempfile
import uuid
from pathlib import Path
from .system import find_tool
from .timing import rate, frames_filter, tempo_filter


def run_ffmpeg(command, message):
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError(result.stderr[-1200:] or message)


def export_sequence(data, *, root, resolve, probe, image_extensions, sources=None):
    ffmpeg, ffprobe = find_tool("ffmpeg"), find_tool("ffprobe")
    clips = data.get("clips", [])
    fps = float(data.get("fps", 24))
    audio_offset = int(data.get("audioOffset", 0)) / fps
    if audio_offset < 0:
        raise ValueError("Export start must not be negative.")
    width, height = int(data.get("width", 960)), int(data.get("height", 540))
    if width < 2 or height < 2 or width % 2 or height % 2:
        raise ValueError("MP4 width and height must be positive even numbers.")
    if not clips:
        raise ValueError("Add a clip before exporting.")
    if not ffmpeg or not ffprobe:
        raise ValueError("ffmpeg and ffprobe must be installed for video export.")
    output_dir = root / "exports"
    output_dir.mkdir(exist_ok=True)
    output = output_dir / f"spool-{uuid.uuid4().hex[:10]}.mp4"
    with tempfile.TemporaryDirectory(prefix="spool-export-") as temp:
        rendered = []
        legacy_audio = []
        total_frames = 0
        for index, clip in enumerate(clips):
            original = (sources or {}).get(clip["file"])
            source = original["path"] if original else resolve(clip["file"])
            first = int(clip['in']) + (original['offset'] if original else 0)
            duration = (int(clip["out"]) - int(clip["in"])) / fps
            if first < 0 or duration <= 0:
                raise ValueError("A clip has invalid trim points.")
            target = Path(temp) / f"{index:04d}.mp4"
            image = source.suffix.lower() in image_extensions
            if "audioClips" not in data and not image and any(s["codec_type"] == "audio" for s in probe(source)["streams"]):
                legacy_audio.append({**clip, "start": total_frames})
            frames = int(clip["out"]) - int(clip["in"])
            total_frames += frames
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
            if image:
                command += ["-loop", "1", "-framerate", str(fps), "-i", str(source)]
            else:
                command += ["-i", str(source)]
            command += [
                "-map", "0:v:0", "-an", "-frames:v", str(frames),
                "-vf", (f'fps={fps}' if image else frames_filter(fps, first, first+frames))+f",scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1", "-r", str(fps),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                "-pix_fmt", "yuv420p", str(target),
            ]
            run_ffmpeg(command, "Could not render a clip.")
            rendered.append(target)
        concat = Path(temp) / "sequence.txt"
        concat.write_text("\n".join(f"file '{p.as_posix()}'" for p in rendered), encoding="utf-8")
        video = Path(temp) / "video.mp4"
        run_ffmpeg([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
                    "-safe", "0", "-i", str(concat), "-c", "copy", str(video)],
                   "Could not assemble the sequence.")
        duration = total_frames / fps
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video)]
        audio_clips = [c for c in data.get("audioClips", legacy_audio) if not c.get("muted")] if data.get("audio", True) else []
        if data.get("audio", True):
            command += ["-f", "lavfi", "-t", str(duration + audio_offset), "-i", "anullsrc=r=48000:cl=stereo"]
            filters = []
            labels = ["[1:a]"]
            for index, clip in enumerate(audio_clips, 2):
                original = (sources or {}).get(clip['file'])
                source = original['path'] if original else resolve(clip['file'])
                native = rate(original.get('fps') if original else None, fps)
                speed = fps/native
                start = (int(clip['in'])+(original['offset'] if original else 0))/native
                length = (int(clip["out"]) - int(clip["in"])) / fps
                position = int(clip.get("start", 0)) / fps
                gain = float(clip.get("gainDb", 0))
                fade_in = float(clip.get("fadeIn", 0)) / fps
                fade_out = float(clip.get("fadeOut", 0)) / fps
                if start < 0 or length <= 0 or position < 0 or not all(math.isfinite(v) for v in [gain, fade_in, fade_out]):
                    raise ValueError("An audio clip has invalid timing or level.")
                if not any(s["codec_type"] == "audio" for s in probe(source)["streams"]):
                    raise ValueError("An audio clip has no audio stream.")
                command += ["-ss", str(start), "-t", str(length*speed), "-i", str(source)]
                chain = f"[{index}:a]asetpts=PTS-STARTPTS,"+tempo_filter(speed)+f",apad,atrim=duration={length},aresample=48000,aformat=channel_layouts=stereo,volume={gain}dB"
                if fade_in > 0:
                    chain += f",afade=t=in:st=0:d={min(fade_in, length/2)}"
                if fade_out > 0:
                    fade_out = min(fade_out, length / 2)
                    chain += f",afade=t=out:st={length-fade_out}:d={fade_out}"
                chain += f",adelay={round(position*48000)}S:all=1,apad[a{index}]"
                filters.append(chain)
                labels.append(f"[a{index}]")
            filters.append("".join(labels) + f"amix=inputs={len(labels)}:duration=first:normalize=0,alimiter=limit=0.98:level=0:latency=1,atrim=start={audio_offset}:duration={duration},asetpts=PTS-STARTPTS[mix]")
            command += ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[mix]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
        else:
            command += ["-map", "0:v:0", "-an"]
        command += ["-c:v", "copy", "-t", str(duration), "-movflags", "+faststart", str(output)]
        run_ffmpeg(command, "Could not render the audio mix.")
    return {"url": f"exports/{output.name}", "filename": output.name}
