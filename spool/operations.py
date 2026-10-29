"""Project operations shared by the studio's routes and agent commands.

The document functions change one clip in memory; the caller owns the revision
check and the transaction. `use_take` and `apply_capture` also own the order of
sidecar work: check the take's workflow file before saving the project, and
write it only after the save succeeds.
"""

import hashlib
import copy
import json
from pathlib import Path

from .errors import OperationConflict


def fit_to_take(document, clip, frames):
    """Shorten the clip to fit a shorter take; following clips keep their place behind a gap."""
    length = clip["out"] - clip["in"]
    new_length = min(length, frames)
    clip["in"] = max(0, min(clip["in"], frames - new_length))
    clip["out"] = clip["in"] + new_length
    if length <= new_length:
        return
    track = clip.get("videoTrack", 1)
    following = document["clips"][document["clips"].index(clip) + 1 :]
    following = next((c for c in following if c.get("videoTrack", 1) == track), None)
    if following:
        following["gapBefore"] = following.get("gapBefore", 0) + length - new_length
    elif track == 1:
        document["tailGap"] = document.get("tailGap", 0) + length - new_length
    else:
        tails = document.setdefault("videoTailGaps", {})
        tails[str(track)] = tails.get(str(track), 0) + length - new_length


def choose_take(document, clip, take_id, frames):
    """Put a take in the edit. Its workflow is not adopted; see Store.capture for Use take."""
    fit_to_take(document, clip, frames)
    clip["takeId"] = take_id


def assign_workflow(clip, version, capture):
    """Give the clip another saved workflow version, as choosing it in the library does."""
    builtin = bool(capture.get("provenance", {}).get("builtinTemplate"))
    clip["workflowVersion"] = version
    clip["bindings"] = capture.get("bindings", [])
    # Built-in examples ship without their source files; the clip asks for its own.
    clip["inputValues"] = {
        b["key"]: "" if builtin and b.get("asset") else capture["prompt"][b["nodeId"]]["inputs"][b["input"]]
        for b in clip["bindings"]
    }
    clip["executionTarget"] = capture.get("executionTarget", "local")
    library = capture.get("provenance", {}).get("importedWorkflowId")
    if library:
        clip["workflow"] = library
    else:
        clip.pop("workflow", None)
    for key in ("shotInputs", "seedKey", "generationBase"):
        clip.pop(key, None)
    clip["seedMode"] = "same"


def restage(original, prepared, values):
    """Point clip values that still name a captured source at the copy preparation staged."""
    for binding in original.get("bindings", []):
        node, name, key = binding["nodeId"], binding["input"], binding["key"]
        if binding.get("asset") and key in values and values[key] == original["prompt"][node]["inputs"][name]:
            values[key] = prepared["prompt"][node]["inputs"][name]


def _sidecars():
    # sidecars imports store, which imports this module for its document operations.
    from . import sidecars

    return sidecars


def _refresh_sidecar(capture, source):
    raw = _sidecars().serialize(capture)
    capture["sidecar"] = {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "name": source.with_suffix(".json").name,
        "needsSerialization": False,
    }


def _write_sidecar(store, source, capture, expected):
    _sidecars().write(source, capture, lock_root=store.root / ".spool" / "locks", expected=expected)


def use_take(store, project_id, revision, clip_id, take_id, capture=None, command=None):
    """Use take: choose it for the edit and adopt its generation setup.

    A setup read from the take's workflow file that still needs Comfy's
    serialization is written back beside the take once the project saves.
    """
    if command is not None and store.operation(command["operationId"], project_id, command) is not None:
        result = store.command(command["operationId"], project_id, revision, command, _missing_take_replay)
        return _finish_take_command(store, result)
    if command is not None:
        capture = copy.deepcopy(capture)
    sidecars = _sidecars()
    source = expected = None
    if capture and capture.get("sidecar"):
        clip = store.clip(project_id, clip_id)
        take = next(t for t in clip["takes"] if t["id"] == take_id)
        path = sidecars.media_path(store.root, take["media"])
        sidecars.check_current(path, capture["sidecar"]["sha256"])
        if capture["sidecar"]["needsSerialization"]:
            source, expected = path, capture["sidecar"]["sha256"]
            _refresh_sidecar(capture, source)
    if command is not None:
        result = {"clipId": clip_id, "action": "use_take"}
        if source:
            result["_sidecar"] = {
                "source": str(source),
                "capture": json.dumps(capture, ensure_ascii=False, allow_nan=False),
                "expected": expected,
            }
        saved = store.capture(project_id, revision, clip_id, capture, take_id=take_id, command=(command, result))
        return _finish_take_command(store, saved)
    saved = store.capture(project_id, revision, clip_id, capture, take_id=take_id)
    if source:
        _write_sidecar(store, source, capture, expected)
    return saved


def _missing_take_replay(db, document):
    raise OperationConflict("The take adoption receipt is no longer available; inspect the project before retrying")


def _finish_take_command(store, result):
    plan = result.get("_sidecar")
    if plan:
        source, capture = Path(plan["source"]), json.loads(plan["capture"])
        try:
            _sidecars().check_current(source, capture["sidecar"]["sha256"])
        except ValueError:
            try:
                _write_sidecar(store, source, capture, plan["expected"])
            except ValueError:
                # An identical retry may have delivered while this caller waited for the file lock.
                _sidecars().check_current(source, capture["sidecar"]["sha256"])
    return {key: value for key, value in result.items() if key != "_sidecar"}


def trim_clip(document, clip, edge, frame, frames):
    """Normal edge trim, with the same gap and six-frame bounds as the timeline."""
    track = clip.get("videoTrack", 1)
    first = next(i for i, c in enumerate(document["clips"]) if c.get("videoTrack", 1) == track)
    following = next(
        (
            c
            for c in document["clips"][document["clips"].index(clip) + 1 :]
            if c.get("videoTrack", 1) == clip.get("videoTrack", 1)
        ),
        None,
    )
    if edge == "in":
        delta = max(max(-clip["in"], -clip.get("gapBefore", 0)), min(frame - clip["in"], clip["out"] - 6 - clip["in"]))
        clip["in"] += delta
        if clip.get("gapBefore", 0) != clip.get("gapBefore", 0) + delta:
            clip["gapBefore"] = clip.get("gapBefore", 0) + delta
    else:
        track = clip.get("videoTrack", 1)
        gap = (
            following.get("gapBefore", 0)
            if following
            else document.get("tailGap", 0)
            if track == 1
            else document.get("videoTailGaps", {}).get(str(track), 0)
        )
        maximum = min(frames - clip["out"], gap) if following else frames - clip["out"]
        delta = max(clip["in"] + 6 - clip["out"], min(frame - clip["out"], maximum))
        clip["out"] += delta
        if following:
            if following.get("gapBefore", 0) != max(0, gap - delta):
                following["gapBefore"] = max(0, gap - delta)
        elif gap:
            if track == 1:
                document["tailGap"] = max(0, gap - delta)
            else:
                document.setdefault("videoTailGaps", {})[str(track)] = max(0, gap - delta)
    same_track = [c for c in document["clips"] if c.get("videoTrack", 1) == track]
    others = [c for c in document["clips"] if c.get("videoTrack", 1) != track]
    others[first:first] = same_track
    document["clips"] = others
    if track == 1:
        document.setdefault("tailGap", 0)
    return clip[edge]


def apply_capture(
    store, project_id, revision, clip_id, capture, overrides=None, save_sidecar=False, reset_inputs=False
):
    """Save a captured workflow to the clip (Apply to clip).

    With `save_sidecar`, the graph also replaces the workflow file of the take in
    the edit, provided nobody changed that file since the linked tab opened it.
    """
    sidecars = _sidecars()
    source = expected = None
    if save_sidecar:
        link = capture.get("provenance", {}).get("spoolLink", {})
        if link.get("projectId") != project_id or link.get("clipId") != clip_id:
            raise ValueError("Apply the workflow linked to this clip")
        clip = store.clip(project_id, clip_id)
        take = next(
            (t for t in clip.get("takes", []) if t["id"] == clip.get("takeId") and not t.get("placeholder")), None
        )
        if take:
            source = sidecars.media_path(store.root, take["media"])
            if not source.is_file():
                raise ValueError("Restore the selected take before saving its workflow")
            expected = link.get("sidecarSha")
            sidecars.check_current(source, expected)
            capture["preferWorkflow"] = True
            _refresh_sidecar(capture, source)
    saved = store.capture(project_id, revision, clip_id, capture, overrides, reset_inputs=reset_inputs)
    if source:
        _write_sidecar(store, source, capture, expected)
    return saved
