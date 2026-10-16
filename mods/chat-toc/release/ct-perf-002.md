# CT-PERF-002 results, and CT-PERF-001 rerun with the preview shown (ticket 20, chat-toc 0.2)

> At 0.2's release: paste the two "Results" tables and the "Notes" below into report.md's perf section. If the plugin's reading, regrouping, search, preview or Pane code changes before the release, rerun on the release commit as in "How to rerun" and replace the numbers and the commit under test. This file may be deleted by the release commit or kept as the draft.

- Commit under test: the plugin code of `7dd66bb` (branch `chat-toc-0.2/20-perf`; the later commits on the branch change only the scripts, the gate and docs).
- Reference machine: macOS (Darwin 24.6.0), arm64, Apple M1 Pro, 32 GB, shared with other work: the 1-minute load average is recorded at each run's start and end (in each `run.jsonl` record). A sample only, not a promise for every machine.
- Claude Code: 2.1.287 (in a temporary npm folder, the global install untouched) and 2.1.295 (the current version).
- Fixtures: as CT-PERF-001 (ticket 18's `transcript_fixture.py`, fixed seeds). `many`: 20 MiB, 4521 turns; `heavy`: 20 MiB, 107 turns.
- Three runs per version and fixture, p95 as the spec says: items counted per run take the largest of the three runs; items counted per sample take each run's p95, then the largest of the three.
- The preview is shown in every run (its default; each run checks it is drawn).

## Results

CT-PERF-002 (0.2 spec §10):

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| A keystroke in the search field to the Pane redrawn, the plugin's own work | ≤ 50 ms | 10.57 ms | 1.5 ms | 16.44 ms | 1.6 ms |
| The same, waiting on the host included | ≤ 100 ms | 21.67 ms | 21.49 ms | 28.31 ms | 14.44 ms |
| Whole read and regroup when idle, the search index included | ≤ 1 s | 398 ms | 228 ms | 407 ms | 212 ms |
| Of which the search index (for reference) | — | 11 ms | 0.37 ms | 10 ms | 0.32 ms |
| Incremental read, each, the index's rebuild included | ≤ 150 ms | 125.48 ms | 55.7 ms | 122.15 ms | 37.28 ms |
| Pane redraw with the preview shown, the plugin's own work | ≤ 16 ms | 2.07 ms | 0.87 ms | 2.11 ms | 0.97 ms |
| Keystrokes timed (all runs) | — | 102 | 102 | 102 | 102 |
| Load average (1 min) at the runs' starts, least–most | — | 3.38–4.2 | 3.96–12.39 | 3.17–4.47 | 6.67–14.62 |
| Runs (all passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

CT-PERF-001 (the MVP's limits), the same runs:

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| First listing: the TOC after the host shows the last turn | ≤ 4 s | 0.94 s | 0.69 s | 0.84 s | 0.62 s |
| Whole read and regroup at start (contends with the host's resume; for reference) | — | 374 ms | 326 ms | 398 ms | 266 ms |
| Whole read and regroup when idle (after a hot reload) | ≤ 1 s | 398 ms | 228 ms | 407 ms | 212 ms |
| Incremental read, each | ≤ 150 ms | 125.48 ms | 55.7 ms | 122.15 ms | 37.28 ms |
| An appended row to the TOC model update | ≤ 1 s | 511.75 ms | 331.3 ms | 547.73 ms | 331.9 ms |
| Pane redraw, the plugin's own work | ≤ 16 ms | 2.07 ms | 0.87 ms | 2.11 ms | 0.97 ms |
| Pane redraw, waiting on the host included | ≤ 100 ms | 6.71 ms | 11.57 ms | 7.09 ms | 10.13 ms |
| Current position, each computation | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| Long session: continuous scrolling, jumps to the first and last groups | must reach, no paging | yes | yes | yes | yes |
| On-screen records actually left (most) | — | 30 | 11 | 23 | 11 |
| Load average (1 min) at the runs' starts, least–most | — | 3.38–4.2 | 3.96–12.39 | 3.17–4.47 | 6.67–14.62 |
| Runs (all passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

Verdict: in the sets above, two versions, two fixtures, 12 runs, CT-PERF-001 and CT-PERF-002 pass in every one. Two earlier 2.1.295 `many` sets had a run each fail the incremental read limit; see note 4.

## Notes

1. **How it was measured**. `tests/acceptance/perf_scenarios.py`, as CT-PERF-001's note 1, with a step 6 added after reaching the last group: a click on the search field, then the queries `模块` (nearly every turn), `T0042` (one), `正常 T01` (two words, about 100 turns in `many`), `zzzz` (none) typed a letter at a time 0.25 s apart and taken back with Backspace a letter at a time, 34 keystrokes a run, then Esc. The plugin samples each keystroke under `CHAT_TOC_PERF` (`hooks/perf.ts`, metric `search`): its own work is the Pane drawing that first shows the new query, after the drawing's awaits; with the host, the time from the field's `onInput` change to the end of that drawing. The search index's build is sampled at each read that regroups (metric `index`); the reads' samples include it.
2. **A keystroke**. Its p50 is about 4 ms in `many` (4521 turns) and under 1 ms in `heavy`; the worst p95 16.44 ms. Of that, matching all 4521 turns takes about 0.3 ms and narrowing the list about 1 ms (`tests/long_session.test.ts`, `CT-PERF search` line); the rest is the drawing itself, the preview and the Minimap's lit cells. Before this ticket the matcher took about 3 ms per keystroke and the narrowing about 2 ms when every turn matched; ticket 20 made the matcher allocate only on a path hit, kept the whole table when every group matches, and kept the preview's layout while the match it shows is the same.
3. **The index** is built with the groups a read regroups: 10–15 ms for all of `many` at a whole read, 0.02–0.5 ms at an incremental read (one or two groups).
4. **The incremental read's long tail**, as CT-PERF-001's note 5: in `many` each run's p95 is the first submit after the hot reload, and most of it is the host getting the file's text (the `sh` reading the chunk; 98–113 ms in the runs above). The plugin's own work in an incremental read (regroup, index, compactions, the view's rows) is mostly 6–12 ms. Two of the six 2.1.295 `many` runs taken failed this limit on that one read, with the host's text fetch at 175 ms (load average 4.2; the host's debug log: `sh exited 0 in 151ms`) and 298 ms (load average rising to 34), and the plugin's own work 47 ms and 15 ms. Both sets are kept in the evidence (`20261017-031559` 2 of 3 passed, `20261017-034655` 2 of 3 passed); the third set (`20261017-040101`) is the one in the table. The limit is the host's process start more than the plugin's.
5. **Pane redraw with the preview shown**: the p95 is about 2 ms in `many` (0.38 ms in 0.1's runs): the samples now include the keystrokes' drawings and the preview. The longest drawing in each run is still the first after a whole read (the entry table built): 43–53 ms in `many`, 4–7 ms in `heavy`.
6. **The seams**: `tests/long_session.test.ts` also times the index and one keystroke's matching and narrowing on a 4432-turn session (p95 ≤ 50 ms asserted; alone the file gives ≤ 8 ms, under the whole suite's parallel load single batches went to 56–78 ms before the matcher and narrowing changes, and now stay under 3 ms).

## Evidence

- Run folders (without debug logs): `.scratch/chat-toc-0.2/assets/20-perf/runs/`
  - In the table: `20261017-033150-ct-perf-2.1.287-many`, `20261017-034401-ct-perf-2.1.287-heavy`, `20261017-040101-ct-perf-2.1.295-many`, `20261017-032901-ct-perf-2.1.295-heavy`. Each holds `run.jsonl` (a CT-PERF-001 and a CT-PERF-002 record per run, with the load average), `perf-samples-*.json` (every sample); the screens (`screens/`, each query's too) stay in the local run folders, as the repository ignores them.
  - Not in the table, each with one run failing the incremental read (note 4): `20261017-031559-ct-perf-2.1.295-many`, `20261017-034655-ct-perf-2.1.295-many`.

## How to rerun

```sh
PY=<a venv with pyte>/bin/python
for host in 2.1.287 current; do for kind in many heavy; do
  $PY mods/chat-toc/tests/acceptance/perf_scenarios.py run $host $kind --runs 3
done; done
$PY mods/chat-toc/tests/acceptance/perf_scenarios.py table mods/chat-toc/build/pty-runs/<the four run folders>
claude plugin test mods/chat-toc 2>&1 | grep CT-PERF
```

Run the sets one after another on a quiet machine (each `many` run takes about 4 minutes); a set taken under a load average of 15–35 raises the reads' host time.
