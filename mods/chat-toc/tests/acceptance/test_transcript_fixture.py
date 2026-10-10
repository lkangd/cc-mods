"""The synthetic transcript generator: the shapes it promises, checked against
its own record of what it wrote and, independently, against the verifier."""
import datetime
import json
import pathlib
import tempfile
import unittest

import toc_verifier
import transcript_fixture

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 10, tzinfo=UTC)


def rows_of(path: pathlib.Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class Forms(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = pathlib.Path(tempfile.mkdtemp())
        cls.out = transcript_fixture.generate("forms", cls.dir / "config", "/tmp/proj", "00000000-0000-4000-8000-0000000000f0")
        cls.path = pathlib.Path(cls.out["path"])
        cls.toc = toc_verifier.expected_toc(cls.path, tz=UTC, now=NOW)

    def test_lands_where_the_host_looks_for_a_resumed_session(self):
        self.assertEqual(self.path, self.dir / "config" / "projects" / "-tmp-proj" / "00000000-0000-4000-8000-0000000000f0.jsonl")

    def test_every_group_the_generator_meant_is_what_the_verifier_finds(self):
        meant = [(e["user"], e["steps"]) for e in self.out["groups"]]
        found = [(g.user_text, g.steps) for g in self.toc.groups]
        self.assertEqual(found, meant)

    def test_covers_every_shape_the_ticket_names(self):
        rows = rows_of(self.path)
        kinds = {g.kind for g in self.toc.groups}
        self.assertEqual(kinds, {"prompt", "command", "bang"})
        self.assertTrue(any(r.get("type") == "system" and r.get("subtype") == "local_command"
                            and "<command-name>" in r.get("content", "") for r in rows), "system-row command")
        self.assertTrue(any(r.get("type") == "user" and r.get("origin") is None
                            and "<command-name>" in str(r["message"]["content"]) for r in rows), "user-row local command")
        self.assertTrue(any(r.get("subtype") == "compact_boundary" for r in rows), "compact")
        self.assertTrue(any(r.get("isApiErrorMessage") for r in rows), "error")
        statuses = {g.status for g in self.toc.groups}
        self.assertEqual(statuses, {"done", "interrupted", "error"})
        self.assertTrue(any(g.time is None for g in self.toc.groups), "a prompt without timestamp")
        self.assertTrue(any(g.has_agent and g.last_text is None and g.status == "done" for g in self.toc.groups), "no text reply")
        self.assertGreaterEqual([g.user_text for g in self.toc.groups].count(self.out["repeated"]), 3)
        # a rewind leaves an abandoned branch in the file that the chain skips
        on_chain = set(self.toc.chain)
        abandoned = [r for r in rows if r.get("uuid") and r["uuid"] not in on_chain and r.get("type") == "user"]
        self.assertTrue(any(self.out["abandoned"] in str(r["message"]["content"]) for r in abandoned))

    def test_a_subagent_writes_its_own_file_and_counts_one_step(self):
        files = list((self.path.parent / self.path.stem / "subagents").glob("agent-*.jsonl"))
        self.assertEqual(len(files), 1)
        self.assertTrue(all(r["isSidechain"] for r in rows_of(files[0])))
        self.assertFalse(any(r.get("isSidechain") for r in rows_of(self.path)))
        agent_group = next(g for g in self.toc.groups if g.user_text == self.out["subagent"])
        self.assertEqual(agent_group.steps, 1)

    def test_is_reproducible(self):
        again = transcript_fixture.generate("forms", self.dir / "again", "/tmp/proj", "00000000-0000-4000-8000-0000000000f0")
        self.assertEqual(pathlib.Path(again["path"]).read_bytes(), self.path.read_bytes())


class Sizes(unittest.TestCase):
    def test_turns_makes_that_many_groups(self):
        out = transcript_fixture.generate("turns", pathlib.Path(tempfile.mkdtemp()), "/tmp/p", "00000000-0000-4000-8000-000000000003", turns=300)
        toc = toc_verifier.expected_toc(pathlib.Path(out["path"]), tz=UTC, now=NOW)
        self.assertEqual(len(toc.groups), 300)
        self.assertEqual([(g.user_text, g.steps) for g in toc.groups], [(e["user"], e["steps"]) for e in out["groups"]])

    def test_many_and_heavy_reach_twenty_mebibytes_with_the_measured_turn_counts(self):
        # the project path is part of every row; this one is as long as the harness's
        cwd = "/private/var/folders/zz/abcdefghijklmnop_qrstuvwx/T/chat-toc-pty-abcd1234/project"
        for kind, low, high in (("many", 4300, 4600), ("heavy", 100, 125)):
            with self.subTest(kind):
                out = transcript_fixture.generate(kind, pathlib.Path(tempfile.mkdtemp()), cwd, "00000000-0000-4000-8000-000000000001", mib=20)
                path = pathlib.Path(out["path"])
                self.assertGreaterEqual(path.stat().st_size, 20 * 1048576)
                self.assertLess(path.stat().st_size, 21 * 1048576)
                self.assertTrue(low <= out["turns"] <= high, out["turns"])
                toc = toc_verifier.expected_toc(path, tz=UTC, now=NOW)
                self.assertEqual(len(toc.groups), len(out["groups"]))
                self.assertEqual(toc.groups[-1].user_text, out["groups"][-1]["user"])


if __name__ == "__main__":
    unittest.main()
