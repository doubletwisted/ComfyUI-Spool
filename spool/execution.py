import asyncio
import copy
import json
import logging
import subprocess
import time
from . import attempts, receipts, deadline_job, farm_protocol
from .media import check_frozen, contained
from .ownership import ExecutorLock, ExecutorBusy, executor_identity
from .requests import local_compatibility
from . import requests
from .store import uid, Conflict
from .collection import Collector
from .credentials import cloud_key


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

    async def queue(self, project_id, revision, clip_ids, count, operation_id=None, actor="human", items=None):
        store = self.store.for_project(project_id)
        media = self.media.for_project(store, project_id)
        async with self.lock:
            project = await asyncio.to_thread(
                requests.accept,
                store,
                media,
                project_id,
                revision,
                items or [{"clipId": c, "count": count} for c in clip_ids],
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

        async def transition(*args, **kwargs):
            await asyncio.to_thread(store.transition, attempt["id"], *args, **kwargs)

        try:
            farm = target == attempts.DEADLINE
            package = await self._deadline_package(store, attempt) if farm else None
            payload = {
                "prompt": copy.deepcopy(request["prompt"]),
                "prompt_id": attempt["prompt_id"],
                "extra_data": {
                    "extra_pnginfo": {
                        "workflow": request["capture"].get("workflow") or {},
                        "spool": {
                            "attempt_id": attempt["id"],
                            "take_id": attempt["take_id"],
                            "fingerprint": request["fingerprint"],
                        },
                    }
                },
            }
            payload = self.server.trigger_on_prompt(payload)
            prompt = payload["prompt"]
            self.server.node_replace_manager.apply_replacements(prompt)
            local_compatibility(
                {k: v for k, v in prompt.items() if not farm or k != request["launcherNodeId"]},
                request["capture"]["result"],
            )
            targets = (
                [request["capture"]["result"]["nodeId"]]
                if request["capture"].get("resultOnly") and not farm
                else payload.get("partial_execution_targets")
            )
            valid = await self.validate(attempt["prompt_id"], prompt, targets)
            await asyncio.to_thread(
                store.dispatched,
                attempt["id"],
                payload,
                {"valid": valid[0], "acceptedOutputs": valid[2], "nodeErrors": valid[3], "error": valid[1]},
            )
            expected_output = request["launcherNodeId"] if farm else request["capture"]["result"]["nodeId"]
            if not valid[0] or expected_output not in valid[2]:
                await transition(attempts.FAILED, error=json.dumps({"error": valid[1], "nodeErrors": valid[3]}))
                return
            if farm_protocol.semantic_prompt(prompt) != farm_protocol.semantic_prompt(request["prompt"]):
                await transition(
                    attempts.FAILED,
                    error="A host hook changed the frozen workflow. Apply a compatible graph before generating.",
                )
                return
            if farm and (problem := await self._deadline_problem(attempt, prompt)):
                await transition(attempts.FAILED, error=problem)
                return
            await asyncio.to_thread(verify_frozen_inputs, media, request, prompt)
            await transition(
                attempts.DISPATCHING, result={"validation": {"acceptedOutputs": valid[2], "nodeErrors": valid[3]}}
            )
            if farm:
                await self._submit_deadline(store, attempt, package, transition)
            else:
                await self._submit_local(attempt, payload, prompt, valid, transition)
        except Exception as error:
            await transition(attempts.UNCERTAIN, error=str(error))
            logging.exception("Spool dispatch needs reconciliation")

    async def _deadline_package(self, store, attempt):
        """The immutable package the Deadline job script verifies; recording it marks the submission."""
        request = attempt["request"]
        launcher = request["launcherNodeId"]
        package = {
            "schemaVersion": 2,
            **{k: request[k] for k in ("projectId", "clipId", "takeId", "attemptId", "fingerprint")},
            "variationIndex": 0,
            "result": request["capture"]["result"],
            "assets": request["assets"],
            "resultRoot": request["prompt"][launcher]["inputs"]["output_directory"],
        }
        submission = await asyncio.to_thread(store.submission, attempt["id"], package)
        package["submissionId"] = submission["id"]
        return package

    async def _deadline_problem(self, attempt, prompt):
        """Why a Deadline workflow cannot leave this host, after Comfy's hooks ran, or None."""
        request = attempt["request"]
        worker_prompt = {k: v for k, v in prompt.items() if k != request["launcherNodeId"]}
        worker_validation = await self.validate(
            attempt["prompt_id"], worker_prompt, [request["capture"]["result"]["nodeId"]]
        )
        if not worker_validation[0] or request["capture"]["result"]["nodeId"] not in worker_validation[2]:
            return "Selected worker output failed host validation: " + json.dumps(worker_validation[1])
        return None

    async def _submit_deadline(self, store, attempt, package, transition):
        await transition(attempts.SUBMITTING)
        job_id = await asyncio.to_thread(deadline_job.submit, attempt["request"], package)
        await asyncio.to_thread(store.acknowledge, package["submissionId"], job_id)
        await transition(attempts.FARM_QUEUED)

    async def _submit_local(self, attempt, payload, prompt, valid, transition):
        number = self.server.number
        self.server.number += 1
        extra = payload.get("extra_data", {})
        # Mirror Comfy's /prompt handler (0.42): derived workflow metadata and a creation time.
        extra.pop("workflow_metadata", None)
        if (metadata := workflow_metadata(extra)) is not None:
            extra["workflow_metadata"] = metadata
        extra["create_time"] = int(time.time() * 1000)
        # Comfy merges this private slot into extra_data for execution and
        # removes it from queue/history responses. Never persist the key.
        sensitive = {}
        if api_key := cloud_key():
            sensitive["api_key_comfy_org"] = api_key
        self.server.prompt_queue.put((number, attempt["prompt_id"], prompt, extra, valid[2], sensitive))
        await transition(attempts.QUEUED)

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
        attempt_id, prompt_id = attempt["id"], attempt["prompt_id"]
        history = self.server.prompt_queue.get_history(prompt_id=prompt_id).get(prompt_id)
        if not history and attempt["result"]:
            history = json.loads(attempt["result"]).get("history")
        receipt_file = media.receipt_path(attempt)
        if not history and receipt_file.is_file():
            try:
                history = json.loads(receipt_file.read_text(encoding="utf-8")).get("history")
            except (OSError, ValueError) as error:
                store.transition(attempt_id, attempts.COLLECTION_PENDING, error=str(error))
                return False
        if history:
            status = history.get("status", {})
            if not status.get("completed") or status.get("status_str") != "success":
                store.transition(
                    attempt_id,
                    attempts.FAILED,
                    result={"history": history},
                    error="Workflow failed; partial outputs are retained in history",
                )
                return False
            store.transition(
                attempt_id,
                attempts.COLLECTING,
                result={"history": history, "dispatch": store.dispatch_record(attempt_id)},
            )
            try:
                if not receipt_file.is_file():
                    artifacts, primary = media.collect(attempt, history, False)
                    receipts.write(receipt_file.parent, attempt, artifacts, primary, history)
                self.collector.ingest(attempt)
            except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
                store.transition(attempt_id, attempts.COLLECTION_PENDING, error=str(error))
        elif prompt_id in running_ids:
            store.transition(attempt_id, attempts.RUNNING)
        elif prompt_id in pending_ids:
            store.transition(attempt_id, attempts.QUEUED)
        elif attempt["status"] in {attempts.INTENT, attempts.WAITING}:
            return True
        elif (store.owner(attempt_id) or "").startswith(self.identity):
            store.transition(
                attempt_id,
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
            except Exception:
                logging.exception("Spool reconciliation failed; saved attempts remain pending")
            await asyncio.sleep(2)
