# 22: The preview opens on a press and closes with ✕

**What to build:** The preview is no longer shown by default. A click or Enter on an entry jumps as before and opens the preview on that group; Enter in the search field opens it on the match it jumps to. Once open it holds the group last pressed (the Current position, new turns, the View filter and the query do not move it) and closes with a `✕` Button at the rule's right end (hotkey `p`), or when its group leaves the transcript. Nothing of it is kept: the Pane opens with it closed, and `$.store` loses the preview's flag. When rows are too short for the 4-row region beside the list's floor, a press opens it expanded, and `← Back` then closes it. The `p: Preview` fold line and `p: Preview (no room)` go.

This is the shared state (`hooks/register.tsx`, `hooks/preview.ts`) and the terminal's drawing. Desktop's drawing of it is ticket 24; Desktop already shows the entry pressed, so only its default and its `✕` change there.

Spec: [chat-toc 0.2](../spec.md) §1 (layout, shortage, hotkeys), §2 (Keys), §3 (Opening and which group, Expanded, Closing), §9.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] Closed at every Pane open and process start; no `$.store` field for it (an old stored value is ignored)
- [ ] A click or Enter on an entry jumps and opens it on that group; Enter in the field opens it on the match jumped to; Enter on an entry during a search keeps the search; ↑↓, a Minimap cell, `‹ ›` and the band open nothing
- [ ] Holds the pressed group across Current position moves, new turns, a View filter or Layout switch and a query that leaves it out; another press moves it; a rewind or `/clear` that removes the group closes it
- [ ] The rule reads `Preview` / `预览` and ends in `✕` (hotkey `p`, only while open); `p` and `✕` close it; the `p: Preview` fold line and the `(no room)` line are gone
- [ ] Short rows: a press opens it expanded; its `← Back` closes it; `✕` closes it from the region and from the expanded view
- [ ] `r`, `c`, `a` and `e` work only while it is open
- [ ] Element-tree tests for all of the above; existing preview tests moved off "shown by default"
- [ ] PTY drivers rewritten for a closed-by-default preview and passing on 2.1.287 and the current host: `ct_preview.py`, `ct_search.py`, `ct_reuse.py`, and the gate's CT-PREV-001, CT-UI-001/002/003 and CT-SEC-001
- [ ] Root README: the controls table (`p` closes), "What it shows", data and privacy
- [ ] `claude plugin test`, `tsc` on both versions and `claude plugin validate` pass

## Comments
