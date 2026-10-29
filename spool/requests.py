"""Freeze generation requests independently of a running Comfy executor."""

import copy
import re

from . import attempts, cloud, system
from .media import SAVER_GROUPS, contained, sha256
from .store import Conflict, uid, encode
from .workflow_inputs import LOADERS, compact_groups, input_problem, leave_out

SAVERS = set(SAVER_GROUPS)
LAUNCHERS = {"DeadlineSubmit", "SaveAndSubmitNode"}
# Settings a clip may choose for the Deadline submit node Spool adds; the plugin's
# defaults fill the rest, and Spool sets the output folder and batch sizes itself.
DEADLINE_SETTINGS = ("pool", "group", "priority", "machine_list")
DEADLINE_UNAVAILABLE = (
    "Deadline is not available. Install ComfyUI-Deadline-Plugin on the ComfyUI that runs Spool "
    "and Deadline's client on this computer, then restart ComfyUI."
)


def execution_target(clip, capture):
    """A Deadline submit node in the workflow wins, then the clip's choice, then the workflow's."""
    if any(node["class_type"] in LAUNCHERS for node in capture["prompt"].values()):
        return attempts.DEADLINE
    return clip.get("executionTarget", capture.get("executionTarget", attempts.LOCAL))


def deadline_available(definitions):
    return "DeadlineSubmit" in definitions and system.deadline_installed()


def deadline_launcher(definitions, settings):
    """The submit node for a clip rendered on Deadline whose workflow has none."""
    if not deadline_available(definitions):
        raise ValueError(DEADLINE_UNAVAILABLE)
    specs = {
        name: spec
        for group in ("required", "optional")
        for name, spec in definitions["DeadlineSubmit"].get("input", {}).get(group, {}).items()
    }

    def options(spec):
        if isinstance(spec[0], list):
            return spec[0]
        return spec[1].get("options") if spec[0] == "COMBO" and len(spec) > 1 else None

    inputs = {}
    for name, spec in specs.items():
        config = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        choices = options(spec)
        if choices is not None:
            inputs[name] = config["default"] if config.get("default") in choices else choices[0]
        elif "default" in config:
            inputs[name] = config["default"]
    settings = {} if settings is None else settings
    if not isinstance(settings, dict) or set(settings) - set(DEADLINE_SETTINGS):
        raise ValueError("Deadline settings are pool, group, priority and machine_list")
    for name, value in settings.items():
        spec = specs.get(name)
        if spec is None:
            raise ValueError("This Deadline plugin has no " + name + " setting")
        choices = options(spec)
        config = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        if choices is not None:
            if value not in choices:
                raise ValueError("Deadline " + name + " " + str(value) + " is not on this farm")
        elif spec[0] == "INT":
            if type(value) is not int or not config.get("min", value) <= value <= config.get("max", value):
                raise ValueError("Choose a Deadline " + name + " within its range")
        elif not isinstance(value, str):
            raise ValueError("Deadline " + name + " must be text")
        if name == "machine_list":
            # The plugin's job writer accepts only bare comma-separated names, as its node sends them.
            value = ",".join(part.strip() for part in value.split(",") if part.strip())
            if value and not re.fullmatch(r"[A-Za-z0-9_,.\-]+", value):
                raise ValueError("List Deadline workers by name, separated by commas")
        inputs[name] = value
    return {"class_type": "DeadlineSubmit", "inputs": inputs}


def validate_shot_input(binding, setting):
    if (
        not binding
        or not binding.get("asset")
        or binding.get("slot") not in ("image", "video", "firstFrame", "lastFrame", "reference", "audio")
    ):
        raise ValueError("Choose a verified image, video or audio binding")
    sources = ("original", "selected", "clip", "track") if binding["slot"] == "audio" else ("original", "selected")
    if setting.get("source") not in sources:
        raise ValueError("Choose a supported source for this generation input")
    if setting["source"] == "clip" and not isinstance(setting.get("clipId"), str):
        raise ValueError("Choose a timeline clip for the audio input")
    if setting["source"] == "track" and (
        setting.get("track") not in ("source", "music")
        or type(setting.get("lane", 1)) is not int
        or setting.get("lane", 1) < 1
    ):
        raise ValueError("Choose an audio track to align with this shot")


def audio_input_segments(document, clip, setting):
    ends, rows = {}, []
    for c in document["clips"]:
        track = c.get("videoTrack", 1)
        start = ends.get(track, 0) + c.get("gapBefore", 0)
        ends[track] = start + c["out"] - c["in"]
        take = next((t for t in c.get("takes", []) if t["id"] == c.get("takeId")), None)
        rows.append((c, take, start))
    source = setting["source"]
    if source in ("original", "selected", "clip"):
        c = clip
        if source == "clip":
            c = next(
                (c for c in [*document["clips"], *document.get("audioClips", [])] if c["id"] == setting["clipId"]), None
            )
        if c is None:
            raise ValueError("The chosen audio source clip was removed")
        take = (
            next((t for t in c.get("takes", []) if not t.get("generated") and not t.get("placeholder")), None)
            if source == "original"
            else next((t for t in c.get("takes", []) if t["id"] == c.get("takeId")), None)
        )
        metadata = c.get("media") or (take or {}).get("media")
        if not metadata or not metadata.get("audio") and metadata.get("kind") != "audio":
            raise ValueError("The chosen source has no audio. Choose another clip or an aligned audio track.")
        return [{"media": metadata, "in": c["in"], "out": c["out"], "start": 0}]
    shot_start = next(start for c, _, start in rows if c["id"] == clip["id"])
    shot_end = shot_start + clip["out"] - clip["in"]
    track, lane = setting["track"], setting.get("lane", 1)
    mix = document.get("audioTracks", {})
    audible = not mix.get(track + "Muted") and (
        not mix.get(("music" if track == "source" else "source") + "Solo") or mix.get(track + "Solo")
    )
    candidates = [
        (c, c["media"], c["start"])
        for c in document.get("audioClips", [])
        if c.get("track", "music") == track and (track != "source" or c.get("sourceLane", 1) == lane)
    ]
    if track == "source":
        candidates += [
            (c, t["media"], start)
            for c, t, start in rows
            if c.get("videoTrack", 1) == lane
            and lane not in document.get("disabledVideoTracks", [])
            and not c.get("audioDetached")
            and t
            and t["media"].get("audio")
        ]
    return [
        {"media": metadata, "in": c["in"], "out": c["out"], "start": start - shot_start, "audio": c.get("audio", {})}
        for c, metadata, start in candidates
        if audible
        and c.get("enabled", True)
        and not c.get("audio", {}).get("muted")
        and start < shot_end
        and start + c["out"] - c["in"] > shot_start
    ]


def local_compatibility(prompt, result):
    if any(node["class_type"] in LAUNCHERS for node in prompt.values()):
        raise ValueError(
            "This recipe contains a DeadlineSubmit launcher. Local Spool execution is unavailable; use a separately captured local workflow."
        )
    if any(
        node["class_type"] == "VHS_BatchManager" or node["inputs"].get("meta_batch") is not None
        for node in prompt.values()
    ):
        raise ValueError("VHS meta_batch continuation is not supported yet. Use an unbatched workflow.")
    if prompt[result["nodeId"]]["class_type"] not in SAVERS:
        raise ValueError(
            "Choose SaveImage, PreviewImage, SaveVideo or VHS_VideoCombine with a video format. Animated images are not supported yet."
        )
    for node in prompt.values():
        if node["class_type"] == "VHS_VideoCombine" and str(node["inputs"].get("format", "")).startswith("image/"):
            raise ValueError(
                "Choose a VHS video format such as video/h264-mp4; animated image review is not supported yet."
            )
        if (
            "Load" in node["class_type"]
            and node["class_type"] not in LOADERS
            and any(name in node["inputs"] for name in ("image", "video", "audio", "file", "path"))
        ):
            raise ValueError("This media loader has no dependency-freeze adapter: " + node["class_type"])


def prepare(store, media, project, items, freeze=True):
    pairing = store.host()["configuration"]
    if pairing and pairing["roots"] != {k: str(v) for k, v in media.host_roots.items()}:
        raise Conflict("Spool and its paired Comfy use different media folders")
    requests, audio_bakes, shot_bakes, frozen_assets = [], {}, {}, {}
    for variant_index, item in enumerate(items):
        count = item["count"]
        if type(count) is not int or not 1 <= count <= 16:
            raise ValueError("Choose 1-16 takes per clip")
        clip = next((c for c in project["document"]["clips"] if c["id"] == item["clipId"]), None)
        if clip is None:
            raise ValueError("Selected clip is no longer in this project")
        if clip.get("generationBase") and clip["generationBase"]["takeId"] != clip.get("takeId"):
            raise ValueError("Use the take again to update generation settings before queueing")
        capture = store.workflow(clip.get("workflowVersion"))
        launchers = [node_id for node_id, node in capture["prompt"].items() if node["class_type"] in LAUNCHERS]
        if len(launchers) > 1:
            raise ValueError("Choose a workflow with one explicit Deadline submit node")
        target = execution_target(clip, capture)
        if target not in attempts.TARGETS:
            raise ValueError("Choose local ComfyUI, Comfy Cloud or Deadline execution")
        if target == attempts.CLOUD and not cloud.available():
            raise ValueError(cloud.UNAVAILABLE)
        local_compatibility({k: v for k, v in capture["prompt"].items() if k not in launchers}, capture["result"])
        # A clip set to Deadline whose workflow has no submit node gets one in each
        # frozen request only; the saved workflow and its takes' workflows stay as made.
        added = None
        if target == attempts.DEADLINE and not launchers:
            if capture.get("executionTarget", attempts.LOCAL) != attempts.LOCAL:
                raise ValueError("Comfy Cloud workflows cannot render on Deadline")
            added = deadline_launcher(store.host()["definitions"], clip.get("deadline"))
            launchers = [str(1 + max((int(k) for k in capture["prompt"] if k.isdigit()), default=0))]
        for repeat_index in range(count):
            prompt = copy.deepcopy(capture["prompt"])
            if added:
                prompt[launchers[0]] = copy.deepcopy(added)
            assets = set()
            values = copy.deepcopy(clip.get("inputValues", {}))
            overrides = item.get("values", {})
            bound = {b["key"]: b for b in capture.get("bindings", [])}
            if not isinstance(overrides, dict) or set(overrides) - set(bound):
                raise ValueError("Variations can change only explicitly bound literal controls")
            values.update(overrides)
            bindings = capture.get("bindings", [])
            for binding in bindings:
                if binding.get("asset"):
                    values.setdefault(binding["key"], capture["prompt"][binding["nodeId"]]["inputs"][binding["input"]])
            values, settings = compact_groups(bindings, values, item.get("shotInputs", clip.get("shotInputs", [])))
            problem = input_problem(bindings, values, settings, capture.get("inputRules", []))
            if problem:
                raise ValueError(problem)
            shot_inputs = []
            for setting in settings:
                binding = bound.get(setting.get("key"))
                validate_shot_input(binding, setting)
                source = setting.get("source")
                if binding["slot"] == "audio":
                    key = (clip["id"], source, setting.get("clipId"), setting.get("track"), setting.get("lane", 1))
                    if key not in audio_bakes:
                        audio_bakes[key] = media.bake_audio(
                            audio_input_segments(project["document"], clip, setting),
                            project["document"].get("fps", 24),
                            clip["out"] - clip["in"],
                        )
                    baked = audio_bakes[key]
                    values[binding["key"]] = baked["file"]
                    shot_inputs.append({**setting, **baked})
                    continue
                take = (
                    next((t for t in clip.get("takes", []) if t["id"] == clip.get("takeId")), None)
                    if source == "selected"
                    else next(
                        (t for t in clip.get("takes", []) if not t.get("generated") and not t.get("placeholder")), None
                    )
                    if source == "original"
                    else None
                )
                if not take or take.get("placeholder"):
                    raise ValueError("This shot has no usable original or selected take")
                key = encode(
                    [clip["id"], take["id"], binding["slot"], setting.get("frame"), bool(setting.get("audio", False))]
                )
                if key not in shot_bakes:
                    shot_bakes[key] = media.bake_shot(
                        take["media"],
                        clip["in"],
                        clip["out"],
                        project["document"].get("fps", 24),
                        binding["slot"],
                        setting.get("frame"),
                        setting.get("audio", False),
                    )
                baked = shot_bakes[key]
                values[binding["key"]] = baked["file"]
                shot_inputs.append({"key": binding["key"], "source": source, "takeId": take["id"], **baked})
            for binding in capture.get("bindings", []):
                original = prompt[binding["nodeId"]]["inputs"][binding["input"]]
                value = values.get(binding["key"], original)
                numeric_float = (
                    binding.get("contract", {}).get("inputType") == "FLOAT"
                    and type(original) in (int, float)
                    and type(value) in (int, float)
                )
                if (
                    type(value) is not type(original)
                    and not (type(original) is float and type(value) is int)
                    and not numeric_float
                ):
                    raise ValueError("Bound value has a different literal type")
                prompt[binding["nodeId"]]["inputs"][binding["input"]] = value
                if binding.get("asset"):
                    assets.add((binding["nodeId"], binding["input"]))
            omitted = leave_out(prompt, bindings, values, settings, capture["result"]["nodeId"])
            assets = {(node_id, name) for node_id, name in assets if node_id in prompt}
            for node_id, node in prompt.items():
                name = LOADERS.get(node["class_type"])
                if name and name in node["inputs"]:
                    assets.add((node_id, name))
            if launchers:
                inputs = prompt[launchers[0]]["inputs"]
                if any(isinstance(v, list) for v in inputs.values()):
                    raise ValueError("Deadline submit controls must be literal for a Spool request")
                if not media.project_id and (
                    not isinstance(inputs.get("output_directory"), str) or not inputs["output_directory"]
                ):
                    raise ValueError("Choose a farm-visible Deadline output directory")
                inputs.update({"batch_count": 1, "chunk_size": 1})
            frozen = []
            for node_id, name in sorted(assets):
                original = prompt[node_id]["inputs"][name]
                if not isinstance(original, str):
                    raise ValueError("An asset binding must contain a Comfy input filename")
                original = media.prepare_input(original)
                source = contained(media.host_roots["input"], original.removesuffix(" [input]"))
                if source not in frozen_assets:
                    replacement = media.freeze_asset(original) if freeze else original.removesuffix(" [input]")
                    path = contained(media.host_roots["input"], replacement)
                    frozen_assets[source] = {
                        "frozen": replacement,
                        "byteSize": path.stat().st_size,
                        "sha256": sha256(path),
                    }
                asset = frozen_assets[source]
                prompt[node_id]["inputs"][name] = asset["frozen"]
                frozen.append({"nodeId": node_id, "input": name, "source": original, **asset})
            namespace = "spool/" + uid()
            if media.project_id and launchers:
                prompt[launchers[0]]["inputs"]["output_directory"] = str(media.cache / "deadline")
            for node in prompt.values():
                if node["class_type"] in SAVERS and "filename_prefix" in node["inputs"]:
                    node["inputs"]["filename_prefix"] = namespace
            requests.append(
                (
                    clip,
                    {
                        "capture": capture,
                        "prompt": prompt,
                        "inputValues": values,
                        "shotInputs": shot_inputs,
                        "variantValues": overrides,
                        "variantIndex": variant_index,
                        "repeatIndex": repeat_index,
                        "workflowVersion": clip["workflowVersion"],
                        "outputFolder": clip.get("outputFolder"),
                        "assets": frozen,
                        "omittedInputs": omitted,
                        "outputNamespace": namespace,
                        "requestedExecutionTargets": None,
                        "sequenceFps": project["document"].get("fps", 24),
                        "target": target,
                        "launcherNodeId": launchers[0] if launchers else None,
                        "launcherAdded": bool(added),
                    },
                )
            )
    return requests


def preview(store, media, project_id, revision, clip_id):
    project = store.get(project_id)
    if project["revision"] != revision:
        raise Conflict("Project changed before preparing inputs")
    clip, request = prepare(store, media, project, [{"clipId": clip_id, "count": 1}], freeze=False)[0]
    capture = request["capture"]
    bindings = capture.get("bindings", [])
    assets = []
    for asset in request["assets"]:
        binding = next((b for b in bindings if b["nodeId"] == asset["nodeId"] and b["input"] == asset["input"]), {})
        assets.append(
            {
                **asset,
                "label": binding.get("label", asset["input"]),
                "slot": binding.get("slot"),
                "type": capture["prompt"][asset["nodeId"]]["class_type"],
            }
        )
    if store.revision(project_id) != revision:
        raise Conflict("Project changed while preparing inputs; review again")
    return {
        "clipId": clip_id,
        "revision": revision,
        "target": request["target"],
        "result": capture["result"],
        "assets": assets,
        "shotSeconds": (clip["out"] - clip["in"]) / project["document"].get("fps", 24),
        "controls": [
            {
                "key": b["key"],
                "label": b.get("label", b["input"]),
                "role": b.get("role"),
                "value": request["inputValues"].get(b["key"], capture["prompt"][b["nodeId"]]["inputs"][b["input"]]),
            }
            for b in bindings
            if not b.get("asset")
        ],
    }


def queue_items(data):
    """Normalize the two queue forms before either host or commands freeze requests."""
    items = data.get("items")
    if items is None:
        items = [{"clipId": clip_id, "count": data.get("count", 1)} for clip_id in data.get("clips", [])]
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError("Supply 1-100 clip requests")
    return items


def accept(store, media, project_id, revision, items, operation_id=None, actor="human", experiment=None, scope=None):
    operation_id = operation_id or uid()
    if not isinstance(operation_id, str) or not 1 <= len(operation_id) <= 200:
        raise ValueError("Supply an operation ID of 1-200 characters")
    if not isinstance(actor, str) or not 1 <= len(actor) <= 100:
        raise ValueError("Supply an actor name of 1-100 characters")
    if type(revision) is not int or not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError("Supply the saved revision and 1-100 clip requests")
    payload = {"revision": revision, "items": items, "actor": actor}
    if experiment is not None:
        payload["experiment"] = experiment
    if scope is not None:
        payload["scope"] = scope
    if store.operation(operation_id, project_id, payload) is not None:
        return store.get(project_id)
    project = store.get(project_id)
    if project["revision"] != revision:
        raise Conflict("Project changed before queueing; reload to freeze the intended settings")
    pairing = store.host()["configuration"]
    if pairing and pairing["roots"] != {k: str(v) for k, v in media.host_roots.items()}:
        raise Conflict("Spool and its paired Comfy use different media folders")
    frozen = prepare(store, media, project, items)
    store.accept_queue(operation_id, project_id, revision, payload, frozen, actor)
    return store.get(project_id)
