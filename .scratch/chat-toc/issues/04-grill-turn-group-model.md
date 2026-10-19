# Define the Turn group's split and edges

Type: grilling
Status: resolved
Blocked by: 01

## Question

From the host's primitives, what are the exact rules for splitting Turn groups: which inputs count as User input (slash commands, `!` shell, a queued submission withdrawn, paste placeholder text, multi-line input); how inputs without an agent reply, like slash commands, group and show; the exact definitions of the Agent reply's "last text" and "steps" (subagents, parallel tools, thinking blocks); the in-progress, interrupted, error and no-text-reply states; how Turn groups and Jump targets rebuild or lapse after `/clear`, compaction, rewind, resume and fork; how entries that cannot be jumped to are handled. Also to decide: where times come from. The public API has no timestamps; turns in this process could be stamped with `$.clock.now()`, but turns brought back by resume cannot get a time from the public API alone. Is "new turns have a time, history does not" acceptable? How do a resumed turn's steps and interruption show when they can only be approximated? How do slash commands and `!` shell rows group when they raise no turn events?

## Answer

**Data source: the Transcript is the current session's transcript file (`transcript_path`)**, as in cc-switch. Host events serve only as "time to reread" triggers and to judge "in progress"; `$.session.messages()` is only a supplement. Grounds: measurements over 167 real local transcript files (`~/.claude/projects/-Users-liangkangda-Fe-project-cc-mods/`, Claude Code 2.1.29x) and [Research the details of cc-switch's conversation contents](03-research-cc-switch-toc.md).

### Reading

- **Conversation chain**: from the newest leaf row back along `parentUuid`; at a compaction boundary (`system/compact_boundary`, `parentUuid:null`) along `logicalParentUuid` instead. A rewind appends a new branch to the file and deletes no old rows; the thrown-away branch is not on the chain and so does not show. In sample `6ca4d0f5…`, 2 of 17 prompts were on thrown-away branches.
- **Subagents** write separate files; the main file holds only the main loop (measured: `isSidechain` always false).
- **Large files**: the largest local transcript is 20 MB, while `$.fs.read` reads only whole files and rejects past 4 MiB, with no positional read or watch. The file is append-only, so keep the byte offset and read only what was added; a file that got smaller is read again whole. Past 4 MiB, read in chunks with `$.process.run` (stdout is also capped at 4 MiB), each chunk cut at its last newline:
  - macOS/Linux: `tail -c +N | head -c M`;
  - Windows: the built-in Windows PowerShell 5.1 reading by offset with `[IO.File]` and printing base64, with no tool to ship.
- When the file cannot be read or does not match the format, the Pane says why and shows nothing invented.

### Turn group

- Rows that **open a new group**: `type:user`, not `isMeta`, `isCompactSummary` or a tool_result, and one of:
  - text or images with `origin.kind:"human"` (`promptSource` `typed`, `queued` or `suggestion_accepted`);
  - a slash command row (`<command-name>`; a prompt-type command carries `origin:human`, a local command's origin is null);
  - `<bash-input>`.
  `!cmd` opens a new group, unlike cc-switch, by the map's settled rule "anything submitted with Enter".
- **Joining the current group, opening none**: task-notification, `<local-command-stdout|caveat>`, `<bash-stdout>`, `[Request interrupted by user…]`, the compaction summary, hooks and reminders (isMeta). So a queued submission is a group of its own, while background task notifications and agent work set off by `/loop` join the group before them.
- **User side**: a slash command reads back as `/name args`; a `!` row shows `!cmd`; plain text, as in cc-switch, loses code blocks, images and Markdown marks with whitespace collapsed, up to 2 lines; images only say "(image only)".
- **Time**: the User input row's `timestamp` (UTC ISO, shown in local time), as exact for resumed history. The format follows cc-switch: "M月D日 HH:MM", with the year for another year.
- **Steps**: the number of `tool_use` blocks in the group's main-loop assistant rows. Parallel calls count one each, one Agent call counts 1, thinking and text in between do not count, 0 is not shown. cc-switch's mixed count is not copied.
- **Last text**: the text blocks after the group's last `tool_use`, several blocks of one `message.id` joined into one. Without it, show "N steps · no text reply".
- **Groups with only a user side**: local slash commands and `!cmd` have no agent work and show only the user side; under the "Agent" View filter the whole group is hidden.
- **States**:
  - Interrupted: a `[Request interrupted by user` row in the group shows "interrupted · N steps". The file carries the mark, so history is as exact.
  - Error: the group's last assistant row carries `isApiErrorMessage`, showing "error · N steps". A single failed tool is not marked.
  - In progress: the file is written asynchronously and lags, so only the last group is judged, from the host's `turn.start` to `turn.complete`, showing "in progress · N steps".

### Lifecycle

- **Rewind and resume**: rebuilt along the conversation chain, without prompt-history's workaround.
- **Compaction**: the file keeps the rows from before the compaction, so those groups still show.
- **`/clear`**: the host switches to a new session and writes a new file (starting with the `/clear` command row); the contents empty and rebuild, with no dividing line.
- **Jump target**: how a file row's `uuid` or `message.id` maps to `ui.render`'s `requestId` is left for the prototype to measure. Entries show as usual; when a row does not map, or the mapped row was never drawn and the jump is refused, a click shows one line of explanation in the Pane and never silently does nothing.

### Changes to the map

- The Notes' "public API only" is relaxed: reading the current session's transcript file, whose format is unpublished, is allowed.
- After a compaction the groups before it now still show; `/clear` now rebuilds with no dividing line.
- `CONTEXT.md` gains Transcript, and the Agent reply's step count is corrected.

## Later revisions

- Measured in "Prototype the docked TOC Pane's look and interaction": on 2.1.295 a local slash command is a `system/local_command` row; the one with `<command-name>` opens a group and its output rows join it. See [05](05-prototype-toc-pane.md).
- Measured in "Measure the cost of reading and drawing a long session": macOS's `tail -c +N` takes 140–260 ms per 4 MB, so chunked reads on macOS/Linux use `{ dd bs=1 skip=N count=0; head -c M; } < file` instead (byte for byte the same, about 10 times faster); while the file only grows, only the last group is regrouped. See [12](12-task-measure-long-session.md).
