"""Start the configured local Comfy host without restarting an existing process."""
import asyncio
import logging
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientSession, ClientConnectorError, ClientError, ClientTimeout

from .store import Conflict, encode, uid


def local_url(value):
    if not isinstance(value, str):
        raise ValueError('Supply the local Comfy address')
    parsed = urlsplit(value.strip())
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Use a local Comfy address such as http://127.0.0.1:8188')
    port = parsed.port or 80
    return 'http://' + ('[::1]' if parsed.hostname == '::1' else '127.0.0.1') + ':' + str(port)


class ComfyLauncher:
    def __init__(self, store):
        self.store = store
        self.lock = asyncio.Lock()
        self.process = None

    def settings(self):
        saved = self.store.setting('comfy_startup')
        config = self.store.host(include_definitions=False)['configuration']
        return saved or {'startupFile': '', 'comfyUrl': config.get('comfyUrl', 'http://127.0.0.1:8188') if config else 'http://127.0.0.1:8188', 'autoStart': False}

    def save(self, data):
        if not isinstance(data, dict) or not isinstance(data.get('startupFile', ''), str):
            raise ValueError('Supply Comfy startup settings with a file path and address')
        settings = {'startupFile': data.get('startupFile', '').strip(), 'comfyUrl': local_url(data['comfyUrl']), 'autoStart': data.get('autoStart', False)}
        if type(settings['autoStart']) is not bool:
            raise ValueError('Choose whether automatic startup is enabled')
        if settings['startupFile']:
            path = Path(settings['startupFile'])
            if not path.is_absolute() or not path.is_file() or (os.name == 'nt' and path.suffix.lower() not in ('.bat', '.cmd', '.exe')):
                raise ValueError('Choose an existing absolute startup file path (.bat, .cmd or .exe)')
            if path.suffix.lower() in ('.bat', '.cmd') and any(c in str(path) for c in '&|<>^%!"\r\n'):
                raise ValueError('The batch file path contains shell control characters; use a simpler path')
            settings['startupFile'] = str(path.resolve())
        if settings['autoStart'] and not settings['startupFile']:
            raise ValueError('Choose a startup file before enabling automatic startup')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            launch = self.store.setting('comfy_launch') or {}
            previous = self.settings()
            if launch.get('state') == 'starting' and time.time() - launch['created'] < 180 and any(settings[key] != previous[key] for key in ('startupFile', 'comfyUrl')):
                raise Conflict('Comfy is starting. Wait before changing its startup file or address.')
            host = self.store.host(include_definitions=False)
            if host['configuration'] and local_url(host['configuration']['comfyUrl']) != settings['comfyUrl']:
                if host['connected']:
                    raise Conflict('Comfy is running at its paired address. Keep that address while it is connected.')
                configuration = {**host['configuration'], 'comfyUrl': settings['comfyUrl']}
                db.execute('UPDATE host SET configuration=? WHERE id=1', (encode(configuration),))
            db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', ('comfy_startup', encode(settings)))
        return settings

    async def probe(self):
        url = local_url(self.settings()['comfyUrl'])
        try:
            async with ClientSession(timeout=ClientTimeout(total=5)) as client:
                async with client.get(url + '/spool/api/health', allow_redirects=False) as response:
                    if response.status != 200:
                        return 'unpaired', 'Comfy is already answering here. Load the current Spool extension in that host before connecting.'
                    data = await response.json()
                    if data.get('executorError'):
                        return 'unpaired', data['executorError']
                    if not data.get('executor'):
                        return 'unpaired', 'This address is already in use. Connect to Comfy with the current Spool extension loaded.'
                    if os.path.normcase(data.get('storePath', '')) != os.path.normcase(str(self.store.root)):
                        return 'unpaired', 'This address is running a different host or project store. Choose the paired Comfy address.'
                    return 'connected', None
        except ClientConnectorError:
            return 'stopped', None
        except (ClientError, asyncio.TimeoutError, ValueError):
            return 'unavailable', 'The Comfy address did not return its connection details. Check the address before starting another instance.'

    async def status(self):
        settings = self.settings()
        state, error = await self.probe()
        launch = self.store.setting('comfy_launch') or {}
        if state == 'connected':
            if launch.get('state') == 'starting':
                self.store.set_setting('comfy_launch', {**launch, 'state': 'connected'})
        elif state == 'stopped' and launch.get('state') == 'starting':
            if time.time() - launch['created'] > 180 or self.process and self.process.poll() not in (None, 0):
                launch = {**launch, 'state': 'error', 'error': 'Comfy did not become ready. Check the startup file, its port and the startup log.'}
                self.store.set_setting('comfy_launch', launch)
            else:
                state = 'starting'
        if state == 'stopped' and launch.get('state') == 'error':
            state, error = 'error', launch['error']
        portable = Path(__file__).resolve().parents[4]
        files = [str(p) for p in sorted(portable.glob('run*.bat')) if 'Deadline' not in p.name] if (portable / 'python_embeded/python.exe').is_file() else []
        return {'settings': settings, 'state': state, 'error': error, 'logAvailable': bool(launch.get('log')), 'startupFiles': files}

    async def start(self):
        async with self.lock:
            status = await self.status()
            if status['state'] in ('connected', 'starting'):
                return status
            if status['state'] in ('unpaired', 'unavailable'):
                raise ValueError(status['error'])
            settings = self.save(status['settings'])
            if not settings['startupFile']:
                raise ValueError('Choose a Comfy startup file in Comfy settings first')
            identity = uid()
            log_path = self.store.root / 'logs' / ('comfy-startup-' + identity + '.log')
            log_path.parent.mkdir(exist_ok=True)
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                launch = self.store.setting('comfy_launch') or {}
                if launch.get('state') == 'starting' and time.time() - launch['created'] < 180:
                    return {**status, 'state': 'starting'}
                db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', ('comfy_launch', encode({'id': identity, 'state': 'starting', 'created': time.time(), 'log': str(log_path)})))
            path = Path(settings['startupFile'])
            command = [str(path)]
            if os.name == 'nt' and path.suffix.lower() in ('.bat', '.cmd'):
                command = '"' + os.environ.get('COMSPEC', 'cmd.exe') + '" /d /s /c ""' + str(path) + '""'
            try:
                with log_path.open('ab') as log:
                    self.process = subprocess.Popen(command, cwd=path.parent, env={**os.environ, 'SPOOL_STORAGE': str(self.store.root)},
                        stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=0x08000200 if os.name == 'nt' else 0)
            except OSError as error:
                self.store.set_setting('comfy_launch', {'id': identity, 'state': 'error', 'error': str(error), 'log': str(log_path)})
                raise ValueError('Comfy could not start: ' + str(error)) from error
            return {**status, 'state': 'starting', 'error': None, 'logAvailable': True}

    def log(self):
        launch = self.store.setting('comfy_launch') or {}
        if not launch.get('log'):
            return ''
        with Path(launch['log']).open('rb') as handle:
            handle.seek(max(0, handle.seek(0, 2) - 16384))
            return handle.read().decode('utf-8', errors='replace')

    async def lifecycle(self, app):
        if self.settings()['autoStart']:
            try:
                await self.start()
            except ValueError as error:
                logging.warning('Spool Comfy startup: %s', error)
        yield
