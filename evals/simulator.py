"""Bounded CLI/command adapter, not a host or an execution adapter.

The response boundary is here so API error codes/versioning can evolve without
changing cases or graders. No HTTP, subprocesses, project writes or real renders occur.
"""

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAPABILITIES = {
    "prepare_experiment": "queue",
    "queue_experiment": "queue",
    "set_inputs": "inputs",
    "choose_take": "choose_take",
    "cancel": "cancel",
    **dict.fromkeys(("add_note", "edit_note", "address_note", "reopen_note"), "notes"),
}


def load_cases():
    return json.loads((ROOT / "evals/cases.json").read_text(encoding="utf-8"))


def failure(message, status=400):
    return {"status": status, "body": {"error": message}}


class Rejected(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


class Simulator:
    def __init__(self, case):
        project = json.loads((ROOT / "evals/fixtures/project.json").read_text(encoding="utf-8"))
        setup = case.get("setup", {})
        project["shots"][0]["notes"] = copy.deepcopy(setup.get("notes", []))
        if setup.get("waitingJob"):
            project["jobs"] = [
                {"id": "waiting-1", "clipId": "hero", "takeId": "waiting-take", "status": "waiting_for_host"}
            ]
        self.projects = {project["id"]: project}
        if setup.get("duplicateProject"):
            other = copy.deepcopy(project)
            other["id"] = "launch-copy"
            self.projects[other["id"]] = other
        self.initial = copy.deepcopy(self.projects)
        self.operations = {}
        self.trace = []
        self.uncertain_queue = setup.get("uncertainQueue", False)

    def state(self):
        return copy.deepcopy(self.projects)

    def call(self, name, arguments):
        try:
            if not isinstance(arguments, dict):
                raise Rejected("Tool arguments must be an object")
            if name == "ask_user":
                if not arguments.get("question", "").strip():
                    raise Rejected("Supply a question")
                response = {
                    "pending": True,
                    "message": "No further user reply in this sample. Finish with the question.",
                }
            elif name == "spool":
                response = {"status": 200, "body": self._dispatch(arguments)}
            else:
                raise Rejected("Unknown eval tool")
        except Rejected as error:
            response = failure(error.message, error.status)
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            response = failure("Invalid call: " + str(error))
        if (
            name == "spool"
            and isinstance(arguments, dict)
            and isinstance(arguments.get("envelope"), dict)
            and arguments["envelope"].get("action") == "queue_experiment"
        ):
            if self.uncertain_queue and response.get("status") == 200:
                self.uncertain_queue = False
                response = {"transportError": "Connection timed out; command acceptance is unknown. No HTTP response."}
        self.trace.append(copy.deepcopy({"tool": name, "arguments": arguments, "response": response}))
        return copy.deepcopy(response)

    def _dispatch(self, args):
        method = args["method"]
        if method == "health":
            return {"ok": True}
        if method == "capabilities":
            return {"connected": True, "cloudExecution": False, "hasApiKey": False}
        if method == "projects":
            return [{k: p[k] for k in ("id", "name", "revision")} for p in self.projects.values()]
        if args.get("projectId") not in self.projects:
            raise Rejected("Project not found", 404)
        project = self.projects[args["projectId"]]
        if method in ("status", "shot"):
            return self._status(project, args)
        if method == "command":
            return self._command(project, args["envelope"])
        raise Rejected("Unsupported simulated CLI/API method")

    def _status(self, project, args=None):
        args = args or {}
        shots = project["shots"]
        if args.get("method") == "shot" and not args.get("clipId"):
            raise Rejected("shot requires --clip")
        if args.get("clipId"):
            shots = [c for c in shots if c["id"] == args["clipId"]]
            if not shots:
                raise Rejected("Shot not found", 404)
        limit, offset = args.get("limit", 50), args.get("offset", 0)
        if type(limit) is not int or type(offset) is not int or not 1 <= limit <= 100 or offset < 0:
            raise Rejected("Choose a page size of 1-100 and nonnegative offset")
        result = copy.deepcopy(shots[offset : offset + limit])
        for shot in result:
            shot["totalTakes"] = len(shot["takes"])
            shot["takes"] = shot["takes"][-50:]
            for take in shot["takes"]:
                take["media"] = {
                    key: take["media"].get(key)
                    for key in ("id", "kind", "width", "height", "duration", "fps", "frames", "audio", "poster", "file")
                }
        return {
            "projectId": project["id"],
            "revision": project["revision"],
            "brief": "",
            "shots": result,
            "audioClips": copy.deepcopy(project["audioClips"]),
            "totalShots": len(shots),
            "nextOffset": offset + limit if offset + limit < len(shots) else None,
            "jobs": copy.deepcopy(project["jobs"][-50:]),
            "experiments": [],
            "feedback": [],
            "recoverableResults": [],
        }

    def _command(self, project, data):
        action, args = data["action"], data.get("arguments", {})
        identity, actor, revision = data["operationId"], data["actor"], data["revision"]
        if (
            not isinstance(identity, str)
            or not 1 <= len(identity) <= 200
            or not isinstance(actor, str)
            or not 1 <= len(actor) <= 100
            or type(revision) is not int
        ):
            raise Rejected("Supply operation ID, saved revision and actor")
        if action not in CAPABILITIES:
            raise Rejected("Unknown typed command")
        scope = data.get("scope", {})
        if scope.get("projectId") != project["id"] or CAPABILITIES[action] not in scope.get("capabilities", []):
            raise Rejected("Command requires explicit project scope and capability: " + CAPABILITIES[action])
        variants = args.get("variants", [])
        clips = [v["clipId"] for v in variants] if CAPABILITIES[action] == "queue" else [args.get("clipId")]
        if action == "cancel":
            job = next((j for j in project["jobs"] if j["id"] == args["attemptId"]), None)
            if not job:
                raise Rejected("Attempt not found", 404)
            clips = [job["clipId"]]
        if set(clips) - set(scope.get("clipIds", [])):
            raise Rejected("Command includes a shot outside its declared scope")
        concurrent = scope.get("maxConcurrent")
        if concurrent is not None and (type(concurrent) is not int or concurrent < 1):
            raise Rejected("Concurrency limit must be a positive integer")
        if identity in self.operations:
            previous = self.operations[identity]
            if previous["projectId"] != project["id"] or previous["envelope"] != data:
                raise Rejected("Operation ID already used with different payload", 409)
            return self._status(project) if action == "queue_experiment" else copy.deepcopy(previous["result"])
        if revision != project["revision"]:
            raise Rejected("Project changed; inspect the current revision before applying this command", 409)
        if CAPABILITIES[action] == "queue":
            plan = self._plan(project, args)
            if type(scope.get("maxTakes")) is not int or plan["takeCount"] > scope["maxTakes"]:
                raise Rejected("Experiment exceeds the declared take budget")
            if action == "prepare_experiment":
                return plan
            active = sum(j["status"] not in ("complete", "failed", "cancelled") for j in project["jobs"])
            if concurrent is not None and active + plan["takeCount"] > concurrent:
                raise Rejected("Experiment exceeds the declared outstanding-job limit")
            for item in plan["items"]:
                for _ in range(item["count"]):
                    number = len(project["jobs"]) + 1
                    project["jobs"].append(
                        {
                            "id": f"attempt-{number}",
                            "clipId": item["clipId"],
                            "name": next(c["name"] for c in project["shots"] if c["id"] == item["clipId"]),
                            "status": "waiting_for_host",
                            "progress": 0,
                            "seed": "frozen",
                            "error": None,
                            "promptId": None,
                            "target": "local",
                        }
                    )
            result = self._status(project)
        else:
            clip = next((c for c in [*project["shots"], *project["audioClips"]] if c["id"] == args.get("clipId")), None)
            if action != "cancel" and clip is None:
                raise Rejected("Supply an explicit available shot ID")
            result = {"clipId": args.get("clipId"), "action": action}
            if action == "set_inputs":
                self._values(clip, args["values"])
                clip["inputs"].update(args["values"])
            elif action == "choose_take":
                take = next((t for t in clip["takes"] if t["id"] == args["takeId"] and not t.get("placeholder")), None)
                if not take:
                    raise Rejected("Take is unavailable for this shot")
                clip["selectedTakeId"] = take["id"]
                length = clip["out"] - clip["in"]
                new_length = min(length, take["media"]["frames"])
                clip["in"] = max(0, min(clip["in"], take["media"]["frames"] - new_length))
                clip["out"] = clip["in"] + new_length
                if new_length < length:
                    following = project["shots"][project["shots"].index(clip) + 1 :]
                    if following:
                        following[0]["gapBefore"] = following[0].get("gapBefore", 0) + length - new_length
                    else:
                        project["tailGap"] = project.get("tailGap", 0) + length - new_length
            elif action == "cancel":
                if job["status"] not in ("intent", "waiting_for_host"):
                    raise Rejected("Only waiting attempts are supported by this simulator")
                job["status"] = "cancelled"
                result = {"attemptId": job["id"], "status": "cancelled"}
            else:
                result = self._note(clip, action, args, actor, identity)
            project["revision"] += int(action != "cancel")
            result.update(operationId=identity, revision=project["revision"])
        self.operations[identity] = copy.deepcopy({"projectId": project["id"], "envelope": data, "result": result})
        return result

    def _values(self, clip, values):
        if not isinstance(values, dict) or set(values) - {b["key"] for b in clip["bindings"]}:
            raise Rejected("Input is not bound in this captured recipe")
        for key, value in values.items():
            original = clip["inputs"][key]
            if type(value) is not type(original) and not (type(original) is float and type(value) is int):
                raise Rejected("Input literal type changed")

    def _plan(self, project, args):
        mode, variants = args.get("mode", "repeat"), args.get("variants")
        if mode not in ("repeat", "explore") or not isinstance(variants, list) or not 1 <= len(variants) <= 100:
            raise Rejected("Choose Repeat or Explore and supply 1-100 explicit variants")
        items, resolved = [], []
        for variant in variants:
            clip = next((c for c in project["shots"] if c["id"] == variant["clipId"]), None)
            if not clip:
                raise Rejected("Experiment references an unavailable shot")
            values, count = variant.get("values", {}), variant.get("count", 1)
            if mode == "repeat" and values:
                raise Rejected("Repeat keeps saved inputs; use Explore for changes")
            self._values(clip, values)
            if type(count) is not int or not 1 <= count <= 16:
                raise Rejected("Choose 1-16 takes per variant")
            items.append({"clipId": clip["id"], "count": count, "values": copy.deepcopy(values)})
            resolved.append(
                {
                    "clipId": clip["id"],
                    "workflowVersion": clip["workflowVersion"],
                    "values": {**clip["inputs"], **values},
                    "count": count,
                    "diffs": [
                        {"key": k, "before": clip["inputs"][k], "after": v}
                        for k, v in values.items()
                        if clip["inputs"][k] != v
                    ],
                }
            )
        return {
            "intent": args.get("intent", ""),
            "mode": mode,
            "variants": resolved,
            "items": items,
            "takeCount": sum(i["count"] for i in items),
        }

    def _note(self, clip, action, args, actor, identity):
        notes = clip["notes"]
        if action == "add_note":
            text = args.get("text", "").strip()
            if not text:
                raise Rejected("Write a note first")
            note = {"id": "note-" + identity, "text": text, "status": "open", "createdAt": 1, "createdBy": actor}
            notes.append(note)
        else:
            note = next((n for n in notes if n["id"] == args.get("noteId")), None)
            if note is None:
                raise Rejected("This note is no longer available")
            if args.get("expectedText") != note["text"]:
                raise Rejected("The note changed. Read it again before acting on it.", 409)
            if action == "reopen_note":
                if note["status"] != "addressed" or any(
                    n.get("reopenedFrom") == note["id"] and n["status"] == "open" for n in notes
                ):
                    raise Rejected("Choose an addressed note that has not been reopened")
                note = {
                    "id": "note-" + identity,
                    "text": note["text"],
                    "status": "open",
                    "createdAt": 1,
                    "createdBy": actor,
                    "reopenedFrom": note["id"],
                }
                notes.append(note)
            elif note["status"] != "open":
                raise Rejected("Addressed notes are kept in history. Reopen the note to change it.")
            elif action == "edit_note":
                text = args.get("text", "").strip()
                if not text:
                    raise Rejected("A note cannot be empty")
                note["text"] = text
            elif action == "address_note":
                summary = args.get("summary", "").strip()
                if not summary:
                    raise Rejected("Agents must describe what they completed when addressing a note")
                note.update(status="addressed", addressedAt=1, addressedBy=actor, resolution=summary)
        return {"clipId": clip["id"], "noteId": note["id"], "status": note["status"]}
