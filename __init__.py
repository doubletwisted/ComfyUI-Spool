import json
import logging
import os
import platform
import sys
from pathlib import Path

from aiohttp.test_utils import make_mocked_request

import execution
import folder_paths
from comfy.cli_args import args
from comfy_execution.progress import get_progress_state
from server import PromptServer

from .spool.execution import LocalExecutor
from .spool.media import Media
from .spool.routes import register
from .spool.projects import Workspace
from .spool.requirements import MINIMUM_PYTHON, report

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
supported = sys.version_info >= MINIMUM_PYTHON
# Without a supported Python the routes are absent, so the page extension is withheld too.
WEB_DIRECTORY = "./web" if supported else None

if not supported:
    logging.error(
        "Spool needs Python %d.%d or newer; this ComfyUI runs Python %s. Spool is disabled.",
        *MINIMUM_PYTHON,
        platform.python_version(),
    )
elif not os.environ.get("DEADLINE_JOB_ID"):
    root = Path(os.environ.get("SPOOL_STORAGE", Path(folder_paths.get_user_directory()) / "spool"))
    store = Workspace(root)
    media = Media(
        root, folder_paths.get_input_directory(), folder_paths.get_output_directory(), folder_paths.get_temp_directory()
    )
    # Comfy exposes node schemas only through this route. If a future Comfy moves
    # it, Spool still loads and reports no node definitions instead of failing.
    schema_handler = next(
        (route.handler for route in PromptServer.instance.routes if getattr(route, "path", None) == "/object_info"),
        None,
    )
    if schema_handler is None:
        logging.warning("Spool: ComfyUI's /object_info route was not found; node checks are unavailable.")

    async def schemas():
        if schema_handler is None:
            return {}
        response = await schema_handler(make_mocked_request("GET", "/object_info"))
        return json.loads(response.text)

    configuration = {
        "roots": {k: str(v) for k, v in media.host_roots.items()},
        "comfyUrl": "http://127.0.0.1:" + str(args.port),
    }

    def progress():
        registry = get_progress_state()
        return {
            "promptId": registry.prompt_id,
            "nodes": [
                {"id": node_id, "value": state["value"], "max": state["max"]}
                for node_id, state in list(registry.nodes.items())
                if state["state"].value == "running"
            ],
        }

    executor = LocalExecutor(
        store, media, PromptServer.instance, execution.validate_prompt, schemas, configuration, progress
    )
    register(PromptServer.instance, store, media, executor)
    for issue in report()["missing"]:
        logging.warning("Spool: %s", issue)
