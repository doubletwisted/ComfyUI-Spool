import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from spool.execution import LocalExecutor
from spool.ownership import ExecutorLock
from spool.routes import register
import test_queue_operations as fixtures


class ExecutorConflictTests(unittest.TestCase):
    setUp = fixtures.QueueOperationTests.setUp
    tearDown = fixtures.QueueOperationTests.tearDown

    def executor(self):
        server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(), prompt_queue=Mock())
        executor = LocalExecutor(self.store, self.media, server, AsyncMock(), AsyncMock(return_value={}),
            {'roots': {k: str(v) for k, v in self.media.host_roots.items()}, 'comfyUrl': 'http://127.0.0.1:8195'})
        return server, executor

    def test_busy_store_starts_server_without_dispatch_or_owner_replacement(self):
        owner = ExecutorLock(self.store.root)
        owner.acquire()
        configuration = {'roots': {k: str(v) for k, v in self.media.host_roots.items()}, 'comfyUrl': 'http://127.0.0.1:8188'}
        self.store.publish_host(configuration, 'original-owner')
        async def check():
            server, executor = self.executor()
            register(server, self.store, self.media, executor)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                health = await (await client.get('/spool/api/health')).json()
                self.assertFalse(health['executor'])
                self.assertIn('8188', health['executorError'])
                capability = await (await client.get('/spool/api/capabilities')).json()
                self.assertEqual(capability['configuration'], configuration)
                result = await (await client.post('/spool/api/projects/' + self.project['id'] + '/queue', json={
                    'revision': self.project['revision'], 'items': self.items, 'operationId': 'passive-queue'})).json()
                self.assertEqual(len(result['document']['jobs']), 2)
                self.assertTrue(all(j['status'] == 'waiting_for_host' for j in result['document']['jobs']))
                await client.post('/spool/api/reconcile', json={})
                self.assertEqual(self.store.host()['sessionId'], 'original-owner')
                executor.schemas.assert_not_called()
                executor.validate.assert_not_called()
                server.prompt_queue.put.assert_not_called()
                with self.store.connect() as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM attempt_owners').fetchone()[0], 0)
            self.assertTrue(self.store.host()['connected'])
        try:
            asyncio.run(check())
        finally:
            owner.close()

    def test_pairing_conflict_releases_acquired_lock_and_leaves_comfy_running(self):
        self.store.publish_host({'roots': {}, 'comfyUrl': 'http://127.0.0.1:8188'}, 'saved-pair')
        self.store.retire_host('saved-pair')
        async def check():
            _, executor = self.executor()
            lifecycle = executor.poll(None)
            await anext(lifecycle)
            self.assertFalse(executor.managed)
            self.assertIn('8188', executor.disabled_reason)
            another = ExecutorLock(self.store.root)
            another.acquire(); another.close()
            await lifecycle.aclose()
            self.assertEqual(self.store.host()['sessionId'], 'saved-pair')
        asyncio.run(check())

    def test_capability_reads_reuse_published_schemas(self):
        async def check():
            server, executor = self.executor()
            definitions = {'LoadImage': {'input': {'required': {'image': [['original.png']]}}}, 'SaveImage': {'output_node': True}}
            server.prompt_queue.get_current_queue.return_value = ([], [])
            executor.schemas.return_value = definitions
            register(server, self.store, self.media, executor)
            server.app.add_routes(server.routes)
            async with TestClient(TestServer(server.app)) as client:
                for _ in range(3):
                    response = await client.get('/spool/api/capabilities')
                    self.assertEqual((await response.json())['definitions'], definitions)
                filtered = await (await client.get('/spool/api/capabilities?types=LoadImage')).json()
                self.assertEqual(filtered['definitions'], {'LoadImage': definitions['LoadImage']})
                status = await (await client.get('/spool/api/capabilities?types=')).json()
                self.assertTrue(status['connected'])
                self.assertEqual(status['definitions'], {})
                self.assertEqual(status['sessionId'], executor.session_id)
                executor.schemas.assert_awaited_once()
                self.assertEqual(self.store.host()['definitions'], definitions)
                # Metadata reads must not load or parse the large schema column.
                with self.store.connect() as db:
                    db.execute("UPDATE host SET definitions='not JSON' WHERE id=1")
                self.assertEqual(self.store.host(include_definitions=False)['definitions'], {})
        asyncio.run(check())
