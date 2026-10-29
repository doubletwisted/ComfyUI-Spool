"""Isolated installed-Comfy CPU host; never loads or restarts the user's host."""

import argparse
import os
import sys
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--comfy", required=True)
parser.add_argument("--runtime", required=True)
parser.add_argument("--port", type=int, default=8197)
parser.add_argument("--deadline", action="store_true")
parser.add_argument("--partner-nodes", action="store_true")
options = parser.parse_args()
workspace = Path(__file__).resolve().parent.parent
runtime = Path(options.runtime).resolve()
runtime.mkdir(parents=True, exist_ok=True)
(runtime / "user").mkdir(exist_ok=True)
os.environ["SPOOL_STORAGE"] = str(runtime / "spool")
# Cloud settings checks save and remove a fixture key; keep it out of the machine's key.
os.environ["SPOOL_CREDENTIALS"] = str(runtime / "credentials")
if os.name == "nt":
    os.environ.setdefault("AIOHTTP_NOSENDFILE", "1")
sys.path.insert(0, str(Path(options.comfy).resolve()))
sys.argv = [
    "main.py",
    "--cpu",
    "--disable-all-custom-nodes",
    *([] if options.partner_nodes else ["--disable-partner-nodes"]),
    "--listen",
    "127.0.0.1",
    "--port",
    str(options.port),
    "--base-directory",
    str(runtime),
    "--user-directory",
    str(runtime / "user"),
    "--database-url",
    "sqlite:///" + str(runtime / "assets.db").replace("\\", "/"),
]

import main
import nodes


original_init = nodes.init_extra_nodes


async def init_spool(*args, **kwargs):
    await original_init(*args, **kwargs)
    if options.deadline and not await nodes.load_custom_node(
        str(workspace.parent / "ComfyUI-Deadline-Plugin"), module_parent="custom_nodes"
    ):
        raise RuntimeError("Deadline Submit failed to load")
    if not await nodes.load_custom_node(str(workspace), module_parent="custom_nodes"):
        raise RuntimeError("Spool failed to load")


nodes.init_extra_nodes = init_spool
loop, server, start = main.start_comfyui()
try:
    loop.run_until_complete(start())
finally:
    server.asset_manager.shutdown()
