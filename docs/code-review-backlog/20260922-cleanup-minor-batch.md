---
id: cleanup-minor-batch
status: open
severity: minor
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 14 Run collection mode
---

# Three small cleanups deferred from the Issue 14 review

Batched because each is real but none is worth interrupting Issue 14 for. All three are
`PLAUSIBLE`, reviewer-only cost claims (the cleanup angle skips verification by policy), so
confirm the cost before acting.

## Problem

1. **Duplicated archive sequence-response validation** —
   `mods/prompt-trail/hooks/register.tsx` `parseConfirmedResponse()` and
   `parseBoundaryResponse()` both parse JSON, check `eventId` and `projectId`, and validate a
   `sequence` that must be a safe integer `>= 1`. They differ only in `parseBoundaryResponse()`
   also checking `kind`.
2. **Duplicated capture-identity validation in the helper** —
   `mods/prompt-trail/src/prompt_trail_helper.c` `capture_begin()` and `boundary_append()` run
   nearly the same `pt_is_safe_identifier()` block over `run_id`, `segment_id`, `branch_id` and
   `event_id`, differing only in their error category (`capture-input` vs `boundary-input`) and
   in `capture_begin()`'s extra parent/attachment checks.
3. **Repeated identity fixture in the helper tests** —
   `mods/prompt-trail/tests/helper_protocol.py` builds the same
   `{"project_id": ..., "run_id": str(uuid.uuid4()), "segment_id": ..., "branch_id": ...}`
   dict in roughly seven tests.

## Why deferred

Quality-only, no behavior at stake, and each touches code the in-flight tickets (15, 17, 21, 27)
will edit again. Folding them in now would add churn to a diff that already carries a schema
migration. Items 1 and 2 also trade duplication for indirection, which may not be a net win —
judge that with the code in front of you.

## Suggested fix approach

1. Extract a shared `parseArchiveSequence(text, eventId, projectId, extra?)` in `register.tsx`,
   or leave both if the shared shape ends up more opaque than the two explicit checks.
2. In the helper, extract
   `static void require_event_identity(const char *run_id, const char *segment_id,
   const char *branch_id, const char *event_id, const char *category)` and call it from both
   subcommands, preserving each caller's error category.
3. In `helper_protocol.py`, add a `def identity(self, project_id: str) -> dict[str, str]`
   fixture helper next to `begin_argv()` and `boundary_argv()`.

"Done" is the full gate still green with no behavior change.

## Recommended tools

- `grep -n 'parseConfirmedResponse\|parseBoundaryResponse' mods/prompt-trail/hooks/register.tsx`
- `grep -n 'pt_is_safe_identifier' mods/prompt-trail/src/prompt_trail_helper.c`
- `grep -n 'segment_id.*str(uuid.uuid4())' mods/prompt-trail/tests/helper_protocol.py`
- Full gate: `mods/prompt-trail/scripts/verify-startup.sh` (rebuilds artifacts — a helper edit
  requires it, or the gate fails as "stale artifacts").
