# 20: Pane lifecycle

**What to build:** The person controls whether the contents stay or go: after a click on ✕ the Pane does not pop up again this session; `/chat-toc` reopens it at any time or focuses it early (it never closes it); after `/clear` and `/resume` the contents rebuild with the new session and pop up by themselves again; a hot reload does not open it twice, and other plugins' Pane toggles do not affect it.

Spec: [chat-toc MVP](../spec.md) §2.

**Blocked by:** 17 (The minimal docked contents), 18 (The independent verifier and the PTY acceptance driver)

**Status:** resolved

- [x] Only a `ui.close` for this Pane's id with `origin.kind === person` records "closed for this session" in `$.state`; no `closeOnEscape`
- [x] `/chat-toc` (no arguments, `immediate: true`): opens the Pane when it is closed; when it is open (foreground or a background tab) brings it to the front with `focus: true`; never closes it; opening an already open id without switching tab degrades to focusing only
- [x] When `classic.SessionStart`'s `source` is `clear` or `resume`, the Pane opens by itself again under the same conditions and switches to reading the new `transcript_path`; after `/clear` the contents empty and rebuild, with no dividing line
- [x] When `session.start` fires again after a hot reload, it checks `$.ui.panes()` and the closed mark first and does not open twice
- [x] Other plugins' Pane toggles (such as the built-in diff) do not affect the closed mark; when chat-toc opens by itself it is in the foreground by the host's rule, and when it is pushed to the background or comes back to the foreground it does nothing
- [x] PTY acceptance CT-LIFE-001 and CT-LIFE-002 pass on both versions

## Comments

- Implementation: `hooks/lifecycle.ts` (the three pure judgements `isClosedByPerson`, `reopensOn`, `isPaneOpen`); in `register.tsx`, `openUnasked`/`autoOpen` (automatic opens run serially, so when `classic.SessionStart` and `session.start` arrive together at a `--resume` start it opens only once), `openAsked` (`/chat-toc`: when already open it opens again with `focus: true` and clears the closed mark), and the `ui.close` hook (the mark is recorded only after `next`, and not when a lower layer refuses the close). The closed mark is `$.state`'s `isClosed`. When `classic.SessionStart`'s `source` is `clear`/`resume`, the mark is cleared explicitly before opening by the rules, so it does not depend on the order in which the host resets it.
- Tests: `tests/pane_lifecycle.test.ts`. The test kit's `$` has no `ui.close` (and no `ui.open`), so a test cannot trigger a person's close; which kind of close counts is therefore tested on pure functions, and the mark's own effect is checked in the PTY.
- The fullscreen check, `isPlaced`, the status line note and the plugin closing the Pane when it goes inline are all left to ticket 26 and not done in this one.
- PTY: `tests/acceptance/ct_life.py` (pyte, no model calls). CT-LIFE-001 and CT-LIFE-002 pass on both 2.1.287 and 2.1.295; the run directories are `mods/chat-toc/build/pty-runs/20261011-081906-ct-life-2.1.295` and `20261011-081840-ct-life-2.1.287` (gitignored; the evidence is copied at release time). A hot reload was triggered by changing the plugin copy's `register.tsx`; the `--debug-file` log shows `reloaded`, `session.start settled` and every `ui.open chat-toc chat-toc (unasked|asked …)`, which confirms there was no further open after the reload.
- `/reload-plugins` does not reload hooks modules that have not changed (log: `hooks modules unchanged, kept as loaded`), so it is not a means of accepting a hot reload.
- After `/clear`, the new session's file starts with the `/clear` local command, so the new contents hold one group "/clear" and do not read "No conversation in this session yet"; CT-LIFE-002 compares against the verifier's reading of the new session's file.
- Added (carried over from ticket 21): after `--fork-session`, the new session's file does not exist before the first submit, yet the transcript shows the original session's history, so the former "No conversation in this session yet" would mislead. When `classic.SessionStart` switches the path, it records `$.state`'s `isCarriedOver` by `source` (true for `resume` or `fork`, `carriesHistory`), and when the file does not exist the Pane shows: "This session has no transcript file yet; the contents appear after the first message" (`NOT_WRITTEN_TEXT`). A new session and a `/clear` session still show "No conversation in this session yet". Measured on both 2.1.287 and 2.1.295: `--fork-session` reaches this line (`ct_life.py --scenario fork`, recorded as part of CT-LIFE-005); submitting one message in the logged-out test world, the host itself replies "Not logged in", and once the file is written the Pane and the verifier read the fork file the same way, with no model call.
- Known: the toc_verifier's `find_pane` recognizes only entries or "No conversation in this session yet" and cannot recognize this new line; `ct_life.py` reads the text right of the border itself to decide, and the verifier is unchanged.
- Ticket 21's `chain_scenarios.py life-005-fork` used to assert that after a fork the Pane shows "No conversation in this session yet"; it now asserts the new line and that the old line does not appear; rerun and passing on both versions (`20261011-082047-chain-2.1.295`, `20261011-082052-chain-2.1.287`).
