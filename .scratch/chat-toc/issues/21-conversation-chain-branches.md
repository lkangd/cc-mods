# 21: The conversation chain: compaction, rewind, resume, fork

**What to build:** The contents always reflect only the current branch: entries from before a compaction show as usual; the next submit after a rewind makes the thrown-away branch leave the contents; after resume and fork the contents match that session file's conversation chain; two sessions of one project in two terminals each show only their own contents.

Spec: [chat-toc MVP](../spec.md) §3 (the conversation chain), §4 (lifecycle).

**Blocked by:** 18 (The independent verifier and the PTY acceptance driver), 19 (The full grouping rules and the Agent reply)

**Status:** resolved

- [x] Walk back along `parentUuid`, and on a `system/compact_boundary` switch to `logicalParentUuid`; entries from before the compaction show as usual (CT-LIFE-003)
- [x] After a rewind (Esc Esc included), the next submit makes the thrown-away branch's entries disappear (CT-LIFE-004); in the window before the submit the old entries are still there, as the not-promised list says
- [x] After `--resume`, `--continue`, `/resume` in a session and `--fork-session`, the verifier finds the contents match the conversation chain (CT-LIFE-005)
- [x] Two sessions of one project in two terminals each show only their own transcript (CT-DATA-006)
- [x] The criterion is always the independent verifier; the scenarios above pass on both versions

## Comments

- 2026-10-11 implementation: `parentOf` in `hooks/chain.ts` switches to `logicalParentUuid` at a `system/compact_boundary` (whose `parentUuid` is empty); incremental regrouping reuses the same `parentOf`, and the random sessions in `tests/incremental_regroup.test.ts` now include compactions, with chunk-by-chunk reads still equal to the whole regroup. In the real transcripts of 2.1.195 to 2.1.295 on this machine, every compact boundary is `parentUuid: null` + `logicalParentUuid`, and `preservedSegment` points at rows that already exist before the boundary; walking back along `logicalParentUuid` passes through them naturally and does not repeat them.
- The PTY acceptance script is `mods/chat-toc/tests/acceptance/chain_scenarios.py`, with `toc_verifier` as the only criterion; on 2.1.287 and 2.1.295, all 6 scenarios pass on each (CT-LIFE-003 two compactions plus a discarded branch, CT-LIFE-004 submit after an Esc Esc rewind, CT-LIFE-005 `--continue` / `--fork-session` / `/resume` in a session, CT-DATA-006 two terminals; `--resume` is covered by the first two scenarios). The acceptance world is not logged in: a submitted prompt is written into the transcript and the host itself replies with one line "Not logged in", so the submit after a rewind and the submit after a fork call no model.
- The compactions use synthetic boundary rows (shaped like the real ones); a real `/compact` was not run (it would call the model).
- Before the first submit after `--fork-session`, the new session's file does not exist: the contents and the file agree (both empty), but the Pane shows "No conversation in this session yet" while the transcript on the left holds the history that was forked, so that line would mislead. The host writes the file only after the first submit, and writes only the part it holds in memory (after the last compaction); the contents then agree with the file. Changing this empty-state text belongs to the Pane lifecycle (ticket 20), which is left to decide it, for example a different line when `SessionStart`'s `source` is `resume`/`fork` and the file does not exist.
- The `forms` fixture's smoke now shows the groups from before the compaction; the only remaining mismatch is F02 (`hooks/cells.ts` counts ✨ as 1 cell, see the pty-harness notes), unrelated to the conversation chain.
