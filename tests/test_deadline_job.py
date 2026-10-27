import asyncio
import copy
import importlib.util
import json
import shutil
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from spool import deadline_job, deadline_task, farm_protocol
from spool.execution import LocalExecutor
from spool.collection import Collector
import test_farm_protocol as fixtures

# Two tests run the real ComfyUI-Deadline-Plugin checked out beside Spool.
PLUGIN = Path(__file__).resolve().parents[2] / 'ComfyUI-Deadline-Plugin'
NO_PLUGIN = 'needs ComfyUI-Deadline-Plugin checked out beside the Spool checkout'


class DeadlineJobTests(unittest.TestCase):
    setUp = fixtures.FarmProtocolTests.setUp
    tearDown = fixtures.FarmProtocolTests.tearDown
    accept = fixtures.FarmProtocolTests.accept
    package = fixtures.FarmProtocolTests.package

    @unittest.skipUnless(PLUGIN.is_dir(), NO_PLUGIN)
    def test_installed_ordinary_worker_runs_the_hook_and_collects_one_take(self):
        sys.path.insert(0, str(PLUGIN / 'tests'))
        from test_reuse_endpoint import new_plugin
        attempt = self.farm_attempts[0]
        package = self.package(attempt)
        observed = {}
        def http(url, method='GET', data=None):
            observed.update(data)
            return {'status_code': 200, 'json': lambda: {'prompt_id': 'ordinary-worker-prompt'}}
        worker = new_plugin(comfyui_input_dir=str(self.media.host_roots['input']), comfyui_output_dir=str(self.root / 'output'),
            comfyui_install_path=str(self.root), comfyui_api_url='http://owned-test', client_id='test',
            submission_id=package['submissionId'], input_manifest_file='', assigned_variation_indices=[0],
            GetJob=lambda: types.SimpleNamespace(JobId='job-' + attempt['id'], GetJobExtraInfoKeyValue=lambda key: {'SpoolSubmissionId':package['submissionId'], 'SpoolAttemptId':package['attemptId']}.get(key,'')), GetCurrentTaskId=lambda: '0',
            SetProgress=lambda value: None, SetStatusMessage=lambda value: None, GetRegexMatch=lambda index: '0.01', http_request=http)
        worker.object_info = {'LoadImage': {'input': {'required': {'image': ['COMBO', {'image_upload': True}]}}}, 'SaveImage': {'output_node': True}}
        directory = self.root/'farm'/'spool-submissions'/package['submissionId']
        shutil.copyfile(Path(farm_protocol.__file__), directory/'farm_protocol.py')
        with patch.object(deadline_task, '__file__', str(directory/'deadline_task.py')):
            deadline_task.__main__(worker, 'Deadline task callback data')
        self.assertTrue(worker.queue_workflow(package['stagedPrompt']))
        self.assertNotIn('spool_executions', worker.__dict__)
        worker.HandleStdoutPromptExecuted()
        self.assertFalse(worker.task_completed)
        image = self.root / 'output' / (observed['prompt']['save']['inputs']['filename_prefix'] + '_00001_.png')
        image.parent.mkdir(parents=True)
        Image.new('RGB', (8, 8), 'green').save(image)
        history = {worker.prompt_id: {'prompt': [0, worker.prompt_id, observed['prompt']], 'status': {'completed': True, 'status_str': 'success'},
            'outputs': {'save': {'images': [{'filename': image.name, 'subfolder': str(image.parent.relative_to(self.root / 'output')), 'type': 'output'}]}}}}
        self.assertTrue(worker.process_history_data(history))
        self.assertTrue(worker.task_completed)
        Collector(self.store, self.media).scan()
        saved = self.store.get(self.project['id'])
        self.assertEqual(self.store.attempt(attempt['id'])['status'], 'complete')
        self.assertEqual(saved['document']['clips'][0]['takeId'], 'original')
        self.assertEqual(len(saved['document']['clips'][0]['takes']), 1)

    def test_dispatch_submits_the_validated_frozen_graph_without_local_queueing(self):
        for attempt, changed in zip(self.farm_attempts, (False, True)):
            def hook(payload):
                payload['partial_execution_targets'] = ['submit']
                if changed:
                    payload['prompt']['save']['inputs']['unexpected'] = 42
                return payload
            queued = []
            server = types.SimpleNamespace(number=0, trigger_on_prompt=hook,
                node_replace_manager=types.SimpleNamespace(apply_replacements=lambda prompt: None),
                prompt_queue=types.SimpleNamespace(put=queued.append))
            async def validate(identity, prompt, targets):
                return True, None, ['submit'] if 'submit' in prompt else ['save'], {}
            executor = LocalExecutor(self.store, self.media, server, validate)
            with patch('spool.execution.deadline_job.submit', return_value='owned-job') as submit:
                asyncio.run(executor.dispatch(attempt))
                self.assertEqual(submit.call_count, 0 if changed else 1)
            self.assertEqual(queued, [])
            self.assertEqual(self.store.attempt(attempt['id'])['status'], 'failed' if changed else 'farm_queued')
            if changed:
                self.assertIn('host hook changed', self.store.attempt(attempt['id'])['error'])

    @unittest.skipUnless(PLUGIN.is_dir(), NO_PLUGIN)
    def test_submission_uses_standard_job_files_without_plugin_spool_support(self):
        namespace = types.ModuleType('deadline_job_fixture')
        namespace.__path__ = [str(PLUGIN)]
        spec = importlib.util.spec_from_file_location(namespace.__name__ + '.deadline_submit', PLUGIN / 'deadline_submit.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {namespace.__name__: namespace, spec.name: module}):
            spec.loader.exec_module(module)
            node = module.DeadlineSubmitNode
            attempt = self.farm_attempts[0]
            request = copy.deepcopy(attempt['request'])
            request['prompt']['submit']['inputs'].update(job_name='Owned adapter test', priority=50, pool='none', group='none')
            package = self.package(attempt)
            folder = Path(package['resultRoot']) / 'spool-submissions' / package['submissionId']
            (folder / 'ack.json').unlink()
            commands = []

            def command(arguments):
                commands.append(arguments)
                job = Path(arguments[0]).read_text()
                plugin = Path(arguments[1]).read_text()
                self.assertIn('Frames=0-0', job)
                self.assertIn('PreTaskScript=' + str(folder / 'deadline_task.py'), job)
                self.assertNotIn('SpoolRequestFile', plugin)
                self.assertFalse(any(Path(p).name == 'spool_request.json' for p in arguments[2:]))
                staged = json.loads((folder / 'request.json').read_text())
                self.assertEqual(staged['adapter'], 'spool-job-script-1')
                self.assertEqual(staged['attemptId'], attempt['id'])
                self.assertNotIn('submit', staged['stagedPrompt'])
                return 'JobID=owned-adapter-job'

            settings = {'output_roots': [str(self.root / 'farm')], 'input_roots': [str(self.media.host_roots['input'])], 'drive_mappings': {}}
            nodes = types.SimpleNamespace(NODE_CLASS_MAPPINGS={'DeadlineSubmit': node})
            folder_paths = types.SimpleNamespace(get_output_directory=lambda: str(self.root / 'farm'))
            with patch.dict(sys.modules, {'nodes': nodes, 'folder_paths': folder_paths}), patch.object(module.DeadlineCommandHelper, 'get_farm_settings', return_value=settings), patch.object(module.InputAssetStager, '_get_local_input_directory', return_value=str(self.media.host_roots['input'])), patch.object(module.DeadlineCommandHelper, 'call_deadline_command', side_effect=command), patch.object(node, 'submit_to_deadline', side_effect=AssertionError('Do not use the patched node path')):
                self.assertEqual(deadline_job.submit(request, package), 'owned-adapter-job')
                self.assertEqual(deadline_job.submit(request, package), 'owned-adapter-job')
            self.assertEqual(len(commands), 1)
            self.assertEqual(json.loads((folder / 'ack.json').read_text())['jobId'], 'owned-adapter-job')
            (folder / 'ack.json').unlink()
            with patch.dict(sys.modules, {'nodes': nodes}), self.assertRaisesRegex(ValueError, 'no automatic resubmission'):
                deadline_job.submit(request, package)

    def test_job_hook_requires_verified_history_and_restores_exact_seed_inputs(self):
        attempt = self.farm_attempts[0]
        package = self.package(attempt)
        package['stagedPrompt']['seed'] = {'class_type': 'DeadlineSeed', 'inputs': {'seed': 999, 'batch_mode': True, 'task_id': 4}}
        class Worker:
            def __init__(self, root):
                self.comfyui_input_dir = str(root / 'input')
                self.comfyui_output_dir = str(root / 'output')
                self.comfyui_install_path = str(root)
                self.done = False
                self.prompt_id = 'worker-prompt'
            def _queue_prompt(self, prompt, metadata, workflow_metadata=None):
                self.sent = prompt
                return True
            def process_history_data(self, value):
                self._complete_task()
                return self.done
            def _complete_task(self):
                self.done = True
            def _handle_stdout_prompt_completion(self):
                self.done = True
            def GetSlaveName(self):
                return 'Owned worker'
            def GetJob(self):
                return types.SimpleNamespace(JobId='job-' + attempt['id'])
        worker = Worker(self.root)
        deadline_task.install(worker, package, farm_protocol)
        worker._handle_stdout_prompt_completion()
        worker._complete_task()
        self.assertFalse(worker.done)
        stock = copy.deepcopy(package['stagedPrompt'])
        stock['seed']['inputs'].update(batch_mode=False, task_id=0)
        worker._queue_prompt(stock, {'variation_index': 0, 'submission_id': package['submissionId']})
        self.assertEqual(worker.sent['seed'], package['stagedPrompt']['seed'])
        image = Path(worker.comfyui_output_dir) / (worker.sent['save']['inputs']['filename_prefix'] + '_00001_.png')
        image.parent.mkdir(parents=True)
        Image.new('RGB', (8, 8), 'blue').save(image)
        history = {'worker-prompt': {'prompt': [0, 'worker-prompt', worker.sent], 'status': {'completed': True, 'status_str': 'success'}, 'outputs': {'save': {'images': [{'filename': image.name, 'subfolder': str(image.parent.relative_to(self.root / 'output')), 'type': 'output'}]}}}}
        self.assertTrue(worker.process_history_data(history))
        receipts = list((self.root / 'farm' / 'spool-receipts' / attempt['id']).glob('*/receipt.json'))
        self.assertEqual(len(receipts), 1)
        farm_protocol.verify(package, json.loads(receipts[0].read_text()), self.root / 'farm')
        with self.assertRaisesRegex(ValueError, 'assigned Spool take'):
            worker._queue_prompt(stock, {'variation_index': 1, 'submission_id': package['submissionId']})


if __name__ == '__main__':
    unittest.main()
