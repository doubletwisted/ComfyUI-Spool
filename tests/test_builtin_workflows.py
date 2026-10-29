"""Spool's own workflow files: the manifest, graph and prompt agree, and every input
the inspector may leave empty feeds an input its node allows to be missing."""
import copy
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
    for section in ('required', 'optional'):
        if name in inputs.get(section, {}):
            return section == 'optional', None
    head, _, rest = name.partition('.')
    for section in ('required', 'optional'):
        spec = inputs.get(section, {}).get(head)
        if not spec or not rest:
            continue
        if spec[0] == 'COMFY_DYNAMICCOMBO_V3':
            option = next(o for o in spec[1]['options'] if o['key'] == values[head])
            return member(option['inputs'], rest, values)
        if spec[0] == 'COMFY_AUTOGROW_V3':
            template = spec[1]['template']
            names = template.get('names') or [template['prefix'] + str(i) for i in range(template['max'])]
            index = names.index(rest)
            return section == 'optional' or index >= template.get('min', 0), index
    raise AssertionError('No definition for input ' + name)


class OwnWorkflowTests(unittest.TestCase):
    def test_there_is_at_least_one(self):
        self.assertIn('api_minimax_h3_r2v', templates.OWN)

    def test_malformed_input_rules_and_omissions_are_refused(self):
        capture = templates.own_capture('api_minimax_h3_r2v')
        for change in (lambda c: c.update(inputRules={'anyOf': 'Reference images'}),
                       lambda c: c.update(inputRules=[{'anyOf': ['Reference images']}]),
                       lambda c: c['bindings'][1].update(omit='3'),
                       lambda c: c['bindings'][1].update(group=3)):
            broken = copy.deepcopy(capture)
            change(broken)
            with self.assertRaises(ValueError):
                validate_capture(broken)

    def test_files_agree_and_empty_inputs_are_allowed(self):
        definitions = templates.cloud_templates()['definitions']
        for template_id in templates.OWN:
            with self.subTest(template_id):
                manifest, prompt, workflow = (templates.read(template_id, name) for name in ('spool.json', 'prompt.json', 'workflow.json'))
                capture = templates.own_capture(template_id)
                validate_capture(capture)
                self.assertEqual(templates.CATALOG[template_id]['section'], manifest['target'])
                graph = {str(n['id']): n['type'] for n in workflow['nodes']}
                self.assertEqual({k: v['class_type'] for k, v in prompt.items()}, {k: v for k, v in graph.items() if k in prompt})
                self.assertTrue(all(n['mode'] != 0 or str(n['id']) in prompt for n in workflow['nodes']))
                result = prompt[manifest['result']]['class_type']
                self.assertTrue(definitions[result]['output_node'])
                if manifest['target'] == 'cloud':
                    self.assertTrue(all(node['class_type'] in definitions for node in prompt.values()))
                # Edit in Comfy writes clip values back through these widget addresses.
                widgets = {(b['nodeId'], b['input']) for b in named_bindings(workflow, prompt)}
                self.assertTrue(all((b['nodeId'], b['input']) in widgets for b in capture['bindings']))
                self.assertEqual(len({b['label'] for b in capture['bindings']}), len(capture['bindings']))
                groups = {g for rule in capture['inputRules'] for g in rule['anyOf']}
                self.assertTrue(groups <= {b.get('group') for b in capture['bindings']})
                for b in capture['bindings']:
                    if b['asset']:
                        self.assertEqual(prompt[b['nodeId']]['inputs'][b['input']], '', 'Built-in workflows ship without example files')
                        self.assertEqual(LOADERS[prompt[b['nodeId']]['class_type']], b['input'])
                optional = [b for b in capture['bindings'] if b.get('optional')]
                for b in optional:
                    trial = copy.deepcopy(prompt)
                    leave_out(trial, capture['bindings'], {b['key']: ''}, [], manifest['result'])
                    for node_id, node in prompt.items():
                        for name in set(node['inputs']) - set(trial.get(node_id, {}).get('inputs', {})):
                            if node_id in trial:
                                allowed, _ = member(definitions[node['class_type']]['input'], name, node['inputs'])
                                self.assertTrue(allowed, node_id + ' ' + name + ' is required')
                # A group's slots fill consecutive members of the same input, in order.
                for group in {b['group'] for b in optional if b.get('group')}:
                    slots = [b['nodeId'] for b in capture['bindings'] if b.get('group') == group]
                    uses = {}
                    for node_id, node in prompt.items():
                        for name, value in node['inputs'].items():
                            if isinstance(value, list) and value[0] in slots:
                                _, index = member(definitions[node['class_type']]['input'], name, node['inputs'])
                                uses.setdefault((node_id, name.rsplit('.', 1)[0]), []).append((index, slots.index(value[0])))
                    for found in uses.values():
                        self.assertEqual(sorted(found), [(found[0][0] - found[0][1] + i, i) for i in range(len(slots))])


if __name__ == '__main__':
    unittest.main()
