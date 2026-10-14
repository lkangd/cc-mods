# 29: The 0.1.0 release gate and release

**What to build:** chat-toc 0.1.0 passes every MUST on two Claude Code versions, appears in the marketplace and the root README with traceable evidence, and is verified once by installing from GitHub after release.

For the spec, see [chat-toc MVP](../spec.md) §10 and "Testing Decisions".

**Blocked by:** 27 (Long-session performance), 28 (User docs and developer docs)

**Status:** resolved

- [ ] The evidence directory (per plugin version) holds `report.md` (including the manual visual check sign-off), `report.json` (plugin version, Claude Code version, OS, architecture, fixture, scenario ID, expected, actual, result, evidence link, commit hash) and `marketplace.md`
- [x] 2.1.287 and the then-current version each run every MUST of "Finalise the compatibility and acceptance contract", with zero failures, zero missing, zero skipped (CT-COMPAT-001 and so on)
- [x] CT-SEC-001: the synthetic unique-marker prompt appears only in the Pane's drawing, not in `$.store`, the plugin data directory, logs, error text or the release report
- [x] Before release, run the CT-COMPAT-002 smoke on both versions with a local directory marketplace
- [ ] Manual visual check sign-off (how the three Layouts look, the highlight and the cursor can be told apart); does not block
- [x] The marketplace entry (`chat-toc`, `./mods/chat-toc`, English description, `0.1.0`, `chat-toc contributors`, no category/tags), the root README row and section, and the evidence directory are in the same release commit; no tag
- [x] After pushing, run an install-level check from `lkangd/cc-mods` (add, install, version, enabled, Pane appears) and add the result to `marketplace.md`; if it fails, revert the release commit

## Comments

- 2026-10-11: the commit under test is `a83f74c` (the plugin code did not change after it). `tests/acceptance/release_gate.py` ran all 32 MUSTs on 2.1.287 and 2.1.295 with `--plugin-dir`: 32/32 passed on each, 92 records, zero failures, zero missing, zero skipped; `claude plugin validate` passed on both versions, `tsc` is clean on both, `claude plugin test` passed 210; CT-PERF-001 stayed within the thresholds on both versions, 3 runs for each of the two fixtures; the evidence holds no CT-SEC-001 marker. The scenarios that had no script are added in `gate_scenarios.py` (CT-TURN-004's "Running · N steps" runs one real turn with tool steps using the local stand-in `fake_api.py`, without calling a model) and `ct_marketplace.py`.
- In the first gate round, CT-UI-003 failed once on 2.1.287. The cause was in the check itself (it hard-coded the start of the host's focus ring and did not allow for `/tui` having only a user side). After the check was changed (`a83f74c`), the whole gate and the performance runs were repeated.
- The local directory marketplace smoke passed on both versions. After the release commit `066d082`, the install-level check from GitHub failed on both versions: the repository's default branch was not main, so the marketplace cloned by `marketplace add lkangd/cc-mods` had no chat-toc; per the rule, the release was reverted (`abd2e8b`). The user changed the default branch to main and the release was published again (`b3396e6`, same content); the install-level check passed on both versions, see `mods/chat-toc/tests/evidence/0.1.0/marketplace.md`.
- The manual visual check sign-off (how the three Layouts look, whether the cyan highlight and the inverse cursor can be told apart) is not ticked, and the evidence directory item is not ticked either (`report.md`, `report.json` and `marketplace.md` are all there; only the sign-off in `report.md` is missing): left to the user, in the section "Manual visual check (awaiting the user's sign-off)" of `report.md`; it does not block the release.
- 2026-10-12: the manual visual check for 0.1.0 is no longer signed. Ticket 30 changes the highlight from fixed cyan to the theme's `suggestion`, so the look has changed; the sign-off moves into the 0.1.1 evidence directory (the user confirmed in the grilling). The two unticked items above therefore stay unticked.
