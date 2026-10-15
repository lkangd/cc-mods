# Find whether a forked session's transcript leads back to its parent

Type: research
Status: resolved
Blocked by:

## Question

A `--fork-session` (and `/branch`) transcript starts at the parent's last compaction boundary, so the Turn groups before it are missing from chat-toc. Does anything in the forked file, or anything the host publishes, lead back to the parent session's transcript file, so chat-toc could read the earlier groups from it, read-only, writing nothing?

Find out, on 2.1.295 and on 2.1.287:
- which fields of the forked file's rows (the first rows, the compaction boundary, `forkedFrom`-like fields, `sessionId`, `logicalParentUuid`) name the parent session or its file;
- whether the parent file is in the same projects folder, and what happens when the parent was itself forked or resumed;
- whether `classic.SessionStart` (source `resume`), `$.session.*` or any mods API value names the parent;
- whether the parent's rows past the fork point are reachable by `$.ui.scroll` (they likely are not, so they would show without a Jump target).

Record facts only; whether to use them is decided in the compaction ticket.

## Answer

Measured on 2.1.295 and 2.1.287 (identical on every point) with synthetic transcripts in logged-out worlds, plus a read-only structural scan of 540 local transcripts (field names and counts only). Scripts and structural reports: branch `research/chat-toc-fork-parent` (commit `9d298c7`, never merged), `.scratch/chat-toc-0.2/assets/01-fork-parent/`.

**Partly, and only through fields the host does not publish.**

- **Three fork producers differ.**
  - `claude --resume P --fork-session` copies the loaded rows (from P's last compaction boundary on) with the same uuids and a rewritten `sessionId`, and names the parent in no published field.
  - `/branch` writes `forkedFrom: { sessionId, messageUuid }` on every copied row (`sessionId` the immediate parent, `messageUuid` the row's own uuid), plus a `system/local_command` row whose text holds both ids.
  - The Agent SDK's `forkSession()` writes the same `forkedFrom` with fresh uuids and copies the pre-compaction rows too.
- **`session_id` (snake case) on rows the host writes itself** survives a `--fork-session` rewrite of `sessionId`, so copied rows still name the session that wrote them. It is in neither the types nor the docs. 116 of the 540 files have one foreign `session_id`; in 113 its file is in the same projects folder.
- **`compact_boundary.logicalParentUuid`** is kept verbatim in a fork, as the first chain row. It is a row uuid held by the original parent's file only (still the original after a fork of a fork). A folder search for it found the parent in 2 of 3 real files that start at a boundary.
- **Forks of forks**: `/branch` of a `/branch` names only the immediate parent; `--fork-session` of a `/branch` file keeps the old `forkedFrom` (the grandparent).
- **Where the parent is**: a fork lands in the folder of the cwd it was started in, so a parent can be in another projects folder (a worktree; 3 real cases). Resuming the parent after a fork grows only the parent's file; the fork does not see those rows. Retention (`cleanupPeriodDays`) may delete a parent file (not tested).
- **Mods API names no parent**: `classic.SessionStart` gives `source: "fork"` for both `/branch` and `--fork-session` but no parent id; `session.start` and `$.session.*` neither. (Inside an in-process `/branch`'s `classic.SessionStart`, `$.session.id()` still returned the parent's id: an accident, not an API.)
- **No Jump target**: `$.ui.scroll` to a parent-only row from any fork answers `{ deny: "nothing drawn under that requestId" }`.
- **Unknown**: Desktop; the `/resume` picker; a fork of a parent compacted by a real model; versions between 2.1.287 and 2.1.295 and newer; `--resume-session-at`.
