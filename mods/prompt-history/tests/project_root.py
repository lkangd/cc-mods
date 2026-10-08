#!/usr/bin/env python3
"""What Git answers for the start directories a Project Timeline is keyed by.

The plugin asks exactly this (`gitToplevelArgv` in `hooks/project.ts`) and
then takes the answer's `realpath`; these tests pin the Git behaviour that
the per-project isolation rests on."""
import os
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES"]


def toplevel(directory: pathlib.Path, environment: dict[str, str] | None = None) -> str | None:
    argv = ["/usr/bin/env"]
    for name in GIT_REDIRECTS:
        argv += ["-u", name]
    argv += ["/usr/bin/git", "-C", str(directory), "rev-parse", "--show-toplevel"]
    result = subprocess.run(
        argv, capture_output=True, text=True, check=False, env=environment or os.environ.copy()
    )
    if result.returncode != 0:
        return None
    return os.path.realpath(result.stdout.strip())


class ProjectRootTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = pathlib.Path(os.path.realpath(temporary.name))
        self.repo = self.base / "repo"
        (self.repo / "src" / "deep").mkdir(parents=True)
        self.git("init", "-q")
        (self.repo / "file").write_text("x\n")
        self.git("add", "file")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init")

    def git(self, *args: str) -> None:
        subprocess.run(["/usr/bin/git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def test_the_plugin_removes_the_same_variables(self) -> None:
        source = (ROOT / "hooks" / "project.ts").read_text()
        declared = re.search(r"const GIT_REDIRECTS = \[([^\]]*)\]", source)
        self.assertIsNotNone(declared)
        self.assertEqual(re.findall(r"'([A-Z_]+)'", declared.group(1)), GIT_REDIRECTS)

    def test_a_subdirectory_and_a_symlink_into_it_share_the_repositorys_root(self) -> None:
        link = self.base / "link"
        link.symlink_to(self.repo / "src")

        self.assertEqual(toplevel(self.repo / "src" / "deep"), str(self.repo))
        self.assertEqual(toplevel(link), str(self.repo))

    def test_a_worktree_is_a_project_root_of_its_own(self) -> None:
        worktree = self.base / "repo-wt"
        self.git("worktree", "add", "-q", str(worktree))
        (worktree / "src").mkdir(exist_ok=True)

        self.assertEqual(toplevel(worktree / "src"), str(worktree))
        self.assertNotEqual(toplevel(worktree), toplevel(self.repo))

    def test_a_directory_outside_any_repository_has_no_git_root(self) -> None:
        plain = self.base / "plain"
        plain.mkdir()

        self.assertIsNone(toplevel(plain))

    def test_git_variables_inherited_from_the_host_do_not_move_the_root(self) -> None:
        other = self.base / "other"
        other.mkdir()
        subprocess.run(["/usr/bin/git", "-C", str(other), "init", "-q"], check=True)
        environment = {
            **os.environ,
            "GIT_DIR": str(other / ".git"),
            "GIT_WORK_TREE": str(other),
        }

        self.assertEqual(toplevel(self.repo / "src", environment), str(self.repo))


if __name__ == "__main__":
    unittest.main()
