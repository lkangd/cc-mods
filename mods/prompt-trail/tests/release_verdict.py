#!/usr/bin/env python3
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "release"))
import evidence  # noqa: E402

VERSIONS = ["2.1.273", "2.1.283"]


def scenario(id_: str, evidence_refs: list[dict], layers: list[str] | None = None) -> dict:
    return {
        "id": id_,
        "title": id_,
        "steps": ["step"],
        "expected": "expected",
        "layers": layers if layers is not None else sorted({e["kind"] for e in evidence_refs}),
        "evidence": evidence_refs,
    }


def full_manifest() -> dict:
    """Every required scenario, each resting on one unit test that `passing` settles."""
    return {
        "formatVersion": 1,
        "scenarios": [
            scenario(id_, [{"kind": "unit", "ref": f"suite.Case.test_{index}"}])
            for index, id_ in enumerate(evidence.REQUIRED_SCENARIOS)
        ],
    }


def unit_results(manifest: dict, outcome: str = "pass") -> evidence.Results:
    results = evidence.Results()
    for item in manifest["scenarios"]:
        for ref in item["evidence"]:
            results.record(ref["kind"], ref["ref"], None, outcome)
    return results


class PluginTestOutputTests(unittest.TestCase):
    def test_each_test_is_named_by_its_file_and_title(self) -> None:
        output = "\n".join([
            "npm warn Unknown user config",
            "",
            "tests/a.test.tsx:",
            "(pass) starts collapsed [12.30ms]",
            "(fail) keeps the draft [1.00ms]",
            "tests/b.test.tsx:",
            "(skip) a later idea",
            "(todo) not yet",
            "(pass) a Run’s gap, drawn in a warning colour [3.10ms]",
            "",
            " 2 pass",
            " 1 fail",
            "Ran 5 tests across 2 files. [1.2s]",
        ])
        self.assertEqual(evidence.parse_plugin_test_output(output), {
            "tests/a.test.tsx::starts collapsed": "pass",
            "tests/a.test.tsx::keeps the draft": "fail",
            "tests/b.test.tsx::a later idea": "skip",
            "tests/b.test.tsx::not yet": "skip",
            "tests/b.test.tsx::a Run’s gap, drawn in a warning colour": "pass",
        })

    def test_a_title_seen_twice_in_one_file_is_a_failure_not_a_pass(self) -> None:
        output = "tests/a.test.tsx:\n(pass) same [1ms]\n(pass) same [1ms]\n"
        self.assertEqual(
            evidence.parse_plugin_test_output(output), {"tests/a.test.tsx::same": "fail"}
        )


class ScenarioVerdictTests(unittest.TestCase):
    def test_a_scenario_passes_only_when_every_ref_passes_on_every_version(self) -> None:
        item = scenario("PT-X-001", [
            {"kind": "plugin", "ref": "tests/a.test.tsx::one"},
            {"kind": "unit", "ref": "suite.Case.test_one"},
        ])
        results = evidence.Results()
        results.record("unit", "suite.Case.test_one", None, "pass")
        results.record("plugin", "tests/a.test.tsx::one", "2.1.273", "pass")
        verdict = evidence.judge_scenario(item, results, VERSIONS)
        self.assertEqual(verdict["outcome"], "missing")
        self.assertEqual(
            [(e["version"], e["outcome"]) for e in verdict["evidence"] if e["kind"] == "plugin"],
            [("2.1.273", "pass"), ("2.1.283", "missing")],
        )
        results.record("plugin", "tests/a.test.tsx::one", "2.1.283", "pass")
        self.assertEqual(evidence.judge_scenario(item, results, VERSIONS)["outcome"], "pass")

    def test_failed_outranks_missing_which_outranks_skipped(self) -> None:
        item = scenario("PT-X-001", [
            {"kind": "unit", "ref": "suite.Case.test_skip"},
            {"kind": "unit", "ref": "suite.Case.test_absent"},
            {"kind": "unit", "ref": "suite.Case.test_fail"},
        ])
        results = evidence.Results()
        results.record("unit", "suite.Case.test_skip", None, "skip")
        self.assertEqual(evidence.judge_scenario(item, results, VERSIONS)["outcome"], "missing")
        results.record("unit", "suite.Case.test_fail", None, "fail")
        self.assertEqual(evidence.judge_scenario(item, results, VERSIONS)["outcome"], "failed")
        only_skipped = scenario("PT-X-002", [{"kind": "unit", "ref": "suite.Case.test_skip"}])
        self.assertEqual(
            evidence.judge_scenario(only_skipped, results, VERSIONS)["outcome"], "skipped"
        )

    def test_a_layer_without_evidence_is_missing_even_when_the_rest_passes(self) -> None:
        item = scenario(
            "PT-X-001", [{"kind": "unit", "ref": "suite.Case.test_one"}], layers=["unit", "pty"]
        )
        results = evidence.Results()
        results.record("unit", "suite.Case.test_one", None, "pass")
        verdict = evidence.judge_scenario(item, results, VERSIONS)
        self.assertEqual(verdict["outcome"], "missing")
        self.assertIn("pty", verdict["actual"])

    def test_a_scenario_with_no_evidence_at_all_is_missing(self) -> None:
        item = scenario("PT-X-001", [], layers=[])
        self.assertEqual(
            evidence.judge_scenario(item, evidence.Results(), VERSIONS)["outcome"], "missing"
        )

    def test_a_pty_ref_carries_what_the_run_saw_and_where_its_trace_is(self) -> None:
        item = scenario("PT-X-001", [{"kind": "pty", "ref": "PT-X-001"}])
        results = evidence.Results()
        for version in VERSIONS:
            results.record(
                "pty", "PT-X-001", version, "pass",
                actual="one entry", link=f"pty/{version}/PT-X-001.txt",
            )
        verdict = evidence.judge_scenario(item, results, VERSIONS)
        self.assertEqual(verdict["outcome"], "pass")
        self.assertEqual(
            [e["link"] for e in verdict["evidence"]],
            ["pty/2.1.273/PT-X-001.txt", "pty/2.1.283/PT-X-001.txt"],
        )
        self.assertIn("one entry", verdict["actual"])


class ReportVerdictTests(unittest.TestCase):
    def verdict(self, manifest: dict, results: evidence.Results, **overrides) -> dict:
        options = {
            "versions": VERSIONS,
            "partial": False,
            "tree_clean": True,
            "leaks": [],
            "gates": [{"name": "plugin-validate", "outcome": "pass"}],
        }
        options.update(overrides)
        return evidence.judge_report(manifest, results, **options)

    def test_only_zero_missing_skipped_failed_and_leaked_passes(self) -> None:
        manifest = full_manifest()
        report = self.verdict(manifest, unit_results(manifest))
        self.assertEqual(report["overall"], "pass", report["reasons"])
        self.assertEqual(report["counts"]["pass"], len(evidence.REQUIRED_SCENARIOS))

    def test_one_skipped_scenario_fails_the_release(self) -> None:
        manifest = full_manifest()
        results = unit_results(manifest)
        first = manifest["scenarios"][0]["evidence"][0]["ref"]
        results.record("unit", first, None, "skip")
        report = self.verdict(manifest, results)
        self.assertEqual(report["overall"], "fail")
        self.assertEqual(report["counts"]["skipped"], 1)

    def test_a_scenario_dropped_from_the_manifest_is_missing(self) -> None:
        manifest = full_manifest()
        dropped = manifest["scenarios"].pop()
        report = self.verdict(manifest, unit_results(manifest))
        self.assertEqual(report["overall"], "fail")
        self.assertIn(dropped["id"], [s["id"] for s in report["scenarios"] if s["outcome"] == "missing"])

    def test_a_scenario_the_contract_does_not_know_fails_the_release(self) -> None:
        manifest = full_manifest()
        manifest["scenarios"].append(scenario("PT-EXTRA-001", [{"kind": "unit", "ref": "x.Y.test_z"}]))
        results = unit_results(manifest)
        report = self.verdict(manifest, results)
        self.assertEqual(report["overall"], "fail")
        self.assertTrue(any("PT-EXTRA-001" in reason for reason in report["reasons"]))

    def test_a_partial_run_a_dirty_tree_a_leak_or_a_failed_gate_each_fail(self) -> None:
        manifest = full_manifest()
        results = unit_results(manifest)
        for override in (
            {"partial": True},
            {"tree_clean": False},
            {"leaks": [{"path": "home/log.txt", "kind": "marker"}]},
            {"gates": [{"name": "typescript", "outcome": "fail"}]},
        ):
            with self.subTest(override=override):
                report = self.verdict(manifest, results, **override)
                self.assertEqual(report["overall"], "fail")
                self.assertTrue(report["reasons"])

    def test_every_contract_family_is_required_with_its_count(self) -> None:
        families = {}
        for id_ in evidence.REQUIRED_SCENARIOS:
            family = id_.rsplit("-", 1)[0]
            families[family] = families.get(family, 0) + 1
        self.assertEqual(families, {
            "PT-COMPAT": 5, "PT-CAPTURE": 8, "PT-LIFE": 4, "PT-BRANCH": 4, "PT-JUMP": 2,
            "PT-UI": 8, "PT-STORE": 9, "PT-FAIL": 6, "PT-CONTROL": 2, "PT-DELETE": 4,
            "PT-SEC": 4,
        })


class MarkerTests(unittest.TestCase):
    def test_a_marker_puts_128_random_bits_before_the_scenario_id(self) -> None:
        first = evidence.new_marker("PT-CAPTURE-003")
        second = evidence.new_marker("PT-CAPTURE-003")
        self.assertRegex(first, r"^[0-9a-f]{32}-PT-CAPTURE-003$")
        self.assertNotEqual(first, second)

    def test_a_leak_is_found_whole_or_cut_to_twelve_characters(self) -> None:
        marker = "0123456789abcdef0123456789abcdef-PT-CAPTURE-001"
        scanner = evidence.Scanner([marker], secrets=["sk-secret-token"])
        self.assertEqual(scanner.find(f"x {marker} y".encode()), ["marker"])
        self.assertEqual(scanner.find(b"row 0123456789ab\xe2\x80\xa6"), ["marker"])
        self.assertEqual(scanner.find(b"row 0123456789a\xe2\x80\xa6"), [])
        self.assertEqual(scanner.find(b"auth sk-secret-token"), ["secret"])
        self.assertEqual(scanner.find(b"nothing here"), [])

    def test_redaction_masks_whole_and_cut_markers_keeping_the_layout(self) -> None:
        marker = "0123456789abcdef0123456789abcdef-PT-CAPTURE-001"
        scanner = evidence.Scanner([marker], secrets=[])
        rows = [
            f"❯ {marker} 请只回复 ok",
            "│ 0123456789abcdef01… ",
        ]
        redacted = scanner.redact_rows(rows)
        self.assertEqual([len(row) for row in redacted], [len(row) for row in rows])
        self.assertEqual(scanner.find("\n".join(redacted).encode()), [])
        self.assertTrue(redacted[0].startswith("❯ <marker:1>"))
        self.assertIn("请只回复 ok", redacted[0])
        self.assertTrue(redacted[1].startswith("│ <marker:1>"))

    def test_redaction_finds_a_marker_split_across_two_full_rows(self) -> None:
        marker = "0123456789abcdef0123456789abcdef-PT-CAPTURE-001"
        width = 20
        text = ("> " + marker).ljust(3 * width)
        rows = [text[i:i + width] for i in range(0, len(text), width)]
        redacted = evidence.Scanner([marker], secrets=[]).redact_rows(rows, width=width)
        self.assertEqual(evidence.Scanner([marker], secrets=[]).find("".join(redacted).encode()), [])
        self.assertNotIn("0123", "".join(redacted))
        self.assertNotIn("456789abcdef", redacted[1])


class ScannerGrowthTests(unittest.TestCase):
    def test_a_marker_added_later_is_found_and_masked_like_the_first(self) -> None:
        first = "0123456789abcdef0123456789abcdef-PT-CAPTURE-001"
        later = "fedcba9876543210fedcba9876543210-PT-CAPTURE-002"
        scanner = evidence.Scanner([first], secrets=[])
        self.assertEqual(scanner.find(later.encode()), [])
        scanner.add(later)
        self.assertEqual(scanner.find(later.encode()), ["marker"])
        self.assertEqual(scanner.redact_rows([later])[0][:10], "<marker:2>")


class NetworkFailureTests(unittest.TestCase):
    def test_a_trace_with_the_hosts_retry_notice_is_a_network_failure(self) -> None:
        for line in (
            "✻ Connection dropped (ECONNRESET) · Retrying in 5s · attempt 7/10",
            "⎿  API Error: 529 overloaded_error",
            "⎿  API Error: Request timed out.",
        ):
            with self.subTest(line=line):
                self.assertTrue(evidence.network_failure(f"==== step\n{line}\n"))

    def test_a_trace_without_one_is_not(self) -> None:
        self.assertFalse(evidence.network_failure("==== step\n⏺ ok\n❯ \n"))
        self.assertFalse(evidence.network_failure("the archive is unavailable · retrying"))


class ScanTreeTests(unittest.TestCase):
    def test_only_the_archive_family_and_host_conversation_files_may_hold_a_marker(self) -> None:
        marker = evidence.new_marker("PT-SEC-001")
        scanner = evidence.Scanner([marker], secrets=[])
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary)
            archives = base / "home/.claude/plugins/data/prompt-trail-inline/archives"
            archives.mkdir(parents=True)
            project = base / "home/.claude/projects/-tmp-project"
            project.mkdir(parents=True)
            allowed = [
                archives / ("a" * 64 + ".sqlite3"),
                archives / ("a" * 64 + ".sqlite3-wal"),
                archives / ("a" * 64 + ".sqlite3.pre-migration-v1"),
                archives / "quarantine" / ("a" * 64) / "moved-1" / ("a" * 64 + ".sqlite3-shm"),
                project / "session.jsonl",
                base / "home/.claude/history.jsonl",
            ]
            leaking = [
                base / "home/.claude/plugins/store/prompt-trail_inline-x.json",
                archives / ("a" * 64 + ".clearing-run"),
                archives / ("a" * 64 + ".sqlite3.bak"),
                base / "home/.claude/plugins/store" / ("a" * 64 + ".sqlite3"),
                base / "home/.claude/debug/latest",
                base / "tmp/trace.txt",
            ]
            for path in allowed + leaking:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"{marker}\n")
            (base / "clean.txt").write_text("nothing\n")
            found = evidence.scan_tree(base, scanner)
            self.assertEqual(
                sorted(item["path"] for item in found["leaks"]),
                sorted(str(path.relative_to(base)) for path in leaking),
            )
            self.assertEqual(found["scannedFiles"], len(leaking) + 1)
            self.assertEqual(found["allowedFiles"], len(allowed))


class RenderTests(unittest.TestCase):
    def test_the_markdown_report_names_every_scenario_and_the_verdict(self) -> None:
        manifest = full_manifest()
        report = evidence.judge_report(
            manifest, unit_results(manifest), versions=VERSIONS, partial=False,
            tree_clean=True, leaks=[], gates=[],
        )
        report["identity"] = {"commit": "abc"}
        text = evidence.render_markdown(report)
        self.assertIn("**Overall: pass**", text)
        for id_ in evidence.REQUIRED_SCENARIOS:
            self.assertIn(id_, text)
        json.dumps(report)


if __name__ == "__main__":
    unittest.main()
