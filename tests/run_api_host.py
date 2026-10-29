"""Fresh editing API for UI checks while the owned Comfy CPU host stays on 8195.

No execution services run here. Node schemas come from 8195; storage, credentials
and media are isolated in --runtime. Use SPOOL_API_BASE with run_browser_checks.cjs.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.request import urlopen

from aiohttp import web

parser = argparse.ArgumentParser()
parser.add_argument("--runtime", required=True)
parser.add_argument("--port", type=int, default=8194)
options = parser.parse_args()
root = Path(options.runtime).resolve()
os.environ["SPOOL_STORAGE"] = str(root / "spool")
os.environ["SPOOL_CREDENTIALS"] = str(root / "credentials")
os.environ.pop("COMFY_API_KEY", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.media import Media
from spool.projects import Workspace
from spool.routes import register

with urlopen("http://127.0.0.1:8195/spool/api/capabilities") as response:
    definitions = json.load(response)["definitions"]
workspace = Workspace(root / "spool")
roots = {kind: root / kind for kind in ("input", "output", "temp")}
for path in roots.values():
    path.mkdir(parents=True, exist_ok=True)
configuration = {"comfyUrl": "http://127.0.0.1:8195", "roots": {kind: str(path) for kind, path in roots.items()}}
workspace.publish_host(configuration, "editing-api-qa", definitions)
media = Media(workspace.root, roots["input"], roots["output"], roots["temp"])
server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(client_max_size=32 * 1024 * 1024))
register(server, workspace, media)
server.app.cleanup_ctx.clear()
server.app.add_routes(server.routes)


async def heartbeat(app):
    async def run():
        while True:
            await asyncio.sleep(5)
            await asyncio.to_thread(workspace.publish_host, configuration, "editing-api-qa")

    task = asyncio.create_task(run())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


server.app.cleanup_ctx.append(heartbeat)
print("Owned editing API http://127.0.0.1:" + str(options.port), flush=True)
web.run_app(server.app, host="127.0.0.1", port=options.port, print=None)
