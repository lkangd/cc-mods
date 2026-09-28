---
id: read-commands-take-the-write-lock
status: resolved
severity: minor
found: 2026-09-27
source: Issue 25 PTY acceptance
target: Issue 27 of Prompt Trail (safe schema migration)
---

# Read-only helper commands wait on another Run's write lock

## Problem

`open_archive` in `mods/prompt-trail/src/prompt_trail_helper.c` always runs
`INSERT INTO metadata(...) ON CONFLICT(project_id) DO NOTHING`, even for `capture-list`,
`timeline-read` and `branch-match`, which only read. In WAL mode readers never wait for a
writer, but this statement takes the write lock. While another Run holds it, every read waits
the full 8-second busy budget and then fails with `archive-busy`. In the Issue 25 PTY, a
`/prompt-history status` issued during a held lock took about 8 seconds and reported the pending
state as unknown. The result is correct, only slow, and it fails closed.

## Why deferred

The same function also migrates older schemas under `BEGIN IMMEDIATE`, and read commands rely on
it to do so. Separating what a reader needs from what a writer does belongs with Issue 27's
migration work, not with Issue 25's failure handling.

## Suggested fix approach

When a read-only command opens an archive already at the current schema that already has its
metadata row, it should skip the insert and take no write lock. Only a missing row or an older
schema should take the lock. Done looks like this: a helper black-box test holds
`BEGIN IMMEDIATE` from another connection, and `capture-list` and `timeline-read` still answer
at once.

## Recommended tools

`grep -n "INSERT INTO metadata" mods/prompt-trail/src/prompt_trail_helper.c`; reuse
`hold_write_lock()` in `tests/helper_protocol.py`.

## Resolved 2026-09-28 (Issue 27, `9c93fab`)

`open_archive` now inserts the project's metadata row only when it is missing, and reads its
policy version first. A command of any kind that opens an archive already at the current schema
with its row present writes nothing and takes no write lock; only a missing row or an older
schema does. The helper test `test_reads_of_a_current_archive_answer_while_another_run_holds_the_write_lock`
holds `BEGIN IMMEDIATE` from another connection while `capture-list`, `timeline-read` and
`branch-match` answer within three seconds.
