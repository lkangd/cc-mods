---
id: pre-start-fold-sees-only-the-batch
status: open
severity: minor
found: 2026-10-07
source: /code-review, round 1
target: prompt-history backlog sweep, working tree vs b54339e (branch prompt-trail/backlog-sweep)
---

# Folding of overlapping Runs before the start only weighs Runs that appear in the batch

## Problem

Spec §11 (`.scratch/prompt-history/spec.md`): "起点之前…区间重叠、同时写入的 Run 中，条目较少者…整体折叠为一处…N 由 helper 按整个时间线计数，不限于已载入的窗口".
`write_runs()` in `mods/prompt-history/src/prompt_history_helper.c` gives a Run's whole-timeline
`before` facts only when `writing_before >= 2`, i.e. when at least two Runs other than the
current one have rows in this batch. A visible Run whose overlapping competitor has no row in the
batch gets no facts, so `foldTimeline()` (`hooks/branch.ts`) leaves it unfolded. Once a later
batch brings the competitor in, the merged `runFacts` fold it, so rows the person already saw
collapse as they scroll.

## Why deferred

Within one window nothing is interleaved yet, so nothing is mixed on screen; the visible effect
is a fold that appears as more history loads. Deciding overlap against the whole archive needs a
new per-Run span query (or a materialized span per Run) in the helper and a protocol change.

## Suggested fix approach

In `write_runs()`, for each pre-start Run in the batch, ask the archive whether any other Run's
span `[first, last]` before the start overlaps its own (an index on `(run_id, sequence)` already
makes first/last cheap), and return facts for it and for the competitor that outranks it, even
when the competitor is outside the batch. Done when a helper test with Run A in the window and
an overlapping larger Run B outside it returns A's `before` facts plus B's, and the plugin folds
A on the first window.

## Recommended tools

- `grep -n 'write_runs\|writing_before\|run_neighbour' mods/prompt-history/src/prompt_history_helper.c`
- `grep -n 'outranked\|factsInView' mods/prompt-history/hooks/branch.ts`
- `python3 -m unittest tests.helper_protocol`; `claude plugin test mods/prompt-history`
