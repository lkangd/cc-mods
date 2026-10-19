# 34: Release 0.1.2

**What to build:** After tickets 31–33 merge into main, release chat-toc as 0.1.2.

**Blocked by:** 31, 32, 33

**Status:** done

## Decisions made (grilling, 2026-10-12)

- Each of tickets 31–33 gets a branch (`chat-toc/3x-…`), test first, merged into main with `--no-ff`.
- Once all three are merged, release 0.1.2 by the README's "release checklist": the full gate on 2.1.287 and the current version (MUSTs rise from 33 to 37: `CT-LIFE-007`, `CT-LIFE-008`, `CT-JUMP-005`, `CT-UI-005`, and `CT-LIFE-004` is revised), the marketplace smoke, the GitHub install check.
- Ask the user before pushing.
- Run PTY acceptance and performance tests in series, when the machine is idle.

## Steps

- [x] Add the new items to the MUST table and the sign-off notes of `release_gate.py`
- [x] The gate (evidence directory `mods/chat-toc/tests/evidence/0.1.2/`)
- [x] The release commit (marketplace version, root README, evidence directory)
- [x] Push with the user's consent, and do the install-level check from GitHub

## Comments
- 2026-10-12 gate (commit under test `4926422`, two versions in series, `release_gate.py run --screens`): everything passed except perf-many (37 MUSTs, validate, test 251, unit 43, tsc on both versions, the local marketplace smoke, the sign-off screenshots). On each of the two versions, one perf-many run went over the "incremental read ≤ 150 ms" limit (166 ms on 2.1.287, 275 ms on 2.1.295), with medians of 17–30 ms, the same as 0.1.1; the load average was 10–11.5 then, and an `xctest` was using about 94% CPU. The failed perf runs were moved to `gate-attempt1/` in the scratchpad.
- Second round (`--only-perf`, load 6–7): both perf kinds passed on 2.1.287 (many's incremental read maximum 111–123 ms); perf-many on 2.1.295 crashed inside pyte (`IndexError` in `screens.py` `render`, a driver problem, no record produced), and was moved to `gate-attempt2/`.
- Third round (2.1.295 `--only-perf`, load 4–6): both perf kinds passed (many's maximum 67–128 ms). `release_gate.py` was changed to merge `codes.json` on a partial rerun, so it no longer has to be rebuilt from the logs. `report`: 114 records all passed, missing 0, leaks 0.
- 2026-10-13 pushed with the user's consent (`48622c0..c887155`), the default branch confirmed as `main`; the install-level check from GitHub passed on both versions (0.1.2 enabled, the Pane docks by itself, click-to-jump works), the result added to `marketplace.md`, evidence in `github-install/`.
