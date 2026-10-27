"""Receipt recovery does not depend on a live Comfy queue or history."""
import asyncio
import logging
import subprocess

from . import attempts, receipts, sidecars
from .farm import FarmCollector
from .folder_takes import FolderTakes
from .store import Conflict


class Collector:
    def __init__(self, store, media):
        self.store, self.media = store, media
        self.farms = {}
        self.folders = FolderTakes()

    def annotate_progress(self, project):
        for job in project["document"]["jobs"]:
            if job.get("target") != attempts.DEADLINE or job["status"] in attempts.TERMINAL:
                continue
            observed = next((farm.observations[job["id"]] for farm in self.farms.values() if job["id"] in farm.observations), None)
            if observed:
                job["farmProgress"] = dict(observed)
        return project

    def ingest(self, attempt):
        store = self.store.for_project(attempt["project_id"])
        media = self.media.for_project(store, attempt["project_id"])
        if store.attempt(attempt["id"])["status"] == attempts.COMPLETE:
            return False
        path = media.receipt_path(attempt)
        try:
            result = receipts.verify(attempt, path, media)
            result = media.review_receipt(result, attempt["request"].get("sequenceFps", 24))
            result["dispatch"] = store.dispatch_record(attempt["id"])
            sidecars.write_result(store, media, attempt, result)
            return store.accept_execution(attempt["id"], attempt["prompt_id"], None, result)
        except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
            store.transition(attempt["id"], attempts.COLLECTION_PENDING, error=str(error))
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
        projects = store.list()
        project_id = projects[0]["id"] if projects else None
        media = self.media.for_project(store, project_id)
        farm = self.farms.setdefault(str(store.root), FarmCollector(store, media))
        for attempt in store.scan_attempts():
            if attempts.target_of(attempt["request"]) == attempts.DEADLINE:
                try:
                    farm.collect(attempt)
                except (ValueError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
                    store.transition(attempt["id"], attempts.COLLECTION_PENDING, error=str(error))
                continue
            path = media.receipt_path(attempt)
            if not path.is_file() or attempt["status"] == attempts.COMPLETE:
                continue
            self.ingest(attempt)
        if media.project_id:
            self.folders.scan(store, media, project_id)

    async def lifecycle(self, app):
        task = asyncio.create_task(self.run())
        yield
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def run(self):
        while True:
            try:
                await asyncio.to_thread(self.scan)
            except Exception:
                logging.exception("Spool receipt scan failed; evidence retained for retry")
            await asyncio.sleep(2)
