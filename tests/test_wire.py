import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spool.wire import wire, unwire


class WireTests(unittest.TestCase):
    def test_shared_decimal_fixtures(self):
        for case in json.loads((Path(__file__).parent / "fixtures/wire_cases.json").read_text(encoding="utf-8")):
            if case.get("invalid"):
                if case["reject"]:
                    with self.assertRaises(ValueError):
                        unwire(case["wire"])
                else:
                    self.assertEqual(unwire(case["wire"]), case["wire"])
                continue
            with self.subTest(decimal=case["decimal"]):
                number = int(case["decimal"])
                self.assertEqual(wire(number), case["wire"])
                self.assertEqual(unwire(case["wire"]), number)
                self.assertEqual(unwire(wire({"nested": [number]})), {"nested": [number]})


if __name__ == "__main__":
    unittest.main()
