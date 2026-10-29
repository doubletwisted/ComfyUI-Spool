"""Run Spool's editor and project store without ComfyUI: python -m spool"""

import argparse
import asyncio
import os
import sys
import webbrowser
from pathlib import Path
from types import SimpleNamespace

from aiohttp import web

from .media import Media
from .routes import register
from .projects import Workspace
from . import cli

# Installed under ComfyUI/custom_nodes, the standalone editor shares the plugin's projects and Comfy's folders.
COMFY = Path(__file__).resolve().parents[3]


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "reclaim":
        from . import maintenance

        raise SystemExit(maintenance.run(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] == "prune":
        from . import maintenance

        raise SystemExit(maintenance.run_prune(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] in cli.ACTIONS:
        raise SystemExit(cli.run())
    installed = (COMFY / "folder_paths.py").is_file()
    parser = argparse.ArgumentParser(prog="python -m spool", description="Spool video timeline")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8190)
    parser.add_argument(
        "--storage",
        type=Path,
        default=os.environ.get("SPOOL_STORAGE", COMFY / "user" / "spool" if installed else Path.home() / "Spool"),
    )
    parser.add_argument("--input-root", type=Path)
    parser.add_argument("--output-root", type=Path)
    parser.add_argument("--temp-root", type=Path)
    parser.add_argument("--open", action="store_true", help="open the studio in the default browser")
    args = parser.parse_args()
    store = Workspace(args.storage)
    folders = COMFY if installed else store.root
    pairing = store.host()["configuration"]
    roots = pairing["roots"] if pairing else {kind: str(folders / kind) for kind in ("input", "output", "temp")}
    media = Media(
        store.root,
        args.input_root or roots["input"],
        args.output_root or roots["output"],
        args.temp_root or roots["temp"],
    )
    server = SimpleNamespace(routes=web.RouteTableDef(), app=web.Application(client_max_size=100 * 1024 * 1024))
    register(server, store, media)

    @server.routes.get("/")
    async def home(request):
        raise web.HTTPFound("/spool/")

    server.app.add_routes(server.routes)
    url = f"http://{args.host}:{args.port}/spool/"
    if args.open:

        async def open_studio(app):
            # on_startup runs before the socket listens; give it a moment.
            asyncio.get_running_loop().call_later(0.5, webbrowser.open, url)

        server.app.on_startup.append(open_studio)
    print(f"Spool: {url}  (projects in {store.root})", flush=True)
    web.run_app(server.app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
