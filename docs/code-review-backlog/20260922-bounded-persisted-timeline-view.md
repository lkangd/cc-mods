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
