#!/usr/bin/env python3
"""Drive the throwaway SQLite helper through the ticket's hard cases."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
HELPER = ROOT / "plugin/bin/prompt-trail-sqlite-probe"
REPORT = ROOT / "scenario-report.json"
TIMESTAMP = "2026-09-17T00:00:00.000Z"


def run(*args: str | Path, stdin: str = "", env: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [str(HELPER), *(str(arg) for arg in args)],
        input=stdin,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(f"helper failed ({result.returncode}): {result.stderr.strip()}")
    return result


def append(db: Path, root: Path, event: str, run_id: str, text: str) -> dict[str, Any]:
    result = run(
        "append",
        db,
        root,
        event,
        run_id,
        "segment",
        "branch",
        "-",
        "prompt",
        TIMESTAMP,
        "--stdin",
        stdin=text,
    )
    return json.loads(result.stdout)


def inspect(db: Path, root: Path) -> dict[str, Any]:
    return json.loads(run("inspect", db, root).stdout)


def read_range(db: Path, root: Path, after: int = 0, limit: int = 10_000) -> list[dict[str, Any]]:
    output = run("range", db, root, str(after), str(limit)).stdout
    return [json.loads(line) for line in output.splitlines() if line]


def fnv_id(prefix: str, value: str) -> str:
    number = 14695981039346656037
    for byte in value.encode():
        number ^= byte
        number = (number * 1099511628211) & ((1 << 64) - 1)
    return f"{prefix}-{number:016x}"


def contains_bytes(base: Path, marker: bytes) -> bool:
    return any(
        candidate.exists() and marker in candidate.read_bytes()
        for candidate in (base, Path(f"{base}-wal"), Path(f"{base}-shm"))
    )


def mode(path: Path) -> str:
    return oct(stat.S_IMODE(path.stat().st_mode))


def create_git_worktrees(base: Path) -> tuple[Path, Path, Path, Path]:
    main = base / "main"
    worktree = base / "worktree"
    link = base / "main-link"
    main.mkdir()
    subprocess.run(["git", "init", "-q", main], check=True)
    subprocess.run(["git", "-C", main, "config", "user.name", "Prompt Trail Probe"], check=True)
    subprocess.run(["git", "-C", main, "config", "user.email", "probe@example.invalid"], check=True)
    (main / "fixture.txt").write_text("fixture\n")
    subprocess.run(["git", "-C", main, "add", "fixture.txt"], check=True)
    subprocess.run(["git", "-C", main, "commit", "-qm", "fixture"], check=True)
    subprocess.run(["git", "-C", main, "worktree", "add", "-qb", "probe-worktree", worktree], check=True)
    link.symlink_to(main, target_is_directory=True)
    subdir = main / "nested"
    subdir.mkdir()
    resolved_from_subdir = Path(
        subprocess.run(
            ["git", "-C", subdir, "rev-parse", "--show-toplevel"],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()
    )
    return main, worktree, link, resolved_from_subdir


def make_v1_database(db: Path, root: Path) -> None:
    canonical = str(root.resolve())
    project_id = fnv_id("p", canonical)
    db.parent.mkdir(parents=True)
    connection = sqlite3.connect(db)
    connection.executescript(
        """
        CREATE TABLE projects(
          project_id TEXT PRIMARY KEY,
          canonical_root TEXT NOT NULL UNIQUE,
          next_sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE events(
          event_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          run_id TEXT NOT NULL,
          segment_id TEXT NOT NULL,
          branch_id TEXT NOT NULL,
          parent_event_id TEXT,
          kind TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          prompt_text TEXT,
          UNIQUE(project_id, sequence)
        );
        CREATE INDEX events_project_sequence ON events(project_id, sequence);
        CREATE INDEX events_project_run ON events(project_id, run_id, sequence);
        PRAGMA user_version=1;
        """
    )
    connection.execute(
        "INSERT INTO projects(project_id, canonical_root, next_sequence) VALUES(?, ?, 1)",
        (project_id, canonical),
    )
    connection.execute(
        """INSERT INTO events(
             event_id, project_id, sequence, run_id, segment_id, branch_id,
             parent_event_id, kind, occurred_at, prompt_text
           ) VALUES('legacy-event', ?, 1, 'legacy-run', 'segment', 'branch',
                    NULL, 'prompt', ?, 'LEGACY-PROMPT')""",
        (project_id, TIMESTAMP),
    )
    connection.commit()
    connection.close()


def main() -> None:
    if not HELPER.exists():
        raise SystemExit("Run ./build.sh first")

    checks: dict[str, Any] = {}
    with tempfile.TemporaryDirectory(prefix="prompt-trail-sqlite-probe-") as temporary:
        base = Path(temporary)
        main_root, worktree_root, symlink_root, root_from_subdir = create_git_worktrees(base)
        db = base / "archive/prompt-trail.sqlite"

        first = append(db, main_root, "event-a", "run-main", "DUPLICATE-PROMPT")
        second = append(db, symlink_root, "event-b", "run-main", "DUPLICATE-PROMPT")
        from_subdir = append(db, root_from_subdir, "event-c", "run-main", "SUBDIR")
        other_worktree = append(db, worktree_root, "event-w", "run-worktree", "WORKTREE")
        duplicate = append(db, main_root, "event-a", "run-main", "DUPLICATE-PROMPT")
        checks["project_identity"] = {
            "symlink_collapses": first["projectId"] == second["projectId"],
            "subdirectory_git_root_collapses": first["projectId"] == from_subdir["projectId"],
            "worktree_isolated": first["projectId"] != other_worktree["projectId"],
            "moved_root_policy": "canonical absolute root changes identity",
        }
        checks["idempotency"] = {
            "same_event_returns_same_sequence": duplicate["sequence"] == first["sequence"],
            "duplicate_flag": duplicate["duplicate"],
            "repeated_text_remains_distinct": first["sequence"] != second["sequence"],
        }

        before_concurrency = inspect(db, main_root)["maxSequence"]
        processes: list[subprocess.Popen[str]] = []
        for index in range(24):
            processes.append(
                subprocess.Popen(
                    [
                        str(HELPER), "append", str(db), str(main_root),
                        f"concurrent-{index}", f"run-{index % 3}", "segment", "branch",
                        "-", "prompt", TIMESTAMP, "--stdin",
                    ],
                    text=True,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
            )
        concurrent_rows: list[dict[str, Any]] = []
        concurrent_errors: list[str] = []
        for index, process in enumerate(processes):
            stdout, stderr = process.communicate(f"CONCURRENT-{index}")
            if process.returncode == 0:
                concurrent_rows.append(json.loads(stdout))
            else:
                concurrent_errors.append(stderr.strip())
        concurrent_sequences = sorted(row["sequence"] for row in concurrent_rows)
        expected_sequences = list(range(before_concurrency + 1, before_concurrency + 25))
        checks["concurrency"] = {
            "writers": 24,
            "errors": concurrent_errors,
            "all_committed": len(concurrent_rows) == 24,
            "project_sequences_contiguous": concurrent_sequences == expected_sequences,
        }

        window = read_range(db, main_root, after=2, limit=5)
        checks["incremental_range"] = {
            "requested_after": 2,
            "requested_limit": 5,
            "sequences": [row["sequence"] for row in window],
            "ordered_and_bounded": [row["sequence"] for row in window] == [3, 4, 5, 6, 7],
        }

        before_crash = inspect(db, main_root)
        crash_marker = "UNCOMMITTED-CRASH-MARKER"
        crash = run("crash", db, main_root, "crash-event", crash_marker, check=False)
        after_crash = inspect(db, main_root)
        checks["crash_recovery"] = {
            "exit_code": crash.returncode,
            "expected_forced_exit": crash.returncode == 86,
            "count_unchanged": after_crash["count"] == before_crash["count"],
            "sequence_unchanged": after_crash["maxSequence"] == before_crash["maxSequence"],
            "marker_absent": all(crash_marker not in (row["promptText"] or "") for row in read_range(db, main_root)),
            "integrity": after_crash["integrity"],
        }

        legacy_db = base / "legacy/prompt-trail.sqlite"
        make_v1_database(legacy_db, main_root)
        migrated = inspect(legacy_db, main_root)
        connection = sqlite3.connect(legacy_db)
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        columns = [row[1] for row in connection.execute("PRAGMA table_info(events)")]
        legacy_row = connection.execute(
            "SELECT prompt_text, text_hash FROM events WHERE event_id='legacy-event'"
        ).fetchone()
        connection.close()
        checks["migration"] = {
            "version": version,
            "text_hash_column_added": "text_hash" in columns,
            "legacy_prompt_preserved": legacy_row == ("LEGACY-PROMPT", ""),
            "integrity": migrated["integrity"],
        }

        delete_db = base / "delete/prompt-trail.sqlite"
        run_marker = b"RUN-DELETE-MARKER-7f0af2"
        project_marker = b"PROJECT-DELETE-MARKER-8c1be3"
        append(delete_db, main_root, "delete-run-event", "delete-me", run_marker.decode())
        append(delete_db, main_root, "keep-event", "keep-me", project_marker.decode())
        before_run_delete = {
            "run_marker_present": contains_bytes(delete_db, run_marker),
            "project_marker_present": contains_bytes(delete_db, project_marker),
        }
        deleted_run = json.loads(run("delete-run", delete_db, main_root, "delete-me").stdout)
        after_run_delete = {
            "run_marker_absent": not contains_bytes(delete_db, run_marker),
            "project_marker_present": contains_bytes(delete_db, project_marker),
        }
        deleted_project = json.loads(run("delete-project", delete_db, main_root).stdout)
        after_project_delete = {
            "project_marker_absent": not contains_bytes(delete_db, project_marker),
            "remaining_events": inspect(delete_db, main_root)["count"],
        }
        checks["physical_delete"] = {
            "before": before_run_delete,
            "delete_run": deleted_run,
            "after_run": after_run_delete,
            "delete_project": deleted_project,
            "after_project": after_project_delete,
        }

        bridge_home = base / "bridge-home"
        bridge_home.mkdir()
        bridge_data = base / "bridge-data/prompt-trail.sqlite"
        bridge_env = os.environ.copy()
        bridge_env["HOME"] = str(bridge_home)
        bridge = json.loads(
            run("bridge-publish", bridge_data, HELPER, env=bridge_env).stdout
        )
        locator = Path(bridge["locator"])
        locator_data = json.loads(locator.read_text())
        checks["command_hook_bridge"] = {
            "locator": str(locator.relative_to(bridge_home)),
            "locator_mode": mode(locator),
            "locator_directory_mode": mode(locator.parent),
            "database_directory_mode": mode(bridge_data.parent),
            "helper_is_absolute": Path(locator_data["helper"]).is_absolute(),
            "database_is_absolute": Path(locator_data["database"]).is_absolute(),
        }

        checks["archive_permissions"] = {
            "directory": mode(db.parent),
            "database": mode(db),
        }

    file_description = subprocess.run(
        ["file", str(HELPER)], text=True, capture_output=True, check=True
    ).stdout.strip()
    linkage = subprocess.run(
        ["otool", "-L", str(HELPER)], text=True, capture_output=True, check=True
    ).stdout.splitlines()[1:]
    checks["packaging"] = {
        "binary": file_description,
        "linkage": [line.strip() for line in linkage],
        "prototype_scope": "host-specific macOS binary; production requires per-platform builds",
    }

    failures: list[str] = []
    required_true = {
        "project_identity.symlink_collapses": checks["project_identity"]["symlink_collapses"],
        "project_identity.subdirectory_git_root_collapses": checks["project_identity"]["subdirectory_git_root_collapses"],
        "project_identity.worktree_isolated": checks["project_identity"]["worktree_isolated"],
        "idempotency.same_event_returns_same_sequence": checks["idempotency"]["same_event_returns_same_sequence"],
        "idempotency.repeated_text_remains_distinct": checks["idempotency"]["repeated_text_remains_distinct"],
        "concurrency.all_committed": checks["concurrency"]["all_committed"],
        "concurrency.project_sequences_contiguous": checks["concurrency"]["project_sequences_contiguous"],
        "incremental_range.ordered_and_bounded": checks["incremental_range"]["ordered_and_bounded"],
        "crash_recovery.expected_forced_exit": checks["crash_recovery"]["expected_forced_exit"],
        "crash_recovery.count_unchanged": checks["crash_recovery"]["count_unchanged"],
        "crash_recovery.sequence_unchanged": checks["crash_recovery"]["sequence_unchanged"],
        "crash_recovery.marker_absent": checks["crash_recovery"]["marker_absent"],
        "migration.text_hash_column_added": checks["migration"]["text_hash_column_added"],
        "migration.legacy_prompt_preserved": checks["migration"]["legacy_prompt_preserved"],
        "physical_delete.run_marker_absent": checks["physical_delete"]["after_run"]["run_marker_absent"],
        "physical_delete.project_marker_absent": checks["physical_delete"]["after_project"]["project_marker_absent"],
    }
    failures.extend(name for name, passed in required_true.items() if not passed)
    report = {
        "prototype": "Prompt Trail SQLite helper",
        "target": "Claude Code 2.1.273 on macOS arm64",
        "result": "pass" if not failures else "fail",
        "failures": failures,
        "checks": checks,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
