# 15: The expanded preview

**What to build:** `e` (or a press on the cut line) expands the preview into the rows of the list and the Minimap, everything uncut up to a text cap, scrolled by the host; `e` again or `← Back · e` returns to the list.

Spec: [chat-toc 0.2](../spec.md) §3 ("Expanded", "Text cap").

**Blocked by:** 13 (The preview region on the terminal)

**Status:** ready-for-agent

- [ ] First measure whether the host scrolls the whole tree (wheel, PgUp/PgDn, ↑↓ with no control in reach) when the `ui.scroll` hook lets the person's scroll through while expanded; record the finding in this ticket. If it does not, stop and bring it back to the user before building on it
- [ ] Expanded: the filter row, search row and footer stay; the `← Back · e` / `← 返回 · e` Button at the top; the files one per line under `Changed` / `改过` and `Read` / `读过`; it holds that one group whatever the Current position or new turns do
- [ ] The text cap: User input and last text together cut to about 60,000 characters, each cut part followed by `… N more characters not shown · c: Copy` (the last text's `a: Copy`), both languages; the footer still draws with a 200,000-character pasted input
- [ ] Closing the Pane or leaving it returns to the region; the scroll hook keeps its own offset again once back
- [ ] `CT-PREV-002` added to the PTY drivers and the release gate's MUST list, passing on both versions
- [ ] Root README: `e` in the controls table, known limit 9 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
