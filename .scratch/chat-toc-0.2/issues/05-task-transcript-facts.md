# Read the transcript facts the new features rest on

Type: task
Status: resolved
Blocked by:

## Question

From real local transcripts (read only, nothing quoted in tracked files but field names and counts) and the host, on 2.1.287 and 2.1.295, find:

- **Compactions**: how a compaction boundary row looks (auto and `/compact`), where it falls relative to Turn groups (inside one, between two), the summary row after it, and how many a long session holds.
- **Tokens**: where `usage` sits on assistant rows; how a streamed reply repeats one `message.id` over several rows, and how to count each request once; whether subagent usage reaches the main file; what a turn's total would honestly be (input, output, cache read, cache write).
- **Duration**: whether a Turn group's first and last row timestamps give a duration that matches `turn.complete`'s `durationMs`, and what breaks it (interruption, a turn spanning a compaction, queued prompts).
- **Files**: which tools carry a file path in their input (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Read`, others), how it is spelled (absolute, relative), and whether Bash commands should count.
- **Context use**: what `$.session.usage()` returns on 2.1.287 and 2.1.295 (`context.percent`, when it is absent), and when it changes (`session.measure`).

Record the facts and any measuring script's path; nothing to decide here.

## Answer

Measured 2026-10-16 over the 553 main transcripts in the user's `~/.claude/projects` (written by 2.1.193 to 2.1.295, CLI and the Claude app; 419 hold Turn groups, at most 66 in one file, so the 4432-turn session of the MVP's performance runs is synthetic), and on 2.1.287 and 2.1.295 with a probe mod against a local stand-in for the Messages API that states chosen `usage` figures (isolated worlds, not logged in, no model).

- Transcript script: [`measure.py`](../assets/05-transcript-facts/measure.py) (chain and Turn groups by chat-toc's rules; prints field names, counts and number distributions only). Its output: [`measure-out.json`](../assets/05-transcript-facts/measure-out.json).
- Probe mod: [`usage-probe`](../assets/05-transcript-facts/usage-probe/) logs `$.session.usage()` at `session.start`, after each `turn.complete`, after `session.compact` and 500 ms later, plus every `session.measure`, `turn.start`, `turn.complete` and `session.compact` (in and out); `/usageprobe [summary|full|turns]`.
- PTY driver: [`drive.py`](../assets/05-transcript-facts/drive.py) runs a plain turn, a two-step tool turn (three requests, the last a reply in two text blocks), a turn interrupted before its answer, a prompt queued during a 12 s turn, `/compact`, a turn after it, a turn reported at 196k (or `argv[3]`) cache reads, and one more prompt. Captures under [`runs/`](../assets/05-transcript-facts/runs/): `usage-probe.log`, `transcript-digest.json` (each row's type, ids, time and numeric fields, no text), `requests.json`; `runs/2.1.295-near990000/` is the pass that crossed the auto-compaction threshold. The two hosts behave alike on every step.

### Compactions

- **The boundary row**: `type: system`, `subtype: compact_boundary`, `parentUuid: null`, `logicalParentUuid` the row before it, `content` a fixed host line, and `compactMetadata` with `trigger` (`manual` | `auto`), `preTokens`, `postTokens`, `durationMs`, and in newer files `cumulativeDroppedTokens`, `preservedSegment`, `preservedMessages` (objects), `preCompactDiscoveredTools`. Real files: 54 boundaries (30 manual, 24 auto); auto at `preTokens` 207k to 373k (median 228k), manual 27k to 838k; compaction took 45 s to 8 min (auto, median 165 s), 2 s to 6 min (manual).
- **The summary row** follows the boundary on the chain (`parentUuid` = the boundary, 37 of 37 seen there): `type: user`, `isCompactSummary: true`, `isVisibleInTranscriptOnly: true`, `message.content` a string; newer ones add `turnPosition` (`{promptIndex, turnIndex}`), `turnOrigin`, `summarizedTurnPromptUuids`. Attachment rows may sit between them.
- **Where it falls** (by chat-toc's grouping; groups are not cut by a boundary):
  - `/compact`: the boundary hangs off the previous group's last row (its `turn_duration` row), then the summary, then a `local-command-caveat` meta row, then the `/compact` command row, which opens a new Turn group, then its stdout. The command row's timestamp is earlier than the boundary's (27 of 27 real, and both probe hosts). So on the chain a manual compaction sits between two groups, right before the `/compact` entry. A user row with the raw `/compact` text is written off the chain (probe).
  - Auto, during a turn (15 real): agent rows before and after it in the same group; the boundary lands 75 to 490 s after the last agent row (the compaction itself) and the turn resumes 7 to 52 s later.
  - Auto, at a submit (the probe at 99% of the window; no clean real case): the new prompt row comes first, then its attachment, the boundary, the summary, and the turn's agent rows. The boundary is inside the new group, after its opener.
  - Auto with only earlier agent rows in the group (9 real, 5 of them with the next prompt 30 to 90 min later): the boundary falls between turns; not traced further.
  - Six manual boundaries came before any group of their file (resumed or forked files).
- **How many**: 35 of 553 files hold one; per such file 1 to 5 on the chain (median 1, p90 3). Three manual ones were off the chain (rewound away).
- From a hook: `session.compact` comes with `trigger` `manual` or `auto`; `next(e)` resolves `tokensBefore`, `tokensAfter`, `usage`, `messages`. The auto threshold read from `usage({ breakdown })` was 967,000 of a 1,000,000 window.

### Tokens

- **`message.usage`** is on every assistant row (45,077 on chains; 90 rows `model: <synthetic>` carry zeros): `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation` (by TTL), `service_tier`, `server_tool_use`, `iterations` (a list of one, equal to the top-level counts in 13,394 of 13,396), `speed`, `inference_geo`, `output_tokens_details`, sometimes `fallback_credit`. Gateways' models (`gpt-*`, `glm-*`) write the same fields.
- **A streamed reply is one row per content block under one `message.id`**: 1 to 6+ rows per id (most 2), and every row of an id carries **identical** `usage` (15,288 of 15,288 repeated ids; also in the probe: two text blocks, two rows, same usage). Count each `message.id` once.
- **A turn's honest figures** (unique `message.id`s in the group, main chain only): requests per turn median 5, p90 34, max 201. Output tokens median 3.5k, p90 24k. Cache reads dominate any sum: median 519k, p90 5.1M, max 92M per turn, because each request re-reads the context; uncached input median 22. A summed "tokens" figure therefore reads as the context size times the number of requests, not as what the turn wrote or held. `turn.complete`'s `usage` is exactly this per-request sum (probe: three requests of 3/2,000/40,000/250 gave 9/6,000/120,000/750), absent on an interrupted turn.
- **Subagents do not reach the main file's rows** (no sidechain rows in main files). Their requests are in `<session>/subagents/agent-<id>.jsonl`. The main file has only the Agent tool's result row: `toolUseResult` with `totalTokens`, `usage`, `totalDurationMs`, `totalToolUseCount` (736 such results; 211 on chains, mostly before any human Turn group). `totalTokens` equals the four counts of that `usage` summed (211 of 211), and that `usage` is not the subagent file's last request (207 of 211) nor the sum of its requests.

### Duration

- **The file states it**: a `system` row `subtype: turn_duration` with `durationMs` and `messageCount` (`isMeta: false`) closes each main-loop model turn, after its last agent row. **`turn.complete`'s `durationMs` equals it exactly** (probe, both hosts, every turn: 424/424, 6152/6152, 12096/12096, ...). The row's time minus the opener's time is within 1 s of it in 1,072 of 1,217 real groups with one such row; 126 read more than 1 s shorter (27 of them asked the person something), 19 longer; not traced further.
- **A Turn group is not one model turn**: a background task's notification (`origin.kind: task-notification`, not a group opener) starts another model turn inside the same group. 192 real groups hold two or more `turn_duration` rows (175 with one or more notifications inside, 17 with none). The group's duration is then not one row's `durationMs`.
- **What leaves it out**:
  - **Desktop writes none**: `entrypoint: claude-desktop` files have no `turn_duration` row (0 of 42 prompt groups with agent rows); the CLI has one in 1,093 of 1,124.
  - **An interruption**: no `turn_duration` row in 21 of 27 interrupted prompt groups. `turn.complete` still fires with `isAborted: true`, `reason: aborted`, a `durationMs`, and no `usage`. Interrupted before any answer, the prompt is put back into the composer and its row is left off the chain (the next prompt's row takes the same parent).
  - **A queued prompt**: written to the file when it is dequeued (after the running turn's `turn_duration` row), so its timestamp and `durationMs` count from the dequeue, not from when it was typed; `queue-operation` rows (`enqueue`, `dequeue`, `remove`, `popAll`) carry no uuid. It runs as its own turn and opens its own group.
  - **A compaction inside the turn**: `durationMs` includes it (the probe's at-submit auto compaction is inside the turn's 77 ms).
- `TurnDuration` (the `Baked for 3s` line) is a terminal-only render component with the same `durationMs`.

### Files

- Path-carrying tool inputs on the chains: `Edit.file_path` (2,045), `Write.file_path` (1,325), `Read.file_path` (1,817), `Glob.path` (109) and `Grep.path` (34, a search root, not a file), `Artifact.file_path`, `EnterWorktree.path`. **All absolute.** `MultiEdit` and `NotebookEdit` were never called in these files; MCP tools carried none of `file_path`/`path`/`notebook_path`.
- The result row repeats it: `toolUseResult.filePath` (with `structuredPatch`, `originalFile`, `oldString`/`newString` for Edit; `type: create|update` for Write).
- **Bash changes are recorded too**: 2,338 of 13,866 Bash results carry `toolUseResult.bashEditDiff` (2.1.273 on): `changedFiles` (absolute paths, empty or null in 46), `files` (`{filePath, hunks, created?, deleted?}`), `moreFiles` (a count beyond those listed), `shared`, `unavailable`. A Bash command's text is not parsed for paths; this field is the only structured record of what it changed.

### Context use (`$.session.usage()`, 2.1.287 and 2.1.295 alike)

- Returns `{ startedAt, context: { tokens?, window, percent? }, rateLimits, cost: { usd } }`. `window` was 1,000,000 for the default model under an API key. `tokens` is the last response's input side (uncached + cache write + cache read: 42,003 for 3/2,000/40,000) and `percent` that over `window`, a whole number (99 at 991,003).
- **Absent** at `session.start` and before the first response, and **from just after a compaction until the next response**: right after `session.compact`'s `next(e)` resolves it still shows the old figure, 500 ms later `tokens` and `percent` are gone (manual); an at-submit auto compaction is answered by the same turn, so the gap is not observed there.
- **`session.measure`** fires after each main-loop turn with `{ context, rateLimits, cost, changed }`; `changed` lists only what moved (`["cost"]` when the context figure is the same as last measured). **No `session.measure` fires for a compaction**, so the figure's disappearance is not announced, and the turn after a compaction that lands on the same figure as before reports only `cost`. A queued turn finishing right after another raised no `measure` of its own (bursts fold). An interrupted turn's `measure` changes only `cost`. `rateLimits` stayed empty off a subscription.
- `usage({ breakdown: 'summary' })` adds `context.breakdown` with `totalTokens`, `rawMaxTokens`, `percentage`, `autoCompactThreshold` (967,000), `isAutoCompactEnabled`, `apiUsage`. Desktop not measured.
