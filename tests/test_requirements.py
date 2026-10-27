"""Optional Comfy Cloud SDK and reported host requirements."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool import cloud, requests, requirements
from spool.media import Media
from spool.routes import register
from spool.store import Store, empty_project

ROOT = Path(__file__).resolve().parent.parent


class RequirementsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.store = Store(self.root / 'store')
        self.media = Media(self.root / 'store', self.root / 'input', self.root / 'output', self.root / 'temp')
        self.project = self.store.create(empty_project())

    def test_extension_imports_without_the_cloud_sdk(self):
        script = "import sys; sys.modules['comfy_sdk'] = None\nimport spool.cloud as c, spool.routes, spool.requests\nassert not c.available()\nprint('ok')"
        result = subprocess.run([sys.executable, '-c', script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')

    async def test_missing_sdk_is_reported_and_cloud_queueing_is_refused(self):
        with patch.object(cloud, 'AsyncComfy', None):
            report = requirements.report()
            self.assertFalse(report['cloudSdk'])
            self.assertEqual(report['optional'], [cloud.UNAVAILABLE])
            server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
            register(server, self.store, self.media)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                capabilities = await (await client.get('/spool/api/capabilities?types=')).json()
                self.assertFalse(capabilities['cloudExecution'])
                self.assertFalse(capabilities['requirements']['cloudSdk'])
                health = await (await client.get('/spool/api/health')).json()
                self.assertIn('ffmpeg', health['requirements'])

    def test_cloud_target_is_refused_before_any_input_is_frozen(self):
        recipe = {'prompt': {'save': {'class_type': 'SaveVideo', 'inputs': {'filename_prefix': 'cloud'}}}, 'result': {'nodeId': 'save', 'index': 0}, 'executionTarget': 'cloud', 'bindings': []}
        project = {'document': {'clips': [{'id': 'shot', 'workflowVersion': 'cloud-recipe'}]}}
        with patch.object(cloud, 'AsyncComfy', None), patch.object(self.store, 'workflow', return_value=recipe):
            with self.assertRaisesRegex(ValueError, 'comfy-sdk'):
                requests.prepare(self.store, self.media, project, [{'clipId': 'shot', 'count': 1}])
        self.assertFalse(list((self.root / 'input').rglob('*')) if (self.root / 'input').exists() else [])

    async def test_health_reports_the_packaged_version(self):
        import tomllib
        import spool
        packaged = tomllib.loads((ROOT / 'pyproject.toml').read_text(encoding='utf-8'))['project']['version']
        self.assertEqual(spool.__version__, packaged)
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.store, self.media)
        server.app.add_routes(server.routes)
        async with TestClient(TestServer(server.app)) as client:
            self.assertEqual((await (await client.get('/spool/api/health')).json())['version'], packaged)

    def test_missing_tools_and_old_python_are_explained(self):
        with patch('spool.requirements.shutil.which', return_value=None), patch.object(requirements, 'MINIMUM_PYTHON', (99, 0)):
            report = requirements.report()
        self.assertFalse(report['ffmpeg'] or report['ffprobe'])
        self.assertTrue(any('Python 99.0' in issue for issue in report['missing']))
        self.assertTrue(any(issue.startswith('Install ffmpeg') for issue in report['missing']))
        self.assertTrue(any(issue.startswith('Install ffprobe') for issue in report['missing']))


if __name__ == '__main__':
    unittest.main()
