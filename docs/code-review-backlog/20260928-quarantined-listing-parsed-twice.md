---
id: quarantined-listing-parsed-twice
status: open
severity: nit
found: 2026-09-28
source: /code-review, round 1
target: Issue 30 clear-all (905c774..005dcbe)
---

# The quarantined-archive listing is parsed by two copies of the same validator

## Problem

`readClearInventory` and `readArchiveStatus` in `mods/prompt-trail/hooks/register.tsx` each
declare `{ name: string; path: string; bytes: number }[]` and validate the helper's
`quarantined` array field by field. A change to the shape or its safety checks can land in one
and not the other.

## Why deferred

Cleanup nit (unverified by policy); behaviour is identical today.

## Suggested fix approach

A `type QuarantinedArchive` and `function parseQuarantined(value: unknown, category: string)`
used by both readers, each passing its own error category.

## Recommended tools

`grep -n "quarantined" mods/prompt-trail/hooks/register.tsx`; `claude plugin test mods/prompt-trail`.
