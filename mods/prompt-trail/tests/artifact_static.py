#!/usr/bin/env python3
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = ROOT / "bin" / "prompt-trail-helper"
BRIDGE = ROOT / "bin" / "prompt-trail-bridge"
MANIFEST = ROOT / "artifacts" / "helper-manifest.json"
ARTIFACT_TS = ROOT / "hooks" / "artifact.ts"
REGISTER_TS = ROOT / "hooks" / "register.tsx"
ARTIFACT_HEADER = ROOT / "src" / "prompt_trail_generated_artifact.h"
HELPER_SOURCE = ROOT / "src" / "prompt_trail_helper.c"
BRIDGE_SOURCE = ROOT / "src" / "prompt_trail_bridge.c"
COMMON_SOURCE = ROOT / "src" / "prompt_trail_common.c"


def command(*argv: str) -> str:
    result = subprocess.run(argv, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise AssertionError(f"{argv[0]} failed ({result.returncode}): {result.stderr}")
    return result.stdout


def dependencies(path: pathlib.Path) -> set[str]:
    rows = command("/usr/bin/otool", "-L", str(path)).splitlines()[1:]
    return {row.strip().split(" ", 1)[0] for row in rows if row.strip()}


class StaticArtifactTests(unittest.TestCase):
    def test_native_artifacts_are_manifest_bound(self) -> None:
        manifest = json.loads(MANIFEST.read_text())
        helper_digest = hashlib.sha256(HELPER.read_bytes()).hexdigest()
        bridge_digest = hashlib.sha256(BRIDGE.read_bytes()).hexdigest()

        self.assertEqual(manifest["formatVersion"], 1)
        self.assertEqual(manifest["target"], "darwin-arm64-macos15")
        self.assertEqual(manifest["file"], "bin/prompt-trail-helper")
        self.assertEqual(manifest["sha256"], helper_digest)
        self.assertEqual(manifest["bridgeFile"], "bin/prompt-trail-bridge")
        self.assertEqual(manifest["bridgeSha256"], bridge_digest)
        self.assertEqual(manifest["helperProtocol"], 1)
        self.assertEqual(
            (manifest["schemaReadMin"], manifest["schemaReadMax"]),
            (1, 2),
        )
        self.assertEqual(
            (manifest["schemaWriteMin"], manifest["schemaWriteMax"]),
            (2, 2),
        )
        self.assertEqual(manifest["schemaMigrations"], ["1->2"])
        self.assertEqual(manifest["sqliteMinimumVersionNumber"], 3_035_000)
        self.assertEqual(manifest["sqliteRequiredCapability"], "UPDATE RETURNING")
        self.assertEqual(
            set(manifest["allowedDynamicDependencies"]),
            {"/usr/lib/libSystem.B.dylib", "/usr/lib/libsqlite3.dylib"},
        )
        self.assertIn(
            f"EXPECTED_HELPER_SHA256 = '{helper_digest}'",
            ARTIFACT_TS.read_text(),
        )
        self.assertIn("HELPER_PROTOCOL = 1", ARTIFACT_TS.read_text())
        self.assertIn(
            f'PT_EXPECTED_HELPER_SHA256 "{helper_digest}"',
            ARTIFACT_HEADER.read_text(),
        )
        self.assertIn("PT_HELPER_PROTOCOL 1", ARTIFACT_HEADER.read_text())

    def test_manifest_records_build_provenance(self) -> None:
        manifest = json.loads(MANIFEST.read_text())

        self.assertRegex(manifest["compiler"], r"^Apple clang version ")
        self.assertRegex(manifest["sdkVersion"], r"^\d+\.\d+$")
        self.assertEqual(manifest["linker"], "ld64 through Apple clang")
        expected_inputs = {
            "source": ("src/prompt_trail_helper.c", "sourceSha256"),
            "bridgeSource": ("src/prompt_trail_bridge.c", "bridgeSourceSha256"),
            "commonSource": ("src/prompt_trail_common.c", "commonSourceSha256"),
            "generatedHeader": (
                "src/prompt_trail_generated_artifact.h",
                "generatedHeaderSha256",
            ),
            "buildCommand": ("scripts/build-artifacts.sh", "buildScriptSha256"),
        }
        for field, (expected_path, digest_field) in expected_inputs.items():
            self.assertEqual(manifest[field], expected_path)
            path = pathlib.PurePosixPath(manifest[field])
            self.assertFalse(path.is_absolute())
            self.assertNotIn("..", path.parts)
            source = ROOT / path
            self.assertTrue(source.exists())
            self.assertEqual(
                manifest[digest_field],
                hashlib.sha256(source.read_bytes()).hexdigest(),
            )

    def test_hook_accepts_every_native_helper_error_category(self) -> None:
        source = HELPER_SOURCE.read_text()
        helper_categories = set(
            re.findall(r'json_error\([^,]+, "([^"]+)"', source)
        ) | set(re.findall(r'archive_error\("([^"]+)"', source))
        register = REGISTER_TS.read_text()
        safe_block = re.search(
            r"const SAFE_ERROR_CATEGORIES = new Set\(\[(.*?)\]\)",
            register,
            re.DOTALL,
        )
        self.assertIsNotNone(safe_block)
        safe_categories = set(re.findall(r"'([^']+)'", safe_block.group(1)))
        self.assertEqual(helper_categories - safe_categories, set())

    def test_every_classic_session_end_reaches_the_lifecycle_state_machine(self) -> None:
        # The test engine cannot raise classic events, so the plugin tests
        # replay the state machine alone. This guards the one link they cannot
        # see: a reason filter in the hook would silently drop Run ends, as the
        # Issue 17 PTY acceptance found when only `clear` was forwarded.
        register = REGISTER_TS.read_text()
        handler = re.search(
            r"on\('classic\.SessionEnd', async \(\$, e, next\) => \{(.*?)\n  \}\)",
            register,
            re.DOTALL,
        )
        self.assertIsNotNone(handler)
        body = handler.group(1)
        self.assertIn("await applyLifecycle($, {", body)
        self.assertIn("reason: e.reason,", body)
        self.assertNotIn("e.reason ===", body)
        self.assertNotIn("e.reason !==", body)

    def test_startup_runtime_has_no_forbidden_side_effect_surface(self) -> None:
        hook_executables = set(
            re.findall(r"'(/(?:usr|bin)/[^']+)'", REGISTER_TS.read_text())
        )
        self.assertEqual(
            hook_executables,
            {
                "/bin/ls",
                "/bin/realpath",
                "/usr/bin/git",
                "/usr/bin/id",
                "/usr/bin/shasum",
                "/usr/bin/stat",
                "/usr/bin/sw_vers",
                "/usr/bin/uname",
            },
        )
        for executable in hook_executables:
            self.assertTrue(pathlib.Path(executable).is_file(), executable)
            self.assertTrue(os.access(executable, os.X_OK), executable)

        forbidden_symbols = {
            "_connect",
            "_execv",
            "_execve",
            "_fork",
            "_getaddrinfo",
            "_removexattr",
            "_send",
            "_setxattr",
            "_socket",
            "_system",
        }
        for artifact in (HELPER, BRIDGE):
            imports = {
                row.strip().split()[-1]
                for row in command("/usr/bin/nm", "-u", str(artifact)).splitlines()
                if row.strip()
            }
            self.assertEqual(imports & forbidden_symbols, set())

        runtime_source = "\n".join(
            path.read_text()
            for path in (REGISTER_TS, HELPER_SOURCE, BRIDGE_SOURCE, COMMON_SOURCE)
        )
        for forbidden in (
            "build-artifacts.sh",
            "/usr/bin/curl",
            "/usr/bin/wget",
            "memory fallback",
            "removexattr(",
            "setxattr(",
            "xcrun",
        ):
            self.assertNotIn(forbidden, runtime_source)

    def test_host_version_parser_accepts_only_release_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = pathlib.Path(temporary) / "version_parser_test.c"
            executable = pathlib.Path(temporary) / "version_parser_test"
            source.write_text(
                f'''#include {json.dumps(str(COMMON_SOURCE))}

int main(void) {{
  char version[64];
  if (!first_semantic_version("2.1.278 (Claude Code)\\n", version, sizeof(version))
      || strcmp(version, "2.1.278") != 0) return 1;
  if (!first_semantic_version("2.1.278\\n", version, sizeof(version))) return 2;
  if (first_semantic_version("2.1.278-beta.1 (Claude Code)\\n", version, sizeof(version))) return 3;
  if (first_semantic_version("2.1.278 beta (Claude Code)\\n", version, sizeof(version))) return 4;
  if (first_semantic_version("2.1.278 (Claude Code) beta\\n", version, sizeof(version))) return 5;
  if (first_semantic_version("Python 3.14.0\\n", version, sizeof(version))) return 6;
  if (first_semantic_version("2.1\\n", version, sizeof(version))) return 7;
  if (first_semantic_version("2\\n", version, sizeof(version))) return 8;
  return 0;
}}
'''
            )
            compiler = command(
                "/usr/bin/xcrun", "--sdk", "macosx", "--find", "clang"
            ).strip()
            sdk = command(
                "/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"
            ).strip()
            command(
                compiler,
                "-std=c17",
                "-arch",
                "arm64",
                "-isysroot",
                sdk,
                "-mmacosx-version-min=15.0",
                str(source),
                "-o",
                str(executable),
            )
            command(str(executable))

    def test_native_artifacts_are_thin_arm64_pie_with_macos_15_floor(self) -> None:
        for artifact in (HELPER, BRIDGE):
            with self.subTest(artifact=artifact.name):
                status = artifact.lstat()
                self.assertTrue(stat.S_ISREG(status.st_mode))
                self.assertEqual(status.st_uid, os.geteuid())
                self.assertNotEqual(stat.S_IMODE(status.st_mode) & 0o111, 0)
                self.assertEqual(stat.S_IMODE(status.st_mode) & 0o022, 0)
                self.assertEqual(
                    command("/usr/bin/file", str(artifact)).strip().split(": ", 1)[1],
                    "Mach-O 64-bit executable arm64",
                )
                self.assertEqual(
                    command("/usr/bin/lipo", "-archs", str(artifact)).strip(),
                    "arm64",
                )
                header = command("/usr/bin/otool", "-hv", str(artifact))
                self.assertRegex(header, r"\bEXECUTE\b.*\bPIE\b")
                load_commands = command("/usr/bin/otool", "-l", str(artifact))
                self.assertRegex(
                    load_commands,
                    r"cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform 1\s+minos 15\.0\b",
                )

    def test_native_artifacts_link_only_allowed_system_libraries(self) -> None:
        manifest = json.loads(MANIFEST.read_text())
        self.assertEqual(
            dependencies(HELPER),
            set(manifest["allowedDynamicDependencies"]),
        )
        self.assertEqual(dependencies(BRIDGE), {"/usr/lib/libSystem.B.dylib"})


if __name__ == "__main__":
    unittest.main()
