"""Comfy Developer Platform execution over the official asynchronous SDK."""

import asyncio
import copy
import hashlib
import os
import logging
from pathlib import Path
from urllib.parse import urlsplit

try:
    from comfy_sdk import AsyncComfy, InvalidWorkflow, Unauthorized, Forbidden, InsufficientCredits
except ImportError:  # Comfy Cloud is optional; editing and local generation still load.
    AsyncComfy = None

    class InvalidWorkflow(Exception):
        pass

    Unauthorized = Forbidden = InsufficientCredits = InvalidWorkflow

from . import attempts, receipts
from .credentials import cloud_key
from .ownership import ExecutorLock, ExecutorBusy
from .store import uid
from .execution_targets import adapter_for


FREE_TIER = "Running on Comfy Cloud needs a plan that allows API keys. To pay with Comfy credits instead, choose Execute on: Local ComfyUI · Partner Nodes."
UNAVAILABLE = "Comfy Cloud needs the comfy-sdk Python package. Install it into the Python that runs ComfyUI (python -m pip install comfy-sdk), then restart ComfyUI."


def available():
    return AsyncComfy is not None


def endpoint():
    value = os.environ.get("COMFY_BASE_URL", "").strip() or "https://cloud.comfy.org"
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Use a Comfy Cloud or deployment URL without embedded credentials in COMFY_BASE_URL")
    return value.rstrip("/")


def execution_prompt(prompt, output):
    graph = copy.deepcopy(prompt)

    def constant(value):
        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] in graph:
            node = graph[value[0]]
            if node["class_type"].startswith("Primitive"):
                return constant(node["inputs"]["value"])
        return value

    def resolve(value, seen=()):
        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] in graph:
            node = graph[value[0]]
            if node["class_type"] == "ComfySwitchNode" and value[0] not in seen:
                choice = constant(node["inputs"]["switch"])
                if type(choice) is bool:
                    return resolve(node["inputs"]["on_true" if choice else "on_false"], (*seen, value[0]))
        return value

    for node in graph.values():
        node["inputs"] = {k: resolve(v) for k, v in node["inputs"].items()}
    reachable = set()

    def visit(identity):
        if identity in reachable:
            return
        reachable.add(identity)
        for value in graph[identity]["inputs"].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] in graph:
                visit(value[0])

    visit(output)
    return {k: v for k, v in graph.items() if k in reachable}


async def storage_call(function, *args, **kwargs):
    # Cancellation must not leave a SQLite/file operation running after the
    # server releases its executor lock or closes the project workspace.
    task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


class CloudExecutor:
    def __init__(self, store, media, collector):
        self.store, self.media, self.collector = store, media, collector
        self.session_id = uid()
        root = store.root / "cloud-executor"
        root.mkdir(exist_ok=True)
        self.ownership = ExecutorLock(root)
        self.limit = asyncio.Semaphore(4)
        self.adapter = adapter_for({"target": attempts.CLOUD})

    async def observe(self, attempt):
        async with self.limit:
            await self._observe(attempt)

    async def _observe(self, attempt):
        def context():
            store = self.store.for_project(attempt["project_id"])
            media = self.media.for_project(store, attempt["project_id"])
            return store, media, store.setting("cloud:" + attempt["id"]), media.receipt_path(attempt).is_file()

        store, media, state, has_receipt = await storage_call(context)
        observed = attempt["status"]

        async def transition(status, **kwargs):
            nonlocal observed
            changed = await storage_call(store.transition, attempt["id"], status, expected=observed, **kwargs)
            if changed:
                observed = status
            return changed

        if has_receipt:
            await storage_call(self.collector.ingest, attempt)
            return
        if attempt["status"] in attempts.TERMINAL:
            return
        recovery = self.adapter.recover(attempt, {"state": state})
        if not recovery.get("observe"):
            if "status" in recovery:
                await transition(recovery["status"], error=recovery["error"])
            return
        key = await storage_call(cloud_key)
        if not key or not available():
            return  # Accepted intents wait for a key and the SDK; their frozen inputs remain intact.
        try:
            address = endpoint()
            self.adapter.recover(attempt, {"state": state, "address": address})
            client = await storage_call(lambda: AsyncComfy(api_key=key))
            async with client:
                if state:
                    job = (await self.adapter.observe(attempt, {"client": client, "state": state, "key": key}))["job"]
                elif attempt["status"] in (attempts.INTENT, attempts.WAITING):
                    if not await storage_call(store.claim, attempt["id"], self.session_id):
                        return
                    observed = attempts.DISPATCHING
                    workflow = await storage_call(self.prepare_submission, store, media, attempt, client, address)
                    if (await storage_call(store.attempt, attempt["id"]))["status"] != attempts.DISPATCHING:
                        return
                    # The constructor authenticates the deployment. api_key on
                    # submit authenticates its Partner Nodes through extra_data.
                    submitted = await self.adapter.submit(
                        attempt, {"client": client, "workflow": workflow, "key": key, "address": address}
                    )
                    job, state = submitted["job"], submitted["state"]
                    await storage_call(store.set_setting, "cloud:" + attempt["id"], state)
                observed = (await storage_call(store.attempt, attempt["id"]))["status"]
                if observed == attempts.CANCEL_REQUESTED:
                    cancelled = await self.adapter.cancel(attempt, {"stage": "send", "job": job, "state": state})
                    job = cancelled["job"]
                    if cancelled["sent"]:
                        state["cancelSent"] = True
                        await storage_call(store.set_setting, "cloud:" + attempt["id"], state)
                observation = await self.adapter.observe(attempt, {"job": job, "key": key, "status": observed})
                if "status" in observation:
                    await transition(
                        observation["status"], **({"error": observation["error"]} if "error" in observation else {})
                    )
                if observation.get("collect"):
                    await self.collect(attempt, media, job, address)
                    await storage_call(self.collector.ingest, attempt)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # Only recorded job IDs permit observation/download retries after an ambiguous submit.
            recovery = self.adapter.recover(attempt, {"state": state, "key": key, "error": error})
            await transition(recovery["status"], error=recovery["error"])

    def prepare_submission(self, store, media, attempt, client, address):
        prepared = self.adapter.prepare(attempt, {"media": media, "client": client, "address": address})
        store.dispatched(attempt["id"], prepared["dispatch"], prepared["validation"])
        return prepared["workflow"]

    async def collect(self, attempt, media, job, address):
        selection = attempt["request"]["capture"]["result"]
        outputs = job.get_outputs(selection["nodeId"])
        if len(outputs) <= selection["index"]:
            raise ValueError("Comfy Cloud did not report the selected video output")
        output = outputs[selection["index"]]
        extension = Path(output.name).suffix.lower()
        if extension not in (".mp4", ".webm", ".mov", ".mkv"):
            raise ValueError("Comfy Cloud returned an unsupported video output")
        identity = uid()
        destination = await storage_call(media.result_path, attempt, identity, extension, True)
        await storage_call(destination.parent.mkdir, parents=True, exist_ok=True)
        pending = destination.with_suffix(extension + ".partial")
        try:
            await output.to_file(pending)
            await storage_call(
                self.finish_download, attempt, media, job, address, output, identity, destination, pending
            )
        finally:
            await storage_call(pending.unlink, missing_ok=True)

    def finish_download(self, attempt, media, job, address, output, identity, destination, pending):
        if pending.stat().st_size != output.size_bytes:
            raise ValueError("Comfy Cloud video download is incomplete")
        pending.replace(destination)
        selection = attempt["request"]["capture"]["result"]
        with destination.open("rb") as handle:
            checksum = hashlib.file_digest(handle, "sha256").hexdigest()
        artifact = {
            "id": identity,
            "artifactId": identity,
            **selection,
            "file": destination.relative_to(media.root).as_posix(),
            "originalFile": destination.relative_to(media.root).as_posix(),
            "byteSize": destination.stat().st_size,
            "sha256": checksum,
            "record": {"cloudJobId": job.id, "cloudOutputId": output.id},
        }
        directory = media.receipt_path(attempt).parent
        directory.mkdir(parents=True, exist_ok=True)
        history = {
            "status": {"completed": True, "status_str": "success"},
            "cloud": {"jobId": job.id, "endpoint": address},
        }
        receipts.write(directory, attempt, [artifact], artifact, history)

    async def run_once(self):
        pending = await storage_call(
            lambda: [
                a
                for store in self.store.project_stores()
                for a in store.scan_attempts(target="cloud", pending_only=True)
            ]
        )
        await asyncio.gather(*(self.observe(a) for a in pending))

    async def lifecycle(self, app):
        try:
            self.ownership.acquire()
        except ExecutorBusy:
            yield
            return

        async def run():
            while True:
                try:
                    await self.run_once()
                except Exception:
                    logging.exception("Spool Cloud reconciliation failed; saved attempts remain pending")
                await asyncio.sleep(2)

        task = asyncio.create_task(run())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            self.ownership.close()
