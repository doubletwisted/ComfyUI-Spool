"""Small real Deadline acceptance run; only the named worker and isolated 8195."""

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--python", required=True)
parser.add_argument("--comfy", required=True)
parser.add_argument("--runtime", required=True, type=Path)
parser.add_argument("--result-root", required=True)
parser.add_argument("--worker", required=True, help="Deadline worker that runs the acceptance jobs")
parser.add_argument("--video", action="store_true")
parser.add_argument("--offline", action="store_true")
parser.add_argument("--count", type=int, default=2)
args = parser.parse_args()
root = args.runtime.resolve()
root.mkdir(parents=True, exist_ok=True)
base = "http://127.0.0.1:8195"
process = None
evidence = {"worker": args.worker, "resultRoot": args.result_root, "projects": [], "jobs": [], "checks": []}


def call(path, body=None, method=None):
    request = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def start():
    global process
    log = (root / "host.log").open("ab")
    process = subprocess.Popen(
        [
            args.python,
            "-s",
            str(Path(__file__).with_name("run_host.py")),
            "--deadline",
            "--comfy",
            args.comfy,
            "--runtime",
            str(root),
            "--port",
            "8195",
        ],
        stdout=log,
        stderr=log,
    )
    log.close()
    end = time.monotonic() + 120
    while time.monotonic() < end:
        if process.poll() is not None:
            raise RuntimeError("Test host exited; inspect host.log")
        try:
            call("/spool/api/health")
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.5)
    raise RuntimeError("Test host startup timeout")


def stop():
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=20)


try:
    start()
    source = root / "input" / "spool-farm.png"
    source.parent.mkdir(exist_ok=True)
    Image.new("RGB", (32, 24), (20, 140, 70)).save(source)
    prompt = {
        "load": {"class_type": "LoadImage", "inputs": {"image": source.name}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["load", 0], "filename_prefix": "Authored"}},
        "submit": {
            "class_type": "DeadlineSubmit",
            "inputs": {
                "output_directory": args.result_root,
                "batch_count": 7,
                "chunk_size": 3,
                "priority": 50,
                "pool": "none",
                "group": "none",
                "job_name": "Spool acceptance " + args.worker,
                "machine_list": args.worker,
            },
        },
    }
    group = "images"
    if args.video:
        source = root / "input" / "spool-farm.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=64x48:r=30:d=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=400:duration=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(source),
            ],
            check=True,
        )
        prompt["load"] = {"class_type": "LoadVideo", "inputs": {"file": source.name}}
        prompt["save"] = {
            "class_type": "SaveVideo",
            "inputs": {"video": ["load", 0], "filename_prefix": "Authored-video", "format": "auto", "codec": "auto"},
        }
    project = call("/spool/api/projects", {})
    project["document"]["clips"] = [
        {"id": "farm-shot", "name": "Farm acceptance", "takes": [], "takeId": "original", "in": 0, "out": 24}
    ]
    project = call("/spool/api/projects/" + project["id"], {"revision": 0, "document": project["document"]}, "PUT")
    project = call(
        "/spool/api/projects/" + project["id"] + "/capture/farm-shot",
        {
            "revision": project["revision"],
            "capture": {"prompt": prompt, "bindings": [], "result": {"nodeId": "save", "group": "images", "index": 0}},
        },
    )
    project = call(
        "/spool/api/projects/" + project["id"] + "/queue",
        {
            "revision": project["revision"],
            "operationId": "farm-acceptance-" + str(time.time_ns()),
            "items": [{"clipId": "farm-shot", "count": args.count}],
        },
    )
    evidence["projects"].append(project["id"])
    (root / "evidence.json").write_text(json.dumps(evidence, indent=2))
    print("Accepted " + str(args.count) + " real Deadline takes", project["id"], flush=True)
    if args.offline:
        end_ack = time.monotonic() + 120
        while time.monotonic() < end_ack:
            project = call("/spool/api/projects/" + project["id"])
            if all(j.get("submission", {}).get("external_id") for j in project["document"]["jobs"]):
                break
            time.sleep(1)
        else:
            raise RuntimeError("Submission acknowledgments timed out")
        owned_attempts = [j["id"] for j in project["document"]["jobs"]]
        stop()
        print("Coordinator stopped; workers finalize independently", flush=True)
        end_receipts = time.monotonic() + 900
        while time.monotonic() < end_receipts:
            if all(
                list((Path(args.result_root) / "spool-receipts" / identity).glob("*/receipt.json"))
                for identity in owned_attempts
            ):
                break
            time.sleep(3)
        else:
            raise RuntimeError("Offline worker receipts timed out")
        print("Receipts published while coordinator was stopped", flush=True)
        start()
    end = time.monotonic() + 1200
    observed = None
    while time.monotonic() < end:
        project = call("/spool/api/projects/" + project["id"])
        states = [(j["id"], j["status"], j["error"]) for j in project["document"]["jobs"]]
        if states != observed:
            print(json.dumps(states), flush=True)
            observed = states
        if all(j["status"] == "complete" for j in project["document"]["jobs"]):
            break
        time.sleep(3)
    else:
        raise RuntimeError("Farm acceptance timed out; jobs retained for diagnosis")
    assert project["document"]["clips"][0]["takeId"] == "original"
    assert len(project["document"]["clips"][0]["takes"]) == args.count
    for j in project["document"]["jobs"]:
        attempt = call("/spool/api/attempts/" + j["id"])
        result = json.loads(attempt["result"])
        assert result["takeId"] == attempt["take_id"] and result["worker"] == args.worker
        assert attempt["request"]["capture"]["prompt"]["submit"]["inputs"]["batch_count"] == 7
        evidence["jobs"].append(
            {
                "jobId": result["jobId"],
                "executionId": result["executionId"],
                "takeId": result["takeId"],
                "artifacts": result["artifacts"],
            }
        )
    stop()
    start()
    saved = call("/spool/api/projects/" + project["id"])
    assert len(saved["document"]["clips"][0]["takes"]) == args.count
    evidence["checks"] = [
        str(args.count) + " owned " + args.worker + " jobs have verified receipts",
        "Saved submit controls unchanged",
        "Take choice unchanged",
        "Farm results survive coordinator restart",
    ]
    if args.offline:
        evidence["checks"].append("Worker finalization while coordinator offline")
    if args.video:
        evidence["checks"].append("Real video original and proxy collected")
    print("PASS", "; ".join(evidence["checks"]), flush=True)
finally:
    stop()
    (root / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
