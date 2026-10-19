# 38: A Minimap on the terminal

**What to build:** The desktop list has a strip of bars over it (ticket 36); the terminal has nothing like it. The user asked (2026-10-15) whether the terminal can have it too, with a press on a bar jumping to that Turn group. Settled by a grilling session; see **Minimap** in [`CONTEXT.md`](../../../mods/chat-toc/CONTEXT.md).

**Blocked by:** none

**Status:** done

## Facts found

- The desktop's strip is an Svg and the host never passes clicks on an Svg to the plugin (`docs/agents/mod-host-gotchas.md`), so the desktop strip cannot be pressed. A terminal `Button` can.
- A `plain` Button honours only `dimColor` and `hover`, no `color`: a terminal bar cannot be coloured, so the Current position and a running group can only be told apart by dimming.
- Every Button is a stop of the host's focus ring (`hooks/ring.ts`).

## Decisions

- **Form**: one row of `plain` Buttons right under the tab rule, one 1-column cell per Turn group, `▁▂▃▄▅▆▇█` by the steps of its Agent reply (8 levels on a square-root scale up to the most steps of any group, so one long outlier leaves the rest low but not all alike; a group with no steps is `▁`). About 40 cells at the 44-column Pane.
- **Label line**: under the bars one `Text` row with the first group's day and time at the left and the last group's time at the right (`stripLabels`); when they do not fit, the day goes first. **Changed while building:** it does not say `N turns`, because the terminal footer already does and the same count twice on screen is noise; the desktop keeps it, having no footer count.
- **Baseline and spacing** (added after a look at it): the width the groups do not reach is a dim `▁` baseline (a `Text`, `subtle`), so the row is as wide as the pane and not lopsided; a blank row follows the label line, so the list does not sit tight under it. Three rows in all (`BAR_ROWS`), so the hide rule is the list keeping 8 rows after those three.
- **Many groups**: past the cells that fit, a cell stands for consecutive groups, as tall as the most steps among them. A press on it jumps to the first of them that has a Jump target.
- **Press**: the same jump as pressing that group's entry; an unjumpable group draws `▁` and gives the same notice as its entry. When every group of a bucket is unjumpable the bucket is `▁` and gives the notice. Where the list window goes afterwards is the Current position's following, no scroll of its own.
- **Current position**: every cell `dimColor` but the one holding the Current position (the bucket that holds it). A running group is not marked; its entry has `◐`.
- **Keyboard**: the cells are not in the focus ring; the host still walks Button by Button, so `ringMove` steps over them (down from the filter row to the first entry in the window, up from an entry to the filter row, revealing the entry above when the window's first is left), and the ring's order stays filter Buttons, entries, Layout Button.
- **View filter**: no effect; the Minimap always draws every Turn group.
- **Hidden** when there are fewer than 2 Turn groups, or when the entry window would get fewer than 8 rows.
- **Words**: the label line's words go into both tables in `hooks/text.ts` (the turn count already exists).

## Acceptance criteria

- [x] With 2 or more groups the Minimap draws under the tab rule on 2.1.287 and 2.1.295, at 44, 36 and 56 columns, in all three Layouts.
- [x] Bar heights follow the steps; a bucket's height is the most steps in it; more groups than cells fold into buckets and the first bucket still starts at group 0.
- [x] A press on a cell jumps to its group (or the first jumpable group of its bucket) and the Current position then lights that cell.
- [x] The cell of the Current position is the only one not dimmed, and follows the scrolling.
- [x] An unjumpable group's cell is `▁` and a press shows the entry's notice.
- [x] The arrows never stop on a cell; the View filter does not change the Minimap; fewer than 2 groups or too few rows hides it and gives the rows to the list.
- [x] Unit tests for the heights, the bucketing and the hidden rule; a PTY scenario (press a cell, check the transcript and the lit cell); `claude plugin test`, `tsc` and `claude plugin validate` pass.

## Built

- `hooks/bars.ts` (cells, blocks, buckets, press target, hide rule, label row), `pane.tsx` (the rows), `register.tsx` (cells from the groups, `isOff` from the refused sides, the press through `jump`), `ring.ts` (steps over cells).
- Tests: `tests/bars.test.ts` (arithmetic), `tests/minimap.test.ts` (drawing, press, filter, bucketing, hiding), `tests/focus_ring.test.ts` and `tests/follow_position.test.ts` (ring, lit cell); `claude plugin test` 294 pass (the CT-PERF timing test is flaky under machine load, it passes alone), `tsc` clean. PTY: CT-MAP-001 (`position_scenarios.py map1`) passes on 2.1.287 and 2.1.295, a click on a cell lands on its group and the one undimmed cell follows; CT-POS-001, 002 and CT-LIFE-006 still pass on 2.1.295.
- Measured: 1-column plain Buttons draw side by side with no gap on both hosts; the hovered cell is drawn inverse, the rest `999999` (dim) as the host draws `dimColor`.

## Not done

- Not looked at by a person in a real terminal; not run in English; the PTY scenario is not in the release gate's MUST list.

## Comments

- 2026-10-15: grilled, then built the same day. Spec §7 and the README's file table were updated with the design.
