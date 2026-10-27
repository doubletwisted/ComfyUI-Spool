"""Continue a take from its executed inputs, independently of the clip's recipe."""
import copy
import json

from .workflow_inputs import sources
from .workflows import workflow_document
from .media import SAVER_GROUPS
from . import attempts, sidecars
from .graph_inputs import with_prompt


def resolve(store, project_id, clip_id, take_id):
    clip = store.clip(project_id, clip_id)
    take = next((t for t in clip.get("takes", []) if t["id"] == take_id and not t.get("placeholder")), None)
    if not take or take_id in clip.get("hiddenTakeIds", []) and take_id != clip.get("takeId"):
        raise ValueError("This take is no longer available for the shot")
    media = take["media"]
    source_file = sidecars.media_path(store.root, media) if media.get("originalFile") or media.get("file") else None
    override = sidecars.read(source_file) if source_file else None
    if override:
        override["provenance"] = {**override.get("provenance", {}), "source": "Workflow sidecar", "workflowName": override["sidecar"]["name"],
            "takeBase": {"takeId": take_id, "mediaId": media["id"], "name": media.get("name"), "number": take.get("number"), "source": "Workflow sidecar"}}
        return override
    request = take.get("request") or take.get("importedExecution") or {}
    capture = copy.deepcopy(request.get("capture") or take.get("workflowSnapshot") or {})
    prompt, source = None, None
    if request.get("attemptId") and take.get("generated"):
        attempt = store.attempt(request["attemptId"])
        if attempt["project_id"] != project_id or attempt["take_id"] != take_id:
            raise ValueError("Execution evidence belongs to another take")
        result = json.loads(attempt["result"]) if attempt.get("result") else {}
        history = result.get("history", {}).get("prompt", [])
        prompt = workflow_document(result.get("observedPrompt")) or (workflow_document(history[2]) if len(history) > 2 else None)
        if prompt:
            source = "Observed execution"
        else:
            dispatch = store.dispatch_record(attempt["id"])
            prompt = workflow_document((dispatch or {}).get("payload", {}).get("prompt"))
            source = "Submitted execution" if prompt else None
    if not prompt and take.get("generated"):
        prompt = workflow_document(request.get("prompt"))
        source = "Frozen take request" if prompt else None
    held = store.evidence(project_id, media["id"]) if media.get("evidence") else media
    if not prompt:
        prompt = workflow_document(held.get("prompt")) or workflow_document((held.get("workflowData") or {}).get("prompt"))
        source = "Embedded take metadata" if prompt else None
    if not prompt:
        prompt = workflow_document(request.get("prompt"))
        source = "Frozen take request" if prompt else None
    if not prompt:
        prompt = workflow_document(capture.get("prompt"))
        source = "Saved take setup" if prompt else None
    if not prompt or "nodes" in prompt:
        return None
    capture["prompt"] = copy.deepcopy(prompt)
    if attempts.target_of(request) == attempts.DEADLINE:
        for identity, node in request.get("prompt", {}).items():
            if node["class_type"] in ("DeadlineSubmit", "SaveAndSubmitNode") and identity not in capture["prompt"]:
                capture["prompt"][identity] = copy.deepcopy(node)
    if not capture.get("result"):
        savers = [(identity, "gifs" if n["class_type"] == "VHS_VideoCombine" else "images") for identity, n in prompt.items() if n["class_type"] in SAVER_GROUPS]
        if len(savers) == 1:
            identity, group = savers[0]
            capture["result"] = {"nodeId": identity, "group": group, "index": 0}
    capture.setdefault("workflow", copy.deepcopy(held.get("workflow") or (held.get("workflowData") or {}).get("workflow")))
    # Editor widgets can be stale after farm submission. Only the API filename
    # participates in recovery; never substitute a different historical widget.
    for _, name, editor, api, editor_value, api_value in sources(capture):
        if editor is not None and api is not None and editor_value is not None and api_value is not None:
            editor["widgets_values"][0] = api_value
            if isinstance(editor.get("widgets_values_named"), dict):
                editor["widgets_values_named"][name] = api_value
    if isinstance(capture.get("workflow"), dict) and capture["workflow"].get("nodes"):
        capture["workflow"], capture["widgetBindings"] = with_prompt(capture, capture["prompt"])
        capture["preferWorkflow"] = True
    capture.pop("bindings", None)
    capture["provenance"] = {"source": source, "workflowName": media.get("name", "Take " + str(take.get("number", ""))),
                             "takeBase": {"takeId": take_id, "mediaId": media["id"], "name": media.get("name"), "number": take.get("number"), "source": source}}
    return capture
