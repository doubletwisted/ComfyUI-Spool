"""Runtime requirements reported by the health and capability routes."""

import platform
import sys

from . import cloud
from .system import find_tool

MINIMUM_PYTHON = (3, 11)


def report():
    """Return what this host provides and plain-language fixes for what it lacks."""
    tools = {name: find_tool(name) is not None for name in ("ffmpeg", "ffprobe")}
    missing = []
    if sys.version_info < MINIMUM_PYTHON:
        missing.append(
            "Spool needs Python %d.%d or newer; this ComfyUI runs Python %s."
            % (*MINIMUM_PYTHON, platform.python_version())
        )
    missing += [
        "Install %s and add it to PATH; Spool uses it to review, prepare and export media." % name
        for name, found in tools.items()
        if not found
    ]
    return {
        "python": platform.python_version(),
        **tools,
        "cloudSdk": cloud.available(),
        "missing": missing,
        "optional": [] if cloud.available() else [cloud.UNAVAILABLE],
    }
