# 22: The preview opens on a press and closes with ✕

**What to build:** The preview is no longer shown by default. A click or Enter on an entry jumps as before and opens the preview on that group; Enter in the search field opens it on the match it jumps to. Once open it holds the group last pressed (the Current position, new turns, the View filter and the query do not move it) and closes with a `✕` Button at the rule's right end (hotkey `p`), or when its group leaves the transcript. Nothing of it is kept: the Pane opens with it closed, and `$.store` loses the preview's flag. When rows are too short for the 4-row region beside the list's floor, a press opens it expanded, and `← Back` then closes it. The `p: Preview` fold line and `p: Preview (no room)` go.

This is the shared state (`hooks/register.tsx`, `hooks/preview.ts`) and the terminal's drawing. Desktop's drawing of it is ticket 24; Desktop already shows the entry pressed, so only its default and its `✕` change there.

Spec: [chat-toc 0.2](../spec.md) §1 (layout, shortage, hotkeys), §2 (Keys), §3 (Opening and which group, Expanded, Closing), §9.

**Blocked by:** none

**Status:** resolved

- [x] Closed at every Pane open and process start; no `$.store` field for it (an old stored value is ignored)
- [x] A click or Enter on an entry jumps and opens it on that group; Enter in the field opens it on the match jumped to; Enter on an entry during a search keeps the search; ↑↓, a Minimap cell, `‹ ›` and the band open nothing
- [x] Holds the pressed group across Current position moves, new turns, a View filter or Layout switch and a query that leaves it out; another press moves it; a rewind or `/clear` that removes the group closes it
- [x] The rule reads `Preview` / `预览` and ends in `✕` (hotkey `p`, only while open); `p` and `✕` close it; the `p: Preview` fold line and the `(no room)` line are gone
- [x] Short rows: a press opens it expanded; its `← Back` closes it; `✕` closes it from the region and from the expanded view
- [x] `r`, `c`, `a` and `e` work only while it is open
- [x] Element-tree tests for all of the above; existing preview tests moved off "shown by default"
- [x] PTY drivers rewritten for a closed-by-default preview and passing on 2.1.287 and the current host: `ct_preview.py`, `ct_search.py`, `ct_reuse.py`, and the gate's CT-PREV-001, CT-UI-001/002/003 and CT-SEC-001
- [x] Root README: the controls table (`p` closes), "What it shows", data and privacy
- [x] `claude plugin test`, `tsc` on both versions and `claude plugin validate` pass

## Comments

Done on `chat-toc-0.2/22-preview-on-press` (2026-10-17).

- Whether the preview has room is told by the rows before the notes that come and go (a refusal, a notice), not after them, so a note does not switch an open preview between the region and the expanded view; while a note shows, the list may have 7 rows instead of 8.
- The expanded view for want of rows is worked out at each drawing, not stored at the press: an open preview whose Pane is made too short is drawn expanded too (its `✕` stays in reach), and returns to the region when the rows come back. Leaving the Pane ends only an expansion the person asked for with `e`.
- Desktop got only what keeps it working with the preview closed by default: the rule's `✕` and the Back row's `✕` close it. Its drawing is ticket 24's.
- `perf_scenarios.py` now opens the preview with a click right after the resume, so CT-PERF-001 runs with it open; the perf runs were not repeated for this ticket.
- PTY on 2.1.287 and 2.1.295: `ct_preview.py` (all nine), `ct_search.py` (all eight), `ct_reuse.py` (all seven), and the gate's `ui-001`, `ui-002`, `ui-003`, `sec-001`.

- **Confirmed by the user** (2026-10-19): the room told by the rows before the passing notes, and an open preview drawn expanded while the Pane is too short.
