"""One request guard for every Spool route: same-origin changes, local-only reach."""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool.media import Media
from spool.projects import Workspace
from spool.routes import register

ELSEWHERE = {'Origin': 'http://elsewhere.example'}
REBOUND = {'Host': 'attacker.example:8188'}


class RouteGuardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.outside = root / 'private' / 'footage.mp4'
        self.outside.parent.mkdir()
        self.outside.write_bytes(b'private footage')
        self.workspace = Workspace(root / 'app')
        takes = [{'id': 'inside', 'media': {'id': 'inside', 'kind': 'video', 'originalFile': 'output/Shot/inside.mp4', 'file': 'output/Shot/inside.mp4'}},
                 {'id': 'outside', 'media': {'id': 'outside', 'kind': 'video', 'originalFile': str(self.outside), 'file': str(self.outside)}}]
        self.project = self.workspace.create({'project': 'Guard QA', 'clips': [{'id': 'shot', 'takeId': 'inside', 'takes': takes, 'in': 0, 'out': 24}]})
        self.store = self.workspace.for_project(self.project['id'])
        inside = self.store.root / 'output/Shot/inside.mp4'
        inside.parent.mkdir(parents=True, exist_ok=True)
        inside.write_bytes(b'project footage')
        # Standalone mode builds its own application, exactly like this one.
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application())
        register(server, self.workspace, Media(self.workspace.root, root / 'input', root / 'output', root / 'temp'))
        server.app.cleanup_ctx.clear()
        server.app.add_routes(server.routes)
        self.client = TestClient(TestServer(server.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.base = '/spool/api/projects/' + self.project['id']

    async def test_cross_origin_changes_are_refused_on_every_mutating_route(self):
        document = self.project['document']
        attempts = [
            ('post', '/spool/api/projects', {'document': {'project': 'Forged'}}),
            ('put', self.base, {'revision': self.project['revision'], 'document': {**document, 'project': 'Forged'}}),
            ('post', self.base + '/queue', {'revision': self.project['revision'], 'items': [{'clipId': 'shot', 'count': 1}]}),
            ('post', self.base + '/commands', {'operationId': 'forged', 'actor': 'site', 'commands': []}),
            ('post', self.base + '/delete-takes/shot', {'revision': self.project['revision'], 'takeIds': ['outside']}),
            ('post', '/spool/api/upload?projectId=' + self.project['id'], None),
        ]
        for method, path, body in attempts:
            response = await getattr(self.client, method)(path, json=body, headers=ELSEWHERE) if body is not None else \
                await getattr(self.client, method)(path, data=b'bytes', headers={**ELSEWHERE, 'X-Filename': 'forged.png'})
            self.assertEqual(response.status, 403, path)
        self.assertEqual(self.store.get(self.project['id']), self.project)
        self.assertEqual(len(self.workspace.list()), 1)
        self.assertTrue(self.outside.is_file())

    async def test_own_pages_and_local_tools_may_change_projects(self):
        same = {'Origin': str(self.client.make_url('')).rstrip('/')}
        created = await self.client.post('/spool/api/projects', json={'document': {'project': 'From the studio', 'clips': [], 'media': []}}, headers=same)
        self.assertEqual(created.status, 200, await created.text())
        tool = await self.client.post('/spool/api/projects', json={'document': {'project': 'From the CLI', 'clips': [], 'media': []}})
        self.assertEqual(tool.status, 200, await tool.text())

    async def test_rebound_host_name_cannot_reach_local_only_routes(self):
        with patch('spool.routes.subprocess.Popen') as launch:
            response = await self.client.post('/spool/api/import-footage', json={'path': str(self.outside)}, headers=REBOUND)
            self.assertEqual(response.status, 403)
            response = await self.client.post(self.base + '/take-file/shot/outside/reveal', json={}, headers=REBOUND)
            self.assertEqual(response.status, 403)
            response = await self.client.post('/spool/api/comfy/start', json={}, headers=REBOUND)
            self.assertEqual(response.status, 403)
            response = await self.client.post('/spool/api/export/otio?projectId=' + self.project['id'], json={'projectId': self.project['id'], 'tracks': []}, headers=REBOUND)
            self.assertEqual(response.status, 403)
            launch.assert_not_called()

    async def test_take_downloads_outside_the_project_stay_on_this_computer(self):
        response = await self.client.get(self.base + '/take-file/shot/outside', headers=REBOUND)
        self.assertEqual(response.status, 403)
        response = await self.client.get(self.base + '/take-file/shot/outside')
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual(await response.read(), b'private footage')
        response = await self.client.get(self.base + '/take-file/shot/inside', headers=REBOUND)
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual(await response.read(), b'project footage')

    async def test_reads_and_listed_comfy_address_remain_available(self):
        response = await self.client.get('/spool/api/projects', headers=ELSEWHERE)
        self.assertEqual(response.status, 200)
        response = await self.client.get(self.base + '/take-file/shot/outside', headers={'Host': '0.0.0.0:8188'})
        self.assertEqual(response.status, 200, await response.text())


if __name__ == '__main__':
    unittest.main()
