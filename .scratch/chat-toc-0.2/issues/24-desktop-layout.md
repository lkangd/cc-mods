# 24: Tidy the Desktop pane: head row, search row, preview set apart

**What to build:** The Desktop pane's look, from the user's look in the Claude app (2026-10-17, ticket 19):

- **Head row**: the segmented control (All / User / Agent) is taller than the Layout `Select` (`Card ⌄`). Make the two the same height and centred on one line: the native `Select`, `Button` and `Input` draw about 24 px tall, the well 32 px (ticket 23's measurements).
- **Search row**: the field, the `show` button, the count and a new `✕` line up with the head row, flush with its left and right edges, in one height. The `✕` is a Button drawn only while there is a query; a press empties the query (as the terminal's `✕` does).
- **Preview under the pressed entry, set apart** (user's decision, 2026-10-17): the preview no longer sits at the bottom; it opens right under the pressed Turn group's last entry, like an accordion, on a background of its own (or a border) so it does not read as more entries, its `✕` at its top right. Another press moves it. A group the filter or query leaves out, or one outside the drawn part of the list (ticket 23), shows it at the list's top. Expanded still takes the list's place.
- **Closed until a press**: drawn from ticket 22's state: nothing until an entry is pressed or the search is submitted (Enter or `show`), which opens it on the nearest match.

- **Back to the top** (user's decision, 2026-10-17, after the look at tickets 22 and 23): the host scrolls the whole tree, so the head and search rows scroll away and nothing can stay pinned (ticket 23: a fixed-height Box clips but does not scroll). Give a way back up: a plain Button that scrolls the pane to its top with `$.ui.scroll({ to: 'start', in: <pane id> })` (or `{ to: { key: FIRST_CONTROL } }`). **Probe first** on Desktop: whether `$.ui.scroll` of the plugin's own pane is allowed there (the transcript's is refused), from a press and from a timer. Also whether `{ to: { key }, block: 'nearest' }` brings an opened preview into view after a press, which the accordion may want. Where the Button sits (the list's end, beside the `↑ earlier` Button, or after every N groups) is decided with the user once the probe answers; if the scroll is refused, record it and drop the Button.

A throwaway prototype of the head and search rows and of the preview's frame is worth showing the user in the app before the real change (`mattpocock-skills:prototype`).

Spec: [chat-toc 0.2](../spec.md) §8 (Search, Preview, The head row).

**Blocked by:** 22, 23

**Status:** resolved

- [x] Segmented control and Layout Select the same height, centred on one line (native filter Buttons, the user's choice); light and dark still to look at in the app
- [x] Search row aligned with the head row; `✕` while there is a query, empties it
- [x] Preview opens under the pressed entry, set apart from the list, with `✕`; closed until a press; `show` / Enter opens it on the nearest match
- [x] More turns in the drawn part (one rail Svg per run of entries between rules, its style sheet written once; at most 215 rows per Svg, the host's 4,096 px; a page of 200 Card groups now draws about 49, was 15): ticket 23's 50,000-character budget holds about 15 Card groups, a third of each group's cost being the rail Svg's style sheet repeated per entry and gap. Cut the cost (e.g. one rail Svg beside a column of entries, or shorter styles) so a page holds several times as many groups
- [x] Probe: `$.ui.scroll` of the own pane on Desktop (`'start'`, `{ key }`), from a press and from a timer; recorded under `.scratch/chat-toc-0.2/assets/24-*/` and in `docs/agents/mod-host-gotchas.md`
- [x] A back-to-the-top Button at the list's end (`↑ Back to top` / `↑ 回到顶部`), scrolling with `{ to: 'start', in: PANE_ID }`
- [x] Element-tree tests on the `desktop` surface
- [x] The user looks at it in the app and the findings are recorded here
- [x] `claude plugin test`, `tsc` on both versions and `claude plugin validate` pass (474 tests; verify-startup.sh)

## Comments

### 2026-10-17: `$.ui.scroll` probe on Desktop

Probe and logs in `assets/24-own-scroll/` (`run1-desktop.log`, `run2-desktop.log`), Claude app, Claude Code 2.1.295; recorded in `docs/agents/mod-host-gotchas.md`. The user watched the pane at each step.

- **Allowed.** `{ to: 'start', in: PANE_ID }` and `'end'` scroll the plugin's own pane from a press, from a timer after a press (500 ms, 1 s, 4 s, also after the person scrolled in between) and from a command. A back-to-the-top Button works.
- `{ to: { key } }` works for a Button that earlier draws already held (`row70`, `nearest` and `start`). It is refused for a `Text` or `Box` key (`no element of its own is drawn under that key`), so `{ key: FIRST_CONTROL }` must name a Button, and `'start'` is simpler.
- Bringing a just-opened preview into view is **not reliable**: its Box, its title Text and its `✕` Button were all refused 300 ms after the press, except one `✕` try in nine. The user saw it come into view now and then, but most of the time it did not. Scrolling to the pressed entry's own Button (drawn before the press) with `block: 'start'` should work, as `row70` did; this was not tried with a preview under it.
- The call answers `{}` before the window moves: a render at once still shows the old offset, one 500 ms later the new one.
- **User's decisions** (2026-10-17, after the probe): the back-to-the-top Button sits at the list's end, after the last entry (beside the `↓ N later turns` Button when that is drawn), and scrolls with `{ to: 'start', in: PANE_ID }`. A press that opens the preview does not scroll: it opens under the entry, and when it falls below the pane's edge the person scrolls to it.

- **The prototype's look** (user's decision, 2026-10-17; prototype on the branch `chat-toc-0.2/24-prototype`): the head row of variant C, the three filters as native Buttons, the chosen one `variant="primary"`, beside the Layout `Select`, all one native height; the preview of variant A, a Box with `borderStyle="round"` and `borderDimColor`, `paddingX={1}`, its first row `Preview` in bold with the `✕` at its right end. Variant B's filled Box (`backgroundColor`) and C's ruled, indented preview were not chosen.
- **Expand flickers on Desktop** (the user's look, 2026-10-17): a press on the cut line shows the expanded preview for a fraction of a second, then the region again. Likely cause: `ui.render`'s `isFocused` goes false when the pressed Button leaves the tree, and the terminal's "leaving the Pane returns to the region" rule (register.tsx, `wasFocused && !isPaneFocused`) collapses it. Under test in the prototype: the rule kept to the terminal, focus changes logged.
- **Clicks needing two presses on Desktop** (the user's look and the prototype's focus log, 2026-10-17): when the focused Button leaves the tree (the preview's `✕`, the cut line, `← Back`, `↑ earlier` / `↓ later`), the pane loses the focus, and the next click only gives it back (`ui.focus`, no `ui.press`). The terminal's "leaving the Pane returns to the region" also collapsed the expanded preview at once. Fixed in the prototype, confirmed by the user: that rule kept to the terminal; on the desktop the focus is moved with `$.ui.focus` to a Button the next drawing keeps: `✕` → the preview's entry (or `↑ Back to top` when not drawn), first or once the list is back from expanded; the cut line and `← Back` share one key; `↑ earlier` / `↓ later` → once redrawn, the entry just above / below the old part. The refusal alert's flashing was not the cause.
- **User's decisions on moving the list** (2026-10-17): `↑ earlier` / `↓ later` close an open preview (its group leaves the drawn part, the contents and the list would not match), replacing "shows it at the list's top". Reaching the list's first entry draws as many groups as the budget holds from there, not the leftover few (`spanEndingFilled` in the prototype).
- **Desktop's refused jump** (user's decision, 2026-10-17): no alert. The press tries the jump silently; once refused as unscrollable, the session stops trying.
- The prototype is kept on the branch `chat-toc-0.2/24-prototype` (4100c4b, committed with `--no-verify`: six element-tree tests fail against its looks). Spec §8 updated with the decisions above.
- **The user's look at the real change** (2026-10-17): the head and the preview fine. Two findings: (1) in a narrow pane the search row's count wrapped onto three lines and pushed the `✕` out: the count and `✕` now keep their width and the field gives way; (2) on the terminal the preview must never open by itself, only when the person asks: a press or Enter on an entry jumps and selects it; a row under the selected entry carries `p: Preview · r: Reuse · c: Copy` Buttons with those hotkeys (user's choices: both `p` and a Button; `c` copies the selected side; the row under the entry, not the footer or the line's end). Spec §2, §3 updated.
- **Accepted** by the user in the app (2026-10-17), after the search row fix and the terminal's preview opened only on the person's ask.
