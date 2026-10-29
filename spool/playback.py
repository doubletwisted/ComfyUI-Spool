"""One bounded playback encoder shared by every project on this host."""

import threading
import subprocess
from concurrent.futures import ThreadPoolExecutor, Future, CancelledError


class PlaybackQueue:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="spool-playback")
        self.lock = threading.Lock()
        self.jobs = {}
        self.closed = False
        self.process = None

    def submit(self, media, record, width, height, fps):
        key = media.preview_path(record, width, height, fps)
        with self.lock:
            if self.closed:
                raise CancelledError("Playback preparation stopped")
            if key.is_file():
                future = Future()
                future.set_result(media.preview_result(record, width, height, fps))
                return future
            future = self.jobs.get(key)
            if future is None:
                future = self.executor.submit(media.preview, record, width, height, fps)
                self.jobs[key] = future

        def finished(done):
            if not done.cancelled() and done.exception() is None:
                with self.lock:
                    if self.jobs.get(key) is done:
                        del self.jobs[key]

        future.add_done_callback(finished)
        return future

    def status(self, media, record, width, height, fps):
        key = media.preview_path(record, width, height, fps)
        if key.is_file():
            return media.preview_result(record, width, height, fps)
        future = self.submit(media, record, width, height, fps)
        if not future.done():
            return {"state": "preparing"}
        try:
            future.result()
        except Exception:
            # A failed request reports its error; a later explicit retry can resubmit.
            with self.lock:
                if self.jobs.get(key) is future:
                    del self.jobs[key]
            raise
        return media.preview_result(record, width, height, fps)

    def run(self, command, *, check, capture_output, timeout):
        """Run playback ffmpeg with shutdown ownership, including its final remux."""
        with self.lock:
            if self.closed:
                raise CancelledError("Playback preparation stopped")
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE if capture_output else None,
                stderr=subprocess.PIPE if capture_output else None,
            )
            self.process = process
        try:
            try:
                stdout, stderr = process.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise
            result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
            if check:
                result.check_returncode()
            return result
        finally:
            with self.lock:
                self.process = None
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()

    def close(self):
        with self.lock:
            self.closed = True
            if self.process is not None:
                # communicate() in the worker reaps it before shutdown joins that worker.
                self.process.kill()
        self.executor.shutdown(wait=True, cancel_futures=True)
