import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import credentials


class CredentialStatusTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.key = self.folder / "comfy-cloud.key"

    def environment(self, api_key=None):
        values = {"SPOOL_CREDENTIALS": str(self.folder)}
        if api_key is not None:
            values["COMFY_API_KEY"] = api_key
        return patch.dict(os.environ, values, clear=True)

    def test_absent_saved_key_uses_trimmed_environment(self):
        with self.environment("  comfyui-environment-fixture\n"):
            self.assertEqual(credentials.cloud_key(), "comfyui-environment-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "environment"})

    def test_empty_saved_key_falls_back_to_environment(self):
        self.key.write_text("", encoding="utf-8")
        with self.environment("comfyui-environment-fixture"):
            self.assertEqual(credentials.cloud_key(), "comfyui-environment-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "environment"})

    def test_whitespace_saved_key_falls_back_to_environment(self):
        self.key.write_text(" \n\t", encoding="utf-8")
        with self.environment("comfyui-environment-fixture"):
            self.assertEqual(credentials.cloud_key(), "comfyui-environment-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "environment"})

    def test_valid_saved_key_wins_over_environment(self):
        self.key.write_text("  comfyui-saved-fixture\n", encoding="utf-8")
        with self.environment("comfyui-environment-fixture"):
            self.assertEqual(credentials.cloud_key(), "comfyui-saved-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "saved"})

    def test_no_saved_or_environment_key_reports_none(self):
        with self.environment():
            self.assertEqual(credentials.cloud_key(), "")
            self.assertEqual(credentials.key_status(), {"hasApiKey": False, "apiKeySource": None})

    def test_whitespace_environment_alone_reports_no_key(self):
        with self.environment(" \n\t"):
            self.assertEqual(credentials.cloud_key(), "")
            self.assertEqual(credentials.key_status(), {"hasApiKey": False, "apiKeySource": None})

    def test_whitespace_saved_and_environment_report_no_key(self):
        self.key.write_text(" \n", encoding="utf-8")
        with self.environment("\t "):
            self.assertEqual(credentials.cloud_key(), "")
            self.assertEqual(credentials.key_status(), {"hasApiKey": False, "apiKeySource": None})

    def test_save_and_delete_update_status(self):
        with self.environment("comfyui-environment-fixture"):
            credentials.save_key("comfyui-saved-fixture")
            self.assertEqual(credentials.cloud_key(), "comfyui-saved-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "saved"})
            credentials.save_key("")
            self.assertFalse(self.key.exists())
            self.assertEqual(credentials.cloud_key(), "comfyui-environment-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "environment"})

    def test_invalid_save_keeps_the_saved_key(self):
        with self.environment("comfyui-environment-fixture"):
            credentials.save_key("comfyui-saved-fixture")
            with self.assertRaises(ValueError):
                credentials.save_key("wrong-prefix")
            self.assertEqual(credentials.cloud_key(), "comfyui-saved-fixture")
            self.assertEqual(credentials.key_status(), {"hasApiKey": True, "apiKeySource": "saved"})
