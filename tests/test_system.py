import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from spool import system


class ShowTests(unittest.TestCase):
    def shown(self, platform, path, select, xdg='/usr/bin/xdg-open'):
        with patch.object(system.sys, 'platform', platform), patch.object(system.shutil, 'which', return_value=xdg), patch.object(system.subprocess, 'Popen') as launch:
            system.show(path, select=select)
        self.assertFalse(launch.call_args.kwargs['shell'])
        return launch.call_args.args[0]

    def test_each_platform_opens_its_file_manager(self):
        take = Path('/project/output/shot/take.mp4')
        self.assertEqual(self.shown('win32', take, True), ['explorer.exe', '/select,', str(take)])
        self.assertEqual(self.shown('win32', take.parent, False), ['explorer.exe', str(take.parent)])
        self.assertEqual(self.shown('darwin', take, True), ['open', '-R', str(take)])
        self.assertEqual(self.shown('darwin', take.parent, False), ['open', str(take.parent)])
        self.assertEqual(self.shown('linux', take, True), ['/usr/bin/xdg-open', str(take.parent)])
        self.assertEqual(self.shown('linux', take.parent, False), ['/usr/bin/xdg-open', str(take.parent)])

    def test_linux_without_a_desktop_refuses_and_reports_no_file_manager(self):
        with patch.object(system.sys, 'platform', 'linux'), patch.object(system.shutil, 'which', return_value=None), patch.object(system.subprocess, 'Popen') as launch:
            self.assertIsNone(system.file_manager())
            with self.assertRaisesRegex(ValueError, 'xdg-open'):
                system.show(Path('/project/output/shot'))
            launch.assert_not_called()
        for platform, name in (('win32', 'Explorer'), ('darwin', 'Finder')):
            with patch.object(system.sys, 'platform', platform):
                self.assertEqual(system.file_manager(), name)


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)

    def tool(self, name):
        path = self.folder / (name + ('.exe' if os.name == 'nt' else ''))
        path.write_text('', encoding='utf-8')
        path.chmod(0o755)
        return path

    def test_path_wins_then_the_platform_folders(self):
        ffmpeg = self.tool('ffmpeg')
        # The real platform, because shutil.which also reads sys.platform for PATHEXT.
        with patch.dict(os.environ, {'PATH': ''}):
            with patch.dict(system.EXTRA_FOLDERS, {sys.platform: (str(self.folder),)}):
                self.assertEqual(Path(system.find_tool('ffmpeg')), ffmpeg)
                self.assertIsNone(system.find_tool('ffprobe'))
            with patch.dict(system.EXTRA_FOLDERS, {sys.platform: ()}):
                self.assertIsNone(system.find_tool('ffmpeg'))
        with patch.dict(os.environ, {'PATH': str(self.folder)}), patch.dict(system.EXTRA_FOLDERS, {sys.platform: ('/elsewhere',)}):
            self.assertEqual(Path(system.find_tool('ffmpeg')), ffmpeg)

    def test_deadline_command_uses_the_installer_folder_then_the_default(self):
        with patch.dict(os.environ, {'PATH': '', 'DEADLINE_PATH': ''}), patch.object(system, 'EXTRA_FOLDERS', {}):
            for platform in ('win32', 'darwin', 'linux'):
                with patch.object(system.sys, 'platform', platform):
                    self.assertEqual(system.deadline_command(), system.DEADLINE[platform])
            deadline = self.tool('deadlinecommand')
            with patch.dict(os.environ, {'DEADLINE_PATH': str(self.folder)}):
                self.assertEqual(Path(system.deadline_command()), deadline)


if __name__ == '__main__':
    unittest.main()
