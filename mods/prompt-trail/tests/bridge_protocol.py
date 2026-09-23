#!/usr/bin/env python3
import hashlib
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
BRIDGE = ROOT / "bin" / "prompt-trail-bridge"
HELPER = ROOT / "bin" / "prompt-trail-helper"
MANIFEST = ROOT / "artifacts" / "helper-manifest.json"


class BridgeProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = pathlib.Path(self.temporary.name) / "home"
        self.plugin_data = pathlib.Path(self.temporary.name) / "plugin-data"
        self.home.mkdir(mode=0o700)
        self.plugin_data.mkdir(mode=0o700)
        self.session_id = str(uuid.uuid4())
        self.environment = {**os.environ, "HOME": str(self.home)}

    @property
    def locator_directory(self) -> pathlib.Path:
        return self.home / ".claude/plugins/data/.function-hook-locators/prompt-trail"

    def locators_of(self, session_id: str) -> list[pathlib.Path]:
        return sorted(self.locator_directory.glob(f"{session_id}.*.json"))

    @property
    def locator(self) -> pathlib.Path:
        # The newest locator of the current session: one per process that has
        # it open, so a test that publishes twice for one session reads the
        # one it published last.
        found = self.locators_of(self.session_id)
        if not found:
            return self.locator_directory / f"{self.session_id}.missing.json"
        return max(found, key=lambda path: path.stat().st_mtime_ns)

    @staticmethod
    def locator_name(payload: dict[str, object]) -> str:
        return (
            f"{payload['sessionId']}.{payload['hostPid']}"
            f"-{payload['hostStartSeconds']}-{payload['hostStartMicroseconds']}.json"
        )

    def run_bridge(
        self,
        operation: str,
        hook_input: dict[str, object],
        *,
        plugin_root: pathlib.Path = ROOT,
        helper: pathlib.Path = HELPER,
        manifest: pathlib.Path = MANIFEST,
        via_child: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        # A shell that outlives the bridge becomes its parent, so the bridge
        # sees a host process of another generation that inherited this one's
        # whole environment.
        wrapper = ["/bin/sh", "-c", '"$@"; exit $?', "sh"] if via_child else []
        return subprocess.run(
            [
                *wrapper,
                str(BRIDGE),
                operation,
                str(plugin_root),
                str(self.plugin_data),
                str(helper),
                str(manifest),
            ],
            input=json.dumps(hook_input),
            check=False,
            capture_output=True,
            text=True,
            env=self.environment,
        )

    def session_input(self, event: str) -> dict[str, object]:
        payload: dict[str, object] = {
            "session_id": self.session_id,
            "transcript_path": str(self.home / "transcript.jsonl"),
            "cwd": str(ROOT),
            "hook_event_name": event,
        }
        payload["source" if event == "SessionStart" else "reason"] = (
            "startup" if event == "SessionStart" else "prompt_input_exit"
        )
        return payload

    def test_publish_creates_only_a_private_session_locator(self) -> None:
        result = self.run_bridge("publish", self.session_input("SessionStart"))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        payload = json.loads(self.locator.read_text())
        self.assertEqual(payload["locatorVersion"], 1)
        self.assertEqual(payload["pluginProtocol"], 1)
        self.assertEqual(payload["helperProtocol"], 1)
        self.assertEqual(payload["sessionId"], self.session_id)
        self.assertEqual(payload["helperPath"], str(HELPER.resolve()))
        self.assertEqual(
            payload["helperSha256"],
            hashlib.sha256(HELPER.read_bytes()).hexdigest(),
        )
        self.assertEqual(
            payload["databaseRoot"],
            str(self.plugin_data.resolve() / "archives"),
        )
        self.assertEqual(payload["artifactStatus"], "trusted")
        self.assertRegex(payload["runId"], r"^[0-9a-f-]{36}$")
        self.assertRegex(payload["archiveGeneration"], r"^[0-9a-f-]{36}$")
        self.assertEqual(stat.S_IMODE(self.locator.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.locator.parent.stat().st_mode), 0o700)
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_publish_names_the_locator_for_its_host_process_generation(self) -> None:
        result = self.run_bridge("publish", self.session_input("SessionStart"))

        self.assertEqual(result.returncode, 0, result.stderr)
        published = self.locators_of(self.session_id)
        self.assertEqual(len(published), 1)
        payload = json.loads(published[0].read_text())
        self.assertEqual(published[0].name, self.locator_name(payload))
        self.assertEqual(payload["hostPid"], os.getpid())

    def test_publish_records_a_missing_helper_without_executing_it(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest = plugin_root / "artifacts/helper-manifest.json"
        shutil.copy2(MANIFEST, manifest)

        result = self.run_bridge(
            "publish",
            self.session_input("SessionStart"),
            plugin_root=plugin_root,
            helper=helper,
            manifest=manifest,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        payload = json.loads(self.locator.read_text())
        self.assertEqual(payload["artifactStatus"], "helper-missing")
        self.assertEqual(payload["helperPath"], str(helper))
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_publish_records_a_changed_helper_digest(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest = plugin_root / "artifacts/helper-manifest.json"
        shutil.copy2(HELPER, helper)
        shutil.copy2(MANIFEST, manifest)
        helper.write_bytes(helper.read_bytes() + b"changed")
        helper.chmod(0o755)

        result = self.run_bridge(
            "publish",
            self.session_input("SessionStart"),
            plugin_root=plugin_root,
            helper=helper,
            manifest=manifest,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        payload = json.loads(self.locator.read_text())
        self.assertEqual(payload["artifactStatus"], "digest-mismatch")
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_publish_rejects_a_group_writable_plugin_directory(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest = plugin_root / "artifacts/helper-manifest.json"
        shutil.copy2(HELPER, helper)
        shutil.copy2(MANIFEST, manifest)
        (plugin_root / "bin").chmod(0o775)

        result = self.run_bridge(
            "publish",
            self.session_input("SessionStart"),
            plugin_root=plugin_root,
            helper=helper,
            manifest=manifest,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stderr), {"category": "plugin-bin-untrusted"})
        self.assertFalse(self.locator.exists())

    def test_publish_records_a_group_writable_helper_as_untrusted(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest = plugin_root / "artifacts/helper-manifest.json"
        shutil.copy2(HELPER, helper)
        shutil.copy2(MANIFEST, manifest)
        helper.chmod(0o775)

        result = self.run_bridge(
            "publish",
            self.session_input("SessionStart"),
            plugin_root=plugin_root,
            helper=helper,
            manifest=manifest,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(self.locator.read_text())
        self.assertEqual(payload["artifactStatus"], "helper-untrusted")
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_publish_records_a_write_acl_helper_as_untrusted(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest = plugin_root / "artifacts/helper-manifest.json"
        shutil.copy2(HELPER, helper)
        shutil.copy2(MANIFEST, manifest)
        username = pwd.getpwuid(os.geteuid()).pw_name
        subprocess.run(
            ["/bin/chmod", "+a", f"{username} allow write", str(helper)],
            check=True,
            capture_output=True,
            text=True,
        )

        result = self.run_bridge(
            "publish",
            self.session_input("SessionStart"),
            plugin_root=plugin_root,
            helper=helper,
            manifest=manifest,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(self.locator.read_text())
        self.assertEqual(payload["artifactStatus"], "helper-untrusted")
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_publish_records_a_symlink_helper_as_non_regular(self) -> None:
        plugin_root = pathlib.Path(self.temporary.name) / "plugin"
        (plugin_root / "bin").mkdir(parents=True)
        (plugin_root / "artifacts").mkdir(parents=True)
        plugin_root = plugin_root.resolve()
        helper = plugin_root / "bin/prompt-trail-helper"
        manifest = plugin_root / "artifacts/helper-manifest.json"
        helper.symlink_to(HELPER)
        shutil.copy2(MANIFEST, manifest)

        result = self.run_bridge(
            "publish",
            self.session_input("SessionStart"),
            plugin_root=plugin_root,
            helper=helper,
            manifest=manifest,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(self.locator.read_text())
        self.assertEqual(payload["artifactStatus"], "helper-not-regular")
        self.assertFalse((self.plugin_data / "archives").exists())

    def test_normal_end_removes_only_the_matching_session_locator(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)

        removed = self.run_bridge("remove", self.session_input("SessionEnd"))

        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertEqual(removed.stdout, "")
        self.assertEqual(removed.stderr, "")
        self.assertFalse(self.locator.exists())

    def test_clear_rotates_locator_without_changing_run_identity(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        previous_locator = self.locator
        previous_payload = json.loads(previous_locator.read_text())

        clear_end = self.session_input("SessionEnd")
        clear_end["reason"] = "clear"
        retained = self.run_bridge("remove", clear_end)
        self.assertEqual(retained.returncode, 0, retained.stderr)
        self.assertTrue(previous_locator.exists())

        self.session_id = str(uuid.uuid4())
        clear_start = self.session_input("SessionStart")
        clear_start["source"] = "clear"
        rotated = self.run_bridge("publish", clear_start)

        self.assertEqual(rotated.returncode, 0, rotated.stderr)
        self.assertFalse(previous_locator.exists())
        current_payload = json.loads(self.locator.read_text())
        self.assertEqual(current_payload["sessionId"], self.session_id)
        self.assertEqual(stat.S_IMODE(self.locator.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.locator.parent.stat().st_mode), 0o700)
        self.assertEqual(current_payload["runId"], previous_payload["runId"])
        self.assertEqual(
            current_payload["archiveGeneration"],
            previous_payload["archiveGeneration"],
        )

        removed = self.run_bridge("remove", self.session_input("SessionEnd"))
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertFalse(self.locator.exists())

    def test_clear_rotation_recovers_after_publish_before_predecessor_removal(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        previous_locator = self.locator
        previous_payload = json.loads(previous_locator.read_text())

        self.session_id = str(uuid.uuid4())
        interrupted_locator = self.locator
        interrupted_locator.write_text(
            json.dumps({**previous_payload, "sessionId": self.session_id}) + "\n"
        )
        interrupted_locator.chmod(0o600)
        clear_start = self.session_input("SessionStart")
        clear_start["source"] = "clear"

        recovered = self.run_bridge("publish", clear_start)

        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertFalse(previous_locator.exists())
        current_payload = json.loads(interrupted_locator.read_text())
        self.assertEqual(current_payload["sessionId"], self.session_id)
        self.assertEqual(current_payload["runId"], previous_payload["runId"])
        self.assertEqual(
            current_payload["archiveGeneration"],
            previous_payload["archiveGeneration"],
        )

    def test_next_clear_recovers_multiple_unremoved_predecessors(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        first_locator = self.locator
        first_payload = json.loads(first_locator.read_text())

        second_session = str(uuid.uuid4())
        second_locator = first_locator.parent / f"{second_session}.json"
        second_locator.write_text(
            json.dumps({**first_payload, "sessionId": second_session}) + "\n"
        )
        second_locator.chmod(0o600)

        self.session_id = str(uuid.uuid4())
        clear_start = self.session_input("SessionStart")
        clear_start["source"] = "clear"
        recovered = self.run_bridge("publish", clear_start)

        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        self.assertFalse(first_locator.exists())
        self.assertFalse(second_locator.exists())
        current_payload = json.loads(self.locator.read_text())
        self.assertEqual(current_payload["sessionId"], self.session_id)
        self.assertEqual(current_payload["runId"], first_payload["runId"])
        self.assertEqual(
            current_payload["archiveGeneration"],
            first_payload["archiveGeneration"],
        )

    def test_clear_start_without_a_predecessor_fails_closed(self) -> None:
        clear_start = self.session_input("SessionStart")
        clear_start["source"] = "clear"

        result = self.run_bridge("publish", clear_start)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            json.loads(result.stderr),
            {"category": "locator-predecessor-missing"},
        )
        self.assertFalse(self.locator.exists())

    def test_publish_removes_only_proven_stale_private_locators(self) -> None:
        active_session = self.session_id
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        active_locator = self.locator
        template = json.loads(active_locator.read_text())

        stale_session = str(uuid.uuid4())
        stale_payload = {
            **template,
            "sessionId": stale_session,
            "hostPid": 2_147_483_647,
            "hostStartSeconds": 1,
            "hostStartMicroseconds": 1,
        }
        stale_locator = active_locator.parent / self.locator_name(stale_payload)
        stale_locator.write_text(json.dumps(stale_payload) + "\n")
        stale_locator.chmod(0o600)
        # The one name every locator had before they were named per process.
        legacy_session = str(uuid.uuid4())
        legacy_locator = active_locator.parent / f"{legacy_session}.json"
        legacy_locator.write_text(json.dumps({**stale_payload, "sessionId": legacy_session}) + "\n")
        legacy_locator.chmod(0o600)

        unsafe_session = str(uuid.uuid4())
        unsafe_locator = active_locator.parent / f"{unsafe_session}.json"
        unsafe_locator.write_text(json.dumps({**stale_payload, "sessionId": unsafe_session}) + "\n")
        unsafe_locator.chmod(0o644)

        self.session_id = str(uuid.uuid4())
        next_run = self.run_bridge("publish", self.session_input("SessionStart"))

        self.assertEqual(next_run.returncode, 0, next_run.stderr)
        self.assertFalse(stale_locator.exists())
        self.assertFalse(legacy_locator.exists())
        self.assertTrue(unsafe_locator.exists())
        self.assertEqual(self.locators_of(active_session), [active_locator])
        self.assertTrue(self.locator.exists())

    def in_process_resume(self, target_session: str) -> subprocess.CompletedProcess[str]:
        resume_end = self.session_input("SessionEnd")
        resume_end["reason"] = "resume"
        retained = self.run_bridge("remove", resume_end)
        self.assertEqual(retained.returncode, 0, retained.stderr)
        self.session_id = target_session
        resume_start = self.session_input("SessionStart")
        resume_start["source"] = "resume"
        return self.run_bridge("publish", resume_start)

    def test_in_process_resume_to_a_session_of_the_same_run_keeps_it(self) -> None:
        first_session = self.session_id
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        original = json.loads(self.locator.read_text())
        clear_end = self.session_input("SessionEnd")
        clear_end["reason"] = "clear"
        self.assertEqual(self.run_bridge("remove", clear_end).returncode, 0)
        self.session_id = str(uuid.uuid4())
        clear_start = self.session_input("SessionStart")
        clear_start["source"] = "clear"
        self.assertEqual(self.run_bridge("publish", clear_start).returncode, 0)
        left_behind = self.locator

        resumed = self.in_process_resume(first_session)

        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertFalse(left_behind.exists())
        current = json.loads(self.locator.read_text())
        self.assertEqual(current["sessionId"], first_session)
        self.assertEqual(current["runId"], original["runId"])
        self.assertEqual(current["hostPid"], original["hostPid"])

    def test_in_process_resume_to_another_runs_session_moves_the_process_to_it(self) -> None:
        # A session that belongs to another Run: started in a process that has
        # since exited.
        other_session = self.session_id
        other = self.run_bridge("publish", self.session_input("SessionStart"), via_child=True)
        self.assertEqual(other.returncode, 0, other.stderr)
        other_run = json.loads(self.locator.read_text())["runId"]

        self.session_id = str(uuid.uuid4())
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        left_behind = self.locator
        own_run = json.loads(left_behind.read_text())["runId"]
        self.assertNotEqual(own_run, other_run)

        resumed = self.in_process_resume(other_session)

        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertFalse(left_behind.exists())
        current = json.loads(self.locator.read_text())
        self.assertEqual(current["runId"], other_run)
        self.assertEqual(current["hostPid"], os.getpid())

    def test_in_process_resume_to_an_unindexed_session_begins_a_new_run(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        left_behind = self.locator
        own_run = json.loads(left_behind.read_text())["runId"]

        resumed = self.in_process_resume(str(uuid.uuid4()))

        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertFalse(left_behind.exists())
        current = json.loads(self.locator.read_text())
        self.assertNotEqual(current["runId"], own_run)
        self.assertEqual(current["hostPid"], os.getpid())

    def test_resume_after_the_process_exited_continues_its_run(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        original = json.loads(self.locator.read_text())
        ended = self.run_bridge("remove", self.session_input("SessionEnd"))
        self.assertEqual(ended.returncode, 0, ended.stderr)
        self.assertEqual(self.locators_of(self.session_id), [])

        resume_start = self.session_input("SessionStart")
        resume_start["source"] = "resume"
        resumed = self.run_bridge("publish", resume_start, via_child=True)

        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        current = json.loads(self.locator.read_text())
        self.assertNotEqual(current["hostPid"], original["hostPid"])
        self.assertEqual(current["runId"], original["runId"])
        self.assertEqual(current["archiveGeneration"], original["archiveGeneration"])

    def test_the_session_index_holds_identity_only_in_a_private_file(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        locator = json.loads(self.locator.read_text())

        index = self.plugin_data / "sessions" / f"{self.session_id}.json"
        self.assertEqual(
            json.loads(index.read_text()),
            {
                "indexVersion": 1,
                "sessionId": self.session_id,
                "runId": locator["runId"],
                "archiveGeneration": locator["archiveGeneration"],
            },
        )
        self.assertEqual(stat.S_IMODE(index.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(index.parent.stat().st_mode), 0o700)

    def test_resume_refuses_a_session_index_it_cannot_trust(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        self.assertEqual(self.run_bridge("remove", self.session_input("SessionEnd")).returncode, 0)
        index = self.plugin_data / "sessions" / f"{self.session_id}.json"
        index.chmod(0o644)

        resume_start = self.session_input("SessionStart")
        resume_start["source"] = "resume"
        refused = self.run_bridge("publish", resume_start, via_child=True)

        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(json.loads(refused.stderr), {"category": "session-index-untrusted"})
        self.assertEqual(self.locators_of(self.session_id), [])

    def test_resume_while_a_live_process_holds_the_run_begins_a_new_run(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        holder = self.locator
        holder_payload = json.loads(holder.read_text())
        index = self.plugin_data / "sessions" / f"{self.session_id}.json"
        indexed = index.read_text()

        resume_start = self.session_input("SessionStart")
        resume_start["source"] = "resume"
        resumed = self.run_bridge("publish", resume_start, via_child=True)

        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(json.loads(holder.read_text()), holder_payload)
        others = [path for path in self.locators_of(self.session_id) if path != holder]
        self.assertEqual(len(others), 1)
        current = json.loads(others[0].read_text())
        self.assertNotEqual(current["hostPid"], holder_payload["hostPid"])
        self.assertNotEqual(current["runId"], holder_payload["runId"])
        # The session still belongs to the Run that holds it.
        self.assertEqual(index.read_text(), indexed)

    def test_a_child_that_inherits_the_run_environment_gets_its_own_run(self) -> None:
        published = self.run_bridge("publish", self.session_input("SessionStart"))
        self.assertEqual(published.returncode, 0, published.stderr)
        parent_locator = self.locator
        parent_payload = json.loads(parent_locator.read_text())
        # Whatever the parent exported travels with the child; none of it may
        # stand in for the child's own process generation.
        self.environment = {
            **self.environment,
            "PROMPT_TRAIL_RUN_ID": parent_payload["runId"],
            "PROMPT_TRAIL_SESSION_ID": parent_payload["sessionId"],
            "CLAUDE_CODE_SESSION_ID": parent_payload["sessionId"],
        }

        self.session_id = str(uuid.uuid4())
        clear_start = self.session_input("SessionStart")
        clear_start["source"] = "clear"
        refused = self.run_bridge("publish", clear_start, via_child=True)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(
            json.loads(refused.stderr),
            {"category": "locator-predecessor-missing"},
        )
        self.assertTrue(parent_locator.exists())

        for source in ("fork", "resume", "startup"):
            self.session_id = str(uuid.uuid4())
            start = self.session_input("SessionStart")
            start["source"] = source
            child = self.run_bridge("publish", start, via_child=True)
            self.assertEqual(child.returncode, 0, child.stderr)
            child_payload = json.loads(self.locator.read_text())
            self.assertNotEqual(child_payload["runId"], parent_payload["runId"], source)
            self.assertNotEqual(child_payload["hostPid"], parent_payload["hostPid"], source)
        self.assertTrue(parent_locator.exists())


if __name__ == "__main__":
    unittest.main()
