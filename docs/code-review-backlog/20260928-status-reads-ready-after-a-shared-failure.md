---
id: status-reads-ready-after-a-shared-failure
status: open
severity: minor
found: 2026-09-28
source: /code-review, round 1
target: Issue 27 of Prompt Trail (safe archive schema migration), 53356e7..4800c9a
---

# `status` says the archive is ready when its own pending listing met a shared failure

## Problem

When `/prompt-history status` is the first command to meet a failure of the archive itself,
the report contradicts itself. In `mods/prompt-trail/hooks/register.tsx`, the `status` path
calls `discoverPending`, and a thrown `capture-list` failure only sets `pendingUnknown`
(`discoverPending`, around line 2593) before the `status` catch swallows it (around line 4775).
`statusText()` then derives the `archive:` line from `archiveFailure` alone (around line 4097).
With no record on file, it prints `archive: ready · <path>` next to
`pending reconciliation: unknown · 未决 Pending Capture 不可读（<category>）`.

This affects every category in `SHARED_FAILURES`, not only the new migration ones, and dates
from Issue 25. Issue 27 makes it likelier: after an upgrade, the first open may meet
`migration-backup-cleanup` or `archive-integrity`, and `status` is a natural first command.
Submissions still fail closed, because the next real write meets the same failure and
records it.

## Why deferred

The behavior predates Issue 27. Issue 25 decided on purpose that `status` only displays and
never writes the shared record (its Code review fixes, the item about the Pending Capture read
failure carrying its category). Changing how `status` reports a failure it met, as opposed to
one on record, is a small UX decision that belongs with that design, not with the migration
work.

## Suggested fix approach

In `statusText()`, when `archiveFailure` is unset but `pendingUnknown` names a category in
`SHARED_FAILURES`, report the `archive:` line as unavailable for that category and say it was
met by this `status` call, not recorded. Keep not writing `$.store`. Done looks like this: a
plugin test with `listFails: 'migration-backup-cleanup'` shows `archive: unavailable · 范围
archive · 类别 migration-backup-cleanup` in `status` and leaves `archive-state` unset.

## Recommended tools

`grep -n "pendingUnknown\|archiveFailure ?" mods/prompt-trail/hooks/register.tsx`. The
existing plugin test `status names what the pending listing met` in
`tests/archive_unavailable.test.tsx` is the template.
