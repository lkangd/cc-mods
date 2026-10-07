"""The release gate: runs every gate and PTY scenario, then writes a report
that passes only with zero failed, missing, skipped or leaked.

Run through scripts/release-evidence.sh, which provides pyte."""
import argparse
import datetime
import importlib.metadata
import json
import os
import pathlib
import platform
import subprocess
import sys
import tempfile
import traceback

import evidence

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
MINIMUM_CLAUDE_VERSION = "2.1.290"
CURRENT_CLAUDE_VERSION = "2.1.290"
TYPESCRIPT_VERSION = "5.9.3"
TOKEN_SERVICE = "prompt-trail-release"
# The files scripts/build-artifacts.sh writes; verify-startup.sh reads the same list.
ARTIFACTS = (ROOT / "scripts/artifact-paths.txt").read_text().split()


class Run:
    def __init__(self, out: pathlib.Path, scanner: evidence.Scanner) -> None:
        self.out = out
        self.scanner = scanner
        self.results = evidence.Results()
        self.gates: list[dict] = []
        (out / "logs").mkdir(parents=True)

    def command(self, name: str, argv: list[str], **kwargs) -> subprocess.CompletedProcess:
        """Runs one gate step, keeping its output as a log beside the report."""
        print(f"· {name}", flush=True)
        completed = subprocess.run(argv, capture_output=True, text=True, **kwargs)
        log = f"logs/{name}.log"
        (self.out / log).write_text(
            f"$ {' '.join(argv)}\nexit {completed.returncode}\n\n"
            f"--- stdout\n{completed.stdout}\n--- stderr\n{completed.stderr}"
        )
        completed.log = log
        return completed

    def gate(self, name: str, passed: bool, link: str | None = None, detail: str | None = None) -> None:
        outcome = "pass" if passed else "fail"
        self.gates.append({"name": name, "outcome": outcome, "link": link, "detail": detail})
        self.results.record("gate", name, None, outcome, link=link)
        print(f"  {name}: {outcome}" + (f" ({detail})" if detail else ""), flush=True)


def artifact_digests() -> dict[str, str | None]:
    """Each artifact's digest; None for one that is missing or unreadable, so
    the gate fails with a report instead of the run stopping."""
    digests = {}
    for path in ARTIFACTS:
        output = subprocess.run(
            ["/usr/bin/shasum", "-a", "256", str(ROOT / path)], capture_output=True, text=True
        )
        digests[path] = output.stdout.split()[0] if output.returncode == 0 else None
    return digests


def run_gates(run: Run, versions: list[str]) -> dict:
    before = artifact_digests()
    built = run.command("build-artifacts", [str(ROOT / "scripts/build-artifacts.sh")])
    after = artifact_digests()
    missing = [path for path, digest in before.items() if digest is None]
    run.gate(
        "artifacts-reproducible", built.returncode == 0 and not missing and after == before,
        built.log,
        f"missing before the rebuild: {', '.join(missing)}" if missing
        else None if after == before else "rebuilt artifacts differ",
    )
    # An empty config directory, as verify-startup.sh uses: from 2.1.290 the
    # host refuses `plugin test` under a config whose saved rollout switch is
    # off, and the gate is not the person's config to depend on.
    host_config = tempfile.mkdtemp(prefix="prompt-trail-host-config.")
    host_env = dict(os.environ, CLAUDE_CONFIG_DIR=host_config)
    for version in versions:
        claude = ["npx", "-y", f"@anthropic-ai/claude-code@{version}"]
        validated = run.command(
            f"plugin-validate@{version}", claude + ["plugin", "validate", str(ROOT)], env=host_env,
        )
        run.results.record(
            "validate", "plugin-validate", version,
            "pass" if validated.returncode == 0 else "fail", link=validated.log,
        )
        run.gates.append({
            "name": f"plugin-validate@{version}", "link": validated.log, "detail": None,
            "outcome": "pass" if validated.returncode == 0 else "fail",
        })
        tested = run.command(
            f"plugin-tests@{version}", claude + ["plugin", "test", "."], cwd=ROOT, env=host_env,
        )
        parsed = evidence.parse_plugin_test_output(tested.stdout + "\n" + tested.stderr)
        for ref, outcome in parsed.items():
            run.results.record("plugin", ref, version, outcome, link=tested.log)
        failing = sum(1 for outcome in parsed.values() if outcome != "pass")
        run.gate(
            f"plugin-tests@{version}", tested.returncode == 0 and parsed and not failing,
            tested.log, f"{len(parsed)} tests, {failing} not passing",
        )
    typed = run.command(
        "typescript",
        ["npx", "-y", "-p", f"typescript@{TYPESCRIPT_VERSION}", "tsc", "-p", str(ROOT / "tsconfig.json")],
    )
    run.gate("typescript", typed.returncode == 0, typed.log)
    units = run.command(
        "unit-tests", [sys.executable, str(ROOT / "release/unit_runner.py")]
    )
    try:
        outcomes = json.loads(units.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        outcomes = {}
    for ref, outcome in outcomes.items():
        run.results.record("unit", ref, None, outcome, link=units.log)
    failing = sum(1 for outcome in outcomes.values() if outcome != "pass")
    run.gate(
        "unit-tests", units.returncode == 0 and outcomes and not failing,
        units.log, f"{len(outcomes)} tests, {failing} not passing",
    )
    helper = str(ROOT / "bin/prompt-trail-helper")
    probe = run.command("helper-probe", [helper, "probe", "--protocol", "1"])
    run.gate("helper-probe", probe.returncode == 0, probe.log)
    mismatch = run.command("protocol-mismatch-probe", [helper, "probe", "--protocol", "99"])
    run.gate(
        "protocol-mismatch-probe",
        mismatch.returncode != 0 and '"category":"protocol-mismatch"' in mismatch.stderr,
        mismatch.log,
    )
    benchmark = run.command("benchmark-100k", [str(ROOT / "scripts/benchmark-timeline.sh")])
    try:
        measured = json.loads(benchmark.stdout)
    except json.JSONDecodeError:
        measured = None
    run.gate("benchmark-100k", benchmark.returncode == 0 and measured is not None, benchmark.log)
    try:
        sqlite = json.loads(probe.stdout)["sqliteVersionNumber"]
    except (json.JSONDecodeError, KeyError):
        sqlite = None
    return {"benchmark": measured, "sqliteVersionNumber": sqlite}


def run_pty(run: Run, versions: list[str], selected: set[str] | None, token: str) -> dict:
    import pty_driver
    import pty_scenarios

    privacy = {"scannedFiles": 0, "allowedFiles": 0, "argvSamples": 0, "leaks": []}
    ids = [id_ for id_ in pty_scenarios.SCENARIOS if selected is None or id_ in selected]
    for version in versions:
        host = pty_driver.Host(version)
        for id_ in ids:
            print(f"· pty {id_}@{version}", flush=True)
            link = f"pty/{version}/{id_}.txt"
            outcome, actual = run_scenario(run, host, id_, token, privacy, link)
            if outcome == "fail" and evidence.network_failure((run.out / link).read_text()):
                # The host lost its connection to the API: run the whole
                # scenario once more in a fresh world, keeping the first trace.
                (run.out / link).rename(run.out / f"pty/{version}/{id_}.attempt-1.txt")
                print(f"  {actual}; host network error, running once more", flush=True)
                outcome, retried = run_scenario(run, host, id_, token, privacy, link)
                actual = f"retried after a host network error: {retried}"
            run.results.record("pty", id_, version, outcome, actual=actual, link=link)
            print(f"  {outcome}: {actual}", flush=True)
    return privacy


def run_scenario(
    run: Run, host, id_: str, token: str, privacy: dict, link: str,
) -> tuple[str, str]:
    """One scenario in its own world; its leaks and counts go into `privacy`,
    its masked trace to `link`."""
    import pty_driver
    import pty_scenarios

    env = pty_driver.Environment(host, run.scanner, token, ROOT)
    context = pty_scenarios.Context(env, run.scanner)
    try:
        actual = pty_scenarios.SCENARIOS[id_](context)
        outcome = "pass"
    except pty_driver.ScenarioFailure as failure:
        actual, outcome = f"failed: {failure}", "fail"
    except Exception:  # A broken scenario is a failed one, never a skipped one.
        actual = "failed: " + traceback.format_exc().strip().splitlines()[-1]
        outcome = "fail"
    found = env.finish()
    for key in ("scannedFiles", "allowedFiles", "argvSamples"):
        privacy[key] += found[key]
    privacy["leaks"] += [dict(leak, scenario=f"{id_}@{host.version}") for leak in found["leaks"]]
    (run.out / link).parent.mkdir(parents=True, exist_ok=True)
    (run.out / link).write_text("\n\n".join(env.trace) + "\n")
    return outcome, run.scanner.redact_rows([actual])[0]


def keychain_token() -> str:
    found = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-s", TOKEN_SERVICE, "-w"],
        capture_output=True, text=True,
    )
    if found.returncode != 0 or not found.stdout.strip():
        raise SystemExit(
            f"release-evidence: no token in the keychain item {TOKEN_SERVICE!r}; "
            f"store one from `claude setup-token` with "
            f"security add-generic-password -s {TOKEN_SERVICE} -a \"$USER\" -w"
        )
    return found.stdout.strip()


def output(*argv: str, cwd: pathlib.Path = REPO) -> str:
    return subprocess.run(argv, capture_output=True, text=True, cwd=cwd).stdout.strip()


def identity(commit: str, versions: list[str], facts: dict) -> dict:
    manifest = json.loads((ROOT / "artifacts/helper-manifest.json").read_text())
    return {
        "commit": commit,
        "pluginVersion": json.loads((ROOT / ".claude-plugin/plugin.json").read_text())["version"],
        "macOS": platform.mac_ver()[0],
        "architecture": platform.machine(),
        "machine": output("/usr/sbin/sysctl", "-n", "hw.model"),
        "claudeCodeVersions": ", ".join(versions),
        "minimumClaudeCode": MINIMUM_CLAUDE_VERSION,
        "surface": "interactive terminal (pseudo-terminal, pyte emulator)",
        "functionHooks": "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1",
        "helperSha256": manifest["sha256"],
        "bridgeSha256": manifest["bridgeSha256"],
        "sqliteVersionNumber": facts.get("sqliteVersionNumber"),
        "python": platform.python_version(),
        "pyte": importlib.metadata.version("pyte"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(prog="release-evidence")
    parser.add_argument("--only", help="comma-separated scenario IDs to run in PTY; the report is partial")
    parser.add_argument("--skip-gates", action="store_true", help="run no gates; the report is partial")
    parser.add_argument("--out", type=pathlib.Path)
    arguments = parser.parse_args()

    selected = set(arguments.only.split(",")) if arguments.only else None
    partial = selected is not None or arguments.skip_gates
    versions = list(dict.fromkeys([MINIMUM_CLAUDE_VERSION, CURRENT_CLAUDE_VERSION]))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = arguments.out or ROOT / "build/evidence" / stamp
    token = keychain_token()
    manifest = json.loads((ROOT / "release/scenarios.json").read_text())
    scanner = evidence.Scanner([], secrets=[token])
    run = Run(out, scanner)

    # The commit and whether the tree matched it are taken before anything runs,
    # so the report names the code that ran even if the tree moves meanwhile.
    commit = output("git", "rev-parse", "HEAD")
    tree_clean = not output("git", "status", "--porcelain")
    facts = {} if arguments.skip_gates else run_gates(run, versions)
    privacy = run_pty(run, versions, selected, token)
    leaks = privacy.pop("leaks")
    for path in sorted(out.rglob("*")):
        if path.is_file():
            leaks += [
                {"path": str(path.relative_to(out)), "kind": kind}
                for kind in scanner.find(path.read_bytes())
            ]
    run.gate("privacy-scan", not leaks, detail=f"{len(leaks)} leak(s)")

    report = evidence.judge_report(
        manifest, run.results, versions=versions, partial=partial,
        tree_clean=tree_clean, leaks=leaks, gates=run.gates,
    )
    report["identity"] = identity(commit, versions, facts)
    report["benchmark"] = facts.get("benchmark")
    report["privacy"] = dict(privacy, allowedRules=evidence.ALLOWED_RULES)
    rendered_json = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    rendered_markdown = evidence.render_markdown(report)
    if scanner.find(rendered_json.encode()) or scanner.find(rendered_markdown.encode()):
        raise SystemExit("release-evidence: the report itself would carry a marker or secret; not written")
    (out / "report.json").write_text(rendered_json)
    (out / "report.md").write_text(rendered_markdown)
    counts = report["counts"]
    print(
        f"\n{report['overall'].upper()}: {counts['pass']} pass, {counts['failed']} failed, "
        f"{counts['missing']} missing, {counts['skipped']} skipped, {len(leaks)} leaked\n"
        f"report: {out / 'report.md'}"
    )
    for reason in report["reasons"]:
        print(f"  - {reason}")
    raise SystemExit(0 if report["overall"] == "pass" else 1)


if __name__ == "__main__":
    main()
