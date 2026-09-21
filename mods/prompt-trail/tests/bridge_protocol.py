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
    def locator(self) -> pathlib.Path:
        return (
            self.home
            / ".claude/plugins/data/.function-hook-locators/prompt-trail"
            / f"{self.session_id}.json"
        )

    def run_bridge(
        self,
        operation: str,
        hook_input: dict[str, object],
        *,
        plugin_root: pathlib.Path = ROOT,
        helper: pathlib.Path = HELPER,
        manifest: pathlib.Path = MANIFEST,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
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
        stale_locator = active_locator.parent / f"{stale_session}.json"
        stale_payload = {
            **template,
            "sessionId": stale_session,
            "hostPid": 2_147_483_647,
            "hostStartSeconds": 1,
            "hostStartMicroseconds": 1,
        }
        stale_locator.write_text(json.dumps(stale_payload) + "\n")
        stale_locator.chmod(0o600)

        unsafe_session = str(uuid.uuid4())
        unsafe_locator = active_locator.parent / f"{unsafe_session}.json"
        unsafe_locator.write_text(json.dumps({**stale_payload, "sessionId": unsafe_session}) + "\n")
        unsafe_locator.chmod(0o644)

        self.session_id = str(uuid.uuid4())
        next_run = self.run_bridge("publish", self.session_input("SessionStart"))

        self.assertEqual(next_run.returncode, 0, next_run.stderr)
        self.assertFalse(stale_locator.exists())
        self.assertTrue(unsafe_locator.exists())
        self.assertTrue((active_locator.parent / f"{active_session}.json").exists())
        self.assertTrue(self.locator.exists())


if __name__ == "__main__":
    unittest.main()
