"""Real installed Comfy CPU execution and process-restart verification."""

import argparse
import copy
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")


parser = argparse.ArgumentParser()
parser.add_argument("--python", required=True)
parser.add_argument("--comfy", required=True)
parser.add_argument("--runtime", required=True)
parser.add_argument("--port", type=int, default=8198)
args = parser.parse_args()
root = Path(args.runtime).resolve()
root.mkdir(parents=True, exist_ok=True)
base = "http://127.0.0.1:" + str(args.port)
process = None
evidence = {"kind": "live installed Comfy CPU host", "checks": [], "prompts": []}


def call(path, data=None, method=None, headers=None, raw=None):
    body = raw if raw is not None else json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(
        base + path, data=body, method=method, headers={"Content-Type": "application/json", **(headers or {})}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def start():
    global process
    log = (root / "host.log").open("ab")
    process = subprocess.Popen(
        [
            args.python,
            "-s",
            str(Path(__file__).with_name("run_host.py")),
            "--comfy",
            args.comfy,
            "--runtime",
            str(root),
            "--port",
            str(args.port),
        ],
        stdout=log,
        stderr=log,
    )
    log.close()
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("CPU host exited; inspect " + str(root / "host.log"))
        try:
            return call("/spool/api/health")
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.5)
    raise RuntimeError("CPU host startup timed out")


def stop():
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=20)


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    evidence["checks"].append(name)
    print("PASS", name, flush=True)


def make_project(prompt, saver, group="images"):
    p = call("/spool/api/projects", {})
    c = {
        "id": "clip-live",
        "name": "CPU check",
        "workflow": None,
        "sources": [],
        "prompt": "",
        "revision": 1,
        "count": 1,
        "in": 0,
        "out": 24,
        "takeId": "placeholder",
        "takes": [
            {
                "id": "placeholder",
                "number": 0,
                "placeholder": True,
                "media": {
                    "id": "placeholder-media",
                    "kind": "image",
                    "file": "assets/black.png",
                    "frames": 24,
                    "poster": "assets/black.png",
                },
            }
        ],
    }
    p["document"]["clips"] = [c]
    p = call("/spool/api/projects/" + p["id"], {"revision": 0, "document": p["document"]}, "PUT")
    return call(
        "/spool/api/projects/" + p["id"] + "/capture/clip-live",
        {
            "revision": p["revision"],
            "capture": {
                "workflow": {"nodes": []},
                "prompt": prompt,
                "bindings": [],
                "result": {"nodeId": saver, "group": group, "index": 0},
            },
        },
    )


def queue(p, count=1):
    return call(
        "/spool/api/projects/" + p["id"] + "/queue", {"revision": p["revision"], "clips": ["clip-live"], "count": count}
    )


def finished(p):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        p = call("/spool/api/projects/" + p["id"])
        if all(j["status"] in ("complete", "failed") for j in p["document"]["jobs"]):
            return p
        time.sleep(0.3)
    raise AssertionError("Collection timeout: " + json.dumps(p["document"]["jobs"]))


try:
    start()
    stats = call("/system_stats")
    evidence["system"] = stats["system"]
    extensions = [x for x in call("/extensions") if "/extensions/core/" not in x]
    expected_extensions = {
        "/extensions/" + Path(__file__).resolve().parent.parent.name + "/" + file.name
        for file in Path(__file__).resolve().parent.parent.joinpath("web").glob("*.js")
    }
    check(
        "Host uses CPU and no other custom extensions",
        stats["devices"][0]["type"] == "cpu" and set(extensions) == expected_extensions,
    )
    source = root / "input" / "synthetic.png"
    source.parent.mkdir(exist_ok=True)
    Image.new("RGB", (16, 16), (12, 100, 200)).save(source)
    prompt = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "synthetic.png"}},
        "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "CPU"}},
    }
    authored = copy.deepcopy(prompt)
    p = queue(make_project(prompt, "2"), 2)
    p = finished(p)
    check(
        "Two genuine CPU image takes complete, remain unselected",
        all(j["status"] == "complete" for j in p["document"]["jobs"])
        and p["document"]["clips"][0]["takeId"] == "placeholder"
        and len(p["document"]["clips"][0]["takes"]) == 3,
    )
    for j in p["document"]["jobs"]:
        attempt = call("/spool/api/attempts/" + j["id"])
        evidence["prompts"].append(j["promptId"])
        history = call("/history/" + j["promptId"])[j["promptId"]]
        captured = attempt["request"]["capture"]["prompt"]
        staged = captured["1"]["inputs"]["image"]
        same_graph = {
            **captured,
            "1": {**captured["1"], "inputs": {**captured["1"]["inputs"], "image": "synthetic.png"}},
        } == authored
        check(
            "Exact prompt history, project-owned input and frozen copy " + j["promptId"],
            history["status"]["status_str"] == "success"
            and same_graph
            and staged.startswith("spool-projects/")
            and "/.spool/frozen/" in attempt["request"]["prompt"]["1"]["inputs"]["image"],
        )
    choice = p["document"]["clips"][0]["takes"][1]["id"]
    p["document"]["clips"][0].update({"takeId": choice, "in": 2, "out": 20})
    p = call("/spool/api/projects/" + p["id"], {"revision": p["revision"], "document": p["document"]}, "PUT")
    try:
        call("/spool/api/projects/" + p["id"], {"revision": p["revision"] - 1, "document": p["document"]}, "PUT")
        raise AssertionError("Stale write accepted")
    except urllib.error.HTTPError as error:
        check("Real routes reject stale view writes", error.code == 409)
    call("/spool/api/reconcile", {})
    check(
        "Duplicate reconciliation creates no extra takes",
        len(call("/spool/api/projects/" + p["id"])["document"]["clips"][0]["takes"]) == 3,
    )
    backup = call("/spool/api/projects/" + p["id"] + "/export")
    restored = call("/spool/api/import-project", backup)
    rc = restored["document"]["clips"][0]
    check(
        "Real project backup/import preserves chosen media and executable recipe",
        rc["takeId"] == choice
        and len(rc["takes"]) == 3
        and rc["workflowVersion"] in restored["recipes"]
        and rc["takes"][1]["media"] == p["document"]["clips"][0]["takes"][1]["media"],
    )
    saved_id, saved_revision = p["id"], p["revision"]
    stop()
    start()
    p = call("/spool/api/projects/" + saved_id)
    check(
        "Real host process restart preserves revision, choice, trims and collected takes",
        p["revision"] == saved_revision
        and p["document"]["clips"][0]["takeId"] == choice
        and p["document"]["clips"][0]["in"] == 2
        and len(p["document"]["clips"][0]["takes"]) == 3,
    )
    check(
        "Durable media is readable after host history was lost",
        not call("/history/" + evidence["prompts"][0])
        and (Path(p["folder"]) / p["document"]["clips"][0]["takes"][1]["media"]["file"]).is_file(),
    )

    invalid = copy.deepcopy(prompt)
    invalid["3"] = {"class_type": "SaveImage", "inputs": {"images": ["missing", 0], "filename_prefix": "invalid"}}
    bad = queue(make_project(invalid, "3"))
    attempt = call("/spool/api/attempts/" + bad["document"]["jobs"][0]["id"])
    check(
        "Omitted invalid primary cannot enter queue despite another valid output",
        attempt["status"] == "failed"
        and attempt["dispatch"]["validation"]["acceptedOutputs"] == ["2"]
        and "3" in attempt["dispatch"]["validation"]["nodeErrors"]
        and not call("/queue")["queue_pending"],
    )

    raw = '{"1":{"class_type":"PrimitiveInt","inputs":{"value":18446744073709551615}}}'
    imported = call(
        "/spool/api/projects/" + p["id"] + "/import-workflow",
        headers={"X-Spool-Revision": str(p["revision"]), "X-Filename": "exact-seed.json"},
        raw=raw.encode(),
    )
    check(
        "Raw API JSON preserves uint64 before browser parsing",
        imported["workflow"]["data"]["prompt"]["1"]["inputs"]["value"] == {"__spool_int__": "18446744073709551615"},
    )

    video = root / "input" / "synthetic.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=64x48:rate=30:duration=0.5",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:size=64x48:rate=30:duration=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-filter_complex",
            "[0:v][1:v]concat=n=2:v=1:a=0[v]",
            "-map",
            "[v]",
            "-map",
            "2:a",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(video),
        ],
        check=True,
    )
    video_prompt = {
        "1": {"class_type": "LoadVideo", "inputs": {"file": "synthetic.mp4"}},
        "2": {
            "class_type": "SaveVideo",
            "inputs": {"video": ["1", 0], "filename_prefix": "CPU-video", "format": "auto", "format.codec": "auto"},
        },
    }
    vp = finished(queue(make_project(video_prompt, "2")))
    check("Real CPU LoadVideo → SaveVideo completes and collects", vp["document"]["jobs"][0]["status"] == "complete")
    m = vp["document"]["clips"][0]["takes"][1]["media"]
    print(
        "video take",
        json.dumps(
            {k: m.get(k) for k in ("fps", "width", "height", "audio", "frames", "sequenceFps", "file", "originalFile")}
        ),
        flush=True,
    )
    check(
        "Original 30 fps/dimensions/audio retained; every source frame used once on the 24 fps sequence",
        m["fps"] == "30/1"
        and m["width"] == 64
        and m["height"] == 48
        and m["audio"]
        and m["frames"] == 30
        and m["file"] != m["originalFile"],
    )
    # Cuts are searched inside the clip's trim; open it to the take's full 30 source frames.
    vp = call("/spool/api/projects/" + vp["id"])
    vp["document"]["clips"][0].update({"in": 0, "out": m["frames"]})
    vp = call("/spool/api/projects/" + vp["id"], {"revision": vp["revision"], "document": vp["document"]}, "PUT")
    cuts_route = "/spool/api/projects/" + vp["id"] + "/detect-cuts"
    cuts_request = {"clipId": "clip-live", "takeId": vp["document"]["clips"][0]["takes"][1]["id"]}
    found_cuts = call(cuts_route, cuts_request)["cuts"]
    print("cuts", found_cuts, flush=True)
    check("Real cut route finds the exact source-frame transition", found_cuts == [15])
    scores = list((Path(vp["folder"]) / ".spool" / "previews" / "cut-scores").glob("*.json"))
    stamps = {str(path): path.stat().st_mtime_ns for path in scores}
    check(
        "Repeated cut route reuses its durable scan",
        bool(stamps)
        and call(cuts_route, cuts_request)["cuts"] == [15]
        and all(path.stat().st_mtime_ns == stamps[str(path)] for path in scores),
    )
    stop()
    start()
    check(
        "Cut scores survive a real host restart",
        call(cuts_route, cuts_request)["cuts"] == [15]
        and all(path.stat().st_mtime_ns == stamps[str(path)] for path in scores),
    )
    req = urllib.request.Request(base + "/spool/media/" + vp["id"] + "/" + m["file"], headers={"Range": "bytes=0-31"})
    with urllib.request.urlopen(req) as response:
        check(
            "Native media route supports seeking with byte ranges",
            response.status == 206 and len(response.read()) == 32,
        )
    exported = call(
        "/spool/api/export?projectId=" + vp["id"],
        {
            "projectId": vp["id"],
            "clips": [{"file": m["file"], "in": 0, "out": 24}],
            "audioClips": [{"file": m["file"], "in": 0, "out": 24, "start": 0, "gainDb": -6}],
            "audio": True,
        },
    )
    export_path = Path(vp["folder"]) / exported["url"].removeprefix("/spool/media/" + vp["id"] + "/")
    probe = json.loads(
        subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(export_path)]
        )
    )
    check(
        "Real sequence/audio export is one second, 960×540 at 24 fps",
        abs(float(probe["format"]["duration"]) - 1) < 0.1
        and probe["streams"][0]["width"] == 960
        and probe["streams"][0]["avg_frame_rate"] == "24/1"
        and any(s["codec_type"] == "audio" for s in probe["streams"]),
    )
    timeline = call(
        "/spool/api/export/otio?projectId=" + vp["id"],
        {
            "projectId": vp["id"],
            "fps": 24,
            "duration": 24,
            "name": "Live",
            "tracks": [
                {
                    "kind": "video",
                    "name": "V1",
                    "clips": [{"id": "clip-live", "file": m["file"], "start": 0, "in": 0, "out": 24}],
                },
                {
                    "kind": "audio",
                    "name": "A1",
                    "clips": [{"id": "clip-live", "file": m["file"], "start": 0, "in": 0, "out": 24}],
                },
            ],
        },
    )
    video_clip = json.loads(Path(timeline["path"]).read_text(encoding="utf-8"))["tracks"]["children"][0]["children"][0]
    original = (Path(vp["folder"]) / m["originalFile"]).resolve()
    print("timeline clip", json.dumps({k: video_clip[k] for k in ("source_range", "effects")}), flush=True)
    check(
        "Real timeline export references the original 30 fps take, interpreted once per 24 fps frame",
        video_clip["media_reference"]["target_url"] == str(original.resolve())
        and video_clip["source_range"]["duration"] == {"OTIO_SCHEMA": "RationalTime.1", "rate": 24.0, "value": 24.0}
        and video_clip["media_reference"]["available_range"]["duration"]["value"] == 30
        and [e["time_scalar"] for e in video_clip["effects"]] == [0.8],
    )
    evidence["videoProjectId"] = vp["id"]
    evidence["prompts"].append(vp["document"]["jobs"][0]["promptId"])
    evidence["completed"] = True
finally:
    stop()
    (root / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
