import copy
import json
import time
import threading
import wave
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch

import jsonschema
from pathlib import Path

from spool import commands, requests, templates, operations
from spool.wire import wire
from spool.store import Conflict
from spool.errors import OperationConflict
import test_queue_operations as fixtures


class CommandTests(unittest.TestCase):
    tearDown = fixtures.QueueOperationTests.tearDown

    def setUp(self):
        fixtures.QueueOperationTests.setUp(self)
        recipe = copy.deepcopy(self.recipe)
        recipe["prompt"]["load"]["inputs"]["seed"] = 18446744073709551615
        recipe["bindings"] = [
            {"key": "seed", "nodeId": "load", "input": "seed", "label": "Seed"},
            {"key": "source", "nodeId": "load", "input": "image", "label": "Image", "asset": True, "slot": "image"},
        ]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        self.project["document"]["clips"][0].update(
            {
                "in": 0,
                "out": 24,
                "takes": [
                    {
                        "id": "original",
                        "media": {
                            "id": "original-media",
                            "kind": "image",
                            "frames": 120,
                            "file": "assets/black.png",
                            "originalFile": "assets/black.png",
                        },
                    }
                ],
            }
        )
        self.project = self.store.save(self.project["id"], self.project["revision"], self.project["document"])

    def envelope(self, action, arguments, identity="command", capability=None):
        return {
            "operationId": identity,
            "revision": self.project["revision"],
            "actor": "agent:test",
            "scope": {
                "projectId": self.project["id"],
                "clipIds": ["shot"],
                "capabilities": [capability or action],
                "maxTakes": 2,
            },
            "action": action,
            "arguments": arguments,
        }

    def execute(self, data):
        value = commands.execute(self.store, self.media, self.project["id"], data)
        schema = json.loads((Path(__file__).resolve().parent.parent / "spool/command-schema.json").read_text())
        jsonschema.validate(wire(data), schema)
        return value

    def test_scoped_rename_and_trim_replay_preserve_following_positions(self):
        document = self.project["document"]
        clip = document["clips"][0]
        clip["gapBefore"] = 10
        following = copy.deepcopy(clip)
        following.update(id="following", gapBefore=20)
        document["clips"].append(following)
        self.project = self.store.save(self.project["id"], self.project["revision"], document)
        rename = self.envelope("rename_clip", {"clipId": "shot", "name": "Renamed"}, capability="edit")
        renamed = self.execute(rename)
        self.assertEqual(self.execute(rename), renamed)
        self.project = self.store.get(self.project["id"])
        self.assertEqual(self.project["document"]["clips"][0]["name"], "Renamed")
        trim = self.envelope("trim_clip", {"clipId": "shot", "edge": "in", "frame": 4}, "trim-in", "edit")
        result = self.execute(trim)
        self.assertEqual(self.execute(trim), result)
        self.project = self.store.get(self.project["id"])
        clip, following = self.project["document"]["clips"]
        self.assertEqual((clip["in"], clip["out"], clip["gapBefore"], following["gapBefore"]), (4, 24, 14, 20))
        self.execute(self.envelope("trim_clip", {"clipId": "shot", "edge": "out", "frame": 80}, "trim-out", "edit"))
        clip, following = self.store.get(self.project["id"])["document"]["clips"]
        self.assertEqual((clip["out"], following["gapBefore"]), (44, 0))
        self.assertEqual(clip["gapBefore"] + clip["out"] - clip["in"] + following["gapBefore"], 54)
        with self.assertRaises(Conflict):
            self.execute(self.envelope("rename_clip", {"clipId": "shot", "name": "Stale"}, "stale", "edit"))
        for args in ({"clipId": "shot", "edge": "in", "frame": True}, {"clipId": "shot", "edge": "bad", "frame": 0}):
            with self.assertRaises(ValueError):
                self.execute(self.envelope("trim_clip", args, "invalid", "edit"))
        with self.assertRaises(ValueError):
            self.execute(self.envelope("rename_clip", {"clipId": "outside", "name": "No"}, "outside", "edit"))

    def test_use_take_adopts_setup_atomically_and_replays_after_intervening_edit(self):
        capture = self.store.workflow(self.project["document"]["clips"][0]["workflowVersion"])
        capture["provenance"] = {"takeBase": {"takeId": "original", "source": "Prepared take setup"}}
        capture["bindings"] = [{"key": "seed", "nodeId": "load", "input": "seed", "label": "Seed"}]
        command = self.envelope("use_take", {"clipId": "shot", "takeId": "original", "capture": capture})
        original = copy.deepcopy(command)
        result = self.execute(command)
        self.assertEqual(command, original, "Preparation must not mutate the frozen replay envelope")
        saved = self.store.get(self.project["id"])
        clip = saved["document"]["clips"][0]
        self.assertEqual(clip["takeId"], "original")
        self.assertEqual(clip["generationBase"]["source"], "Prepared take setup")
        self.assertEqual(clip["inputValues"]["seed"], capture["prompt"]["load"]["inputs"]["seed"])
        self.assertNotEqual(clip["workflowVersion"], self.project["document"]["clips"][0]["workflowVersion"])
        saved["document"]["clips"][0]["name"] = "Human edit"
        later = self.store.save(saved["id"], saved["revision"], saved["document"])
        self.assertEqual(self.execute(command), result)
        self.assertEqual(self.store.get(saved["id"])["revision"], later["revision"])
        self.assertEqual(self.store.get(saved["id"])["document"]["clips"][0]["name"], "Human edit")
        bad = copy.deepcopy(command)
        bad["operationId"] = "wrong-take"
        bad["revision"] = later["revision"]
        bad["arguments"]["capture"]["provenance"]["takeBase"]["takeId"] = "other"
        with self.assertRaises(ValueError):
            self.execute(bad)
        self.assertIsNone(self.store.operation("wrong-take", saved["id"], bad))

    def test_a_missing_take_replay_receipt_never_repeats_adoption(self):
        data = self.envelope("use_take", {"clipId": "shot", "takeId": "original", "capture": None})
        with patch.object(self.store, "operation", return_value=[]):
            with self.assertRaises(OperationConflict):
                operations.use_take(
                    self.store, self.project["id"], self.project["revision"], "shot", "original", command=data
                )
        self.assertEqual(self.store.revision(self.project["id"]), self.project["revision"])
        self.assertIsNone(self.store.operation(data["operationId"], self.project["id"], data))

    def test_explore_respects_float_contract_with_integral_default(self):
        recipe = self.store.workflow(self.project["document"]["clips"][0]["workflowVersion"])
        recipe["prompt"]["load"]["inputs"]["strength"] = 1
        recipe["bindings"].append(
            {"key": "strength", "nodeId": "load", "input": "strength", "contract": {"inputType": "FLOAT"}}
        )
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        args = {"mode": "explore", "variants": [{"clipId": "shot", "values": {"strength": 0.65}}]}
        preview = self.execute(self.envelope("prepare_experiment", args, capability="queue"))
        self.assertEqual(preview["variants"][0]["values"]["strength"], 0.65)
        self.assertFalse(self.store.get(self.project["id"])["document"]["jobs"])
        for values in ({"strength": True}, {"seed": 1.5}, {"seed": False}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                args["variants"][0]["values"] = values
                self.execute(self.envelope("prepare_experiment", args, capability="queue"))

    def test_individual_notes_history_scope_and_stale_text(self):
        self.project["document"]["clips"][0]["intent"] = "Make the watch rotate."
        self.project = self.store.save(self.project["id"], self.project["revision"], self.project["document"])
        shot = commands.status(self.store, self.project["id"])["shots"][0]
        original = shot["notes"][0]
        self.assertEqual(original["status"], "open")

        def act(action, args, identity):
            self.project = self.store.get(self.project["id"])
            return self.execute(self.envelope(action, {"clipId": "shot", **args}, identity, "notes"))

        with self.assertRaises(ValueError):
            self.execute(self.envelope("address_note", {"clipId": "shot"}, capability="edit"))
        with self.assertRaises(Conflict):
            act(
                "address_note",
                {"noteId": original["id"], "expectedText": "old text", "summary": "Changed prompt"},
                "stale",
            )
        with self.assertRaises(ValueError):
            act("address_note", {"noteId": original["id"], "expectedText": original["text"]}, "no-summary")
        result = act(
            "address_note",
            {
                "noteId": original["id"],
                "expectedText": original["text"],
                "summary": "Updated the motion prompt and verified the requested rotation.",
            },
            "addressed",
        )
        self.assertEqual(result["status"], "addressed")
        retry = self.envelope(
            "address_note",
            {
                "clipId": "shot",
                "noteId": original["id"],
                "expectedText": original["text"],
                "summary": "Updated the motion prompt and verified the requested rotation.",
            },
            "addressed",
            "notes",
        )
        self.assertEqual(self.execute(retry), result)
        pending = act("reopen_note", {"noteId": original["id"], "expectedText": original["text"]}, "reopened")
        self.assertNotEqual(pending["noteId"], original["id"])
        with self.assertRaises(ValueError):
            act("reopen_note", {"noteId": original["id"], "expectedText": original["text"]}, "duplicate-reopen")
        act(
            "edit_note",
            {"noteId": pending["noteId"], "expectedText": original["text"], "text": "Rotate more slowly."},
            "edit",
        )
        notes = commands.status(self.store, self.project["id"])["shots"][0]["notes"]
        self.assertEqual(notes[0]["status"], "addressed")
        self.assertEqual(notes[0]["text"], original["text"])
        self.assertEqual(notes[1]["reopenedFrom"], original["id"])
        self.assertEqual(notes[1]["versions"][0]["text"], original["text"])
        self.assertEqual(notes[1]["text"], "Rotate more slowly.")
        self.assertFalse(self.store.get(self.project["id"])["document"]["jobs"])

    def test_notes_work_on_independent_audio_and_never_queue(self):
        self.project["document"]["audioClips"] = [{"id": "audio", "name": "Music", "in": 0, "out": 24}]
        self.project = self.store.save(self.project["id"], self.project["revision"], self.project["document"])
        data = self.envelope("add_note", {"clipId": "audio", "text": "Lower the music."}, "audio-note", "notes")
        data["scope"]["clipIds"] = ["audio"]
        result = self.execute(data)
        status = commands.status(self.store, self.project["id"])
        self.assertEqual(status["audioClips"][0]["notes"][0]["id"], result["noteId"])
        self.assertFalse(status["jobs"])

    def test_generation_audio_tracks_clips_and_disabled_video_lanes(self):
        shot = self.project["document"]["clips"][0]
        shot.update({"gapBefore": 24, "in": 12, "out": 36})
        av = {"id": "av", "kind": "video", "file": "av.mp4", "audio": True}
        upper = {
            "id": "upper",
            "videoTrack": 2,
            "gapBefore": 12,
            "in": 6,
            "out": 54,
            "takeId": "upper-take",
            "takes": [{"id": "upper-take", "media": av}],
            "audio": {"gainDb": -3, "fadeIn": 12},
        }
        music = {
            "id": "music",
            "track": "music",
            "start": 36,
            "in": 12,
            "out": 60,
            "media": {"id": "sound", "kind": "audio", "file": "tone.wav"},
        }
        d = {**self.project["document"], "clips": [shot, upper], "audioClips": [music], "disabledVideoTracks": []}
        setting = {"source": "track", "track": "source", "lane": 2}
        segments = requests.audio_input_segments(d, shot, setting)
        self.assertEqual([(s["start"], s["in"], s["out"], s["audio"]["gainDb"]) for s in segments], [(-12, 6, 54, -3)])
        d["disabledVideoTracks"] = [2]
        self.assertEqual(requests.audio_input_segments(d, shot, setting), [])
        d["disabledVideoTracks"] = []
        upper["enabled"] = False
        self.assertEqual(requests.audio_input_segments(d, shot, setting), [])
        sound = requests.audio_input_segments(d, shot, {"source": "track", "track": "music"})
        self.assertEqual((sound[0]["start"], sound[0]["in"]), (12, 12))
        d["audioTracks"] = {"sourceSolo": True}
        self.assertEqual(requests.audio_input_segments(d, shot, {"source": "track", "track": "music"}), [])
        for target in ("music", "upper"):
            self.assertEqual(
                requests.audio_input_segments(d, shot, {"source": "clip", "clipId": target})[0]["start"], 0
            )
        with self.assertRaisesRegex(ValueError, "removed"):
            requests.audio_input_segments(d, shot, {"source": "clip", "clipId": "gone"})
        with self.assertRaisesRegex(ValueError, "no audio"):
            requests.audio_input_segments(d, shot, {"source": "original"})

    def test_audio_generation_command_and_request_freeze_real_wav(self):
        path = self.media.root / "tone.wav"
        with wave.open(str(path), "wb") as sound:
            sound.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
            sound.writeframes(b"\x00\x10" * 48000)
        recipe = copy.deepcopy(self.recipe)
        recipe["prompt"]["audio"] = {"class_type": "LoadAudio", "inputs": {"audio": "unused.wav"}}
        recipe["bindings"] = [
            {
                "key": "audio",
                "nodeId": "audio",
                "input": "audio",
                "asset": True,
                "slot": "audio",
                "label": "Source audio",
            }
        ]
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", recipe)
        self.project["document"]["audioClips"] = [
            {
                "id": "music",
                "track": "music",
                "start": 12,
                "in": 0,
                "out": 24,
                "media": {"id": "tone", "kind": "audio", "file": "tone.wav"},
            }
        ]
        self.project = self.store.save(self.project["id"], self.project["revision"], self.project["document"])
        setting = {"key": "audio", "source": "track", "track": "music"}
        self.execute(self.envelope("set_shot_inputs", {"clipId": "shot", "inputs": [setting]}, capability="inputs"))
        self.project = self.store.get(self.project["id"])
        with patch.object(self.media, "bake_audio", wraps=self.media.bake_audio) as bake:
            queued = requests.accept(
                self.store, self.media, self.project["id"], self.project["revision"], [{"clipId": "shot", "count": 2}]
            )
        self.assertEqual(bake.call_count, 1)
        frozen = self.store.attempt(queued["document"]["jobs"][0]["id"])["request"]
        asset = next(a for a in frozen["assets"] if a["nodeId"] == "audio")
        target = self.media.host_roots["input"] / asset["frozen"]
        self.assertEqual(frozen["prompt"]["audio"]["inputs"]["audio"], asset["frozen"])
        self.assertEqual(frozen["shotInputs"][0]["settings"]["sources"][0]["startSeconds"], 0.5)
        with wave.open(str(target)) as sound:
            self.assertEqual((sound.getnchannels(), sound.getframerate(), sound.getnframes()), (2, 48000, 48000))
            self.assertEqual(sound.readframes(20000), b"\x00" * 80000)
            sound.setpos(30000)
            self.assertNotEqual(sound.readframes(1000), b"\x00" * 4000)
        original = target.read_bytes()
        path.write_bytes(b"changed original")
        self.assertEqual(target.read_bytes(), original)
        second = self.store.attempt(queued["document"]["jobs"][1]["id"])["request"]
        self.assertEqual(next(a["sha256"] for a in second["assets"] if a["nodeId"] == "audio"), asset["sha256"])

    def test_mutation_retry_does_not_overwrite_intervening_human_edit(self):
        data = self.envelope("set_inputs", {"clipId": "shot", "values": {"seed": 123}}, capability="inputs")
        first = self.execute(data)
        human = self.store.get(self.project["id"])
        human["document"]["clips"][0]["inputValues"]["seed"] = 456
        self.store.save(human["id"], human["revision"], human["document"])
        self.assertEqual(self.execute(data), first)
        self.assertEqual(self.store.get(human["id"])["document"]["clips"][0]["inputValues"]["seed"], 456)
        wrong = copy.deepcopy(data)
        wrong["arguments"]["values"]["seed"] = 99
        with self.assertRaises(Conflict):
            self.execute(wrong)

    def test_repeat_and_explore_preserve_baseline_and_exact_integer(self):
        args = {"mode": "repeat", "intent": "Compare motion", "variants": [{"clipId": "shot", "count": 2}]}
        data = self.envelope("queue_experiment", args, capability="queue")
        first = self.execute(data)
        self.assertEqual(len(first["jobs"]), 2)
        human = self.store.get(self.project["id"])
        human["document"]["clips"][0]["name"] = "Edited after queue"
        self.store.save(human["id"], human["revision"], human["document"])
        self.assertEqual(len(self.execute(data)["jobs"]), 2)
        for job in first["jobs"]:
            request = self.store.attempt(job["id"])["request"]
            self.assertEqual(request["inputValues"]["seed"], 18446744073709551615)
        self.project = self.store.get(human["id"])
        args = {
            "mode": "explore",
            "variants": [{"clipId": "shot", "values": {"seed": 7}}, {"clipId": "shot", "values": {"seed": 9}}],
        }
        data = self.envelope("queue_experiment", args, "explore", "queue")
        result = self.execute(data)
        self.assertEqual(result["shots"][0]["inputs"]["seed"], 18446744073709551615)
        self.assertEqual(result["shots"][0]["selectedTakeId"], "original")
        self.assertEqual(
            [self.store.attempt(j["id"])["request"]["inputValues"]["seed"] for j in result["jobs"][-2:]], [7, 9]
        )

    def test_scope_budget_and_revision_rejections_accept_no_work(self):
        data = self.envelope(
            "queue_experiment", {"mode": "repeat", "variants": [{"clipId": "shot", "count": 3}]}, capability="queue"
        )
        with self.assertRaisesRegex(ValueError, "budget"):
            self.execute(data)
        data["arguments"]["variants"][0]["count"] = 1
        data["scope"]["clipIds"] = []
        with self.assertRaisesRegex(ValueError, "scope"):
            self.execute(data)
        data["scope"]["clipIds"] = ["shot"]
        data["revision"] -= 1
        with self.assertRaises(Conflict):
            self.execute(data)
        self.assertEqual(self.store.pending(), [])

    def test_feedback_does_not_select_take_and_status_omits_graphs(self):
        data = self.envelope(
            "feedback",
            {"clipId": "shot", "takeId": "original", "verdict": "keep", "note": "Good framing"},
            capability="feedback",
        )
        self.execute(data)
        self.execute(data)
        value = commands.status(self.store, self.project["id"])
        self.assertEqual(len(value["feedback"]), 1)
        self.assertNotIn("prompt", json.dumps(value))
        self.assertEqual(value["shots"][0]["selectedTakeId"], "original")
        choose = self.envelope("choose_take", {"clipId": "shot", "takeId": "original"}, "choose", "queue")
        with self.assertRaisesRegex(ValueError, "choose_take"):
            self.execute(choose)

    def test_status_reports_optional_inputs_and_set_inputs_can_fill_or_clear_them(self):
        capture = templates.own_capture("api_minimax_h3_r2v")
        self.project = self.store.capture(self.project["id"], self.project["revision"], "shot", capture)
        shot = commands.status(self.store, self.project["id"])["shots"][0]
        self.assertEqual(shot["inputProblem"], "Add a reference image or video.")
        self.assertEqual(shot["inputRules"], capture["inputRules"])
        self.assertEqual(
            [b["label"] for b in shot["bindings"] if b.get("group") == "Reference images"],
            ["Reference image 1", "Reference image 2", "Reference image 3", "Reference image 4"],
        )
        self.execute(
            self.envelope("set_inputs", {"clipId": "shot", "values": {"4/image": "subject.png"}}, "fill", "inputs")
        )
        self.assertIsNone(commands.status(self.store, self.project["id"])["shots"][0]["inputProblem"])
        self.project = self.store.get(self.project["id"])
        document = self.project["document"]
        document["clips"][0]["shotInputs"] = [{"key": "7/file", "source": "selected"}]
        self.project = self.store.save(self.project["id"], self.project["revision"], document)
        self.execute(
            self.envelope("set_inputs", {"clipId": "shot", "values": {"4/image": "", "7/file": ""}}, "clear", "inputs")
        )
        shot = commands.status(self.store, self.project["id"])["shots"][0]
        self.assertEqual((shot["inputs"]["4/image"], shot["inputProblem"]), ("", "Add a reference image or video."))
        self.assertEqual(self.store.get(self.project["id"])["document"]["clips"][0]["shotInputs"], [])

    def test_choose_take_fits_the_clip_to_a_shorter_take_like_use_take(self):
        document = self.project["document"]
        document["clips"][0]["takes"].append(
            {
                "id": "short",
                "media": {
                    "id": "short-media",
                    "kind": "image",
                    "frames": 10,
                    "file": "assets/black.png",
                    "originalFile": "assets/black.png",
                },
            }
        )
        self.project = self.store.save(self.project["id"], self.project["revision"], document)
        version = self.project["document"]["clips"][0]["workflowVersion"]
        self.execute(self.envelope("choose_take", {"clipId": "shot", "takeId": "short"}))
        clip = self.store.get(self.project["id"])["document"]["clips"][0]
        self.assertEqual((clip["takeId"], clip["in"], clip["out"]), ("short", 0, 10))
        self.assertEqual(self.store.get(self.project["id"])["document"]["tailGap"], 14)
        self.assertEqual(clip["workflowVersion"], version, "Choosing a take does not adopt its workflow")

    def test_apply_workflow_resets_target_seed_and_take_setup_like_the_library(self):
        document = self.project["document"]
        version = document["clips"][0]["workflowVersion"]
        document["clips"][0].update(
            executionTarget="cloud",
            seedKey="seed",
            seedMode="increment",
            generationBase={"takeId": "original"},
            shotInputs=[{"key": "source", "source": "selected"}],
        )
        self.project = self.store.save(self.project["id"], self.project["revision"], document)
        self.execute(
            self.envelope("apply_workflow", {"clipId": "shot", "workflowVersion": version}, capability="workflow")
        )
        clip = self.store.get(self.project["id"])["document"]["clips"][0]
        self.assertEqual((clip["executionTarget"], clip["seedMode"]), ("local", "same"))
        for key in ("seedKey", "generationBase", "shotInputs"):
            self.assertNotIn(key, clip)

    def test_focus_requires_one_fresh_view_or_explicit_view(self):
        self.store.publish_focus(self.project["id"], "editor", {"clipId": "shot"})
        self.assertEqual(self.store.focused(self.project["id"])["clipId"], "shot")
        self.store.publish_focus(self.project["id"], "dock", {"clipId": "shot"})
        with self.assertRaises(Conflict):
            self.store.focused(self.project["id"])
        self.assertEqual(self.store.focused(self.project["id"], "editor")["viewId"], "editor")
        with patch("spool.store.time.time", return_value=time.time() + 20), self.assertRaises(Conflict):
            self.store.focused(self.project["id"], "editor")

    def test_cancel_unclaimed_is_idempotent_and_cannot_cancel_other_shot(self):
        data = self.envelope("queue_experiment", {"mode": "repeat", "variants": [{"clipId": "shot"}]}, "queue", "queue")
        job = self.execute(data)["jobs"][0]
        cancel = self.envelope("cancel", {"attemptId": job["id"]}, "cancel", "cancel")
        self.assertEqual(self.execute(cancel)["status"], "cancelled")
        self.assertEqual(self.execute(cancel)["status"], "cancelled")
        self.assertNotIn(job["id"], self.store.pending())
        finished = next(j for j in self.store.get(self.project["id"])["document"]["jobs"] if j["id"] == job["id"])[
            "finishedAt"
        ]
        self.assertIsNotNone(finished)

    def test_local_uncertain_attempt_is_dismissed_and_running_local_work_is_refused(self):
        data = self.envelope("queue_experiment", {"mode": "repeat", "variants": [{"clipId": "shot"}]}, "queue", "queue")
        job = self.execute(data)["jobs"][0]
        self.store.transition(job["id"], "queued")
        with self.assertRaisesRegex(ValueError, "ComfyUI's queue"):
            self.execute(self.envelope("cancel", {"attemptId": job["id"]}, "cancel-running", "cancel"))
        self.assertEqual(self.store.attempt(job["id"])["status"], "queued")
        self.store.transition(job["id"], "uncertain", error="Absent from Comfy queue and history")
        before = self.store.active_attempts(self.project["id"])
        self.assertEqual(
            self.execute(self.envelope("cancel", {"attemptId": job["id"]}, "dismiss", "cancel"))["status"], "cancelled"
        )
        self.assertEqual(self.store.active_attempts(self.project["id"]), before - 1)
        self.assertNotIn(job["id"], self.store.pending())
        statuses = [
            e["data"]["status"]
            for e in self.store.events(self.project["id"], limit=500, latest=True)["events"]
            if e["kind"] == "attempt.status" and e["data"]["attemptId"] == job["id"]
        ]
        self.assertEqual(statuses[-1], "cancelled")

    def test_concurrent_experiments_share_one_atomic_outstanding_job_budget(self):
        barrier = threading.Barrier(2)
        original = commands.requests.prepare

        def prepared(*args):
            result = original(*args)
            barrier.wait(timeout=5)
            return result

        values = [
            self.envelope(
                "queue_experiment", {"mode": "repeat", "variants": [{"clipId": "shot", "count": 2}]}, identity, "queue"
            )
            for identity in ("one", "two")
        ]
        for value in values:
            value["scope"]["maxConcurrent"] = 2
        with patch("spool.commands.requests.prepare", side_effect=prepared), ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(self.execute, value) for value in values]
            errors = [future.exception() for future in futures]
        self.assertEqual(sum(error is None for error in errors), 1)
        self.assertEqual(len(self.store.get(self.project["id"])["document"]["jobs"]), 2)

    def test_owned_cancel_retry_recovers_an_uncertain_external_effect(self):
        attempt_id, submission, cancel = self.owned_cancel()
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], RuntimeError("lost response")]):
            with self.assertRaisesRegex(RuntimeError, "lost response"):
                self.execute(cancel)
        self.assertIn("lost response", self.store.attempt(attempt_id)["error"])
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]) as external:
            replay = self.execute(cancel)
            self.assertIn("Cancellation requested", replay["note"])
            self.assertEqual(external.call_count, 2)
        with patch("spool.farm.deadline_command") as external:
            self.assertEqual(self.execute(cancel), replay)
            external.assert_not_called()
        self.assertIsNone(self.store.attempt(attempt_id)["error"])

    def test_crash_after_send_before_acknowledge_allows_cancel_retry(self):
        attempt_id, submission, cancel = self.owned_cancel()
        with (
            patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]),
            patch.object(self.store, "finish_cancellation", side_effect=KeyboardInterrupt),
        ):
            with self.assertRaises(KeyboardInterrupt):
                self.execute(cancel)
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]) as external:
            self.execute(cancel)
            self.assertEqual(external.call_count, 2)
        self.assertIsNone(self.store.attempt(attempt_id)["error"])

    def owned_cancel(self):
        queued = self.execute(
            self.envelope("queue_experiment", {"mode": "repeat", "variants": [{"clipId": "shot"}]}, "queue", "queue")
        )
        attempt_id = queued["jobs"][0]["id"]
        submission = self.store.submission(attempt_id, {})
        self.store.acknowledge(submission["id"], "owned-job")
        self.store.transition(attempt_id, "farm_running")
        return attempt_id, submission, self.envelope("cancel", {"attemptId": attempt_id}, "cancel", "cancel")

    def test_cancel_lookup_failure_leaves_same_envelope_retryable(self):
        attempt_id, submission, cancel = self.owned_cancel()
        with patch("spool.farm.deadline_command", side_effect=OSError("scheduler unavailable")) as external:
            with self.assertRaisesRegex(ValueError, "not sent; retry Cancel request"):
                self.execute(cancel)
            self.assertEqual(external.call_count, 1)
        self.assertEqual(self.store.attempt(attempt_id)["status"], "farm_running")
        self.assertIsNone(self.store.operation(cancel["operationId"], self.project["id"], cancel))
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM effects").fetchone()[0], 0)
        # A fresh store instance can recover the exact command after a restart.
        self.store = type(self.store)(self.store.root)
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]) as external:
            result = self.execute(cancel)
            self.assertEqual(result["status"], "cancel_requested")
            self.assertEqual(external.call_args_list[-1].args[0], ["-FailJob", "owned-job"])
            self.assertEqual(self.execute(cancel), result)
            self.assertEqual(external.call_count, 2)
        self.assertIsNone(self.store.attempt(attempt_id)["error"])

    def test_cancel_ownership_rejection_does_not_claim_or_send(self):
        attempt_id, submission, cancel = self.owned_cancel()
        with patch("spool.farm.deadline_command", return_value="another-submission") as external:
            with self.assertRaisesRegex(ValueError, "ownership did not match; no cancellation was sent"):
                self.execute(cancel)
            self.assertEqual(external.call_count, 1)
        self.assertEqual(self.store.attempt(attempt_id)["status"], "farm_running")
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]) as external:
            self.execute(cancel)
            self.assertEqual(external.call_count, 2)

    def test_concurrent_cancel_commands_only_repeat_unfinished_delivery(self):
        attempt_id, submission, cancel = self.owned_cancel()
        other = copy.deepcopy(cancel)
        other["operationId"] = "another-cancel"
        barrier = threading.Barrier(2)

        def transport(arguments):
            if arguments[0] == "-GetJobExtraInfoKeyValue":
                barrier.wait(timeout=5)
                return submission["id"]
            return "Job failed"

        with patch("spool.farm.deadline_command", side_effect=transport) as external, ThreadPoolExecutor(2) as pool:
            results = list(pool.map(self.execute, [cancel, other]))
        self.assertTrue(all(result["status"] == "cancel_requested" for result in results))
        self.assertIn(sum(call.args[0][0] == "-FailJob" for call in external.call_args_list), (1, 2))
        with self.store.connect() as db:
            self.assertIn(db.execute("SELECT count(*) FROM effects").fetchone()[0], (1, 2))
        with patch("spool.farm.deadline_command") as external:
            self.execute(cancel)
            self.execute(other)
            external.assert_not_called()
        self.assertEqual(self.store.attempt(attempt_id)["status"], "cancel_requested")

    def test_replay_of_claimed_cancellation_after_restart_resends(self):
        attempt_id, submission, cancel = self.owned_cancel()
        # Simulate termination after the durable transaction and before transport.
        with patch(
            "spool.farm.deadline_command", side_effect=[self.store.submission(attempt_id, {})["id"], KeyboardInterrupt]
        ):
            with self.assertRaises(KeyboardInterrupt):
                self.execute(cancel)
        self.store = type(self.store)(self.store.root)
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]) as external:
            result = self.execute(cancel)
            self.assertIn("Cancellation requested", result["note"])
            self.assertEqual(external.call_count, 2)
        self.assertIsNone(self.store.attempt(attempt_id)["error"])

    def test_new_command_retries_unfinished_delivery_after_stale_observation(self):
        attempt_id, submission, cancel = self.owned_cancel()
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], RuntimeError("lost response")]):
            with self.assertRaises(RuntimeError):
                self.execute(cancel)
        self.assertFalse(self.store.transition(attempt_id, "farm_running"))
        cancel["operationId"] = "cancel-again"
        with patch("spool.farm.deadline_command", side_effect=[submission["id"], "Job failed"]) as external:
            self.assertIn("Cancellation requested", self.execute(cancel)["note"])
            self.assertEqual(external.call_count, 2)
        self.assertEqual(self.store.attempt(attempt_id)["status"], "cancel_requested")

    def test_completed_during_cancel_lookup_is_not_failed(self):
        attempt_id, submission, cancel = self.owned_cancel()

        def lookup(arguments):
            self.store.accept_execution(attempt_id, "late-execution", submission["id"], {})
            return submission["id"]

        with patch("spool.farm.deadline_command", side_effect=lookup) as external:
            with self.assertRaisesRegex(ValueError, "already finished"):
                self.execute(cancel)
            self.assertEqual(external.call_count, 1)
        self.assertEqual(self.store.attempt(attempt_id)["status"], "complete")


if __name__ == "__main__":
    unittest.main()
