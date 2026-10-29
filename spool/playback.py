"""One bounded playback encoder shared by every project on this host."""

import threading
from concurrent.futures import ThreadPoolExecutor, Future


class PlaybackQueue:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="spool-playback")
        self.lock = threading.Lock()
        self.jobs = {}

    def submit(self, media, record, width, height, fps):
        key = media.preview_path(record, width, height, fps)
        with self.lock:
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

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)
