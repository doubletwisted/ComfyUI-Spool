"""A failed import removes only its own destination and local working cache."""

import copy
import hashlib
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from spool.projects import Workspace


class ImportFailureCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.workspace = Workspace(self.root / "app")
        self.projects = self.root / "projects"
        self.workspace.set_setting("projects_directory", str(self.projects))
        self.source = self.workspace.create({"project": "Source", "clips": [], "media": []}, self.root / "source")
        self.store = self.workspace.for_project(self.source["id"])
        self.exported = self.store.export_project(self.source["id"])

    def tearDown(self):
        self.temp.cleanup()

    def cache_names(self):
        root = self.workspace.root / "cache"
        return {path.name for path in root.iterdir()} if root.is_dir() else set()

    @staticmethod
    def cache_for(workspace, folder):
        folder = Path(folder).resolve()
        key = hashlib.sha256(str(folder).encode()).hexdigest()
        return Path(workspace.root) / "cache" / key

    def invalid_import(self):
        value = copy.deepcopy(self.exported)
        value["document"]["invalidNumber"] = float("inf")
        return value

    def fixed_destination(self, name):
        destination = self.projects / name

        def make(*args, **kwargs):
            destination.mkdir(parents=True)
            return str(destination)

        return destination, make

    def assert_only_source_remains(self, folders, caches):
        self.assertEqual(self.workspace.folders(), folders)
        self.assertEqual(self.cache_names(), caches)
        self.assertEqual(set(self.workspace.opened), {self.source["id"]})
        self.assertEqual(list(self.projects.iterdir()), [])

    def test_constructor_failure_after_cache_creation_removes_new_cache(self):
        folders, caches = self.workspace.folders(), self.cache_names()
        with patch("spool.projects.take_files.recover", side_effect=RuntimeError("constructor failed")):
            with self.assertRaisesRegex(RuntimeError, "constructor failed"):
                self.workspace.import_project(self.exported)
        self.assert_only_source_remains(folders, caches)

    def test_cache_path_failure_removes_the_empty_destination(self):
        folders, caches = self.workspace.folders(), self.cache_names()
        error = OSError("cache path unavailable")
        with patch("spool.projects.working_cache", side_effect=error):
            with self.assertRaises(OSError) as caught:
                self.workspace.import_project(self.exported)
        self.assertIs(caught.exception, error)
        self.assert_only_source_remains(folders, caches)

    def test_destination_resolution_failure_removes_only_the_empty_destination(self):
        folders, caches = self.workspace.folders(), self.cache_names()
        real_resolve = Path.resolve
        error = OSError("destination resolution unavailable")

        def resolve(path, *args, **kwargs):
            if path.parent == self.projects and path.name.startswith("Untitled Spool project-"):
                raise error
            return real_resolve(path, *args, **kwargs)

        with patch.object(Path, "resolve", resolve):
            with self.assertRaises(OSError) as caught:
                self.workspace.import_project(self.exported)
        self.assertIs(caught.exception, error)
        self.assert_only_source_remains(folders, caches)

    def test_invalid_import_transaction_removes_new_cache(self):
        folders, caches = self.workspace.folders(), self.cache_names()
        with self.assertRaises(ValueError):
            self.workspace.import_project(self.invalid_import())
        self.assert_only_source_remains(folders, caches)

    def test_registration_failure_removes_new_cache_and_destination(self):
        folders, caches = self.workspace.folders(), self.cache_names()
        with patch.object(self.workspace, "register_folder", side_effect=OSError("Registry unavailable")):
            with self.assertRaisesRegex(OSError, "Registry unavailable"):
                self.workspace.import_project(self.exported)
        self.assert_only_source_remains(folders, caches)

    def test_success_keeps_and_reopens_the_import_cache(self):
        imported = self.workspace.import_project(self.exported)
        folder = Path(next(row["folder"] for row in self.workspace.folders() if row["id"] == imported["id"]))
        cache = self.cache_for(self.workspace, folder)
        self.assertTrue(cache.is_dir())
        self.assertTrue((cache / "working.sqlite3").is_file())
        reopened = Workspace(self.workspace.root).get(imported["id"])
        self.assertEqual(reopened["document"], imported["document"])
        self.assertTrue(cache.is_dir())

    def test_pre_existing_cache_at_the_derived_path_is_preserved(self):
        destination, make = self.fixed_destination("preserved-cache")
        cache = self.cache_for(self.workspace, destination)
        cache.mkdir(parents=True)
        sentinel = cache / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")
        with patch("spool.projects.tempfile.mkdtemp", side_effect=make):
            with self.assertRaises(ValueError):
                self.workspace.import_project(self.invalid_import())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
        self.assertTrue((cache / "working.sqlite3").is_file())
        self.assertFalse(destination.exists())
        self.assertEqual(len(self.workspace.list()), 1)

    def test_redirected_cache_root_is_not_deleted(self):
        workspace = Workspace(self.root / "redirected-app")
        projects = self.root / "redirected-projects"
        workspace.set_setting("projects_directory", str(projects))
        external = self.root / "external-cache"
        external.mkdir()
        cache_root = workspace.root / "cache"
        self.make_directory_redirect(cache_root, external)
        try:
            with self.assertRaises(ValueError):
                workspace.import_project(self.invalid_import())
            created = list(external.iterdir())
            self.assertEqual(len(created), 1)
            self.assertTrue(created[0].is_dir())
            self.assertTrue((created[0] / "working.sqlite3").is_file())
            self.assertEqual(list(projects.iterdir()), [])
            self.assertEqual(workspace.folders(), [])
        finally:
            self.remove_directory_redirect(cache_root)

    def test_unreadable_redirect_metadata_cannot_authorize_external_cleanup(self):
        workspace = Workspace(self.root / "uncertain-app")
        projects = self.root / "uncertain-projects"
        workspace.set_setting("projects_directory", str(projects))
        external = self.root / "uncertain-external"
        external.mkdir()
        cache_root = workspace.root / "cache"
        self.make_directory_redirect(cache_root, external)
        original = Path.lstat

        def inspect(path):
            if path == cache_root:
                raise PermissionError("redirect metadata unavailable")
            return original(path)

        try:
            with patch.object(Path, "lstat", inspect):
                with self.assertRaises(ValueError):
                    workspace.import_project(self.invalid_import())
            self.assertEqual(len(list(external.iterdir())), 1)
            self.assertEqual(list(projects.iterdir()), [])
        finally:
            self.remove_directory_redirect(cache_root)

    def test_transient_cache_inspection_failure_preserves_existing_cache(self):
        destination, make = self.fixed_destination("uncertain-existing-cache")
        cache = self.cache_for(self.workspace, destination)
        cache.mkdir(parents=True)
        sentinel = cache / "keep.txt"
        sentinel.write_bytes(b"existing cache")
        real_lstat = Path.lstat
        failures = []

        def inspect(path):
            if path == cache and not failures:
                failures.append(path)
                raise PermissionError("transient cache metadata error")
            return real_lstat(path)

        with (
            patch("spool.projects.tempfile.mkdtemp", side_effect=make),
            patch.object(Path, "lstat", inspect),
        ):
            with self.assertRaises(ValueError):
                self.workspace.import_project(self.invalid_import())
        self.assertEqual(len(failures), 1)
        self.assertEqual(sentinel.read_bytes(), b"existing cache")
        self.assertFalse(destination.exists())

    def test_denied_cleanup_preserves_the_import_error(self):
        for denied in ("folder", "cache"):
            with self.subTest(denied=denied):
                destination, make = self.fixed_destination("denied-" + denied)
                cache = self.cache_for(self.workspace, destination)
                real_rmtree = shutil.rmtree
                blocked = []

                def refuse(path, *args, **kwargs):
                    target = Path(path)
                    if (denied == "folder" and target == destination) or (denied == "cache" and target == cache):
                        blocked.append(target)
                        raise PermissionError(denied + " cleanup denied")
                    return real_rmtree(path, *args, **kwargs)

                with (
                    patch("spool.projects.tempfile.mkdtemp", side_effect=make),
                    patch("spool.projects.shutil.rmtree", refuse),
                ):
                    with self.assertRaisesRegex(ValueError, "JSON compliant"):
                        self.workspace.import_project(self.invalid_import())
                self.assertEqual(blocked, [destination if denied == "folder" else cache])
                if denied == "folder":
                    self.assertTrue(destination.is_dir())
                    self.assertFalse(cache.exists())
                else:
                    self.assertFalse(destination.exists())
                    self.assertTrue(cache.is_dir())

    def make_directory_redirect(self, link, target):
        target.mkdir(parents=True, exist_ok=True)
        try:
            os.symlink(target, link, target_is_directory=True)
            return
        except (OSError, NotImplementedError):
            if os.name != "nt":
                self.skipTest("Directory symlinks are unavailable")
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
        if result.returncode:
            self.skipTest("Directory links are unavailable: " + (result.stderr or result.stdout).strip())

    @staticmethod
    def remove_directory_redirect(link):
        try:
            info = link.lstat()
        except FileNotFoundError:
            return
        if stat.S_ISLNK(info.st_mode):
            link.unlink()
        elif getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            os.rmdir(link)


if __name__ == "__main__":
    unittest.main()
