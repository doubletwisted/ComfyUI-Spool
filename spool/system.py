"""What differs between Windows, macOS and Linux: finding tools and showing files."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

# Apps started from the Dock or Finder, such as ComfyUI Desktop, get a minimal PATH
# without Homebrew or MacPorts, so look in their folders too.
EXTRA_FOLDERS = {
    "darwin": ("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"),
    "linux": ("/usr/local/bin", "/snap/bin"),
}
DEADLINE = {
    "win32": "C:/Program Files/Thinkbox/Deadline10/bin/deadlinecommand.exe",
    "darwin": "/Applications/Thinkbox/Deadline10/Resources/deadlinecommand",
    "linux": "/opt/Thinkbox/Deadline10/bin/deadlinecommand",
}
FILE_MANAGER = {"win32": "Explorer", "darwin": "Finder"}


def find_tool(name):
    """Absolute path of a command-line tool, or None."""
    found = shutil.which(name)
    if found:
        return found
    for folder in EXTRA_FOLDERS.get(sys.platform, ()):
        found = shutil.which(name, path=folder)
        if found:
            return found
    return None


def deadline_command():
    """deadlinecommand on PATH, in the folder Deadline's installer records, or in its default location."""
    found = find_tool("deadlinecommand")
    if found:
        return found
    folder = os.environ.get("DEADLINE_PATH")
    if folder:
        found = shutil.which("deadlinecommand", path=folder)
        if found:
            return found
    return DEADLINE.get(sys.platform, "deadlinecommand")


def file_manager():
    """The name of this host's file manager, or None when Spool cannot open one."""
    if sys.platform in FILE_MANAGER:
        return FILE_MANAGER[sys.platform]
    return "file manager" if shutil.which("xdg-open") else None


def show(path, select=False):
    """Open a folder in the file manager, or with select, the folder holding a file with it selected where the platform can."""
    path = Path(path)
    if sys.platform == "win32":
        command = ["explorer.exe", "/select,", str(path)] if select else ["explorer.exe", str(path)]
    elif sys.platform == "darwin":
        command = ["open", "-R", str(path)] if select else ["open", str(path)]
    elif opener := shutil.which("xdg-open"):
        # xdg-open has no way to select a file, so it opens the folder holding it.
        command = [opener, str(path.parent if select else path)]
    else:
        raise ValueError("Showing files needs a desktop with xdg-open")
    subprocess.Popen(
        command, shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
