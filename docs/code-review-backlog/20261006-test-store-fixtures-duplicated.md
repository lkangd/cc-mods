---
id: test-store-fixtures-duplicated
status: open
severity: nit
found: 2026-10-06
source: /code-review, round 1
target: Issue 35 working-tree changes under mods/prompt-trail (queued submissions reconciled explicitly)
---

# Consent-store, reconcile-key and branch-lookup test helpers are copied per file

## Problem

`consentedStore`, `reconcileKey` and `branchOf` in `mods/prompt-trail/tests/queued_capture.test.tsx` repeat helpers that already exist in `tests/reconcile_pending.test.tsx`. `branchIds` in that file and in `tests/collection_mode.test.tsx` does the same branch-key scan. The copies can drift apart when the store keys or the stored shapes change.

## Why deferred

This is test-only cleanup across several files, unrelated to the Issue 35 behaviour.

## Suggested fix approach

Export `consentedStore()`, `reconcileKeyFor(runId?)` and `branchStateOf(store)` from `tests/support.tsx`, then replace the per-file copies.

## Recommended tools

`grep -n "function consentedStore\|function reconcileKey\|function branchOf\|function branchIds" mods/prompt-trail/tests/*.tsx`
