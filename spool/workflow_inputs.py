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


# Media inputs a recipe may leave empty. ui/input-groups.js applies the same rules;
# tests/fixtures/optional_inputs.json pins both.
def filled(binding, values, settings):
    """A media input is filled by a shot source or a chosen file."""
    return any(s.get("key") == binding["key"] for s in settings) or bool(values.get(binding["key"]))


def compact_groups(bindings, values, settings):
    """Move a group's filled inputs to its first slots, keeping their order."""
    values, settings = dict(values), [dict(s) for s in settings]
    groups = {}
    for b in bindings:
        if b.get("group"):
            groups.setdefault(b["group"], []).append(b)
    for members in groups.values():
        chosen = [b for b in members if filled(b, values, settings)]
        moved = {old["key"]: new["key"] for old, new in zip(chosen, members)}
        contents = {b["key"]: values.get(b["key"], "") for b in chosen}
        for b in members:
            values[b["key"]] = ""
        for old, new in moved.items():
            values[new] = contents[old]
        keys = {b["key"] for b in members}
        settings = [{**s, "key": moved[s["key"]]} if s.get("key") in keys else s for s in settings]
    return values, settings


def input_problem(bindings, values, settings, rules=()):
    """Name the first missing media input, or None when the recipe can run."""
    for b in bindings:
        if b.get("asset") and not b.get("optional") and not filled(b, values, settings):
            return b.get("label", b["input"]) + " is empty. Choose it in the Inspector."
    for rule in rules:
        if not any(filled(b, values, settings) for b in bindings if b.get("group") in rule["anyOf"]):
            return rule["message"]
    return None


def leave_out(prompt, bindings, values, settings, result):
    """Remove empty optional inputs from an API prompt; returns the keys left out."""
    empty = [b for b in bindings if b.get("optional") and not filled(b, values, settings)]
    dropped = {node for b in empty for node in b.get("omit") or [b["nodeId"]] if node in prompt}
    if result in dropped:
        raise ValueError("An empty optional input cannot remove the clip output")
    for node in dropped:
        del prompt[node]
    for node in prompt.values():
        for name, value in list(node["inputs"].items()):
            if isinstance(value, list) and len(value) == 2 and value[0] in dropped:
                del node["inputs"][name]
    return [b["key"] for b in empty]
