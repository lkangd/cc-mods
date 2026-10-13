"""The harness's isolation and run log, checked without starting a host."""
import importlib.util
import json
import os
import pathlib
import shlex
import tempfile
import unittest
from unittest import mock

import pty_harness


class FakeHost:
    binary = "/opt/claude/2.1.287/claude"
    version = "2.1.287"


class Isolation(unittest.TestCase):
    def setUp(self):
        with mock.patch.dict(os.environ, {"CHAT_TOC_PTY_TOKEN": ""}):
            self.world = pty_harness.World(root=pathlib.Path(tempfile.mkdtemp()))
        self.addCleanup(self.world.remove)

    def test_the_host_sees_only_the_world(self):
        env = self.world.environment()
        self.assertEqual(env["HOME"], str(self.world.home))
        self.assertEqual(env["CLAUDE_CONFIG_DIR"], str(self.world.config))
        self.assertTrue(env["TMPDIR"].startswith(str(self.world.base)))
        self.assertNotIn("CLAUDE_CODE_OAUTH_TOKEN", env)
        self.assertNotIn("CMUX_SOCKET_PATH", env)
        self.assertEqual(env["CLAUDE_CODE_NO_FLICKER"], "1")
        self.assertEqual(self.world.environment(fullscreen=False)["CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN"], "1")

    def test_the_config_is_onboarded_trusted_fullscreen_and_has_no_plugins(self):
        state = json.loads((self.world.config / ".claude.json").read_text())
        self.assertTrue(state["hasCompletedOnboarding"])
        self.assertTrue(state["projects"][str(self.world.project)]["hasTrustDialogAccepted"])
        settings = json.loads((self.world.config / "settings.json").read_text())
        self.assertEqual(settings, {"tui": "fullscreen"})
        self.assertFalse((self.world.config / "plugins").exists())

    def test_plugins_load_only_through_plugin_dir_and_no_model_without_a_token(self):
        argv = self.world.argv(FakeHost(), ["mods/chat-toc"], ["--resume", "s"])
        self.assertEqual(argv[0], FakeHost.binary)
        self.assertEqual(argv[1:3], ["--plugin-dir", str(pathlib.Path("mods/chat-toc").resolve())])
        self.assertEqual(argv[3:], ["--resume", "s"])

    def test_a_token_logs_in_and_picks_haiku(self):
        world = pty_harness.World(root=self.world.base, token="tok")
        self.assertEqual(world.environment()["CLAUDE_CODE_OAUTH_TOKEN"], "tok")
        self.assertIn("haiku", world.argv(FakeHost()))

    def test_a_fixture_lands_where_resume_finds_it(self):
        out = self.world.fixture("turns", turns=3)
        self.assertEqual(pathlib.Path(out["path"]), self.world.transcript(out["session"]))
        self.assertTrue(str(out["path"]).startswith(str(self.world.config / "projects")))

    def test_the_cmux_line_clears_the_inherited_environment(self):
        line = pty_harness.cmux_launch_command(["/x/claude", "--resume", "a b"], {"HOME": "/w/h"}, pathlib.Path("/w/p q"))
        self.assertEqual(shlex.split(line), ["cd", "/w/p q", "&&", "exec", "env", "-i", "HOME=/w/h", "/x/claude", "--resume", "a b"])


class RunLog(unittest.TestCase):
    def test_a_record_carries_the_report_fields_and_relative_evidence(self):
        run = pty_harness.Run(pathlib.Path(tempfile.mkdtemp()) / "r")
        shot = run.snap(["a", "b"], "after click")
        run.record("CT-JUMP-001", host="2.1.287", plugin="mods/chat-toc", fixture="turns-300",
                   expected="jumps to T0001", actual="T0001 on top", result="pass", evidence=[shot])
        line = json.loads((run.dir / "run.jsonl").read_text().splitlines()[0])
        for field in ("scenario", "host", "plugin", "fixture", "os", "arch", "expected", "actual", "result", "evidence", "at"):
            self.assertIn(field, line)
        self.assertEqual(line["evidence"], ["screens/001-after-click.txt"])
        self.assertEqual(shot.read_text().splitlines()[1:], ["a", "b"])

    def test_a_result_is_pass_fail_or_skip(self):
        run = pty_harness.Run(pathlib.Path(tempfile.mkdtemp()) / "r")
        with self.assertRaises(ValueError):
            run.record("X", host="h", plugin="p", fixture="f", expected="e", actual="a", result="ok", evidence=[])


class Cell:
    def __init__(self, data):
        self.data = data


class Screen:
    def __init__(self, *rows):
        self.lines, self.columns = len(rows), len(rows[0])
        self.buffer = [[Cell(d) for d in row] for row in rows]


def wide(char: str) -> int:
    return 2 if char in "中文" else 1


class ScreenRows(unittest.TestCase):
    def test_a_wide_char_takes_its_placeholder_with_it(self):
        self.assertEqual(pty_harness.screen_rows(Screen(["中", "", "b", " "]), wide), ["中b"])

    def test_a_placeholder_a_narrow_char_left_behind_reads_as_a_space(self):
        # the host overwrote the wide char's first cell mid-frame; pyte's own display raises here
        self.assertEqual(pty_harness.screen_rows(Screen(["a", "", "b", " "], ["文", "", "", "c"]), wide), ["a b", "文 c"])

    @unittest.skipUnless(importlib.util.find_spec("pyte"), "pyte is in the PTY venv only")
    def test_pyte_overwritten_mid_frame(self):
        import pyte
        screen = pyte.Screen(6, 1)
        stream = pyte.Stream(screen)
        stream.feed("中b\r")
        stream.feed("a")
        with self.assertRaises(IndexError):
            screen.display
        self.assertEqual(pty_harness.screen_rows(screen), ["a b"])


if __name__ == "__main__":
    unittest.main()
