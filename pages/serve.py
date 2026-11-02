"""Serve an assembled demo locally the way GitHub Pages does: under its base
path, with byte ranges so video seeks.

    python pages/serve.py --site DIR --base /ComfyUI-Spool/demo/ --port 8208
"""

import argparse
import http.server
import mimetypes
import os
import re
from functools import partial
from pathlib import Path

mimetypes.add_type("text/javascript", ".js")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, base, **kwargs):
        self.base = base
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if not clean.startswith(self.base):
            return str(Path(self.directory) / "__outside_base__")
        return super().translate_path("/" + clean[len(self.base) :])

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if not match or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(match[1]) if match[1] else max(0, size - int(match[2] or 0))
        end = min(int(match[2]), size - 1) if match[1] and match[2] else size - 1
        if start >= size:
            self.send_error(416)
            return None
        handle = open(path, "rb")
        handle.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.remaining = end - start + 1
        return handle

    def copyfile(self, source, outputfile):
        remaining = getattr(self, "remaining", None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self.remaining = None

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", required=True)
    parser.add_argument("--base", default="/ComfyUI-Spool/demo/")
    parser.add_argument("--port", type=int, default=8208)
    args = parser.parse_args()
    handler = partial(Handler, directory=str(Path(args.site).resolve()), base=args.base)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Demo at http://127.0.0.1:{args.port}{args.base}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
