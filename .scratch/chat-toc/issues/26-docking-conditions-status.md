# 26: Docking conditions and the status line

**What to build:** When the terminal is not wide enough or not in the fullscreen layout, the person does not see a misplaced contents but sees the reason and how to meet the condition in the status line; once the condition is met the contents dock by themselves and the note goes. When the person opens it deliberately with `/chat-toc`, the host's placement is accepted, inline included.

Spec: [chat-toc MVP](../spec.md) §2.

**Blocked by:** 18 (The independent verifier and the PTY acceptance driver), 20 (Pane lifecycle)

**Status:** resolved

- [x] Open by itself only when `viewport.isFullscreen` is true
- [x] When an automatic open gets `isPlaced:false`, the Pane keeps waiting and does not draw, and the status line keeps the reason and the way; once it is seated and docked, `$.ui.status(undefined)` clears it
- [x] `/chat-toc` where it cannot dock is placed inline as the host places it, neither closed nor blocked, and the status line explains as usual how to get it docked
- [x] When a docked Pane is made inline by the host after the terminal narrows (`placement` is no longer `dock`), the plugin closes it (`origin: plugin`, not recorded as "closed") and shows the status line note, and opens it again by the automatic-open rules once the condition returns; the inline of a `/chat-toc` call is the exception
- [x] The threshold is the host's, with no column count hard-coded; the PTY samples only either side of `isPlaced` flipping (CT-COMPAT-003, as the later revisions of "Finalise the compatibility and acceptance contract" say)
- [x] Measure and record in the acceptance what the host actually does when the terminal narrows after docking

## Comments

- Implementation: `hooks/lifecycle.ts` gains `DOCK_STATUS` (the four status line texts) and `placementFate(placement, isInlineAsked)` (`docked` / `asked-inline` / `withdraw`). In `register.tsx`:
  - Whether it is fullscreen is read from `e.viewport.isFullscreen` in the `PromptHint`'s `ui.render` (`surface: 'terminal'`) and kept in a module variable; the startup events have no viewport, so when the layout is unknown `openUnasked` only records "wants to open" and opens at the first draw of the prompt line (as the official diff does). The host redraws the prompt line after a width change and after plugins load.
  - `openUnasked`: already closed by the person → does nothing; not fullscreen → the status line "mainScreen"; the Pane already open (hot reload) with `isPlaced:false`, or newly opened getting `isPlaced:false` → the status line "narrow". No column count is hard-coded; the threshold is the host's `isPlaced`.
  - The Pane's render reads `e.props.placement` and the new `$.state` key `isInlineAsked` (set true by `/chat-toc`, cleared once docked). Docked → `$.ui.status(undefined)`; inline and asked for by `/chat-toc` → kept, with the status line choosing "askedNarrow" or "askedMainScreen" by `e.viewport.isFullscreen`; any other inline → `$.ui.close` (origin `plugin`, not recorded as "closed") followed at once by an open under the automatic-open rules, so that the host makes it wait until wide enough and then seat it by itself. State cannot be written in render; every side effect goes into `$.clock.after(0, …)`. Two withdrawals in a row with no docking in between do not reopen (to stop open/close flapping when the host keeps placing it inline).
  - When the person clicks ✕ (`isClosedByPerson`) the status line is cleared too: it will not appear by itself again, so "appears by itself when widened" would no longer be true.
- The status line's actual text (the host shows it as `⚠ chat-toc: <text>`):
  - Not fullscreen, not open: "The contents dock on the right only in the fullscreen layout; run /tui fullscreen to switch"
  - Fullscreen but the host makes an unrequested Pane wait (terminal narrow) or the Pane is withdrawn after narrowing while docked: "The terminal is too narrow to dock the contents; widen it and they appear"
  - `/chat-toc` in fullscreen where it cannot dock, placed inline: "The terminal is too narrow, so the contents sit above the prompt; widen it to dock them on the right"
  - `/chat-toc` outside fullscreen, placed inline: "Outside the fullscreen layout the contents sit above the prompt; run /tui fullscreen to dock them on the right"
  - `/tui fullscreen` already exists in 2.1.287 (the hint in its binary also tells people to switch with it), and the 2.1.295 docs say the same.
- Tests: `tests/docking.test.ts` (10); `tests/host.ts` gained `statuses`, `unplaced` (open returns `isPlaced:false`) and `drawHint($, isFullscreen)` (draws the prompt line once), `start()` draws the prompt line first, and `mountPane` can set `placement` and whether fullscreen. At this ticket `claude plugin test` had 111 all passing, and after merging `chat-toc/mvp` (with tickets 23 and 25) 142 all passing, with `validate` and `tsc` clean on both versions. The test kit's `$` cannot trigger a person's close, so ✕ clearing the status line has no unit test and was not separately checked in the PTY.
- PTY: `tests/acceptance/ct_compat.py` (pyte, no model call); the five CT-COMPAT-003 scenarios `waiting / narrowed / asked / main / reload` all pass on 2.1.287 and 2.1.295, the run directories after merging mvp being `mods/chat-toc/build/pty-runs/20261011-084459-ct-compat-2.1.287` and `20261011-084532-ct-compat-2.1.295` (gitignored). `waiting` reads the threshold from the host's debug line `waits unplaced (unasked below N columns …)` (144 on both versions) and samples only at N-1 (still waiting, status line present) and N (docked, status line cleared). CT-LIFE 001/002/fork were rerun and pass on both versions (`20261011-084606-ct-life-2.1.287`, `20261011-084633-ct-life-2.1.295`).
- The measured host behaviour when the terminal narrows after docking (sampled with the plugin from before this ticket, `scratchpad/p26/probe.py`, runs `20261011-082945-p26-probe-current`, `20261011-083014-p26-probe-2.1.287`, `20261011-083042-p26-probe-current`; the same on both versions):
  - An automatically docked (unrequested) Pane **stays docked** from 170 to 130 columns: a Pane already seated is no longer bound by the unrequested threshold of 144.
  - Narrowed further to 100 columns: the host **neither closes it nor withdraws the seat**, but turns the same Pane inline (above the prompt, a full-width border), and `$.ui.panes()` still lists it; widened back to 170 columns the host turns it back to docked by itself.
  - `/chat-toc` at 100 columns: the host places it inline; widened to 170 columns the host turns it docked by itself, and narrowed again to 100 columns it turns inline again.
  - So "narrow → inline" does happen, and the plugin withdraws it as the spec says: after this ticket, at 100 columns the debug log reads `ui.close skipped: re-entry (… origin chat-toc)` (the plugin's own close no longer enters its own hook) followed by `ui.open … (unasked, 100 columns): waits unplaced`, with no inline frame on screen and the status line "The terminal is too narrow…"; widened back to 170 columns it docks by itself and the status line clears.
- Known limit: the reopen after a withdrawal is an unrequested open, so the terminal must be widened to the unrequested threshold (144, or 110 once the person has requested it) before it docks again, not docking at 110; this is the host's rule and the plugin does not rewrite it.

**2026-10-11 code review fixes (branch `chat-toc/review-fixes`)**

- Whether it is fullscreen is read, besides from `PromptHint`, from the `e.viewport` of the four transcript sites (`UserMessage`/`AssistantMessage`/`CommandOutput`/`ToolGroup`, accepting only `surface: 'terminal'`), so the automatic open can proceed even when the prompt line has not been drawn.
- After the second withdrawal it no longer stays closed for good: it records the terminal width at that time, and once any draw report shows a changed width it opens once more under the automatic-open rules (unrequested, waiting for the host to seat it), so the status line's "widen it and they appear" is true; if the host still places it inline at once it stops again and waits for the next width change, with no open/close flapping. The test is in `docking.test.ts`.
- `/chat-toc` also opens with `focus: true` when the Pane is closed (user story 3, "reopen and focus"); the CT-LIFE-001 PTY script gained a check that after reopening, `l` switches the Layout (the hotkey works only while focused), passing on both versions.
- PTY rerun (pyte, not logged in, no model call): `ct_compat.py` 10/10 on both versions, `ct_life.py` 6/6 on both versions.
