"""Opt-in real local/Deadline acceptance against an already running isolated host."""
import argparse
import copy
import hashlib
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool import sidecars

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:8195")
parser.add_argument("--runtime", required=True, type=Path)
parser.add_argument("--project-folder", required=True, type=Path)
parser.add_argument("--worker", required=True)
parser.add_argument("--timeout", type=int, default=600)
parser.add_argument("--resume", action="store_true", help="Observe the recorded run without submitting again")
args = parser.parse_args()
root = args.runtime.resolve()
root.mkdir(parents=True, exist_ok=True)
evidence_path = root / "execution-evidence.json"


def call(path, body=None, method=None, raw=None, headers=None):
    request = urllib.request.Request(args.base + path, data=raw if raw is not None else json.dumps(body).encode() if body is not None else None,
                                    method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(str(error.code) + " " + error.read().decode()) from error


def checkpoint():
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")


def check(label, condition):
    if not condition:
        raise AssertionError(label)
    if label not in evidence["checks"]:
        evidence["checks"].append(label)
    checkpoint()
    print("PASS " + label, flush=True)


def capture(kind, target, source):
    video = kind == "video"
    load, name, save, port = ("LoadVideo", "file", "SaveVideo", "VIDEO") if video else ("LoadImage", "image", "SaveImage", "IMAGE")
    prompt = {"1": {"class_type": load, "inputs": {name: source}},
              "2": {"class_type": save, "inputs": {"video" if video else "images": ["1", 0], "filename_prefix": "Authored output"}}}
    if video:
        prompt["2"]["inputs"].update({"format": "auto", "codec": "auto"})
    nodes = [{"id": 1, "type": load, "pos": [30, 60], "size": [270, 250], "flags": {}, "order": 0, "mode": 0, "inputs": [],
              "outputs": [{"name": port, "type": port, "links": [1]}], "properties": {"Node name for S&R": load},
              "widgets_values": [source] if video else [source, "image"], "widgets_values_named": {name: source}},
             {"id": 2, "type": save, "pos": [400, 60], "size": [270, 250], "flags": {}, "order": 1, "mode": 0,
              "inputs": [{"name": "video" if video else "images", "type": port, "link": 1}], "outputs": [], "properties": {"Node name for S&R": save},
              "widgets_values": list(v for v in prompt["2"]["inputs"].values() if not isinstance(v, list)),
              "widgets_values_named": {k: v for k, v in prompt["2"]["inputs"].items() if not isinstance(v, list)}}]
    if target == "deadline":
        inputs = {"output_directory": "Authored output directory", "batch_count": 7, "chunk_size": 3, "priority": 50,
                  "pool": "test", "group": "comfy", "job_name": "Spool QA " + kind + " " + evidence["run"],
                  "comment": "", "department": "", "machine_list": args.worker, "disable_dynamic_vram": False, "reserve_vram": 0.0}
        prompt["3"] = {"class_type": "DeadlineSubmit", "inputs": inputs}
        nodes.append({"id": 3, "type": "DeadlineSubmit", "pos": [760, 60], "size": [300, 300], "flags": {}, "order": 2, "mode": 0,
                      "inputs": [], "outputs": [{"name": "STRING", "type": "STRING", "links": None}], "properties": {"Node name for S&R": "DeadlineSubmit"},
                      "widgets_values": list(inputs.values()), "widgets_values_named": copy.deepcopy(inputs)})
    return {"workflow": {"last_node_id": len(nodes), "last_link_id": 1, "version": .4, "nodes": nodes, "links": [[1, 1, 0, 2, 0, port]],
                         "groups": [{"title": "Execution acceptance", "bounding": [0, 0, 1100, 400], "color": "#3f789e", "font_size": 24, "flags": {}}]},
            "prompt": prompt, "bindings": [], "result": {"nodeId": "2", "group": "images", "index": 0}}


if args.resume:
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
else:
    if evidence_path.exists():
        raise RuntimeError("This run already exists. Use --resume to observe it without duplicate submissions.")
    evidence = {"run": datetime.now().strftime("%Y%m%d-%H%M%S"), "base": args.base, "worker": args.worker,
                "checks": [], "attempts": [], "projectId": None, "folder": str(args.project_folder)}
    checkpoint()

try:
    if not args.resume:
        info = call("/object_info")
        check("Isolated host has image/video nodes and the real Deadline Submit node", all(k in info for k in ("LoadImage", "LoadVideo", "SaveImage", "SaveVideo", "DeadlineSubmit")))
        source_image = root / "source.png"
        Image.new("RGB", (32, 24), (20, 140, 70)).save(source_image)
        source_video = root / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x48:r=24:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source_video)], check=True)
        project = call("/spool/api/projects", {"folder": str(args.project_folder), "document": {"project": "Execution acceptance " + evidence["run"], "fps": 24, "clips": [], "media": [], "audioClips": []}})
        evidence["projectId"] = project["id"]
        evidence["folder"] = project["folder"]
        checkpoint()
        media = {}
        for kind, path in [("image", source_image), ("video", source_video)]:
            media[kind] = call("/spool/api/upload?projectId=" + project["id"] + "&fps=24", raw=path.read_bytes(), headers={"X-Filename": path.name})
        project["document"]["clips"] = [{"id": target + "-" + kind, "name": target + " " + kind, "takeId": "original-" + target + "-" + kind, "in": 0, "out": 24,
            "takes": [{"id": "original-" + target + "-" + kind, "number": 1, "media": copy.deepcopy(media[kind])}]} for target in ("local", "deadline") for kind in ("image", "video")]
        project = call("/spool/api/projects/" + project["id"], {"revision": project["revision"], "document": project["document"]}, "PUT")
        sources = {kind: "spool-projects/" + project["id"] + "/" + data["originalFile"] for kind, data in media.items()}
        for target in ("local", "deadline"):
            for kind in ("image", "video"):
                project = call("/spool/api/projects/" + project["id"] + "/capture/" + target + "-" + kind,
                               {"revision": project["revision"], "capture": capture(kind, target, sources[kind])})
        evidence["operationId"] = "execution-acceptance-" + evidence["run"]
        checkpoint()
        project = call("/spool/api/projects/" + project["id"] + "/queue", {"revision": project["revision"], "operationId": evidence["operationId"],
                        "items": [{"clipId": c["id"], "count": 1} for c in project["document"]["clips"]]})
        evidence["attempts"] = [j["id"] for j in project["document"]["jobs"]]
        checkpoint()
        check("One queue operation creates exactly four assigned takes", len(evidence["attempts"]) == 4)

    end = time.monotonic() + args.timeout
    previous = None
    while time.monotonic() < end:
        project = call("/spool/api/projects/" + evidence["projectId"])
        jobs = project["document"]["jobs"]
        states = [(j["name"], j["status"], j.get("submission", {}).get("external_id"), j.get("error")) for j in jobs]
        if states != previous:
            print(json.dumps(states), flush=True)
            evidence["states"] = states
            checkpoint()
            previous = states
        if jobs and all(j["status"] == "complete" for j in jobs):
            break
        if any(j["status"] in ("failed", "farm_attention", "submission_uncertain") for j in jobs):
            raise AssertionError("A queue failure needs diagnosis: " + json.dumps(states))
        time.sleep(2)
    else:
        raise TimeoutError("Jobs have not completed; --resume observes the same attempts without resubmission")

    folder = Path(project["folder"])
    for clip in project["document"]["clips"]:
        target, kind = clip["id"].split("-")
        result_take = next(t for t in clip["takes"] if t.get("generated"))
        attempt = call("/spool/api/attempts/" + result_take["request"]["attemptId"])
        request = attempt["request"]
        result = json.loads(attempt["result"])
        label = clip["id"]
        check(label + ": correct automatic execution route and unselected take", request["target"] == target and clip["takeId"] == "original-" + label and len(clip["takes"]) == 2)
        original = folder / result_take["media"]["originalFile"]
        check(label + ": output collected in its clip folder", original.is_file() and original.parent == folder / clip["outputFolder"])
        saved = sidecars.read(original)
        check(label + ": editable workflow JSON and matching API saved beside the result", bool(saved and saved["workflow"].get("nodes")) and not saved["sidecar"]["needsSerialization"])
        check(label + ": actual frozen input survives in the workflow", saved["prompt"]["1"]["inputs"]["file" if kind == "video" else "image"] == (result.get("observedPrompt") or request["prompt"])["1"]["inputs"]["file" if kind == "video" else "image"])
        if kind == "image":
            check(label + ": actual rendered pixels match the source", Image.open(original).convert("RGB").getpixel((0, 0)) == (20, 140, 70))
        else:
            probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(original)]))
            video = next(s for s in probe["streams"] if s["codec_type"] == "video")
            check(label + ": real video retains frames, dimensions and audio", (video["width"], video["height"], int(video["nb_frames"])) == (64, 48, 24) and any(s["codec_type"] == "audio" for s in probe["streams"]))
        if target == "deadline":
            check(label + ": verified receipt is from the assigned worker", result["worker"].lower() == args.worker.lower() and bool(result["jobId"]) and result["takeId"] == attempt["take_id"])
            check(label + ": launcher retained in editable JSON and one take frozen per farm job", saved["prompt"]["3"]["class_type"] == "DeadlineSubmit" and request["prompt"]["3"]["inputs"]["batch_count"] == request["prompt"]["3"]["inputs"]["chunk_size"] == 1 and request["capture"]["prompt"]["3"]["inputs"]["batch_count"] == 7)
            check(label + ": Deadline staging belongs to the shared project folder", Path(request["prompt"]["3"]["inputs"]["output_directory"]) == folder / ".spool/deadline")
        evidence.setdefault("results", {})[label] = {"attemptId": attempt["id"], "promptId": attempt["prompt_id"], "takeId": attempt["take_id"],
            "jobId": result.get("jobId"), "executionId": result.get("executionId"), "file": str(original), "sha256": hashlib.sha256(original.read_bytes()).hexdigest()}
        checkpoint()
        setup = call("/spool/api/projects/" + project["id"] + "/take-workflow/" + clip["id"] + "/" + result_take["id"])
        current = call("/spool/api/projects/" + project["id"])
        adopted = call("/spool/api/projects/" + project["id"] + "/use-take/" + clip["id"], {"revision": current["revision"], "takeId": result_take["id"], "capture": setup})
        preview = call("/spool/api/projects/" + project["id"] + "/generation-preview", {"revision": adopted["revision"], "clipId": clip["id"]})
        check(label + ": Use take can prepare another generation from its exact input", preview["target"] == target and preview["assets"][0]["sha256"] == request["assets"][0]["sha256"])
        # Retain the original selection after proving the result can be continued.
        original_setup = next(c for c in adopted["document"]["clips"] if c["id"] == clip["id"])
        before = next(c for c in project["document"]["clips"] if c["id"] == clip["id"])
        for key in ("takeId", "workflowVersion", "bindings", "inputValues", "in", "out"):
            if key in before:
                original_setup[key] = copy.deepcopy(before[key])
        original_setup.pop("generationBase", None)
        call("/spool/api/projects/" + project["id"], {"revision": adopted["revision"], "document": adopted["document"]}, "PUT")
    fresh = call("/spool/api/projects/" + project["id"])["document"]
    check("All four jobs survive a fresh project read without duplicates or changed take choices",
          len(fresh["jobs"]) == 4 and all(len(c["takes"]) == 2 and c["takeId"] == "original-" + c["id"] for c in fresh["clips"]))
    evidence["passed"] = True
    checkpoint()
finally:
    checkpoint()
