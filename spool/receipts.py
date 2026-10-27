"""Versioned atomic receipt writes and verification of the existing collection contract."""
import hashlib
import json
from pathlib import Path

RECEIPT_SCHEMA = 1


def write(directory, attempt, artifacts, primary, history):
    target = Path(directory)
    receipt = {"schemaVersion": RECEIPT_SCHEMA, "attemptId": attempt["id"], "takeId": attempt["take_id"], "promptId": attempt["prompt_id"], "fingerprint": attempt["request"]["fingerprint"], "artifacts": artifacts, "primary": primary, "history": history}
    pending = target / "receipt.partial"
    pending.write_text(json.dumps(receipt, ensure_ascii=False), encoding="utf-8")
    pending.replace(target / "receipt.json")
    return receipt


def verify(attempt, receipt_path, media):
    receipt_path = Path(receipt_path)
    result = json.loads(receipt_path.read_text(encoding="utf-8"))
    if result.get("schemaVersion") != 1:
        raise ValueError("Unsupported local receipt version")
    if result["fingerprint"] != attempt["request"]["fingerprint"] or result["attemptId"] != attempt["id"] or result["takeId"] != attempt["take_id"] or result["promptId"] != attempt["prompt_id"]:
        raise ValueError("Receipt does not match this frozen attempt")
    if not result.get("history", {}).get("status", {}).get("completed") or result.get("history", {}).get("status", {}).get("status_str") != "success":
        raise ValueError("Receipt lacks successful completion evidence")
    selection = attempt["request"]["capture"]["result"]
    if (result["primary"]["nodeId"], result["primary"]["group"], result["primary"]["index"]) != (selection["nodeId"], selection["group"], selection["index"]) or result["primary"]["artifactId"] not in {a["artifactId"] for a in result["artifacts"]}:
        raise ValueError("Receipt primary does not match the explicit result selection")
    for artifact in result["artifacts"]:
        original = media.resolve(artifact["originalFile"])
        allowed = original.is_relative_to(receipt_path.parent)
        if media.project_id and attempt["request"].get("outputFolder"):
            folder = (media.root / attempt["request"]["outputFolder"]).resolve()
            allowed = allowed or original.is_relative_to(folder)
        if not allowed or original.stat().st_size != artifact["byteSize"]:
            raise ValueError("Receipt artifact is outside this attempt or changed size")
        if artifact.get("sha256"):
            with original.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != artifact["sha256"]:
                    raise ValueError("Receipt artifact changed checksum")
        media.resolve(artifact["file"])
    canonical = next(a for a in result["artifacts"] if a["artifactId"] == result["primary"]["artifactId"])
    if canonical != result["primary"]:
        raise ValueError("Receipt primary differs from its canonical artifact")
    return result
