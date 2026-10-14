# Draw the three Layouts with label-only Buttons

Type: prototype
Status: resolved
Blocked by: 

## Question

On 2.1.287 a `Button` takes only a `label` (or a single string child), so the prototype's card entries drawn with several `Text` children error on the minimum version (see "Measure the cost of reading and drawing a long session"). On the premise that it draws, takes clicks and inverts on hover on both 2.1.287 and the current version, how are the entries of the Card / Compact / Timeline Layouts drawn: can the dim "you · time" and "↳ N steps" header lines be coloured apart from the body (one Button per line sharing one jump, or one multi-line label for the whole entry); do the cyan highlight bar, the Timeline's time column and `│`, put in a `Text` outside the Button, line up; can the selection cursor (the host's inverse) and the highlight still be told apart at a glance; on which Button does the ↑↓ focus land. Show the two versions side by side to the user and settle how each Layout is drawn.

## Answer

**Verdict (confirmed by the user, 2026-10-09): all three Layouts are drawn with "one Button per line" (S2). Each line of each entry side is its own `plain` Button whose content is that line's string, and all the Buttons of one side share one jump. On hover a hover scope inverts the whole side together. The highlight bar, markers and the time column go in a separate `Text` to the left of the Button.** This draws on both 2.1.287 and 2.1.295, takes clicks on both, and keeps the dim header line in the card.

### How it was tried

The prototype mod `toc-btn` (7 static sample groups, no transcript read) ran in cmux side by side: 2.1.287 on the left and 2.1.295 on the right, both in the fullscreen layout, with the other local plugins turned off and no model call at all. 3 ways of drawing × 3 Layouts were tried, at Pane widths of 44 and 81 columns. All nine combinations drew on both versions, and no tree was refused.

- **S1 one Button for the whole entry**: one multi-line `label` per side. The header line cannot be dimmed on its own and has the body's colour.
- **S2 one Button per line** (chosen): the header-line Button gets `dimColor` and the body Button uses the default colour. Each line's key is `<entry key>` and `<entry key>.<line number>`, with the same `onPress` and `hover: { scope: 'e-<entry key>', inverse: true }`.
- **S3 header-line Text + body Button**: the header line is a dim `Text` carrying the same hover scope; the body is one multi-line Button.

### The way of drawing settled on (for the implementation and `CT-UI-002` to cite)

1. **One Button per line, one shared jump per side**: the Card layout's header lines ("you · time", "↳ N steps" and so on) use `dimColor` and the body uses the default colour. In the Compact layout and the Timeline, the Agent line is `dimColor` as a whole line. A side that dims after being refused has `dimColor` on all its lines.
2. **Hover lights the whole side**: all lines of one side share one hover scope (`inverse`), and pointing at any line inverts the whole side. The user chose "light together" over lighting only one line. The scope also works on 2.1.287.
3. **The left column is outside the Button**: each entry is drawn as a `Box` (row) line, with a multi-line `Text` on the left of uniform width (2 columns for Card and Compact, 8 columns for the Timeline: `HH:MM`, a space, `│`/`┃`, a space) and a column of Buttons on the right. Both versions line up. Indentation (for example the two spaces of the Card's Agent body) is written in the Button's text, not in the left column, so the left column keeps one width.
4. **Selection cursor**: ↑↓ put the focus on the entry's first-line Button (key equal to the entry key). In the Card it lands on the header line; in Compact and the Timeline it lands on the only line or the first line. The user could tell the host's inverse cursor from the cyan highlight bar at a glance.
5. **The highlight is no longer bold**: a Button has no `bold`, so the "highlighted group in bold" of prototype 05 is dropped. The highlight rests only on the cyan `▌`, `●` and `┃`.
6. **Wrapping and truncation are done by the mod**: each line is first wrapped and cut by cell width (full-width counts 2 cells, the second line ends with `…`), then handed to the Button. A Button does not wrap for us.
7. **The View filter row**: three `plain` Buttons whose content is a single string (`●All`, `○User`, `○Agent`), hotkeys 1/2/3. On 2.1.287 too they take clicks and switch by hotkey (tried by the user).

### Other observations

- 2.1.287 draws the Pane's ✕ at the right of the first line of content, on the same line as the filter row ("Decide how to share the dock with other Panes" has noted it). About 3 columns have to be left at the right of the filter row.
- A local variable named `h` in the prototype hid the JSX global `h`, so `ui.render` reported `h is not a function`. Do not use `h` as a variable name in the implementation.
- Side by side, each side had under 144 columns, and the prototype's Pane was opened by hand with `/bt`; the placement rules for opening by itself are outside this ticket.

### Assets

[assets/15-buttons/](../assets/15-buttons/): `toc-btn/` is the prototype mod. Start it with `claude --plugin-dir .scratch/chat-toc/assets/15-buttons/toc-btn` and open the Pane with `/bt`; with the Pane focused, `s` switches the way of drawing, `v` the Layout, `h` moves the highlight, `o` switches between lighting together and lighting one line, and `1`/`2`/`3` switch the filter; `/bt s1|s2|s3|a|b|c|w <columns>` also works.
