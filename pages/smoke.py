"""Open an assembled demo in headless Chrome and fail unless the studio loads
the project without asking for anything the demo does not answer.

    python pages/smoke.py --site DIR --base /ComfyUI-Spool/demo/ [--chrome PATH]
"""

import argparse
import html
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from serve import Handler  # noqa: E402


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


class QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        pass  # Chrome drops media connections it no longer needs.


CHROMES = [
    "chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome(given):
    for candidate in [given] if given else CHROMES:
        found = shutil.which(candidate) or (candidate if os.path.isfile(candidate) else None)
        if found:
            return found
    raise SystemExit("Chrome not found; pass --chrome")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", required=True)
    parser.add_argument("--base", default="/ComfyUI-Spool/demo/")
    parser.add_argument("--chrome")
    args = parser.parse_args()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    handler = partial(QuietHandler, directory=str(Path(args.site).resolve()), base=args.base)
    server = QuietServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory() as profile:
        command = [
            find_chrome(args.chrome), "--headless=new", "--disable-gpu", "--no-sandbox", "--mute-audio",
            "--user-data-dir=" + profile, "--window-size=1600,900", "--virtual-time-budget=20000",
            "--dump-dom", f"http://127.0.0.1:{port}{args.base}",
        ]  # fmt: skip
        dom = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=180).stdout
    server.shutdown()
    status = re.search(r'id="saveStatus"[^>]*>([^<]*)<', dom)
    declined = re.search(r'data-demo-declined="([^"]*)"', dom)
    problems = []
    if 'id="spool-loading"' in dom:
        problems.append("the studio did not finish loading")
    if not status or "saved" not in html.unescape(status[1]).lower():
        problems.append("save status is " + repr(status and html.unescape(status[1])))
    if declined and declined[1]:
        problems.append("the studio asked for routes the demo does not answer: " + html.unescape(declined[1]))
    if problems:
        raise SystemExit("Demo smoke check failed: " + "; ".join(problems))
    print("Demo loaded:", html.unescape(status[1]).strip("✓ "))


if __name__ == "__main__":
    main()
