import json

from .store import uid


def workflow_document(value):
    """Accept saved Comfy graphs or API prompts without rewriting their nodes."""
    for _ in range(3):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except (ValueError, TypeError, RecursionError):
            return None
    if not isinstance(value, dict):
        return None
    if isinstance(value.get("nodes"), list) and all(
        isinstance(n, dict) and "id" in n and isinstance(n.get("type"), str) for n in value["nodes"]
    ):
        return value
    if value and all(
        isinstance(n, dict) and isinstance(n.get("class_type"), str) and isinstance(n.get("inputs"), dict)
        for n in value.values()
    ):
        return value
    return None


def workflow_metadata(probe):
    """Read direct tags and VHS JSON comments from MP4/MOV/WebM/MKV."""
    result = {}
    invalid = False
    tags = [probe.get("format", {}).get("tags", {})] + [s.get("tags", {}) for s in probe.get("streams", [])]

    def collect(container, depth=0):
        nonlocal invalid
        if not isinstance(container, dict) or depth > 4:
            return
        values = {str(k).lower(): v for k, v in container.items()}
        for key in ("workflow", "prompt"):
            if key not in values:
                continue
            document = workflow_document(values[key])
            if document is not None:
                result.setdefault(key, document)
            elif key == "workflow":
                invalid = True
        extra = values.get("extra_pnginfo")
        if isinstance(extra, dict):
            collect(extra, depth + 1)

    for tag_set in tags:
        collect(tag_set)
    for tag_set in tags:
        for key, value in tag_set.items():
            if key.lower() not in {"comment", "description"} or not isinstance(value, str):
                continue
            try:
                wrapper = json.loads(value)
            except (ValueError, RecursionError):
                continue
            collect(wrapper)
            direct = workflow_document(wrapper)
            if direct is not None:
                result.setdefault("workflow", direct)
    if "workflow" not in result and "prompt" in result:
        result["workflow"] = result["prompt"]
    if invalid and "workflow" not in result:
        result["workflowWarning"] = "The embedded workflow could not be read; the video was imported."
    return result


def parse_import(raw_text, filename):
    original = json.loads(raw_text)
    direct = workflow_document(original)
    wrapper = original if isinstance(original, dict) else {}
    graph = direct or workflow_document(wrapper.get("workflow")) or workflow_document(wrapper.get("prompt"))
    if graph is None:
        raise ValueError("Import graph JSON, API prompt JSON, or a workflow/prompt wrapper")
    prompt = graph if "nodes" not in graph else workflow_document(wrapper.get("prompt"))
    return {
        "id": "workflow-" + uid(),
        "name": filename,
        "data": {
            "workflow": graph,
            "prompt": prompt,
            "provenance": {"source": "raw JSON import", "originalDocument": original, "originalText": raw_text},
        },
    }
