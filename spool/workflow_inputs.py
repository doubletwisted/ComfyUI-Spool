"""Exact loader addresses in editor graphs and their serialized API prompts."""

LOADERS = {"LoadImage": "image", "LoadImageMask": "image", "LoadAudio": "audio", "LoadVideo": "file", "VHS_LoadVideo": "video"}


def sources(capture):
    workflow = capture.get("workflow") or {}
    prompt = capture.get("prompt") or (workflow if "nodes" not in workflow else {})
    definitions = {g["id"]: g for g in workflow.get("definitions", {}).get("subgraphs", [])}
    editor_nodes = {}

    def visit(graph, prefix="", stack=()):
        for node in graph.get("nodes", []):
            identity, kind = prefix + str(node["id"]), node["type"]
            if kind in LOADERS:
                editor_nodes[identity] = node
            elif kind in definitions and kind not in stack:
                visit(definitions[kind], identity + ":", (*stack, kind))

    visit(workflow)
    for identity in dict.fromkeys([*editor_nodes, *prompt]):
        editor, api = editor_nodes.get(identity), prompt.get(identity)
        kind = api["class_type"] if api else editor["type"]
        if kind not in LOADERS:
            continue
        name = LOADERS[kind]
        widgets = editor.get("widgets_values") if editor else None
        editor_value = widgets[0] if isinstance(widgets, list) and widgets and isinstance(widgets[0], str) else None
        api_value = api["inputs"].get(name) if api else None
        if api_value is not None and not isinstance(api_value, str):
            continue  # A linked filename requires an explicit adapter.
        yield identity, name, editor, api, editor_value, api_value
