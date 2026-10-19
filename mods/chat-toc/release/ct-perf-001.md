# CT-PERF-001 results (ticket 27, for ticket 29 to paste into `tests/evidence/0.1.0/report.md`)

> At ticket 29's release: paste the "Results" table and the "Notes" below into report.md's CT-PERF-001 section. If the plugin's reading, regrouping, Pane or Current position code changed before the release, rerun on the release commit as in "How to rerun" and replace the numbers and the commit under test. This file may be deleted by the release commit or kept as the draft.

- Commit under test: `89351b1` (branch `chat-toc/27-perf`; the plugin code is the same as the pre-release merge into `chat-toc/mvp`, see ticket 27's Comments).
- Reference machine: macOS (Darwin 24.6.0), arm64, Apple M1 Pro, 32 GB. A sample only, not a promise for every machine (spec §9, known limits).
- Claude Code: 2.1.287 (in a temporary npm folder, the global install untouched) and 2.1.295 (the current version then).
- Fixtures: ticket 18's `transcript_fixture.py`, fixed seeds. `many`: 20 MiB, 4521 turns, 25,680 rows; `heavy`: 20 MiB, 107 turns, 7,704 rows (14 tool results of 2–60 KB per turn plus attachment rows). The generator's turn counts differ slightly from spec §9's 4432/111 because ticket 18's generator shapes rows differently from ticket 12's probe; the scale is the same.
- Three runs per version and fixture, p95 as the spec says: items counted per run (first listing, whole read) take the largest of the three runs; items counted per sample take each run's p95, then the largest of the three.

## Results

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| First listing: the TOC after the host shows the last turn | ≤ 4 s | 0.73 s | 0.54 s | 0.77 s | 0.53 s |
| Whole read and regroup at start (contends with the host's resume; for reference) | — | 330 ms | 234 ms | 353 ms | 225 ms |
| Whole read and regroup when idle (after a hot reload) | ≤ 1 s | 371 ms | 195 ms | 375 ms | 205 ms |
| Incremental read, each | ≤ 150 ms | 111 ms | 26 ms | 104 ms | 38 ms |
| An appended row to the TOC model update | ≤ 1 s | 514 ms | 347 ms | 490 ms | 369 ms |
| Pane redraw, the plugin's own work | ≤ 16 ms | 0.38 ms | 0.38 ms | 0.36 ms | 0.37 ms |
| Pane redraw, waiting on the host included | ≤ 100 ms | 2.3 ms | 8.5 ms | 1.9 ms | 8.7 ms |
| Current position, each computation | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| Current position under 3000 stale on-screen records (note 4) | ≤ 5 ms | 0.33 ms | — | 0.34 ms | — |
| Long session: continuous scrolling, jumps to the first and last groups | must reach, no paging | yes | yes | yes | yes |
| Runs (passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

Verdict: two versions, two fixtures, 12 runs in all; CT-PERF-001 passes in every one.

## Notes

1. **How it was measured**. `tests/acceptance/perf_scenarios.py`: each run generates a new 20 MiB fixture in the harness's isolated world and `--resume`s it fullscreen in pyte at 170×44, logged out, no model call, with `CHAT_TOC_PERF=1`. The plugin writes each stage's time (milliseconds and counts only; no prompts, uuids or paths; CT-SEC-001) to the host's `--debug-file`, and the script reads it back. The first listing is read off the screen by the script: the time between the host's transcript showing the last turn's text and the Pane listing entries. Each run, in order: cold-start resume; wheel the transcript 150 notches up and down, the Pane 100 up and 60 down; wheel the Pane all the way to the top and click T0000 (reaching the first group); wheel the transcript fast 1500 notches down from the top (leaving stale on-screen records); wheel the Pane all the way to the bottom and click the newest (reaching the last group); hot-reload the plugin (whole read and regroup when idle); submit 5 synthetic prompts logged out (the host writes the prompt row and a "Not logged in" row and raises `session.append`: incremental read, append to model update).
2. **Continuous scrolling, no paging**. In `many`, wheeling the Pane from bottom to top took 9,120–10,000 notches and 84–103 s, and back from the first group to the last 7,480–8,180 notches; no paging on the way, about one entry per notch. On both versions a click on the first group put T0000's prompt at the transcript's top, and a click on the last group showed the last turn.
3. **Pane redraw**. Entries are cached per group (`hooks/table.ts`); the entry table is rebuilt only when the data, width, View filter, Layout or running turn change, and a file that only grows re-lays only its last few groups. Every p95 is within 0.4 ms; the longest draw in each run is the first after the file is read (the whole table built for the first time): 55–61 ms for `many`, 3–7 ms for `heavy`. The p95 with the host's wait is mostly the round trips of `read` and `$.clock.now`.
4. **3000 stale on-screen records**. Real use does not leave that many: the build-up after long scrolls that ticket 24 noted came to at most 30 here (`many`, with the 1500-notch fast scroll) and 11 (`heavy`). So this item is synthesised in the plugin's own runtime (`tests/long_session.test.ts`, run under `claude plugin test` and `<2.1.287>/claude plugin test`, the file alone 3 times each): a `many`-shaped chain of 4432 turns and 26,590 rows, 3000 stale records spread over the whole session plus 12 truly on screen. Each computation: p50 0.27–0.29 ms, p95 0.31–0.34 ms, max 1.1–1.5 ms, and the group found is the same as with no stale records. With none, p95 is 0.005–0.009 ms. So ticket 24's O(n log n) recomputation needs no change.
5. **The incremental read's long tail**. In `many`, every run's p95 comes from the first submit after the hot reload: of those 104–111 ms about 100 ms go to reading the file (the new module's first chunked `$.process.run`); regrouping takes a few milliseconds (diagnostic run `20261011-145755` logged the stages: 102 ms to get the text, 108 ms in all, only the last group continued). Other single reads take 5–50 ms.
6. **Append to model update** takes about 330–510 ms, mostly the spec's 300 ms trailing throttle (§3).
7. The whole read at start runs alongside the host's resume and is for reference only; the limit applies to the first listing.

## Evidence

- Run folders (without debug logs, which carry the host's own lines and are large): `.scratch/chat-toc/assets/27-perf/runs/`
  - `20261011-144313-ct-perf-2.1.287-many`, `20261011-145334-ct-perf-2.1.287-heavy`, `20261011-143107-ct-perf-2.1.295-many`, `20261011-144113-ct-perf-2.1.295-heavy`: each holds `run.jsonl` (one CT-PERF-001 record per run), `perf-samples-*.json` (every sample) and `screens/` (screens on reaching the first and last groups).
  - `20261011-145755-ct-perf-2.1.295-many`: a diagnostic run (read samples also log the time to get the text and how it regrouped), not counted in the table.
- Checked while copying: every `chat-toc-perf` line in the debug logs holds only metric names and numbers.

## How to rerun

```sh
PY=<a venv with pyte>/bin/python
for host in 2.1.287 current; do for kind in many heavy; do
  $PY mods/chat-toc/tests/acceptance/perf_scenarios.py run $host $kind --runs 3
done; done
$PY mods/chat-toc/tests/acceptance/perf_scenarios.py table mods/chat-toc/build/pty-runs/<the four run folders>
claude plugin test mods/chat-toc 2>&1 | grep CT-PERF        # 3000 stale records, the entry table (numbers run high while the suite runs in parallel; the file alone is more accurate)
```

The whole set takes about 35 minutes (each `many` run about 4 minutes, mostly wheeling the Pane notch by notch to the top and back).
