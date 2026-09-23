---
id: lifecycle-store-scan-per-submission
status: open
severity: minor
found: 2026-09-23
source: /code-review, round 1
target: Prompt Trail working tree, Issue 32 Run lineage across resume
---

# Every composer submission enumerates every Run's lifecycle record, now twice

## Problem

`drainLifecycle()` in `mods/prompt-trail/hooks/register.tsx` runs before each composer
submission is captured. It calls `ensureRunAttached()`, which now starts with
`detachAbandonedRuns()`, and then `flushForeignLifecycles()`. Both go through
`foreignLifecycles()`, which calls `$.store.keys()` and reads every
`prompt-trail:lifecycle:<project>:<run>` record except the current Run's. There is one record per
Run that ever wrote in the project, so the per-submission work grows with the project's history,
and Issue 32 doubled it.

Reported by the cleanup angle as major/PLAUSIBLE, unverified. Checked: the scan is real and runs
on every submission. The cost is in-process `$.store` reads (no subprocess), so it only becomes
visible once a project has many Runs.

## Why deferred

The single scan predates Issue 32 (Issue 16's `flushForeignLifecycles()`). Only a structural fix
is worth doing, and that is design work outside this change: making `detachAbandonedRuns()`
conditional would miss the fallback path it exists for, an in-process `/resume` whose
`SessionEnd` never recorded its leaving.

## Suggested fix approach

Keep a small index record, `prompt-trail:lifecycle-owed:<project>`, listing the Runs whose
record has a non-empty queue or an attachment still open for some host. Update it in
`saveLifecycle()` and in the foreign-record writes. Both `detachAbandonedRuns()` and
`flushForeignLifecycles()` then read that index plus the named records only, and can share one
read per drain. Status reporting (`foreignLifecycles()` in the `status` command) may keep the full
scan. Done when the plugin tests pass unchanged and a test with many settled Runs shows no reads
of their records during a submission.

## Recommended tools

- `grep -n 'foreignLifecycles\|detachAbandonedRuns\|flushForeignLifecycles' mods/prompt-trail/hooks/register.tsx`
- `mods/prompt-trail/tests/run_identity.test.tsx`: the in-process switch tests exercise both paths.
