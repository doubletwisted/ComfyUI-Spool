"""Bundle the real Comfy serializer's verified studio captures from an owned QA project.

Run the opt-in workflow-capture-bundle browser check on 8195 first, then:
  python tests/build_builtin_captures.py QA_PROJECT_ID
Only built-in template captures are copied; example sources and machine file lists
are removed. Spool's own workflows in spool/builtin_workflows are read as written and
are not bundled. This does not execute a workflow or access a production project.
"""

import copy
import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.graph_inputs import nodes
from spool.store import validate_capture
from spool.templates import CATALOG, OWN, cloud_templates
from spool.workflow_inputs import sources


with urlopen(
    os.environ.get("SPOOL_BROWSER_BASE", "http://127.0.0.1:8195") + "/spool/api/projects/" + sys.argv[1]
) as response:
    project = json.load(response)
if "QA" not in project["document"]["project"]:
    raise ValueError("Use the owned studio browser QA project")
captures = {}
for workflow in project["document"].get("importedWorkflows", []):
    capture = copy.deepcopy(workflow["data"])
    identity = capture.get("provenance", {}).get("builtinTemplate")
    if identity not in CATALOG or identity in OWN or identity in captures:
        continue
    row = CATALOG[identity]
    capture.pop("name", None)
    capture["provenance"] = {
        "source": "Comfy workflow template",
        "builtinTemplate": identity,
        "builtinTask": row["task"],
        "workflowName": row["family"] + " · " + row["name"],
    }
    indexed = nodes(capture["workflow"])
    for node_id, name, editor, api, *_ in sources(capture):
        if editor and editor.get("widgets_values"):
            editor["widgets_values"][0] = ""
            if name in editor.get("widgets_values_named", {}):
                editor["widgets_values_named"][name] = ""
        if api:
            api["inputs"][name] = ""
        for binding in capture.get("widgetBindings", []):
            if binding["nodeId"] == node_id and binding["input"] == name:
                target = indexed[binding["widgetNodeId"]][0]
                target["widgets_values"][binding["widgetIndex"]] = ""
                if binding["widgetName"] in target.get("widgets_values_named", {}):
                    target["widgets_values_named"][binding["widgetName"]] = ""
    for binding in capture["bindings"]:
        binding["key"] = binding["nodeId"] + "/" + binding["input"]
        if binding.get("asset"):
            binding.pop("options", None)
    validate_capture(capture)
    captures[identity] = capture
if set(captures) != set(CATALOG) - set(OWN):
    raise ValueError(
        "Run the workflow-capture-bundle check before bundling: " + str(set(CATALOG) - set(OWN) - set(captures))
    )
destination = Path(__file__).resolve().parent.parent / "ui/builtin-captures.json"
destination.write_text(
    json.dumps(
        {"templates": captures, "cloudDefinitions": cloud_templates()["definitions"]},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    + "\n",
    encoding="utf-8",
)
print("Bundled", len(captures), "serialized templates;", destination.stat().st_size, "bytes")
