"""Deadline observations and verified ingestion; never infer media from task order."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from . import attempts, farm_protocol, sidecars
from .media import contained


class FarmCollector:
    def __init__(self, store, media):
        self.store, self.media = store, media
        self.observed_at = {}
        self.observations = {}
        self.verified_receipts = {}

    def receipt_checkpoint(self, package, receipt, root):
        files = []
        for artifact in receipt["artifacts"]:
            path = farm_protocol.contained(root, artifact["path"])
            stat = path.stat()
            files.append((str(path), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
        evidence = json.dumps([package, receipt], sort_keys=True, allow_nan=False).encode()
        return hashlib.sha256(evidence).digest(), tuple(files)

    def collect(self, attempt):
        row = self.store.submission_for(attempt["id"])
        if not row or attempt["status"] == attempts.FAILED:
            return
        root = Path(attempt["request"]["prompt"][attempt["request"]["launcherNodeId"]]["inputs"]["output_directory"])
        directory = contained(root, "spool-submissions/" + row["id"])
        request_file, ack_file = directory / "request.json", directory / "ack.json"
        if not request_file.is_file():
            if attempt["status"] != attempts.COMPLETE and time.time() - attempt["created"] > 30:
                self.store.transition(attempt["id"], attempts.SUBMISSION_UNCERTAIN, error="No durable submission package or acknowledgment yet; no automatic resubmission")
            return
        package = json.loads(request_file.read_text(encoding="utf-8"))
        for key in ("projectId", "clipId", "takeId", "attemptId", "fingerprint"):
            if package[key] != attempt["request"][key]:
                raise ValueError("Staged package belongs to another Spool request")
        if package["submissionId"] != row["id"] or package["result"] != attempt["request"]["capture"]["result"]:
            raise ValueError("Staged package has a different submission or output selection")
        # Only the built-in stager's asset rewriting and removal of the launcher are allowed.
        expected = {k: json.loads(json.dumps(v)) for k, v in attempt["request"]["prompt"].items() if k != attempt["request"]["launcherNodeId"]}
        if len(package["assets"]) != len(attempt["request"].get("assets", [])):
            raise ValueError("Staged package lost a frozen dependency")
        for asset, original in zip(package["assets"], attempt["request"]["assets"]):
            if any(asset[k] != original[k] for k in ("nodeId", "input", "sha256", "byteSize")):
                raise ValueError("Staged package changed a frozen dependency")
            expected[asset["nodeId"]]["inputs"][asset["input"]] = asset["staged"]
        if farm_protocol.semantic_prompt(expected) != farm_protocol.semantic_prompt(package["stagedPrompt"]):
            raise ValueError("Staged package changed controls outside the declared asset transformations")
        ack = None
        if ack_file.is_file():
            ack = json.loads(ack_file.read_text(encoding="utf-8"))
            if any(ack.get(k) != package[k] for k in ("schemaVersion", "submissionId", "attemptId", "fingerprint")):
                raise ValueError("Submission acknowledgment belongs to another request")
            self.store.acknowledge(row["id"], ack["jobId"])
            if attempt["status"] not in (attempts.COMPLETE, attempts.CANCELLED, attempts.FARM_QUEUED, attempts.FARM_RUNNING, attempts.CANCEL_REQUESTED, attempts.COLLECTION_PENDING):
                self.store.transition(attempt["id"], attempts.FARM_QUEUED)
        elif row["external_id"]:
            ack = {"jobId": row["external_id"]}
        elif attempt["status"] != attempts.COMPLETE and time.time() - attempt["created"] > 30:
            self.store.transition(attempt["id"], attempts.SUBMISSION_UNCERTAIN, error="Submission response or acknowledgment unavailable; no automatic resubmission")
        if ack and attempt["status"] not in (attempts.COMPLETE, attempts.CANCELLED) and time.monotonic() - self.observed_at.get(row["id"], 0) > 15:
            self.observed_at[row["id"]] = time.monotonic()
            try:
                observation = deadline_command(["-GetJob", ack["jobId"], "true"])
            except (OSError, RuntimeError, subprocess.SubprocessError):
                observation = ""
            fields = dict(line.split("=", 1) for line in observation.splitlines() if "=" in line)
            tasks = {}
            status = fields.get("JobStatus", fields.get("Status"))
            if attempt["status"] == attempts.CANCEL_REQUESTED and status != "Completed":
                if status in ("Failed", "Suspended"):
                    self.store.transition(attempt["id"], attempts.CANCELLED)
            elif status == "Active":
                try:
                    task_state = deadline_command(["-GetJobTasks", ack["jobId"], "true"])
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    task_state = ""
                tasks = dict(line.split("=", 1) for line in task_state.splitlines() if "=" in line)
                if tasks.get("TaskStatus", tasks.get("Status")) == "Rendering":
                    self.store.transition(attempt["id"], attempts.FARM_RUNNING)
                elif tasks.get("TaskStatus", tasks.get("Status")) in ("Queued", "Pending"):
                    self.store.transition(attempt["id"], attempts.FARM_QUEUED)
            elif fields.get("JobStatus", fields.get("Status")) == "Rendering":
                self.store.transition(attempt["id"], attempts.FARM_RUNNING)
            elif fields.get("JobStatus", fields.get("Status")) == "Completed":
                self.store.transition(attempt["id"], attempts.COLLECTION_PENDING, error="Deadline completed; awaiting verified worker receipt")
            elif fields.get("JobStatus", fields.get("Status")) in ("Failed", "Suspended"):
                self.store.transition(attempt["id"], attempts.FARM_ATTENTION, error="Deadline job is " + fields.get("JobStatus", fields.get("Status")) + "; operator action may be needed, no automatic resubmission")
            if fields:
                progress = tasks.get("TaskProgress", tasks.get("Progress", fields.get("SingleTaskProgress", "")))
                match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*%\s*", progress)
                self.observations[attempt["id"]] = {"percent": min(100, float(match[1])) if match else None,
                    "worker": tasks.get("TaskSlaveName", tasks.get("SlaveName", "")),
                    "message": tasks.get("TaskRenderStatus", tasks.get("RenderStatus", "")), "observedAt": time.time()}
        namespace = contained(root, "spool-receipts/" + attempt["id"])
        if not namespace.exists():
            return
        for path in sorted(namespace.glob("*/receipt.json"), key=lambda p: p.parent.name):
            try:
                receipt = json.loads(path.read_text(encoding="utf-8"))
                checkpoint = self.receipt_checkpoint(package, receipt, root)
                unchanged = self.verified_receipts.get(path) == checkpoint
                known = self.store.execution(receipt["executionId"])
                job = self.store.submission_job(row["id"])
                if not unchanged or not known or known["attempt_id"] != attempt["id"] or known["submission_id"] != row["id"]:
                    self.verified_receipts.pop(path, None)
                    farm_protocol.verify(package, receipt, root)
            except (ValueError, KeyError, OSError) as error:
                self.verified_receipts.pop(path, None)
                self.store.reject_receipt(attempt["id"], str(path), str(error))
                continue
            if not job or job != receipt["jobId"]:
                self.store.reject_receipt(attempt["id"], str(path), "Worker receipt lacks the owned Deadline job association")
                continue
            if known:
                same = known["attempt_id"] == attempt["id"] and known["submission_id"] == row["id"]
                if unchanged and same:
                    continue
                stored = known["receipt"]
                same = same and {k: v for k, v in stored.items() if k not in ("artifacts", "primary")} == {k: v for k, v in receipt.items() if k != "artifacts"}
                same = same and len(stored["artifacts"]) == len(receipt["artifacts"]) and all(
                    all(saved.get(k) == v for k, v in artifact.items()) for saved, artifact in zip(stored["artifacts"], receipt["artifacts"]))
                if not same:
                    self.store.reject_receipt(attempt["id"], str(path), "Execution identity already contains different evidence")
                    continue
                if checkpoint == self.receipt_checkpoint(package, receipt, root):
                    self.verified_receipts[path] = checkpoint
                continue
            target = self.media.receipt_path(attempt).parent
            target.mkdir(parents=True, exist_ok=True)
            artifacts = []
            for artifact in receipt["artifacts"]:
                source = farm_protocol.contained(root, artifact["path"])
                destination = self.media.result_path(attempt, artifact["artifactId"], source.suffix.lower(), artifact["artifactId"] == receipt["primaryArtifactId"], receipt["executionId"])
                destination.parent.mkdir(parents=True, exist_ok=True)
                pending = destination.with_name(destination.name + ".partial")
                shutil.copyfile(source, pending)
                if farm_protocol.checksum(pending) != artifact["sha256"]:
                    raise ValueError("Farm ingestion copy changed checksum")
                pending.replace(destination)
                metadata = self.media.describe(destination, fps=attempt["request"].get("sequenceFps", 24))
                artifacts.append({**metadata, **artifact})
            result = {**receipt, "artifacts": artifacts, "primary": next(a for a in artifacts if a["artifactId"] == receipt["primaryArtifactId"])}
            sidecars.write_result(self.store, self.media, attempt, result)
            self.store.accept_execution(attempt["id"], receipt["executionId"], row["id"], result)
            if checkpoint == self.receipt_checkpoint(package, receipt, root):
                self.verified_receipts[path] = checkpoint


def job_value(job_id, key):
    """One ExtraInfo value of a Deadline job, such as the Spool submission that owns it."""
    return deadline_command(["-GetJobExtraInfoKeyValue", job_id, key]).strip()


def submission_jobs(submission_id):
    """Deadline job IDs tagged with a Spool submission; more than one needs an operator."""
    found = (value.strip() for value in deadline_command(["-GetJobIdsFilter", "ExtraInfo0=spool:" + submission_id]).splitlines())
    return [value for value in found if len(value) == 24 and all(c in "0123456789abcdef" for c in value)]


def fail_job(job_id):
    """Ask Deadline to stop a job Spool owns."""
    deadline_command(["-FailJob", job_id])


def deadline_command(arguments):
    executable = shutil.which("deadlinecommand") or shutil.which("deadlinecommand.exe")
    if not executable:
        executable = "C:/Program Files/Thinkbox/Deadline10/bin/deadlinecommand.exe"
    result = subprocess.run([executable, *arguments], capture_output=True, text=True, timeout=30,
                            creationflags=0x08000000 if os.name == 'nt' else 0)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout
