---
id: clear-forgets-other-runs-archive-only-disable
status: open
severity: minor
found: 2026-10-07
source: /code-review, round 1
target: Prompt Trail backlog sweep, working tree vs b54339e (branch prompt-trail/backlog-sweep)
---

# clear-all can return another Run's archive-only disable to the default

## Problem

When `$.store` could not save a disable, the Run's `collection-stopped` boundary in the archive
is the only durable record of it (`loadRunMode` / `readRunCollectionState` in
`mods/prompt-trail/hooks/register.tsx`). `clear-all` deletes the archive. For the current Run
this round fixed it: `keepRunModeAcrossCut()` writes the disabled mode to the store after the cut,
or the clear reply says a reload will not keep it. For **other** Runs of the project nothing
holds the disable afterwards: `forgetClearedHistory()` only rewrites run-mode keys that are
already in the store, so a reload of such a Run (after its own in-memory state is gone) reads no
boundary and resolves `enabled`. Spec §4: "clear-all 不撤销 Collection consent，也不改变当前 Run collection mode".

## Why deferred

It needs two failures on another Run (its store write failed at disable, and it then reloads
after someone else's clear-all), and the disable reply already warns "档案被清除或隔离后会回到默认值".
A fix needs a helper read of every Run's latest Collection Boundary before the cut.

## Suggested fix approach

Before `clear-all` (in `clearTimeline`), ask the helper for each Run of the project whose latest
Collection Boundary is `collection-stopped` and that has no run-mode record in the store, and
write `{ version: 1, mode: 'disabled' }` for each; if any cannot be written, name it in the clear
reply. Quarantine has the same shape and can share the step. Done when a test with another Run
disabled only in the archive still resolves `disabled` after clear-all and a module reload.

## Recommended tools

- `grep -n 'forgetClearedHistory\|keepRunModeAcrossCut\|readRunCollectionState\|run-collection-state' mods/prompt-trail/hooks/register.tsx mods/prompt-trail/src/prompt_trail_helper.c`
- `mods/prompt-trail/tests/collection_mode.test.tsx` (`storeSetFails`)
