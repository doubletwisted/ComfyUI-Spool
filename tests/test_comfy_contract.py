"""Spool's dispatch mirrors Comfy's own /prompt handling where Comfy provides it."""
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from spool.execution import workflow_metadata


class ComfyContractTests(unittest.TestCase):
    def test_workflow_metadata_uses_comfys_helper_when_present(self):
        comfy = SimpleNamespace(workflow_metadata_from_prompt=lambda extra: {"workflow_id": extra["extra_pnginfo"]["workflow"]["id"]})
        with patch.dict(sys.modules, {"server": comfy}):
            self.assertEqual(workflow_metadata({"extra_pnginfo": {"workflow": {"id": "graph-1"}}}), {"workflow_id": "graph-1"})

    def test_older_comfy_without_the_helper_adds_nothing(self):
        with patch.dict(sys.modules, {"server": SimpleNamespace()}):
            self.assertIsNone(workflow_metadata({"extra_pnginfo": {"workflow": {"id": "graph-1"}}}))


if __name__ == "__main__":
    unittest.main()
