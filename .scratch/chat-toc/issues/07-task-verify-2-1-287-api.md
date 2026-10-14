# Check the key APIs on Claude Code 2.1.287

Type: task
Status: resolved
Blocked by: 

## Question

Install Claude Code `2.1.287` in an isolated folder (leaving the global install alone), get the mods type declarations this version writes, and check item by item whether the primitives chat-toc relies on, judged only "likely" in the research, exist: `props.onScreen` on `ui.render`'s transcript sites, `session.append` (`uuid`/`door`/`agentId`/`isMeta`), `session.end`'s `reason`, `UiScrollTarget` taking an assistant row's `requestId`, the Pane's `placement`/`isPlaced`/`columns`/`ui.close` origin, and what reading the transcript file needs: `$.fs.read` (absolute paths, the 4 MiB limit), `$.fs.stat`, `$.process.run` (the stdout limit) and the classic events' `transcript_path`. Record each one's presence and field differences, and whether a minimal mod passes `claude plugin validate` on 2.1.287.

## Answer

**Verdict: every item on the list is on 2.1.287, with the same fields as 2.1.295.** The `>=2.1.287` minimum need not rise. A minimal mod passes `claude plugin validate` on 2.1.287.

### How it was checked

- npm installed `@anthropic-ai/claude-code@2.1.287` into the session's temporary folder (the global 2.1.295 untouched), then `claude -p "/probe" --plugin-dir` loaded a probe mod so that this version wrote its own type declarations (first line `// Written by Claude Code 2.1.287.`, 574 KB; 2.1.295's are 804 KB).
- Attachments: [2.1.287's type declarations](../assets/07-api-2-1-287/claude-code-2.1.287.d.ts), [the probe mod](../assets/07-api-2-1-287/toc-probe/).
- The probe (TypeScript) uses every primitive below. tsc 5.6 `strict` type checks against each version's declarations give 0 errors; 2.1.287's `claude plugin validate` also passes, listing every hook and the calls `$.fs.read`, `$.fs.stat`, `$.process.run` and `$.ui.open/close/panes/scroll/resolve`.
- 2.1.287 `-p` then actually ran the probe; results under "Measured at runtime".

### Item by item (2.1.287)

| Primitive | Present | Difference from 2.1.295 |
|---|---|---|
| `ui.render`'s `props.onScreen` (`OnScreen \| null`, fields `first`/`last`/`of`) | Yes, on `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`, `TurnDuration`, `InfoNotice` | Same |
| `session.append` (`message`, `door`, `origin`, `uuid`, `agentId?`; `message.isMeta?: true`) | Yes | Same |
| `session.end`'s `reason` (`'clear' \| 'resume' \| 'logout' \| 'prompt_input_exit' \| 'other'`) | Yes | Same |
| `UiScrollTarget` (`{requestId} \| {key} \| 'start' \| 'end'`) | Yes. The declaration says `requestId` is "the message's message id", able to point at a message in the transcript; moving transcript rows is limited to answering the person's own input | Same |
| Pane: `placement: 'dock' \| 'inline'`, `bodyColumns`, `isFocused`, `scroll`, `view` | Yes | Same fields; 2.1.295 only adds comments |
| `$.ui.open`'s `columns`/`rows`, returning `{isPlaced:true} \| {isPlaced:false, reason}`; `$.ui.panes()`' `isPlaced` | Yes. Unasked, it places at a terminal width of 144 columns; after one ask, 110; `-p` always places | Same |
| `ui.close`'s `origin.kind` (`plugin` / `person` / `unload`) | Yes | Same |
| `$.fs.read` (absolute paths work; rejects past 4 MiB; `{as:"bytes"}`) | Yes | Same |
| `$.fs.stat` (`kind`, `size`, `mtimeMs`, `isLink`, `realPath?`) | Yes | Same |
| `$.process.run(argv, {cwd, env, stdin, timeoutMs})` (no shell; stdout and stderr each keep the first 4 194 304 bytes, `isStdoutTruncated`; 30-second default timeout, 10 minutes at most) | Yes | Same |
| The classic events' `transcript_path` (`BaseHookInput`, on every `classic.*`, such as `classic.SessionStart`) | Yes | Same |

New in 2.1.295 and missing from 2.1.287 are only the events `ui.notify`, `ui.selection`, `ui.fault`, `prompt.mention` and `prompt.autocomplete`, and `AssistantMessage.isSummary` (the compaction summary row's mark), none used by chat-toc. The set of render components is exactly the same on both.

### Measured at runtime (2.1.287, `-p`, this macOS machine)

- `classic.SessionStart` got `transcript_path`. But **while the session has no message yet, the file does not exist**: `$.fs.exists` returns false and `$.fs.stat` throws. So "the file is not written yet" is a new session's normal state, not a read failure.
- `$.fs.stat` and `$.fs.read` read a 300 KB jsonl fine. A 5 MiB file is rejected (`HooksError: … $.fs.read: … refuse…`).
- Chunked reads with `$.process.run(['sh','-c','tail -c +N "$1" | head -c M', …])` work. `cat` of a 5 MiB file cuts stdout at exactly 4 194 304 bytes, `isStdoutTruncated: true`.
- `$.ui.open({id, columns})` returns `isPlaced: true`; `$.ui.close` raises `ui.close` with `origin.kind` `plugin`; `session.append` receives a `hook-context` row with a `uuid`.
- Note for the implementation: the `command.run` matcher is `{ command: '<name>' }`, not `{ name }`; the wrong one raises no error, the command just falls through, and `-p` says "no command.run hook answered it".

### Not measured

- How `onScreen` really reports in fullscreen interactive mode, and whether `$.ui.scroll` can jump to an assistant row, cannot be measured under `-p`: they need an interactive PTY and call a real model. Both were already in the scope of "Measure how requestId maps to transcript rows", measured there with cmux.
- The dock's column thresholds were only checked against the declarations, not measured in a real 2.1.287 terminal.
