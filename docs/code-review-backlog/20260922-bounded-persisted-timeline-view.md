---
id: bounded-persisted-timeline-view
status: open
severity: major
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 14 Run collection mode
---

# The expanded timeline is an unbounded in-memory array with no rehydration

## Problem

`mods/prompt-trail/hooks/register.tsx` keeps the expanded list in a module-level
`let timeline: TimelineItem[] = []`, appends to it as Prompt Entries are confirmed and
Collection Boundaries are written, and renders it with `timeline.map(...)` inside the
`ui.render` hook. There is no archive read anywhere in the module.

Two consequences:

- After a plugin reload the list is empty even though the archive holds every Prompt Entry and
  boundary, and `status` can still recover the Run mode from `$.store`. The person sees an empty
  Prompt Trail for a Run that has real history.
- During a long Run the array grows without bound and every render walks all of it.

`.scratch/prompt-trail/spec.md` §11 requires the opposite: draw Prompt Entries and boundaries
"按 sequence 旧到新" using "有界读取与有界渲染窗口" with one overscan row.

## Why deferred

Pre-existing, and owned by another ticket. The unbounded array arrived with Issue 12 (as
`entries`); Issue 14 only renamed it to `timeline` and taught it to hold boundaries. The bounded
window, batch loading and keyed-button continuity are the whole subject of
`.scratch/prompt-trail/issues/21-browse-long-timeline.md`, which is unblocked but not claimed.
Building it inside Issue 14 would have pulled a new helper read subcommand and its protocol
tests into a ticket about a switch.

## Suggested fix approach

Do it as Issue 21:

1. Add the bounded, sequence-ordered range read to
   `mods/prompt-trail/src/prompt_trail_helper.c` promised by `spec.md` §10 — strictly ordered by
   `sequence`, with a fixed maximum batch the caller cannot widen. It must return Prompt Entries
   and `timeline_events` rows in one sequence-ordered stream.
2. Replace the module array with a bounded render window plus one overscan row, loading the
   previous batch when the earliest visible Prompt Entry takes focus and keeping the same keyed
   `Button` so arrow keys cross batches.
3. Rehydrate that window on reload instead of starting empty.

Note the interaction with `20260922-run-mode-durability-without-store.md`: both need the same
read path, so build it once.

## Recommended tools

- `grep -n 'let timeline\|recordBoundary\|ui.render' mods/prompt-trail/hooks/register.tsx`
- `.scratch/prompt-trail/spec.md` §11 for the exact interaction contract.
- `mods/prompt-trail/tests/collection_mode.test.tsx` and `composer_capture.test.tsx` both render
  through the shared `renderBand()` helper in `tests/support.tsx`.

---

## Update 2026-09-23 (Issue 17 review)

Issue 17 delivered part of this: a helper `timeline-read` subcommand returns the latest fixed
batch (`TIMELINE_READ_LIMIT` = 128) of Prompt Entries and boundaries in `sequence` order with a
`truncated` flag, and `session.start` plus a fresh consent grant merge it into `timeline`
(`loadTimeline()` in `mods/prompt-trail/hooks/register.tsx`). Reload/restart rehydration is
therefore done; what remains for Issue 21 is unchanged: cursor-based earlier batches, the bounded
render window with overscan, keyed-button continuity, and capping the in-memory array.

One new gap the Issue 17 review surfaced (minor, CONFIRMED) belongs here too:
`parseTimeline()` validates `truncated` and then drops it, so when the project holds more than
128 events the band shows the latest batch with no sign that older history exists. Issue 21
should carry the flag into the render state and show an "earlier events" affordance (which is
also where "load the previous batch when the earliest visible entry takes focus" hooks in).

## Update 2026-09-23 (Issue 32 review)

Issue 32 review findings #13/#14 (minor, CONFIRMED) belong here: the "从 Run X 分出" label on a
`run-started` is derived by `splitOrigins()` (`mods/prompt-trail/hooks/register.tsx`) from the
events in view — the Run that already holds the same `segmentId` earlier in the list. When the
original Run's events in that session have fallen outside the latest 128-event batch, the new
Run's start reads as a plain "Run 开始". This is a deliberate trade-off (no schema column, no
extra query in Issue 32); when Issue 21 adds cursor reads, either walk back until the segment's
first holder is found or add a bounded helper query "first Run seen in segment S", and keep
`splitOrigins()` as the in-view fast path.

## Update 2026-09-23 (Issue 18 design)

Issue 18 folds this Run's entries that left the active path into one "另一分支 · N 条" row per
fork point. N counts only entries inside the loaded 128-row window; off-path entries outside the
window are neither counted nor expandable. The same "from Run X" window limit above applies to the
fork label, whose source Run is read from the first Prompt Entry's parent. When Issue 21 adds cursor
reads, count and expand folds across the full range.

## Update 2026-09-23 (Issue 18 review)

Review finding #2 (major, CONFIRMED) belongs here. `foldTimeline()` in
`mods/prompt-trail/hooks/branch.ts` walks the active path from the current session's branch tip
through the loaded window only. When the tip lies outside the latest 128 events (a resumed
session whose last entry is old, while a later segment and other Runs filled the window), the
path is empty and nothing folds: this Run's off-path entries in the window are drawn inline. After
the next submission the path starts at that new entry, so the older off-path entries still fall
below the fold threshold. Nothing is hidden or lost; entries that should be folded are shown
unfolded. Fix with the cursor reads: walk the path's ancestry past the window (or have the helper
answer the path's first own sequence) before folding.

## Update 2026-09-23 (Issue 19 review)

Review finding #2 (minor, CONFIRMED) belongs here. `branchStarts()` in
`mods/prompt-trail/hooks/branch.ts` marks an entry `—— 新分支 ——` only when its parent is in the
loaded window and belongs to another Run. After a reload, a visible entry whose cross-Run parent
has fallen out of the latest 128 events gets no marker. The entry is still drawn, just without
the line saying it continues another Run. `—— 新根分支 ——` does not depend on the window, since it
needs only `parentEventId === null`. Fix with the cursor reads: have the helper answer the parent's
Run for visible entries, or read the parents past the window.

## Update 2026-09-24 (Issue 20 review)

Review finding #2 (minor, CONFIRMED) belongs here. The parent-confirmation Pane labels each
candidate through `parentLabel()` in `mods/prompt-trail/hooks/register.tsx`: from the loaded window
as `#序号 首行文本`, otherwise from `branch-match`'s named candidates as `#序号 事件 xxxxxxxx`. The
stored parent is offered first even when the transcript matched nothing, so it can be absent from
both; it is then labelled `事件 xxxxxxxx` with no sequence. The choice still works and the event id
prefix still tells it apart, but the person has less to recognise it by. This fallback predates
Issue 20 (Issue 18's dialog had it too). Fix with the cursor reads: have the helper answer the
sequence of a named event id, or keep the stored parent's sequence in `BranchState` when it is
written.

## Update 2026-09-24 (Issue 21)

Issue 21 delivered the rest of this entry except one part:

- Cursor reads, the bounded window (two batches plus one overscan row, 257 events), loads at
  either edge, and the "earlier events" signal (`earlier`/`later` replace `truncated`): done in
  `1396e5f` and `51c8420`.
- (b) Issue 18 review #2, a tip outside the window: the helper answers `path`, the tip's ancestor
  chain where it crosses the batch plus the path's first own sequence, and `foldTimeline()` takes
  it. Resolved.
- (c) Issue 19 review #2, a cross-Run parent outside the window: the helper answers `parents`, and
  `branchStarts()`/`forkSources()` read the parent's Run from it. Resolved.
- (d) Issue 32 review #13/#14, "从 Run X 分出" past the window: the helper answers `origins`, the
  first Run holding each `run-started`'s segment. Resolved.
- (e) Issue 20 review #2, the stored parent's number: candidates and the `<prefer>` entry carry
  their project ordinal (`e55ccda`), and the Pane labels them `#N`. Resolved.

Still open, (a): fold counts and expansion stay within the loaded window. An off-path stretch that
crosses the window's edge is counted only for its part inside, and entries beyond the window
cannot be expanded. It needs a helper query that counts (and pages) a fork point's off-path
entries across the whole range.

## Update 2026-09-24 (Issue 21 review)

Review finding #4 (minor, CONFIRMED) belongs here. `branchStarts()` in
`mods/prompt-trail/hooks/branch.ts` skips a Prompt Entry with no earlier row of its Run in the
window, treating it as the Run's first entry, which its Run boundary explains. At the window's
first rows that is not always so: the Run's earlier rows may lie before the window. Such an entry
whose parent is in another Run (known through `parents`) then gets no `—— 新分支 ——` line. Fix
with window context: have the helper say, for each Run in the batch, whether its row just before
the batch is a boundary of its own, and skip only then.

