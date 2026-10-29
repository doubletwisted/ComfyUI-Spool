"""Small storage references to metadata owned by the original media file."""

import copy
from pathlib import Path


def reference(path, key, value):
    return {
        "__spool_media__": str(path),
        "key": key,
        "graph": isinstance(value, dict) and isinstance(value.get("nodes"), list),
    }


def is_reference(value):
    return isinstance(value, dict) and "__spool_media__" in value


def pack(value, path=None):
    """Only media-shaped records (or their separated evidence) own these fields."""
    from .workflows import workflow_document

    value = dict(value)
    path = (
        path
        or value.get("originalFile")
        or value.get("file")
        or value.get("probe", {}).get("format", {}).get("filename")
    )
    if not path:
        return value
    if isinstance(value.get("workflowData"), dict):
        prepared = dict(value["workflowData"])
        for key in ("workflow", "prompt"):
            # A sidecar or prepared prompt can differ from embedded metadata.
            # Only replace the value actually extracted from the media.
            held = prepared.get(key)
            if held and not is_reference(held) and held == value.get(key):
                prepared[key] = reference(path, key, held)
        value["workflowData"] = prepared
    for key in ("workflow", "prompt"):
        if value.get(key) and not is_reference(value[key]) and workflow_document(value[key]) is not None:
            value[key] = reference(path, key, value[key])
    return value


def read(root, ref, cache):
    from PIL import Image

    from .media import IMAGE_EXTENSIONS, _probe, contained
    from .workflows import workflow_document, workflow_metadata

    name = ref["__spool_media__"]
    if name not in cache:
        path = Path(name)
        path = path if path.is_absolute() else contained(root, name)
        if not path.is_file():
            raise ValueError("Source media is missing or unsupported")
        if path.suffix.lower() in IMAGE_EXTENSIONS:
            with Image.open(path) as image:
                metadata = {key: workflow_document(image.info.get(key)) for key in ("workflow", "prompt")}
        else:
            metadata = workflow_metadata(_probe(path))
        cache[name] = metadata
    value = cache[name].get(ref["key"])
    if value is None:
        raise ValueError("Source media has no embedded " + ref["key"] + " metadata")
    return copy.deepcopy(value)
