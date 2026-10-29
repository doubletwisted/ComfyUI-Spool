"""Submit Spool-owned jobs using the installed plugin and Deadline job scripts."""

import copy
import json
import shutil
import sys
from pathlib import Path

from . import farm_protocol
from .graph_inputs import with_prompt


def submit(request, package):
    import nodes  # Optional Comfy/Deadline integration, loaded only for farm dispatch.

    launcher = request["prompt"][request["launcherNodeId"]]
    node_class = nodes.NODE_CLASS_MAPPINGS[launcher["class_type"]]
    plugin = sys.modules[node_class.__module__]
    directory = Path(package["resultRoot"]) / "spool-submissions" / package["submissionId"]
    acknowledgment = directory / "ack.json"
    if acknowledgment.is_file():
        ack = json.loads(acknowledgment.read_text(encoding="utf-8"))
        if any(ack[key] != package[key] for key in ("submissionId", "attemptId", "fingerprint")):
            raise ValueError("Deadline acknowledgment belongs to another submission")
        return ack["jobId"]
    if (directory / "submitting.json").exists():
        raise ValueError("Deadline submission needs reconciliation; no automatic resubmission")
    directory.mkdir(parents=True, exist_ok=True)
    submitter = node_class()
    root = submitter._prepare_output_directory(package["resultRoot"])
    inputs = copy.deepcopy(launcher["inputs"])
    worker = plugin.WorkflowProcessor.prepare_for_worker(request["prompt"])
    stager = plugin.InputAssetStager(root, inputs["job_name"], package["submissionId"])
    input_directory, manifest, assets = stager.stage_referenced_assets(worker)
    submitter._rewrite_prompt_asset_references(worker, assets)
    package = copy.deepcopy(package)
    package["stagedPrompt"] = worker
    package["adapter"] = "spool-job-script-1"
    for asset in package["assets"]:
        asset["staged"] = worker[asset["nodeId"]]["inputs"][asset["input"]]
        staged = farm_protocol.contained(input_directory, asset["staged"])
        if staged.stat().st_size != asset["byteSize"] or farm_protocol.checksum(staged) != asset["sha256"]:
            raise ValueError("Deadline staged dependency changed")
    workflow = request["capture"].get("workflow")
    if workflow and workflow.get("nodes"):
        workflow, _ = with_prompt(request["capture"], worker)
    config = {
        **inputs,
        "batch_count": 1,
        "chunk_size": 1,
        "submission_id": package["submissionId"],
        "input_directory": input_directory,
        "output_directory": root,
        "input_manifest": manifest,
        "standard_workflow": workflow,
    }
    files = directory / "job"
    files.mkdir(exist_ok=True)
    job_info, plugin_info, auxiliary = plugin.DeadlineJobSubmitter(worker, config)._create_submission_files(str(files))
    for name in ("deadline_task.py", "farm_protocol.py"):
        shutil.copyfile(Path(__file__).with_name(name), directory / name)
    with Path(job_info).open("a", encoding="utf-8") as handle:
        handle.write("\nPreTaskScript=" + str(directory / "deadline_task.py") + "\n")
        handle.write("ExtraInfo0=spool:" + package["submissionId"] + "\n")
        handle.write("ExtraInfoKeyValue0=SpoolSubmissionId=" + package["submissionId"] + "\n")
        handle.write("ExtraInfoKeyValue1=SpoolAttemptId=" + package["attemptId"] + "\n")
    farm_protocol.atomic_json(directory / "request.json", package)
    farm_protocol.atomic_json(directory / "submitting.json", {"attemptId": package["attemptId"]})
    result = plugin.DeadlineCommandHelper.call_deadline_command([job_info, plugin_info, *auxiliary])
    job_id = plugin.DeadlineCommandHelper.get_job_id_from_submission(result)
    if not job_id:
        raise ValueError("Deadline returned no JobID; check the owned submission before retrying")
    farm_protocol.atomic_json(
        acknowledgment,
        {
            **{key: package[key] for key in ("schemaVersion", "submissionId", "attemptId", "fingerprint")},
            "jobId": job_id,
        },
    )
    return job_id
