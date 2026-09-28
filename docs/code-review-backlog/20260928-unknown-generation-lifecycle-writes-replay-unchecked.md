---
id: unknown-generation-lifecycle-writes-replay-unchecked
status: open
severity: minor
found: 2026-09-28
source: /code-review, round 1
target: Issue 30 clear-all (905c774..005dcbe)
---

# A lifecycle write whose generation is unknown replays into whatever generation stands

## Problem

Issue 30 stamps each queued lifecycle write with the Archive generation in place when it is first
saved (`saveLifecycle` in `mods/prompt-trail/hooks/register.tsx`, the block that calls
`readArchiveStatus`), and `appendBoundary` passes it to `boundary-append` so a write owed to a
cleared or quarantined generation is refused and dropped (`retiredWrite`). Three kinds of write
still replay unchecked, because `appendBoundary` turns a missing value into `'-'`
(`overrides.generation ?? '-'`):

- `archive-status` failed when the write was stamped: `generation` is stored as `null`, the same
  value as "there was no archive then";
- queue entries saved by a build before Issue 30 carry no `generation` at all
  (`storedLifecycleWrite` accepts them);
- a `deferredClear` held in memory by *another* live process (one that saw a `/clear` but could
  not queue it) is stamped only when that process later drains, i.e. after a clear-all another Run
  performed. The clearing process resets its own `deferredClear` (fixed in review round 1).

If a clear-all or quarantine completes before such a write replays, a boundary from the retired
history (ids only, never prompt text) appears in the new timeline. Reported three times in round 1
(spec, correctness, callers angles).

## Why deferred

Needs a decision from a human: a write whose original generation cannot be recovered must either be
dropped (losing a lifecycle fact such as a Clear Boundary, which Issue 26 would then have to record
as an Integrity gap) or be written unchecked (the current behaviour). Every trigger needs a helper
failure or a pre-upgrade queue plus a clear completing in between.

## Suggested fix approach

Distinguish "no archive then" (`archive-status` answered `generation: null`) from "unknown"
(the call failed; a legacy entry; another process's deferred clear) with a sentinel such as
`generation: 'unknown'`. Decide per the answer above: either drop unknown writes on replay and
record the loss where Issue 26 records lifecycle losses (see the backlog entry
`20260922-lifecycle-integrity-gap.md`), or keep replaying them unchecked and say so
in spec §9. For a deferred clear, capture the generation when the `/clear` is observed rather than
when it is queued.

## Recommended tools

`grep -n "generation" mods/prompt-trail/hooks/register.tsx | grep -n "lifecycle\|appendBoundary\|saveLifecycle"`;
the plugin tests in `mods/prompt-trail/tests/clear_all.test.tsx` ("a boundary owed to a cleared
generation is dropped") show how to seed a stamped queue; run `claude plugin test mods/prompt-trail`.
