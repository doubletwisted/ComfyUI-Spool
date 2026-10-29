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
from .media import check_frozen, contained
from .ownership import ExecutorLock, ExecutorBusy
from .store import uid


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


async def storage_call(function, *args):
    # Cancellation must not leave a SQLite/file operation running after the
    # server releases its executor lock or closes the project workspace.
    task = asyncio.create_task(asyncio.to_thread(function, *args))
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

    async def observe(self, attempt):
        async with self.limit:
            await self._observe(attempt)

    async def _observe(self, attempt):
        store = self.store.for_project(attempt["project_id"])
        media = self.media.for_project(store, attempt["project_id"])
        request = attempt["request"]
        state = store.setting("cloud:" + attempt["id"])
        if media.receipt_path(attempt).is_file():
            await storage_call(self.collector.ingest, attempt)
            return
        if attempt["status"] in attempts.TERMINAL:
            return
        if not state and attempt["status"] not in (attempts.INTENT, attempts.WAITING):
            if attempt["status"] == attempts.CANCEL_REQUESTED:
                # No job ID was recorded, so there is no Cloud job Spool could stop or collect.
                store.transition(
                    attempt["id"],
                    attempts.CANCELLED,
                    error="Cancelled before Spool recorded a Comfy Cloud job ID. If Cloud ran it, Spool will not collect the result.",
                )
            elif attempt["status"] != attempts.UNCERTAIN:
                store.transition(
                    attempt["id"],
                    attempts.UNCERTAIN,
                    error="Cloud submission was interrupted before its job ID was recorded. No automatic resubmission.",
                )
            return
        key = cloud_key()
        if not key or not available():
            return  # Accepted intents wait for a key and the SDK; their frozen inputs remain intact.
        try:
            address = endpoint()
            if state and state["endpoint"] != address:
                raise ValueError("Restore COMFY_BASE_URL to " + state["endpoint"] + " to observe this Cloud job")
            client = await storage_call(lambda: AsyncComfy(api_key=key))
            async with client:
                if state:
                    job = await client.jobs.get(state["jobId"])
                elif attempt["status"] in (attempts.INTENT, attempts.WAITING):
                    if not store.claim(attempt["id"], self.session_id):
                        return
                    workflow = client.workflows.from_json(
                        execution_prompt(request["prompt"], request["capture"]["result"]["nodeId"])
                    )
                    # Submit only ancestors of the explicitly selected output.
                    # Intermediate SaveText/SaveVideo branches must not incur
                    # additional API generations on the Cloud deployment.
                    for asset in request.get("assets", []):
                        if asset["nodeId"] not in workflow.json:
                            continue
                        path = contained(media.host_roots["input"], asset["frozen"])
                        check_frozen(path, asset, "A frozen Cloud input changed before submission")
                        workflow.set_input(asset["nodeId"], asset["input"], client.assets.from_file(path))
                    store.dispatched(
                        attempt["id"],
                        {"target": "cloud", "endpoint": address, "idempotencyKey": attempt["id"]},
                        {"selectedOutput": request["capture"]["result"]},
                    )
                    # The constructor authenticates the deployment. api_key on
                    # submit authenticates its Partner Nodes through extra_data.
                    job = await client.submit(workflow, api_key=key, idempotency_key=attempt["id"])
                    state = {"jobId": job.id, "endpoint": address}
                    store.set_setting("cloud:" + attempt["id"], state)
                if (
                    store.attempt(attempt["id"])["status"] == "cancel_requested"
                    and job.status not in ("succeeded", "failed", "expired", "canceled")
                    and not state.get("cancelSent")
                ):
                    job = await job.cancel()
                    state["cancelSent"] = True
                    store.set_setting("cloud:" + attempt["id"], state)
                if job.status == "succeeded":
                    store.transition(attempt["id"], attempts.COLLECTING)
                    await self.collect(attempt, media, job, address)
                    await storage_call(self.collector.ingest, attempt)
                elif job.status in ("failed", "expired", "canceled"):
                    store.transition(
                        attempt["id"],
                        attempts.FAILED if job.status in ("failed", "expired") else attempts.CANCELLED,
                        error=str(job.error).replace(key, "[redacted]") if job.error else None,
                    )
                elif store.attempt(attempt["id"])["status"] != "cancel_requested":
                    store.transition(attempt["id"], attempts.RUNNING if job.status == "running" else attempts.QUEUED)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # A submit timeout may already have incurred a charge. Only a
            # recorded job ID permits automatic observation/download retries.
            status = (
                attempts.COLLECTION_PENDING
                if state
                else attempts.FAILED
                if isinstance(error, (InvalidWorkflow, Unauthorized, Forbidden, InsufficientCredits, ValueError))
                else attempts.UNCERTAIN
            )
            message = str(error).replace(key, "[redacted]")
            if isinstance(error, Forbidden) and "free tier" in message.lower():
                message += " " + FREE_TIER
            store.transition(attempt["id"], status, error=message)

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
        destination = media.result_path(attempt, identity, extension, True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        pending = destination.with_suffix(extension + ".partial")
        try:
            await output.to_file(pending)
            if pending.stat().st_size != output.size_bytes:
                raise ValueError("Comfy Cloud video download is incomplete")
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)
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
        await storage_call(receipts.write, directory, attempt, [artifact], artifact, history)

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
