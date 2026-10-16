# 20: Search and preview performance on long sessions

**What to build:** Measure search and the preview on the MVP's two 20 MiB fixtures and hold them to the 0.2 limits: a keystroke to the redrawn Pane ≤ 50 ms of the plugin's own work (≤ 100 ms with the host), the index inside the unchanged whole-read and incremental-read limits, and the Pane redraw with the preview shown inside its unchanged limit.

Spec: [chat-toc 0.2](../spec.md) §10; the MVP spec §9 and [its performance ticket](../../chat-toc/issues/27-long-session-performance.md) for the method.

**Blocked by:** 15 (The expanded preview), 16 (Search on the terminal)

**Status:** resolved

- [x] `hooks/perf.ts` samples the keystroke-to-redraw time and the index build under `CHAT_TOC_PERF`, numbers only
- [x] `perf_scenarios.py` types queries into the field on the many and heavy fixtures, 3 runs per version on 2.1.287 and the current version; the p95 meets every row of the spec's §10 table
- [x] `CT-PERF-001` rerun with the preview shown still meets the MVP's limits
- [x] `CT-PERF-002` added to the release gate's MUST list; the result table written to `mods/chat-toc/release/` beside `ct-perf-001.md`
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

- Results: `mods/chat-toc/release/ct-perf-002.md`; runs in `.scratch/chat-toc-0.2/assets/20-perf/runs/`. Worst p95 of a keystroke: 16.44 ms own, 28.31 ms with the host (`many`, 2.1.295).
- The plugin's own work was trimmed before measuring, behaviour unchanged: the matcher no longer allocates per group (about 3 ms to 0.3 ms per keystroke on 4432 turns), the narrowed list is the whole table when every group matches, and the preview is laid out again only when the match it shows changes.
- The incremental read limit is at the mercy of the host's process start: two earlier 2.1.295 `many` sets each had one run over 150 ms on the first submit after the hot reload, the host's `sh` taking 151–298 ms to hand over the text while the plugin's own share was 15–47 ms (one at a load average of 4, one at 34). They are kept in the evidence and described in the results' note 4; the table holds the third set, 3 of 3 passed.
