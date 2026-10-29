import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import credentials


class CloudCredentialTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "machine" / "cloud.key"
        self.key_path = patch.object(credentials, "key_path", return_value=self.path)
        self.key_path.start()
        self.addCleanup(self.key_path.stop)
        self.environment = patch.dict(os.environ, {"COMFY_API_KEY": "comfyui-environment-fixture"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_machine_key_overrides_environment_without_exposing_either(self):
        self.assertEqual(credentials.cloud_key(), "comfyui-environment-fixture")
        self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "environment"})
        credentials.save_key("comfyui-machine-fixture")
        self.assertEqual(credentials.cloud_key(), "comfyui-machine-fixture")
        self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "saved"})
        credentials.save_key("")
        self.assertFalse(self.path.exists())
        self.assertEqual(credentials.cloud_key(), "comfyui-environment-fixture")

    def test_credentials_folder_moves_the_key(self):
        self.key_path.stop()
        folder = Path(self.directory.name) / "isolated"
        with patch.dict(os.environ, {"SPOOL_CREDENTIALS": str(folder)}):
            self.assertEqual(credentials.key_path(), folder / "comfy-cloud.key")
            credentials.save_key("comfyui-isolated-fixture")
            self.assertEqual((folder / "comfy-cloud.key").read_text(encoding="utf-8"), "comfyui-isolated-fixture")
            credentials.save_key("")
            self.assertFalse((folder / "comfy-cloud.key").exists())
        self.key_path.start()

    def test_test_hosts_never_use_the_machine_key(self):
        # Browser checks save and remove a fixture key through the real settings route.
        root = Path(__file__).resolve().parent
        for name in ("run_host.py", "run_api_host.py"):
            source = (root / name).read_text(encoding="utf-8")
            self.assertIn("SPOOL_CREDENTIALS", source, name)
            self.assertLess(
                source.index("SPOOL_CREDENTIALS"),
                source.index("import main" if name == "run_host.py" else "from spool"),
                name,
            )

    def test_invalid_key_does_not_replace_existing_key(self):
        credentials.save_key("comfyui-machine-fixture")
        for key in [None, 7, "wrong-prefix", "comfyui-key with spaces", "comfyui-key\nextra"]:
            with self.assertRaises(ValueError):
                credentials.save_key(key)
        self.assertEqual(credentials.cloud_key(), "comfyui-machine-fixture")

    def test_missing_key_is_reported_without_a_value(self):
        with patch.dict(os.environ, {"COMFY_API_KEY": ""}):
            self.assertEqual(credentials.key_status(), {"hasApiKey": False, "apiKeySource": None})
