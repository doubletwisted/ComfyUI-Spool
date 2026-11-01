"""Cast mentions: `@Name` in a prompt brings that cast member's pictures to the workflow.

ui/cast.js applies the same rules; tests/fixtures/cast_mentions.json pins both.
"""

import re

from .workflow_inputs import filled

MENTION = re.compile(r"(?<![\w@])@([\w-]+)", re.UNICODE)


def tag_style(text):
    """MiniMax H3 local and Max name pictures <Picture 1>; the Cloud node names them Image 1."""
    text = str(text or "")
    return "plain" if re.search(r"\bImage \d", text) and "<Picture" not in text else "angle"


def tag(style, kind, number):
    return f"{kind} {number}" if style == "plain" else f"<{'Picture' if kind == 'Image' else kind} {number}>"


def mentioned(cast, text):
    """Cast members in order of first mention; unknown names are left alone."""
    by_name = {member["name"].lower(): member for member in cast or []}
    found = []
    for match in MENTION.finditer(str(text or "")):
        member = by_name.get(match.group(1).lower())
        if member and member not in found:
            found.append(member)
    return found


def resolve(cast, bindings, values, settings, style="angle"):
    """Fill empty reference slots with mentioned members' pictures and rewrite the mentions."""
    values = dict(values)
    prompts = [b for b in bindings if b.get("role") == "positive" and isinstance(values.get(b["key"]), str)]
    members = mentioned(cast, " ".join(values[b["key"]] for b in prompts))
    if not members:
        return values, []
    slots = [b for b in bindings if b.get("asset") and b.get("slot") == "reference"]
    used = sum(1 for b in slots if filled(b, values, settings))
    report = []
    for member in members:
        pictures = []
        for image in member.get("images", []):
            if used >= len(slots):
                break
            values[slots[used]["key"]] = image
            used += 1
            pictures.append(used)
        if pictures:
            replacement = tag(style, "Image", pictures[0])
        else:
            description = (member.get("description") or "").strip()
            replacement = member["name"] + (" (" + description + ")" if description else "")
        pattern = re.compile(r"(?<![\w@])@" + re.escape(member["name"]) + r"(?![\w-])", re.IGNORECASE | re.UNICODE)
        for b in prompts:
            text = pattern.sub(lambda _: replacement, values[b["key"]])
            if len(pictures) > 1:
                text += (
                    " "
                    + " and ".join(tag(style, "Image", n) for n in pictures[1:])
                    + " also show "
                    + member["name"]
                    + "."
                )
            values[b["key"]] = text
        report.append({"id": member["id"], "name": member["name"], "pictures": pictures})
    return values, report
