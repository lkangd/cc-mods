# 23: Full jumps: the Agent side, fallbacks and refusals

**What to build:** Every side of the contents can be clicked: the Agent side jumps to the last text reply of the turn; local commands, prompt-type commands and `!cmd`, rows that are visible but have no site, fall back to a jump to the nearest row and leave the original input row on screen; when a jump really cannot be made, one line of explanation shows and that side dims, so a click never does nothing.

Spec: [chat-toc MVP](../spec.md) §5.

**Blocked by:** 18 (The independent verifier and the PTY acceptance driver), 19 (The full grouping rules and the Agent reply)

**Status:** resolved

- [x] Hook `UserMessage`, `AssistantMessage`, `CommandOutput` and `ToolGroup` (reading only `requestId` and `onScreen`, not changing the drawing)
- [x] `requestId` → row is matched in order: exact uuid → without the `collapsed-` prefix → tool_use id → first 24 characters; a jump uses the id the host gave; the map is rebuilt after every transcript read, and on an incremental read only the new rows are added and unresolved ids retried
- [x] The Agent side jumps to the row holding the last text; with no last text it jumps to the group's last drawable row (`AssistantMessage` or `ToolGroup`), and if the group has none it is handled as a refusal
- [x] Rows never drawn can be jumped to, such as jumping to turn 1 after resuming 300 turns (CT-JUMP-001)
- [x] Fallback jump: the nearest drawable row after, then before when none is after, with `block: center`; a refusal moves on to the next candidate, up to 3 (CT-JUMP-002)
- [x] When all are refused the bottom shows "This entry is not in the conversation view now; cannot jump to it", gone at the next jump, at a selection move or after about 5 seconds; every row of that side gets `dimColor` until the host lists the row again; no other side effect (CT-JUMP-003)
- [x] No entry is dimmed in advance
- [x] Automated tests cover the four-step match and the candidate order; PTY acceptance CT-JUMP-001 to 003 passes on both versions

## Comments

2026-10-11, branch `chat-toc/23-jumps`.

- **Code**: `hooks/sites.ts` holds the site records and the `requestId` matching (`RowIndex` indexes by the conversation chain: uuid → position, first 24 characters, tool_use id; `Sites` records the ids drawn, the row each corresponds to, the host id to jump with, and the on-screen record). `hooks/jump.ts` gives the targets each side tries in order (`jumpTargetsOf`), the dimming of a refused side (`dimRefused`) and its recovery (`relisted`). `register.tsx` hooks the `ui.render` of the four sites (record only, `next(e)` as usual), and after every transcript read runs `syncRows` + `resolveSites`: when the chain is the same array it only adds new rows and retries ids not resolved; when the chain changed (a whole re-read, a rewind) everything is matched again.
- **Host facts** (from the `reveal` in the 2.1.287 binary): in the message list the host looks up by "entry uuid equal → the entry's tool_use id (a single tool row, grouped, a member of collapsed read/search) → same length and the same first 24 characters"; a multi-block message is split into entries `<first 24><12-digit sequence>`. So a tool row never drawn can be jumped to by its first tool_use id, with no need to guess `collapsed-…`.
- **Trade-offs** (where the spec does not say):
  - In the fallback candidates, "drawable row" is the four kinds the spec lists plus the assistant's tool rows (jumped to by tool_use id). This way a prompt-type command lands on its first tool group, not after a long run of tools; with no last text, the Agent side uses the same judgement to take the group's last assistant row.
  - The Agent side with no last text uses `block: 'start'` (this is the side's own row, not a neighbour); only the user-side fallback uses `center`.
  - Every click retries the full candidate list (up to 3) and does not skip the row refused last time; a refusal has no side effect.
  - Recovery from dimming: it recovers when a row drawn by any site is one of this side's candidates (recomputed from the current data), so a running turn writing new rows recovers it too; a successful jump also recovers it. A hot reload and `/clear` clear it.
  - The notice "This entry is not in the conversation view now; cannot jump to it": it goes at the next jump, when the selection moves to another entry (in ticket 25's `ui.focus` hook, including the step where it moves the window before landing the focus), or after 5 seconds (clearing only its own timer). When it appears together with the data source's note it ranks above it, the two lines in one `Text`; `pane.tsx` is unchanged.
  - The test fixture uuids now carry a sequence at both ends, so the first 24 characters differ (they were all the same before, leaving prefix matching nothing to test).
- **For ticket 24**: `Sites.onScreen` already keeps the on-screen record keyed `<component>|<requestId>` with the report sequence (`seq`, the largest being the latest), and a `null` report deletes it; `rowOf` (id → row) and `RowIndex.order` (row → position on the chain) can be used directly. Not done yet: the ordered array of drawable rows, the contiguous-run split with binary search, and the lock after a jump.
- **Tests**: after merging the then-current `chat-toc/mvp` (with 20, 21, 25, 26), `claude plugin test mods/chat-toc` 165 all pass (2.1.295), and the acceptance unit tests 43 pass; `tsc` passes against both the 2.1.287 and 2.1.295 declarations; `plugin validate` passes on both versions. New are `tests/request_ids.test.ts` (the four-step match, draw before read, incremental and chain change), `tests/jump_targets.test.ts` (candidate order) and `tests/refused_jumps.test.ts` (the test engine refuses every transcript jump, used to test the notice, the dimming, the 5 seconds, the next jump, the selection move and recovery after being drawn again).
- **PTY**: `tests/acceptance/jump_scenarios.py <version>` (pyte, isolated environment, `--resume` of a synthetic transcript, no model call). One run each on 2.1.295 and 2.1.287, all passing:
  - CT-JUMP-001: resume 300 turns; a click on turn 1's user side puts the prompt at the top; a click on the Agent side puts the last text at the top.
  - CT-JUMP-002: `/tui` jumps to the output row and `! echo` to the next prompt, both centred with the original input row staying above; the prompt-type `/review` jumps to its tool group, the local command `/model` in user-row form jumps to its output, and an Agent side with only tools jumps to the last tool group; none was refused.
  - CT-JUMP-003: after an Esc Esc rewind in the host (no model call), a click on an entry of the discarded branch: the notice appears at the bottom, that side goes grey as a whole (the host draws dimColor as foreground 999999, judged by colour under pyte; hovering inverts it, so the pointer is moved away before judging), the other side is unchanged, and the transcript does not move; after 6 seconds the notice is gone and the side is still grey. "Recovery after the host lists the row again" cannot be produced in the PTY (after a rewind, with no model, the row cannot be listed again), and is covered by the automated tests.
  - After merging mvp, both versions were rerun once and all pass; run directories: `mods/chat-toc/build/pty-runs/20261011-085726-CT-JUMP-current`, `20261011-085933-CT-JUMP-2.1.287` (gitignored).
