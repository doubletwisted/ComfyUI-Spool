"""Editable Comfy graphs beside media; embedded generation evidence stays intact."""
import copy
import hashlib
import json
from pathlib import Path

from .media import contained
from .graph_inputs import with_prompt
from .ownership import atomic_replace, file_lock
from .store import encode, uid
from .workflows import workflow_document


def media_path(root, metadata):
    value = metadata.get("originalFile") or metadata.get("file")
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else contained(root, value)


def graph_only(workflow):
    graph = copy.deepcopy(workflow)
    if isinstance(graph.get("extra"), dict):
        graph["extra"].pop("spoolWorkflow", None)
        if not graph["extra"]:
            graph.pop("extra")
    return graph


def graph_hash(workflow):
    return hashlib.sha256(encode(graph_only(workflow)).encode()).hexdigest()


def read(source):
    path = Path(source).with_suffix(".json")
    if not path.is_file():
        return None
    try:
        raw = path.read_bytes()
        graph = workflow_document(json.loads(raw.decode("utf-8-sig")))
        if not graph or not isinstance(graph.get("nodes"), list):
            raise ValueError("Save the normal Comfy workflow, with nodes and links")
        extra = graph.get("extra")
        cache = extra.get("spoolWorkflow") if isinstance(extra, dict) else None
        cache = cache if isinstance(cache, dict) else {}
        valid = cache.get("schemaVersion") == 1 and cache.get("graphHash") == graph_hash(graph)
        capture = {key: copy.deepcopy(cache[key]) for key in ("prompt", "bindings", "result", "provenance", "widgetBindings") if valid and key in cache}
        capture.update({"workflow": graph_only(graph), "preferWorkflow": True,
                        "sidecar": {"sha256": hashlib.sha256(raw).hexdigest(), "name": path.name, "needsSerialization": not bool(capture.get("prompt"))}})
        if not isinstance(capture.get("prompt"), dict):
            capture["prompt"] = None
            capture["sidecar"]["needsSerialization"] = True
        return capture
    except (ValueError, TypeError, UnicodeError) as error:
        raise ValueError("Cannot read workflow sidecar " + path.name + ": " + str(error)) from error


def serialize(capture):
    graph = workflow_document(capture.get("workflow"))
    if not graph or not isinstance(graph.get("nodes"), list) or not graph["nodes"]:
        raise ValueError("An editable Comfy graph is required to save a workflow sidecar")
    graph = graph_only(graph)
    bindings = capture.get("widgetBindings", [])
    if capture.get("prompt"):
        graph, bindings = with_prompt({**capture, "workflow": graph}, capture["prompt"])
        graph.setdefault("extra", {})["spoolWorkflow"] = {"schemaVersion": 1, "graphHash": graph_hash(graph), "widgetBindings": bindings,
            **{key: copy.deepcopy(capture[key]) for key in ("prompt", "bindings", "result", "provenance") if key in capture}}
    return json.dumps(graph, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")


def check_current(source, expected):
    path = Path(source).with_suffix(".json")
    actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""
    if expected is not None and actual != expected:
        raise ValueError("The workflow sidecar changed. Reopen it before applying edits.")


def write(source, capture, *, lock_root, expected=None, replace=True):
    path = Path(source).with_suffix(".json")
    raw = serialize(capture)
    pending = path.with_name(path.name + "." + uid() + ".partial")
    lock_root = Path(lock_root)
    lock_root.mkdir(parents=True, exist_ok=True)
    lock = lock_root / (hashlib.sha256(str(path.resolve()).encode()).hexdigest() + ".lock")
    with file_lock(lock):
        if path.exists():
            if not replace:
                return False
        check_current(source, expected)
        try:
            pending.write_bytes(raw)
            atomic_replace(pending, path)
        finally:
            pending.unlink(missing_ok=True)
    return True


def write_result(store, media, attempt, result):
    capture = copy.deepcopy(attempt["request"]["capture"])
    if not media.project_id or not (capture.get("workflow") or {}).get("nodes"):
        return
    history = result.get("history", {}).get("prompt", [])
    prompt = result.get("observedPrompt") or (history[2] if len(history) > 2 else None) or attempt["request"]["prompt"]
    capture["prompt"] = copy.deepcopy(prompt)
    for identity, node in attempt["request"]["prompt"].items():
        if node["class_type"] in ("DeadlineSubmit", "SaveAndSubmitNode"):
            capture["prompt"][identity] = copy.deepcopy(node)
    capture["provenance"] = {"source": "Generated take", "attemptId": attempt["id"], "takeId": attempt["take_id"]}
    write(media.resolve(result["primary"]["originalFile"]), capture, lock_root=store.root / ".spool" / "locks", replace=False)
