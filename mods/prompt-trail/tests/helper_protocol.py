#!/usr/bin/env python3
import json
import os
import pathlib
import pwd
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
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
        # The bridge names a locator per process: `<session>.<pid>-<start>.json`.
        # These tests publish once per session, so there is exactly one.
        directory = self.home / ".claude/plugins/data/.function-hook-locators/prompt-trail"
        found = sorted(directory.glob(f"{self.session_id}.*.json"))
        return found[0] if found else directory / f"{self.session_id}.missing.json"

    def run_helper(
        self,
        *args: str,
        input_text: str | None = None,
        via_child: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        # A shell that outlives the helper becomes its parent, so the helper
        # runs for a host process other than the one these tests stand for.
        wrapper = ["/bin/sh", "-c", '"$@"; exit $?', "sh"] if via_child else []
        return subprocess.run(
            [*wrapper, str(HELPER), *args],
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
        attachment_count: str = "1",
        attachment_kinds: str = "image",
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
            attachment_count,
            attachment_kinds,
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

    def boundary_argv(
        self,
        event_id: str,
        *,
        project_id: str,
        run_id: str,
        segment_id: str,
        branch_id: str,
        kind: str,
        occurred_at: str = "1795000000000",
    ) -> tuple[str, ...]:
        return (
            "boundary-append",
            str(self.plugin_data / "archives"),
            project_id,
            run_id,
            segment_id,
            branch_id,
            kind,
            event_id,
            occurred_at,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
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
        locator = self.locator
        target = locator.with_suffix('.target')
        locator.rename(target)
        locator.symlink_to(target)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(locator),
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

    def test_preflight_refuses_another_processs_locator_for_the_same_session(self) -> None:
        self.publish_locator()
        manifest = json.loads(MANIFEST.read_text())
        own = self.locator
        other = own.parent / f"{self.session_id}.1-2-3.json"
        other.write_bytes(own.read_bytes())
        other.chmod(0o600)

        result = self.run_helper(
            "preflight",
            "--locator",
            str(other),
            "--session",
            self.session_id,
            "--expected-sha",
            manifest["sha256"],
            "--protocol",
            "1",
        )

        self.assertEqual(result.returncode, 21)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "locator-path")

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

    def capture(
        self,
        text: str,
        *,
        identity: dict[str, str],
        parent: str = "-",
        attachment_count: str = "0",
        attachment_kinds: str = "-",
    ) -> str:
        """Stage and confirm one prompt, answering the event id it archived."""
        event_id = str(uuid.uuid4())
        begin = self.run_helper(
            *self.begin_argv(
                event_id,
                parent=parent,
                attachment_count=attachment_count,
                attachment_kinds=attachment_kinds,
                **identity,
            ),
            input_text=text,
        )
        self.assertEqual(begin.returncode, 0, begin.stderr)
        confirm = self.run_helper(
            *self.confirm_argv(event_id, project_id=identity["project_id"]),
            input_text=text,
        )
        self.assertEqual(confirm.returncode, 0, confirm.stderr)
        return event_id

    def test_capture_confirm_answers_the_entrys_place_among_the_projects_prompt_entries(self) -> None:
        project_id = "c7" * 32
        identity = self.identity(project_id)
        self.capture("PT-SECRET-ONE", identity=identity)
        self.boundary(identity=identity, kind="clear")
        event_id = str(uuid.uuid4())
        self.assertEqual(
            self.run_helper(*self.begin_argv(event_id, **identity), input_text="PT-SECRET-TWO").returncode,
            0,
        )

        confirmed = self.run_helper(
            *self.confirm_argv(event_id, project_id=project_id), input_text="PT-SECRET-TWO"
        )
        repeated = self.run_helper(
            *self.confirm_argv(event_id, project_id=project_id), input_text="PT-SECRET-TWO"
        )

        for result in (confirmed, repeated):
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual((payload["sequence"], payload["ordinal"]), (3, 2))

    def test_three_identical_prompts_form_three_distinct_prompt_entries(self) -> None:
        project_id = "c" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        repeated = "PT-SECRET-REPEATED"

        parent = "-"
        event_ids = []
        for _ in range(3):
            event_ids.append(self.capture(repeated, identity=identity, parent=parent))
            parent = event_ids[-1]

        self.assertEqual(len(set(event_ids)), 3)
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [
                {
                    "eventId": event_id,
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "parentEventId": None if index == 0 else event_ids[index - 1],
                    "occurredAtMs": 1_795_000_000_000,
                    "attachmentCount": 0,
                    "attachmentKinds": "-",
                    "promptText": repeated,
                }
                for index, event_id in enumerate(event_ids)
            ],
        })

        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["promptEntryCount"], 3)
        self.assertTrue(semantics["checks"]["promptEntriesDistinct"])

    def test_capture_preserves_blank_lines_cjk_emoji_and_combining_marks(self) -> None:
        project_id = "d" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        text = "PT-SECRET-宽字符\n\n中文 段落　tab\there\nemoji 👩‍💻🇨🇳\ncombining é ā\n\n尾行"

        event_id = self.capture(text, identity=identity)

        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [{
                "eventId": event_id,
                "runId": identity["run_id"],
                "segmentId": identity["segment_id"],
                "branchId": identity["branch_id"],
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 0,
                "attachmentKinds": "-",
                "promptText": text,
            }],
        })

        self.assertEqual(semantics["status"], "verified")

    def test_an_attachment_only_submission_forms_a_text_less_prompt_entry(self) -> None:
        project_id = "e" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }

        event_id = self.capture(
            "",
            identity=identity,
            attachment_count="2",
            attachment_kinds="image,document",
        )

        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [{
                "eventId": event_id,
                "runId": identity["run_id"],
                "segmentId": identity["segment_id"],
                "branchId": identity["branch_id"],
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 2,
                "attachmentKinds": "image,document",
                "promptText": "",
            }],
        })

        self.assertEqual(semantics["status"], "verified")

    def test_an_aborted_capture_leaves_no_entry_and_repeats_idempotently(self) -> None:
        project_id = "f" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        database_root = self.plugin_data / "archives"
        manifest = json.loads(MANIFEST.read_text())

        begin = self.run_helper(
            *self.begin_argv(event_id, **identity),
            input_text="PT-SECRET-DROPPED",
        )
        self.assertEqual(begin.returncode, 0, begin.stderr)
        abort_argv = (
            "capture-abort",
            str(database_root),
            project_id,
            event_id,
            manifest["sha256"],
            "1",
        )
        first = self.run_helper(*abort_argv)
        repeat = self.run_helper(*abort_argv)

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(json.loads(first.stdout)["aborted"], True)
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertEqual(json.loads(repeat.stdout)["aborted"], False)
        semantics = self.verify_archive({
            "database": str(database_root / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [],
        })
        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["pendingCount"], 0)
        self.assertEqual(semantics["checks"]["promptEntryCount"], 0)

    def boundary(self, *, identity: dict[str, str], kind: str, branch_id: str | None = None) -> tuple[str, int]:
        """Append one Collection Boundary, answering its event id and sequence."""
        event_id = str(uuid.uuid4())
        fields = {**identity}
        if branch_id is not None:
            fields["branch_id"] = branch_id
        result = self.run_helper(
            *self.boundary_argv(event_id, kind=kind, **fields)
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["eventId"], event_id)
        self.assertEqual(payload["kind"], kind)
        return event_id, payload["sequence"]

    def test_collection_boundaries_share_the_sequence_with_prompt_entries(self) -> None:
        project_id = "1" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        resumed_branch = str(uuid.uuid4())
        before = "PT-SECRET-BEFORE-DISABLE"
        after = "PT-SECRET-AFTER-RESUME"

        first = self.capture(before, identity=identity)
        stopped, stopped_sequence = self.boundary(
            identity=identity, kind="collection-stopped"
        )
        resumed, resumed_sequence = self.boundary(
            identity=identity, kind="collection-resumed", branch_id=resumed_branch
        )
        second = self.capture(
            after, identity={**identity, "branch_id": resumed_branch}
        )

        self.assertEqual((stopped_sequence, resumed_sequence), (2, 3))
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "boundaries": [
                {
                    "eventId": stopped,
                    "sequence": 2,
                    "kind": "collection-stopped",
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "occurredAtMs": 1_795_000_000_000,
                },
                {
                    "eventId": resumed,
                    "sequence": 3,
                    "kind": "collection-resumed",
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": resumed_branch,
                    "occurredAtMs": 1_795_000_000_000,
                },
            ],
            "entries": [
                {
                    "eventId": first,
                    "sequence": 1,
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "parentEventId": None,
                    "occurredAtMs": 1_795_000_000_000,
                    "attachmentCount": 0,
                    "attachmentKinds": "-",
                    "promptText": before,
                },
                {
                    "eventId": second,
                    "sequence": 4,
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": resumed_branch,
                    "parentEventId": None,
                    "occurredAtMs": 1_795_000_000_000,
                    "attachmentCount": 0,
                    "attachmentKinds": "-",
                    "promptText": after,
                },
            ],
        })

        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["boundaryCount"], 2)
        self.assertTrue(semantics["checks"]["sequencesDistinct"])

    def test_a_repeated_boundary_append_stays_idempotent(self) -> None:
        project_id = "2" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        argv = self.boundary_argv(event_id, kind="collection-stopped", **identity)

        first = self.run_helper(*argv)
        repeat = self.run_helper(*argv)

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertEqual(
            json.loads(first.stdout)["sequence"],
            json.loads(repeat.stdout)["sequence"],
        )
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [],
            "boundaries": [
                {
                    "eventId": event_id,
                    "sequence": 1,
                    "kind": "collection-stopped",
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "occurredAtMs": 1_795_000_000_000,
                },
            ],
        })
        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["boundaryCount"], 1)

    def test_an_unknown_boundary_kind_archives_nothing(self) -> None:
        project_id = "3" * 64
        database_root = self.plugin_data / "archives"

        result = self.run_helper(
            *self.boundary_argv(
                str(uuid.uuid4()),
                project_id=project_id,
                run_id=str(uuid.uuid4()),
                segment_id=str(uuid.uuid4()),
                branch_id=str(uuid.uuid4()),
                kind="integrity-recovery",
            )
        )

        self.assertEqual(result.returncode, 25)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "boundary-input")
        self.assertFalse((database_root / f"{project_id}.sqlite3").exists())

    def test_a_clear_boundary_separates_two_conversation_segments(self) -> None:
        """A Clear Boundary takes the sequence between the segments it parts."""
        project_id = "4" * 64
        run_id = str(uuid.uuid4())
        before = {
            "project_id": project_id,
            "run_id": run_id,
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        after = {
            "project_id": project_id,
            "run_id": run_id,
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }

        first = self.capture("PT-SECRET-BEFORE-CLEAR", identity=before)
        cleared, cleared_sequence = self.boundary(identity=before, kind="clear")
        second = self.capture("PT-SECRET-AFTER-CLEAR", identity=after)

        self.assertEqual(cleared_sequence, 2)
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "boundaries": [
                {
                    "eventId": cleared,
                    "sequence": 2,
                    "kind": "clear",
                    "runId": run_id,
                    "segmentId": before["segment_id"],
                    "branchId": before["branch_id"],
                    "occurredAtMs": 1_795_000_000_000,
                },
            ],
            "entries": [
                {
                    "eventId": first,
                    "sequence": 1,
                    "runId": run_id,
                    "segmentId": before["segment_id"],
                    "branchId": before["branch_id"],
                    "parentEventId": None,
                    "occurredAtMs": 1_795_000_000_000,
                    "attachmentCount": 0,
                    "attachmentKinds": "-",
                    "promptText": "PT-SECRET-BEFORE-CLEAR",
                },
                {
                    "eventId": second,
                    "sequence": 3,
                    "runId": run_id,
                    "segmentId": after["segment_id"],
                    "branchId": after["branch_id"],
                    "parentEventId": None,
                    "occurredAtMs": 1_795_000_000_000,
                    "attachmentCount": 0,
                    "attachmentKinds": "-",
                    "promptText": "PT-SECRET-AFTER-CLEAR",
                },
            ],
        })

        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["boundaryCount"], 1)
        self.assertTrue(semantics["checks"]["sequencesDistinct"])

    def test_a_repeated_clear_boundary_stays_one_boundary(self) -> None:
        """The derived idempotency key makes a replayed `/clear` a no-op."""
        project_id = "5" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = "a" * 64
        argv = self.boundary_argv(event_id, kind="clear", **identity)

        first = self.run_helper(*argv)
        repeat = self.run_helper(*argv)

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertEqual(
            json.loads(first.stdout)["sequence"],
            json.loads(repeat.stdout)["sequence"],
        )
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [],
            "boundaries": [
                {
                    "eventId": event_id,
                    "sequence": 1,
                    "kind": "clear",
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "occurredAtMs": 1_795_000_000_000,
                },
            ],
        })
        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["boundaryCount"], 1)

    def test_a_clear_boundary_retry_with_a_changed_instant_fails_closed(self) -> None:
        """A replay that drifted is a different fact, so it is refused."""
        project_id = "6" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = "b" * 64

        first = self.run_helper(
            *self.boundary_argv(event_id, kind="clear", **identity)
        )
        drifted = self.run_helper(
            *self.boundary_argv(
                event_id,
                kind="clear",
                occurred_at="1795000000001",
                **identity,
            )
        )

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(drifted.returncode, 25)
        self.assertEqual(
            json.loads(drifted.stderr)["category"], "boundary-conflict"
        )

    def test_a_schema_1_archive_migrates_without_losing_its_entries(self) -> None:
        project_id = "4" * 64
        database_root = self.plugin_data / "archives"
        database_root.mkdir(mode=0o700)
        database_path = database_root / f"{project_id}.sqlite3"
        identity = {
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        legacy_event = str(uuid.uuid4())
        legacy_text = "PT-SECRET-LEGACY-ENTRY"
        legacy = sqlite3.connect(database_path)
        legacy.executescript(
            "CREATE TABLE metadata("
            " project_id TEXT PRIMARY KEY,"
            " policy_version INTEGER NOT NULL,"
            " next_sequence INTEGER NOT NULL DEFAULT 0);"
            "CREATE TABLE pending_captures("
            " event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,"
            " segment_id TEXT NOT NULL, branch_id TEXT NOT NULL,"
            " parent_event_id TEXT, occurred_at_ms INTEGER NOT NULL,"
            " attachment_count INTEGER NOT NULL, attachment_kinds TEXT NOT NULL,"
            " prompt_text TEXT NOT NULL);"
            "CREATE TABLE prompt_entries("
            " event_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,"
            " run_id TEXT NOT NULL, segment_id TEXT NOT NULL,"
            " branch_id TEXT NOT NULL, parent_event_id TEXT,"
            " occurred_at_ms INTEGER NOT NULL, source TEXT NOT NULL,"
            " attachment_count INTEGER NOT NULL, attachment_kinds TEXT NOT NULL,"
            " prompt_text TEXT NOT NULL);"
            "CREATE INDEX prompt_entries_run_sequence"
            " ON prompt_entries(run_id, sequence);"
            "PRAGMA user_version=1;"
        )
        legacy.execute(
            "INSERT INTO metadata VALUES(?, 1, 1)", (project_id,)
        )
        legacy.execute(
            "INSERT INTO prompt_entries VALUES(?, 1, ?, ?, ?, NULL, ?, 'composer', 0, '-', ?)",
            (
                legacy_event,
                identity["run_id"],
                identity["segment_id"],
                identity["branch_id"],
                1_795_000_000_000,
                legacy_text,
            ),
        )
        legacy.commit()
        legacy.close()
        database_path.chmod(0o600)

        boundary_event, sequence = self.boundary(
            identity={"project_id": project_id, **identity},
            kind="collection-stopped",
        )

        self.assertEqual(sequence, 2)
        migrated = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
        self.assertEqual(migrated.execute("PRAGMA user_version").fetchone()[0], 2)
        migrated.close()
        semantics = self.verify_archive({
            "database": str(database_path),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [
                {
                    "eventId": legacy_event,
                    "sequence": 1,
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "parentEventId": None,
                    "occurredAtMs": 1_795_000_000_000,
                    "attachmentCount": 0,
                    "attachmentKinds": "-",
                    "promptText": legacy_text,
                },
            ],
            "boundaries": [
                {
                    "eventId": boundary_event,
                    "sequence": 2,
                    "kind": "collection-stopped",
                    "runId": identity["run_id"],
                    "segmentId": identity["segment_id"],
                    "branchId": identity["branch_id"],
                    "occurredAtMs": 1_795_000_000_000,
                },
            ],
        })
        self.assertEqual(semantics["status"], "verified")


    def test_a_boundary_refuses_an_id_already_staged_as_a_capture(self) -> None:
        project_id = "5" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        staged = self.run_helper(
            *self.begin_argv(event_id, **identity),
            input_text="PT-SECRET-STAGED",
        )
        self.assertEqual(staged.returncode, 0, staged.stderr)

        collision = self.run_helper(
            *self.boundary_argv(event_id, kind="collection-stopped", **identity)
        )

        self.assertEqual(collision.returncode, 25)
        self.assertEqual(collision.stdout, "")
        self.assertEqual(
            json.loads(collision.stderr)["category"], "boundary-conflict"
        )
        self.assertNotIn("PT-SECRET", collision.stderr)

    def test_a_capture_refuses_an_id_already_used_by_a_boundary(self) -> None:
        project_id = "6" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id, _ = self.boundary(identity=identity, kind="collection-stopped")

        collision = self.run_helper(
            *self.begin_argv(event_id, **identity),
            input_text="PT-SECRET-COLLIDING",
        )

        self.assertEqual(collision.returncode, 25)
        self.assertEqual(collision.stdout, "")
        self.assertEqual(
            json.loads(collision.stderr)["category"], "capture-conflict"
        )
        self.assertNotIn("PT-SECRET", collision.stderr)

    def test_a_boundary_retry_with_changed_facts_fails_closed(self) -> None:
        project_id = "7" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        first = self.run_helper(
            *self.boundary_argv(event_id, kind="collection-stopped", **identity)
        )
        self.assertEqual(first.returncode, 0, first.stderr)

        for changed in (
            {"kind": "collection-resumed"},
            {"branch_id": str(uuid.uuid4())},
            {"occurred_at": "1795000009999"},
        ):
            with self.subTest(changed=tuple(changed)[0]):
                argv = self.boundary_argv(
                    event_id,
                    **{**identity, "kind": "collection-stopped", **changed},
                )
                result = self.run_helper(*argv)
                self.assertEqual(result.returncode, 25)
                self.assertEqual(
                    json.loads(result.stderr)["category"], "boundary-conflict"
                )

    def test_a_second_open_after_migration_succeeds(self) -> None:
        """The migration decision is re-read under the write lock, so a Run
        that observed schema 1 must not replay it onto an upgraded archive."""
        project_id = "8" * 64
        database_root = self.plugin_data / "archives"
        database_root.mkdir(mode=0o700)
        database_path = database_root / f"{project_id}.sqlite3"
        legacy = sqlite3.connect(database_path)
        legacy.executescript(
            "CREATE TABLE metadata("
            " project_id TEXT PRIMARY KEY,"
            " policy_version INTEGER NOT NULL,"
            " next_sequence INTEGER NOT NULL DEFAULT 0);"
            "CREATE TABLE pending_captures("
            " event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,"
            " segment_id TEXT NOT NULL, branch_id TEXT NOT NULL,"
            " parent_event_id TEXT, occurred_at_ms INTEGER NOT NULL,"
            " attachment_count INTEGER NOT NULL, attachment_kinds TEXT NOT NULL,"
            " prompt_text TEXT NOT NULL);"
            "CREATE TABLE prompt_entries("
            " event_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,"
            " run_id TEXT NOT NULL, segment_id TEXT NOT NULL,"
            " branch_id TEXT NOT NULL, parent_event_id TEXT,"
            " occurred_at_ms INTEGER NOT NULL, source TEXT NOT NULL,"
            " attachment_count INTEGER NOT NULL, attachment_kinds TEXT NOT NULL,"
            " prompt_text TEXT NOT NULL);"
            "PRAGMA user_version=1;"
        )
        legacy.execute("INSERT INTO metadata VALUES(?, 1, 0)", (project_id,))
        legacy.commit()
        legacy.close()
        database_path.chmod(0o600)
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }

        _, first = self.boundary(identity=identity, kind="collection-stopped")
        _, second = self.boundary(identity=identity, kind="collection-resumed")

        self.assertEqual((first, second), (1, 2))

    def list_argv(self, *, project_id: str, run_id: str | None = None) -> tuple[str, ...]:
        return (
            "capture-list",
            str(self.plugin_data / "archives"),
            project_id,
            run_id or str(uuid.uuid4()),
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )

    def confirm_from_pending_argv(
        self,
        event_id: str,
        *,
        project_id: str,
    ) -> tuple[str, ...]:
        return (
            "capture-confirm",
            str(self.plugin_data / "archives"),
            project_id,
            event_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
            "--pending",
        )

    def test_capture_list_reports_unresolved_pendings_without_prompt_text(self) -> None:
        project_id = "a" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        first = str(uuid.uuid4())
        second = str(uuid.uuid4())
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(first, **identity),
                input_text="PT-SECRET-FIRST",
            ).returncode,
            0,
        )
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(second, **identity),
                input_text="PT-SECRET-SECOND",
            ).returncode,
            0,
        )

        listed = self.run_helper(*self.list_argv(project_id=project_id))

        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(listed.stderr, "")
        self.assertNotIn("PT-SECRET", listed.stdout)
        payload = json.loads(listed.stdout)
        self.assertEqual(payload["projectId"], project_id)
        self.assertIs(payload["truncated"], False)
        self.assertEqual([row["eventId"] for row in payload["pending"]], [first, second])
        row = payload["pending"][0]
        self.assertEqual(row["runId"], identity["run_id"])
        self.assertEqual(row["segmentId"], identity["segment_id"])
        self.assertEqual(row["branchId"], identity["branch_id"])
        self.assertIsNone(row["parentEventId"])
        self.assertEqual(row["occurredAtMs"], 1_795_000_000_000)
        self.assertEqual(row["attachmentCount"], 1)
        self.assertNotIn("promptText", row)
        self.assertNotIn("attachmentKinds", row)

    def test_capture_list_answers_an_absent_archive_without_creating_one(self) -> None:
        project_id = "b" * 64
        database_root = self.plugin_data / "archives"

        listed = self.run_helper(*self.list_argv(project_id=project_id))

        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(json.loads(listed.stdout)["pending"], [])
        self.assertFalse((database_root / f"{project_id}.sqlite3").exists())

    def test_capture_list_enforces_a_fixed_maximum_batch(self) -> None:
        project_id = "c" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        staged = []
        for _ in range(65):
            event_id = str(uuid.uuid4())
            staged.append(event_id)
            self.assertEqual(
                self.run_helper(
                    *self.begin_argv(event_id, **identity),
                    input_text="PT-SECRET-BULK",
                ).returncode,
                0,
            )

        payload = json.loads(
            self.run_helper(*self.list_argv(project_id=project_id)).stdout
        )

        self.assertEqual(len(payload["pending"]), 64)
        self.assertIs(payload["truncated"], True)
        self.assertEqual(
            [row["eventId"] for row in payload["pending"]],
            staged[:64],
        )

    def held_pending(self) -> tuple[str, dict[str, str], str]:
        """A pending staged for the Run this test process's locator holds."""
        self.publish_locator()
        run_id = json.loads(self.locator.read_text())["runId"]
        project_id = "e1" * 32
        identity = self.identity(project_id, run_id=run_id)
        event_id = str(uuid.uuid4())
        staged = self.run_helper(*self.begin_argv(event_id, **identity), input_text="PT-SECRET-HELD")
        self.assertEqual(staged.returncode, 0, staged.stderr)
        return project_id, identity, event_id

    def test_capture_list_leaves_out_a_pending_whose_run_a_live_process_holds(self) -> None:
        project_id, _, _ = self.held_pending()

        listed = self.run_helper(*self.list_argv(project_id=project_id), via_child=True)

        self.assertEqual(listed.returncode, 0, listed.stderr)
        payload = json.loads(listed.stdout)
        self.assertEqual(payload["pending"], [])
        self.assertEqual(payload["skipped"], 1)

    def test_capture_list_honours_a_live_locator_under_the_older_bare_name(self) -> None:
        project_id, _, _ = self.held_pending()
        held = json.loads(self.locator.read_text())
        bare = self.locator.parent / f"{held['sessionId']}.json"
        self.locator.rename(bare)

        listed = self.run_helper(*self.list_argv(project_id=project_id), via_child=True)

        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(json.loads(listed.stdout)["skipped"], 1)

    def test_capture_list_reads_a_bounded_number_of_rows_however_many_are_held(self) -> None:
        project_id, _, event_id = self.held_pending()
        database = self.plugin_data / "archives" / f"{project_id}.sqlite3"
        # The test-only way to hold hundreds of pendings: copies of the staged row.
        with sqlite3.connect(database) as connection:
            columns = [row[1] for row in connection.execute("PRAGMA table_info(pending_captures)")]
            rest = ", ".join(column for column in columns if column != "event_id")
            for _ in range(300):
                connection.execute(
                    f"INSERT INTO pending_captures(event_id, {rest}) "
                    f"SELECT ?, {rest} FROM pending_captures WHERE event_id = ?",
                    (str(uuid.uuid4()), event_id),
                )

        listed = self.run_helper(*self.list_argv(project_id=project_id), via_child=True)

        self.assertEqual(listed.returncode, 0, listed.stderr)
        payload = json.loads(listed.stdout)
        self.assertEqual(payload["pending"], [])
        self.assertEqual(payload["skipped"], 256)
        self.assertIs(payload["truncated"], True)

    def test_capture_list_offers_a_pending_whose_holder_has_exited(self) -> None:
        project_id, _, event_id = self.held_pending()
        held = json.loads(self.locator.read_text())
        gone = {**held, "hostPid": 2_147_483_647, "hostStartSeconds": 1, "hostStartMicroseconds": 1}
        self.locator.unlink()
        stale = self.locator.parent / (
            f"{gone['sessionId']}.{gone['hostPid']}-{gone['hostStartSeconds']}-{gone['hostStartMicroseconds']}.json"
        )
        stale.write_text(json.dumps(gone) + "\n")
        stale.chmod(0o600)

        listed = self.run_helper(*self.list_argv(project_id=project_id), via_child=True)

        self.assertEqual(listed.returncode, 0, listed.stderr)
        payload = json.loads(listed.stdout)
        self.assertEqual([row["eventId"] for row in payload["pending"]], [event_id])
        self.assertEqual(payload["skipped"], 0)

    def test_capture_list_offers_the_callers_own_run_whoever_holds_it(self) -> None:
        project_id, identity, event_id = self.held_pending()

        listed = self.run_helper(
            *self.list_argv(project_id=project_id, run_id=identity["run_id"]), via_child=True
        )

        self.assertEqual(listed.returncode, 0, listed.stderr)
        payload = json.loads(listed.stdout)
        self.assertEqual([row["eventId"] for row in payload["pending"]], [event_id])
        self.assertEqual(payload["skipped"], 0)

    def test_capture_list_offers_the_pending_of_a_run_its_own_host_holds(self) -> None:
        project_id, _, event_id = self.held_pending()

        listed = self.run_helper(*self.list_argv(project_id=project_id))

        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual([row["eventId"] for row in json.loads(listed.stdout)["pending"]], [event_id])

    def test_twenty_four_concurrent_runs_all_commit_in_one_gapless_sequence(self) -> None:
        project_id = "f2" * 32
        writers = 24
        gate = pathlib.Path(self.temporary.name) / "go"
        # Each writer is a Run of its own: it stages and confirms one prompt,
        # retries the confirmation, and appends one boundary twice. Every
        # writer submits the same text, and the archive does not exist yet.
        planned = []
        for _ in range(writers):
            identity = self.identity(project_id)
            prompt, boundary = str(uuid.uuid4()), str(uuid.uuid4())
            planned.append((identity, prompt, boundary))
        processes = []
        for identity, prompt, boundary in planned:
            steps = [
                self.begin_argv(prompt, **identity),
                self.confirm_argv(prompt, project_id=project_id),
                self.confirm_argv(prompt, project_id=project_id),
                self.boundary_argv(boundary, kind="clear", **identity),
                self.boundary_argv(boundary, kind="clear", **identity),
            ]
            script = 'while [ ! -e "$0" ]; do /bin/sleep 0.01; done\n' + "\n".join(
                "printf %s PT-SECRET-SAME | " + " ".join(f"'{part}'" for part in [str(HELPER), *argv])
                + " >/dev/null || exit 1"
                for argv in steps
            )
            processes.append(subprocess.Popen(
                ["/bin/sh", "-c", script, str(gate)],
                env=self.environment,
                stderr=subprocess.PIPE,
                text=True,
            ))
        gate.touch()
        for process in processes:
            _, stderr = process.communicate(timeout=60)
            self.assertEqual(process.returncode, 0, stderr)

        payload = self.read(project_id=project_id)

        events = payload["events"]
        self.assertEqual([row["sequence"] for row in events], list(range(1, 2 * writers + 1)))
        self.assertEqual(
            sorted(row["eventId"] for row in events),
            sorted(event for _, prompt, boundary in planned for event in (prompt, boundary)),
        )
        prompts = [row for row in events if row["kind"] == "prompt"]
        self.assertEqual(len(prompts), writers)
        self.assertEqual({row["text"] for row in prompts}, {"PT-SECRET-SAME"})
        for identity, prompt, boundary in planned:
            mine = [row for row in events if row["runId"] == identity["run_id"]]
            self.assertEqual([row["eventId"] for row in mine], [prompt, boundary])

    def test_runs_that_create_the_archive_root_at_once_all_stage(self) -> None:
        # Each writer stages into a project of its own, so the only thing they
        # race for is the archive root that none of them finds yet.
        for round_number in range(40):
            plugin_data = pathlib.Path(self.temporary.name) / f"plugin-data-{round_number}"
            plugin_data.mkdir(mode=0o700)
            database_root = plugin_data.resolve() / "archives"
            gate = pathlib.Path(self.temporary.name) / f"go-{round_number}"
            processes = []
            for writer in range(32):
                identity = self.identity(f"{writer:02x}" * 32)
                argv = list(self.begin_argv(str(uuid.uuid4()), **identity))
                argv[1] = str(database_root)
                script = 'while [ ! -e "$0" ]; do /bin/sleep 0.005; done\n' + (
                    "printf %s PT-SECRET-ROOT | " + " ".join(f"'{part}'" for part in [str(HELPER), *argv])
                    + " >/dev/null"
                )
                processes.append(subprocess.Popen(
                    ["/bin/sh", "-c", script, str(gate)],
                    env=self.environment,
                    stderr=subprocess.PIPE,
                    text=True,
                ))
            gate.touch()
            for process in processes:
                _, stderr = process.communicate(timeout=60)
                self.assertEqual(process.returncode, 0, stderr)

    def test_one_projects_broken_archive_leaves_another_project_untouched(self) -> None:
        self.publish_locator()
        broken_id, healthy_id = "a3" * 32, "b4" * 32
        broken = self.identity(broken_id)
        healthy = self.identity(healthy_id)
        self.capture("PT-SECRET-BROKEN", identity=broken)
        self.capture("PT-SECRET-HEALTHY", identity=healthy)
        database = self.plugin_data / "archives" / f"{broken_id}.sqlite3"
        manifest = json.loads(MANIFEST.read_text())

        def healthy_still_works(label: str) -> None:
            self.capture(f"PT-SECRET-{label}", identity=healthy)
            texts = [row.get("text") for row in self.read(project_id=healthy_id)["events"]]
            self.assertEqual(texts[-1], f"PT-SECRET-{label}", label)
            preflight = self.run_helper(
                "preflight", "--locator", str(self.locator), "--session", self.session_id,
                "--expected-sha", manifest["sha256"], "--protocol", str(manifest["helperProtocol"]),
            )
            self.assertEqual(preflight.returncode, 0, preflight.stderr)

        database.chmod(0o644)
        widened = self.run_helper(*self.begin_argv(str(uuid.uuid4()), **broken), input_text="PT-SECRET-X")
        self.assertEqual(json.loads(widened.stderr)["category"], "database-permissions")
        healthy_still_works("AFTER-PERMISSIONS")

        database.chmod(0o600)
        for suffix in ("-wal", "-shm"):
            pathlib.Path(f"{database}{suffix}").unlink(missing_ok=True)
        database.write_bytes(b"PT-NOT-A-DATABASE" * 512)
        corrupt = self.run_helper(*self.begin_argv(str(uuid.uuid4()), **broken), input_text="PT-SECRET-X")
        self.assertNotEqual(corrupt.returncode, 0)
        healthy_still_works("AFTER-CORRUPTION")

        database.unlink()
        gone = self.run_helper(*self.confirm_argv(str(uuid.uuid4()), project_id=broken_id), input_text="PT-SECRET-X")
        self.assertEqual(json.loads(gone.stderr)["category"], "database-unavailable")
        healthy_still_works("AFTER-DELETION")

    def hold_write_lock(self, project_id: str) -> sqlite3.Connection:
        """A second writer that keeps the archive's write lock until closed."""
        holder = sqlite3.connect(
            self.plugin_data / "archives" / f"{project_id}.sqlite3",
            isolation_level=None,
        )
        self.addCleanup(holder.close)
        holder.execute("BEGIN IMMEDIATE")
        return holder

    def test_a_held_write_lock_ends_in_archive_busy_within_the_wait_budget(self) -> None:
        project_id = "c5" * 32
        identity = self.identity(project_id)
        self.capture("PT-SECRET-FIRST", identity=identity)
        holder = self.hold_write_lock(project_id)

        started = time.monotonic()
        begin = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), **identity),
            input_text="PT-SECRET-BUSY",
        )
        elapsed = time.monotonic() - started

        self.assertNotEqual(begin.returncode, 0)
        self.assertEqual(json.loads(begin.stderr)["category"], "archive-busy")
        self.assertNotIn("PT-SECRET", begin.stdout + begin.stderr)
        # The whole invocation waits a fixed budget, finishing well inside the
        # host's ten-second limit rather than being killed by it.
        self.assertGreater(elapsed, 6.0)
        self.assertLess(elapsed, 9.0)

        holder.execute("ROLLBACK")
        self.capture("PT-SECRET-AFTER", identity=identity)

    def test_a_lock_released_during_the_wait_lets_the_write_through(self) -> None:
        project_id = "c6" * 32
        identity = self.identity(project_id)
        self.capture("PT-SECRET-FIRST", identity=identity)
        holder = self.hold_write_lock(project_id)
        event_id = str(uuid.uuid4())
        begin = subprocess.Popen(
            [str(HELPER), *self.begin_argv(event_id, **identity)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.environment,
        )
        time.sleep(1.0)
        holder.execute("ROLLBACK")
        stdout, stderr = begin.communicate("PT-SECRET-WAITED", timeout=10)
        self.assertEqual(begin.returncode, 0, stderr)
        self.assertTrue(json.loads(stdout)["pending"])

    def mount_small_volume(self, at: pathlib.Path | None = None) -> pathlib.Path:
        """A few-megabyte volume serving as the archive root (or, given `at`,
        as that directory), so the disk it sits on really fills up."""
        image = pathlib.Path(self.temporary.name) / "small.dmg"
        subprocess.run(
            ["/usr/bin/hdiutil", "create", "-size", "4m", "-fs", "HFS+",
             "-volname", "pt-small", "-o", str(image), "-quiet"],
            check=True,
        )
        archives = at or self.plugin_data / "archives"
        archives.mkdir(mode=0o700, exist_ok=True)
        subprocess.run(
            ["/usr/bin/hdiutil", "attach", str(image), "-mountpoint", str(archives),
             "-nobrowse", "-noverify", "-quiet"],
            check=True,
        )
        self.addCleanup(
            subprocess.run,
            ["/usr/bin/hdiutil", "detach", str(archives), "-force", "-quiet"],
            check=False,
        )
        archives.chmod(0o700)
        return archives

    def fill_volume(self, volume: pathlib.Path) -> pathlib.Path:
        filler = volume / "filler"
        descriptor = os.open(filler, os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            # Down to what is left for a single small block: too little for a
            # new page of any prompt below.
            for size in (65536, 512):
                try:
                    while os.write(descriptor, b"\0" * size) == size:
                        pass
                except OSError:
                    pass
        finally:
            os.close(descriptor)
        return filler

    def test_a_full_disk_stages_nothing_and_keeps_an_earlier_pending_whole(self) -> None:
        volume = self.mount_small_volume()
        project_id = "c7" * 32
        identity = self.identity(project_id)
        self.capture("PT-SECRET-FIRST", identity=identity)
        staged = str(uuid.uuid4())
        large = "PT-SECRET-STAGED " + "x" * 300_000
        begin = self.run_helper(*self.begin_argv(staged, **identity), input_text=large)
        self.assertEqual(begin.returncode, 0, begin.stderr)
        filler = self.fill_volume(volume)

        refused = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), **identity),
            input_text="PT-SECRET-REFUSED " + "y" * 300_000,
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(json.loads(refused.stderr)["category"], "archive-full")
        self.assertNotIn("PT-SECRET", refused.stdout + refused.stderr)

        confirm = self.run_helper(*self.confirm_from_pending_argv(staged, project_id=project_id))
        self.assertNotEqual(confirm.returncode, 0)
        self.assertEqual(json.loads(confirm.stderr)["category"], "archive-full")

        filler.unlink()
        listed = self.run_helper(*self.list_argv(project_id=project_id))
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(
            [row["eventId"] for row in json.loads(listed.stdout)["pending"]],
            [staged],
        )
        confirm = self.run_helper(*self.confirm_from_pending_argv(staged, project_id=project_id))
        self.assertEqual(confirm.returncode, 0, confirm.stderr)
        texts = [row.get("text") for row in self.read(project_id=project_id)["events"]]
        self.assertEqual(texts, ["PT-SECRET-FIRST", large])

    def test_capture_begin_says_whether_the_archive_disk_is_low_on_space(self) -> None:
        volume = os.statvfs(self.plugin_data)
        if volume.f_bavail * volume.f_frsize < 2 * (1 << 30):
            self.skipTest("the temporary directory's disk is itself low on space")
        identity = self.identity("c8" * 32)
        roomy = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), **identity),
            input_text="PT-SECRET-ROOMY",
        )
        self.assertEqual(roomy.returncode, 0, roomy.stderr)
        self.assertIs(json.loads(roomy.stdout)["lowSpace"], False)

    def test_a_full_disk_before_the_first_capture_is_named_archive_full(self) -> None:
        # The archive root does not exist yet: creating it, or the database in
        # it, is what meets the full disk.
        self.mount_small_volume(at=self.plugin_data)
        self.plugin_data.chmod(0o700)
        self.fill_volume(self.plugin_data)
        begin = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), **self.identity("ca" * 32)),
            input_text="PT-SECRET-FIRST",
        )
        self.assertNotEqual(begin.returncode, 0)
        self.assertEqual(json.loads(begin.stderr)["category"], "archive-full")

    def test_capture_begin_reports_low_space_on_a_small_disk(self) -> None:
        self.mount_small_volume()
        identity = self.identity("c9" * 32)
        cramped = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), **identity),
            input_text="PT-SECRET-CRAMPED",
        )
        self.assertEqual(cramped.returncode, 0, cramped.stderr)
        self.assertIs(json.loads(cramped.stdout)["lowSpace"], True)

    def test_confirm_from_pending_archives_the_staged_text(self) -> None:
        project_id = "d" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        staged_text = "PT-SECRET-STAGED\nsecond line"
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(event_id, **identity),
                input_text=staged_text,
            ).returncode,
            0,
        )

        confirmed = self.run_helper(
            *self.confirm_from_pending_argv(event_id, project_id=project_id)
        )

        self.assertEqual(confirmed.returncode, 0, confirmed.stderr)
        self.assertNotIn("PT-SECRET", confirmed.stdout + confirmed.stderr)
        self.assertEqual(json.loads(confirmed.stdout)["sequence"], 1)
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [{
                "eventId": event_id,
                "runId": identity["run_id"],
                "segmentId": identity["segment_id"],
                "branchId": identity["branch_id"],
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 1,
                "attachmentKinds": "image",
                "promptText": staged_text,
            }],
        })
        self.assertEqual(semantics["status"], "verified")
        self.assertEqual(semantics["checks"]["pendingCount"], 0)
        self.assertEqual(semantics["checks"]["promptEntryCount"], 1)

    def test_confirm_from_pending_repeats_without_doubling_the_entry(self) -> None:
        project_id = "e" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        event_id = str(uuid.uuid4())
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(event_id, **identity),
                input_text="PT-SECRET-ONCE",
            ).returncode,
            0,
        )
        argv = self.confirm_from_pending_argv(event_id, project_id=project_id)

        first = self.run_helper(*argv)
        repeat = self.run_helper(*argv)

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(repeat.returncode, 0, repeat.stderr)
        self.assertEqual(
            json.loads(first.stdout)["sequence"],
            json.loads(repeat.stdout)["sequence"],
        )
        semantics = self.verify_archive({
            "database": str(self.plugin_data / "archives" / f"{project_id}.sqlite3"),
            "projectId": project_id,
            "state": "set",
            "pending": [],
            "entries": [{
                "eventId": event_id,
                "runId": identity["run_id"],
                "segmentId": identity["segment_id"],
                "branchId": identity["branch_id"],
                "parentEventId": None,
                "occurredAtMs": 1_795_000_000_000,
                "attachmentCount": 1,
                "attachmentKinds": "image",
                "promptText": "PT-SECRET-ONCE",
            }],
        })
        self.assertEqual(semantics["checks"]["promptEntryCount"], 1)

    def test_confirm_from_pending_refuses_an_unknown_event(self) -> None:
        project_id = "9" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(str(uuid.uuid4()), **identity),
                input_text="PT-SECRET-OTHER",
            ).returncode,
            0,
        )

        result = self.run_helper(
            *self.confirm_from_pending_argv(str(uuid.uuid4()), project_id=project_id)
        )

        self.assertEqual(result.returncode, 25)
        self.assertEqual(json.loads(result.stderr)["category"], "capture-not-found")

    def test_capture_list_refuses_an_archive_root_it_cannot_vouch_for(self) -> None:
        project_id = "8" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(str(uuid.uuid4()), **identity),
                input_text="PT-SECRET-OWED",
            ).returncode,
            0,
        )
        database_root = self.plugin_data / "archives"
        database_root.chmod(0o755)
        self.addCleanup(database_root.chmod, 0o700)

        listed = self.run_helper(*self.list_argv(project_id=project_id))

        # A widened root that still holds an unresolved capture must not
        # read as an empty archive.
        self.assertEqual(listed.returncode, 25)
        self.assertEqual(
            json.loads(listed.stderr)["category"],
            "database-root-unavailable",
        )


    def read_argv(
        self,
        *,
        project_id: str,
        cursor: tuple[str, int] | None = None,
        run_id: str = "-",
        tip: str = "-",
    ) -> tuple[str, ...]:
        return (
            "timeline-read",
            str(self.plugin_data / "archives"),
            project_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
            *((cursor[0], str(cursor[1])) if cursor else ()),
            run_id,
            tip,
        )

    def read(self, **argv: object) -> dict[str, object]:
        result = self.run_helper(*self.read_argv(**argv))  # type: ignore[arg-type]
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout)

    def fixture(self, project_id: str, count: int) -> list[dict]:
        """A helper-created archive holding one run start, then `count` more
        events written by the test-only builder."""
        self.boundary(identity=self.identity(project_id), kind="run-started")
        sys.path.insert(0, str(ROOT / "tests"))
        import timeline_fixture
        database = self.plugin_data / "archives" / f"{project_id}.sqlite3"
        return timeline_fixture.build(database, project_id, count)

    def test_run_boundaries_share_the_sequence_and_stay_idempotent(self) -> None:
        project_id = "5" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        started, started_sequence = self.boundary(identity=identity, kind="run-started")
        self.capture("PT-SECRET-RUN", identity=identity)
        detached, detached_sequence = self.boundary(identity=identity, kind="run-detached")
        attached, attached_sequence = self.boundary(identity=identity, kind="run-attached")

        self.assertEqual((started_sequence, detached_sequence, attached_sequence), (1, 3, 4))
        for event_id, kind, sequence in (
            (started, "run-started", 1),
            (detached, "run-detached", 3),
            (attached, "run-attached", 4),
        ):
            repeated = self.run_helper(*self.boundary_argv(event_id, kind=kind, **identity))
            self.assertEqual(repeated.returncode, 0, repeated.stderr)
            self.assertEqual(json.loads(repeated.stdout)["sequence"], sequence)

    def test_a_run_no_longer_ends_it_only_detaches(self) -> None:
        identity = {
            "project_id": "5" * 64,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        refused = self.run_helper(
            *self.boundary_argv(str(uuid.uuid4()), kind="run-ended", **identity)
        )

        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(json.loads(refused.stderr), {"category": "boundary-input"})

    def test_timeline_read_returns_entries_and_boundaries_in_sequence_order(self) -> None:
        project_id = "6" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        text = "PT-SECRET-READ\n\n中文 🙂 é \"quoted\" \\ tab\tend"
        started, _ = self.boundary(identity=identity, kind="run-started")
        first = self.capture(text, identity=identity, attachment_count="1", attachment_kinds="image")
        clear, _ = self.boundary(identity=identity, kind="clear")
        # A staged capture is not a Prompt Entry, and the read never shows it.
        self.assertEqual(
            self.run_helper(
                *self.begin_argv(str(uuid.uuid4()), **identity),
                input_text="PT-SECRET-STAGED",
            ).returncode,
            0,
        )
        ended, _ = self.boundary(identity=identity, kind="run-detached")

        read = self.run_helper(*self.read_argv(project_id=project_id))

        self.assertEqual(read.returncode, 0, read.stderr)
        self.assertEqual(read.stderr, "")
        self.assertNotIn("PT-SECRET-STAGED", read.stdout)
        payload = json.loads(read.stdout)
        self.assertEqual(payload["projectId"], project_id)
        self.assertIs(payload["earlier"], False)
        self.assertIs(payload["later"], False)
        self.assertEqual(
            [(row["eventId"], row["sequence"], row["kind"]) for row in payload["events"]],
            [
                (started, 1, "run-started"),
                (first, 2, "prompt"),
                (clear, 3, "clear"),
                (ended, 4, "run-detached"),
            ],
        )
        # The segment each event belongs to: identity only, and what tells a Run
        # that split off an already-open session apart from a fresh one.
        self.assertEqual(
            {row["segmentId"] for row in payload["events"]},
            {identity["segment_id"]},
        )
        entry = payload["events"][1]
        self.assertEqual(entry["text"], text)
        self.assertEqual(entry["attachmentCount"], 1)
        self.assertEqual(entry["runId"], identity["run_id"])
        self.assertNotIn("text", payload["events"][0])
        self.assertEqual(payload["events"][0]["runId"], identity["run_id"])

    def test_timeline_read_names_each_events_branch_and_each_entrys_parent(self) -> None:
        project_id = "b1" * 32
        identity = self.identity(project_id)
        root = self.capture("PT-SECRET-ROOT", identity=identity)
        child = self.capture("PT-SECRET-CHILD", identity=identity, parent=root)
        boundary, _ = self.boundary(identity=identity, kind="clear")

        events = json.loads(
            self.run_helper(*self.read_argv(project_id=project_id)).stdout
        )["events"]

        self.assertEqual(
            [(row["eventId"], row["branchId"], row.get("parentEventId", "absent")) for row in events],
            [
                (root, identity["branch_id"], None),
                (child, identity["branch_id"], root),
                (boundary, identity["branch_id"], "absent"),
            ],
        )

    def test_timeline_read_answers_an_absent_archive_without_creating_one(self) -> None:
        project_id = "7" * 64
        database_root = self.plugin_data / "archives"

        read = self.run_helper(*self.read_argv(project_id=project_id))

        self.assertEqual(read.returncode, 0, read.stderr)
        self.assertEqual(json.loads(read.stdout), {
            "projectId": project_id,
            "events": [],
            "earlier": False,
            "later": False,
            "parents": [],
            "origins": [],
        })
        self.assertFalse((database_root / f"{project_id}.sqlite3").exists())

    def test_timeline_read_answers_the_latest_batch_and_one_earlier_event(self) -> None:
        project_id = "9" * 64
        identity = self.identity(project_id)
        appended = [
            self.boundary(identity=identity, kind="clear")[0]
            for _ in range(130)
        ]

        payload = self.read(project_id=project_id)

        # 128 events plus the one before them, which the band draws above the
        # batch; the event before that is only reported, not returned.
        self.assertIs(payload["earlier"], True)
        self.assertIs(payload["later"], False)
        self.assertEqual([row["eventId"] for row in payload["events"]], appended[1:])
        self.assertEqual(
            [row["sequence"] for row in payload["events"]],
            list(range(2, 131)),
        )

    def test_timeline_read_walks_the_whole_timeline_in_fixed_batches_both_ways(self) -> None:
        project_id = "c1" * 32
        events = self.fixture(project_id, 1_000)
        total = events[-1]["sequence"]
        self.assertEqual(total, 1_001)

        seen: list[int] = []
        payload = self.read(project_id=project_id)
        while True:
            sequences = [row["sequence"] for row in payload["events"]]
            self.assertLessEqual(len(sequences), 129)
            self.assertEqual(sequences, sorted(set(sequences)))
            self.assertEqual(sequences, list(range(sequences[0], sequences[-1] + 1)))
            if seen:
                # The earlier batch ends right before the event that was on top.
                self.assertEqual(sequences[-1] + 1, seen[0])
            seen = sequences + seen
            self.assertIs(payload["earlier"], sequences[0] > 1)
            if not payload["earlier"]:
                break
            payload = self.read(project_id=project_id, cursor=("before", sequences[0]))
        self.assertEqual(seen, list(range(1, total + 1)))

        seen = []
        payload = self.read(project_id=project_id, cursor=("after", 0))
        while True:
            sequences = [row["sequence"] for row in payload["events"]]
            self.assertLessEqual(len(sequences), 129)
            self.assertEqual(sequences, list(range(sequences[0], sequences[-1] + 1)))
            if seen:
                self.assertEqual(sequences[0], seen[-1] + 1)
            seen += sequences
            self.assertIs(payload["later"], sequences[-1] < total)
            self.assertIs(payload["earlier"], sequences[0] > 1)
            if not payload["later"]:
                break
            payload = self.read(project_id=project_id, cursor=("after", sequences[-1]))
        self.assertEqual(seen, list(range(1, total + 1)))

    def test_timeline_read_numbers_each_entry_among_the_projects_prompt_entries(self) -> None:
        project_id = "c2" * 32
        events = self.fixture(project_id, 600)
        ordinals = {
            event["eventId"]: index + 1
            for index, event in enumerate(e for e in events if e["kind"] == "prompt")
        }
        middle = events[300]["sequence"]

        payload = self.read(project_id=project_id, cursor=("before", middle))

        prompts = [row for row in payload["events"] if row["kind"] == "prompt"]
        self.assertTrue(prompts)
        self.assertEqual(
            [row["ordinal"] for row in prompts],
            [ordinals[row["eventId"]] for row in prompts],
        )
        self.assertNotIn("ordinal", next(r for r in payload["events"] if r["kind"] != "prompt"))

    def test_timeline_read_places_the_active_path_beyond_the_batch(self) -> None:
        project_id = "c3" * 32
        events = self.fixture(project_id, 800)
        by_id = {event["eventId"]: event for event in events}
        # A tip well above the batch read, so its chain enters the batch from
        # outside it.
        tip = next(e for e in reversed(events) if e["kind"] == "prompt")
        run_id = tip["runId"]
        chain = []
        at = tip
        while at is not None:
            chain.append(at)
            at = by_id.get(at["parentEventId"] or "")
        self.assertGreater(len(chain), 1)
        window_top = chain[-1]["sequence"] + 1

        payload = self.read(
            project_id=project_id,
            cursor=("before", window_top),
            run_id=run_id,
            tip=tip["eventId"],
        )

        sequences = {row["sequence"] for row in payload["events"]}
        self.assertEqual(
            sorted(payload["path"]["eventIds"]),
            sorted(e["eventId"] for e in chain if e["sequence"] in sequences),
        )
        self.assertEqual(
            payload["path"]["start"],
            min(e["sequence"] for e in chain if e["runId"] == run_id),
        )

    def test_timeline_read_names_the_run_of_each_parent_beyond_the_batch(self) -> None:
        project_id = "c4" * 32
        events = self.fixture(project_id, 700)
        by_id = {event["eventId"]: event for event in events}

        payload = self.read(project_id=project_id)

        window = {row["eventId"] for row in payload["events"]}
        expected = {
            row["parentEventId"]: by_id[row["parentEventId"]]["runId"]
            for row in payload["events"]
            if row["kind"] == "prompt" and row["parentEventId"] and row["parentEventId"] not in window
        }
        self.assertTrue(expected)
        self.assertEqual(
            {row["eventId"]: row["runId"] for row in payload["parents"]},
            expected,
        )
        self.assertEqual(payload["origins"], [])
        self.assertNotIn("path", payload)

    def test_timeline_read_names_the_run_that_held_a_segment_before_the_batch(self) -> None:
        project_id = "c5" * 32
        holder = self.identity(project_id)
        self.capture("PT-SECRET-HELD", identity=holder)
        sys.path.insert(0, str(ROOT / "tests"))
        import timeline_fixture
        timeline_fixture.build(
            self.plugin_data / "archives" / f"{project_id}.sqlite3", project_id, 300
        )
        # A second process resumes the same session: a new Run in the old segment.
        split = self.identity(project_id, segment_id=holder["segment_id"])
        started, _ = self.boundary(identity=split, kind="run-started")

        payload = self.read(project_id=project_id)

        self.assertEqual(payload["origins"], [{"eventId": started, "runId": holder["run_id"]}])

    def test_timeline_read_refuses_a_malformed_cursor_or_tip(self) -> None:
        project_id = "c6" * 32
        self.fixture(project_id, 10)
        for argv in (
            {"cursor": ("before", 0)},
            {"cursor": ("after", -1)},
            {"cursor": ("around", 5)},
            {"run_id": "x y", "tip": "-"},
            {"run_id": "-", "tip": str(uuid.uuid4())},
        ):
            with self.subTest(argv=argv):
                refused = self.run_helper(*self.read_argv(project_id=project_id, **argv))
                self.assertNotEqual(refused.returncode, 0)
                self.assertEqual(refused.stdout, "")
        malformed = self.run_helper(
            "timeline-read", str(self.plugin_data / "archives"), project_id,
            json.loads(MANIFEST.read_text())["sha256"], "1", "before", "5x", "-", "-",
        )
        self.assertNotEqual(malformed.returncode, 0)

    def match_argv(
        self,
        *,
        project_id: str,
        run_id: str = "-",
        segment_id: str = "-",
        transcript: str = "whole",
        prefer: str = "-",
    ) -> tuple[str, ...]:
        return (
            "branch-match",
            str(self.plugin_data / "archives"),
            project_id,
            run_id,
            segment_id,
            transcript,
            prefer,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
            "--stdin",
        )

    def match(self, rows: list[str], **argv: str) -> dict[str, object]:
        """Ask which archived Prompt Entry the transcript's `user` rows end on."""
        encoded = "".join(f"{len(row.encode())}\n{row}" for row in rows)
        result = self.run_helper(*self.match_argv(**argv), input_text=encoded)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def test_branch_match_finds_the_entry_a_resumed_transcript_ends_on(self) -> None:
        project_id = "a1" * 32
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        first = self.capture("PT-SECRET-A", identity=identity)
        second = self.capture("PT-SECRET-B", identity=identity, parent=first)

        # A task notification is an ordinary `user` row in the transcript; it
        # is skipped rather than breaking the ordered prefix.
        payload = self.match(
            ["PT-SECRET-A", "<task-notification>PT-SECRET-N", "PT-SECRET-B"],
            project_id=project_id,
            run_id=identity["run_id"],
            segment_id=identity["segment_id"],
        )

        self.assertEqual(payload["match"], "unique")
        self.assertEqual(payload["eventId"], second)

    def identity(self, project_id: str, **fixed: str) -> dict[str, str]:
        return {
            "project_id": project_id,
            "run_id": fixed.get("run_id", str(uuid.uuid4())),
            "segment_id": fixed.get("segment_id", str(uuid.uuid4())),
            "branch_id": fixed.get("branch_id", str(uuid.uuid4())),
        }

    def test_branch_match_tells_repeated_prompts_apart_by_their_whole_prefix(self) -> None:
        project_id = "a2" * 32
        identity = self.identity(project_id)
        first = self.capture("PT-SECRET-SAME", identity=identity)
        second = self.capture("PT-SECRET-SAME", identity=identity, parent=first)
        self.capture("PT-SECRET-LATER", identity=identity, parent=second)
        scope = {"run_id": identity["run_id"], "segment_id": identity["segment_id"]}

        both = self.match(["PT-SECRET-SAME", "PT-SECRET-SAME"], project_id=project_id, **scope)
        one = self.match(["PT-SECRET-SAME"], project_id=project_id, **scope)

        # The later entry never outruns the transcript: it ends on the second
        # repeat, and a transcript holding only one repeat ends on the first.
        self.assertEqual((both["match"], both["eventId"]), ("unique", second))
        self.assertEqual((one["match"], one["eventId"]), ("unique", first))

    def test_branch_match_leaves_identical_lineages_to_the_caller(self) -> None:
        project_id = "a3" * 32
        runs = [self.identity(project_id), self.identity(project_id)]
        tips = []
        for identity in runs:
            root = self.capture("PT-SECRET-ROOT", identity=identity)
            tips.append(self.capture("PT-SECRET-TIP", identity=identity, parent=root))

        payload = self.match(["PT-SECRET-ROOT", "PT-SECRET-TIP"], project_id=project_id)

        self.assertEqual(payload["match"], "ambiguous")
        self.assertNotIn("eventId", payload)
        self.assertEqual(payload["candidateCount"], 2)
        self.assertEqual(
            [(row["eventId"], row["runId"]) for row in payload["candidates"]],
            [(tips[1], runs[1]["run_id"]), (tips[0], runs[0]["run_id"])],
        )
        self.assertEqual(payload["candidates"][0]["sequence"], 4)

    def test_branch_match_lists_at_most_eight_tied_candidates(self) -> None:
        project_id = "a4" * 32
        for _ in range(9):
            self.capture("PT-SECRET-ROOT", identity=self.identity(project_id))

        payload = self.match(["PT-SECRET-ROOT"], project_id=project_id)

        self.assertEqual(payload["candidateCount"], 9)
        self.assertEqual(len(payload["candidates"]), 8)
        self.assertEqual(
            [row["sequence"] for row in payload["candidates"]],
            list(range(9, 1, -1)),
        )

    def test_branch_match_settles_a_tie_on_a_preferred_candidate_past_the_listed_eight(self) -> None:
        project_id = "b2" * 32
        roots = [
            self.capture("PT-SECRET-ROOT", identity=self.identity(project_id))
            for _ in range(9)
        ]

        # The oldest would fall outside the eight newest; preferred, it wins.
        payload = self.match(["PT-SECRET-ROOT"], project_id=project_id, prefer=roots[0])
        unrelated = self.match(["PT-SECRET-ROOT"], project_id=project_id, prefer=str(uuid.uuid4()))

        self.assertEqual((payload["match"], payload["eventId"]), ("unique", roots[0]))
        self.assertEqual(unrelated["match"], "ambiguous")
        self.assertEqual(
            [row["eventId"] for row in unrelated["candidates"]],
            list(reversed(roots))[:8],
        )

    def test_branch_match_settles_a_tie_on_the_preferred_lineage(self) -> None:
        project_id = "b3" * 32
        identity = self.identity(project_id)
        root = self.capture("PT-SECRET-A", identity=identity)
        # Rewound to B and resubmitted with the same text, then carried on.
        first = self.capture("PT-SECRET-B", identity=identity, parent=root)
        again = self.capture("PT-SECRET-B", identity=identity, parent=root)
        tip = self.capture("PT-SECRET-C", identity=identity, parent=again)
        scope = {"run_id": identity["run_id"], "segment_id": identity["segment_id"]}
        rows = ["PT-SECRET-A", "PT-SECRET-B"]

        # A rewind only shortens the transcript, so it is a prefix of the
        # lineage it was on: the tied entry that lineage passes through wins.
        on_tip = self.match(rows, project_id=project_id, prefer=tip, **scope)
        on_first = self.match(rows, project_id=project_id, prefer=first, **scope)
        unpreferred = self.match(rows, project_id=project_id, **scope)
        elsewhere = self.match(rows, project_id=project_id, prefer=str(uuid.uuid4()), **scope)

        self.assertEqual((on_tip["match"], on_tip.get("eventId")), ("unique", again))
        self.assertEqual((on_first["match"], on_first.get("eventId")), ("unique", first))
        self.assertEqual(unpreferred["match"], "ambiguous")
        self.assertEqual(elsewhere["match"], "ambiguous")

    def test_branch_match_leaves_a_tie_the_preferred_lineage_passes_twice(self) -> None:
        project_id = "b4" * 32
        identity = self.identity(project_id)
        first = self.capture("PT-SECRET-X", identity=identity)
        second = self.capture("PT-SECRET-X", identity=identity, parent=first)
        third = self.capture("PT-SECRET-X", identity=identity, parent=second)
        tip = self.capture("PT-SECRET-Y", identity=identity, parent=third)
        scope = {"run_id": identity["run_id"], "segment_id": identity["segment_id"]}
        rows = ["PT-SECRET-X", "PT-SECRET-X"]

        # A whole transcript proves where it ends; one missing its earliest rows
        # could be the tail of either repeat, both on the preferred lineage.
        whole = self.match(rows, project_id=project_id, prefer=tip, **scope)
        truncated = self.match(rows, project_id=project_id, prefer=tip, transcript="truncated", **scope)

        self.assertEqual((whole["match"], whole.get("eventId")), ("unique", second))
        self.assertEqual(truncated["match"], "ambiguous")
        self.assertEqual(
            {row["eventId"] for row in truncated["candidates"]},
            {second, third},
        )

    def test_branch_match_keeps_a_resume_inside_its_own_session(self) -> None:
        project_id = "a5" * 32
        resumed = self.identity(project_id)
        other = self.identity(project_id)
        own = self.capture("PT-SECRET-ROOT", identity=resumed)
        self.capture("PT-SECRET-ROOT", identity=other)

        payload = self.match(
            ["PT-SECRET-ROOT"],
            project_id=project_id,
            run_id=resumed["run_id"],
            segment_id=resumed["segment_id"],
        )

        self.assertEqual((payload["match"], payload["eventId"]), ("unique", own))

    def test_branch_match_follows_a_fork_across_runs(self) -> None:
        project_id = "a6" * 32
        source = self.identity(project_id)
        forked = self.identity(project_id)
        root = self.capture("PT-SECRET-ROOT", identity=source)
        tip = self.capture("PT-SECRET-FORKED", identity=forked, parent=root)

        # A session that archived nothing yet is matched across the project.
        empty = self.identity(project_id)
        payload = self.match(
            ["PT-SECRET-ROOT", "PT-SECRET-FORKED"],
            project_id=project_id,
            run_id=empty["run_id"],
            segment_id=empty["segment_id"],
        )

        self.assertEqual((payload["match"], payload["eventId"]), ("unique", tip))

    def test_branch_match_accepts_a_missing_chain_head_only_when_truncated(self) -> None:
        project_id = "a7" * 32
        identity = self.identity(project_id)
        root = self.capture("PT-SECRET-OLDEST", identity=identity)
        tip = self.capture("PT-SECRET-NEWEST", identity=identity, parent=root)
        scope = {"run_id": identity["run_id"], "segment_id": identity["segment_id"]}

        whole = self.match(["PT-SECRET-NEWEST"], project_id=project_id, **scope)
        truncated = self.match(
            ["PT-SECRET-NEWEST"],
            project_id=project_id,
            transcript="truncated",
            **scope,
        )

        self.assertEqual(whole["match"], "none")
        self.assertEqual(whole["candidates"], [])
        self.assertEqual((truncated["match"], truncated["eventId"]), ("unique", tip))

    def repeated_lineage(self, project_id: str, count: int) -> tuple[dict[str, str], list[str]]:
        """A helper-created archive holding one lineage of `count` identical
        prompts, the backlog's worst case for matching."""
        identity = self.identity(project_id)
        self.boundary(identity=identity, kind="run-started")
        sys.path.insert(0, str(ROOT / "tests"))
        import timeline_fixture
        return identity, timeline_fixture.chain(
            self.plugin_data / "archives" / f"{project_id}.sqlite3",
            project_id,
            count,
            "PT-SECRET-AGAIN",
            run_id=identity["run_id"],
            segment_id=identity["segment_id"],
            branch_id=identity["branch_id"],
        )

    def timed_match(self, rows: list[str], **argv: str) -> tuple[dict[str, object], float]:
        encoded = "".join(f"{len(row.encode())}\n{row}" for row in rows)
        started = time.monotonic()
        result = subprocess.run(
            [str(HELPER), *self.match_argv(**argv)],
            input=encoded,
            check=False,
            capture_output=True,
            text=True,
            env=self.environment,
            timeout=30,
        )
        elapsed = time.monotonic() - started
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout), elapsed

    def test_branch_match_weighs_thousands_of_identical_entries_within_a_fixed_budget(self) -> None:
        project_id = "d1" * 32
        identity, lineage = self.repeated_lineage(project_id, 20_000)
        rows = ["PT-SECRET-AGAIN"] * 4096

        whole, whole_elapsed = self.timed_match(rows, project_id=project_id)
        cut, cut_elapsed = self.timed_match(
            rows, project_id=project_id, transcript="truncated", prefer=lineage[-1]
        )

        # A whole transcript of 4096 repeats holds exactly the first 4096 of
        # the lineage; only its 4096th entry has a whole chain ending there.
        self.assertEqual((whole["match"], whole.get("eventId")), ("unique", lineage[4095]))
        # Cut to its newest rows, every entry from the 4096th on fits as well
        # as any other: nothing tells them apart, and nothing is guessed.
        self.assertEqual(cut["match"], "ambiguous")
        self.assertLess(whole_elapsed, 3)
        self.assertLess(cut_elapsed, 3)

    def test_branch_match_numbers_its_candidates_and_the_preferred_entry(self) -> None:
        project_id = "d2" * 32
        identity = self.identity(project_id)
        self.boundary(identity=identity, kind="run-started")
        root = self.capture("PT-SECRET-ROOT", identity=identity)
        self.boundary(identity=identity, kind="clear")
        first = self.capture("PT-SECRET-SAME", identity=identity, parent=root)
        second = self.capture("PT-SECRET-SAME", identity=identity, parent=root)

        payload = self.match(
            ["PT-SECRET-ROOT", "PT-SECRET-SAME"], project_id=project_id, prefer=root
        )

        self.assertEqual(payload["match"], "ambiguous")
        self.assertEqual(
            [(row["eventId"], row["sequence"], row["ordinal"]) for row in payload["candidates"]],
            [(second, 5, 3), (first, 4, 2)],
        )
        self.assertEqual(payload["prefer"], {"eventId": root, "sequence": 2, "ordinal": 1})

    def test_branch_match_answers_an_absent_archive_without_creating_one(self) -> None:
        project_id = "a8" * 32

        payload = self.match(["PT-SECRET-ROOT"], project_id=project_id)

        self.assertEqual(payload, {
            "projectId": project_id,
            "match": "none",
            "candidates": [],
            "candidateCount": 0,
        })
        self.assertFalse((self.plugin_data / "archives" / f"{project_id}.sqlite3").exists())

    def test_branch_match_refuses_malformed_rows_without_echoing_them(self) -> None:
        project_id = "a9" * 32
        self.capture("PT-SECRET-ROOT", identity=self.identity(project_id))

        for encoded in ("99\nPT-SECRET-SHORT", "PT-SECRET-NO-LENGTH", "4PT-SECRET"):
            result = self.run_helper(
                *self.match_argv(project_id=project_id),
                input_text=encoded,
            )
            self.assertEqual(result.returncode, 25)
            self.assertEqual(result.stdout, "")
            self.assertEqual(json.loads(result.stderr), {"category": "match-input"})

        too_many = "".join("1\nx" for _ in range(4097))
        result = self.run_helper(*self.match_argv(project_id=project_id), input_text=too_many)
        self.assertEqual(json.loads(result.stderr), {"category": "match-input"})

    def aligned(self, rows: list[str], **argv: str) -> dict[str, object]:
        """Ask the same, and which row each entry of the matched lineage took."""
        encoded = "".join(f"{len(row.encode())}\n{row}" for row in rows)
        result = self.run_helper(*self.match_argv(**argv), "--rows", input_text=encoded)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def test_branch_match_names_the_row_each_entry_of_its_lineage_took(self) -> None:
        project_id = "e1" * 32
        identity = self.identity(project_id)
        first = self.capture("PT-SECRET-SAME", identity=identity)
        middle = self.capture("PT-SECRET-MIDDLE", identity=identity, parent=first)
        last = self.capture("PT-SECRET-SAME", identity=identity, parent=middle)

        # A row no Run archived sits between them, and the repeat is told
        # apart by where the lineage stands, not by its text.
        payload = self.aligned(
            ["PT-SECRET-SAME", "PT-SECRET-UNARCHIVED", "PT-SECRET-MIDDLE", "PT-SECRET-SAME"],
            project_id=project_id,
        )

        self.assertEqual((payload["match"], payload["eventId"]), ("unique", last))
        self.assertEqual(payload["rows"], [
            {"row": 0, "eventId": first},
            {"row": 2, "eventId": middle},
            {"row": 3, "eventId": last},
        ])

    def test_branch_match_leaves_out_an_entry_that_fits_more_than_one_row(self) -> None:
        project_id = "e2" * 32
        identity = self.identity(project_id)
        first = self.capture("PT-SECRET-FIRST", identity=identity)
        self.capture("PT-SECRET-AGAIN", identity=identity, parent=first)

        # The same text went in twice but was archived once: either row may be
        # the entry's, so neither is named; its parent still has one row only.
        payload = self.aligned(
            ["PT-SECRET-FIRST", "PT-SECRET-AGAIN", "PT-SECRET-AGAIN"],
            project_id=project_id,
        )

        self.assertEqual(payload["match"], "unique")
        self.assertEqual(payload["rows"], [{"row": 0, "eventId": first}])

    def test_branch_match_aligns_only_the_tail_a_truncated_transcript_holds(self) -> None:
        project_id = "e3" * 32
        identity = self.identity(project_id)
        root = self.capture("PT-SECRET-OLDEST", identity=identity)
        middle = self.capture("PT-SECRET-MIDDLE", identity=identity, parent=root)
        tip = self.capture("PT-SECRET-NEWEST", identity=identity, parent=middle)

        payload = self.aligned(
            ["PT-SECRET-MIDDLE", "PT-SECRET-NEWEST"],
            project_id=project_id,
            transcript="truncated",
        )

        self.assertEqual((payload["match"], payload["eventId"]), ("unique", tip))
        self.assertEqual(payload["rows"], [
            {"row": 0, "eventId": middle},
            {"row": 1, "eventId": tip},
        ])

    def test_branch_match_names_no_rows_without_a_unique_lineage(self) -> None:
        project_id = "e4" * 32
        for _ in range(2):
            self.capture("PT-SECRET-TWIN", identity=self.identity(project_id))

        tied = self.aligned(["PT-SECRET-TWIN"], project_id=project_id)
        unmatched = self.aligned(["PT-SECRET-UNARCHIVED"], project_id=project_id)
        plain = self.match(["PT-SECRET-TWIN"], project_id=project_id)

        self.assertEqual((tied["match"], tied["rows"]), ("ambiguous", []))
        self.assertEqual((unmatched["match"], unmatched["rows"]), ("none", []))
        self.assertNotIn("rows", plain)

    def test_timeline_read_refuses_an_archive_root_it_cannot_vouch_for(self) -> None:
        project_id = "4" * 64
        identity = {
            "project_id": project_id,
            "run_id": str(uuid.uuid4()),
            "segment_id": str(uuid.uuid4()),
            "branch_id": str(uuid.uuid4()),
        }
        self.capture("PT-SECRET-WIDENED", identity=identity)
        database_root = self.plugin_data / "archives"
        database_root.chmod(0o755)
        self.addCleanup(database_root.chmod, 0o700)

        read = self.run_helper(*self.read_argv(project_id=project_id))

        self.assertEqual(read.returncode, 25)
        self.assertEqual(read.stdout, "")
        self.assertEqual(
            json.loads(read.stderr)["category"],
            "database-root-unavailable",
        )


if __name__ == "__main__":
    unittest.main()
