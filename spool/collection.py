"""Receipt recovery does not depend on a live Comfy queue or history."""

import asyncio
import logging
import os
import subprocess
import threading
import time

from . import attempts, joins, receipts, sidecars
from .cloud import storage_call
from .farm import FarmCollector
from .folder_takes import FolderTakes
from .store import Conflict


class Collector:
    HISTORY_INTERVAL = 300

    def __init__(self, store, media):
        self.store, self.media = store, media
        self.farms = {}
        self.folders = FolderTakes()
        self.history_checked = {}
        self.retained_at = {}
        self.playback_checkpoints = {}
        self.project_locks = {}
        self.project_locks_lock = threading.Lock()

    def project_lock(self, store):
        # Routes, local observations and Cloud ingestion share this collector.
        # Lock the synchronous file work in its worker thread, per project; a
        # cancelled await must not let another worker reuse its partial files.
        key = os.path.normcase(os.path.abspath(store.root))
        with self.project_locks_lock:
            return self.project_locks.setdefault(key, threading.RLock())

    def annotate_progress(self, project):
        for job in project["document"]["jobs"]:
            if job.get("target") != attempts.DEADLINE or job["status"] in attempts.TERMINAL:
                continue
            observed = next(
                (farm.observations[job["id"]] for farm in self.farms.values() if job["id"] in farm.observations), None
            )
            if observed:
                job["farmProgress"] = dict(observed)
        return project

    def ingest(self, attempt):
        store = self.store.for_project(attempt["project_id"])
        with self.project_lock(store):
            return self._ingest(store, attempt)

    def _ingest(self, store, attempt):
        media = self.media.for_project(store, attempt["project_id"])
        observed = store.attempt(attempt["id"])["status"]
        if observed == attempts.COMPLETE:
            return False
        path = media.receipt_path(attempt)
        try:
            result = receipts.verify(attempt, path, media)
            result = media.review_receipt(result, attempt["request"].get("sequenceFps", 24))
            result = joins.attach(media, attempt["request"], result)
            result["dispatch"] = store.dispatch_record(attempt["id"])
            sidecars.write_result(store, media, attempt, result)
            return store.accept_execution(attempt["id"], attempt["prompt_id"], None, result)
        except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
            store.transition(attempt["id"], attempts.COLLECTION_PENDING, error=str(error), expected=observed)
            return False

    def scan(self):
        # Receipts retain attempt identity; untracked clip-folder files are
        # discovered separately and never become successful queued executions.
        for store in self.store.project_stores():
            try:
                self.scan_project(store)
            except (ValueError, OSError, Conflict):
                logging.exception("Spool project folder is temporarily unavailable: %s", store.root)

    def scan_project(self, store):
        with self.project_lock(store):
            self._scan_project(store)

    def _scan_project(self, store):
        projects = store.list()
        project_id = projects[0]["id"] if projects else None
        media = self.media.for_project(store, project_id)
        farm = self.farms.setdefault(str(store.root), FarmCollector(store, media))
        key, now = str(store.root), time.monotonic()
        history = key not in self.history_checked or now - self.history_checked[key] >= self.HISTORY_INTERVAL
        if history:
            self.history_checked[key] = now
        for attempt in store.scan_attempts(pending_only=not history):
            if attempts.target_of(attempt["request"]) == attempts.DEADLINE:
                try:
                    farm.collect(attempt)
                # Submission files on the farm share may hold valid JSON of the wrong shape.
                except (
                    ValueError,
                    KeyError,
                    OSError,
                    RuntimeError,
                    subprocess.SubprocessError,
                    TypeError,
                    AttributeError,
                    IndexError,
                ) as error:
                    store.transition(
                        attempt["id"], attempts.COLLECTION_PENDING, error=str(error), expected=attempt["status"]
                    )
                continue
            path = media.receipt_path(attempt)
            if not path.is_file() or attempt["status"] == attempts.COMPLETE:
                continue
            self.ingest(attempt)
        if media.project_id:
            self.folders.scan(store, media, project_id)
        if media.playback is not None and project_id:
            state = store.sync_state(project_id)
            checkpoint = (state["revision"], state["cursor"])
            if self.playback_checkpoints.get(key) != checkpoint:
                media.prepare_playback(store.projected(project_id))
                self.playback_checkpoints[key] = checkpoint
        if key not in self.retained_at or now - self.retained_at[key] >= 86400:
            store.retain_history()
            self.retained_at[key] = now

    async def lifecycle(self, app):
        task = asyncio.create_task(self.run())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def run(self):
        while True:
            try:
                await storage_call(self.scan)
            except Exception:
                logging.exception("Spool receipt scan failed; evidence retained for retry")
            await asyncio.sleep(2)
