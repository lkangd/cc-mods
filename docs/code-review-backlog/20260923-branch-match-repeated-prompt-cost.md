---
id: branch-match-repeated-prompt-cost
status: open
severity: major
found: 2026-09-23
source: /code-review, round 1
target: Prompt Trail working tree, Issue 18 Conversation Branch across resume and fork
---

# `branch-match` walks every tied candidate's chain separately

## Problem

`branch_match()` in `mods/prompt-trail/src/prompt_trail_helper.c` selects every Prompt Entry whose
text equals some transcript row, ordered by the latest row it appears on, and calls
`match_chain()` for each candidate on the winning row. `match_chain()` walks that candidate's
ancestors one `SELECT` at a time and scans the transcript rows backwards for each one. All entries
sharing the text of the latest row are weighed, and chains that share ancestors are walked again
for every candidate.

For a fork (matched across the whole project), an archive holding many entries with the same
text (a repeated "继续" in one long lineage) makes every one of them a candidate. The reviewer's
worst case, 100,000 identical entries with 4,096 identical transcript rows, is about 400 million
ancestor lookups. That would exceed the 10-second `$.process.run` timeout in `matchBranch()`
(`hooks/register.tsx`), and a failed match drops the submission. Realistic archives (hundreds of
repeats) stay well under a second. The parent query is now prepared once per call (fixed in the
same review, cleanup finding #6), but the algorithmic cost remains.

## Why deferred

The trigger needs a very large archive of identical prompts, which is the scale Issue 21
(100,000 Timeline Events) is about. A correct fix changes the matching algorithm, not a few
lines, and needs its own tests at that scale.

## Suggested fix approach

Match top-down with memoisation instead of bottom-up per candidate. For each entry, the earliest
transcript position at which its chain (root first) embeds as a subsequence is
`f(e) = next index > f(parent(e)) whose row equals text(e)`. Compute it once per entry, with a
per-text sorted position list and binary search. A candidate matches when `f(parent)` exists and
its text occurs after it. It ranks by the last occurrence of its text, then by depth. Truncated
mode lets a chain start at any node. Alternatively, cap the candidates weighed per row (for
example 256) and answer `ambiguous` past the cap. That is honest (it never guesses) but degrades
resume to a question. Done when a helper test with thousands of identical entries answers within
a fixed time budget and the existing `branch_match` tests still pass.

## Recommended tools

`python3 -m unittest -k branch_match mods/prompt-trail/tests/helper_protocol.py`. Build a large
archive with a loop over `self.capture(...)` (slow, so prefer one SQLite transaction through a
test-only fixture) and time `branch-match` with `time`.

## Issue 19 addition: walking the preferred lineage

Issue 19 made `branch-match` settle a tie on the candidate the `<prefer>` entry's lineage passes
through (`lineage_winner()`). It walks from `<prefer>` to the root one `SELECT` at a time and, at
each step, compares against every tied candidate. The cost is lineage depth times tie count, so it
belongs to the same scale problem as above and should be solved with it. For example, a set of
tied event ids makes each step constant-time.
