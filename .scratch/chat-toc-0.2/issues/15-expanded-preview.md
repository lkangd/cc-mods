# 15: The expanded preview

**What to build:** `e` (or a press on the cut line) expands the preview into the rows of the list and the Minimap, everything uncut up to a text cap, scrolled by the host; `e` again or `← Back · e` returns to the list.

Spec: [chat-toc 0.2](../spec.md) §3 ("Expanded", "Text cap").

**Blocked by:** 13 (The preview region on the terminal)

**Status:** resolved

- [x] First measure whether the host scrolls the whole tree (wheel, PgUp/PgDn, ↑↓ with no control in reach) when the `ui.scroll` hook lets the person's scroll through while expanded; record the finding in this ticket. If it does not, stop and bring it back to the user before building on it
- [x] Expanded: the filter row, search row and footer stay; the `← Back · e` / `← 返回 · e` Button at the top; the files one per line under `Changed` / `改过` and `Read` / `读过`; it holds that one group whatever the Current position or new turns do
- [x] The text cap: User input and last text together cut to about 60,000 characters, each cut part followed by `… N more characters not shown · c: Copy` (the last text's `a: Copy`), both languages; the footer still draws with a 200,000-character pasted input
- [x] Closing the Pane or leaving it returns to the region; the scroll hook keeps its own offset again once back
- [x] `CT-PREV-002` added to the PTY drivers and the release gate's MUST list, passing on both versions
- [x] Root README: `e` in the controls table, known limit 9 of the spec
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

- Measured 2026-10-16 (pyte, 170x44, the V fixture of `ct_preview.py`; probe and captures in `.scratch/chat-toc-0.2/assets/15-scroll-probe/`): with the `ui.scroll` hook answering `next(e)` for the person's scrolls, the host scrolls a Pane tree taller than `bodyRows` on both 2.1.287 and 2.1.295. Five wheel ticks move it five rows, PgDn and PgUp a page, ↓ one row once no control is in reach, and the wheel up brings the top back; ↑ at the top does nothing. The whole tree moves, the Pane's first rows included, and no `n more` row is drawn. So the expanded preview is built on the host's scroll.
- Done on `chat-toc-0.2/15-expanded`. The pure parts are in `hooks/preview.ts`: `capTexts` (the two parts share 60,000 UTF-16 units: a short part stays whole, the other takes the rest, two long parts half each; never inside a character; `left` counts code points), `markdownParts` (≤ 10,000 a `Markdown`, split at a blank line, else a line break, else anywhere; a code block split over two is closed and opened again), `textParts` and `expandedBody` (tests in `tests/preview_parts.test.ts`). `pane.tsx` draws it in place of the Minimap, the list, the notes and the region, the head and the footer kept; `register.tsx` holds the group by its opener's uuid (`expandedOpener`), lets the person's scrolls and focus moves through while it is set, and drops it on the keys leaving the Pane (focused → not) and on a close (`hidesPane`). Kit tests in `tests/expanded_preview.test.ts`.
- 2.1.287 refuses the whole tree for one `Text` child over 10,000 characters (the expanded tree drew blank there with a 200,000-character input), so the User input is split over several `Text`s too. Added to `docs/agents/mod-host-gotchas.md` with the scroll finding.
- The Back Button reads `e: ← Back` / `e: ← 返回`, not `← Back · e`: a `plain` Button with a hotkey draws its key first, as ticket 13's rule does. `e` presses it also when it is scrolled out of view.
- The cap lines name `c: Copy` / `a: Copy`; those keys hang on ticket 17's label-row Buttons and do nothing until it lands.
- "Leaving it" is read as the keys leaving the Pane: Esc, or anything that moves the keyboard to the composer once the Pane held it. Expanded by a click while the keys stay in the composer, it stays until `e`, ← Back or a close. A back tab is not tracked.
- PTY (`tests/acceptance/ct_preview.py` `expand`, `cap`, `running`, recorded as CT-PREV-002; `release_gate.py` MUST list): all pass on 2.1.287 and 2.1.295. `running` drives a live turn through `fake_api.py` and clicks the running group's cut line.
