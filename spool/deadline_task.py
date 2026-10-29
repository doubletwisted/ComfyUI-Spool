"""Deadline Pre-Task script. Adapts only this job's in-memory worker instance."""

import copy
import importlib.util
import json
from pathlib import Path


def install(plugin, package, protocol):
    if getattr(plugin, "_spool_job_adapter", None) == package["submissionId"]:
        return
    queue = plugin._queue_prompt
    history = plugin.process_history_data
    complete = plugin._complete_task
    executions = {}
    verified = set()

    def queue_prompt(prompt, metadata, workflow_metadata=None):
        if metadata["submission_id"] != package["submissionId"] or int(metadata["variation_index"]) != 0:
            raise ValueError("Deadline task does not match the assigned Spool take")
        prompt = copy.deepcopy(prompt)
        # Stock workers rewrite seed bookkeeping even for variation zero. The
        # assigned Spool seed and its inputs must remain frozen instead.
        for identity, node in prompt.items():
            if node["class_type"] in ("DeadlineSeed", "DistributedSeed", "DeadlineDistributedSeed"):
                node["inputs"] = copy.deepcopy(package["stagedPrompt"][identity]["inputs"])
        physical = protocol.prepare_execution(package, prompt, plugin.comfyui_input_dir, 0)
        accepted = queue(physical["prompt"], metadata, workflow_metadata)
        if accepted:
            executions[plugin.prompt_id] = physical
        return accepted

    def process_history(value):
        prompt_id = plugin.prompt_id
        entry = value.get(prompt_id)
        if prompt_id in executions and entry and entry.get("status", {}).get("completed"):
            if entry["status"].get("status_str") == "success":
                protocol.finalize(
                    package,
                    executions[prompt_id],
                    prompt_id,
                    entry,
                    {
                        "input": plugin.comfyui_input_dir,
                        "output": plugin.comfyui_output_dir,
                        "temp": str(Path(plugin.comfyui_install_path) / "ComfyUI" / "temp"),
                    },
                    plugin.GetSlaveName(),
                    str(plugin.GetJob().JobId),
                )
                verified.add(prompt_id)
                del executions[prompt_id]
        return history(value)

    def complete_task():
        if plugin.prompt_id in verified:
            return complete()

    plugin._queue_prompt = queue_prompt
    plugin.process_history_data = process_history
    plugin._complete_task = complete_task
    plugin._handle_stdout_prompt_completion = lambda: None
    plugin._spool_job_adapter = package["submissionId"]


def __main__(deadlinePlugin, *args):
    directory = Path(__file__).resolve().parent
    package = json.loads((directory / "request.json").read_text(encoding="utf-8"))
    job = deadlinePlugin.GetJob()
    if (
        job.GetJobExtraInfoKeyValue("SpoolSubmissionId") != package["submissionId"]
        or job.GetJobExtraInfoKeyValue("SpoolAttemptId") != package["attemptId"]
    ):
        raise ValueError("Deadline job does not own this Spool package")
    spec = importlib.util.spec_from_file_location("spool_job_protocol", directory / "farm_protocol.py")
    protocol = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(protocol)
    install(deadlinePlugin, package, protocol)
