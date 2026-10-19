# 21: Three release-gate drivers that fail before 0.2 can ship

**What to build:** Make the release gate's MUST list run green on 2.1.287 and the current host. A run of the gate on the current host (`--skip-perf`, after the review fixes at 5e8bdaf) failed three scenarios; each also fails at 913e6ce, so none comes from the review fixes.

- `CT-COMPAT-003` (`ct-compat`): the driver waits for a status line that f1f5494 removed. Assert on what the Pane draws now.
- `CT-LIFE-004` (`chain`): at 44 rows the six groups no longer fit with the preview region drawn. Raise the terminal's rows, as `ct_compaction.py` did.
- `CT-LIFE-007` (`ct-mid-session`): neither way of enabling chat-toc mid-session gets the Pane to list the session. Find whether the driver or the plugin is wrong before changing either.

Spec: [chat-toc 0.2](../spec.md) §11 ("Each release runs every MUST of the features it contains, old and new, on 2.1.287 and the current version").

**Blocked by:** none

**Status:** resolved

- [x] `CT-COMPAT-003`, `CT-LIFE-004` and `CT-LIFE-007` pass on 2.1.287 and the current host
- [x] The whole MUST list, perf included, passes once on both versions; the result recorded in `mods/chat-toc/release/`

## Comments

Ticket 22 (preview closed until a press) frees the preview's rows by default, so `CT-LIFE-004`'s six groups may fit at 44 rows again; check after 22 lands before raising the rows.

- 2026-10-17 (ticket 24's changes): on the terminal a press or Enter on an entry no longer opens the preview; it selects the entry, and `p` (or the `p: 预览` Button on the row under it) opens it (spec §3). Search Enter opens none (§2). The PTY drivers that open the preview by a click or Enter (`ct_preview.py`, `ct_reuse.py`, `ct_search.py`, `perf_scenarios.py` CT-PERF-001, and the gate's UI scenarios) need `p` after the press before the MUST run.
- 2026-10-17 (the drivers fixed; plugin code unchanged):
  - `CT-COMPAT-003`: `ct_compat.py` rewritten to the contract since f1f5494: no status line (checked absent on every screen); while the Pane waits below the host's floor (144) the band stands for it; at 100 columns the host turns a docked Pane inline and chat-toc keeps it; on the main screen it opens by itself inline. The withdraw and status-line checks are gone.
  - `CT-LIFE-004`: passes at 44 rows now that the preview is closed by default; the rows are unchanged.
  - `CT-LIFE-007`: the driver was wrong, the plugin right. The Pane listed the session both ways, but `matches_file` asked for no notes, and the parser keeps the Minimap's two rows as notes. It now drops them, and records the last diff when it times out.
  - The preview drivers press the entry, then `p` (keys in the Pane) or a click on `p: 预览`. A second click right after the press on the entry is lost, so the drivers wait about 1 s first. The verifier reads the selected entry's row of Buttons (`PaneEntry.selected`, `actions`, `action_row`) instead of taking it for the entry's text. `ct_reuse.py closed` now checks that the row keeps `r` and `c` (the side selected) while the preview is closed; `ct_search.py keys` checks that search Enter selects the match and opens no preview.
- 2026-10-17: the whole MUST list, perf included, passed on 2.1.287 and 2.1.295 (188 records, 0 failed, missing or skipped; 0 leaks), recorded in `mods/chat-toc/release/gate-0.2.md`. The first run failed everywhere for a relative `--gate` (the hosts run in their worlds, the tsconfig resolves from its own folder); `release_gate.py` now resolves `--gate` and `--types` itself.
