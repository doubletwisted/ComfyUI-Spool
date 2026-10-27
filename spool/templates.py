"""The studio's curated views of locally installed Comfy workflow templates."""
from pathlib import Path
import copy
import json
from functools import lru_cache

try:
    from comfyui_workflow_templates import get_asset_path
except ImportError:
    get_asset_path = None


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
    return rows


CATALOG = {row['id']: row for row in entries()}


@lru_cache(maxsize=1)
def cloud_templates():
    return json.loads(Path(__file__).with_name('cloud_templates.json').read_text(encoding='utf-8'))


def cloud_capture(template_id):
    row = CATALOG[template_id]
    capture = copy.deepcopy(cloud_templates()['templates'][template_id])
    capture['definitions'] = cloud_templates()['definitions']
    capture['provenance'] = {'source': 'Comfy workflow template', 'builtinTemplate': template_id, 'builtinTask': row['task'], 'workflowName': row['family'] + ' · ' + row['name']}
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
