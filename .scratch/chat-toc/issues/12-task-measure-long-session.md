# Measure the cost of reading and drawing a long session

Type: task
Status: resolved
Blocked by: 

## Question

On the local Claude Code's current version, use a synthetic 20 MB-class transcript (thousands of Turn groups) to measure the items below, and from them propose the p95 thresholds for `CT-PERF-001`, to be confirmed by the user:
- the time to first parse and produce the contents;
- the time of incremental reads in chunks by offset (4 MiB chunks, including the macOS `tail`/`head` path);
- how a reread is triggered and throttled (turn events, changes in the file's `stat`), and the cost while a running turn keeps appending;
- the time of each redraw when the Pane draws only the visible window;
- the time of the Current position's contiguous-run computation over thousands of on-screen records.

Reference sample: on 300 turns and 1.5 MB the prototype measured 9–49 ms for a whole read plus parse, 376 ms for a cold start, and about 7.5 ms a redraw (see "Prototype the docked TOC Pane's look and interaction").

## Answer

**Verdict: a 20 MB-class transcript is fast enough on both versions, provided four things in the prototype are replaced: chunked reads use `dd` to position plus `head`; when the file only grows, only the last group is regrouped; entries are cached per group and only the visible window is drawn; the Current position uses a binary search. The `CT-PERF-001` thresholds are set as in the table below, and the user confirmed them (2026-10-09).** Two more findings: macOS `tail -c +N` is slow; and on 2.1.287 `Button` takes only `label`, so the prototype's card entries simply error on the minimum version. The latter was raised to a new ticket, "Draw the three Layouts with label-only Buttons".

### How it was measured

- The probe mod `toc-perf`, adapted from the prototype, logs the time of each stage. The assets are in [assets/12-long-session/](../assets/12-long-session/): the probe source, the fixture generator `gen12.py`, the appender `append12.py`, the headless PTY driver `drv.py` (pyte), `bench12.py`, the summary script `agg12.py`, `results.jsonl`, `summary.jsonl` and the per-run logs `logs/`.
- Local macOS, Claude Code 2.1.295 and 2.1.287 installed with npm. The synthetic session was opened with `--resume`, 170×44 fullscreen, all local plugins turned off, no model call at all.
- Two fixtures, both 20 MiB:
  - **many**: 4432 turns, 25 thousand rows, to stress the group count;
  - **heavy**: 111 turns, 8 thousand rows, tool results of 1–200 KB, with attachment rows. Its shape follows the largest real transcript on this machine (20 MiB, 7615 rows, 11 prompts).
- Steps of each run: cold start with resume, scroll the transcript 150 notches up and down, scroll the TOC 160 notches, jump to the first group, wheel down 400 notches quickly to leave stale on-screen records, `cpstress 3000`, `panestress`, a whole reread while idle, append 3 turns from outside (10 steps each, one row every 150 ms), jump to the last group.
- The recommended approach ran 3 times per version per fixture. The prototype approach (whole table rebuild, linear Current position, `tail|head`, whole regroup) ran once per version per fixture as a comparison. An external append has no host event, so the probe is triggered by a `stat` poll every 300 ms.

### Results (recommended approach)

| Metric | 2.1.295 | 2.1.287 | Prototype approach |
|---|---|---|---|
| TOC appears later than the host's transcript | 0.44–1.11 s | 0.57–2.78 s | 1.11–2.17 s |
| First read plus parse at start (competing with the host's resume) | 0.48–1.44 s | 0.64–2.59 s | 1.15–2.12 s |
| Whole 20 MB read while idle | 0.20–0.52 s | 0.21–0.70 s | 1.01–1.93 s |
| One `dd`+`head` chunk (4,000,000 B, idle, median) | 24–29 ms | 26–30 ms | `tail\|head` 164–281 ms |
| Parse (JSON.parse of all rows) | 17–61 ms | 27–85 ms | same |
| Whole regroup: chain plus grouping | many 62–146 ms, heavy 5–11 ms | many 66–126 ms, heavy 5–119 ms | same |
| Incremental read, single, p50 / p95 | 25–35 / 65–68 ms | 30–31 / 67–70 ms | 31–94 / 64–199 ms |
| Of which regroup that only continues the last group, p95 | 0.25–0.58 ms | 0.38–0.49 ms | whole regroup 11–142 ms |
| External append of a row to the contents model updating, p50 / p95 | about 150 / 300 ms | about 157 / 302 ms | same (dominated by the 300 ms trigger period) |
| Pane redraw, the plugin's own computation, p95 | 0.9–3.6 ms | 1.3–3.4 ms | 4.2–66 ms |
| Pane redraw, including waiting for the host (`read`, `$.store.get`), p95 | 14–44 ms | 29–38 ms | 29–362 ms |
| Current position, each computation, p95 | 0.03–0.13 ms | 0.03–0.15 ms | 0.4–2.1 ms |
| With 3000 stale on-screen records, p50 / p95 | 0.5 / ≤1 ms (heavy 0.07) | 0.5 / 0.8 ms | 10–16 / 17–32 ms |
| Transcript render hook, each, p95 | 0.06–0.2 ms | 0.07–0.2 ms | 0.4–1.9 ms |
| Idle `fs.stat`, p50 / p95 | 0.4–0.5 / 9–16 ms | 0.5–0.6 / 13–17 ms | same |

- On both versions, jumping to the first group and to the last group both arrive (also with a virtualised transcript); `ui.scroll` itself takes 36–236 ms. The incremental result agreed with the whole regroup group by group every time (verify all true), and unrecognized rows were 0.
- The long tail at start comes from competing with the host: the first 1–2 chunks are often 0.2–1 s, and later chunks go back to 20–50 ms. It is most visible on 2.1.287, where heavy had two runs of 2.6 s each.
- The p95 of the Pane's total time goes mostly to waiting for the host (`read(atom)`, `$.store.get`), not to the plugin's own computation; on a cache hit its own computation is close to 0. The longest cache miss was 98–102 ms under many (the first redraw after the data changed).
- On "2.1.295 drawing with label": the 1 comparison run was in the same range as the numbers of the child-node way of drawing.

### The implementation settled on (for the spec to cite)

1. **Reading**:
   - The first read, when the file is no larger than 4 MiB, uses `$.fs.read`;
   - otherwise on macOS/Linux, read 4,000,000 B from the byte offset with `sh -c '{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$3"; } < "$2"'`. For a seekable input `dd` only does an lseek, so it is fast; `head` then reads on from the same file descriptor. The output is byte for byte the same as `tail -c +N | head -c M`.
   - Each chunk is cut at the last newline, and the offset advances by the UTF-8 bytes of the part kept; when the file shrinks, reread the whole file.
   - A single row longer than a chunk (no newline) was not measured: the spec counts it as an "unrecognized line" (`CT-DATA-003`) and skips that row.
   - Windows still follows the PowerShell 5.1 way in "Define the Turn group's split and edges", with only command-construction tests.
2. **Regrouping**: walk back from the new leaf; if it meets the old chain's last row, the file only grew on the current branch: keep the old chain and regroup from the last group's opening row. If it does not meet it (a rewind's new branch, `/clear`), regroup the whole file. The `requestId` map likewise adds the prefix table only for the new rows and retries the ids that did not resolve before.
3. **Trigger and throttle** (chosen by the user):
   - `session.append` (main loop only, rows without an `agentId`) and `turn.complete` trigger a read;
   - read once after a trailing 300 ms, merged into one when a read is running;
   - skip when the `fs.stat` size did not change;
   - after `turn.complete`, check once more at +1.5 s, to catch a file that is written late;
   - no periodic polling.
4. **Pane**:
   - Entries are cached per group (the key is width, running, steps, state, last text), and the entry table is rebuilt only when the data, width, View filter or Layout change;
   - the highlight and the cursor are overlaid only at draw time;
   - only the visible window is drawn; the group-to-entry lookup uses a table, not `findIndex`.
5. **Current position**: an on-screen record that reports `null` is deleted, not kept as off; the ordered array of drawable rows (site rows and rows that have been drawn) is rebuilt only after a read and when a new row is drawn; whether a drawable row lies between two adjacent on-screen rows is judged with a binary search. The result agrees with the prototype algorithm (cpstress picked the same groups with both algorithms).

### `CT-PERF-001` thresholds (the looser tier the user confirmed, about 1.4 times the worst measured)

On the reference machine (this macOS machine), with the 20 MiB many and heavy fixtures, 3 runs per version, taking p95 (the maximum with 3 runs):

| Item | Threshold |
|---|---|
| First contents: the moment the TOC appears is later than the moment the host's transcript shows the last turn by | ≤ 4 s |
| Whole read plus regroup while idle (reread or resume) | ≤ 1 s |
| Incremental read, single | ≤ 150 ms |
| Appending a row to the contents model updating | ≤ 1 s |
| Pane redraw, the plugin's own computation | ≤ 16 ms |
| Pane redraw, including waiting for the host | ≤ 100 ms |
| Current position, each computation | ≤ 2 ms; with 3000 stale on-screen records ≤ 5 ms |
| Continuous scrolling and jumps in a long session reach the first and the last group | Must, no paging |

These thresholds are release evidence only, not an SLA for all hardware (see the not-promised list in "Finalise the compatibility and acceptance contract").

### Findings

- **macOS `tail -c +N` is slow**: about 140–260 ms per 4 MB, and 16–48 ms after switching to `dd` to position plus `head`. This changes the `tail`/`head` wording in the map Notes and in "Define the Turn group's split and edges".
- **On 2.1.287, `Button` takes only a `label` or one string child**: the prototype drew cards with several `Text` children, which on 2.1.287 reports `JSX element <Button> needs a label`, and the Pane cannot be drawn at all. 2.1.295 allows children.
  - A multi-line `label` draws on 2.1.287; a highlight bar in a separate `Text` beside the `Button` works. The cost is that one entry can no longer have a dim header line and a body.
  - Raised to the new ticket "Draw the three Layouts with label-only Buttons", which blocks "Decide the Layout switch's entry and default".
- `/tp` on this machine is the built-in `/teleport`, so a plugin registering it is refused. The real command `/chat-toc` is not affected.
