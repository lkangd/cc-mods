---
id: classic-test-kit-cast-duplicated
status: open
severity: nit
found: 2026-09-29
source: /code-review, round 1
target: Issue 42 working tree (clear before the first submission)
---

# Each plugin test that raises a classic hook event re-declares the test kit's shape

## Problem

The 2.1.273 test kit cannot raise classic hook events, so every test that does casts `$` to `{ classic?: { SessionEnd … } }` and returns early when it is missing. The cast is written inline in `mods/prompt-trail/tests/clear_all.test.tsx:445`, `tests/integrity_gap.test.tsx:263` and `:817`, and `tests/clear_segment.test.tsx:454` (Issue 42, which adds `SessionStart`), while `tests/integrity_gap.test.tsx:478` already has a file-local `classicOf($)` helper for the same thing. The shape and the compatibility gate are kept in sync by hand across files.

## Why deferred

The duplication predates Issue 42, which only followed the prevalent inline pattern; sharing it touches three test files unrelated to the fix.

## Suggested fix approach

Move `classicOf` to `tests/support.tsx`, typed with both `SessionEnd` and `SessionStart` (their event fields as the tests pass them), and replace the inline casts with it. Keep the early return in each test, with its comment on the 2.1.273 kit.

## Recommended tools

`grep -rn "}).classic\|classicOf" mods/prompt-trail/tests/`. Verify with `scripts/verify-startup.sh` (both versions' plugin tests and `tsc`).
