# Measure how requestId maps to transcript rows

Type: task
Status: resolved
Blocked by: 

## Question

On the local Claude Code in the fullscreen layout, use a log-only dev mod to print `e.requestId` at the `UserMessage`, `AssistantMessage` and `CommandOutput` sites of `ui.render`, and compare it with the `uuid` and `message.id` of the matching rows in the current session's transcript file. Cover a plain prompt, a prompt-type slash command, a local slash command, `!cmd`, a multi-block assistant reply, rows from before a compaction, rows before and after a rewind, and rows that came back with a resume. Record: which field `requestId` equals; how many `requestId`s a multi-block reply has; which site draws a slash command and `!cmd`; whether rows from before a compaction and rows thrown away by a rewind can be reached with `$.ui.scroll` (started from a docked Pane's Button). Also measure what `props.onScreen` really reports in fullscreen interaction (which sites receive it while scrolling, and whether `null` and the visible row counts agree with the screen). Produce the mapping rules and the measurement record; cmux can drive the PTY. This ticket's result decides whether the Current position highlight stays in the MVP (see "Decide whether to highlight the current position"): it must settle whether `onScreen` is reported reliably while scrolling, whether `first`/`last`/`of` agree with the screen rows, whether a row cut off at the top gives `first > 0`, and whether the bottom can be judged by `last === of - 1`.

## Answer

**Verdict: `requestId` is the `uuid` of that row in the transcript file. `onScreen` reports reliably while scrolling, and its numbers agree with the screen row by row. Every precondition for the Current position highlight holds, so it can stay in the MVP.** But a batch of rows has no drawing site to hook, so they get no Jump target.

### How it was measured

- Local Claude Code 2.1.295, fullscreen layout (`/tui` printed `Current renderer: fullscreen`), a 170×44 pseudo-terminal, `--model haiku`. The screen was read with a pyte terminal emulator; clicks and the wheel were SGR mouse sequences. Two processes ran: one new session and one `--resume`. The resume run used `--settings` to turn off the locally installed prompt-history, because after a resume it intercepts prompts.
- The probe mod only logs: at the sites `UserMessage`, `AssistantMessage`, `CommandOutput`, `ToolUse`, `ToolResult`, `ToolGroup`, `TurnDuration`, `InfoNotice`, `PromptHint`, `SessionMode` and `ToolProgress`, it records every change of `requestId`, `origin` and `onScreen`. A separate docked Pane has one Button per site; a press calls `$.ui.scroll({ to: { requestId }, block: 'start' })` and notes the result.
- Attachments: [the probe mod, driver scripts and comparison scripts](../assets/09-request-id/), [the log of each run](../assets/09-request-id/logs/), [a summary of the transcript rows](../assets/09-request-id/transcript-rows.txt).

### Mapping rules

| Case | Drawing site and `requestId` | Can the docked Pane jump to it |
|---|---|---|
| Plain prompt | `UserMessage`, `origin.kind = composer`, `requestId` = that user row's `uuid` | Yes, `{}` |
| A reply with tool calls in the middle | Each text block is its own row in the transcript with its own `uuid`, and its own `AssistantMessage` (`requestId` = that row's `uuid`); in this run every text block had `isFirstOfReply` `true`. Tool calls are drawn in a `ToolGroup`, whose `requestId` looks like `collapsed-<prefix of the first tool_use row's uuid>` | Text blocks all jump |
| Local slash command (`/tui`, `/probe`) | At the moment of submit there is a `UserMessage` whose `requestId` is the literal `"placeholder"` (an optimistic stand-in; several inputs share this id). The command echo row that finally lands, `❯ /tui`, **has no site to hook**; the output row is a `CommandOutput` whose `requestId` = the `uuid` of the stdout row in `system/local_command` | The echo row cannot be jumped to; the `CommandOutput` can (it lands one row lower than the echo row); `"placeholder"` is refused: `nothing drawn under that requestId` |
| Prompt-type slash command (project command `/hi`) | Likewise only `"placeholder"`; the user row holding `<command-name>` has no site; the reply's `AssistantMessage` is normal | The User side cannot be jumped to, the Agent side can |
| `!cmd` | The two rows `<bash-input>` and `<bash-stdout>` show on screen as `! echo …` and `⎿ …`, with **no site to hook**. In this run, after `!echo` finished the model went on to reply with a paragraph under the `bash-stdout` row; the cause was not looked into | Neither row can be jumped to; the reply after them can |
| `/compact` (run live) | `UserMessage`, `origin.kind = unclassified`, `requestId` = the `uuid` of the user row whose text is `/compact` | Yes |
| Rows from before a compaction, in the current process | Drawn as usual, `requestId` unchanged | Yes (checked on two compactions) |
| Rows from before a compaction, after a resume | Only the last reply before the compaction is drawn (`FIVE-DONE` and its `TurnDuration`); earlier rows and that prompt are not drawn; the compact summary (the `isCompactSummary` row) is not drawn as an `AssistantMessage`; after a resume, `/compact` shows as a `<command-name>` row, with no site | Rows that are drawn can be jumped to; rows not drawn are refused: `nothing drawn under that requestId` |
| Other rows that came back with a resume | `requestId` is still the `uuid`, same as in the original process | Yes |
| Rows thrown away by a rewind | A rewind fires no event (no `session.end`/`SessionStart`), the transcript is still the same file, and no new row is written at that moment; the next prompt's `parentUuid` points back to the fork point | Refused: `nothing drawn under that requestId` |

- Every jump was started by a Button click in the Pane, so it was started by the person; success always returned `{}`, and the target landed at the top of the viewport. The top row of the fullscreen layout is the host's pinned prompt bar, so the target message's row 0 (a blank row) lands on screen row 1.
- Subagents are outside this ticket.

### `onScreen` measurements

- At first draw `onScreen` is `undefined`; it turns into a concrete value right after layout; it becomes `null` on leaving the viewport; render reruns only on a change.
- Scrolling with the wheel and comparing with the screen: `first`/`last`/`of` agree with the on-screen rows row by row. `of` includes the blank row above the message (row 0); a message cut off by the top of the viewport gives `first > 0` (for example `25-26/27`); one cut off at the bottom gives `last < of - 1` (for example `0-23/27`). The pinned prompt bar belongs to no site and is not counted.
- The `onScreen` of the `"placeholder"` site stays at its old value and must be ignored.

### Points for the implementation

- **A render hook cannot write `$.state`**: the write is refused (`state.set: denied: it was made while ui.render is being dispatched, and drawing is pure`), the whole hook is skipped, and the engine draws on its own. So "a transcript site receives `onScreen` → make the Pane redraw" cannot go through an atom write. Both 2.1.287 and 2.1.295 have `$.ui.invalidate('ui.render')`, but it reruns every `ui.render` instance this plugin matches, including every hooked transcript row; in a terminal, at most 30 times a second. Whether that is workable and what it costs was not measured; it goes to another ticket.
- Under `--plugin-dir`, editing a file hot-reloads: module variables are cleared, `session.start` fires again, and the visible rows are redrawn.


## Later revisions

- Measured in "Prototype the docked TOC Pane's look and interaction": a `ToolGroup`'s id is sometimes `collapsed-<first 24 of the uuid>000000000000`, so match on the first 24 characters; the fullscreen transcript is virtualised, and an unmounted row does not always report `onScreen: null` again; `$.ui.scroll` can jump to rows that were never drawn. See [05](05-prototype-toc-pane.md).
