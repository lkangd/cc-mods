# 27: Long-session performance

**What to build:** In a 20 MB-class long session the contents appear within seconds, and scrolling, jumping and redrawing do not stall; continuous scrolling reaches both ends, with no paging.

Spec: [chat-toc MVP](../spec.md) §7 (long sessions), §9.

**Blocked by:** 22 (Chunked and incremental reads of large files), 24 (The Current position highlight and the TOC following), 25 (View filter, three Layouts and the keyboard)

**Status:** resolved

- [x] Entries are cached per group (key: width, running, steps, outcome, last text) and the entry table is rebuilt only when the data, width, View filter or Layout changes; the highlight and the cursor are overlaid at draw time; only the visible window is drawn; locating a group's entry uses a table
- [x] With the 20 MiB many and heavy fixtures, 3 runs each on 2.1.287 and the current version, p95 meets: first contents ≤4 s, idle whole read plus regroup ≤1 s, a single incremental read ≤150 ms, a row appended to the model updated ≤1 s, the Pane itself ≤16 ms, with the host ≤100 ms, Current position ≤2 ms (≤5 ms with 3000 leftover records)
- [x] Continuous scrolling and jumping in a long session reach the first and last groups, with no paging (CT-PERF-001)
- [x] The results are written as a table that can go into the release report

## Comments

2026-10-11, branch `chat-toc/27-perf` (based on `chat-toc/mvp` c4dccaa).

- **The entry table** (`hooks/table.ts`): each group's entries are cached by its opening row, the key being the group's position, running or not, steps, outcome, last text and user-side text (a change of width, View filter, Layout or year voids the whole cache). The entry table (entries, heights, the key and reverse-lookup tables, each group's first entry) is updated only when the group array, width, filter, Layout or running changes; when the file only grows, only the last few groups are taken off and re-laid out (0.05 ms at 4432 groups), and after a whole regroup the same groups reuse the old entries. The register's Pane drawing now uses the table: `entryOfGroup` looks up the table in place of `firstEntryFrom`'s binary search, and the height and key tables are no longer recomputed each time; the highlight and the focus are still overlaid at draw time, and only the visible window is drawn. Before this, every draw ran `entriesOf` over all entries, which took 18–35 ms in the many shape.
- **Timing** (`hooks/perf.ts`): sampled only when the environment variable `CHAT_TOC_PERF` has a value, at most one batch a second, written as `chat-toc-perf {...}` lines through `$.ui.log(..., { to: 'debug' })` into the host's debug log (the host cuts a line at about 10 thousand characters, so each line is ≤ 4000 characters). The samples hold numbers only, checked in both the tests and the copying of evidence (CT-SEC-001). With the variable unset nothing is measured or written; `validate`'s env reads therefore gain `CHAT_TOC_PERF` and its calls gain `ui.log`.
- **The leftover on-screen records raised by ticket 24**: in real use at most 30 (many, 1500 notches of fast scrolling); 3000 can only be synthetic: in the plugin's runtime p95 is 0.31–0.34 ms (≤ 5 ms), and the Current position algorithm was not changed.
- **The result table**: `mods/chat-toc/release/ct-perf-001.md`, which ticket 29 pastes straight into report.md; the run records are in `.scratch/chat-toc/assets/27-perf/runs/`. Both versions × two fixtures × 3 runs all pass: the first contents come 0.53–0.77 s after the transcript, the idle whole read takes 195–375 ms, the incremental read p95 26–111 ms, append to model 347–514 ms, the Pane itself p95 ≤ 0.38 ms and with the host ≤ 8.7 ms, the Current position p95 ≤ 0.03 ms; the first and last groups are both reached by continuous scrolling and by clicks.
- **Known long tails**: the first draw after a file read builds the whole table, 55–61 ms in many (p95 unaffected); the first incremental read after a hot reload spends about 100 ms on the first `$.process.run`. Both are within the thresholds and were not optimized further.
- **Ticket 28 docs**: `mods/chat-toc/README.md` gained the CT-PERF-001 command, `CHAT_TOC_PERF`, and `table.ts`/`position.ts`/`perf.ts` in the directory structure; the root README draft's "Known limits" sentence gained the conclusion on the reference machine; "can also jump to turns from long ago that never showed" was verified again on a 4521-turn session and needs no change.
- PTY driver: `tests/acceptance/perf_scenarios.py run <host> <many|heavy> --runs 3`, and `table <run directory>...` produces the table; the synthetic part is in `tests/long_session.test.ts`.
