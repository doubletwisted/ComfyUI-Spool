"""The attempt status table and Cancel policy shared with ui/generation.js."""

import json
import unittest
from pathlib import Path

from spool import attempts

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "attempt_statuses.json").read_text(encoding="utf-8"))


class AttemptStatusTests(unittest.TestCase):
    def test_status_sets_match_the_shared_fixture(self):
        self.assertEqual(attempts.PENDING, set(FIXTURE["pending"]))
        self.assertEqual(attempts.TERMINAL, set(FIXTURE["terminal"]))
        self.assertFalse(attempts.PENDING & attempts.TERMINAL)

    def test_cancel_policy_matches_the_shared_fixture(self):
        for case in FIXTURE["cancel"]:
            with self.subTest(**case):
                self.assertEqual(
                    attempts.cancel_action(case["status"], case["target"], case["externalJob"]), case["action"]
                )

    def test_every_cancel_outcome_is_an_allowed_transition(self):
        for case in FIXTURE["cancel"]:
            if case["action"] == "cancelled":
                self.assertIn(attempts.CANCELLED, attempts.ALLOWED[case["status"]])
            if case["action"] == "requested" and case["status"] != attempts.CANCEL_REQUESTED:
                self.assertIn(attempts.CANCEL_REQUESTED, attempts.ALLOWED[case["status"]])

    def test_target_comes_from_the_request_or_a_deadline_submission(self):
        self.assertEqual(attempts.target_of({}), attempts.LOCAL)
        self.assertEqual(attempts.target_of({"target": attempts.CLOUD}), attempts.CLOUD)
        self.assertEqual(attempts.target_of({"target": attempts.LOCAL}, {"id": "submission"}), attempts.DEADLINE)
        self.assertEqual(set(attempts.TARGETS), {"local", "deadline", "cloud"})

    def test_only_the_attempt_module_reads_a_requests_target(self):
        # Modules ask attempts.target_of; projected jobs carry the resolved target.
        root = Path(__file__).resolve().parent.parent / "spool"
        for path in root.glob("*.py"):
            if path.name == "attempts.py":
                continue
            source = path.read_text(encoding="utf-8-sig")
            self.assertNotRegex(source, r"request[\"'\]]*\)?\.get\([\"']target", path.name)


if __name__ == "__main__":
    unittest.main()
