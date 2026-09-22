---
id: reconciliation-duplication-batch
status: open
severity: minor
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 15 reconcile an interrupted Pending Capture
---

# Four duplication cleanups deferred from the Issue 15 review

Four cleanup-angle findings, all real but none worth interrupting Issue 15's correctness work.
Each was reported `PLAUSIBLE` and `unverified` (the cleanup angle skips the verifier by
policy); the cost claims below were re-read against the code before filing.

## Problem

1. **Timeline append is written twice.** `mods/prompt-trail/hooks/register.tsx` appends a
   `TimelineItem` and calls `$.ui.invalidate('ui.render')` in `reconcilePending`'s
   `confirmPending` and again in the `prompt.submit` confirmation path. Adding a
   `TimelineItem` field or changing invalidation needs both edited in step.

2. **Active-branch writes are spread across three policy paths.** The
   `branchKey(...)` + `{version, branchId, parentEventId}` shape is written in
   `branchState()`, in `enableCollection()`'s root reset, and twice inside
   `reconcilePending()` (the confirm path and the `新根分支` reset). A future branch-schema
   change or a change to what a "root" means must find all four.

3. **`capture-list` repeats the archive-path probe.** `capture_list()` in
   `mods/prompt-trail/src/prompt_trail_helper.c` builds `<root>/<projectId>.sqlite3` and
   `lstat`s it, duplicating the filename construction, `PATH_MAX` check and ENOENT policy
   that `open_archive()` already owns. The two can drift.

4. **Reconciliation tests re-declare the collection-mode fixtures.**
   `mods/prompt-trail/tests/reconcile_pending.test.tsx` defines its own `consentedStore()`,
   `runModeKey()` and `branchIds()`, near-copies of the ones in
   `mods/prompt-trail/tests/collection_mode.test.tsx` (with a different `branchIds` return
   type). A change to the consent, run-mode or branch key format needs edits in both files.

## Why deferred

All four are shape-of-the-code costs, not defects: the behavior is correct and covered by
tests. Item 2 in particular is entangled with Conversation Branch work that Issues 17, 18 and
19 own, so extracting a branch-writing seam now would likely be redone. Batching them keeps
the Issue 15 diff reviewable.

## Suggested fix approach

- (1) Extract `appendPromptEntry(eventId, sequence, text, attachmentCount)` next to
  `entryLine()` and call it from both sites.
- (2) Extract `setActiveBranch($, project, {branchId, parentEventId})` and
  `resetActiveBranch($, project)`; do it together with whichever of Issues 17/18/19 lands
  first, so the seam is cut once against real requirements.
- (3) Give the helper `static bool archive_exists(const char *root, const char *project_id)`
  and call it from both `capture_list()` and `open_archive()`.
- (4) Move `consentedStore()`, `runModeKey()`, `reconcileKey()` and `branchIds()` into
  `mods/prompt-trail/tests/support.tsx` and import them in both test files.

Done looks like: `mods/prompt-trail/scripts/verify-startup.sh` still green with no test
behavior changed — these are pure refactors.

## Recommended tools

- `grep -n "prompt-trail:branch:" mods/prompt-trail/hooks/register.tsx` for item 2's sites.
- `grep -n "ui.invalidate\|timeline = \[" mods/prompt-trail/hooks/register.tsx` for item 1.
- `grep -n "sqlite3\"\|PATH_MAX" mods/prompt-trail/src/prompt_trail_helper.c` for item 3.
- Verify with `mods/prompt-trail/scripts/verify-startup.sh` (rebuilds artifacts and fails
  closed on stale ones; item 3 requires that rebuild).
