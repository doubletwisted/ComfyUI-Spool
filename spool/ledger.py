"""Authored documents, take ownership and generated-take projection; no storage I/O."""

import copy
import json
from . import attempts, embedded, timing

# One field list decides what a project document carries; ui/ledger.js mirrors it and
# tests/fixtures/document_fields.json pins both. Edit fields are the authored edit, records
# are saved but not compared, and view fields belong to one editor tab.
EDIT_FIELDS = (
    "project",
    "brief",
    "fps",
    "fpsExplicit",
    "resolution",
    "exportRange",
    "clips",
    "tailGap",
    "videoTracks",
    "videoTailGaps",
    "disabledVideoTracks",
    "audioClips",
    "audioTracks",
    "hiddenMediaIds",
    "deletedTakeIds",
    "deletedMediaIds",
)
RECORD_FIELDS = ("jobs", "recoverableResults", "media", "importedWorkflows", "clearedRenderIds")
VIEW_FIELDS = (
    "selected",
    "selectedAudio",
    "selection",
    "takeSelection",
    "frame",
    "zoom",
    "snap",
    "muted",
    "loop",
    "trimSingle",
    "viewerZoom",
    "activeVideoTrack",
)
SERVER_OWNED = ("jobs", "recoverableResults")
# A saved document never carries view state or the server-owned execution records.
VIEW_KEYS = SERVER_OWNED + VIEW_FIELDS

# A media record carries the probe and the workflow Comfy embedded in the render.
# That is evidence, not edit state: it is needed when a graph is opened or a
# capture is reviewed, and on no other path. It leaves the working document and is
# stored once per media id, addressed by the `evidence` marker left behind.
EVIDENCE_KEYS = ("probe", "workflow", "prompt", "workflowData", "provenance")
EDITOR_TAKE_FIELDS = ("id", "number", "revision", "seed", "generated", "media", "summary", "recipeGraph")
TAKE_SUMMARY_FIELDS = ("attemptId", "workflowVersion", "inputValues", "bindings")


def media_records(document):
    """Every media-shaped record in a document, wherever it is nested."""
    found = []

    def walk(value):
        if isinstance(value, dict):
            if isinstance(value.get("id"), str) and value.get("kind") in ("video", "image", "audio"):
                found.append(value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(document)
    return found


def embedded_graph(held):
    """The editable graph inside stored evidence, using the same shape the editor reads.

    A capture is `{workflow, prompt}`; the media record's `workflow` is the graph
    itself. Anything else (a null, a string, an API-only prompt) is not a graph.
    """
    graph = None
    if isinstance(held.get("workflowData"), dict):
        graph = held["workflowData"].get("workflow")
    elif isinstance(held.get("workflow"), dict):
        graph = held["workflow"]
    return (
        graph
        if isinstance(graph, dict)
        and (isinstance(graph.get("nodes"), list) or embedded.is_reference(graph) and graph.get("graph"))
        else None
    )


def mark(record, held):
    """Write the evidence markers from the authoritative payload for one record."""
    keys = [key for key in EVIDENCE_KEYS if key in held]
    if keys:
        record["evidence"] = keys
    else:
        record.pop("evidence", None)
    if embedded_graph(held):
        record["embeddedGraph"] = True
    else:
        record.pop("embeddedGraph", None)
    return record


def decompose(document, in_place=False):
    """Split media evidence out of a document.

    Returns (working document, evidence by media id). Each media record keeps an
    `evidence` list naming the payload it still has, and an `embeddedGraph` marker
    when that payload holds an editable graph, so a reader can decide whether a
    graph exists without fetching it. Records that share a media id contribute to
    one entry rather than replacing each other, and a record that arrives with only
    the markers keeps them: the stored evidence stays authoritative.
    """
    working = document if in_place else copy.deepcopy(document)
    evidence = {}
    for record in media_records(working):
        present = [key for key in EVIDENCE_KEYS if key in record]
        if not present:
            continue
        held = evidence.get(record["id"], {})
        for key in present:
            held[key] = record.pop(key)
        evidence[record["id"]] = held
        mark(record, held)
    return working, evidence


def compose(document, evidence, in_place=False):
    """Re-attach stored evidence, restoring the shape older readers expect."""
    working = document if in_place else copy.deepcopy(document)
    for record in media_records(working):
        held = evidence.get(record["id"])
        if held:
            record.update(copy.deepcopy(held))
        record.pop("evidence", None)
        record.pop("embeddedGraph", None)
    return working


def authored(document):
    working = {key: value for key, value in document.items() if key not in (*VIEW_KEYS, "previewQuality")}
    working["clips"] = [
        {**clip, "takes": [t for t in clip.get("takes", []) if not t.get("generated")]} for clip in document["clips"]
    ]
    result = copy.deepcopy(working)
    ids = [c["id"] for c in result["clips"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Clip IDs must be unique")
    return result


def editor_project(project):
    """Routine editor responses omit render evidence available on demand."""

    def media(record):
        working = {key: value for key, value in record.items() if key not in EVIDENCE_KEYS}
        if not record.get("evidence") and any(key in record for key in EVIDENCE_KEYS):
            mark(working, record)
        return working

    def take(value):
        if not value.get("generated"):
            return value
        request = value.get("request", {})
        capture = request.get("capture", {})
        working = {key: held for key, held in value.items() if key in EDITOR_TAKE_FIELDS}
        working["summary"] = {
            **{key: request[key] for key in TAKE_SUMMARY_FIELDS if key in request},
            "bindings": [
                {key: binding[key] for key in ("key", "label", "role") if key in binding}
                for binding in capture.get("bindings", [])
            ],
        }
        graph = capture.get("workflow")
        working["recipeGraph"] = isinstance(graph, dict) and isinstance(graph.get("nodes"), list)
        working["media"] = media(value["media"])
        return working

    document = project["document"]
    return {
        **project,
        "document": {
            **document,
            "clips": [{**clip, "takes": [take(t) for t in clip.get("takes", [])]} for clip in document["clips"]],
        },
    }


def owns(clip, attempt):
    return (
        attempt["take_id"] in clip.get("takeSourceTakeIds", [])
        or clip["id"] == attempt["clip_id"]
        or attempt["clip_id"] in clip.get("takeSourceIds", [])
        or clip.get("takeOwnerId") == attempt["clip_id"]
        or attempt["take_id"] == clip.get("takeId")
    )


def job(attempt, request):
    seeds = [
        {"label": b.get("label", "Seed"), "value": request.get("inputValues", {}).get(b["key"])}
        for b in request["capture"].get("bindings", [])
        if b.get("role") == "seed"
    ]
    result = {
        "id": attempt["id"],
        "clipId": attempt["clip_id"],
        "name": request["clipName"],
        "status": attempt["status"],
        "progress": 100 if attempt["status"] == "complete" else 0,
        "seed": "frozen",
        "error": attempt["error"],
        "promptId": attempt["prompt_id"],
        "target": attempts.target_of(request),
    }
    if "created" in attempt:
        result.update({"takeNumber": request.get("takeNumber"), "createdAt": attempt["created"], "seeds": seeds})
    return result


def attach(document, attempts):
    document.pop("previewQuality", None)
    document["jobs"] = []
    document.pop("recoverableResults", None)
    ordinals = {}
    for attempt in attempts:
        request = json.loads(attempt["request"]) if isinstance(attempt["request"], str) else attempt["request"]
        owner = attempt["clip_id"]
        ordinals[owner] = ordinals.get(owner, 0) + 1
        document["jobs"].append(job(attempt, request))
        if attempt["status"] != "complete" or attempt["take_id"] in document.get("deletedTakeIds", []):
            continue
        result = json.loads(attempt["result"]) if isinstance(attempt["result"], str) else attempt["result"]
        if not any(owns(c, attempt) for c in document["clips"]):
            document.setdefault("recoverableResults", []).append(
                {
                    "takeId": attempt["take_id"],
                    "clipId": attempt["clip_id"],
                    "clipName": request["clipName"],
                    "media": result["primary"],
                    "attemptId": attempt["id"],
                }
            )
        for clip in document["clips"]:
            if owns(clip, attempt):
                clip["takes"].append(
                    {
                        "id": attempt["take_id"],
                        "number": request.get("takeNumber", ordinals[owner]),
                        "revision": request["clipRevision"],
                        "seed": "frozen",
                        "generated": True,
                        "media": result["primary"],
                        "artifacts": result["artifacts"],
                        "request": request,
                        "workflowSnapshot": request["capture"],
                    }
                )
    return timing.interpret(document, media_records(document))


def detach_for_import(document):
    document = copy.deepcopy(document)
    for clip in document.get("clips", []):
        for take in clip.get("takes", []):
            if take.get("generated"):
                take["generated"] = False
                take["importedExecution"] = take.get("request")
        clip.pop("takeOwnerId", None)
        clip.pop("takeSourceIds", None)
    return document
