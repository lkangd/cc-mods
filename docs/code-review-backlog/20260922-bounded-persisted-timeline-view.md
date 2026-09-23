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
