---
id: concurrent-run-boundaries-before-start
status: open
severity: minor
found: 2026-09-27
source: Issue 24 implementation alignment (Q10)
target: Prompt Trail band (`AbovePrompt`)
---

# Interleaved Run boundaries before this Run began cannot be told apart

## Problem

Since Issue 24 the band folds every other Run that archived a prompt after this Run's own
active path began ("▸ 另一 Run · N 条", `foldTimeline` in `mods/prompt-trail/hooks/branch.ts`).
Before that point the project's history is drawn as it is. If two Runs were concurrent there
earlier, their prompts and their "—— Run 开始 ——" / "—— Run 离开 ——" rows interleave, and
nothing on a boundary row says which Run it belongs to.

## Why deferred

The person chose not to add a short Run id to boundary rows: an 8-character id means nothing
the person can recognise, and it would sit on every boundary row. Concurrency the person
actually meets while working is already folded.

## Possible direction

Name a Run by something recognisable (its first prompt, or the terminal it ran in) only where
two Runs' boundaries interleave, or fold earlier concurrent stretches the same way.
