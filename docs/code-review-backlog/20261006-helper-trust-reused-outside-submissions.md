---
id: helper-trust-reused-outside-submissions
status: open
severity: major
found: 2026-10-06
source: 0.2.0 release gate, PT-COMPAT-005
target: mods/prompt-trail/hooks/register.tsx, helper calls that no fresh target proof precedes
---

# Lifecycle writes and the timeline read run the helper on trust proven earlier

## Problem

The spec (section 6) says every helper call is preceded by checks of the locator, owner, mode, canonical path and digest. The plugin proves the target once per operation: a submission, `enable`, `disable`, `clear-run`, `clear-all` and `status` each call `inspectTarget` or `refreshStartup` before they run the helper. Some paths do not:

- `applyLifecycleEvent` (classic `SessionStart` / `SessionEnd` / `/clear`, compaction) calls `prepareProject` and then appends boundaries through the helper, refreshing the target only when no Run is known yet.
- `ensureTimeline` loads the timeline with the helper when the band opens, refreshing only when the target was never proven.
- `prepareProject` reads the archive's health through the helper (`archive-health`, from Issue 53) for every caller except the ones that now pass `{ health: false }` (submission, `enable`, `disable`).

A helper replaced while the Run is live is therefore still run by those paths until the next submission or command proves the target again.

The 0.2.0 gate caught the submission case: a submission ran the replaced helper's `archive-health` before the per-submission digest check refused it. That case is fixed, along with `enable` and `disable`, and has plugin tests. The paths above are older (lifecycle, timeline) or are not reached by any scenario (health reads from other callers).

## Suggested fix approach

Either prove the target at the start of each of these operations (cost: a `shasum` and a few `stat`/`realpath` calls each), or check a cheap file identity (device, inode, size, mtime, ctime) captured at the last proof before every `runArchive` call, and refuse with `digest-mismatch` when it differs. The second covers every path in one place; it needs the test harness to answer the extra `stat`.

## Recommended tools

- `grep -n "prepareProject(\$\|refreshStartup(\|inspectTarget(" mods/prompt-trail/hooks/register.tsx`
- `tests/run_identity.test.tsx` "a helper that changes under a running Run…" shows how to assert that no call reaches a changed helper.
