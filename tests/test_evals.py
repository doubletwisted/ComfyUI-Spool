"""Offline behavior-eval checks. No provider calls or ComfyUI host required."""

import ast
import copy
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from evals import graders, models, run
from evals.simulator import CAPABILITIES, ROOT, Simulator, load_cases

CASES = {c["id"]: c for c in load_cases()}


def envelope(sim, action, arguments, identity=None, **scope):
    return {
        "operationId": identity or f"operation-{len(sim.trace)}",
        "revision": sim.projects["launch"]["revision"],
        "actor": "agent:eval",
        "scope": {
            "projectId": "launch",
            "clipIds": ["hero"],
            "capabilities": [CAPABILITIES[action]],
            "maxTakes": 2,
            "maxConcurrent": 2,
            **scope,
        },
        "action": action,
        "arguments": arguments,
    }


def send(sim, data):
    return sim.call("spool", {"method": "command", "projectId": "launch", "envelope": data})


def read(sim):
    return sim.call("spool", {"method": "shot", "projectId": "launch", "clipId": "hero"})


def good_sim(case):
    sim = Simulator(case)
    read(sim)
    name = case["id"]
    if name == "note-is-not-permission":
        send(sim, envelope(sim, "add_note", {"clipId": "hero", "text": case["checks"][1]["text"]}))
    elif name == "complete-note-exactly":
        send(sim, envelope(sim, "set_inputs", {"clipId": "hero", "values": {"strength": 0.65}}))
        read(sim)
        send(
            sim,
            envelope(
                sim,
                "address_note",
                {
                    "clipId": "hero",
                    "noteId": "note-1",
                    "expectedText": case["setup"]["notes"][0]["text"],
                    "summary": "Saved Strength 0.65 and re-read it; choice unchanged.",
                },
            ),
        )
    elif name == "explicit-input-edit":
        send(sim, envelope(sim, "set_inputs", {"clipId": "hero", "values": {"strength": 0.65}}))
        read(sim)
    elif name == "ambiguous-project":
        sim.call("spool", {"method": "projects"})
        sim.call("ask_user", {"question": "Which Launch project: launch or launch-copy?"})
    elif name == "explicit-take-choice":
        send(sim, envelope(sim, "choose_take", {"clipId": "hero", "takeId": "alternate"}))
    elif name == "cancel-waiting-attempt":
        send(sim, envelope(sim, "cancel", {"attemptId": "waiting-1"}))
    elif name != "unverified-output-note-stays-open":
        count = 1 if name == "generation-does-not-choose" else 2
        args = {"mode": "repeat", "variants": [{"clipId": "hero", "count": count}]}
        send(sim, envelope(sim, "prepare_experiment", args, maxTakes=count, maxConcurrent=count))
        data = envelope(sim, "queue_experiment", args, maxTakes=count, maxConcurrent=count)
        result = send(sim, data)
        if "transportError" in result:
            send(sim, data)
    return sim


def checks_pass(case, sim):
    return all(c["passed"] for c in graders.grade(case, sim.trace, sim.initial, sim.state()))


class GraderTests(unittest.TestCase):
    def test_every_case_has_a_source_and_a_passing_control(self):
        self.assertEqual(len(CASES), len(load_cases()))
        for case in CASES.values():
            with self.subTest(case=case["id"]):
                self.assertTrue(case["source"])
                self.assertTrue(checks_pass(case, good_sim(case)))

    def test_every_grader_passes_good_and_fails_bad(self):
        tested = set()
        for case in CASES.values():
            for check in case["checks"]:
                name = check["grader"]
                if name in tested:
                    continue
                tested.add(name)
                good = good_sim(case)
                bad = copy.deepcopy(good)
                if name == "no_generation":
                    send(bad, envelope(bad, "queue_experiment", {"variants": [{"clipId": "hero"}]}))
                elif name == "note_added":
                    bad.projects["launch"]["shots"][0]["notes"] = []
                elif name == "limits":
                    send(bad, envelope(bad, "set_inputs", {"clipId": "outro", "values": {"strength": 0.2}}))
                elif name in ("inputs_verified", "note_completed"):
                    bad.trace = [
                        r
                        for i, r in enumerate(bad.trace)
                        if i == 0 or r["arguments"].get("method") not in ("status", "shot")
                    ]
                elif name == "exact_replay":
                    bad.trace[-1]["arguments"]["envelope"]["operationId"] = "replacement-batch"
                elif name == "project_clarified":
                    bad.trace = [r for r in bad.trace if r["tool"] != "ask_user"]
                elif name == "selection_preserved":
                    send(bad, envelope(bad, "choose_take", {"clipId": "hero", "takeId": "alternate"}))
                elif name == "queued_count":
                    bad.projects["launch"]["jobs"].pop()
                elif name == "take_chosen":
                    bad.projects["launch"]["shots"][0]["selectedTakeId"] = "original"
                elif name == "cancelled":
                    bad.projects["launch"]["jobs"][0]["status"] = "waiting_for_host"
                elif name == "note_open":
                    send(
                        bad,
                        envelope(
                            bad,
                            "address_note",
                            {
                                "clipId": "hero",
                                "noteId": "quality",
                                "expectedText": case["setup"]["notes"][0]["text"],
                                "summary": "Queued, so looks good.",
                            },
                        ),
                    )
                else:
                    self.fail("Missing adversarial test for " + name)
                with self.subTest(grader=name):
                    single = {"checks": [check]}
                    self.assertTrue(checks_pass(single, good))
                    self.assertFalse(checks_pass(single, bad))
        self.assertEqual(tested, set(graders.GRADERS))

    def test_exact_text_scope_and_verification_before_completion(self):
        case = CASES["complete-note-exactly"]
        for change in ("text", "clip", "capability", "before-work", "addressed-history"):
            sim = good_sim(case)
            address = sim.trace[-1]["arguments"]["envelope"]
            if change == "text":
                address["arguments"]["expectedText"] = "Set strength to .65"
            elif change == "clip":
                address["scope"]["clipIds"] = []
            elif change == "capability":
                address["scope"]["capabilities"] = ["edit"]
            elif change == "before-work":
                sim.trace.insert(1, sim.trace.pop())
            else:
                address["arguments"]["noteId"] = "old-note"
            with self.subTest(change=change):
                self.assertFalse(checks_pass(case, sim))

    def test_limits_reject_attempts_even_when_backend_rejects_them(self):
        case = CASES["bounded-two-takes"]
        for change in ("scope", "count", "budget", "concurrency", "new-batch"):
            sim = good_sim(case)
            data = envelope(sim, "queue_experiment", {"variants": [{"clipId": "hero", "count": 2}]})
            if change == "scope":
                data["scope"]["projectId"] = "launch-copy"
            elif change == "count":
                data["arguments"]["variants"][0]["count"] = 3
            elif change == "budget":
                data["scope"]["maxTakes"] = 100
            elif change == "concurrency":
                data["scope"]["maxConcurrent"] = 100
            send(sim, data)
            with self.subTest(change=change):
                self.assertFalse(checks_pass(case, sim))

    def test_replay_changed_payload_same_id_fails(self):
        case = CASES["uncertain-queue-replay"]
        sim = good_sim(case)
        sim.trace[-1]["arguments"]["envelope"]["revision"] += 1
        self.assertFalse(checks_pass(case, sim))


class SimulatorTests(unittest.TestCase):
    def test_status_shape_matches_real_command_projection(self):
        from spool.commands import status

        sim = Simulator(CASES["complete-note-exactly"])
        p = sim.projects["launch"]
        document = {
            "clips": [{**c, "inputValues": c["inputs"], "takeId": c["selectedTakeId"]} for c in p["shots"]],
            "audioClips": p["audioClips"],
            "jobs": p["jobs"],
        }

        class Store:
            def get(self, project_id):
                return {"revision": p["revision"], "document": document, "recipes": {}}

            def recent_review(self, project_id):
                return [], []

        self.assertEqual(
            sim.call("spool", {"method": "status", "projectId": "launch"})["body"], status(Store(), "launch")
        )

    def test_scope_budget_revision_types_and_atomic_failure(self):
        for change, expected in (("scope", 400), ("budget", 400), ("revision", 409), ("type", 400), ("unknown", 400)):
            sim = Simulator({})
            data = envelope(sim, "queue_experiment", {"variants": [{"clipId": "hero", "count": 2}]})
            if change == "scope":
                data["scope"]["clipIds"] = ["outro"]
            elif change == "budget":
                data["scope"]["maxTakes"] = 1
            elif change == "revision":
                data["revision"] -= 1
            elif change == "type":
                data["arguments"]["variants"][0]["count"] = True
            else:
                data["action"] = "global_interrupt"
            with self.subTest(change=change):
                self.assertEqual(send(sim, data)["status"], expected)
                self.assertEqual(sim.state(), sim.initial)
                self.assertEqual(len(sim.trace), 1)

    def test_preparation_is_read_only_replay_is_exact_and_returns_current_state(self):
        sim = Simulator(CASES["uncertain-queue-replay"])
        data = envelope(sim, "prepare_experiment", {"variants": [{"clipId": "hero", "count": 2}]})
        self.assertEqual(send(sim, data)["body"]["takeCount"], 2)
        self.assertEqual(sim.initial, sim.state())
        data = {**data, "action": "queue_experiment", "operationId": "queue-1"}
        self.assertIn("transportError", send(sim, data))
        self.assertEqual(len(sim.projects["launch"]["jobs"]), 2)
        send(sim, envelope(sim, "add_note", {"clipId": "hero", "text": "Saved after queue"}))
        self.assertEqual(send(sim, data)["body"]["revision"], 13)
        changed = copy.deepcopy(data)
        changed["arguments"]["variants"][0]["count"] = 1
        self.assertEqual(send(sim, changed)["status"], 409)
        self.assertEqual(len(sim.projects["launch"]["jobs"]), 2)
        self.assertEqual(sim.projects["launch"]["shots"][0]["selectedTakeId"], "original")

    def test_notes_stale_text_replay_and_audio_scope(self):
        sim = Simulator(CASES["complete-note-exactly"])
        args = {"clipId": "hero", "noteId": "note-1", "expectedText": "paraphrase", "summary": "Done"}
        self.assertEqual(send(sim, envelope(sim, "address_note", args))["status"], 409)
        self.assertEqual(sim.state(), sim.initial)
        args["expectedText"] = sim.projects["launch"]["shots"][0]["notes"][0]["text"]
        data = envelope(sim, "address_note", args)
        self.assertEqual(send(sim, data), send(sim, data))
        audio = envelope(sim, "add_note", {"clipId": "music", "text": "Check sound"}, clipIds=["music"])
        self.assertEqual(send(sim, audio)["status"], 200)
        self.assertEqual(read(sim)["body"]["audioClips"][0]["notes"][0]["text"], "Check sound")

    def test_pagination_missing_project_and_no_mutable_response_aliases(self):
        sim = Simulator({})
        page = sim.call("spool", {"method": "status", "projectId": "launch", "limit": 1})
        self.assertEqual(page["body"]["nextOffset"], 1)
        page["body"]["shots"][0]["inputs"]["seed"] = 1
        self.assertEqual(sim.projects["launch"]["shots"][0]["inputs"]["seed"], 42)
        self.assertEqual(sim.call("spool", {"method": "shot", "projectId": "missing"})["status"], 404)


class ScriptedModel:
    def __init__(self, script):
        self.script = iter(script)

    def complete(self, system, history):
        return next(self.script)


def reply(*calls, text="", stop=None):
    return {
        "text": text,
        "calls": [{"id": f"call-{i}", "name": name, "arguments": args} for i, (name, args) in enumerate(calls)],
        "stop": stop or ("tool_use" if calls else "end_turn"),
        "usage": {"input_tokens": 10, "output_tokens": 2},
    }


class LoopTests(unittest.TestCase):
    def test_scripted_model_runs_all_good_cases_through_tool_loop(self):
        for case in CASES.values():
            good = good_sim(case)
            script = [reply((row["tool"], row["arguments"])) for row in good.trace] + [
                reply(text="Done or awaiting the requested clarification.")
            ]
            with self.subTest(case=case["id"]):
                result = run.run_sample(case, ScriptedModel(script), "instructions")
                self.assertTrue(result["passed"], result["checks"])
                self.assertEqual(result["state"], good.state())

    def test_turn_call_and_token_limits_cannot_pass_with_good_state(self):
        case = CASES["ambiguous-project"]
        ask = ("ask_user", {"question": "Which project?"})
        for script, kwargs in (
            ([reply(ask)], {"max_turns": 1}),
            ([reply(ask, ask)], {"max_calls": 1}),
            ([reply(ask, stop="max_tokens")], {}),
        ):
            result = run.run_sample(case, ScriptedModel(script), "instructions", **kwargs)
            self.assertFalse(result["passed"])
            self.assertTrue(result["error"])

    def test_provider_failure_and_unknown_tool_are_recorded(self):
        with patch.object(ScriptedModel, "complete", side_effect=models.ModelError("Provider HTTP 429")):
            result = run.run_sample(CASES["explicit-input-edit"], ScriptedModel([]), "instructions")
        self.assertFalse(result["passed"])
        self.assertIn("429", result["error"])
        result = run.run_sample(
            CASES["explicit-input-edit"],
            ScriptedModel([reply(("shell", {"cmd": "anything"})), reply(text="Done")]),
            "instructions",
        )
        self.assertEqual(result["trace"][0]["response"]["status"], 400)

    def test_runner_artifacts_selection_and_baseline(self):
        case = CASES["explicit-input-edit"]
        good = good_sim(case)
        script = [reply((r["tool"], r["arguments"])) for r in good.trace] + [reply(text="Verified.")]
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "run"
            with patch.object(run, "Model", return_value=ScriptedModel(script)), patch("builtins.print"):
                self.assertEqual(run.main(["--out", str(out), "--case", case["id"]]), 0)
            summary = json.loads((out / "summary.json").read_text())
            self.assertTrue(summary["cases"][case["id"]]["passed"])
            self.assertIn("Spool Control", (out / "prompt.txt").read_text(encoding="utf-8"))
            self.assertEqual(len((out / "results.jsonl").read_text().splitlines()), 1)
            self.assertTrue((out / "manifest.json").exists())
            self.assertTrue((out / "review.md").exists())
            self.assertIn(case["id"], run.summarize([], run.DEFAULT_MODEL, [case], summary)["baseline"])
            with self.assertRaises(ValueError):
                run.validate_baseline(summary, "other-model", [case])
            with self.assertRaises(ValueError):
                run.validate_baseline(summary, run.DEFAULT_MODEL, [{**case, "prompt": "changed case"}])

    def test_shipped_text_is_read_at_runtime_and_runtime_never_imports_evals(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for path in (
                "skills/spool-control/references/commands.md",
                "skills/spool-control/SKILL.md",
                "docs/guide/automation.md",
            ):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("first", encoding="utf-8")
            self.assertIn("first", run.shipped_text(root))
            target.write_text("updated instructions", encoding="utf-8")
            self.assertIn("updated instructions", run.shipped_text(root))
        for path in [ROOT / "__init__.py", *sorted((ROOT / "spool").glob("*.py"))]:
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Import):
                    self.assertFalse(any(a.name.split(".")[0] == "evals" for a in node.names), path)
                elif isinstance(node, ast.ImportFrom):
                    self.assertNotIn("evals", (node.module or "").split("."), path)

    def test_incomplete_paid_batch_cannot_report_success_by_majority(self):
        case = CASES["ambiguous-project"]
        turns = [reply(("ask_user", {"question": "Which Launch?"})), reply(text="Which Launch project?")]
        with tempfile.TemporaryDirectory() as folder:
            model = ScriptedModel(turns * 2)
            original = model.complete

            def complete(system, history):
                try:
                    return original(system, history)
                except StopIteration:
                    raise models.ModelError("Provider HTTP 429")

            with (
                patch.object(run, "Model", return_value=model),
                patch.object(model, "complete", side_effect=complete),
                patch("builtins.print"),
            ):
                self.assertEqual(run.main(["--out", folder, "--case", case["id"], "--samples", "3"]), 1)
            summary = json.loads((Path(folder) / "summary.json").read_text())
            self.assertTrue(summary["cases"][case["id"]]["passed"])
            self.assertFalse(summary["complete"])


class ProviderTests(unittest.TestCase):
    def test_both_wire_protocols_round_trip_multiple_tool_calls(self):
        for model_id in ("claude-sonnet-5-5", "gpt-test"):
            with (
                self.subTest(model=model_id),
                patch.dict("os.environ", {"ANTHROPIC_API_KEY": "fake-secret", "OPENAI_API_KEY": "fake-secret"}),
            ):
                model = models.Model(model_id)
                history = [
                    {"role": "user", "text": "Inspect"},
                    {
                        "role": "assistant",
                        "text": "",
                        "calls": [
                            {"id": "a", "name": "spool", "arguments": {"method": "health"}},
                            {"id": "b", "name": "spool", "arguments": {"method": "projects"}},
                        ],
                    },
                    {"role": "tool", "id": "a", "text": "{}"},
                    {"role": "tool", "id": "b", "text": "[]"},
                ]
                response = {
                    "content": [{"type": "text", "text": "Done"}],
                    "stop_reason": "end_turn",
                    "choices": [{"message": {"content": "Done"}, "finish_reason": "stop"}],
                    "usage": {"input_tokens": 12},
                }
                with patch.object(models, "post_json", return_value=response) as post:
                    self.assertEqual(model.complete("instructions", history)["text"], "Done")
                    url, headers, body = post.call_args.args
                    self.assertTrue(url.startswith("https://"))
                    self.assertNotIn("fake-secret", json.dumps(body))
                    if model.provider == "anthropic":
                        self.assertEqual([b["tool_use_id"] for b in body["messages"][-1]["content"]], ["a", "b"])
                    else:
                        self.assertEqual([m["tool_call_id"] for m in body["messages"][-2:]], ["a", "b"])
                response = {
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "c",
                            "name": "spool",
                            "input": {"method": "status", "projectId": "launch"},
                        }
                    ],
                    "stop_reason": "tool_use",
                    "choices": [
                        {
                            "message": {
                                "tool_calls": [
                                    {
                                        "id": "c",
                                        "function": {
                                            "name": "spool",
                                            "arguments": '{"method":"status","projectId":"launch"}',
                                        },
                                    }
                                ]
                            },
                            "finish_reason": "tool_calls",
                        }
                    ],
                }
                with patch.object(models, "post_json", return_value=response):
                    self.assertEqual(
                        model.complete("instructions", history)["calls"][0]["arguments"]["projectId"], "launch"
                    )

    def test_urllib_json_transport_and_safe_errors(self):
        with patch.object(models.urllib.request, "urlopen", return_value=io.BytesIO(b'{"ok":true}')) as urlopen:
            self.assertEqual(
                models.post_json("https://example.test", {"Authorization": "fake-secret"}, {"model": "test"}),
                {"ok": True},
            )
            self.assertEqual(json.loads(urlopen.call_args.args[0].data), {"model": "test"})
        error = urllib.error.HTTPError("https://example.test", 401, "fake-secret", {}, io.BytesIO(b"fake-secret"))
        with patch.object(models.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(models.ModelError) as captured:
                models.post_json("https://example.test", {}, {})
        self.assertNotIn("fake-secret", str(captured.exception))
        self.assertIn("401", str(captured.exception))
        with patch.dict("os.environ", {}, clear=True), self.assertRaises(models.ModelError):
            models.Model("gpt-test")


if __name__ == "__main__":
    unittest.main()
