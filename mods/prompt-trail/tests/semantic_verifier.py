#!/usr/bin/env python3
import json
import pathlib
import sqlite3
import sys


def fail(category: str) -> None:
    print(json.dumps({"status": "error", "category": category}))
    raise SystemExit(1)


def main() -> None:
    try:
        request = json.load(sys.stdin)
        database_path = pathlib.Path(request["database"])
        project_id = request["projectId"]
        event_id = request["eventId"]
        expected_state = request["state"]
        expected = request["expected"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        fail("invalid-request")

    try:
        database = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
        metadata = database.execute(
            "SELECT project_id, policy_version, next_sequence FROM metadata"
        ).fetchall()
        pending = database.execute(
            "SELECT event_id, run_id, segment_id, branch_id, parent_event_id, "
            "occurred_at_ms, attachment_count, attachment_kinds, prompt_text "
            "FROM pending_captures ORDER BY event_id"
        ).fetchall()
        entries = database.execute(
            "SELECT event_id, sequence, run_id, segment_id, branch_id, "
            "parent_event_id, occurred_at_ms, source, attachment_count, "
            "attachment_kinds, prompt_text FROM prompt_entries ORDER BY sequence"
        ).fetchall()
    except sqlite3.Error:
        fail("archive-unreadable")
    finally:
        if "database" in locals():
            database.close()

    expected_metadata = [
        (project_id, 1, 0 if expected_state == "pending" else 1)
    ]
    expected_pending = []
    expected_entries = []
    if expected_state == "pending":
        expected_pending = [(
            event_id,
            expected["runId"],
            expected["segmentId"],
            expected["branchId"],
            expected.get("parentEventId"),
            expected["occurredAtMs"],
            expected["attachmentCount"],
            expected["attachmentKinds"],
            expected["promptText"],
        )]
    elif expected_state == "confirmed":
        expected_entries = [(
            event_id,
            1,
            expected["runId"],
            expected["segmentId"],
            expected["branchId"],
            expected.get("parentEventId"),
            expected["occurredAtMs"],
            "composer",
            expected["attachmentCount"],
            expected["attachmentKinds"],
            expected["promptText"],
        )]
    else:
        fail("invalid-state")

    checks = {
        "projectIdentity": metadata == expected_metadata,
        "pendingSet": pending == expected_pending,
        "promptEntrySet": entries == expected_entries,
        "pendingCount": len(pending),
        "promptEntryCount": len(entries),
    }
    print(json.dumps({
        "status": "verified" if all(
            value is True or isinstance(value, int)
            for value in checks.values()
        ) and all(
            checks[name]
            for name in ("projectIdentity", "pendingSet", "promptEntrySet")
        ) else "mismatch",
        "checks": checks,
    }))
    if any(not checks[name] for name in (
        "projectIdentity", "pendingSet", "promptEntrySet"
    )):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
