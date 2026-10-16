# 20: Search and preview performance on long sessions

**What to build:** Measure search and the preview on the MVP's two 20 MiB fixtures and hold them to the 0.2 limits: a keystroke to the redrawn Pane ≤ 50 ms of the plugin's own work (≤ 100 ms with the host), the index inside the unchanged whole-read and incremental-read limits, and the Pane redraw with the preview shown inside its unchanged limit.

Spec: [chat-toc 0.2](../spec.md) §10; the MVP spec §9 and [its performance ticket](../../chat-toc/issues/27-long-session-performance.md) for the method.

**Blocked by:** 15 (The expanded preview), 16 (Search on the terminal)

**Status:** ready-for-agent

- [ ] `hooks/perf.ts` samples the keystroke-to-redraw time and the index build under `CHAT_TOC_PERF`, numbers only
- [ ] `perf_scenarios.py` types queries into the field on the many and heavy fixtures, 3 runs per version on 2.1.287 and the current version; the p95 meets every row of the spec's §10 table
- [ ] `CT-PERF-001` rerun with the preview shown still meets the MVP's limits
- [ ] `CT-PERF-002` added to the release gate's MUST list; the result table written to `mods/chat-toc/release/` beside `ct-perf-001.md`
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
