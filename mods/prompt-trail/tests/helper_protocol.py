#!/usr/bin/env python3
import json
import os
import pathlib
import pwd
import shutil
import stat
import subprocess
import tempfile
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = ROOT / "bin" / "prompt-trail-helper"
BRIDGE = ROOT / "bin" / "prompt-trail-bridge"
MANIFEST = ROOT / "artifacts" / "helper-manifest.json"
SEMANTIC_VERIFIER = ROOT / "tests" / "semantic_verifier.py"


class HelperProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = pathlib.Path(self.temporary.name) / "home"
        self.plugin_data = pathlib.Path(self.temporary.name) / "plugin-data"
        self.home.mkdir(mode=0o700)
        self.plugin_data.mkdir(mode=0o700)
        self.plugin_data = self.plugin_data.resolve()
        self.session_id = str(uuid.uuid4())
        self.environment = {**os.environ, "HOME": str(self.home)}

    @property
    def locator(self) -> pathlib.Path:
        return (
            self.home
            / ".claude/plugins/data/.function-hook-locators/prompt-trail"
            / f"{self.session_id}.json"
        )

    def run_helper(
        self,
        *args: str,
        input_text: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(HELPER), *args],
            input=input_text,
            check=False,
            capture_output=True,
            text=True,
            env=self.environment,
        )

    def begin_argv(
        self,
        event_id: str,
        *,
        project_id: str,
        run_id: str,
        segment_id: str,
        branch_id: str,
        parent: str = "-",
        occurred_at: str = "1795000000000",
    ) -> tuple[str, ...]:
        return (
            "capture-begin",
            str(self.plugin_data / "archives"),
            project_id,
            run_id,
            segment_id,
            branch_id,
            parent,
            event_id,
            occurred_at,
            "1",
            "image",
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
            "--stdin",
        )

    def confirm_argv(self, event_id: str, *, project_id: str) -> tuple[str, ...]:
        return (
            "capture-confirm",
            str(self.plugin_data / "archives"),
            project_id,
            event_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
            "--stdin",
        )

    def verify_archive(self, request: dict[str, object]) -> dict[str, object]:
        result = subprocess.run(
            ["python3", str(SEMANTIC_VERIFIER)],
            input=json.dumps(request),
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertNotIn("PT-SECRET", result.stdout + result.stderr)
        return json.loads(result.stdout)

    def publish_locator(self) -> None:
        hook_input = {
            "session_id": self.session_id,
            "transcript_path": str(self.home / "transcript.jsonl"),
            "cwd": str(ROOT),
            "hook_event_name": "SessionStart",
            "source": "startup",
        }
        result = subprocess.run(
            [
                str(BRIDGE),
                "publish",
                str(ROOT),
                str(self.plugin_data),
                str(HELPER),
                str(MANIFEST),
            ],
            input=json.dumps(hook_input),
            check=False,
            capture_output=True,
            text=True,
            env=self.environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        locator = json.loads(self.locator.read_text())
        locator["hostVersion"] = "2.1.278"
        self.locator.write_text(json.dumps(locator) + "\n")
        self.locator.chmod(0o600)

    def test_read_only_probe_reports_supported_capabilities(self) -> None:
        result = self.run_helper("probe", "--protocol", "1")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "supported")
        self.assertEqual(payload["helperProtocol"], 1)
        self.assertEqual(payload["target"], "darwin-arm64-macos15")
        self.assertGreaterEqual(payload["sqliteVersionNumber"], 3_035_000)
        self.assertTrue(payload["sqliteReturning"])

    def test_probe_rejects_a_protocol_mismatch(self) -> None:
        result = self.run_helper("probe", "--protocol", "99")

        self.assertEqual(result.returncode, 23)
        self.assertEqual(result.stdout, "")
        payload = json.loads(result.stderr)
        self.assertEqual(payload["category"], "protocol-mismatch")
        self.assertNotIn("prompt", result.stderr.lower())

    def test_preflight_validates_the_locator_without_creating_an_archive(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            str(manifest["helperProtocol"]),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "supported")
        self.assertEqual(payload["artifactStatus"], "trusted")
        self.assertEqual(payload["sessionId"], self.session_id)
        self.assertEqual(payload["databaseRoot"], str(self.plugin_data.resolve() / "archives"))
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_preflight_rejects_a_claude_version_below_the_minimum(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        locator = json.loads(self.locator.read_text())
        locator["hostVersion"] = "2.1.272"
        self.locator.write_text(json.dumps(locator) + "\n")
        self.locator.chmod(0o600)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            str(manifest["helperProtocol"]),
        )

        self.assertEqual(result.returncode, 10)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "claude-code-version")

    def test_preflight_accepts_a_non_write_artifact_acl(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest_path = plugin_root / "artifacts/helper-manifest.json"
        shutil.copy2(HELPER, helper)
        shutil.copy2(MANIFEST, manifest_path)
        username = pwd.getpwuid(os.geteuid()).pw_name
        subprocess.run(
            ["/bin/chmod", "+a", f"{username} allow read", str(helper)],
            check=True,
            capture_output=True,
            text=True,
        )
        hook_input = {
            "session_id": self.session_id,
            "transcript_path": str(self.home / "transcript.jsonl"),
            "cwd": str(ROOT),
            "hook_event_name": "SessionStart",
            "source": "startup",
        }
        published = subprocess.run(
            [
                str(BRIDGE),
                "publish",
                str(plugin_root),
                str(self.plugin_data),
                str(helper),
                str(manifest_path),
            ],
            input=json.dumps(hook_input),
            check=False,
            capture_output=True,
            text=True,
            env=self.environment,
        )
        self.assertEqual(published.returncode, 0, published.stderr)
        locator = json.loads(self.locator.read_text())
        self.assertEqual(locator["artifactStatus"], "trusted")
        locator["hostVersion"] = "2.1.278"
        self.locator.write_text(json.dumps(locator) + "\n")
        self.locator.chmod(0o600)
        manifest = json.loads(manifest_path.read_text())

        result = subprocess.run(
            [
                str(helper),
                "preflight",
                "--locator",
                str(self.locator),
                "--session",
                self.session_id,
                "--expected-sha",
                manifest["sha256"],
                "--protocol",
                str(manifest["helperProtocol"]),
            ],
            check=False,
            capture_output=True,
            text=True,
            env=self.environment,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "supported")

    def test_preflight_rejects_a_widened_locator(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        self.locator.chmod(0o644)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            "1",
        )

        self.assertEqual(result.returncode, 21)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "locator-permissions")

    def test_preflight_rejects_a_locator_with_an_extended_acl(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        username = pwd.getpwuid(os.geteuid()).pw_name
        subprocess.run(
            ["/bin/chmod", "+a", f"{username} allow read", str(self.locator)],
            check=True,
            capture_output=True,
            text=True,
        )

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            "1",
        )

        self.assertEqual(result.returncode, 21)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "locator-permissions")

    def test_preflight_rejects_a_symlink_locator(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        target = self.locator.with_suffix('.target')
        self.locator.rename(target)
        self.locator.symlink_to(target)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            "1",
        )

        self.assertEqual(result.returncode, 21)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "locator-permissions")

    def test_preflight_rejects_a_stale_host_generation(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        payload = json.loads(self.locator.read_text())
        payload["hostStartMicroseconds"] += 1
        self.locator.write_text(json.dumps(payload) + "\n")
        self.locator.chmod(0o600)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            "1",
        )

        self.assertEqual(result.returncode, 21)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "host-generation")

    def test_preflight_rejects_a_locator_for_another_session(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        payload = json.loads(self.locator.read_text())
        payload["sessionId"] = str(uuid.uuid4())
        self.locator.write_text(json.dumps(payload) + "\n")
        self.locator.chmod(0o600)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(self.locator),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            "1",
        )

        self.assertEqual(result.returncode, 21)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "locator-session")

    def test_capture_stages_then_atomically_confirms_a_prompt_entry(self) -> None:
        manifest = json.loads(MANIFEST.read_text())
        database_root = self.plugin_data / "archives"
        project_id = "2f8f609b94d1dceb67370dea36cf1d5e5a9cd5dc909d3a0673cbc45b69ea1796"
        event_id = str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        segment_id = str(uuid.uuid4())
        branch_id = str(uuid.uuid4())
        original = "PT-SECRET-ORIGINAL\nsecond line"
        final = "PT-SECRET-FINAL\nsecond line"
        begin_argv = (
            "capture-begin",
            str(database_root),
            project_id,
            run_id,
            segment_id,
            branch_id,
            "-",
            event_id,
            "1795000000000",
            "1",
            "image",
            manifest["sha256"],
            "1",
            "--stdin",
        )

        self.assertFalse(database_root.exists())
        staged = self.run_helper(*begin_argv, input_text=original)

        self.assertEqual(staged.returncode, 0, staged.stderr)
        self.assertNotIn(original, " ".join(begin_argv))
        self.assertNotIn("PT-SECRET", staged.stdout + staged.stderr)
        self.assertEqual(json.loads(staged.stdout)["eventId"], event_id)
        database_path = database_root / f"{project_id}.sqlite3"
        self.assertEqual(stat.S_IMODE(database_root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(database_path.stat().st_mode), 0o600)
        staged_semantics = self.verify_archive({
            "database": str(database_path),
            "projectId": project_id,
            "eventId": event_id,
            "state": "pending",
            "expected": {
                "runId": run_id,
                "segmentId": segment_id,
                "branchId": branch_id,
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 1,
                "attachmentKinds": "image",
                "promptText": original,
            },
        })
        self.assertEqual(staged_semantics["status"], "verified")
        self.assertEqual(staged_semantics["checks"]["pendingCount"], 1)
        self.assertEqual(staged_semantics["checks"]["promptEntryCount"], 0)

        confirm_argv = (
            "capture-confirm",
            str(database_root),
            project_id,
            event_id,
            manifest["sha256"],
            "1",
            "--stdin",
        )
        confirmed = self.run_helper(*confirm_argv, input_text=final)

        self.assertEqual(confirmed.returncode, 0, confirmed.stderr)
        self.assertNotIn(final, " ".join(confirm_argv))
        self.assertNotIn("PT-SECRET", confirmed.stdout + confirmed.stderr)
        self.assertEqual(json.loads(confirmed.stdout)["sequence"], 1)
        confirmed_semantics = self.verify_archive({
            "database": str(database_path),
            "projectId": project_id,
            "eventId": event_id,
            "state": "confirmed",
            "expected": {
                "runId": run_id,
                "segmentId": segment_id,
                "branchId": branch_id,
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 1,
                "attachmentKinds": "image",
                "promptText": final,
            },
        })
        self.assertEqual(confirmed_semantics["status"], "verified")
        self.assertEqual(confirmed_semantics["checks"]["pendingCount"], 0)
        self.assertEqual(confirmed_semantics["checks"]["promptEntryCount"], 1)
        self.assertNotIn(str(self.plugin_data), database_path.read_bytes().decode(
            "utf-8", errors="ignore"
        ))

    def test_capture_begin_is_idempotent_and_never_reopens_a_confirmed_event(self) -> None:
        project_id = "b" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        argv = self.begin_argv(event_id, **identity)

        first = self.run_helper(*argv, input_text="PT-SECRET-A")
        retry = self.run_helper(*argv, input_text="PT-SECRET-A")

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertEqual(json.loads(retry.stdout)["pending"], True)

        divergent = self.run_helper(*argv, input_text="PT-SECRET-DIFFERENT")
        self.assertEqual(divergent.returncode, 25)
        self.assertEqual(json.loads(divergent.stderr)["category"], "capture-conflict")

        confirmed = self.run_helper(
            *self.confirm_argv(event_id, project_id=project_id),
            input_text="PT-SECRET-A",
        )
        self.assertEqual(confirmed.returncode, 0, confirmed.stderr)

        replayed = self.run_helper(*argv, input_text="PT-SECRET-A")
        self.assertEqual(replayed.returncode, 25)
        self.assertEqual(json.loads(replayed.stderr)["category"], "capture-conflict")

        aborted = self.run_helper(
            "capture-abort",
            str(self.plugin_data / "archives"),
            project_id,
            event_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )
        self.assertEqual(aborted.returncode, 25)
        self.assertEqual(json.loads(aborted.stderr)["category"], "capture-conflict")

        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "eventId": event_id,
            "state": "confirmed",
            "expected": {
                "runId": identity["run_id"],
                "segmentId": identity["segment_id"],
                "branchId": identity["branch_id"],
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 1,
                "attachmentKinds": "image",
                "promptText": "PT-SECRET-A",
            },
        })
        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["pendingCount"], 0)
        self.assertEqual(semantics["checks"]["promptEntryCount"], 1)

    def test_capture_refuses_an_unknown_or_self_referencing_parent(self) -> None:
        project_id = "c" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())

        self_parent = self.run_helper(
            *self.begin_argv(event_id, parent=event_id, **identity),
            input_text="PT-SECRET-SELF",
        )
        self.assertEqual(self_parent.returncode, 25)
        self.assertEqual(json.loads(self_parent.stderr)["category"], "capture-input")

        staged = self.run_helper(
            *self.begin_argv(event_id, parent=str(uuid.uuid4()), **identity),
            input_text="PT-SECRET-ORPHAN",
        )
        self.assertEqual(staged.returncode, 0, staged.stderr)

        confirmed = self.run_helper(
            *self.confirm_argv(event_id, project_id=project_id),
            input_text="PT-SECRET-ORPHAN",
        )
        self.assertEqual(confirmed.returncode, 25)
        self.assertEqual(
            json.loads(confirmed.stderr)["category"], "capture-parent-unknown"
        )
        self.assertNotIn("PT-SECRET", confirmed.stderr)

    def test_capture_rejects_prompt_bytes_that_are_not_valid_utf8(self) -> None:
        project_id = "d" * 64
        database_root = self.plugin_data / "archives"
        result = subprocess.run(
            [
                str(HELPER),
                *self.begin_argv(
                    str(uuid.uuid4()),
                    project_id=project_id,
                    run_id=str(uuid.uuid4()),
                    segment_id=str(uuid.uuid4()),
                    branch_id=str(uuid.uuid4()),
                ),
            ],
            input=b"PT-SECRET-\xff\xfe",
            check=False,
            capture_output=True,
            env=self.environment,
        )

        self.assertEqual(result.returncode, 25)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(json.loads(result.stderr)["category"], "capture-input")
        self.assertFalse((database_root / f"{project_id}.sqlite3").exists())

    def test_capture_refuses_an_untrusted_digest_without_creating_an_archive(self) -> None:
        database_root = self.plugin_data / "archives"
        result = self.run_helper(
            "capture-begin",
            str(database_root),
            "a" * 64,
            str(uuid.uuid4()),
            str(uuid.uuid4()),
            str(uuid.uuid4()),
            "-",
            str(uuid.uuid4()),
            "1795000000000",
            "0",
            "-",
            "0" * 64,
            "1",
            "--stdin",
            input_text="PT-SECRET-MUST-NOT-PERSIST",
        )

        self.assertEqual(result.returncode, 25)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "digest-mismatch")
        self.assertNotIn("PT-SECRET", result.stderr)
        self.assertFalse(database_root.exists())


if __name__ == "__main__":
    unittest.main()
