"""Run with python -m unittest discover -s mods/chat-interpreter/tests."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[1] / "scripts" / "provision.py"


class ProvisionTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.config = Path(temp.name)
        self.env = {**os.environ, "CLAUDE_CONFIG_DIR": temp.name, "PYTHONIOENCODING": "utf-8",
                    "LC_ALL": "en_US.UTF-8", "TRANSLATOR_TEST_KEY": "test-only-value"}
        self.command = [sys.executable, str(HELPER), "example-candidate", "--from-env", "TRANSLATOR_TEST_KEY"]
        self.directory = self.config / "chat-interpreter" / "credentials"
        self.saved = self.directory / "example-candidate.json"

    def run_helper(self):
        return subprocess.run(self.command, env=self.env, capture_output=True, encoding="utf-8")

    def test_concurrent_publication_has_one_winner(self):
        workers = [subprocess.Popen(self.command, env={**self.env, "TRANSLATOR_TEST_KEY": key},
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                   for key in ("first-dummy", "second-dummy")]
        for worker in workers:
            out, err = worker.communicate(timeout=15)
            for key in (b"first-dummy", b"second-dummy"):
                self.assertNotIn(key, out + err)
        self.assertCountEqual([worker.returncode for worker in workers], [0, 1])
        winner = "first-dummy" if workers[0].returncode == 0 else "second-dummy"
        self.assertEqual(json.loads(self.saved.read_text()), {"secret": winner})
        self.assertEqual(list(self.directory.iterdir()), [self.saved])

    def test_chinese_success_and_duplicate_diagnostic_are_private(self):
        self.env["LC_ALL"] = "zh_CN.UTF-8"
        first = self.run_helper()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("继续", first.stdout)
        again = self.run_helper()
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("候选", again.stderr)
        self.assertNotIn(self.env["TRANSLATOR_TEST_KEY"], first.stdout + again.stderr)

    def test_unrecognized_argument_is_not_echoed(self):
        self.env["LC_ALL"] = "zh_CN.UTF-8"
        self.command.append("--sensitive-mistyped-argument")
        result = self.run_helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("参数", result.stderr)
        self.assertNotIn("sensitive-mistyped-argument", result.stderr)

    def test_existing_unsafe_directory_refuses_publication(self):
        folder = self.directory.parent
        folder.mkdir(mode=0o755)
        if os.name == "posix":
            folder.chmod(0o755)
        result = self.run_helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.saved.exists())
        self.assertNotIn(self.env["TRANSLATOR_TEST_KEY"], result.stderr)

    @unittest.skipUnless(os.name == "nt", "requires a native Windows ACL")
    def test_windows_saved_file_only_grants_the_current_user_access(self):
        import win32api
        import win32con
        import win32security as security

        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        token = security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
        sid = security.GetTokenInformation(token, security.TokenUser)[0]
        acl = security.GetNamedSecurityInfo(str(self.saved), security.SE_FILE_OBJECT,
                                            security.DACL_SECURITY_INFORMATION).GetSecurityDescriptorDacl()
        self.assertEqual(acl.GetAceCount(), 1)
        self.assertEqual(acl.GetAce(0)[2], sid)
