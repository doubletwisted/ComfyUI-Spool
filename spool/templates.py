"""The studio's built-in workflows: Spool's own workflow files and curated views of
locally installed Comfy workflow templates."""
from pathlib import Path
import copy
import json
from functools import lru_cache

from .graph_inputs import named_bindings
from .workflow_inputs import LOADERS

try:
    from comfyui_workflow_templates import get_asset_path
except ImportError:
    get_asset_path = None

# One folder per workflow Spool ships: workflow.json (saved from ComfyUI),
# prompt.json (its Export (API)) and spool.json (what the inspector shows).
BUILTIN = Path(__file__).with_name('builtin_workflows')


def entries():
    rows = []
    def group(prefix, family, tasks):
        for suffix, name, task in tasks:
            rows.append({'id': prefix + suffix, 'name': name, 'family': family,
                         'section': 'cloud' if prefix.startswith('api_') else 'local', 'task': task})
    common = [('i2v', 'Image to Video', 'i2v'), ('flf2v', 'First-Last Frame', 'flf'), ('t2v', 'Text to Video', 't2v')]
    group('video_ltx2_5_', 'LTX 2.5', common)
    group('video_minimax_h3_', 'MiniMax H3', [common[0], common[2],
          ('i2v_continuation', 'Video Continuation', 'ref'), ('r2v', 'Reference to Video', 'ref'),
          ('multiframe_reference', 'Multi-Frame Reference', 'ref'), ('fun_controlnet_union', 'ControlNet Union', 'ref')])
    group('api_ltx2_5_', 'LTX 2.5', common)
    group('api_minimax_h3_', 'MiniMax H3', [common[2], common[1], ('r2v', 'Reference to Video', 'ref')])
    group('api_minimax_h3_max_', 'MiniMax H3 Max', [*common, ('r2v', 'Reference to Video', 'ref')])
    group('api_minimax_h3_max_turbo_', 'MiniMax H3 Max Turbo', [common[0], common[2]])
    group('api_bfl_flux3_', 'FLUX 3', [common[0], common[2]])
    own = {row['id']: row for row in map(own_row, OWN)}
    return [own.pop(row['id'], row) for row in rows] + list(own.values())


def read(template_id, name):
    return json.loads((BUILTIN / template_id / name).read_text(encoding='utf-8'))


def own_row(template_id):
    manifest = read(template_id, 'spool.json')
    return {'id': template_id, 'name': manifest['name'], 'family': manifest['family'], 'section': manifest['target'], 'task': manifest['task']}


OWN = sorted(p.name for p in BUILTIN.iterdir() if (p / 'spool.json').is_file()) if BUILTIN.is_dir() else []
CATALOG = {row['id']: row for row in entries()}


@lru_cache(maxsize=1)
def cloud_templates():
    return json.loads(Path(__file__).with_name('cloud_templates.json').read_text(encoding='utf-8'))


def input_schema(definitions, node, name):
    """A node input's definition, including members of a model's dynamic combo."""
    inputs = definitions.get(node['class_type'], {}).get('input', {})
    found = inputs.get('required', {}).get(name) or inputs.get('optional', {}).get(name)
    group, _, member = name.partition('.')
    base = inputs.get('required', {}).get(group) or inputs.get('optional', {}).get(group)
    if found or not member or not base or base[0] != 'COMFY_DYNAMICCOMBO_V3':
        return found
    option = next((o for o in base[1]['options'] if o['key'] == node['inputs'].get(group)), None)
    nested = option['inputs'] if option else {}
    return nested.get('required', {}).get(member) or nested.get('optional', {}).get(member)


def own_capture(template_id):
    """The recipe for one of Spool's own workflows, read as written."""
    manifest, prompt, workflow = read(template_id, 'spool.json'), read(template_id, 'prompt.json'), read(template_id, 'workflow.json')
    definitions = cloud_templates()['definitions'] if manifest['target'] == 'cloud' else {}
    def contract(node_id, input_type):
        return {'adapter': 'spool-key-inputs-1', 'classType': prompt[node_id]['class_type'], 'inputType': input_type, 'relationship': []}
    def media(node_id, label, slot, **extra):
        name = LOADERS[prompt[node_id]['class_type']]
        return {'key': node_id + '/' + name, 'nodeId': node_id, 'input': name, 'label': label, 'role': 'source', 'slot': slot,
                'asset': True, 'advanced': False, 'contract': contract(node_id, 'COMBO'), **extra}
    bindings = []
    for entry in manifest['inputs']:
        if 'group' in entry:
            bindings += [media(node_id, entry['label'] + ' ' + str(index + 1), entry['slot'], optional=True, group=entry['group'], omit=[node_id])
                         for index, node_id in enumerate(entry['nodes'])]
        elif prompt[entry['node']]['class_type'] in LOADERS:
            optional = {'optional': True, 'omit': [entry['node'], *entry.get('alsoRemove', [])]} if entry.get('optional') else {}
            bindings.append(media(entry['node'], entry['label'], entry['slot'], **optional))
        else:
            node_id, name = entry['node'], entry['input']
            schema = input_schema(definitions, prompt[node_id], name) if definitions else None
            options = schema[0] if schema and isinstance(schema[0], list) else (schema[1].get('options') if schema and len(schema) > 1 else None)
            value = prompt[node_id]['inputs'][name]
            input_type = 'COMBO' if options else schema[0] if schema else {bool: 'BOOLEAN', int: 'INT', float: 'FLOAT'}.get(type(value), 'STRING')
            bindings.append({'key': node_id + '/' + name, 'nodeId': node_id, 'input': name, 'label': entry['label'], 'role': entry.get('role', 'other'),
                             'asset': False, 'advanced': False, 'contract': contract(node_id, input_type),
                             **({'options': options} if options else {}), **({'unit': entry['unit']} if 'unit' in entry else {})})
    return {'workflow': workflow, 'prompt': prompt, 'bindings': bindings, 'widgetBindings': named_bindings(workflow, prompt),
            'result': {'nodeId': manifest['result'], 'group': 'images', 'index': 0}, 'resultOnly': True,
            'executionTarget': 'cloud' if manifest['target'] == 'cloud' else 'local', 'inputRules': manifest.get('inputRules', []),
            'provenance': {'source': 'Spool workflow', 'builtinTemplate': template_id, 'builtinTask': manifest['task'],
                           'workflowName': manifest['family'] + ' · ' + manifest['name']}}


def cloud_capture(template_id):
    row = CATALOG[template_id]
    if template_id in OWN:
        capture = own_capture(template_id)
    else:
        capture = copy.deepcopy(cloud_templates()['templates'][template_id])
        capture['provenance'] = {'source': 'Comfy workflow template', 'builtinTemplate': template_id, 'builtinTask': row['task'], 'workflowName': row['family'] + ' · ' + row['name']}
    capture['definitions'] = cloud_templates()['definitions']
    return capture


def asset(template_id, extension):
    if template_id not in CATALOG or extension not in ('json', 'webp'):
        raise KeyError('Unknown studio template')
    if get_asset_path is None:
        raise ValueError('Install the ComfyUI workflow templates package')
    filename = template_id + ('.json' if extension == 'json' else '-1.webp')
    path = Path(get_asset_path(template_id, filename))
    if not path.is_file():
        raise ValueError('Update the ComfyUI workflow templates package to use this workflow')
    return path
