---
id: pty-write-lock-duplicated
status: open
severity: minor
found: 2026-09-30
source: /code-review, round 1
target: Issues 39, 49–52 of Prompt Trail, 4b8cba4..b35695b
---

# Eight copies of the archive write-lock setup in the PTY scenarios

## Problem

`mods/prompt-trail/release/pty_scenarios.py` holds the archive's write lock with the same lines in
eight places (two from before Issue 39, six added by it, in `fault_tour`, the STORE and FAIL
scenarios): `sqlite3.connect(<archive>, timeout=0, isolation_level=None)`, `BEGIN IMMEDIATE`, then
`ROLLBACK` and `close()` in a `finally`. A change in how the lock is taken or released has to be
made in every copy.

## Why deferred

Minor cleanup. Each site holds the lock across different host steps, and reshaping them all means
rerunning every one of those PTY scenarios on both versions, which is out of proportion for this
review.

## Suggested fix approach

A small context manager, `write_lock(database)`, that opens the connection, begins the immediate
transaction, yields, and rolls back and closes. Each scenario keeps its own timing inside the
`with`. Done when all sites use it and the affected scenarios pass on 2.1.273 and 2.1.283.

## Recommended tools

`grep -n "BEGIN IMMEDIATE" mods/prompt-trail/release/pty_scenarios.py`; run with the scratch
`run45.py <version> <IDs>` recipe from the Issue 38 handoff.
