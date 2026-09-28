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
        generation: str = "-",
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
            generation,
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
        generation: str = "-",
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
            generation,
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
            "-",
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
        self.assertIsNone(json.loads(listed.stdout)["generation"])
        self.assertFalse((database_root / f"{project_id}.sqlite3").exists())

    def test_capture_list_names_the_generation_its_pendings_are_in(self) -> None:
        project_id = "f6" * 32
        legacy = self.current_archive(project_id, count=3)

        listed = self.run_helper(*self.list_argv(project_id=project_id, run_id=legacy["identity"]["run_id"]))

        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(json.loads(listed.stdout)["generation"], self.check(project_id)["generation"])

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
        # No archive holds no pending, however it went: a clear-all leaves the
        # same empty path (Issue 30).
        self.assertEqual(json.loads(gone.stderr)["category"], "capture-not-found")
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
            "generation": None,
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
            "generation": None,
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


    # Schema migration (Issue 27). Fixtures build older and newer layouts by
    # hand; what a test asserts goes through the helper's protocol and the
    # semantic verifier, not the current production tables.

    SCHEMA_1_DDL = (
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
    )

    def archive_path(self, project_id: str) -> pathlib.Path:
        return self.plugin_data / "archives" / f"{project_id}.sqlite3"

    def hand_built_archive(self, project_id: str, script: str) -> pathlib.Path:
        """An archive file written by the test rather than the helper, private
        as the helper requires, in SQLite's default rollback journal."""
        database_root = self.plugin_data / "archives"
        database_root.mkdir(mode=0o700, exist_ok=True)
        database_path = self.archive_path(project_id)
        database = sqlite3.connect(database_path)
        database.executescript(script)
        database.commit()
        database.close()
        database_path.chmod(0o600)
        return database_path

    def archive_files(self, project_id: str) -> dict[str, bytes]:
        """The archive and any backup beside it, byte for byte. SQLite's own
        `-wal`/`-shm` companions come and go with connections and are left
        out; the database header records a switch to WAL anyway."""
        prefix = f"{project_id}.sqlite3"
        return {
            path.name: path.read_bytes()
            for path in (self.plugin_data / "archives").iterdir()
            if path.name.startswith(prefix)
            and not path.name.endswith(("-wal", "-shm"))
        }

    def test_a_newer_schema_is_refused_before_anything_is_written(self) -> None:
        for version in (3, -1):
            with self.subTest(version=version):
                project_id = ("d1" if version > 0 else "d2") * 32
                self.hand_built_archive(
                    project_id,
                    "CREATE TABLE unknown_layout(value TEXT);"
                    "INSERT INTO unknown_layout VALUES('PT-SECRET-FUTURE');"
                    f"PRAGMA user_version={version};",
                )
                before = self.archive_files(project_id)
                # Refusing needs no write lock, so another writer holding one
                # does not turn the answer into a wait.
                holder = self.hold_write_lock(project_id)
                identity = self.identity(project_id)

                started = time.monotonic()
                results = [
                    self.run_helper(*self.list_argv(project_id=project_id)),
                    self.run_helper(*self.read_argv(project_id=project_id)),
                    self.run_helper(
                        *self.boundary_argv(
                            str(uuid.uuid4()), kind="collection-stopped", **identity
                        )
                    ),
                ]
                elapsed = time.monotonic() - started
                holder.execute("ROLLBACK")

                for result in results:
                    self.assertEqual(result.returncode, 25, result.stderr)
                    self.assertEqual(result.stdout, "")
                    self.assertEqual(
                        json.loads(result.stderr)["category"], "schema-version"
                    )
                    self.assertNotIn("PT-SECRET", result.stderr)
                self.assertLess(elapsed, 3.0)
                self.assertEqual(self.archive_files(project_id), before)


    def test_reads_of_a_current_archive_answer_while_another_run_holds_the_write_lock(self) -> None:
        project_id = "d3" * 32
        identity = self.identity(project_id)
        archived = self.capture("PT-SECRET-READ", identity=identity)
        holder = self.hold_write_lock(project_id)
        scope = {"run_id": identity["run_id"], "segment_id": identity["segment_id"]}

        started = time.monotonic()
        listed = self.run_helper(*self.list_argv(project_id=project_id))
        read = self.read(project_id=project_id)
        matched = self.match(["PT-SECRET-READ"], project_id=project_id, **scope)
        elapsed = time.monotonic() - started
        holder.execute("ROLLBACK")

        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(json.loads(listed.stdout)["pending"], [])
        self.assertIn(archived, [event["eventId"] for event in read["events"]])
        self.assertEqual((matched["match"], matched["eventId"]), ("unique", archived))
        # WAL readers never wait for a writer; only taking the lock would.
        self.assertLess(elapsed, 3.0)


    def schema_1_archive(
        self, project_id: str, count: int, *, extra: str = "", text_bytes: int = 0,
        journal: str = "WAL",
    ) -> dict[str, object]:
        """A schema-1 archive as the first helpers left it: `count` Prompt
        Entries on one Run and one staged capture, each text a marker padded
        to at least `text_bytes`. Answers what the protocol must still show."""
        identity = self.identity(project_id)
        entries = []
        # Helpers have always kept their archives in WAL; a copy restored by
        # other means may not be.
        script = [f"PRAGMA journal_mode={journal};", self.SCHEMA_1_DDL]
        for index in range(count):
            event_id = str(uuid.uuid4())
            text = f"PT-SECRET-LEGACY-{index}-".ljust(text_bytes, "x")
            entries.append((event_id, index + 1, text))
            script.append(
                "INSERT INTO prompt_entries VALUES("
                f"'{event_id}', {index + 1}, '{identity['run_id']}',"
                f" '{identity['segment_id']}', '{identity['branch_id']}', NULL,"
                f" {1_795_000_000_000 + index}, 'composer', 0, '-', '{text}');"
            )
        pending = str(uuid.uuid4())
        script.append(
            "INSERT INTO pending_captures VALUES("
            f"'{pending}', '{identity['run_id']}', '{identity['segment_id']}',"
            f" '{identity['branch_id']}', NULL, 1795000009999, 0, '-',"
            " 'PT-SECRET-LEGACY-PENDING');"
        )
        script.append(f"INSERT INTO metadata VALUES('{project_id}', 1, {count});")
        script.append(extra)
        script.append("PRAGMA user_version=1;")
        path = self.hand_built_archive(project_id, "".join(script))
        return {"identity": identity, "entries": entries, "pending": pending, "path": path}

    def timeline(self, project_id: str) -> list[tuple[str, int, str, str | None]]:
        """The whole Project Timeline through `timeline-read`, oldest first."""
        events: list[tuple[str, int, str, str | None]] = []
        cursor = None
        while True:
            page = self.read(project_id=project_id, cursor=cursor)
            events[:0] = [
                (event["eventId"], event["sequence"], event["kind"], event.get("text"))
                for event in page["events"]
            ]
            if not page["earlier"]:
                return events
            cursor = ("before", page["events"][0]["sequence"])

    def assert_legacy_intact(self, project_id: str, legacy: dict[str, object]) -> None:
        prompts = [
            (event_id, sequence, text)
            for event_id, sequence, kind, text in self.timeline(project_id)
            if kind == "prompt"
        ]
        self.assertEqual(prompts, legacy["entries"])
        identity = legacy["identity"]
        listed = self.run_helper(
            *self.list_argv(project_id=project_id, run_id=identity["run_id"])
        )
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(
            [row["eventId"] for row in json.loads(listed.stdout)["pending"]],
            [legacy["pending"]],
        )

    def backup_path(self, project_id: str) -> pathlib.Path:
        return self.plugin_data / "archives" / f"{project_id}.sqlite3.pre-migration-v1"

    @staticmethod
    def dump(path: pathlib.Path) -> list[str]:
        database = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            return list(database.iterdump())
        finally:
            database.close()

    def test_a_migration_keeps_a_private_backup_until_the_next_open(self) -> None:
        project_id = "d4" * 32
        legacy = self.schema_1_archive(project_id, 3)
        before = self.dump(legacy["path"])

        _, sequence = self.boundary(
            identity={**legacy["identity"]}, kind="collection-stopped"
        )

        self.assertEqual(sequence, 4)
        backup = self.backup_path(project_id)
        status = backup.lstat()
        self.assertTrue(stat.S_ISREG(status.st_mode))
        self.assertEqual(stat.S_IMODE(status.st_mode), 0o600)
        self.assertEqual(status.st_uid, os.geteuid())
        # The backup is the archive exactly as it stood before the upgrade.
        self.assertEqual(self.dump(backup), before)
        self.assertEqual(
            sorted(self.archive_files(project_id)),
            sorted([f"{project_id}.sqlite3", backup.name]),
        )

        self.assert_legacy_intact(project_id, legacy)

        self.assertFalse(backup.exists())
        self.assertEqual(list(self.archive_files(project_id)), [f"{project_id}.sqlite3"])


    def migrate(self, legacy: dict[str, object]) -> subprocess.CompletedProcess[str]:
        """Open the archive for a write, which is what upgrades it."""
        return self.run_helper(
            *self.boundary_argv(
                str(uuid.uuid4()), kind="collection-stopped", **legacy["identity"]
            )
        )

    def assert_refused_untouched(
        self,
        result: subprocess.CompletedProcess[str],
        category: str,
        project_id: str,
        before: dict[str, bytes],
    ) -> None:
        self.assertEqual(result.returncode, 25, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], category)
        self.assertNotIn("PT-SECRET", result.stderr)
        self.assertEqual(self.archive_files(project_id), before)

    @staticmethod
    def corrupt_page(path: pathlib.Path, fraction: float = 0.5) -> None:
        """Overwrite one page well inside the file, where the entries are,
        leaving the header and schema pages readable."""
        size = path.stat().st_size
        offset = (int(size * fraction) // 4096) * 4096
        with path.open("r+b") as database:
            database.seek(offset)
            database.write(b"\xa5" * 4096)

    def test_leftovers_of_an_uncommitted_migration_are_replaced_by_a_fresh_backup(self) -> None:
        project_id = "d5" * 32
        legacy = self.schema_1_archive(project_id, 3)
        before = self.dump(legacy["path"])
        backup = self.backup_path(project_id)
        partial = backup.with_name(backup.name + ".partial")
        for leftover in (backup, partial):
            leftover.write_bytes(b"PT-SECRET-STALE")
            leftover.chmod(0o600)

        migrated = self.migrate(legacy)

        self.assertEqual(migrated.returncode, 0, migrated.stderr)
        self.assertFalse(partial.exists())
        self.assertEqual(self.dump(backup), before)
        self.assert_legacy_intact(project_id, legacy)
        self.assertFalse(backup.exists())

    def test_an_occupied_backup_name_leaves_the_archive_and_the_occupant_alone(self) -> None:
        occupants = {
            "directory": lambda path: path.mkdir(mode=0o700),
            "symlink": lambda path: path.symlink_to(self.plugin_data / "elsewhere"),
            "shared-file": lambda path: (path.write_bytes(b"x"), path.chmod(0o644)),
        }
        for index, (name, occupy) in enumerate(occupants.items()):
            with self.subTest(occupant=name):
                project_id = f"e{index}" * 32
                legacy = self.schema_1_archive(project_id, 2)
                backup = self.backup_path(project_id)
                occupy(backup)
                before = legacy["path"].read_bytes()
                occupant = backup.lstat()

                result = self.migrate(legacy)

                self.assertEqual(result.returncode, 25, result.stderr)
                self.assertEqual(json.loads(result.stderr)["category"], "migration-backup")
                self.assertEqual(legacy["path"].read_bytes(), before)
                self.assertEqual(backup.lstat().st_ino, occupant.st_ino)
                self.assertFalse(backup.with_name(backup.name + ".partial").exists())

    def test_an_archive_failing_its_integrity_check_is_not_migrated(self) -> None:
        damages = {
            "damaged-page": ("WAL", lambda path: self.corrupt_page(path)),
            # Every row still reads back; only the index no longer matches
            # the table, which only a full integrity check notices.
            "stale-index": ("WAL", lambda path: self.redefine_index(path)),
            # Not even the switch to WAL may happen before the checks pass.
            "rollback-journal": ("DELETE", lambda path: self.redefine_index(path)),
        }
        for index, (name, (journal, damage)) in enumerate(damages.items()):
            with self.subTest(damage=name):
                project_id = f"f{index}" * 32
                legacy = self.schema_1_archive(
                    project_id, 60, text_bytes=2000, journal=journal
                )
                damage(legacy["path"])
                before = self.archive_files(project_id)

                result = self.migrate(legacy)

                self.assert_refused_untouched(
                    result, "archive-integrity", project_id, before
                )

    @staticmethod
    def redefine_index(path: pathlib.Path) -> None:
        database = sqlite3.connect(path)
        database.execute("PRAGMA writable_schema=ON")
        database.execute(
            "UPDATE sqlite_master SET sql='CREATE INDEX prompt_entries_run_sequence"
            " ON prompt_entries(segment_id, sequence)'"
            " WHERE name='prompt_entries_run_sequence'"
        )
        database.commit()
        database.close()

    def test_a_disk_without_room_for_the_backup_refuses_the_migration(self) -> None:
        self.mount_small_volume()
        project_id = "d7" * 32
        legacy = self.schema_1_archive(project_id, 3)
        before = self.archive_files(project_id)

        result = self.migrate(legacy)

        self.assert_refused_untouched(result, "archive-full", project_id, before)

    def test_a_migration_step_that_fails_rolls_back_and_drops_its_backup(self) -> None:
        project_id = "d8" * 32
        # An object already holding the name the upgrade creates: the step
        # itself fails, after the backup was written.
        legacy = self.schema_1_archive(
            project_id, 3, extra="CREATE TABLE timeline_events(unexpected TEXT);"
        )
        before = self.archive_files(project_id)

        result = self.migrate(legacy)

        self.assert_refused_untouched(result, "migration-verify", project_id, before)
        with sqlite3.connect(f"file:{legacy['path']}?mode=ro", uri=True) as database:
            self.assertEqual(database.execute("PRAGMA user_version").fetchone()[0], 1)

    def test_a_backup_that_cannot_be_removed_keeps_the_archive_unavailable(self) -> None:
        project_id = "d9" * 32
        legacy = self.schema_1_archive(project_id, 3)
        self.assertEqual(self.migrate(legacy).returncode, 0)
        backup = self.backup_path(project_id)
        subprocess.run(["/usr/bin/chflags", "uchg", str(backup)], check=True)
        self.addCleanup(
            subprocess.run, ["/usr/bin/chflags", "nouchg", str(backup)],
            check=False, stderr=subprocess.DEVNULL,
        )

        blocked = self.run_helper(*self.read_argv(project_id=project_id))

        self.assertEqual(blocked.returncode, 25, blocked.stderr)
        self.assertEqual(blocked.stdout, "")
        self.assertEqual(
            json.loads(blocked.stderr)["category"], "migration-backup-cleanup"
        )
        subprocess.run(["/usr/bin/chflags", "nouchg", str(backup)], check=True)
        self.assert_legacy_intact(project_id, legacy)
        self.assertFalse(backup.exists())

    def test_a_backup_outlives_an_upgraded_archive_that_fails_its_recheck(self) -> None:
        project_id = "da" * 32
        legacy = self.schema_1_archive(project_id, 60, text_bytes=2000)
        self.assertEqual(self.migrate(legacy).returncode, 0)
        backup = self.backup_path(project_id)
        kept = backup.read_bytes()
        self.corrupt_page(legacy["path"], fraction=0.3)

        result = self.run_helper(*self.list_argv(project_id=project_id))

        self.assertEqual(result.returncode, 25, result.stderr)
        self.assertEqual(json.loads(result.stderr)["category"], "archive-integrity")
        self.assertEqual(backup.read_bytes(), kept)


    def remount_read_only(self, volume: pathlib.Path) -> None:
        """Detach a volume from `mount_small_volume` and attach it again,
        read-only, at the same place."""
        subprocess.run(["/usr/bin/hdiutil", "detach", str(volume), "-quiet"], check=True)
        subprocess.run(
            ["/usr/bin/hdiutil", "attach", str(pathlib.Path(self.temporary.name) / "small.dmg"),
             "-readonly", "-mountpoint", str(volume), "-nobrowse", "-noverify", "-quiet"],
            check=True,
        )

    def test_an_archive_on_a_read_only_disk_is_named_read_only(self) -> None:
        volume = self.mount_small_volume()
        current_id = "db" * 32
        current = self.identity(current_id)
        self.capture("PT-SECRET-CURRENT", identity=current)
        legacy_id = "dc" * 32
        legacy = self.schema_1_archive(legacy_id, 2)
        self.remount_read_only(volume)
        before = {
            project_id: self.archive_files(project_id)
            for project_id in (current_id, legacy_id)
        }

        writes = {
            current_id: self.run_helper(
                *self.begin_argv(str(uuid.uuid4()), **current),
                input_text="PT-SECRET-REFUSED",
            ),
            legacy_id: self.migrate(legacy),
        }

        for project_id, result in writes.items():
            with self.subTest(project=project_id[:2]):
                self.assert_refused_untouched(
                    result, "archive-read-only", project_id, before[project_id]
                )


    def test_a_migration_killed_at_any_moment_loses_nothing(self) -> None:
        project_id = "dd" * 32
        legacy = self.schema_1_archive(project_id, 120, text_bytes=6000)
        path = legacy["path"]
        template = path.read_bytes()
        archives = self.plugin_data / "archives"

        def restore() -> None:
            for leftover in archives.iterdir():
                if leftover.name.startswith(f"{project_id}.sqlite3"):
                    leftover.unlink()
            path.write_bytes(template)
            path.chmod(0o600)

        def start() -> subprocess.Popen[str]:
            return subprocess.Popen(
                [str(HELPER), *self.boundary_argv(
                    str(uuid.uuid4()), kind="collection-stopped", **legacy["identity"]
                )],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=self.environment,
            )

        started = time.monotonic()
        start().wait(timeout=10)
        whole = time.monotonic() - started

        import random
        chooser = random.Random(27)
        phases = {1: 0, 2: 0}
        for _ in range(30):
            restore()
            helper = start()
            time.sleep(chooser.uniform(0, whole * 1.2))
            helper.kill()
            helper.wait(timeout=10)
            with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as database:
                phases[database.execute("PRAGMA user_version").fetchone()[0]] += 1

            self.assert_legacy_intact(project_id, legacy)
            self.assertEqual(list(self.archive_files(project_id)), [path.name])

        # Kills landed both before and after the upgrade committed.
        self.assertGreater(phases[1], 0, phases)
        self.assertGreater(phases[2], 0, phases)


    def test_an_archive_its_owner_may_only_read_is_named_read_only(self) -> None:
        project_id = "de" * 32
        identity = self.identity(project_id)
        self.capture("PT-SECRET-KEPT", identity=identity)
        database_root = self.plugin_data / "archives"
        path = self.archive_path(project_id)

        path.chmod(0o400)
        self.addCleanup(path.chmod, 0o600)
        before = self.archive_files(project_id)
        file_results = [
            self.run_helper(*self.read_argv(project_id=project_id)),
            self.run_helper(
                *self.begin_argv(str(uuid.uuid4()), **identity),
                input_text="PT-SECRET-REFUSED",
            ),
        ]
        path.chmod(0o600)
        # A writer restores its own root's mode; a read does not touch it.
        database_root.chmod(0o500)
        self.addCleanup(database_root.chmod, 0o700)
        directory_result = self.run_helper(*self.read_argv(project_id=project_id))
        database_root.chmod(0o700)

        for result in [*file_results, directory_result]:
            self.assert_refused_untouched(result, "archive-read-only", project_id, before)


    # Corrupt archives (Issue 28). A damaged archive is found where SQLite
    # itself meets the damage; nothing here repairs, rewrites or replaces it.

    def current_archive(self, project_id: str, count: int = 60) -> dict[str, object]:
        """A current-schema archive of `count` sizeable Prompt Entries, its
        WAL folded into the file, and no migration backup beside it."""
        legacy = self.schema_1_archive(project_id, count, text_bytes=2000)
        self.assertEqual(self.migrate(legacy).returncode, 0)
        self.assert_legacy_intact(project_id, legacy)
        self.assertEqual(list(self.archive_files(project_id)), [f"{project_id}.sqlite3"])
        return legacy

    @staticmethod
    def overwrite_header(path: pathlib.Path) -> None:
        """Leave the file no longer recognisable as a SQLite database."""
        with path.open("r+b") as database:
            database.write(b"\xa5" * 100)

    def test_damage_an_ordinary_command_meets_is_named_archive_integrity(self) -> None:
        # A damaged page is met only by what reads it; a file that is no
        # longer a database is met by anything that opens it.
        damages = {
            "damaged-page": (lambda path: self.corrupt_page(path), ("timeline-read",)),
            "not-a-database": (self.overwrite_header, ("timeline-read", "boundary-append")),
        }
        for index, (name, (damage, commands)) in enumerate(damages.items()):
            project_id = f"e{index}" * 32
            legacy = self.current_archive(project_id)
            damage(legacy["path"])
            damaged = self.check(project_id)["generation"]
            before = self.archive_files(project_id)
            argvs = {
                "timeline-read": self.read_argv(project_id=project_id),
                "boundary-append": self.boundary_argv(
                    str(uuid.uuid4()), kind="collection-stopped", **legacy["identity"]
                ),
            }
            for command in commands:
                with self.subTest(damage=name, command=command):
                    result = self.run_helper(*argvs[command])
                    # A read may have streamed part of a batch before it met
                    # the damage; the exit status is what the caller trusts.
                    self.assertEqual(result.returncode, 25, result.stderr)
                    # The failure names the generation it met, which is
                    # the one a quarantine may then move.
                    self.assertEqual(
                        json.loads(result.stderr),
                        {"category": "archive-integrity", "generation": damaged},
                    )
                    self.assertNotIn("PT-SECRET", result.stderr)
                    self.assertEqual(self.archive_files(project_id), before)

    def check_argv(self, *, project_id: str) -> tuple[str, ...]:
        return (
            "integrity-check",
            str(self.plugin_data / "archives"),
            project_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )

    def check(self, project_id: str) -> dict[str, object]:
        result = self.run_helper(*self.check_argv(project_id=project_id))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def leave_wal_unfolded(self, path: pathlib.Path) -> None:
        """Commit one more write that stays in the WAL: the writer exits
        without closing, so nothing folds it back into the file."""
        subprocess.run(
            ["python3", "-c",
             "import os, sqlite3, sys\n"
             "c = sqlite3.connect(sys.argv[1])\n"
             "c.execute('PRAGMA wal_autocheckpoint=0')\n"
             "c.execute('CREATE TABLE unfolded(x)')\n"
             "c.execute('INSERT INTO unfolded VALUES(randomblob(8000))')\n"
             "c.commit()\n"
             "os._exit(0)\n",
             str(path)],
            check=True,
        )
        self.assertTrue(path.with_name(path.name + "-wal").stat().st_size > 0)

    @staticmethod
    def fold_wal(path: pathlib.Path) -> None:
        """Close the archive the way a last connection does: the WAL folded
        into the file and removed."""
        database = sqlite3.connect(path)
        database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        database.close()
        assert not path.with_name(path.name + "-wal").exists()

    def evidence(self, project_id: str) -> dict[str, bytes]:
        """Every file of the archive byte for byte, its WAL included; only
        SQLite's shared-memory index, which any reader rebuilds, and an empty
        WAL, which holds nothing, are left out."""
        prefix = f"{project_id}.sqlite3"
        return {
            path.name: path.read_bytes()
            for path in (self.plugin_data / "archives").iterdir()
            if path.name.startswith(prefix)
            and not path.name.endswith("-shm")
            and not (path.name.endswith("-wal") and path.stat().st_size == 0)
        }

    def test_an_integrity_check_reads_without_changing_a_byte(self) -> None:
        damages = {
            "sound": (lambda path: None, "ok"),
            # Closed cleanly, its WAL folded back and removed: a reader that
            # may not write cannot open that on its own.
            "folded": (self.fold_wal, "ok"),
            "damaged-page": (lambda path: self.corrupt_page(path, fraction=0.3), "damaged"),
            "stale-index": (self.redefine_index, "damaged"),
            "not-a-database": (self.overwrite_header, "unreadable"),
        }
        for index, (name, (damage, expected)) in enumerate(damages.items()):
            with self.subTest(damage=name):
                project_id = f"e{index + 2}" * 32
                legacy = self.current_archive(project_id)
                damage(legacy["path"])
                if name not in ("folded", "not-a-database"):
                    self.leave_wal_unfolded(legacy["path"])
                before = self.evidence(project_id)

                first = self.check(project_id)
                second = self.check(project_id)

                self.assertEqual(first["result"], expected)
                self.assertRegex(first["generation"], r"^[A-Za-z0-9_-]{1,128}$")
                self.assertEqual(first, second)
                self.assertEqual(first["problems"] > 0, expected == "damaged")
                self.assertEqual(self.evidence(project_id), before)

    def test_an_integrity_check_of_an_absent_archive_creates_nothing(self) -> None:
        project_id = "e6" * 32

        checked = self.check(project_id)

        self.assertEqual((checked["result"], checked["generation"]), ("absent", None))

        self.assertFalse((self.plugin_data / "archives").exists())


    def quarantine_argv(
        self, *, project_id: str, generation: str, identity: dict[str, str] | None = None,
        event_id: str | None = None,
    ) -> tuple[str, ...]:
        identity = identity or self.identity(project_id)
        return (
            "quarantine",
            str(self.plugin_data / "archives"),
            project_id,
            generation,
            identity["run_id"],
            identity["segment_id"],
            identity["branch_id"],
            event_id or str(uuid.uuid4()),
            "1795000100000",
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )

    def quarantine(self, project_id: str, generation: str, **argv: object) -> dict[str, object]:
        result = self.run_helper(
            *self.quarantine_argv(project_id=project_id, generation=generation, **argv)  # type: ignore[arg-type]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def quarantined(self, project_id: str) -> dict[str, dict[str, bytes]]:
        """Each quarantined archive of the project by its directory's name,
        every file in it byte for byte."""
        root = self.plugin_data / "archives" / "quarantine" / project_id
        if not root.exists():
            return {}
        return {
            directory.name: {path.name: path.read_bytes() for path in directory.iterdir()}
            for directory in root.iterdir()
        }

    def damaged_archive_with_companions(self, project_id: str) -> dict[str, object]:
        """A damaged current archive with everything that travels with it: an
        unfolded WAL, its `-shm`, and a migration backup."""
        legacy = self.current_archive(project_id)
        self.corrupt_page(legacy["path"], fraction=0.3)
        self.leave_wal_unfolded(legacy["path"])
        backup = self.backup_path(project_id)
        backup.write_bytes(b"PT-SECRET-BACKUP")
        backup.chmod(0o600)
        return legacy

    def test_a_quarantine_keeps_every_file_unchanged_and_starts_an_empty_generation(self) -> None:
        project_id = "e7" * 32
        other_id = "e8" * 32
        self.damaged_archive_with_companions(project_id)
        other = self.current_archive(other_id, count=3)
        other_before = self.evidence(other_id)
        # The check reads first: a reader may rebuild `-shm`, which the
        # quarantine then moves as it finds it.
        damaged = self.check(project_id)["generation"]
        prefix = f"{project_id}.sqlite3"
        files = {
            path.name: path.read_bytes()
            for path in (self.plugin_data / "archives").iterdir()
            if path.name.startswith(prefix)
        }
        self.assertEqual(
            sorted(files),
            sorted([prefix, f"{prefix}-wal", f"{prefix}-shm", f"{prefix}.pre-migration-v1"]),
        )
        identity = self.identity(project_id)
        event_id = str(uuid.uuid4())

        answer = self.quarantine(project_id, damaged, identity=identity, event_id=event_id)

        kept = self.quarantined(project_id)
        self.assertEqual(list(kept), [answer["moved"]])
        self.assertEqual(kept[answer["moved"]], files)
        for directory in (
            self.plugin_data / "archives" / "quarantine",
            self.plugin_data / "archives" / "quarantine" / project_id,
            self.plugin_data / "archives" / "quarantine" / project_id / answer["moved"],
        ):
            self.assertEqual(stat.S_IMODE(directory.lstat().st_mode), 0o700)
        for path in (self.plugin_data / "archives" / "quarantine" / project_id / answer["moved"]).iterdir():
            self.assertEqual(stat.S_IMODE(path.lstat().st_mode), 0o600)
        # The new generation begins with the quarantine and holds nothing else.
        self.assertEqual(self.timeline(project_id), [(event_id, 1, "archive-quarantined", None)])
        checked = self.check(project_id)
        self.assertEqual(checked["result"], "ok")
        self.assertEqual(checked["generation"], answer["generation"])
        self.assertNotEqual(answer["generation"], damaged)
        # Nothing the quarantine built its generation with is left behind.
        self.assertLessEqual(
            {path.name for path in (self.plugin_data / "archives").iterdir() if path.name.startswith(project_id)},
            {f"{prefix}", f"{prefix}-wal", f"{prefix}-shm", f"{project_id}.lock"},
        )
        # Another project's archive is none of this quarantine's business.
        self.assertEqual(self.evidence(other_id), other_before)
        self.assert_legacy_intact(other_id, other)
        self.assertEqual(self.quarantined(other_id), {})


    def test_a_quarantine_of_a_generation_already_replaced_moves_nothing(self) -> None:
        project_id = "e9" * 32
        self.damaged_archive_with_companions(project_id)
        damaged = self.check(project_id)["generation"]
        first = self.quarantine(project_id, damaged)
        kept = self.quarantined(project_id)
        timeline = self.timeline(project_id)

        again = self.quarantine(project_id, damaged)

        self.assertEqual(again, {"projectId": project_id, "generation": first["generation"], "moved": None})
        self.assertEqual(self.quarantined(project_id), kept)
        self.assertEqual(self.timeline(project_id), timeline)

    def test_runs_that_quarantine_at_once_make_one_quarantined_archive(self) -> None:
        project_id = "ea" * 32
        self.damaged_archive_with_companions(project_id)
        damaged = self.check(project_id)["generation"]
        processes = [
            subprocess.Popen(
                [str(HELPER), *self.quarantine_argv(project_id=project_id, generation=damaged)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=self.environment,
            )
            for _ in range(6)
        ]
        answers = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=30)
            self.assertEqual(process.returncode, 0, stderr)
            answers.append(json.loads(stdout))

        moved = [answer["moved"] for answer in answers if answer["moved"]]
        self.assertEqual(len(moved), 1)
        self.assertEqual(list(self.quarantined(project_id)), moved)
        self.assertEqual({answer["generation"] for answer in answers}, {self.check(project_id)["generation"]})
        self.assertEqual([kind for _, _, kind, _ in self.timeline(project_id)], ["archive-quarantined"])


    def await_project_lock_held(self, project_id: str) -> None:
        """Wait until some command holds the project's lock, so what starts
        next meets it held rather than racing it."""
        import fcntl
        lock = self.plugin_data / "archives" / f"{project_id}.lock"
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with lock.open("rb") as handle:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return
                fcntl.flock(handle, fcntl.LOCK_UN)
            time.sleep(0.01)
        self.fail("no command took the project lock")

    def test_a_quarantine_waits_for_a_command_already_using_the_archive(self) -> None:
        project_id = "eb" * 32
        legacy = self.current_archive(project_id, count=3)
        sound = self.check(project_id)["generation"]
        holder = subprocess.Popen(
            ["python3", "-c",
             "import sqlite3, sys, time\n"
             "c = sqlite3.connect(sys.argv[1], isolation_level=None)\n"
             "c.execute('BEGIN IMMEDIATE')\n"
             "print('held', flush=True)\n"
             "time.sleep(1.5)\n"
             "c.execute('ROLLBACK')\n",
             str(legacy["path"])],
            stdout=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(holder.stdout.readline().strip(), "held")
        boundary_id = str(uuid.uuid4())
        writer = subprocess.Popen(
            [str(HELPER), *self.boundary_argv(boundary_id, kind="collection-stopped", **legacy["identity"])],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.environment,
        )
        self.await_project_lock_held(project_id)
        mover = subprocess.Popen(
            [str(HELPER), *self.quarantine_argv(project_id=project_id, generation=sound)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.environment,
        )

        moved_out, moved_err = mover.communicate(timeout=30)
        self.assertEqual(mover.returncode, 0, moved_err)
        kept = self.quarantined(project_id)
        written_out, written_err = writer.communicate(timeout=30)
        holder.wait(timeout=30)

        # The write already under way went into the archive before it moved,
        # and nothing reached the moved files afterwards.
        self.assertEqual(writer.returncode, 0, written_err)
        self.assertEqual(self.quarantined(project_id), kept)
        self.assertNotIn(boundary_id, [event_id for event_id, *_ in self.timeline(project_id)])
        copy = pathlib.Path(self.temporary.name) / "copy"
        shutil.copytree(
            self.plugin_data / "archives" / "quarantine" / project_id / json.loads(moved_out)["moved"],
            copy,
        )
        database = sqlite3.connect(copy / f"{project_id}.sqlite3")
        try:
            self.assertEqual(
                database.execute("SELECT kind FROM timeline_events WHERE event_id=?", (boundary_id,)).fetchall(),
                [("collection-stopped",)],
            )
        finally:
            database.close()

    def test_an_unfinished_quarantine_refuses_the_archive_until_one_finishes_it(self) -> None:
        project_id = "ec" * 32
        legacy = self.damaged_archive_with_companions(project_id)
        damaged = self.check(project_id)["generation"]
        wal = legacy["path"].with_name(legacy["path"].name + "-wal")
        before = {
            path.name: path.read_bytes()
            for path in (self.plugin_data / "archives").iterdir()
            if path.name.startswith(f"{project_id}.sqlite3") and not path.name.endswith("-shm")
        }
        # The owner may not move a file flagged immutable, so the quarantine
        # stops after the archive itself has gone.
        subprocess.run(["/usr/bin/chflags", "uchg", str(wal)], check=True)
        self.addCleanup(subprocess.run, ["/usr/bin/chflags", "nouchg", str(wal)], check=False)

        stopped = self.run_helper(*self.quarantine_argv(project_id=project_id, generation=damaged))

        self.assertEqual(stopped.returncode, 25, stopped.stderr)
        self.assertEqual(json.loads(stopped.stderr)["category"], "quarantine-failed")
        self.assertFalse(legacy["path"].exists())
        refused = {
            "timeline-read": self.read_argv(project_id=project_id),
            "capture-list": self.list_argv(project_id=project_id),
            "integrity-check": self.check_argv(project_id=project_id),
            "boundary-append": self.boundary_argv(
                str(uuid.uuid4()), kind="collection-stopped", **legacy["identity"]
            ),
            "capture-begin": self.begin_argv(str(uuid.uuid4()), **legacy["identity"]),
        }
        for command, argv in refused.items():
            with self.subTest(command=command):
                result = self.run_helper(*argv, input_text="PT-SECRET-REFUSED")
                self.assertEqual(result.returncode, 25, result.stderr)
                self.assertEqual(json.loads(result.stderr)["category"], "quarantine-failed")
        self.assertFalse(legacy["path"].exists())

        subprocess.run(["/usr/bin/chflags", "nouchg", str(wal)], check=True)
        # Whoever runs it next finishes the quarantine that was begun,
        # whatever generation it thought it was replacing.
        finished = self.quarantine(project_id, "stale")

        kept = self.quarantined(project_id)
        self.assertEqual(list(kept), [finished["moved"]])
        self.assertEqual(
            {name: data for name, data in kept[finished["moved"]].items() if not name.endswith("-shm")},
            before,
        )
        self.assertEqual([kind for _, _, kind, _ in self.timeline(project_id)], ["archive-quarantined"])


    def test_a_quarantine_killed_at_any_moment_is_finished_by_the_next(self) -> None:
        project_id = "ed" * 32
        self.damaged_archive_with_companions(project_id)
        archives = self.plugin_data / "archives"
        template = {
            path.name: path.read_bytes()
            for path in archives.iterdir()
            if path.name.startswith(f"{project_id}.sqlite3")
        }
        intent = archives / f"{project_id}.quarantine"

        def restore() -> str:
            shutil.rmtree(archives / "quarantine", ignore_errors=True)
            for leftover in archives.iterdir():
                if leftover.name.startswith(project_id) and not leftover.name.endswith(".lock"):
                    leftover.unlink()
            for name, data in template.items():
                (archives / name).write_bytes(data)
                (archives / name).chmod(0o600)
            return self.check(project_id)["generation"]

        def start(generation: str) -> subprocess.Popen[str]:
            return subprocess.Popen(
                [str(HELPER), *self.quarantine_argv(project_id=project_id, generation=generation)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=self.environment,
            )

        generation = restore()
        started = time.monotonic()
        start(generation).wait(timeout=10)
        whole = time.monotonic() - started

        import random
        chooser = random.Random(28)
        phases = {"before": 0, "during": 0, "after": 0}
        # At least 30 kills, and on until each moment has been hit, since
        # how long a run takes varies from one to the next.
        for round in range(90):
            if round >= 30 and all(phases.values()):
                break
            generation = restore()
            before = self.evidence(project_id)
            helper = start(generation)
            time.sleep(chooser.uniform(0, whole * 1.2))
            helper.kill()
            helper.wait(timeout=10)
            phases[
                "during" if intent.exists()
                else "after" if self.quarantined(project_id)
                else "before"
            ] += 1

            again = self.run_helper(*self.quarantine_argv(project_id=project_id, generation=generation))
            self.assertEqual(again.returncode, 0, again.stderr)

            kept = self.quarantined(project_id)
            self.assertEqual(len(kept), 1)
            self.assertEqual(
                {
                    name: data for name, data in next(iter(kept.values())).items()
                    if not name.endswith("-shm")
                    and not (name.endswith("-wal") and not data)
                },
                before,
            )
            self.assertEqual([kind for _, _, kind, _ in self.timeline(project_id)], ["archive-quarantined"])
            self.assertLessEqual(
                {path.name for path in archives.iterdir() if path.name.startswith(project_id)},
                {
                    f"{project_id}.lock",
                    f"{project_id}.sqlite3",
                    f"{project_id}.sqlite3-wal",
                    f"{project_id}.sqlite3-shm",
                },
            )

        # Kills landed before the quarantine began, while it was under way,
        # and after it finished.
        self.assertTrue(all(phases.values()), phases)


    def test_a_capture_names_the_generation_it_was_staged_in(self) -> None:
        project_id = "ee" * 32
        legacy = self.current_archive(project_id, count=3)
        generation = self.check(project_id)["generation"]

        unnamed = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), **legacy["identity"]), input_text="PT-SECRET-A"
        )
        named = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), generation=generation, **legacy["identity"]),
            input_text="PT-SECRET-B",
        )

        for result in (unnamed, named):
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["generation"], generation)

    def test_a_capture_meant_for_a_generation_no_longer_there_creates_nothing(self) -> None:
        project_id = "f5" * 32
        (self.plugin_data / "archives").mkdir(mode=0o700)
        identity = self.identity(project_id)

        result = self.run_helper(
            *self.begin_argv(str(uuid.uuid4()), generation="gone", **identity),
            input_text="PT-SECRET-GONE",
        )

        self.assertEqual(result.returncode, 25, result.stderr)
        self.assertEqual(json.loads(result.stderr)["category"], "archive-generation")
        self.assertFalse(self.archive_path(project_id).exists())

    def test_a_capture_meant_for_a_replaced_generation_stages_nothing(self) -> None:
        project_id = "ef" * 32
        legacy = self.damaged_archive_with_companions(project_id)
        damaged = self.check(project_id)["generation"]
        self.quarantine(project_id, damaged)
        timeline = self.timeline(project_id)

        result = self.run_helper(
            *self.begin_argv(
                str(uuid.uuid4()),
                generation=damaged,
                parent=legacy["entries"][-1][0],
                **legacy["identity"],
            ),
            input_text="PT-SECRET-STALE",
        )

        self.assertEqual(result.returncode, 25, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(json.loads(result.stderr)["category"], "archive-generation")
        listed = self.run_helper(*self.list_argv(project_id=project_id, run_id=legacy["identity"]["run_id"]))
        self.assertEqual(json.loads(listed.stdout)["pending"], [])
        self.assertEqual(self.timeline(project_id), timeline)


    def status_argv(self, *, project_id: str) -> tuple[str, ...]:
        return (
            "archive-status",
            str(self.plugin_data / "archives"),
            project_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )

    def archive_status(self, project_id: str) -> dict[str, object]:
        result = self.run_helper(*self.status_argv(project_id=project_id))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def test_archive_status_names_the_generation_and_each_quarantined_archive(self) -> None:
        project_id = "f0" * 32
        self.assertEqual(
            self.archive_status(project_id),
            {"projectId": project_id, "generation": None, "quarantined": [], "quarantineUnderway": False,
             "clearUnderway": False},
        )
        self.assertFalse((self.plugin_data / "archives").exists())

        legacy = self.damaged_archive_with_companions(project_id)
        damaged = self.check(project_id)["generation"]
        self.assertEqual(self.archive_status(project_id)["generation"], damaged)
        first = self.quarantine(project_id, damaged)
        self.corrupt_page(legacy["path"], fraction=0.0)
        second = self.quarantine(project_id, first["generation"])
        before = self.evidence(project_id)

        status = self.archive_status(project_id)

        root = self.plugin_data / "archives" / "quarantine" / project_id
        self.assertEqual(status["generation"], second["generation"])
        self.assertFalse(status["quarantineUnderway"])
        self.assertEqual(
            sorted(status["quarantined"], key=lambda kept: kept["name"]),
            sorted(
                [
                    {
                        "name": name,
                        "path": str(root / name),
                        "bytes": sum(path.stat().st_size for path in (root / name).iterdir()),
                    }
                    for name in (first["moved"], second["moved"])
                ],
                key=lambda kept: kept["name"],
            ),
        )
        self.assertEqual(self.evidence(project_id), before)

    def test_archive_status_says_a_quarantine_is_under_way(self) -> None:
        project_id = "f1" * 32
        legacy = self.damaged_archive_with_companions(project_id)
        wal = legacy["path"].with_name(legacy["path"].name + "-wal")
        subprocess.run(["/usr/bin/chflags", "uchg", str(wal)], check=True)
        self.addCleanup(subprocess.run, ["/usr/bin/chflags", "nouchg", str(wal)], check=False)
        self.run_helper(*self.quarantine_argv(project_id=project_id, generation=self.check(project_id)["generation"]))

        status = self.archive_status(project_id)

        self.assertTrue(status["quarantineUnderway"])
        self.assertIsNone(status["generation"])

    def test_timeline_read_names_the_generation_it_read(self) -> None:
        project_id = "f2" * 32
        self.assertIsNone(self.read(project_id=project_id)["generation"])
        legacy = self.current_archive(project_id, count=3)

        self.assertEqual(self.read(project_id=project_id)["generation"], self.check(project_id)["generation"])


    def test_branch_match_names_the_generation_it_matched_against(self) -> None:
        project_id = "f3" * 32
        legacy = self.current_archive(project_id, count=3)
        generation = self.check(project_id)["generation"]

        for rows in ([legacy["entries"][0][2]], []):
            with self.subTest(rows=len(rows)):
                self.assertEqual(self.match(rows, project_id=project_id)["generation"], generation)


    def test_a_quarantine_cut_short_after_the_new_generation_moves_nothing_more(self) -> None:
        # The state a kill leaves between putting the new generation in
        # place and removing the intent: finishing it must not take the new
        # archive for the old one.
        project_id = "f4" * 32
        self.damaged_archive_with_companions(project_id)
        answer = self.quarantine(project_id, self.check(project_id)["generation"])
        kept = self.quarantined(project_id)
        timeline = self.timeline(project_id)
        # Nothing opens the new generation while the intent stands, so it
        # is as its builder closed it.
        self.fold_wal(self.archive_path(project_id))
        intent = self.plugin_data / "archives" / f"{project_id}.quarantine"
        intent.write_text(answer["moved"])
        intent.chmod(0o600)

        finished = self.quarantine(project_id, "stale")

        self.assertFalse(intent.exists())
        self.assertEqual(self.quarantined(project_id), kept)
        self.assertEqual(finished["generation"], answer["generation"])
        self.assertEqual(self.timeline(project_id), timeline)


    # Clearing a Project Timeline (Issue 30). Everything the project archived
    # goes, quarantined archives included; nothing but its lock stays.

    def clear_argv(self, *, project_id: str, keep_run: str | None = None) -> tuple[str, ...]:
        return (
            "clear-all",
            str(self.plugin_data / "archives"),
            project_id,
            keep_run or str(uuid.uuid4()),
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
            "--stdin",
        )

    def clear(self, project_id: str, *, runs: list[str] = (), keep_run: str | None = None) -> dict[str, object]:
        result = self.run_helper(
            *self.clear_argv(project_id=project_id, keep_run=keep_run),
            input_text="".join(f"{run}\n" for run in runs),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def markers_left(self, marker: bytes = b"PT-SECRET") -> list[str]:
        """Every file under the plugin's data that still holds `marker`."""
        return sorted(
            str(path.relative_to(self.plugin_data))
            for path in self.plugin_data.rglob("*")
            if path.is_file() and not path.is_symlink() and marker in path.read_bytes()
        )

    def project_files(self, project_id: str) -> list[str]:
        archives = self.plugin_data / "archives"
        found = [path.name for path in archives.iterdir() if path.name.startswith(project_id)]
        if (archives / "quarantine" / project_id).exists():
            found.append(f"quarantine/{project_id}")
        return sorted(found)

    def test_a_clear_removes_every_file_the_project_archived_and_nothing_else(self) -> None:
        project_id = "a0" * 32
        other_id = "a1" * 32
        self.damaged_archive_with_companions(project_id)
        self.quarantine(project_id, self.check(project_id)["generation"])
        identity = self.identity(project_id)
        self.capture("PT-SECRET-KEPT-IN-NEW", identity=identity)
        staged = self.run_helper(*self.begin_argv(str(uuid.uuid4()), **identity), input_text="PT-SECRET-STAGED")
        self.assertEqual(staged.returncode, 0, staged.stderr)
        self.leave_wal_unfolded(self.archive_path(project_id))
        other = self.current_archive(other_id, count=3)
        other_before = self.evidence(other_id)

        answer = self.clear(project_id)

        self.assertEqual(
            answer,
            {"projectId": project_id, "cleared": True, "entries": 1, "pending": 1,
             "quarantined": 1, "sessionsRemoved": 0, "sessionsFailed": 0},
        )
        self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])
        self.assertEqual(
            [path for path in self.markers_left() if project_id in path], []
        )
        self.assertEqual(self.evidence(other_id), other_before)
        self.assert_legacy_intact(other_id, other)


    def test_a_clear_with_nothing_archived_does_nothing(self) -> None:
        project_id = "a2" * 32
        nothing = {"projectId": project_id, "cleared": False, "entries": 0, "pending": 0,
                   "quarantined": 0, "sessionsRemoved": 0, "sessionsFailed": 0}

        self.assertEqual(self.clear(project_id), nothing)
        self.assertFalse((self.plugin_data / "archives").exists())

        # A root that holds only another project's archive, or this one's
        # lock, holds nothing of this project's to clear.
        self.current_archive("a3" * 32, count=1)
        lock = self.plugin_data / "archives" / f"{project_id}.lock"
        lock.touch(mode=0o600)
        self.assertEqual(self.clear(project_id), nothing)
        self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])


    def test_a_clear_that_leaves_a_file_behind_refuses_the_archive_until_one_finishes(self) -> None:
        project_id = "a4" * 32
        legacy = self.damaged_archive_with_companions(project_id)
        self.quarantine(project_id, self.check(project_id)["generation"])
        kept = self.plugin_data / "archives" / "quarantine" / project_id
        stuck = next(next(kept.iterdir()).iterdir())
        # The owner may not remove a file flagged immutable.
        subprocess.run(["/usr/bin/chflags", "uchg", str(stuck)], check=True)
        self.addCleanup(subprocess.run, ["/usr/bin/chflags", "nouchg", str(stuck)], check=False)

        stopped = self.run_helper(*self.clear_argv(project_id=project_id), input_text="")

        self.assertEqual(stopped.returncode, 25, stopped.stderr)
        self.assertEqual(json.loads(stopped.stderr), {"category": "clear-unfinished"})
        self.assertFalse(self.archive_path(project_id).exists())
        refused = {
            "timeline-read": self.read_argv(project_id=project_id),
            "capture-list": self.list_argv(project_id=project_id),
            "integrity-check": self.check_argv(project_id=project_id),
            "boundary-append": self.boundary_argv(
                str(uuid.uuid4()), kind="collection-stopped", **legacy["identity"]
            ),
            "capture-begin": self.begin_argv(str(uuid.uuid4()), **legacy["identity"]),
            "quarantine": self.quarantine_argv(project_id=project_id, generation="stale"),
        }
        for command, argv in refused.items():
            with self.subTest(command=command):
                result = self.run_helper(*argv, input_text="PT-SECRET-REFUSED")
                self.assertEqual(result.returncode, 25, result.stderr)
                self.assertEqual(json.loads(result.stderr)["category"], "clear-unfinished")
        self.assertEqual(
            self.project_files(project_id),
            [f"{project_id}.clearing", f"{project_id}.lock", f"quarantine/{project_id}"],
        )
        self.assertTrue(self.archive_status(project_id)["clearUnderway"])

        subprocess.run(["/usr/bin/chflags", "nouchg", str(stuck)], check=True)
        finished = self.clear(project_id)

        self.assertTrue(finished["cleared"])
        self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])
        self.assertFalse(self.archive_status(project_id)["clearUnderway"])
        self.assertEqual([path for path in self.markers_left() if project_id in path], [])


    def abort_argv(self, event_id: str, *, project_id: str) -> tuple[str, ...]:
        return (
            "capture-abort",
            str(self.plugin_data / "archives"),
            project_id,
            event_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )

    def test_writers_of_a_cleared_generation_leave_nothing_behind(self) -> None:
        project_id = "a5" * 32
        legacy = self.current_archive(project_id, count=3)
        identity = legacy["identity"]
        cleared = self.check(project_id)["generation"]
        pending = str(uuid.uuid4())
        staged = self.run_helper(*self.begin_argv(pending, **identity), input_text="PT-SECRET-IN-FLIGHT")
        self.assertEqual(staged.returncode, 0, staged.stderr)
        self.clear(project_id)

        stale = {
            "capture-begin": (
                self.begin_argv(str(uuid.uuid4()), generation=cleared, **identity),
                "archive-generation",
            ),
            "boundary-append": (
                self.boundary_argv(str(uuid.uuid4()), kind="clear", generation=cleared, **identity),
                "archive-generation",
            ),
            # The submission staged before the clear went with it.
            "capture-confirm": (self.confirm_argv(pending, project_id=project_id), "capture-not-found"),
        }
        for command, (argv, category) in stale.items():
            with self.subTest(command=command):
                result = self.run_helper(*argv, input_text="PT-SECRET-IN-FLIGHT")
                self.assertEqual(result.returncode, 25, result.stderr)
                self.assertEqual(json.loads(result.stderr)["category"], category)
        aborted = self.run_helper(*self.abort_argv(pending, project_id=project_id))
        self.assertEqual(aborted.returncode, 0, aborted.stderr)
        self.assertEqual(json.loads(aborted.stdout), {"aborted": False})
        self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])

        # What arrives after the clear without a generation begins the next.
        attached, _ = self.boundary(identity=identity, kind="run-attached")
        fresh = self.check(project_id)["generation"]
        self.assertNotEqual(fresh, cleared)
        self.assertEqual([(event_id, kind) for event_id, _, kind, _ in self.timeline(project_id)],
                         [(attached, "run-attached")])
        named = self.run_helper(
            *self.boundary_argv(str(uuid.uuid4()), kind="clear", generation=fresh, **identity)
        )
        self.assertEqual(named.returncode, 0, named.stderr)
        replayed = self.run_helper(
            *self.boundary_argv(str(uuid.uuid4()), kind="clear", generation=cleared, **identity)
        )
        self.assertEqual(json.loads(replayed.stderr)["category"], "archive-generation")
        self.assertEqual(len(self.timeline(project_id)), 2)


    def index_session(self, run_id: str) -> str:
        """A session index record the bridge would have written, answering
        its session."""
        session_id = str(uuid.uuid4())
        directory = self.plugin_data / "sessions"
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / f"{session_id}.json"
        path.write_text(json.dumps({
            "indexVersion": 1, "sessionId": session_id, "runId": run_id,
            "archiveGeneration": str(uuid.uuid4()),
        }) + "\n")
        path.chmod(0o600)
        return session_id

    def indexed_sessions(self) -> set[str]:
        return {path.stem for path in (self.plugin_data / "sessions").glob("*.json")}

    def test_a_clear_forgets_the_sessions_of_runs_that_do_not_go_on(self) -> None:
        # This test process stands for a live Run: its locator is published
        # and the helper runs for another host.
        self.publish_locator()
        live_run = json.loads(self.locator.read_text())["runId"]
        project_id = "a6" * 32
        archived = self.identity(project_id)
        self.capture("PT-SECRET-ARCHIVED", identity=archived)
        this_run = self.identity(project_id)
        self.capture("PT-SECRET-THIS-RUN", identity=this_run)
        self.capture("PT-SECRET-LIVE", identity=self.identity(project_id, run_id=live_run))
        remembered = str(uuid.uuid4())
        unrelated = self.index_session(str(uuid.uuid4()))
        gone = {
            self.index_session(archived["run_id"]),
            self.index_session(archived["run_id"]),
            self.index_session(remembered),
        }
        staying = {self.index_session(this_run["run_id"]), self.session_id, unrelated}

        result = self.run_helper(
            *self.clear_argv(project_id=project_id, keep_run=this_run["run_id"]),
            input_text=f"{remembered}\n{this_run['run_id']}\n",
            via_child=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        answer = json.loads(result.stdout)
        self.assertEqual((answer["sessionsRemoved"], answer["sessionsFailed"]), (3, 0))
        self.assertEqual(self.indexed_sessions(), staying)


    def inventory(self, project_id: str) -> dict[str, object]:
        result = self.run_helper(
            "clear-inventory",
            str(self.plugin_data / "archives"),
            project_id,
            json.loads(MANIFEST.read_text())["sha256"],
            "1",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("PT-SECRET", result.stdout)
        return json.loads(result.stdout)

    def test_a_clear_inventory_lists_what_a_clear_would_remove_without_changing_it(self) -> None:
        project_id = "a7" * 32
        nothing = {"projectId": project_id, "present": False, "clearUnderway": False,
                   "generation": None, "entries": 0, "pending": 0, "files": [], "quarantined": []}
        self.assertEqual(self.inventory(project_id), nothing)
        self.assertFalse((self.plugin_data / "archives").exists())

        self.damaged_archive_with_companions(project_id)
        moved = self.quarantine(project_id, self.check(project_id)["generation"])["moved"]
        identity = self.identity(project_id)
        self.capture("PT-SECRET-ONE", identity=identity)
        self.capture("PT-SECRET-TWO", identity=identity)
        self.assertEqual(
            self.run_helper(*self.begin_argv(str(uuid.uuid4()), **identity), input_text="PT-SECRET-3").returncode, 0
        )
        backup = self.backup_path(project_id)
        backup.write_bytes(b"PT-SECRET-BACKUP")
        backup.chmod(0o600)
        self.fold_wal(self.archive_path(project_id))
        before = self.evidence(project_id)
        kept = self.quarantined(project_id)

        listed = self.inventory(project_id)

        archives = self.plugin_data / "archives"
        self.assertEqual(listed["generation"], self.check(project_id)["generation"])
        self.assertEqual(
            {key: listed[key] for key in ("present", "clearUnderway", "entries", "pending")},
            {"present": True, "clearUnderway": False, "entries": 2, "pending": 1},
        )
        self.assertEqual(
            {file["name"] for file in listed["files"]},
            {f"{project_id}.sqlite3", f"{project_id}.sqlite3.pre-migration-v1"}
            | {path.name for path in archives.glob(f"{project_id}.sqlite3-*")},
        )
        self.assertEqual(
            next(file["bytes"] for file in listed["files"] if file["name"].endswith("-v1")),
            len(b"PT-SECRET-BACKUP"),
        )
        root = archives / "quarantine" / project_id
        self.assertEqual(
            listed["quarantined"],
            [{"name": moved, "path": str(root / moved),
              "bytes": sum(path.stat().st_size for path in (root / moved).iterdir())}],
        )
        self.assertEqual(self.evidence(project_id), before)
        self.assertEqual(self.quarantined(project_id), kept)

        # A damaged archive is listed with counts it cannot give.
        self.corrupt_page(self.archive_path(project_id), fraction=0.0)
        damaged = self.inventory(project_id)
        self.assertEqual((damaged["entries"], damaged["pending"]), (None, None))


    def test_a_clear_waits_for_a_command_already_using_the_archive(self) -> None:
        project_id = "a8" * 32
        legacy = self.current_archive(project_id, count=3)
        holder = subprocess.Popen(
            ["python3", "-c",
             "import sqlite3, sys, time\n"
             "c = sqlite3.connect(sys.argv[1], isolation_level=None)\n"
             "c.execute('BEGIN IMMEDIATE')\n"
             "print('held', flush=True)\n"
             "time.sleep(1.5)\n"
             "c.execute('ROLLBACK')\n",
             str(legacy["path"])],
            stdout=subprocess.PIPE,
            text=True,
        )
        self.assertEqual(holder.stdout.readline().strip(), "held")
        writer = subprocess.Popen(
            [str(HELPER), *self.begin_argv(str(uuid.uuid4()), **legacy["identity"])],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=self.environment,
        )
        writer.stdin.write("PT-SECRET-UNDER-WAY")
        writer.stdin.close()
        self.await_project_lock_held(project_id)

        answer = self.clear(project_id)
        writer.wait(timeout=30)
        holder.wait(timeout=30)

        # The write under way landed before the cut and went with the rest.
        self.assertEqual(writer.returncode, 0, writer.stderr.read())
        self.assertEqual((answer["entries"], answer["pending"]), (3, 2))
        self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])
        self.assertEqual(self.markers_left(b"PT-SECRET-UNDER-WAY"), [])

    def test_a_clear_cut_short_is_finished_by_the_next(self) -> None:
        # The states a kill leaves once the intent stands: nothing removed
        # yet, the archive gone and its quarantined copies still there, or
        # everything gone but the intent itself.
        archives = self.plugin_data / "archives"
        for index, removed in enumerate(([], ["archive"], ["archive", "quarantine"])):
            with self.subTest(removed=removed):
                project_id = ("a9", "b8", "b7")[index] * 32
                legacy = self.damaged_archive_with_companions(project_id)
                self.quarantine(project_id, self.check(project_id)["generation"])
                self.capture("PT-SECRET-NEW", identity=legacy["identity"])
                intent = archives / f"{project_id}.clearing"
                intent.write_text("clear\n")
                intent.chmod(0o600)
                if "archive" in removed:
                    for path in archives.glob(f"{project_id}.sqlite3*"):
                        path.unlink()
                if "quarantine" in removed:
                    shutil.rmtree(archives / "quarantine" / project_id)
                refused = self.run_helper(*self.read_argv(project_id=project_id))
                self.assertEqual(json.loads(refused.stderr)["category"], "clear-unfinished")

                finished = self.clear(project_id)

                self.assertTrue(finished["cleared"])
                self.assertEqual(finished["entries"], None if removed else 1)
                self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])
                self.assertEqual([path for path in self.markers_left() if project_id in path], [])

    def test_a_staged_intent_left_by_a_clear_that_never_began_refuses_nothing(self) -> None:
        project_id = "b9" * 32
        identity = self.identity(project_id)
        self.capture("PT-SECRET-KEPT", identity=identity)
        staged = self.plugin_data / "archives" / f"{project_id}.clearing.partial"
        staged.write_text("clear\n")
        staged.chmod(0o600)

        self.assertEqual(self.read(project_id=project_id)["events"][-1]["text"], "PT-SECRET-KEPT")
        self.assertTrue(self.clear(project_id)["cleared"])
        self.assertEqual(self.project_files(project_id), [f"{project_id}.lock"])

    def test_a_clear_refuses_a_run_it_cannot_name_and_removes_nothing(self) -> None:
        project_id = "ba" * 32
        self.capture("PT-SECRET-KEPT", identity=self.identity(project_id))
        before = self.project_files(project_id)

        for listed in ("../escape\n", "a b\n", "\u0000\n"):
            with self.subTest(listed=listed):
                result = self.run_helper(*self.clear_argv(project_id=project_id), input_text=listed)
                self.assertEqual(result.returncode, 25, result.stderr)
                self.assertEqual(json.loads(result.stderr)["category"], "clear-input")
                self.assertEqual(self.project_files(project_id), before)


if __name__ == "__main__":
    unittest.main()
