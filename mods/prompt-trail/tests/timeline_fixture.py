#!/usr/bin/env python3
"""Test-only builder of a large Project Timeline.

Appending 100,000 events one helper call at a time would take far too long, so
this writes them straight into an archive the helper has already created, in
one transaction, continuing its sequence allocator. Like `semantic_verifier.py`
it knows the schema; production code never imports it.

The mix exercises every boundary the timeline draws: Run start/attach/detach,
Clear, Collection stop/resume, rewinds onto earlier entries, fresh roots and
forks whose first entry hangs off another Run. Integrity gaps have no event
kind yet (Issue 26), so none are written. Prompt text is synthetic.
"""
import argparse
import json
import pathlib
import random
import sqlite3
import uuid


def build(database: pathlib.Path, project_id: str, count: int, *, seed: int = 21) -> list[dict]:
    """Append `count` events; answers each one's identity, oldest first."""
    generator = random.Random(seed)
    connection = sqlite3.connect(database)
    events: list[dict] = []
    try:
        connection.execute("BEGIN IMMEDIATE")
        (sequence,) = connection.execute(
            "SELECT next_sequence FROM metadata WHERE project_id=?", (project_id,)
        ).fetchone()

        entries: list[dict] = []
        run: dict | None = None

        def next_id() -> str:
            return str(uuid.UUID(int=generator.getrandbits(128), version=4))

        def boundary(kind: str) -> None:
            nonlocal sequence
            sequence += 1
            event = {"eventId": next_id(), "sequence": sequence, "kind": kind,
                     "runId": run["runId"], "segmentId": run["segmentId"]}
            connection.execute(
                "INSERT INTO timeline_events(event_id, sequence, kind, run_id,"
                " segment_id, branch_id, occurred_at_ms) VALUES(?,?,?,?,?,?,?)",
                (event["eventId"], sequence, kind, run["runId"], run["segmentId"],
                 run["branchId"], 1795000000000 + sequence),
            )
            events.append(event)

        def prompt(parent: str | None) -> None:
            nonlocal sequence
            sequence += 1
            event = {"eventId": next_id(), "sequence": sequence, "kind": "prompt",
                     "runId": run["runId"], "segmentId": run["segmentId"],
                     "branchId": run["branchId"], "parentEventId": parent}
            connection.execute(
                "INSERT INTO prompt_entries(event_id, sequence, run_id, segment_id,"
                " branch_id, parent_event_id, occurred_at_ms, source,"
                " attachment_count, attachment_kinds, prompt_text)"
                " VALUES(?,?,?,?,?,?,?,'composer',0,'',?)",
                (event["eventId"], sequence, run["runId"], run["segmentId"],
                 run["branchId"], parent, 1795000000000 + sequence,
                 f"PT-FIXTURE {sequence} 继续"),
            )
            events.append(event)
            entries.append(event)
            run["tip"] = event["eventId"]

        def start_run(fork_from: str | None) -> None:
            nonlocal run
            run = {"runId": next_id(), "segmentId": next_id(), "branchId": next_id(),
                   "tip": fork_from}
            boundary("run-started")

        start_run(None)
        while len(events) < count:
            roll = generator.random()
            if roll < 0.80:
                prompt(run["tip"])
            elif roll < 0.84:
                boundary("clear")
                run["segmentId"] = next_id()
                run["branchId"] = next_id()
                run["tip"] = None
            elif roll < 0.87:
                # A rewind onto an earlier entry of this Run.
                own = [entry for entry in entries[-64:] if entry["runId"] == run["runId"]]
                if own:
                    run["branchId"] = next_id()
                    run["tip"] = generator.choice(own)["eventId"]
                prompt(run["tip"])
            elif roll < 0.89:
                boundary("collection-stopped")
                boundary("collection-resumed")
                run["branchId"] = next_id()
                run["tip"] = None
            elif roll < 0.93:
                boundary("run-detached")
                boundary("run-attached")
            elif roll < 0.96:
                boundary("run-detached")
                start_run(None)
            else:
                boundary("run-detached")
                start_run(entries[-1]["eventId"] if entries else None)
                prompt(run["tip"])
        del events[count:]
        sequence = events[-1]["sequence"]
        connection.execute("DELETE FROM prompt_entries WHERE sequence>?", (sequence,))
        connection.execute("DELETE FROM timeline_events WHERE sequence>?", (sequence,))
        connection.execute(
            "UPDATE metadata SET next_sequence=? WHERE project_id=?", (sequence, project_id)
        )
        connection.execute("COMMIT")
    finally:
        connection.close()
    return events


def chain(
    database: pathlib.Path,
    project_id: str,
    count: int,
    text: str,
    *,
    run_id: str,
    segment_id: str,
    branch_id: str,
) -> list[str]:
    """Append one lineage of `count` Prompt Entries all holding `text`;
    answers their event ids, root first."""
    connection = sqlite3.connect(database)
    event_ids: list[str] = []
    try:
        connection.execute("BEGIN IMMEDIATE")
        (sequence,) = connection.execute(
            "SELECT next_sequence FROM metadata WHERE project_id=?", (project_id,)
        ).fetchone()
        parent = None
        for _ in range(count):
            sequence += 1
            event_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO prompt_entries(event_id, sequence, run_id, segment_id,"
                " branch_id, parent_event_id, occurred_at_ms, source,"
                " attachment_count, attachment_kinds, prompt_text)"
                " VALUES(?,?,?,?,?,?,?,'composer',0,'',?)",
                (event_id, sequence, run_id, segment_id, branch_id, parent,
                 1795000000000 + sequence, text),
            )
            event_ids.append(event_id)
            parent = event_id
        connection.execute(
            "UPDATE metadata SET next_sequence=? WHERE project_id=?", (sequence, project_id)
        )
        connection.execute("COMMIT")
    finally:
        connection.close()
    return event_ids


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=pathlib.Path)
    parser.add_argument("project_id")
    parser.add_argument("count", type=int)
    arguments = parser.parse_args()
    events = build(arguments.database, arguments.project_id, arguments.count)
    # Identity only: the benchmark needs cursors and a tip, never text.
    print(json.dumps({
        "count": len(events),
        "first": events[0]["sequence"],
        "last": events[-1]["sequence"],
        "middle": events[len(events) // 2]["sequence"],
        "tip": next(e for e in reversed(events) if e["kind"] == "prompt")["eventId"],
        "runId": events[-1]["runId"],
    }))


if __name__ == "__main__":
    main()
