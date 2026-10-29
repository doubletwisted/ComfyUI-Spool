"""External CLI session against an isolated CPU host and its standalone store."""

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--python", required=True)
parser.add_argument("--comfy", required=True)
parser.add_argument("--runtime", required=True)
parser.add_argument("--port", type=int, default=8199, help="A free port for the isolated host")
args = parser.parse_args()
root = Path(args.runtime).resolve()
root.mkdir(parents=True, exist_ok=True)
project_root = Path(__file__).resolve().parent.parent
host = standalone = None
base = "http://127.0.0.1:" + str(args.port)
evidence = {"checks": [], "cliCalls": 0, "cliResponseBytes": 0}


def call(path, data=None, method=None):
    req = urllib.request.Request(
        base + "/spool/api/" + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def wait_ready(process):
    end = time.monotonic() + 90
    while time.monotonic() < end:
        if process.poll() is not None:
            raise RuntimeError("Owned test process exited; inspect host.log")
        try:
            return call("health")
        except OSError:
            time.sleep(0.3)
    raise RuntimeError("Owned test server did not become ready")


def start_host():
    log = (root / "host.log").open("ab")
    process = subprocess.Popen(
        [
            args.python,
            "-s",
            str(project_root / "tests/run_host.py"),
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
    wait_ready(process)
    return process


def stop(process):
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=30)


def cli(action, *extra, envelope=None):
    command = [sys.executable, "-m", "spool", action, project["id"], "--url", base, *extra]
    if envelope is not None:
        filename = root / (envelope["operationId"] + ".json")
        filename.write_text(json.dumps(envelope), encoding="utf-8")
        command += ["--file", str(filename)]
    output = subprocess.check_output(command, cwd=project_root)
    evidence["cliCalls"] += 1
    evidence["cliResponseBytes"] += len(output)
    return json.loads(output)


def command(action, arguments, identity, capability, revision):
    return cli(
        "command",
        envelope={
            "operationId": identity,
            "revision": revision,
            "actor": "agent:acceptance",
            "scope": {
                "projectId": project["id"],
                "clipIds": ["shot"],
                "capabilities": [capability],
                "maxTakes": 2,
                "maxConcurrent": 2,
            },
            "action": action,
            "arguments": arguments,
        },
    )


def check(label, condition):
    if not condition:
        raise AssertionError(label)
    evidence["checks"].append(label)
    print("PASS", label, flush=True)


try:
    host = start_host()
    (root / "input").mkdir(exist_ok=True)
    Image.new("RGB", (64, 48), "orange").save(root / "input/source.png")
    project = call("projects", {})
    project["document"]["clips"] = [
        {
            "id": "shot",
            "name": "Agent acceptance",
            "in": 0,
            "out": 24,
            "revision": 1,
            "count": 1,
            "takeId": "placeholder",
            "takes": [
                {
                    "id": "placeholder",
                    "placeholder": True,
                    "number": 0,
                    "media": {
                        "id": "black",
                        "kind": "image",
                        "file": "assets/black.png",
                        "poster": "assets/black.png",
                        "frames": 24,
                    },
                }
            ],
        }
    ]
    project = call("projects/" + project["id"], {"revision": 0, "document": project["document"]}, "PUT")
    prompt = {
        "load": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
        "scale": {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["load", 0],
                "upscale_method": "nearest-exact",
                "width": 64,
                "height": 48,
                "crop": "disabled",
            },
        },
        "save": {"class_type": "SaveImage", "inputs": {"images": ["scale", 0], "filename_prefix": "agent"}},
    }
    project = call(
        "projects/" + project["id"] + "/capture/shot",
        {
            "revision": project["revision"],
            "capture": {
                "workflow": {"nodes": []},
                "prompt": prompt,
                "bindings": [{"key": "width", "nodeId": "scale", "input": "width", "label": "Width"}],
                "result": {"nodeId": "save", "group": "images", "index": 0},
            },
        },
    )
    stop(host)
    host = None
    base = "http://127.0.0.1:8190"
    log = (root / "standalone.log").open("ab")
    standalone = subprocess.Popen(
        [sys.executable, "-m", "spool", "--storage", str(root / "spool"), "--port", "8190"],
        cwd=project_root,
        stdout=log,
        stderr=log,
    )
    log.close()
    wait_ready(standalone)
    call("projects/" + project["id"] + "/focus/acceptance", {"clipId": "shot", "playhead": 0})
    focus = cli("focus", "--view", "acceptance")
    shot = cli("shot", "--clip", focus["clipId"])
    variants = {
        "mode": "explore",
        "intent": "Compare original geometry at two sizes",
        "variants": [{"clipId": "shot", "values": {"width": 32}}, {"clipId": "shot", "values": {"width": 64}}],
    }
    preview = command("prepare_experiment", variants, "preview", "queue", shot["revision"])
    queued = command("queue_experiment", variants, "queue", "queue", shot["revision"])
    repeated = command("queue_experiment", variants, "queue", "queue", shot["revision"])
    check(
        "Scoped CLI experiment accepted once while Comfy stopped",
        len(queued["jobs"]) == len(repeated["jobs"]) == 2
        and all(j["status"] == "waiting_for_host" for j in queued["jobs"]),
    )
    stop(standalone)
    standalone = None
    base = "http://127.0.0.1:" + str(args.port)
    host = start_host()
    end = time.monotonic() + 60
    while time.monotonic() < end:
        saved = call("projects/" + project["id"])
        if all(j["status"] == "complete" for j in saved["document"]["jobs"]):
            break
        time.sleep(0.3)
    status = cli("status")
    takes = [t for t in status["shots"][0]["takes"] if t["generated"]]
    check(
        "Frozen CLI variants execute with correct dimensions and stay unselected",
        [t["media"]["width"] for t in takes] == [32, 64] and status["shots"][0]["selectedTakeId"] == "placeholder",
    )
    events = cli("events", "--since", "0")
    comparison = cli("compare", "--clip", "shot", "--takes", *[t["id"] for t in takes])
    check(
        "Incremental events and comparison sheet contain durable results",
        bool(events["cursor"]) and bool(comparison.get("url")),
    )
    command(
        "feedback",
        {
            "clipId": "shot",
            "takeId": takes[0]["id"],
            "verdict": "keep",
            "note": "Comparison reviewed; retain both sizes",
        },
        "feedback",
        "feedback",
        status["revision"],
    )
    after = cli("status")
    check(
        "Agent feedback preserves human take choice",
        after["shots"][0]["selectedTakeId"] == "placeholder" and after["feedback"][0]["actor"] == "agent:acceptance",
    )
    command("choose_take", {"clipId": "shot", "takeId": takes[1]["id"]}, "choose", "choose_take", after["revision"])
    chosen = cli("shot", "--clip", "shot")
    check(
        "Take choice changes only with explicit choose_take scope",
        chosen["shots"][0]["selectedTakeId"] == takes[1]["id"],
    )
    evidence.update({"projectId": project["id"], "preview": preview, "comparison": comparison, "completed": True})
finally:
    stop(host)
    stop(standalone)
    (root / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
