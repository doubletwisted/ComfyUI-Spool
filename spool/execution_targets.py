"""Execution target operations, without project-store writes.

prepare returns submission material, submit returns its acknowledgment, and observe
returns status/evidence. Callers own claims, durable checkpoints, guarded transitions
and receipt acceptance. cancel has check/plan/send stages so the command transaction
can recheck ownership before recording an external delivery. recover only looks up
existing work; it never resubmits. Context dictionaries contain target I/O dependencies
and already-read state, never a Store.
"""

import asyncio
import copy
import json
import re
import subprocess
import time
from typing import Protocol

from . import attempts, deadline_job
from .media import check_frozen, contained
from .credentials import cloud_key
from .store import Conflict


class ExecutionAdapter(Protocol):
    def prepare(self, attempt: dict, context: dict) -> dict: ...
    async def submit(self, attempt: dict, context: dict) -> dict: ...
    async def observe(self, attempt: dict, context: dict) -> dict: ...
    async def cancel(self, attempt: dict, context: dict) -> dict: ...
    def recover(self, attempt: dict, context: dict) -> dict: ...


def cancellation(attempt, target, submission=None):
    outcome = attempts.cancel_action(attempt["status"], target, bool(submission and submission["external_id"]))
    if outcome == "refused":
        if attempt["status"] in attempts.TERMINAL:
            raise ValueError("This job has already finished")
        if target == attempts.LOCAL:
            raise ValueError(
                "Cancel a running local render from ComfyUI's queue; Spool records the outcome Comfy reports"
            )
        raise ValueError("Claimed work needs an owned Deadline job; resolve uncertain submission first")
    status = attempts.CANCELLED if outcome == "cancelled" else attempts.CANCEL_REQUESTED
    return {"status": status, "result": {"attemptId": attempt["id"], "status": status}}


class LocalAdapter:
    def prepare(self, attempt, context):
        request = attempt["request"]
        return {
            "payload": {
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
            },
            "output": request["capture"]["result"]["nodeId"],
            "submitStatus": attempts.DISPATCHING,
            "omit": [],
            "checks": [],
            "resultOnly": request["capture"].get("resultOnly", False),
        }

    async def submit(self, attempt, context):
        from .execution import workflow_metadata

        server, payload, valid = context["server"], context["payload"], context["valid"]
        number = server.number
        server.number += 1
        extra = payload.get("extra_data", {})
        extra.pop("workflow_metadata", None)
        if (metadata := workflow_metadata(extra)) is not None:
            extra["workflow_metadata"] = metadata
        extra["create_time"] = int(time.time() * 1000)
        sensitive = {}
        if api_key := cloud_key():
            sensitive["api_key_comfy_org"] = api_key
        server.prompt_queue.put((number, attempt["prompt_id"], payload["prompt"], extra, valid[2], sensitive))
        return {"status": attempts.QUEUED}

    async def observe(self, attempt, context):
        return await asyncio.to_thread(self._observe, attempt, context)

    def _observe(self, attempt, context):
        prompt_id = attempt["prompt_id"]
        history = context["server"].prompt_queue.get_history(prompt_id=prompt_id).get(prompt_id)
        if not history and attempt["result"]:
            history = json.loads(attempt["result"]).get("history")
        path = context["receipt"]
        if not history and path.is_file():
            try:
                history = json.loads(path.read_text(encoding="utf-8")).get("history")
            except (OSError, ValueError) as error:
                return {"status": attempts.COLLECTION_PENDING, "error": str(error)}
        if history:
            status = history.get("status", {})
            if not status.get("completed") or status.get("status_str") != "success":
                return {
                    "status": attempts.FAILED,
                    "result": {"history": history},
                    "error": "Workflow failed; partial outputs are retained in history",
                }
            return {"status": attempts.COLLECTING, "history": history}
        if prompt_id in context["running"]:
            return {"status": attempts.RUNNING}
        if prompt_id in context["pending"]:
            return {"status": attempts.QUEUED}
        return self.recover(attempt, {"absent": True})

    async def cancel(self, attempt, context):
        return cancellation(attempt, attempts.LOCAL) if context["stage"] == "plan" else {}

    def recover(self, attempt, context):
        if context.get("absent"):
            return {"dispatch": attempt["status"] in {attempts.INTENT, attempts.WAITING}}
        raise ValueError("This attempt has no Deadline submission")


class DeadlineAdapter(LocalAdapter):
    def prepare(self, attempt, context):
        prepared = super().prepare(attempt, context)
        request = attempt["request"]
        prepared.update(
            output=request["launcherNodeId"],
            submitStatus=attempts.SUBMITTING,
            omit=[request["launcherNodeId"]],
            resultOnly=False,
            checks=[
                {
                    "omit": [request["launcherNodeId"]],
                    "output": request["capture"]["result"]["nodeId"],
                    "error": "Selected worker output failed host validation: ",
                }
            ],
            package={
                "schemaVersion": 2,
                **{k: request[k] for k in ("projectId", "clipId", "takeId", "attemptId", "fingerprint")},
                "variationIndex": 0,
                "result": request["capture"]["result"],
                "assets": request["assets"],
                "resultRoot": request["prompt"][request["launcherNodeId"]]["inputs"]["output_directory"],
            },
        )
        return prepared

    async def submit(self, attempt, context):
        job_id = await asyncio.to_thread(deadline_job.submit, attempt["request"], context["package"])
        return {"status": attempts.FARM_QUEUED, "jobId": job_id}

    async def observe(self, attempt, context):
        return await asyncio.to_thread(self._observe_job, attempt, context)

    def _observe_job(self, attempt, context):
        from .farm import deadline_command

        try:
            observation = deadline_command(["-GetJob", context["jobId"], "true"])
        except (OSError, RuntimeError, subprocess.SubprocessError):
            observation = ""
        fields = dict(line.split("=", 1) for line in observation.splitlines() if "=" in line)
        tasks, result = {}, {}
        status = fields.get("JobStatus", fields.get("Status"))
        if attempt["status"] == attempts.CANCEL_REQUESTED and status != "Completed":
            if status in ("Failed", "Suspended"):
                result["status"] = attempts.CANCELLED
        elif status == "Active":
            try:
                task_state = deadline_command(["-GetJobTasks", context["jobId"], "true"])
            except (OSError, RuntimeError, subprocess.SubprocessError):
                task_state = ""
            tasks = dict(line.split("=", 1) for line in task_state.splitlines() if "=" in line)
            if tasks.get("TaskStatus", tasks.get("Status")) == "Rendering":
                result["status"] = attempts.FARM_RUNNING
            elif tasks.get("TaskStatus", tasks.get("Status")) in ("Queued", "Pending"):
                result["status"] = attempts.FARM_QUEUED
        elif status == "Rendering":
            result["status"] = attempts.FARM_RUNNING
        elif status == "Completed":
            result.update(
                status=attempts.COLLECTION_PENDING, error="Deadline completed; awaiting verified worker receipt"
            )
        elif status in ("Failed", "Suspended"):
            result.update(
                status=attempts.FARM_ATTENTION,
                error="Deadline job is " + status + "; operator action may be needed, no automatic resubmission",
            )
        if fields:
            progress = tasks.get("TaskProgress", tasks.get("Progress", fields.get("SingleTaskProgress", "")))
            match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*%\s*", progress)
            result["progress"] = {
                "percent": min(100, float(match[1])) if match else None,
                "worker": tasks.get("TaskSlaveName", tasks.get("SlaveName", "")),
                "message": tasks.get("TaskRenderStatus", tasks.get("RenderStatus", "")),
                "observedAt": time.time(),
            }
        return result

    async def cancel(self, attempt, context):
        from . import farm

        stage, submission = context["stage"], context.get("submission")
        if stage == "send":
            await asyncio.to_thread(farm.fail_job, context["jobId"])
            return {}
        if stage == "check":
            if attempt["status"] in {attempts.INTENT, attempts.WAITING, *attempts.TERMINAL}:
                return {}
            if not submission or not submission["external_id"]:
                raise ValueError("Claimed work needs an owned Deadline job; resolve uncertain submission first")
            done = context["done"]
            try:
                owner = submission["id"] if done else farm.job_value(submission["external_id"], "SpoolSubmissionId")
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                raise ValueError(
                    "Cancellation was not sent; retry Cancel request after the Deadline lookup recovers: " + str(error)
                ) from error
            if owner != submission["id"]:
                raise ValueError("Cancellation refused: external job ownership did not match; no cancellation was sent")
            return {"delivery": (submission["id"], submission["external_id"])} if not done else {}
        plan = cancellation(attempt, attempts.DEADLINE, submission)
        if plan["status"] == attempts.CANCELLED:
            return plan
        note = "Cancellation requested; late results remain collectable"
        if not context["done"]:
            if context["delivery"] != (submission["id"], submission["external_id"]):
                raise Conflict("Deadline job changed during cancellation ownership lookup; retry Cancel request")
            plan["claim"] = True
            note = "Cancellation delivery is unconfirmed; retry Cancel request to confirm delivery."
            plan["error"] = note
        else:
            plan["transition"] = False
        plan["result"].update(jobId=submission["external_id"], submissionId=submission["id"], note=note)
        return plan

    def recover(self, attempt, context):
        from . import farm

        submission = context.get("submission")
        if not submission:
            raise ValueError("This attempt has no Deadline submission")
        found = farm.submission_jobs(submission["id"])
        if len(found) > 1:
            raise Conflict("Multiple jobs match; operator resolution required")
        if found and (
            farm.job_value(found[0], "SpoolSubmissionId") != submission["id"]
            or farm.job_value(found[0], "SpoolAttemptId") != attempt["id"]
        ):
            raise ValueError("Deadline job identity failed ownership verification")
        return {"jobId": found[0] if found else None}


class CloudAdapter:
    def prepare(self, attempt, context):
        from .cloud import execution_prompt

        request, client, media = attempt["request"], context["client"], context["media"]
        workflow = client.workflows.from_json(
            execution_prompt(request["prompt"], request["capture"]["result"]["nodeId"])
        )
        for asset in request.get("assets", []):
            if asset["nodeId"] not in workflow.json:
                continue
            path = contained(media.host_roots["input"], asset["frozen"])
            check_frozen(path, asset, "A frozen Cloud input changed before submission")
            workflow.set_input(asset["nodeId"], asset["input"], client.assets.from_file(path))
        return {
            "workflow": workflow,
            "dispatch": {"target": "cloud", "endpoint": context["address"], "idempotencyKey": attempt["id"]},
            "validation": {"selectedOutput": request["capture"]["result"]},
        }

    async def submit(self, attempt, context):
        job = await context["client"].submit(context["workflow"], api_key=context["key"], idempotency_key=attempt["id"])
        return {"job": job, "state": {"jobId": job.id, "endpoint": context["address"]}}

    async def observe(self, attempt, context):
        job = context.get("job")
        if job is None:
            job = await context["client"].jobs.get(context["state"]["jobId"])
        result = {"job": job}
        if job.status == "succeeded":
            result.update(status=attempts.COLLECTING, collect=True)
        elif job.status in ("failed", "expired", "canceled"):
            result.update(
                status=attempts.FAILED if job.status in ("failed", "expired") else attempts.CANCELLED,
                error=str(job.error).replace(context["key"], "[redacted]") if job.error else None,
            )
        elif context.get("status") != attempts.CANCEL_REQUESTED:
            result["status"] = attempts.RUNNING if job.status == "running" else attempts.QUEUED
        return result

    async def cancel(self, attempt, context):
        if context["stage"] == "send":
            job = context["job"]
            if job.status in ("succeeded", "failed", "expired", "canceled") or context["state"].get("cancelSent"):
                return {"job": job, "sent": False}
            return {"job": await job.cancel(), "sent": True}
        if context["stage"] == "plan":
            plan = cancellation(attempt, attempts.CLOUD)
            if plan["status"] == attempts.CANCEL_REQUESTED:
                plan["result"]["target"] = "cloud"
            return plan
        return {}

    def recover(self, attempt, context):
        from .cloud import InvalidWorkflow, Unauthorized, Forbidden, InsufficientCredits, FREE_TIER

        if "error" in context:
            error, key = context["error"], context["key"]
            status = (
                attempts.COLLECTION_PENDING
                if context["state"]
                else attempts.FAILED
                if isinstance(error, (InvalidWorkflow, Unauthorized, Forbidden, InsufficientCredits, ValueError))
                else attempts.UNCERTAIN
            )
            message = str(error).replace(key, "[redacted]")
            if isinstance(error, Forbidden) and "free tier" in message.lower():
                message += " " + FREE_TIER
            return {"status": status, "error": message}
        if "state" not in context:
            raise ValueError("This attempt has no Deadline submission")
        state = context["state"]
        if state and "address" in context and state["endpoint"] != context["address"]:
            raise ValueError("Restore COMFY_BASE_URL to " + state["endpoint"] + " to observe this Cloud job")
        if state or attempt["status"] in (attempts.INTENT, attempts.WAITING):
            return {"observe": True}
        if attempt["status"] == attempts.CANCEL_REQUESTED:
            return {
                "status": attempts.CANCELLED,
                "error": "Cancelled before Spool recorded a Comfy Cloud job ID. If Cloud ran it, Spool will not collect the result.",
            }
        if attempt["status"] != attempts.UNCERTAIN:
            return {
                "status": attempts.UNCERTAIN,
                "error": "Cloud submission was interrupted before its job ID was recorded. No automatic resubmission.",
            }
        return {}


def adapter_for(request, submission=None) -> ExecutionAdapter:
    return {attempts.LOCAL: LocalAdapter, attempts.DEADLINE: DeadlineAdapter, attempts.CLOUD: CloudAdapter}[
        attempts.target_of(request, submission)
    ]()
