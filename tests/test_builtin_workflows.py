"""Spool's own workflow files: the manifest, graph and prompt agree, and every input
the inspector may leave empty feeds an input its node allows to be missing."""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool import templates
from spool.graph_inputs import named_bindings
from spool.store import validate_capture
from spool.workflow_inputs import LOADERS, leave_out


def member(inputs, name, values):
    """(optional, slot index) for an API input name, following dynamic combos and autogrow inputs."""
    for section in ("required", "optional"):
        if name in inputs.get(section, {}):
            return section == "optional", None
    head, _, rest = name.partition(".")
    for section in ("required", "optional"):
        spec = inputs.get(section, {}).get(head)
        if not spec or not rest:
            continue
        if spec[0] == "COMFY_DYNAMICCOMBO_V3":
            option = next(o for o in spec[1]["options"] if o["key"] == values[head])
            return member(option["inputs"], rest, values)
        if spec[0] == "COMFY_AUTOGROW_V3":
            template = spec[1]["template"]
            names = template.get("names") or [template["prefix"] + str(i) for i in range(template["max"])]
            index = names.index(rest)
            return section == "optional" or index >= template.get("min", 0), index
    raise AssertionError("No definition for input " + name)


LOCAL = json.loads((Path(__file__).parent / "fixtures/local_node_definitions.json").read_text(encoding="utf-8"))[
    "definitions"
]


def schema(definitions, node, name):
    """A literal input's definition: top level, or a member of the model's dynamic combo."""
    inputs = definitions[node["class_type"]]["input"]
    return (
        templates.input_schema(definitions, node, name)
        or inputs.get("required", {}).get(name)
        or inputs.get("optional", {}).get(name)
    )


class OwnWorkflowTests(unittest.TestCase):
    def test_converted_workflows(self):
        self.assertEqual(
            templates.OWN,
            [
                "api_bfl_flux3_i2v",
                "api_minimax_h3_max_r2v",
                "api_minimax_h3_r2v",
                "video_minimax_h3_fun_controlnet_union",
                "video_minimax_h3_multiframe_reference",
                "video_minimax_h3_r2v",
            ],
        )

    def test_malformed_input_rules_and_omissions_are_refused(self):
        capture = templates.own_capture("api_minimax_h3_r2v")
        for change in (
            lambda c: c.update(inputRules={"anyOf": "Reference images"}),
            lambda c: c.update(inputRules=[{"anyOf": ["Reference images"]}]),
            lambda c: c["bindings"][1].update(omit="3"),
            lambda c: c["bindings"][1].update(group=3),
        ):
            broken = copy.deepcopy(capture)
            change(broken)
            with self.assertRaises(ValueError):
                validate_capture(broken)

    def test_files_agree_and_empty_inputs_are_allowed(self):
        for template_id in templates.OWN:
            with self.subTest(template_id):
                manifest, prompt, workflow = (
                    templates.read(template_id, name) for name in ("spool.json", "prompt.json", "workflow.json")
                )
                definitions = templates.cloud_templates()["definitions"] if manifest["target"] == "cloud" else LOCAL
                capture = templates.own_capture(template_id)
                validate_capture(capture)
                self.assertEqual(templates.CATALOG[template_id]["section"], manifest["target"])
                graph = {str(n["id"]): n["type"] for n in workflow["nodes"]}
                self.assertEqual(
                    {k: v["class_type"] for k, v in prompt.items() if ":" not in k},
                    {k: v for k, v in graph.items() if k in prompt},
                )
                self.assertTrue(all(node["class_type"] in definitions for node in prompt.values()))
                result = prompt[manifest["result"]]["class_type"]
                self.assertTrue(definitions[result]["output_node"])
                # Controls carry the type and choices their node defines.
                for b in capture["bindings"]:
                    if not b["asset"]:
                        spec = schema(definitions, prompt[b["nodeId"]], b["input"])
                        options = (
                            spec[0]
                            if isinstance(spec[0], list)
                            else spec[1].get("options")
                            if len(spec) > 1 and spec[0] == "COMBO"
                            else None
                        )
                        self.assertEqual(
                            b["contract"]["inputType"], "COMBO" if options is not None else spec[0], b["key"]
                        )
                        if options and b.get("options"):
                            self.assertEqual(b["options"], options, b["key"])
                    # A bypassed node passes on the type it receives, as Comfy's Bypass does.
                    for node_id, via in b.get("bypass", {}).items():
                        definition = definitions[prompt[node_id]["class_type"]]
                        self.assertEqual(definition["output"], [schema(definitions, prompt[node_id], via)[0]], node_id)
                # Edit in Comfy writes clip values back through these widget addresses.
                widgets = {(b["nodeId"], b["input"]) for b in named_bindings(workflow, prompt)}
                self.assertTrue(all((b["nodeId"], b["input"]) in widgets for b in capture["bindings"]))
                self.assertEqual(len({b["label"] for b in capture["bindings"]}), len(capture["bindings"]))
                groups = {g for rule in capture["inputRules"] for g in rule["anyOf"]}
                self.assertTrue(groups <= {b.get("group") for b in capture["bindings"]})
                for b in capture["bindings"]:
                    if b["asset"]:
                        self.assertEqual(
                            prompt[b["nodeId"]]["inputs"][b["input"]],
                            "",
                            "Built-in workflows ship without example files",
                        )
                        self.assertEqual(LOADERS[prompt[b["nodeId"]]["class_type"]], b["input"])
                        # Apply to clip labels a loader by its title, so the title is the inspector label.
                        self.assertEqual(prompt[b["nodeId"]]["_meta"]["title"], b["label"])
                optional = [b for b in capture["bindings"] if b.get("optional")]
                # A rule that needs one input of a group, with gaps closed, keeps that group's first slot filled.
                kept = {
                    next(b["key"] for b in optional if b.get("group") == rule["anyOf"][0])
                    for rule in capture["inputRules"]
                    if len(rule["anyOf"]) == 1
                }
                trials = [
                    (b["key"], {other["key"]: "" if other is b else "chosen.png" for other in optional})
                    for b in optional
                    if b["key"] not in kept
                ]
                trials.append(
                    ("every optional input", {b["key"]: "chosen.png" if b["key"] in kept else "" for b in optional})
                )
                for label, values in trials:
                    trial = copy.deepcopy(prompt)
                    leave_out(trial, capture["bindings"], values, [], manifest["result"])
                    for node_id, node in prompt.items():
                        for name in set(node["inputs"]) - set(trial.get(node_id, {}).get("inputs", {})):
                            if node_id in trial:
                                allowed, _ = member(definitions[node["class_type"]]["input"], name, node["inputs"])
                                self.assertTrue(allowed, label + ": " + node_id + " " + name + " is required")
                    links = [
                        v[0]
                        for node in trial.values()
                        for v in node["inputs"].values()
                        if isinstance(v, list) and len(v) == 2
                    ]
                    self.assertTrue(set(links) <= set(trial), label)
                # A group's slots fill consecutive members of the same input, in order.
                for group in {b["group"] for b in optional if b.get("group")}:
                    slots = [b["nodeId"] for b in capture["bindings"] if b.get("group") == group]
                    uses = {}
                    for node_id, node in prompt.items():
                        for name, value in node["inputs"].items():
                            if isinstance(value, list) and value[0] in slots:
                                _, index = member(definitions[node["class_type"]]["input"], name, node["inputs"])
                                if index is not None:
                                    uses.setdefault((node_id, name.rsplit(".", 1)[0]), []).append(
                                        (index, slots.index(value[0]))
                                    )
                    for found in uses.values():
                        self.assertEqual(sorted(found), [(found[0][0] - found[0][1] + i, i) for i in range(len(slots))])


if __name__ == "__main__":
    unittest.main()
