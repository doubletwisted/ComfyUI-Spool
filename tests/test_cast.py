import json
import unittest
from pathlib import Path

from spool import cast

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "cast_mentions.json").read_text(encoding="utf-8"))


class CastMentionTests(unittest.TestCase):
    """Shared with ui/cast.js (tests/cast_checks.mjs)."""

    def test_mentions_match_the_studio(self):
        for case in FIXTURE["cases"]:
            values, report = cast.resolve(
                FIXTURE["cast"], FIXTURE["bindings"], case["values"], case["settings"], case["style"]
            )
            self.assertEqual({"values": values, "report": report}, case["expected"], case["name"])

    def test_tag_style_follows_the_workflow_prompt(self):
        for case in FIXTURE["styles"]:
            self.assertEqual(cast.tag_style(case["text"]), case["style"], case["text"])


if __name__ == "__main__":
    unittest.main()
