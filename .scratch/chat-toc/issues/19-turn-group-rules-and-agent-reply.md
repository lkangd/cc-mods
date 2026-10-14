# 19: The full grouping rules and the Agent reply

**What to build:** Every entry in the contents fully reflects one round of conversation: slash commands and `!cmd` each open a group too, and notifications, command output, interruption markers and the like fold into the current group. The Agent side shows the step count and the last text reply, with a clear label for running, interrupted, error and no text reply.

Spec: [chat-toc MVP](../spec.md) §4, §7 (Card layout).

**Blocked by:** 17 (The minimal docked contents)

**Status:** resolved

- [x] Opening a group: human text or an image, a slash command user row, a `system/local_command` row holding `<command-name>`, `<bash-input>`; excluding `isMeta`, `isCompactSummary` and tool_result
- [x] Not opening a group, folding into the current one: task-notification, `<local-command-stdout|caveat>`, `<bash-stdout>`, `[Request interrupted by user…]`, the compact summary, hooks and reminders
- [x] User-side text: a slash command is restored to `/name args`, a `!` line is written `!cmd`; code blocks, images, Markdown marks and `<pasted_content>` tags are removed and whitespace collapsed; an image-only input is written "(image only)"
- [x] Steps = the number of main-loop `tool_use` blocks in the group (parallel calls counted one by one, a subagent counts 1 step, 0 is not shown); the last text = the text blocks after the last `tool_use`, joined into one passage when they share a `message.id`
- [x] Agent side: "N steps" plus 2 lines of the last text; "N steps · No text reply"; "Interrupted · N steps"; "Error · N steps"; the last group between `turn.start` and `turn.complete` reads "Running · N steps" and counts up live
- [x] A group with only a user side (a local command, a `!cmd` with no agent work) draws no Agent side
- [x] Wrapping and truncation by terminal cell width (a full-width character takes 2 cells, the last line gets `…`); multi-line text, CJK and emoji are all correct
- [x] The time is the User input row's `timestamp` converted to local time, formatted "Mon D HH:MM" (Oct 9 style), with the year added when it is not this year; a fixture with the timestamps removed shows no time
- [x] Subagent content stays out of the TOC
- [x] Automated tests cover the rules of CT-TURN-001 to 005 and CT-DATA-005

## Comments

2026-10-10, branch `chat-toc/19-turn-rules`.

- **Code**: the grouping rules, the user-side text, steps, the last text, the outcome (`done`/`interrupted`/`error`) and `hasAgentReply` are all in `hooks/groups.ts`. Each group looks only at its own rows (from its opening row to the next opening row), so ticket 22's incremental regrouping still holds; the random sessions in `tests/incremental_regroup.test.ts` now include commands, `!cmd`, interruptions and API error rows. The card's Agent side is in `hooks/entries.ts` (`agentHeadOf`); a blank line separates groups only, not the two sides of one group (`hooks/pane.tsx`).
- **Running**: `turn.start` sets the flag but does not redraw at once; it waits until the first rows of this turn are read before drawing, so the previous group does not flash "Running". After `turn.complete` the flag is cleared only once the next read finishes, so "No text reply" does not flash before the last text is read. When a hot reload happens in the middle of a turn, that turn no longer shows "Running" until the next turn starts (module state).
- **Trade-offs** (where the spec does not say):
  - A group with no assistant row in the file and no interruption (a prompt just submitted, its reply not yet written) draws no Agent side; while the turn is running it draws "↳ Running".
  - A reply that ends normally with 0 steps gets just "↳" in its head line, with nothing added.
  - An interrupted, errored or running group that has a last text also draws that text's 2 lines as the file has it (for an error this is usually the `API Error: …` text).
  - Markdown stripping: a single `*`/`_` is removed only when it wraps a word; wildcards such as `*.md` are kept; an input of pure code blocks falls back to showing the code itself; `[Image #n]` placeholders are removed as well.
  - The Agent side's Jump target is for now the row holding the last text, else the group's last assistant row, else the opening row; the full candidates and the refusal rules are left to ticket 23.
- **Tests**: `claude plugin test mods/chat-toc` 80 all pass (2.1.295); `tsc` passes against both the 2.1.287 and 2.1.295 declarations; `plugin validate` passes on both versions.
- **PTY** (cmux, its own workspace, synthetic transcript `scratchpad/p19/gen19.py`, other plugins off): on both 2.1.295 and 2.1.287, `--resume` showed: `/tui` (a system row) and `!echo` with only a user side; `/review src/a.ts --quick` restored; "↳ 3 steps" plus a last text joined from two passages of one message; "↳ 2 steps · No text reply"; "↳ Interrupted · 1 step"; "↳ Error · 1 step" plus the error text; `<pasted_content>` tags, code blocks and Markdown marks removed, CJK/emoji wrapped correctly; a reply after a notification counted as the group's last text; the time in local form "Oct 10 09:01". Each version also ran one round of a synthetic prompt (haiku, 3 times `sleep 2`) and showed "↳ Running", then "Running · 1 step", "2 steps", "3 steps", and after the end "↳ 3 steps" plus `ok`. Note: the wheel sequences cmux sends are taken as Escape, so scrolling the Pane mid-turn interrupts that turn (the first trial run was interrupted this way, and the contents showed "Interrupted · 4 steps" truthfully).
