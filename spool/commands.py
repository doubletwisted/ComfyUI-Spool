"""Small typed commands shared by human controls and external agents."""

import asyncio
import copy
import json
import subprocess

from .errors import NotFound, OperationConflict, InvalidRequest
from . import ledger, operations, requests, notes
from .execution_targets import adapter_for
from .store import Conflict, linked
from .workflow_inputs import input_problem


# Advertised by capabilities; scope and action spelling are a public contract.
ACTION_CAPABILITIES = {
    "prepare_experiment": "queue",
    "queue_experiment": "queue",
    "set_inputs": "inputs",
    "set_shot_inputs": "inputs",
    "apply_workflow": "workflow",
    "choose_take": "choose_take",
    "use_take": "use_take",
    "trim_clip": "edit",
    "rename_clip": "edit",
    "feedback": "feedback",
    "brief": "edit",
    "cancel": "cancel",
    "recover_submission": "recover",
    "add_note": "notes",
    "edit_note": "notes",
    "address_note": "notes",
    "reopen_note": "notes",
}
ARGUMENT_FIELDS = {
    "prepare_experiment": {"variants": list},
    "queue_experiment": {"variants": list},
    "set_inputs": {"clipId": str, "values": dict},
    "set_shot_inputs": {"clipId": str, "inputs": list},
    "apply_workflow": {"clipId": str, "workflowVersion": str},
    "choose_take": {"clipId": str, "takeId": str},
    "use_take": {"clipId": str, "takeId": str, "capture": (dict, type(None))},
    "trim_clip": {"clipId": str, "edge": str, "frame": int},
    "rename_clip": {"clipId": str, "name": str},
    "feedback": {"clipId": str, "takeId": str, "verdict": str},
    "brief": {"text": str},
    "cancel": {"attemptId": str},
    "recover_submission": {"attemptId": str},
    "add_note": {"clipId": str, "text": str},
    "edit_note": {"clipId": str, "noteId": str, "expectedText": str, "text": str},
    "address_note": {"clipId": str, "noteId": str, "expectedText": str},
    "reopen_note": {"clipId": str, "noteId": str, "expectedText": str},
}


def validate_envelope(data):
    """Validate the external envelope before indexing it; business rules stay below."""

    def require(ok):
        if not ok:
            raise InvalidRequest("Supply a valid command envelope; see /spool/api/command-schema")

    require(isinstance(data, dict))
    for key, limit in (("operationId", 200), ("actor", 100)):
        require(isinstance(data.get(key), str) and 1 <= len(data[key]) <= limit)
    require(type(data.get("revision")) is int)
    action = data.get("action")
    require(isinstance(action, str) and action in ACTION_CAPABILITIES)
    arguments = data.get("arguments")
    require(isinstance(arguments, dict))
    for key, kind in ARGUMENT_FIELDS[action].items():
        require(isinstance(arguments.get(key), kind))
    argument_types = {key: kind for fields in ARGUMENT_FIELDS.values() for key, kind in fields.items()}
    argument_types.update(summary=str, intent=str, mode=str)
    for key, kind in argument_types.items():
        if key in arguments:
            require(isinstance(arguments[key], kind))
    if action == "trim_clip":
        require(arguments["edge"] in ("in", "out") and type(arguments["frame"]) is int)
    if action == "rename_clip":
        require(1 <= len(arguments["name"].strip()) <= 200)
    if "mode" in arguments:
        require(arguments["mode"] in ("repeat", "explore"))
    if "verdict" in arguments:
        require(arguments["verdict"] in ("keep", "reject", "revise", "unrated"))
    if "inputs" in arguments:
        require(isinstance(arguments["inputs"], list))
        require(all(isinstance(v, dict) and isinstance(v.get("key"), str) for v in arguments["inputs"]))
    if "variants" in arguments:
        require(1 <= len(arguments["variants"]) <= 100)
        for variant in arguments["variants"]:
            require(isinstance(variant, dict) and isinstance(variant.get("clipId"), str))
            require(type(variant.get("count", 1)) is int and 1 <= variant.get("count", 1) <= 16)
            require(isinstance(variant.get("values", {}), dict))
            require(isinstance(variant.get("shotInputs", []), list))
            require(all(isinstance(v, dict) and isinstance(v.get("key"), str) for v in variant.get("shotInputs", [])))
    scope = data.get("scope")
    require(isinstance(scope, dict) and isinstance(scope.get("projectId"), str))
    for key in ("clipIds", "capabilities"):
        require(isinstance(scope.get(key, []), list) and all(isinstance(v, str) for v in scope.get(key, [])))
    require("capabilities" in scope and set(scope["capabilities"]) <= set(ACTION_CAPABILITIES.values()))
    for key in ("maxTakes", "maxConcurrent"):
        if key in scope:
            require(type(scope[key]) is int and scope[key] >= 1)


def scope_check(project_id, scope, capability, clip_ids=(), takes=0):
    if (
        not isinstance(scope, dict)
        or scope.get("projectId") != project_id
        or capability not in scope.get("capabilities", [])
    ):
        raise ValueError("Command requires explicit project scope and capability: " + capability)
    if set(clip_ids) - set(scope.get("clipIds", [])):
        raise ValueError("Command includes a shot outside its declared scope")
    if takes and (type(scope.get("maxTakes")) is not int or takes > scope["maxTakes"]):
        raise ValueError("Experiment exceeds the declared take budget")
    if scope.get("maxConcurrent") is not None and (
        type(scope["maxConcurrent"]) is not int or scope["maxConcurrent"] < 1
    ):
        raise ValueError("Concurrency limit must be a positive integer")


def status(store, project_id, clip_id=None, limit=50, offset=0):
    if not 1 <= limit <= 100 or offset < 0:
        raise ValueError("Choose a page size of 1-100 and nonnegative offset")
    project = store.get(project_id)
    shots = project["document"]["clips"]
    if clip_id is not None:
        shots = [c for c in shots if c["id"] == clip_id]
        if not shots:
            raise NotFound("Shot not found")

    def inputs(c):
        """The recipe's input rules and, as beside Generate, the first missing media input."""
        recipe = project["recipes"].get(c.get("workflowVersion"))
        if not recipe:
            return {"inputRules": [], "inputProblem": None}
        bindings = c.get("bindings", [])
        values = {
            b["key"]: recipe["prompt"].get(b["nodeId"], {}).get("inputs", {}).get(b["input"])
            for b in bindings
            if b.get("asset")
        }
        values.update(c.get("inputValues", {}))
        return {
            "inputRules": recipe.get("inputRules", []),
            "inputProblem": input_problem(bindings, values, c.get("shotInputs", []), recipe.get("inputRules", [])),
        }

    values = [
        {
            "id": c["id"],
            "name": c["name"],
            "notes": notes.entries(c),
            "workflowVersion": c.get("workflowVersion"),
            "inputs": c.get("inputValues", {}),
            "bindings": c.get("bindings", []),
            **inputs(c),
            "selectedTakeId": c.get("takeId"),
            "in": c.get("in"),
            "out": c.get("out"),
            "totalTakes": len(c.get("takes", [])),
            "takes": [
                {
                    "id": t["id"],
                    "generated": t.get("generated", False),
                    "placeholder": t.get("placeholder", False),
                    "media": {
                        k: t["media"].get(k)
                        for k in (
                            "id",
                            "kind",
                            "width",
                            "height",
                            "duration",
                            "fps",
                            "frames",
                            "audio",
                            "poster",
                            "file",
                        )
                    },
                }
                for t in c.get("takes", [])[-50:]
            ],
        }
        for c in shots[offset : offset + limit]
    ]
    experiments, feedback = store.recent_review(project_id)
    return {
        "projectId": project_id,
        "revision": project["revision"],
        "brief": project["document"].get("brief", ""),
        "shots": values,
        "audioClips": [
            {"id": c["id"], "name": c.get("name", "Audio"), "notes": notes.entries(c)}
            for c in project["document"].get("audioClips", [])
        ],
        "totalShots": len(shots),
        "nextOffset": offset + limit if offset + limit < len(shots) else None,
        "jobs": project["document"]["jobs"][-50:],
        "experiments": experiments,
        "feedback": feedback,
        "recoverableResults": project["document"].get("recoverableResults", [])[-50:],
    }


def prepare_experiment(store, project_id, revision, arguments):
    project = store.get(project_id)
    if project["revision"] != revision:
        raise Conflict("Project changed before experiment preparation")
    mode = arguments.get("mode", "repeat")
    if mode not in ("repeat", "explore"):
        raise ValueError("Choose Repeat or Explore")
    variants = arguments.get("variants")
    if not isinstance(variants, list) or not 1 <= len(variants) <= 100:
        raise ValueError("Supply 1-100 explicit variants")
    resolved, items = [], []
    for variant in variants:
        clip = next((c for c in project["document"]["clips"] if c["id"] == variant.get("clipId")), None)
        if not clip:
            raise ValueError("Experiment references an unavailable shot")
        capture = store.workflow(clip.get("workflowVersion"))
        controls = {b["key"]: b for b in capture.get("bindings", [])}
        values = variant.get("values", {})
        if mode == "repeat" and values:
            raise ValueError("Repeat keeps saved inputs; use Explore for changes")
        if not isinstance(values, dict) or set(values) - set(controls):
            raise ValueError("Map each variation to a verified bound literal control")
        diffs = []
        for key, value in values.items():
            b = controls[key]
            original = capture["prompt"][b["nodeId"]]["inputs"][b["input"]]
            numeric_float = (
                b.get("contract", {}).get("inputType") == "FLOAT"
                and type(original) in (int, float)
                and type(value) in (int, float)
            )
            if (
                linked(original)
                or type(value) is not type(original)
                and not (type(original) is float and type(value) is int)
                and not numeric_float
            ):
                raise ValueError("Variation does not match its literal input type")
            baseline = clip.get("inputValues", {}).get(key, original)
            if baseline != value:
                diffs.append({"key": key, "label": b.get("label", b["input"]), "before": baseline, "after": value})
        count = variant.get("count", 1)
        if type(count) is not int or not 1 <= count <= 16:
            raise ValueError("Choose 1-16 takes per variant")
        item = {"clipId": clip["id"], "count": count, "values": copy.deepcopy(values)}
        if "shotInputs" in variant:
            item["shotInputs"] = copy.deepcopy(variant["shotInputs"])
        items.append(item)
        resolved.append(
            {
                "clipId": clip["id"],
                "workflowVersion": clip["workflowVersion"],
                "values": {**clip.get("inputValues", {}), **values},
                "diffs": diffs,
                "count": count,
            }
        )
    return {
        "intent": arguments.get("intent", ""),
        "mode": mode,
        "variants": resolved,
        "items": requests.queue_items({"items": items}),
        "takeCount": sum(i["count"] for i in items),
    }


def execute(store, media, project_id, data):
    validate_envelope(data)
    action, arguments = data["action"], data.get("arguments", {})
    identity, revision, actor = data["operationId"], data["revision"], data["actor"]
    scope = data.get("scope")
    if action in ("prepare_experiment", "queue_experiment"):
        # Queue replay is resolved by the exact frozen command envelope below.
        scope_check(
            project_id,
            scope,
            "queue",
            [v["clipId"] for v in arguments.get("variants", [])],
            sum(v.get("count", 1) for v in arguments.get("variants", [])),
        )
        if action == "prepare_experiment":
            return prepare_experiment(store, project_id, revision, arguments)
        payload = store.operation_payload(identity)
        if payload:
            if payload.get("command") != data:
                raise OperationConflict("Operation ID already belongs to another experiment")
            return status(store, project_id)
        preview = prepare_experiment(store, project_id, revision, arguments)
        if scope.get("maxConcurrent") is not None:
            active = store.active_attempts(project_id)
            if active + preview["takeCount"] > scope["maxConcurrent"]:
                raise ValueError("Experiment exceeds the declared outstanding-job limit")
        project = store.get(project_id)
        frozen = requests.prepare(store, media, project, preview["items"])
        for _, request in frozen:
            request["experimentId"] = identity
        payload = {
            "revision": revision,
            "items": preview["items"],
            "actor": actor,
            "experiment": preview,
            "command": data,
        }
        store.accept_queue(identity, project_id, revision, payload, frozen, actor)
        return status(store, project_id)
    note_actions = {"add_note", "edit_note", "address_note", "reopen_note"}
    clip_id = arguments.get("clipId")
    if action not in ("brief", "cancel", "recover_submission") and not clip_id:
        raise ValueError("Supply an explicit shot ID for this command")
    scope_check(project_id, scope, ACTION_CAPABILITIES[action], [clip_id] if clip_id else [])
    if action == "use_take":
        # Resolve replay before preparing inputs or consulting a possibly changed take.
        if store.operation(identity, project_id, data) is not None:
            return operations.use_take(store, project_id, revision, clip_id, arguments["takeId"], command=data)
        capture = arguments["capture"]
        if capture is None:
            from . import take_workflow

            if take_workflow.resolve(store, project_id, clip_id, arguments["takeId"]) is not None:
                raise ValueError("Supply this take's prepared capture to adopt its generation setup")
        else:
            capture = media.prepare_workflow(copy.deepcopy(capture), strict=True, allow_external=False)
        return operations.use_take(store, project_id, revision, clip_id, arguments["takeId"], capture, command=data)
    adopted = None
    cancellation = None
    if action == "cancel":
        store.operation(identity, project_id, data)  # Validate replays before any external lookup.
        attempt = store.attempt(arguments["attemptId"])
        if attempt["project_id"] != project_id or attempt["clip_id"] not in scope.get("clipIds", []):
            raise ValueError("Attempt is outside the cancellation scope")
        submission = store.submission_for(attempt["id"])
        with store.connect() as db:
            done = store.cancellation_done(db, attempt["id"])
        adapter = adapter_for(attempt["request"], submission)
        cancellation = asyncio.run(
            adapter.cancel(attempt, {"stage": "check", "submission": submission, "done": done})
        ).get("delivery")
    if action == "recover_submission":
        attempt = store.attempt(arguments["attemptId"])
        if attempt["project_id"] != project_id or attempt["clip_id"] not in scope.get("clipIds", []):
            raise ValueError("Submission is outside recovery scope")
        submission = store.submission_for(attempt["id"])
        adopted = adapter_for(attempt["request"], submission).recover(attempt, {"submission": submission})["jobId"]

    def apply(db, document):
        clips = [*document["clips"], *document.get("audioClips", [])] if action in note_actions else document["clips"]
        clip = next((c for c in clips if c["id"] == clip_id), None)
        if clip_id and not clip:
            raise ValueError("Shot is no longer available")
        if action in note_actions:
            return notes.apply(clip, action, arguments, actor), True
        if action in ("set_inputs", "set_shot_inputs"):
            capture = store.recipe(project_id, clip.get("workflowVersion"), db)
            if capture is None:
                raise ValueError("Save an executable workflow to this clip first")
        if action == "set_inputs":
            controls = {b["key"]: b for b in capture.get("bindings", [])}
            values = arguments["values"]
            if not isinstance(values, dict) or set(values) - set(controls):
                raise ValueError("Input is not bound in this captured recipe")
            for key, value in values.items():
                b = controls[key]
                original = capture["prompt"][b["nodeId"]]["inputs"][b["input"]]
                numeric_float = (
                    b.get("contract", {}).get("inputType") == "FLOAT"
                    and type(original) in (int, float)
                    and type(value) in (int, float)
                )
                if (
                    type(value) is not type(original)
                    and not (type(original) is float and type(value) is int)
                    and not numeric_float
                ):
                    raise ValueError("Input literal type changed")
            clip.setdefault("inputValues", {}).update(values)
            emptied = {key for key, value in values.items() if value == "" and controls[key].get("optional")}
            if emptied and clip.get("shotInputs"):
                clip["shotInputs"] = [s for s in clip["shotInputs"] if s.get("key") not in emptied]
        elif action == "set_shot_inputs":
            bindings = {b["key"]: b for b in capture.get("bindings", [])}
            for value in arguments["inputs"]:
                binding = bindings.get(value["key"])
                requests.validate_shot_input(binding, value)
            clip["shotInputs"] = copy.deepcopy(arguments["inputs"])
        elif action == "apply_workflow":
            capture = store.recipe(project_id, arguments["workflowVersion"], db)
            if capture is None:
                raise ValueError("Captured workflow is outside this project")
            operations.assign_workflow(clip, arguments["workflowVersion"], capture)
        elif action == "rename_clip":
            clip["name"] = arguments["name"].strip()
        elif action == "trim_clip":
            projected = ledger.attach(copy.deepcopy(document), store.project_attempts(project_id, db))
            choices = next(c for c in projected["clips"] if c["id"] == clip_id)["takes"]
            take = next((t for t in choices if t["id"] == clip.get("takeId")), None)
            if not take:
                raise ValueError("The chosen take is no longer available")
            operations.trim_clip(document, clip, arguments["edge"], arguments["frame"], take["media"]["frames"])
        elif action == "choose_take":
            projected = ledger.attach(copy.deepcopy(document), store.project_attempts(project_id, db))
            choices = next(c for c in projected["clips"] if c["id"] == clip_id)["takes"]
            take = next((t for t in choices if t["id"] == arguments["takeId"] and not t.get("placeholder")), None)
            if not take:
                raise ValueError("Take is unavailable for this shot")
            operations.choose_take(document, clip, take["id"], take["media"]["frames"])
        elif action == "feedback":
            take_id = arguments["takeId"]
            projected = ledger.attach(copy.deepcopy(document), store.project_attempts(project_id, db))
            if not any(t["id"] == take_id for c in projected["clips"] if c["id"] == clip_id for t in c["takes"]):
                raise ValueError("Feedback requires a stable take in this project")
            if arguments.get("verdict") not in ("keep", "reject", "revise", "unrated"):
                raise ValueError("Choose keep, reject, revise or unrated")
            store.record_feedback(db, identity, project_id, take_id, actor, arguments)
            return {"feedbackId": identity}, False
        elif action == "brief":
            document["brief"] = arguments["text"]
        elif action == "cancel":
            attempt = store.project_attempt(project_id, arguments["attemptId"], db)
            if not attempt or attempt["clip_id"] not in scope.get("clipIds", []):
                raise ValueError("Attempt is outside the cancellation scope")
            submission = store.submission_for(attempt["id"], db)
            adapter = adapter_for(json.loads(attempt["request"]), submission)
            plan = asyncio.run(
                adapter.cancel(
                    attempt,
                    {
                        "stage": "plan",
                        "submission": submission,
                        "delivery": cancellation,
                        "done": store.cancellation_done(db, attempt["id"]),
                    },
                )
            )
            if plan.get("claim"):
                store.claim_cancellation(db, identity)
            if plan.get("transition", True):
                store.transition(
                    attempt["id"], plan["status"], error=plan.get("error"), db=db, expected=attempt["status"]
                )
            return plan["result"], False
        elif action == "recover_submission":
            if adopted:
                store.adopt_submission_job(db, submission["id"], adopted)
            return {
                "attemptId": attempt["id"],
                "jobId": adopted,
                "status": "adopted" if adopted else "submission_uncertain",
                "note": "No automatic resubmission",
            }, False
        if clip:
            clip["revision"] = clip.get("revision", 0) + 1
        return {"clipId": clip_id, "action": action}, True

    result = store.command(identity, project_id, revision, data, apply)
    if action == "cancel" and cancellation and store.start_cancellation(identity, result["attemptId"], *cancellation):
        try:
            asyncio.run(adapter.cancel(attempt, {"stage": "send", "jobId": result["jobId"]}))
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            store.finish_cancellation(identity, str(error))
            raise
        result = store.finish_cancellation(identity)
    return result
