"""Thin HTTP client; project state and command validation stay in the backend."""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .wire import wire, unwire

ACTIONS = {"status", "shot", "events", "focus", "command", "compare"}


def run():
    parser = argparse.ArgumentParser(prog="python -m spool", description="Spool agent commands")
    parser.add_argument("action", choices=sorted(ACTIONS))
    parser.add_argument("project")
    parser.add_argument("--url", default="http://127.0.0.1:8190")
    parser.add_argument("--clip")
    parser.add_argument("--since", type=int, default=0)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--view")
    parser.add_argument("--file", type=Path, help="Command JSON envelope; '-' reads stdin")
    parser.add_argument("--takes", nargs="+")
    parser.add_argument("--wire-json", action="store_true", help="Keep tagged exact integers in machine output")
    args = parser.parse_args()
    path = "/spool/api/projects/" + urllib.parse.quote(args.project, safe="")
    body = None
    if args.action in ("status", "shot"):
        if args.action == "shot" and not args.clip:
            parser.error("shot requires --clip")
        query = {"limit": args.limit, "offset": args.offset}
        if args.clip:
            query["clipId"] = args.clip
        path += "/status?" + urllib.parse.urlencode(query)
    elif args.action == "events":
        path += "/events?" + urllib.parse.urlencode({"since": args.since, "limit": args.limit})
    elif args.action == "focus":
        path += "/focus" + ("?" + urllib.parse.urlencode({"viewId": args.view}) if args.view else "")
    elif args.action == "compare":
        if not args.clip or not args.takes:
            parser.error("compare requires --clip and --takes")
        path += "/comparison"
        body = {"clipId": args.clip, "takeIds": args.takes}
    else:
        if not args.file:
            parser.error("command requires --file")
        path += "/commands"
        body = json.loads(sys.stdin.read() if str(args.file) == "-" else args.file.read_text(encoding="utf-8"))
    request = urllib.request.Request(
        args.url.rstrip("/") + path,
        data=json.dumps(wire(body)).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            value = json.load(response)
            if not args.wire_json:
                value = unwire(value)
    except urllib.error.HTTPError as error:
        try:
            value = json.load(error)
            if not isinstance(value, dict) or not isinstance(value.get("error"), str):
                raise ValueError("Invalid error reply")
        except (ValueError, UnicodeError):
            value = {"error": "Spool returned HTTP " + str(error.code), "code": "http_error"}
        value.setdefault("code", "http_error")
        print(json.dumps(value if args.wire_json else unwire(value), ensure_ascii=False), file=sys.stderr)
        return 1
    except (urllib.error.URLError, OSError) as error:
        print(json.dumps({"error": "Could not reach Spool: " + str(error), "code": "network_error"}), file=sys.stderr)
        return 1
    except (ValueError, UnicodeError):
        print(json.dumps({"error": "Spool returned invalid JSON", "code": "invalid_response"}), file=sys.stderr)
        return 1
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0
