import asyncio
import json
import logging
import subprocess
from . import attempts, receipts, farm_protocol
from .media import check_frozen, contained
from .ownership import ExecutorLock, ExecutorBusy, executor_identity
from .requests import local_compatibility
from . import requests
from .store import uid, Conflict
from .collection import Collector
from .execution_targets import adapter_for


def workflow_metadata(extra_data):
    """The workflow id Comfy's own /prompt route attaches for its job history, when this Comfy has it."""
    try:
        from server import workflow_metadata_from_prompt
    except ImportError:
        return None
    return workflow_metadata_from_prompt(extra_data)


def verify_frozen_inputs(media, request, prompt):
    """Refuse dispatch when a hook changed a frozen dependency or its bytes changed since freezing."""
    for asset in request.get("assets", []):
        if prompt.get(asset["nodeId"], {}).get("inputs", {}).get(asset["input"]) != asset["frozen"]:
            raise ValueError("A host hook changed an explicitly frozen dependency")
        if "sha256" in asset:
            check_frozen(contained(media.host_roots["input"], asset["frozen"]), asset)


class LocalExecutor:
    def __init__(self, store, media, server, validate, schemas=None, configuration=None, progress=None):
        self.store, self.media, self.server, self.validate = store, media, server, validate
        self.lock = asyncio.Lock()
        self.identity = executor_identity(store.root)
        self.session_id = self.identity + uid()
        self.ownership = ExecutorLock(store.root)
        self.schemas = schemas
        self.configuration = configuration or {"roots": {k: str(v) for k, v in media.host_roots.items()}}
        self.managed = False
        self.disabled_reason = None
        self.collector = Collector(store, media)
        self.progress = progress
        self.pushed_progress = {}

    def notify_progress(self):
        """Progress is ephemeral: wake readers only when the observed values change."""
        notify = getattr(self.store, "project_changed", None)
        if not notify:
            return
        current = {}
        for store in self.store.project_stores():
            project_id = store.list()[0]["id"]
            state = store.sync_state(project_id)
            if not state["jobs"]:
                continue
            value = self.annotate_progress({"id": project_id, "document": {"jobs": state["jobs"]}})
            progress = json.dumps(value["document"]["jobs"], sort_keys=True)
            current[project_id] = progress
            if self.pushed_progress.get(project_id) != progress:
                notify({"projectId": project_id, "revision": state["revision"], "cursor": state["cursor"]})
        self.pushed_progress = current

    def annotate_progress(self, project):
        self.collector.annotate_progress(project)
        observed = self.progress() if self.progress else None
        if not observed:
            return project
        for job in project["document"]["jobs"]:
            if (
                job["status"] not in {attempts.RUNNING, attempts.QUEUED, attempts.DISPATCHING}
                or job["promptId"] != observed["promptId"]
                or job.get("target") != attempts.LOCAL
            ):
                continue
            request = self.store.for_project(project["id"]).attempt(job["id"])["request"]
            job["status"] = attempts.RUNNING
            job["nodeProgress"] = [
                {
                    **node,
                    "label": request["prompt"].get(node["id"], {}).get("_meta", {}).get("title")
                    or request["prompt"].get(node["id"], {}).get("class_type")
                    or node["id"],
                }
                for node in observed["nodes"]
            ]
        return project

    async def queue(self, project_id, revision, items, operation_id=None, actor="human"):
        store = self.store.for_project(project_id)
        media = self.media.for_project(store, project_id)
        async with self.lock:
            project = await asyncio.to_thread(
                requests.accept,
                store,
                media,
                project_id,
                revision,
                items,
                operation_id,
                actor,
            )
            if self.disabled_reason:
                return project
            for job in project["document"]["jobs"]:
                if job["status"] in {attempts.INTENT, attempts.WAITING}:
                    await self.dispatch(await asyncio.to_thread(store.attempt, job["id"]))
            return await asyncio.to_thread(store.get, project_id)

    async def dispatch(self, attempt):
        """Hand one frozen attempt to this Comfy's queue or to Deadline.

        Both targets pass the same host checks first: Comfy's prompt hooks and
        validation, unchanged frozen files and isolated saver paths. Comfy's hooks
        and validation run on the event loop, as they do for Comfy's own /prompt
        route. Storage and file hashing run in worker threads: a project folder on
        a network share may wait up to 30 s for its lock.
        """
        target = attempts.target_of(attempt["request"])
        if self.disabled_reason or target == attempts.CLOUD:
            return
        store = self.store.for_project(attempt["project_id"])
        media = self.media.for_project(store, attempt["project_id"])
        request = attempt["request"]
        if self.managed and (await asyncio.to_thread(self.store.host))["sessionId"] != self.session_id:
            raise RuntimeError("Spool executor ownership changed")
        if not await asyncio.to_thread(store.claim, attempt["id"], self.session_id):
            return

        observed = attempts.DISPATCHING  # claim atomically moved the intent.

        async def transition(status, **kwargs):
            nonlocal observed
            changed = await asyncio.to_thread(store.transition, attempt["id"], status, expected=observed, **kwargs)
            if changed:
                observed = status
            return changed

        try:
            adapter = adapter_for(request)
            prepared = adapter.prepare(attempt, {})
            package = prepared.get("package")
            if package is not None:
                submission = await asyncio.to_thread(store.submission, attempt["id"], package)
                package["submissionId"] = submission["id"]
            payload = prepared["payload"]
            payload = self.server.trigger_on_prompt(payload)
            prompt = payload["prompt"]
            self.server.node_replace_manager.apply_replacements(prompt)
            local_compatibility(
                {k: v for k, v in prompt.items() if k not in prepared["omit"]},
                request["capture"]["result"],
            )
            targets = (
                [request["capture"]["result"]["nodeId"]]
                if prepared["resultOnly"]
                else payload.get("partial_execution_targets")
            )
            valid = await self.validate(attempt["prompt_id"], prompt, targets)
            await asyncio.to_thread(
                store.dispatched,
                attempt["id"],
                payload,
                {"valid": valid[0], "acceptedOutputs": valid[2], "nodeErrors": valid[3], "error": valid[1]},
            )
            expected_output = prepared["output"]
            if not valid[0] or expected_output not in valid[2]:
                await transition(attempts.FAILED, error=json.dumps({"error": valid[1], "nodeErrors": valid[3]}))
                return
            if farm_protocol.semantic_prompt(prompt) != farm_protocol.semantic_prompt(request["prompt"]):
                await transition(
                    attempts.FAILED,
                    error="A host hook changed the frozen workflow. Apply a compatible graph before generating.",
                )
                return
            for check in prepared["checks"]:
                checked = await self.validate(
                    attempt["prompt_id"], {k: v for k, v in prompt.items() if k not in check["omit"]}, [check["output"]]
                )
                if not checked[0] or check["output"] not in checked[2]:
                    await transition(attempts.FAILED, error=check["error"] + json.dumps(checked[1]))
                    return
            await asyncio.to_thread(verify_frozen_inputs, media, request, prompt)
            if not await transition(
                attempts.DISPATCHING, result={"validation": {"acceptedOutputs": valid[2], "nodeErrors": valid[3]}}
            ):
                return
            if prepared["submitStatus"] != attempts.DISPATCHING and not await transition(prepared["submitStatus"]):
                return
            submitted = await adapter.submit(
                attempt, {**prepared, "server": self.server, "payload": payload, "valid": valid}
            )
            if "jobId" in submitted:
                await asyncio.to_thread(store.acknowledge, package["submissionId"], submitted["jobId"])
            await transition(submitted["status"])
        except Exception as error:
            await transition(attempts.UNCERTAIN, error=str(error))
            logging.exception("Spool dispatch needs reconciliation")

    def pending_attempts(self):
        """Pending local and Deadline attempts with their project media."""
        found = []
        for store in self.store.project_stores():
            pending = store.pending()
            if not pending:
                continue
            media = self.media.for_project(store, store.list()[0]["id"])
            for attempt_id in pending:
                attempt = store.attempt(attempt_id)
                if attempts.target_of(attempt["request"]) != attempts.CLOUD:
                    found.append((store, media, attempt))
        return found

    def observe(self, store, media, attempt, running_ids, pending_ids):
        """Record what Comfy reports for one local attempt; True when it still needs dispatch."""
        attempt_id = attempt["id"]
        observed = attempt["status"]

        def transition(status, **kwargs):
            nonlocal observed
            changed = store.transition(attempt_id, status, expected=observed, **kwargs)
            if changed:
                observed = status
            return changed

        receipt_file = media.receipt_path(attempt)
        observation = asyncio.run(
            adapter_for(attempt["request"]).observe(
                attempt,
                {
                    "server": self.server,
                    "receipt": receipt_file,
                    "running": running_ids,
                    "pending": pending_ids,
                },
            )
        )
        history = observation.get("history")
        if history:
            transition(
                attempts.COLLECTING,
                result={"history": history, "dispatch": store.dispatch_record(attempt_id)},
            )
            try:
                if not receipt_file.is_file():
                    artifacts, primary = media.collect(attempt, history, False)
                    receipts.write(receipt_file.parent, attempt, artifacts, primary, history)
                self.collector.ingest(attempt)
            except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
                transition(attempts.COLLECTION_PENDING, error=str(error))
        elif "status" in observation:
            transition(observation["status"], **{k: v for k, v in observation.items() if k != "status"})
        elif observation.get("dispatch"):
            return True
        elif (store.owner(attempt_id) or "").startswith(self.identity):
            transition(
                attempts.UNCERTAIN,
                error="Prompt absent from queue/history. Computation may have stopped or history was cleared. No automatic redispatch.",
            )
        return False

    async def reconcile(self):
        if self.disabled_reason:
            return
        async with self.lock:
            running, pending = self.server.prompt_queue.get_current_queue()
            running_ids, pending_ids = {x[1] for x in running}, {x[1] for x in pending}
            for store, media, attempt in await asyncio.to_thread(self.pending_attempts):
                if attempts.target_of(attempt["request"]) == attempts.DEADLINE:
                    if attempt["status"] in {attempts.INTENT, attempts.WAITING}:
                        await self.dispatch(attempt)
                    continue
                if await asyncio.to_thread(self.observe, store, media, attempt, running_ids, pending_ids):
                    await self.dispatch(attempt)

    async def poll(self, app):
        task = None
        try:
            try:
                self.ownership.acquire()
                definitions = await self.schemas() if self.schemas else {}
                self.store.publish_host(self.configuration, self.session_id, definitions)
            except (ExecutorBusy, Conflict) as error:
                self.ownership.close()
                owner = self.store.host()["configuration"] or {}
                self.disabled_reason = str(error) + " Paired Comfy: " + owner.get("comfyUrl", "not recorded")
                logging.warning(
                    "Spool queue dispatch disabled in this instance: %s Comfy will start normally.",
                    self.disabled_reason,
                )
                yield
                return
            self.managed = True
            task = asyncio.create_task(self.run())
            yield
        finally:
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            if self.managed:
                self.store.retire_host(self.session_id)
            self.managed = False
            self.ownership.close()

    async def run(self):
        while True:
            try:
                if self.managed:
                    await asyncio.to_thread(self.store.publish_host, self.configuration, self.session_id)
                await self.reconcile()
                await asyncio.to_thread(self.collector.scan)
                await asyncio.to_thread(self.notify_progress)
            except Exception:
                logging.exception("Spool reconciliation failed; saved attempts remain pending")
            await asyncio.sleep(2)
