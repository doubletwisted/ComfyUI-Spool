"""Clip notes, immutable addressed entries and explicit agent completion."""

import copy
import time

from .store import Conflict, uid


def entries(clip):
    if "notes" in clip:
        return clip["notes"]
    text = clip.get("intent", "")
    return (
        [{"id": "note-" + clip["id"], "text": text, "status": "open", "createdAt": None, "createdBy": "user"}]
        if text.strip()
        else []
    )


def apply(clip, action, arguments, actor):
    values = copy.deepcopy(entries(clip))
    now = int(time.time() * 1000)

    def create(text, source=None):
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Write a note first")
        value = {"id": uid(), "text": text.strip(), "status": "open", "createdAt": now, "createdBy": actor}
        if source:
            value["reopenedFrom"] = source["id"]
        values.append(value)
        return value

    if action == "add_note":
        note = create(arguments.get("text"))
    else:
        note = next((n for n in values if n["id"] == arguments.get("noteId")), None)
        if note is None:
            raise ValueError("This note is no longer available")
        if arguments.get("expectedText") != note["text"]:
            raise Conflict("The note changed. Read it again before acting on it.")
        if action == "reopen_note":
            if note["status"] != "addressed":
                raise ValueError("Choose an addressed note to reopen")
            if any(n.get("reopenedFrom") == note["id"] and n["status"] == "open" for n in values):
                raise ValueError("This note is already reopened")
            note = create(note["text"], note)
        else:
            if note["status"] != "open":
                raise ValueError("Addressed notes are kept in history. Reopen the note to change it.")
            if action == "edit_note":
                text = arguments.get("text")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("A note cannot be empty")
                if text.strip() != note["text"]:
                    note.setdefault("versions", []).append({"text": note["text"], "at": now, "by": actor})
                    note.update(text=text.strip(), updatedAt=now, updatedBy=actor)
            elif action == "address_note":
                summary = arguments.get("summary", "")
                if not isinstance(summary, str) or actor.startswith("agent:") and not summary.strip():
                    raise ValueError("Agents must describe what they completed when addressing a note")
                note.update(status="addressed", addressedAt=now, addressedBy=actor, resolution=summary.strip())
            else:
                raise ValueError("Unknown note action")
    clip["notes"] = values
    clip.pop("intent", None)
    return {"clipId": clip["id"], "noteId": note["id"], "status": note["status"]}
