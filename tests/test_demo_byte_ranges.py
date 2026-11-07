"""Exercise the local demo server over real loopback HTTP.

``pages/serve.py`` is only the local preview used before publishing the online
demo. GitHub Pages never runs it, so these checks cover the page base path and
byte ranges of that local server, not Pages' own serving behavior.
"""

import hashlib
import http.client
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

from pages.serve import Handler

PAYLOAD = bytes(range(256)) * 4
SIZE = len(PAYLOAD)
BASE = "/ComfyUI-Spool/demo/"
INDEX = b"<!doctype html><title>Spool demo</title>"


class DemoByteRangeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.site = Path(self.directory.name)
        self.fixture = self.site / "media.bin"
        self.fixture.write_bytes(PAYLOAD)
        (self.site / "index.html").write_bytes(INDEX)
        self.original_hash = hashlib.sha256(self.fixture.read_bytes()).hexdigest()
        handler = partial(Handler, directory=str(self.site), base=BASE)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        try:
            self.server.shutdown()
        finally:
            self.server.server_close()
            self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive(), "demo server thread did not stop")

    def tearDown(self):
        self.assertEqual(self.fixture.read_bytes(), PAYLOAD)
        self.assertEqual(hashlib.sha256(self.fixture.read_bytes()).hexdigest(), self.original_hash)

    def request(self, path, range_header=None, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            headers = {} if range_header is None else {"Range": range_header}
            connection.request(method, path, headers=headers)
            response = connection.getresponse()
            body = response.read()
            return response.status, {name.lower(): value for name, value in response.getheaders()}, body
        finally:
            connection.close()

    def ranged(self, value, method="GET"):
        return self.request(BASE + "media.bin", value, method)

    def test_ordinary_full_response_and_base_path(self):
        for path in (BASE + "media.bin", BASE + "media.bin?cache=1", BASE):
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                expected = INDEX if path == BASE else PAYLOAD
                self.assertEqual(status, 200)
                self.assertEqual(headers["content-length"], str(len(expected)))
                self.assertEqual(headers["accept-ranges"], "bytes")
                self.assertEqual(body, expected)

    def test_paths_outside_the_base_are_not_served(self):
        for path in ("/media.bin", "/demo/media.bin", "/ComfyUI-Spool/other/media.bin"):
            with self.subTest(path=path):
                status, _, body = self.request(path)
                self.assertEqual(status, 404)
                self.assertNotIn(PAYLOAD, body)

    def test_closed_ranges_return_exact_bytes(self):
        for value, start, end in (
            ("bytes=0-0", 0, 0),
            ("bytes=100-199", 100, 199),
            ("bytes=1023-1023", SIZE - 1, SIZE - 1),
        ):
            with self.subTest(range=value):
                status, headers, body = self.ranged(value)
                self.assertEqual(status, 206)
                self.assertEqual(headers["content-range"], f"bytes {start}-{end}/{SIZE}")
                self.assertEqual(headers["content-length"], str(end - start + 1))
                self.assertEqual(headers["accept-ranges"], "bytes")
                self.assertEqual(body, PAYLOAD[start : end + 1])

    def test_open_ended_range_runs_to_the_end(self):
        status, headers, body = self.ranged("bytes=1000-")
        self.assertEqual(status, 206)
        self.assertEqual(headers["content-range"], f"bytes 1000-{SIZE - 1}/{SIZE}")
        self.assertEqual(headers["content-length"], str(SIZE - 1000))
        self.assertEqual(body, PAYLOAD[1000:])

    def test_suffix_range_reads_from_the_end(self):
        status, headers, body = self.ranged("bytes=-17")
        self.assertEqual(status, 206)
        self.assertEqual(headers["content-range"], f"bytes {SIZE - 17}-{SIZE - 1}/{SIZE}")
        self.assertEqual(headers["content-length"], "17")
        self.assertEqual(body, PAYLOAD[-17:])

    def test_clamped_ranges_stay_inside_the_file(self):
        for value, start, end in (
            ("bytes=-5000", 0, SIZE - 1),
            ("bytes=1000-5000", 1000, SIZE - 1),
        ):
            with self.subTest(range=value):
                status, headers, body = self.ranged(value)
                self.assertEqual(status, 206)
                self.assertEqual(headers["content-range"], f"bytes {start}-{end}/{SIZE}")
                self.assertEqual(headers["content-length"], str(end - start + 1))
                self.assertEqual(body, PAYLOAD[start : end + 1])

    def test_unsatisfiable_ranges_return_416_without_a_body(self):
        for value in ("bytes=100-50", "bytes=700-200", "bytes=1024-", "bytes=1024-5000", "bytes=-0"):
            with self.subTest(range=value):
                status, headers, body = self.ranged(value)
                self.assertEqual(status, 416)
                self.assertEqual(headers["content-range"], f"bytes */{SIZE}")
                self.assertEqual(headers["content-length"], "0")
                self.assertEqual(headers["accept-ranges"], "bytes")
                self.assertEqual(body, b"")

    def test_head_has_the_same_headers_and_no_body(self):
        cases = (
            (None, 200, None, str(SIZE)),
            ("bytes=100-199", 206, f"bytes 100-199/{SIZE}", "100"),
            ("bytes=700-200", 416, f"bytes */{SIZE}", "0"),
        )
        for value, status_code, content_range, content_length in cases:
            with self.subTest(range=value):
                status, headers, body = self.ranged(value, method="HEAD")
                self.assertEqual(status, status_code)
                self.assertEqual(headers.get("content-range"), content_range)
                self.assertEqual(headers["content-length"], content_length)
                self.assertEqual(body, b"")
