# 18: The independent verifier and the PTY acceptance driver

**What to build:** Set up the acceptance tools the later tickets share: an independent verifier that shares no implementation with the plugin and works out the expected Turn group sequence straight from the transcript file's conversation chain, then compares it with the entries the Pane actually lists; a real-host PTY acceptance scaffold driven by cmux, able in an isolated environment to start a fullscreen session on 2.1.287 and on the current version, `--resume` a synthetic transcript, click, wheel, send commands and read the screen; and a synthetic fixture generator (including the two 20 MiB kinds, many and heavy). The drivers, generators and pyte screen-reading code in the decision tickets' assets can be reused.

For the spec see [chat-toc MVP](../spec.md) "Testing Decisions".

**Blocked by:** None (can start at once)

**Status:** resolved

- [x] The verifier independently implements the conversation chain (`parentUuid`, with the compaction boundary following `logicalParentUuid`) and the opening rules, and outputs the expected entry sequence
- [x] The verifier can read the entries the Pane actually lists (by reading the screen or through a test view the plugin exports) and give a difference per entry
- [x] The PTY driver can start a fullscreen session on both versions with an isolated configuration (the other local plugins turned off), load the plugin with `--plugin-dir`, and supports click, wheel, typing commands, reading the screen and archiving screenshots
- [x] The synthetic fixture generator can produce plain prompts, slash commands (both kinds of rows), `!cmd`, compaction, a rewind branch, subagents, interruptions, errors, no timestamps and other forms, plus the 20 MiB many (about 4400 turns) and heavy (about 110 turns, large tool results)
- [x] Only synthetic prompts, with no real conversation content; the model is called as little as possible
- [x] Each run produces a traceable log whose fields can go straight into the release report (scenario ID, expected, actual, result, evidence link)

## Comments

2026-10-10, implemented in `mods/chat-toc/tests/acceptance/` (branch `chat-toc/18-harness`):

- `toc_verifier.py`: independently implements the conversation chain and the opening rules and outputs the expected entries; reads the Card Layout's Pane window (`parse_pane`), compares entry by entry (`compare_window`), and after scrolling through the whole list checks coverage (`compare_windows`). Two points the spec does not pin down are taken literally: an errored turn's API Error text counts as the last text; a plain prompt with no assistant row at all shows "No text reply" on the Agent side.
- `transcript_fixture.py`: `forms` (every row form the spec names), `turns N`, `many` (20 MiB, about 4500 turns), `heavy` (20 MiB, about 108 turns); fixed seeds, reproducible byte for byte.
- `pty_harness.py`: an isolated HOME/CLAUDE_CONFIG_DIR (no login, no local plugins loaded, fullscreen), `Host("2.1.287")` goes through the npx cache; two terminals, pyte and cmux; `Run` writes `run.jsonl` (scenario ID, version, OS, architecture, fixture, expected, actual, result, evidence) and a screenshot of every screen to `mods/chat-toc/build/pty-runs/` (gitignored).
- 40 unit tests (`python3 -m unittest`). End to end, with prototype 05 turned into a label-only stand-in (only in the scratchpad, not committed): under pyte, the `smoke` on 2.1.287 and on 2.1.295 (40 turns, 18 windows of the whole list agreeing entry by entry, a click on T0000 jumping successfully) both pass; under cmux, 2.1.287 passes. With the `forms` fixture the verifier correctly pointed out a wrap misalignment caused by the stand-in counting ✨ as 1 cell, and every other form agreed.
- After merging the 17 tracer, `smoke` against the real plugin (pyte, 2.1.287 and 2.1.295): Pane recognition, whole-list reading and the click-on-T0000 jump all work; the verifier reports what the tracer has not yet done (no Agent side; the `/tui` of `system/local_command` and `!cmd` open no groups, which throws off the entries after them), left for ticket 19, with the criteria ready.
- The verifier is aligned with ticket 19's trade-offs: a group with no assistant row and no interruption draws no Agent side; `[Image #n]` is removed; an input of only a code block shows the code itself (no conflict with the spec). Also fixed: on 2.1.287 the ✕ drawn on the first line of content was read as an entry header.
- After merging 19, run again against the real plugin (pyte, synthetic `--resume`, no model call): `turns` 40 turns passes on both 2.1.287 and 2.1.295 (whole list agreeing, click-on-T0000 jump successful). Under `forms` the verifier reports two things: groups from before the compaction do not show (the plugin does not follow `logicalParentUuid`; that is 21); `✨` (U+2728) is counted by the plugin's `hooks/cells.ts` as 1 cell while the host wraps at 2 cells, so F02's user side gets an extra third line with no left column (a real defect for CT-TURN-003). With the compaction removed, every other form agrees on both versions.
- Known limits: under cmux, the wheel sent with `cmux send` makes the stand-in Pane's window jump back and forth, so cmux does not read the whole list by default (`--whole-list` turns it on); the whole-list comparison goes by pyte. The cmux split width is not controlled, and with under 144 columns the smoke asks for docking with `/chat-toc`. A command cheat sheet is in the shared note `pty-harness.md`.
