"""Real CPU Comfy startup with a busy Spool store; never touches production."""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.projects import Workspace
from spool.store import empty_project
from spool.ownership import ExecutorLock

parser = argparse.ArgumentParser()
parser.add_argument('--python', required=True)
parser.add_argument('--comfy', required=True)
parser.add_argument('--runtime', required=True)
parser.add_argument('--port', type=int, default=8199, help='A free port for the isolated host')
args = parser.parse_args()
root = Path(args.runtime).resolve()
root.mkdir(parents=True, exist_ok=True)
for kind in ('input', 'output', 'temp'):
    (root / kind).mkdir(exist_ok=True)
Image.new('RGB', (8, 8), 'green').save(root / 'input/source.png')
# Another process owns the machine store, as a second Comfy started on the same data would see it.
workspace = Workspace(root / 'spool')
owner = ExecutorLock(workspace.root)
owner.acquire()
configuration = {'roots': {k: str(root / k) for k in ('input', 'output', 'temp')}, 'comfyUrl': 'http://127.0.0.1:8194'}
workspace.publish_host(configuration, 'original-owner')
document = empty_project()
document['clips'] = [{'id': 'shot', 'name': 'Passive host check', 'takes': [], 'takeId': 'original', 'revision': 1}]
project = workspace.create(document)
store = workspace.for_project(project['id'])
prompt = {'load': {'class_type': 'LoadImage', 'inputs': {'image': 'source.png'}}, 'save': {'class_type': 'SaveImage', 'inputs': {'images': ['load', 0], 'filename_prefix': 'ordinary-passive'}}}
project = store.capture(project['id'], 0, 'shot', {'workflow': {'nodes': []}, 'prompt': prompt, 'bindings': [], 'result': {'nodeId': 'save', 'group': 'images', 'index': 0}})
process = None
evidence = {'checks': []}

def call(path, body=None):
    req = urllib.request.Request('http://127.0.0.1:' + str(args.port) + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)

def check(label, condition):
    if not condition:
        raise AssertionError(label)
    evidence['checks'].append(label)
    print('PASS', label, flush=True)

try:
    with (root / 'host.log').open('ab') as log:
        process = subprocess.Popen([args.python, '-s', str(Path(__file__).with_name('run_host.py')), '--comfy', args.comfy, '--runtime', str(root), '--port', str(args.port)], stdout=log, stderr=log)
    until = time.monotonic() + 90
    while time.monotonic() < until:
        if process.poll() is not None:
            raise RuntimeError('Owned CPU host exited; inspect host.log')
        try:
            health = call('/spool/api/health'); break
        except OSError:
            time.sleep(.3)
    check('Real Comfy starts with Spool dispatch disabled when store is busy', not health['executor'] and '8194' in health['executorError'])
    capability = call('/spool/api/capabilities')
    check('Passive capability read preserves designated host', capability['configuration'] == configuration and store.host()['sessionId'] == 'original-owner')
    queued = call('/spool/api/projects/' + project['id'] + '/queue', {'revision': project['revision'], 'items': [{'clipId': 'shot', 'count': 1}], 'operationId': 'passive-live'})
    call('/spool/api/reconcile', {})
    attempt_id = queued['document']['jobs'][0]['id']
    check('Spool request waits without a second executor claim', store.attempt(attempt_id)['status'] == 'waiting_for_host')
    submitted = call('/prompt', {'prompt': prompt})
    until = time.monotonic() + 30
    while time.monotonic() < until:
        history = call('/history/' + submitted['prompt_id']).get(submitted['prompt_id'])
        if history:
            break
        time.sleep(.2)
    check('Ordinary Comfy prompt still renders on the passive host', history['status']['status_str'] == 'success' and bool(history['outputs']['save']['images']))
    check('Ordinary rendering does not consume Spool waiting work', store.attempt(attempt_id)['status'] == 'waiting_for_host')
    evidence.update({'projectId': project['id'], 'attemptId': attempt_id, 'promptId': submitted['prompt_id'], 'completed': True})
finally:
    if process and process.poll() is None:
        process.terminate(); process.wait(timeout=30)
    owner.close()
    check('Passive host cleanup preserves the original owner', store.host()['sessionId'] == 'original-owner')
    (root / 'evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
