# Decide the Layout switch's entry and default

Type: grilling
Status: resolved
Blocked by: 15

## Question

What entry does the release use to switch among the three Layouts (Card / Compact / Timeline)? Which Layout is the default? Is the footer permanent? The prototype used three entries: the footer's `‹ ›`, the hotkey `v` with the Pane focused, and `/chat-toc a|b|c`. It must also be decided how these entries coexist with the View filter's 1/2/3 hotkeys and with the meaning of `/chat-toc` reopening the Pane. The conclusion is for `CT-UI-002` to cite.

## Answer

**Verdict (confirmed by the user, 2026-10-09): the default is Card; the only entry is one "Layout: <current Layout>" button at the right end of the filter row at the top of the Pane, which cycles on a click or on `l` when focused; no command argument is provided; the footer is not permanent; `/chat-toc` only opens and focuses, and never closes.** `CT-UI-002` cites items 2, 3 and 5 below.

1. **Default Layout**: Card. It also falls back to Card when `$.store` holds no record or a value that is not recognized.
2. **Entry**: a `plain` Button at the right end of the filter row, with the text "Layout: Card", "Layout: Compact" or "Layout: Timeline", showing the **current** Layout, not the next one. A click on it, or `l` while the Pane is focused, cycles "Card → Compact → Timeline → Card". The choice is written to `$.store` at once; if the write fails, this switch still happens. The prototype's footer `‹ ›`, hotkey `v` and `/chat-toc a|b|c` are not used: `v` is easily read as a View filter key; with only three Layouts and the choice remembered, a command argument is not worth it and would muddy what `/chat-toc` means.
3. **Hotkeys coexist**: with the Pane focused, 1/2/3 switch the View filter, `l` switches the Layout, and ↑↓/Enter select and jump, with no conflict.
4. **The footer is not permanent**: it appears only when showing the "paused" note or a refused-jump note. The filter row is about 18 columns, the gap plus "Layout: Card" about 9 columns, and 3 more columns are left for 2.1.287's ✕, about 30 columns in all, so it fits even at the narrowest 36 columns.
5. **Position on a switch**: when the Pane is focused and has a selection cursor, the selected group is the anchor; otherwise the group of the Current position is. After the switch the anchored group stays inside the visible window, and the position changes as little as possible. The following or paused state does not change, and resuming following still follows the old rule (at the Current position's next change).
6. **`/chat-toc`**: no arguments. When the Pane is closed it reopens it; when it is already open (foreground or background tab) it brings it to the front and focuses it with `focus:true`, and never closes it, since ✕ is the only way to close. If the implementation finds that opening an already open id does not switch tabs, it degrades to focusing only.

Host facts (from `plugins__mods__interface.md`, `reference.md`, `api.md`): a hotkey inside a Pane can only be put on a drawn `Button` (one digit or one lowercase letter) and works only while the Pane is focused; command arguments come through `e.args`. `CONTEXT.md` is not changed ("Layout" is only a word on the interface), and no ADR is written (it is cheap to change).
