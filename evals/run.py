"""Manual paid runner: python -m evals.run --out evals/runs/example."""

import argparse
import hashlib
import json
from pathlib import Path

from .graders import grade
from .models import Model, ModelError, TOOLS
from .simulator import ROOT, Simulator, load_cases

DEFAULT_MODEL = "claude-sonnet-5-5"


def shipped_text(root=ROOT):
    paths = [
        root / "skills/spool-control/SKILL.md",
        *sorted((root / "skills/spool-control/references").glob("*.md")),
        root / "docs/guide/automation.md",
    ]
    return "\n\n".join(f"--- {p.relative_to(root).as_posix()} ---\n{p.read_text(encoding='utf-8')}" for p in paths)


def system_prompt(text):
    return (
        "You are operating a simulated Spool project through the provided connector. Follow the shipped skill below. All project data is synthetic. Only the provided tools exist; rendered media inspection is unavailable. Use ask_user for a clarification.\n\n"
        + text
    )


def run_sample(case, model, system, max_turns=20, max_calls=80):
    simulator = Simulator(case)
    history = [{"role": "user", "text": case["prompt"]}]
    usage, final, error, finished = [], "", None, False
    for _ in range(max_turns):
        try:
            reply = model.complete(system, history)
        except ModelError as exception:
            error = str(exception)
            break
        usage.append(reply.get("usage", {}))
        history.append({"role": "assistant", "text": reply["text"], "calls": reply["calls"]})
        if reply["stop"] not in ("end_turn", "stop", "tool_use", "tool_calls"):
            error = "Model response did not finish normally: " + reply["stop"]
            break
        if not reply["calls"]:
            final, finished = reply["text"], reply["stop"] in ("end_turn", "stop") and bool(reply["text"].strip())
            break
        for call in reply["calls"]:
            if len(simulator.trace) >= max_calls:
                error = "Tool-call limit reached"
                break
            response = simulator.call(call["name"], call["arguments"])
            history.append({"role": "tool", "id": call["id"], "text": json.dumps(response, ensure_ascii=False)})
        if error:
            break
    checks = grade(case, simulator.trace, simulator.initial, simulator.state())
    return {
        "caseId": case["id"],
        "passed": finished and error is None and all(c["passed"] for c in checks),
        "finished": finished,
        "error": error or (None if finished else "Turn limit or missing final answer"),
        "checks": checks,
        "final": final,
        "trace": simulator.trace,
        "initial": simulator.initial,
        "state": simulator.state(),
        "history": history,
        "usage": usage,
    }


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def summarize(rows, model, cases, baseline=None):
    results = {}
    for case in cases:
        samples = [r for r in rows if r["caseId"] == case["id"]]
        passes = sum(r["passed"] for r in samples)
        results[case["id"]] = {
            "passes": passes,
            "samples": len(samples),
            "passed": passes > len(samples) / 2,
            "caseHash": digest(case),
        }
    summary = {
        "model": model,
        "cases": results,
        "inputTokens": sum(u.get("input_tokens", u.get("prompt_tokens", 0)) for r in rows for u in r["usage"]),
        "outputTokens": sum(u.get("output_tokens", u.get("completion_tokens", 0)) for r in rows for u in r["usage"]),
        "costUSD": None,
        "costNote": "Use recorded provider usage and current account pricing; no hard-coded price estimate.",
    }
    if baseline:
        validate_baseline(baseline, model, cases)
        summary["baseline"] = {
            key: {"passes": baseline["cases"][key]["passes"], "samples": baseline["cases"][key]["samples"]}
            for key in results
            if key in baseline["cases"]
        }
    return summary


def validate_baseline(baseline, model, cases):
    if baseline["model"] != model:
        raise ValueError("Baseline must use the same model")
    for case in cases:
        previous = baseline["cases"].get(case["id"])
        if previous and previous["caseHash"] != digest(case):
            raise ValueError("Baseline case definition differs: " + case["id"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--case", nargs="+", help="IDs separated by spaces or commas")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--baseline", type=Path, help="Earlier summary.json on the same model")
    parser.add_argument("--max-turns", type=int, default=20)
    parser.add_argument("--max-tokens", type=int, default=2048)
    args = parser.parse_args(argv)
    if min(args.samples, args.max_turns, args.max_tokens) < 1:
        parser.error("samples, max-turns and max-tokens must be positive")
    cases = load_cases()
    ids = {item for value in args.case or [] for item in value.split(",")}
    if ids - {case["id"] for case in cases}:
        parser.error("Unknown case IDs: " + ", ".join(sorted(ids - {c["id"] for c in cases})))
    cases = [c for c in cases if not ids or c["id"] in ids]
    baseline = json.loads(args.baseline.read_text(encoding="utf-8")) if args.baseline else None
    if baseline:
        validate_baseline(baseline, args.model, cases)
    if args.out.exists() and any(args.out.iterdir()):
        parser.error("Use an empty output directory")
    model = Model(args.model, args.max_tokens)
    text = shipped_text()
    system = system_prompt(text)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "prompt.txt").write_text(system, encoding="utf-8")
    sources = [*sorted((ROOT / "evals").glob("*.py")), ROOT / "evals/fixtures/project.json"]
    manifest = {
        "model": args.model,
        "samples": args.samples,
        "maxTurns": args.max_turns,
        "maxTokens": args.max_tokens,
        "maxCalls": 80,
        "promptHash": digest(system),
        "tools": TOOLS,
        "cases": cases,
        "sourceHashes": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    rows = []
    with (args.out / "results.jsonl").open("w", encoding="utf-8") as stream:
        for case in cases:
            for sample in range(args.samples):
                row = run_sample(case, model, system, args.max_turns)
                row["sample"] = sample + 1
                rows.append(row)
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
                stream.flush()
                print(f"{case['id']} sample {sample + 1}: {'PASS' if row['passed'] else 'FAIL'}")
                if row["error"]:
                    print(row["error"])
                    # Do not spend on the rest of a batch after a provider/budget failure.
                    break
            if rows[-1]["error"]:
                break
    summary = summarize(rows, args.model, cases, baseline)
    summary["complete"] = len(rows) == len(cases) * args.samples and not any(row["error"] for row in rows)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    review = [
        "# Spool skill eval",
        "",
        f"Model: {args.model}",
        f"Complete run: {summary['complete']}",
        "",
        "| Case | Passes / samples | Case passes | Baseline |",
        "| --- | --- | --- | --- |",
    ]
    for key, result in summary["cases"].items():
        old = summary.get("baseline", {}).get(key)
        review.append(
            f"| {key} | {result['passes']}/{result['samples']} | {result['passed']} | "
            + (f"{old['passes']}/{old['samples']}" if old else "—")
            + " |"
        )
    review += [
        "",
        summary["costNote"],
        f"Recorded input/output tokens: {summary['inputTokens']}/{summary['outputTokens']}",
        "",
        "Inspect results.jsonl for each attempted call, response, final answer and final fake state. These are simulated results, not live execution evidence.",
    ]
    (args.out / "review.md").write_text("\n".join(review) + "\n", encoding="utf-8")
    return 0 if summary["complete"] and all(r["passed"] for r in summary["cases"].values()) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ModelError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from None
