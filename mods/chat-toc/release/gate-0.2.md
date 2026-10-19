# chat-toc 0.2 release gate: the whole MUST list on 2.1.287 and 2.1.295 (ticket 21)

> At 0.2's release: if the plugin code changes after the commit under test, rerun as in "How to rerun" on the release commit and build the evidence directory with `report`; otherwise this run's `report` can be built again from the gate directory (local, under `build/`). The perf tables below supersede the numbers in `ct-perf-002.md` (ticket 20), which ran before tickets 22–24.

- Commit under test: the plugin code of `3ac792b` (ticket 24); the acceptance drivers as fixed by ticket 21 (in the commit that adds this file).
- Plugin version in `plugin.json`: 0.1.3 (the release commit raises it).
- Reference machine: macOS 15.8, arm64, Apple M1 Pro, 32 GB, shared with other work (the load average is in the tables).
- Claude Code: 2.1.287 (npx cache, the global install untouched) and 2.1.295 (current).
- Run: 2026-10-17, `release_gate.py run` on each version (2.1.295's perf by `--only-perf` after the rest), then `report`.

## Result

**Pass.** 46 MUST scenarios × 2 versions: 188 records, 0 failed, 0 missing, 0 skipped; 0 CT-SEC-001 marker leaks in the evidence. Automated gates: `plugin validate` on both versions, `plugin test` (475 pass, 0 fail) and the acceptance unit tests on 2.1.295, `tsc` against each version's types.

## CT-PERF-001 and CT-PERF-002 (20 MiB, two fixtures × two versions × 3 runs, the worst p95 of the runs)

CT-PERF-001

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| First listing: the TOC after the host shows the last turn | ≤ 4 s | 0.84 s | 0.61 s | 0.85 s | 0.62 s |
| Whole read and regroup at start (contends with the host's resume; for reference) | — | 387 ms | 229 ms | 393 ms | 229 ms |
| Whole read and regroup when idle (after a hot reload) | ≤ 1 s | 407 ms | 238 ms | 397 ms | 217 ms |
| Incremental read, each | ≤ 150 ms | 123.32 ms | 96.36 ms | 111.57 ms | 92.94 ms |
| An appended row to the TOC model update | ≤ 1 s | 499.03 ms | 337.62 ms | 504.2 ms | 365.88 ms |
| Pane redraw, the plugin's own work | ≤ 16 ms | 2.09 ms | 0.99 ms | 2.09 ms | 1.12 ms |
| Pane redraw, waiting on the host included | ≤ 100 ms | 6.21 ms | 9.64 ms | 6.51 ms | 10.62 ms |
| Current position, each computation | ≤ 2 ms | 0.03 ms | 0.02 ms | 0.03 ms | 0.02 ms |
| Long session: continuous scrolling, jumps to the first and last groups | must reach, no paging | yes | yes | yes | yes |
| On-screen records actually left (most) | — | 32 | 11 | 26 | 11 |
| Load average (1 min) at the runs' starts, least–most | — | 2.95–10.65 | 3.89–4.54 | 3.71–6.36 | 3.31–3.92 |
| Runs (all passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

CT-PERF-002

| Item | Limit | 2.1.287 many | 2.1.287 heavy | 2.1.295 many | 2.1.295 heavy |
|---|---|---|---|---|---|
| A keystroke in the search field to the Pane redrawn, the plugin's own work | ≤ 50 ms | 10.14 ms | 1.59 ms | 9.87 ms | 1.85 ms |
| The same, waiting on the host included | ≤ 100 ms | 22.65 ms | 15.32 ms | 23.55 ms | 22.65 ms |
| Whole read and regroup when idle, the search index included | ≤ 1 s | 407 ms | 238 ms | 397 ms | 217 ms |
| Of which the search index (for reference) | — | 12 ms | 0.32 ms | 15 ms | 0.31 ms |
| Incremental read, each, the index's rebuild included | ≤ 150 ms | 123.32 ms | 96.36 ms | 111.57 ms | 92.94 ms |
| Pane redraw with the preview open, the plugin's own work | ≤ 16 ms | 2.09 ms | 0.99 ms | 2.09 ms | 1.12 ms |
| Keystrokes timed (all runs) | — | 102 | 102 | 102 | 102 |
| Load average (1 min) at the runs' starts, least–most | — | 2.95–10.65 | 3.89–4.54 | 3.71–6.36 | 3.31–3.92 |
| Runs (all passed) | 3 | 3 (3) | 3 (3) | 3 (3) | 3 (3) |

## Notes

1. **The three drivers ticket 21 was opened for.** `CT-COMPAT-003`: `ct_compat.py` now checks the contract since f1f5494 (no status line on any screen; the band while the Pane waits below the host's 144-column floor; a docked Pane the host turns inline at 100 columns is kept; on the main screen it opens inline by itself). `CT-LIFE-004` passes at 44 rows unchanged. `CT-LIFE-007`: the plugin listed the session both ways; the driver refused the Minimap's two rows as stray notes.
2. **The preview's new opening (ticket 24).** Every driver that opened the preview by a press or Enter now selects the entry and then presses `p` or clicks `p: 预览` under it, about 1 s after the press (a second click sooner is lost). The verifier reads the selected entry's row of Buttons apart from the entry's text.
3. **CT-PERF-001 ran with the preview open** (spec's Testing Decisions), opened that way on the newest entry after the resume.

## How to rerun

```sh
PY=<a venv with pyte, requirements.txt>/bin/python
G=mods/chat-toc/build/gate-0.2
$PY mods/chat-toc/tests/acceptance/release_gate.py run --host current --gate $G --types <2.1.295's claude-code index.d.ts>
$PY mods/chat-toc/tests/acceptance/release_gate.py run --host 2.1.287 --gate $G
$PY mods/chat-toc/tests/acceptance/release_gate.py report --gate $G --out mods/chat-toc/tests/evidence/<version> --commit <hash>
```

Run the versions one after the other, never side by side: `ct_reuse.py` and CT-SEC-001 use the system clipboard. Each version takes about 1.5 hours, the perf runs about half of it.
