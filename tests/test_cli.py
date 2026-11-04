import contextlib
import http.server
import io
import json
import os
import threading
import unittest
import urllib.error
from unittest.mock import patch

from spool.cli import run


class CliTests(unittest.TestCase):
    def invoke(self, reply, *args):
        out, err = io.StringIO(), io.StringIO()
        with (
            patch("sys.argv", ["spool", "status", "project", *args]),
            patch("spool.cli.urlopen") as send,
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            if isinstance(reply, Exception):
                send.side_effect = reply
            else:
                send.return_value.__enter__.return_value = io.BytesIO(reply)
            code = run()
        return code, out.getvalue(), err.getvalue()

    def test_machine_and_readable_integers(self):
        reply = b'{"seed":{"__spool_int__":"18446744073709551615"}}'
        self.assertEqual(json.loads(self.invoke(reply)[1])["seed"], 18446744073709551615)
        self.assertEqual(
            json.loads(self.invoke(reply, "--wire-json")[1])["seed"], {"__spool_int__": "18446744073709551615"}
        )

    def test_http_network_and_non_json_failures(self):
        for failure, expected in (
            (
                urllib.error.HTTPError("url", 502, "Bad gateway", {}, io.BytesIO(b"<html>bad gateway</html>")),
                "http_error",
            ),
            (
                urllib.error.HTTPError(
                    "url", 404, "Missing", {}, io.BytesIO(b'{"error":"Missing","code":"not_found"}')
                ),
                "not_found",
            ),
            (urllib.error.URLError("offline"), "network_error"),
            (b"<html>not JSON</html>", "invalid_response"),
            (b'{"__spool_int__":"bad integer"}', "invalid_response"),
        ):
            code, out, err = self.invoke(failure)
            self.assertEqual((code, out, json.loads(err)["code"]), (1, "", expected))


class LoopbackTests(unittest.TestCase):
    def test_a_proxy_for_other_traffic_does_not_capture_this_computer(self):
        class Spool(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = b'{"ok":true}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Spool)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = "http://127.0.0.1:%d" % server.server_port
        # Port 9 on loopback refuses: a request sent to this proxy would fail.
        environment = {key: value for key, value in os.environ.items() if "proxy" not in key.lower()}
        out = io.StringIO()
        with (
            patch.dict(os.environ, {**environment, "http_proxy": "http://127.0.0.1:9"}, clear=True),
            patch("sys.argv", ["spool", "status", "project", "--url", url]),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(run(), 0)
        self.assertEqual(json.loads(out.getvalue()), {"ok": True})
