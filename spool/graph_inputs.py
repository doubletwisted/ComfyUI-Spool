"""Named widget addresses in saved graphs, including exposed subgraph inputs."""

import copy
import json


def nodes(workflow):
    definitions = {g["id"]: g for g in workflow.get("definitions", {}).get("subgraphs", [])}
    found = {}

    def visit(graph, prefix="", parents=(), stack=()):
        for node in graph.get("nodes", []):
            identity = prefix + str(node["id"])
            found[identity] = (node, graph, parents)
            if node["type"] in definitions and node["type"] not in stack:
                visit(
                    definitions[node["type"]],
                    identity + ":",
                    (*parents, (identity, node, graph)),
                    (*stack, node["type"]),
                )

    visit(workflow)
    return found


def named_bindings(workflow, prompt):
    indexed, result = nodes(workflow), []
    for identity, api in prompt.items():
        if identity not in indexed:
            continue
        for name, value in api["inputs"].items():
            if isinstance(value, (dict, list)):
                continue
            target, (node, graph, parents) = identity, indexed[identity]
            widget_name = name
            for _ in range(32):
                port = next((p for p in node.get("inputs", []) if p["name"] == widget_name), {})
                link = next(
                    (
                        l
                        for l in graph.get("links", [])
                        if (l[0] if isinstance(l, list) else l["id"]) == port.get("link")
                    ),
                    None,
                )
                origin = link[1] if isinstance(link, list) else link.get("origin_id") if link else None
                slot = link[2] if isinstance(link, list) else link.get("origin_slot") if link else None
                if str(origin) == "-10" and parents:
                    widget_name = graph["inputs"][slot]["name"]
                    target, node, graph = parents[-1]
                    parents = parents[:-1]
                    continue
                if origin is not None:
                    upstream = next((n for n in graph["nodes"] if str(n["id"]) == str(origin)), None)
                    if upstream and upstream["type"].startswith("Primitive"):
                        target = target.rsplit(":", 1)[0] + ":" + str(origin) if ":" in target else str(origin)
                        node, widget_name = upstream, "value"
                        continue
                    break
                named, values = node.get("widgets_values_named", {}), node.get("widgets_values", [])
                if widget_name in named:
                    # Project JSON is canonicalized with sorted object keys. A
                    # named dictionary's insertion order is only usable when the
                    # entire vector agrees; otherwise require a unique old value.
                    same = lambda left, right: json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)
                    ordered = len(values) >= len(named) and all(
                        same(value, values[index]) for index, value in enumerate(named.values())
                    )
                    matches = [index for index, value in enumerate(values) if same(value, named[widget_name])]
                    index = list(named).index(widget_name) if ordered else matches[0] if len(matches) == 1 else None
                    if index is not None:
                        result.append(
                            {
                                "nodeId": identity,
                                "input": name,
                                "widgetNodeId": target,
                                "widgetName": widget_name,
                                "widgetIndex": index,
                            }
                        )
                break
    return result


def with_prompt(capture, prompt):
    graph = copy.deepcopy(capture["workflow"])
    indexed = nodes(graph)
    bindings = capture.get("widgetBindings") or named_bindings(graph, prompt)
    assigned = {}
    for binding in bindings:
        api = prompt.get(binding["nodeId"], {}).get("inputs", {})
        if binding["input"] not in api or isinstance(api[binding["input"]], (dict, list)):
            continue
        value = api[binding["input"]]
        key = (binding["widgetNodeId"], binding["widgetIndex"])
        if key in assigned and assigned[key] != value:
            raise ValueError("Execution values disagree on a shared workflow widget")
        assigned[key] = value
        node = indexed[binding["widgetNodeId"]][0]
        node["widgets_values"][binding["widgetIndex"]] = value
        if "widgets_values_named" in node:
            node["widgets_values_named"][binding["widgetName"]] = value
    return graph, bindings
