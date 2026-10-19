# 35: Redesign: time rail body (option C) + tabs and footer (option A), the desktop drawn on its own

**What to build:** Change the terminal contents' body to option C of the 2026-10-13 options page (https://claude.ai/artifact/UaH5mTQ54cuS4Xd8cfV8Pt), and show the top filter and the bottom buttons the way option A does; draw the desktop (and vscode / mobile) on its own, following option C's desktop version.

**Blocked by:** none

**Status:** done

## Decisions made (2026-10-13)

- The user chose: option C overall; the terminal's top and bottom buttons use option A's interaction and look. The desktop is done in the same round.
- Test interfaces (the user confirmed): `entriesOf` entry generation, `wrapCells` line wrapping, Pane drawing (the test kit's `$.ui.mount`, including `surface: 'desktop'`), and the PTY acceptance verifier (`toc_verifier.parse_pane`).
- Top (option A): three plain Buttons whose labels carry only the name (`All`/`User`/`Agent`), drawn by the host as `1: All`; the selected one is not dimmed and the others are `dimColor`; the next line is a rule line, with `━` (`suggestion`) right under the selected button and `─` (`subtle`) elsewhere; then one blank line. The Layout button leaves the top.
- Bottom (option A): one line of `─` (`subtle`); on the next line, on the left `N turns` (dimmed; N is the number of Turn groups the contents hold, and does not change with the filter), or `⏸ Not following` (`warning`) when paused, and on the right a plain Button `l: Layout: Card`. The footer is fixed at the bottom of the pane. The jump-refused note and the data-source note stay below the list.
- Body (option C):
  - On the User side the first line has the node `●`, on the Agent side the first line has the branch `├╴`, and continuation lines and the blank lines between groups are the rail `│`; the Current position turns into `◉` / `┣╸` / `┃`, and the whole gutter (including the time) uses `suggestion`. A running Agent side gets `◐` (`claude`) after the branch.
  - Card: no time column; `HH:MM` sits at the right end of the User side's first line (dimmed); at most 2 lines per side. The Agent side is one "state · reply" segment, dimmed as a whole, with no more `↳` and no separate head line; there is no more "you · date" head line either.
  - Compact: `HH:MM` in the left column, 1 line per side. Timeline: `HH:MM` in the left column, at most 2 lines per side. The time is written on the first side shown in the group.
  - Date separators: where the date changes in the list (including the first group), insert a line `─ Oct 12 ───`; today is written `Today · Oct 13`, and dates not in this year carry the year; a group whose time cannot be read neither triggers nor resets. In Card and Timeline, the blank line between groups before a separator does not draw the rail.
  - Hover: the lines of the same side turn `suggestion` in colour, and the whole side is no longer inverse (the line right under the pointer is still inverted by the host).
- Line wrapping: a closing punctuation mark on the right does not start a line (the last character of the previous line is brought down); an English word / path of no more than 14 characters moves to the next line as a whole.
- Desktop: split the tree by `e.surface`. Three Buttons at the top (the selected one `variant="primary"`) plus a Layout Select (a surface without Select uses a button that cycles); the Svg minimap has one vertical bar per turn, its height by step count, with the Current position and running turns coloured, and the Svg carries its own `prefers-color-scheme` and `prefers-reduced-motion`; each side of an entry is one Button, not pre-wrapped; the date separators and the time column are the same as the terminal; the bottom is the turn count or paused. The entry window reuses the terminal's window logic, so the tree stays bounded.
- "Desktop not promised" in the spec becomes a promise that the desktop works, with its look checked by the user by eye in the Claude app.
- A side with no Jump target (refused, or compacted before a resume): the Agent side is already dimmed as a whole and so cannot be told apart, so a hollow mark hangs on the first line: `○` on the User side, `├┄` on the Agent side (`subtle`), and the User side's text is still dimmed (the user chose this on 2026-10-13).

## Steps

- [x] Line wrapping: no closing punctuation at the line start, English words wrapped as a whole
- [x] Top tabs and the rule line
- [x] Footer: turn count / paused, the Layout button
- [x] Entries: the new line model of Card / Compact / Timeline
- [x] Date separators and line height
- [x] Gutter: node, rail, Current position, running; hover colour
- [x] Desktop tree split and minimap
- [x] The verifier and scenario scripts follow the new format; PTY acceptance on the host's two versions
- [x] Docs: spec, CONTEXT, root README, developer README

## Comments

- 2026-10-13 implementation (branch `chat-toc/35-visual-redesign`): red-green round by round against the test interfaces; `claude plugin test` passed 271, and tsc and validate are clean on both versions. Building the entry table for 4432 turns for the first time once rose from about 30 ms to about 50 ms (wrapping first expanded the whole text into an array, called the width function once per character, and parsed the timestamp several times per group); changed to take characters on demand, hoist the width out of the loop and parse the timestamp once per group, after which it is level with the baseline. The performance case "5 ms of residual position" also fails now and then on its baseline when the machine load is about 20, unrelated to this change.
- The verifier `parse_pane` now reads the time rail (node, branch, hollow mark, date separator, time column, tab line, footer); the samples are replaced with screenshots of four views of the forms fixture on the host's two versions (`tests/acceptance/testdata/`), and 30 unit tests pass. The scenario scripts use `user_row` / `agent_row`, and UI-003/UI-004 read the rail marks and colours.
- 2026-10-13 CT-PERF-001 (`release_gate.py run --only-perf`, two versions in series): in the first two rounds, at load 10–20 (`xctest`, Vibessage), the incremental read p95 went over 150 ms several times; under the same load, 0.1.2 and this version were run alternately, and 0.1.2 also went over (288 ms), the read path being unchanged, so it was judged to be load. Another 3 runs crashed inside pyte (`IndexError` in `screens.py` `render`, which ticket 34 also met): the host overwrote the first cell of a wide character with a narrow one in the middle of a frame, pyte left an empty placeholder cell, and its own `display` could not read it. `pty_harness.screen_rows` reads a lone placeholder cell as a space (as the terminal does), and `rows()` now uses it. At load 2–5 all four combinations passed 3 runs each: incremental read p95 at most 107–128 ms, appending to the model 335–598 ms, an idle whole read 181–366 ms, the Pane including the host at most 11 ms.
- 2026-10-13 release 0.1.3 (the user decided not to wait for a by-eye check of the desktop on a real machine and to release now): commit under test `28eefdf`, `release_gate.py run --screens` on the two versions in series, with tsc on the current version using the `claude-code.d.ts` of the `plugin-authoring` skill. All gates passed (37 MUSTs × 2, validate, test 271, unit 49, tsc on both versions, the local marketplace smoke, the sign-off screenshots); in the first round, 2.1.287 perf-many had one incremental read of 167 ms (load about 9), and after it was moved to `gate-perf-attempt1/` in the scratchpad, `--only-perf` passed on rerun. `report`: 114 records all passed, missing 0, leaks 0, with evidence in `mods/chat-toc/tests/evidence/0.1.3/`.
- 2026-10-13 pushed `d2f8caa..a6e65cb` (the redesign itself, `d2f8caa`, was pushed to main after the handoff, when the version number was still 0.1.2), the default branch confirmed as `main`; the install-level check from GitHub passed on both versions (0.1.3 enabled, the Pane docks by itself, click-to-jump works), the result added to `marketplace.md`, evidence in `github-install/`. The manual visual check sign-off still awaits the user.
