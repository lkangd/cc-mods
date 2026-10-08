#!/usr/bin/env python3
import json
import pathlib
import sqlite3
import sys


def fail(category: str) -> None:
    print(json.dumps({"status": "error", "category": category}))
    raise SystemExit(1)


def pending_row(event_id: str, expected: dict) -> tuple:
    return (
        event_id,
        expected["runId"],
        expected["segmentId"],
        expected["branchId"],
        expected.get("parentEventId"),
        expected["occurredAtMs"],
        expected["attachmentCount"],
        expected["attachmentKinds"],
        expected["promptText"],
    )


def boundary_row(event_id: str, sequence: int, expected: dict) -> tuple:
    return (
        event_id,
        sequence,
        expected["kind"],
        expected["runId"],
        expected["segmentId"],
        expected["branchId"],
        expected["occurredAtMs"],
    )


def entry_row(event_id: str, sequence: int, expected: dict) -> tuple:
    return (
        event_id,
        sequence,
        expected["runId"],
        expected["segmentId"],
        expected["branchId"],
        expected.get("parentEventId"),
        expected["occurredAtMs"],
        "composer",
        expected["attachmentCount"],
        expected["attachmentKinds"],
        expected["promptText"],
    )


def read_archive(database_path: pathlib.Path) -> tuple[list, list, list, list]:
    database = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
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
        boundaries = database.execute(
            "SELECT event_id, sequence, kind, run_id, segment_id, branch_id, "
            "occurred_at_ms FROM timeline_events ORDER BY sequence"
        ).fetchall()
    finally:
        database.close()
    return metadata, pending, entries, boundaries


def describe(database_path: pathlib.Path) -> dict:
    """The archive's Timeline Events by meaning, for acceptance runs that watch
    a real host. Holds prompt text: keep it in memory, never print it."""
    _, pending, entries, boundaries = read_archive(database_path)
    return {
        "pending": [
            {
                "eventId": row[0], "runId": row[1], "segmentId": row[2], "branchId": row[3],
                "parentEventId": row[4], "attachmentCount": row[6],
                "attachmentKinds": row[7], "promptText": row[8],
            }
            for row in pending
        ],
        "entries": [
            {
                "eventId": row[0], "sequence": row[1], "runId": row[2], "segmentId": row[3],
                "branchId": row[4], "parentEventId": row[5], "source": row[7],
                "attachmentCount": row[8], "attachmentKinds": row[9], "promptText": row[10],
            }
            for row in entries
        ],
        "boundaries": [
            {
                "eventId": row[0], "sequence": row[1], "kind": row[2], "runId": row[3],
                "segmentId": row[4], "branchId": row[5],
            }
            for row in boundaries
        ],
    }


def main() -> None:
    try:
        request = json.load(sys.stdin)
        database_path = pathlib.Path(request["database"])
        project_id = request["projectId"]
        expected_state = request["state"]
        if expected_state == "set":
            event_id = None
            expected = None
            expected_pending_input = request["pending"]
            expected_entries_input = request["entries"]
            # Prompt Entries and non-prompt Timeline Events share one sequence,
            # so naming any boundary makes every sequence explicit.
            expected_boundaries_input = request.get("boundaries")
            explicit_sequences = expected_boundaries_input is not None
            if expected_boundaries_input is None:
                expected_boundaries_input = []
            if not isinstance(expected_pending_input, list):
                raise TypeError
            if not isinstance(expected_entries_input, list):
                raise TypeError
            if not isinstance(expected_boundaries_input, list):
                raise TypeError
        else:
            event_id = request["eventId"]
            expected = request["expected"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        fail("invalid-request")

    try:
        metadata, pending, entries, boundaries = read_archive(database_path)
    except sqlite3.Error:
        fail("archive-unreadable")

    if expected_state == "set":
        # An explicit ordered set: every archived row must be named once, so a
        # missing, an extra and a duplicated confirmation each fail.
        try:
            expected_pending = sorted(
                pending_row(item["eventId"], item) for item in expected_pending_input
            )
            expected_entries = [
                entry_row(
                    item["eventId"],
                    item["sequence"] if explicit_sequences else index + 1,
                    item,
                )
                for index, item in enumerate(expected_entries_input)
            ]
            expected_boundaries = [
                boundary_row(item["eventId"], item["sequence"], item)
                for item in expected_boundaries_input
            ]
        except (KeyError, TypeError):
            fail("invalid-request")
        expected_metadata = [
            (project_id, 1, len(expected_entries) + len(expected_boundaries))
        ]
    elif expected_state == "pending":
        expected_metadata = [(project_id, 1, 0)]
        expected_pending = [pending_row(event_id, expected)]
        expected_entries = []
        expected_boundaries = []
    elif expected_state == "confirmed":
        expected_metadata = [(project_id, 1, 1)]
        expected_pending = []
        expected_entries = [entry_row(event_id, 1, expected)]
        expected_boundaries = []
    else:
        fail("invalid-state")

    distinct_entry_ids = {row[0] for row in entries}
    sequences = [row[1] for row in entries] + [row[1] for row in boundaries]
    # One event identity space: no id may name a staged capture, a Prompt Entry
    # and a boundary at once, or a retry would address the wrong record.
    all_ids = (
        [row[0] for row in entries]
        + [row[0] for row in boundaries]
        + [row[0] for row in pending]
    )
    checks = {
        "projectIdentity": metadata == expected_metadata,
        "pendingSet": pending == expected_pending,
        "promptEntrySet": entries == expected_entries,
        "boundarySet": boundaries == expected_boundaries,
        "promptEntriesDistinct": len(distinct_entry_ids) == len(entries),
        "eventIdsDistinct": len(set(all_ids)) == len(all_ids),
        # One shared allocator: every archived event holds a distinct sequence.
        "sequencesDistinct": len(set(sequences)) == len(sequences),
        "pendingCount": len(pending),
        "promptEntryCount": len(entries),
        "boundaryCount": len(boundaries),
    }
    required = (
        "projectIdentity",
        "pendingSet",
        "promptEntrySet",
        "boundarySet",
        "promptEntriesDistinct",
        "eventIdsDistinct",
        "sequencesDistinct",
    )
    print(json.dumps({
        "status": "verified" if all(checks[name] for name in required) else "mismatch",
        "checks": checks,
    }))
    if any(not checks[name] for name in required):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
