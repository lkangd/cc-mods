# 23: Make the Desktop list and preview reachable by scrolling

**What to build:** In the Claude app the Pane's tree is taller than what shows, and it does not scroll: the top entries of the list cannot be reached, and the preview under the list is cut at the pane's bottom (the user's look, 2026-10-17, see ticket 19). Find why and fix it, so that every entry and the whole preview (region and expanded) can be reached on Desktop.

Measure before changing anything; Desktop has no PTY, so write a probe mod under `.scratch/chat-toc-0.2/assets/23-desktop-scroll/` and have the user load it in the app. Questions the probe answers:

- Does Desktop raise `ui.scroll` for a wheel over a Pane, with what `by`, `offset` and `bodyRows`? Does `e.props.scroll.bodyRows` on Desktop match the rows really visible?
- If the scroll hook lets the person's scroll through (`next(e)`), does Desktop scroll a tree taller than the pane? If the hook swallows it (`{}`, as chat-toc does outside the expanded view), does the window stay put?
- Does a Box with a fixed `height` and `overflow="hidden"` clip on Desktop, and does anything scroll inside it?

A lead, not yet checked: chat-toc's `ui.scroll` hook takes every person's scroll that is not on the expanded view and moves its own window (`top`), on Desktop too, while the window's rows are counted as on the terminal. Desktop draws taller rows than that count (the `gap={1}` between blocks, the 2-row well, the Svg strip, the native field), so the tree overflows the pane while the hook swallows the host's scroll. Possible fixes depending on the answers: on Desktop draw the whole list and let the host scroll the tree (as the expanded view does); or keep the window and measure its rows by Desktop's heights.

Spec: [chat-toc 0.2](../spec.md) §8 (Scrolling).

**Blocked by:** none

**Status:** ready-for-human

Built; what is left is the user's check in the app (see Comments).

- [x] Probe written; the user's measurements recorded under the assets folder and in `docs/agents/mod-host-gotchas.md` (Claude Code Desktop)
- [x] On Desktop the scroll hook passes the person's scroll through (`next(e)`); the list is not windowed by rows; the terminal's window unchanged
- [x] The drawn part of the list is the newest entries within a serialized-character budget that keeps the tree well under 100,000 characters (Svg sources included); `↑ N earlier turns` at its top and, once moved, `↓ N later turns` at its bottom move it; a query or filter applies first
- [x] Element-tree tests on the `desktop` surface: a short session draws every entry; a long one draws the newest within budget with the `↑` Button, and the Buttons move the drawn part; the serialized tree stays under the cap for a 2,000-turn fixture
- [ ] The user scrolls to the first entry, uses `↑ earlier`, and scrolls through an expanded long preview in the app
- [x] `claude plugin test`, `tsc` on both versions and `claude plugin validate` pass

## Comments

The probe ([`scroll-probe`](../assets/23-desktop-scroll/scroll-probe/), log [`scroll-probe-desktop.log`](../assets/23-desktop-scroll/scroll-probe-desktop.log), screenshots `pass-plain.png` and `head-and-clip.png` beside it), the user's run in the Claude app (Claude Code 2.1.295, macOS), 2026-10-17. A docked Pane read `placement=dock`, `scroll.bodyRows=42`, `bodyColumns` 34–40 as the pane was resized; 42 rows of plain Buttons filled it (the row heights match `bodyRows`).

- **pass** (`next(e)`): the wheel raises `ui.scroll` (`origin: person`, `by` ±1 to ±5, `bodyRows` 42, `contentRows` 64 for 60 rows plus 4) and the host scrolls the whole tree to its end. With `gap={1}` between groups of three, the same.
- **swallow** (`{}`): the pane jitters and stays: the view moves and is put back.
- **own** (draw only `bodyRows` worth of rows, move them by `e.by`): nothing scrolls. With a tree that fits, one `ui.scroll` came in the whole run, so the plugin is never told of the wheel. This is chat-toc's case: its window fits the rows and its hook swallows, so the top entries can never come back.
- **clip** (`height` 10, `overflow="hidden"`, a border): the Box clips to its height; nothing scrolls inside it.
- **Heights**: the native `Select`, a non-plain `Button` and the `Input` each draw about 24 px tall (beside Svg rulers of 19–38 px). chat-toc's filter well is 32 px.

Decided with the user: on Desktop pass the scroll through and draw the newest entries within a character budget, with `↑ N earlier turns` / `↓ N later turns` Buttons (a seamless shifting window would need `next({ ...e, offset })` to be honoured on Desktop, not measured); the preview opens under the pressed entry (ticket 24). Spec §8 revised.

Built on `chat-toc-0.2/23-desktop-scroll` (2026-10-17):

- The Pane's `ui.scroll` hook answers the person's scroll with `next(e)` whenever the pane was last drawn on a surface other than the terminal (the event has no `surface`; `register.tsx` keeps the last render's in `paneSurface`). The terminal's window and its scroll handling are unchanged. On Desktop the ring's `reveal` (a move past the window's end) also goes where the host moves it, as there is no window to move.
- `hooks/span.ts` picks the drawn part: the newest entries whose reckoned characters fit `LIST_BUDGET` (50,000, in `desktop.tsx`), starting and ending on a Turn group's edge. `desktopList` in `desktop.tsx` reckons an entry from what it draws: each Svg source as it serializes, each line's Button, its rules and its gap. A group of two two-line sides costs about 3,300, so the Card layout draws about 15 groups; the rest of the tree (head, search row, strip up to 120 bars, preview with its Markdown up to 10,000) stays under 30,000. A 2,000-turn session with a long reply in the preview draws under 80,000 in every Layout (`tests/desktop_scroll.test.ts`).
- `↑ N earlier turns` / `↑ 更早的 N 轮` at the list's top moves the drawn part to end right above it; `↓ N later turns` / `↓ 更晚的 N 轮` at its bottom moves it to the run starting right below it, the newest again once that reaches the end. The drawn part is kept by its last Turn group, so new turns do not move it; a new query draws its newest matches again; the View filter and the query narrow the list first.
- Most of an entry's cost is the rail Svg's style sheet, repeated in every rail and gap Svg (about 400 of the 650 to 750 characters each of them serializes to). Sharing it, or drawing the gap without an Svg, would draw about half again as many groups per budget; left for ticket 24, which redraws Desktop's layout.

For the user to check in the Claude app (the last checklist item):

1. In a session longer than about 15 turns, scroll the pane with the wheel or trackpad: the whole tree moves, the first drawn entry and the `↑` Button can be reached, and the pane does not jitter.
2. Click `↑ N earlier turns`: earlier turns are listed, `↓ N later turns` shows at the bottom, and clicking it goes back to the newest.
3. Expand a long preview and scroll through it to its end, then `← Back`.
4. Type a query: the list narrows, and with many matches the `↑` Button counts the matches left out.

