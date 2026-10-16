# 13: The preview region on the terminal

**What to build:** A region at the bottom of the Pane that shows one Turn group whole without jumping: the meta line (date, time, state, steps, duration, output tokens), the User input as typed, the last text as Markdown, and the files line. It shows the selected group while the Pane holds the keys, else the Current position's; `p` folds it to one line and the choice is kept. This is the tracer for 0.2: it adds the per-group facts that search, reuse and the Desktop tree build on.

Spec: [chat-toc 0.2](../spec.md) §1 (layout, shortage order), §3 (all but "Expanded" and "Text cap"), §4 (all but compaction boundaries and the fork line), §9.

**Blocked by:** none

**Status:** resolved

- [x] The groups carry, in memory only: the User input as typed (code blocks and pasted content restored; `/name args`; `!cmd`; `(image only)`; a has-images flag), files changed (`Edit`/`Write` `file_path`, `bashEditDiff.changedFiles`) and read (`Read` only, changed wins), the summed `turn_duration` `durationMs` (absent without a row), and output tokens once per `message.id` (absent without `usage`); the running group's latest text so far
- [x] An incremental read and a whole regroup give the same facts group by group (unit test)
- [x] The region sits above the footer, its rule `Preview · p` / `预览 · p`, height 40% of the rows left after the head, search row and footer, held to 4–14 rows; the content cut files line → Agent text → User input, the meta line kept, the last row the Button `↓ N more lines · e: expand` (the press is wired by ticket 15; until then it does nothing visible beyond the line)
- [x] The meta line's formats in both languages (date always; state only when not finished; duration `45s`/`3m 20s`/`1h 5m`/`<1s`; tokens `3.5k out`, `1.2M`); unreadable fields left out with no placeholder
- [x] The files line's paths relative to the session's working directory when under it, else absolute with `~`; `+N` and `read N` as in the spec
- [x] Which group: the selected entry's while the Pane holds the keys, else the Current position's, else the newest; a running group redrawn as rows arrive, staying at its top
- [x] `p` toggles it, kept in `$.store` (unknown value reads as shown); hidden it is one Button `p: Preview`; at a short height the Minimap goes first, then the preview shrinks to 4 rows, then `p: Preview (no room)`; the list keeps 8 rows
- [x] The last text in a `Markdown`; checked on 2.1.287, and if that host draws none, plain `Text` there by `$.session.version()`
- [x] Drawn in all three Layouts at 36, 44 and 56 columns, on 2.1.287 and 2.1.295
- [x] `CT-PREV-001` added to the PTY drivers and the release gate's MUST list, passing on both versions; `CT-SEC-001`'s `$.store` check includes the preview flag; `CT-UI-001`/`002` cover the region
- [x] Root README: the controls table (`p`, selection drives the preview), "What it shows" (the preview), data and privacy (`$.store` gains the flag), known limits 1 and 2 of the spec
- [x] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Comments

- Done on `chat-toc-0.2/13-preview`. The facts are `TurnGroup.facts` (`hooks/facts.ts`, filled by `groups.ts` as the group's rows are read, so the incremental regroup gives them as the whole file does: `tests/incremental_regroup.test.ts`'s random walk now writes usage, file tools, Bash diffs and `turn_duration` rows). The preview's words, size and cut are pure in `hooks/preview.ts` (`tests/preview_parts.test.ts`); the region through the test kit in `tests/preview_region.test.ts`; facts in `tests/group_facts.test.ts`.
- The shown rule reads `─ p: Preview ───` / `─ p: 预览 ───`, not `Preview · p`: a `plain` Button with a hotkey always draws its key first (`p: label`), and `p` needs a drawn Button. Folded and with no room the same Button is dim (`p: Preview`, `p: Preview (no room)`); shown it is at full strength.
- The meta line is one row: when it is wider than the Pane its last fields are left out whole (in Chinese at 44 columns a 4-step turn with duration and tokens is 46 cells, so the tokens go), never a cut figure. Widening the Pane (Ctrl+X ←) brings them back.
- `Markdown` draws on 2.1.287 as on 2.1.295 (headings, lists, code spans; PTY screens in both runs), so there is no version switch. The last text sits in a Box of the rows reckoned for it with `overflow="hidden"`; the reckoning folds the Markdown source, so `↓ N more lines` counts source rows. A `Markdown` takes at most 10,000 characters: the region cuts to that; ticket 15's expanded preview (about 60,000 characters) has to split its text over several `Markdown`s.
- The cut line is `↓ N more lines · ` (a `Text`) and the Button `e: expand` (key `preview.more`, hotkey `e`); its press does nothing until ticket 15.
- The selected group follows the host's focus ring: `ui.focus` redraws when the ring moves to another group. The preview's Buttons sit between the entries and the Layout Button in the ring; `ring.ts` treats them as it treats the footer.
- PTY (`tests/acceptance/ct_preview.py`, `which`, `facts`, `cut`, `toggle`, `short`, `widths`, all pass on 2.1.287 and 2.1.295, also after merging ticket 14). `widths` draws the three Layouts at 36, 44 and 56 columns (Ctrl+X → / ←). `gate_scenarios.py`: CT-UI-001 checks the region under each filter, CT-UI-002 in each Layout (now at 60 lines, so five card groups still fit beside the region), CT-SEC-001 presses `p` and accepts only `viewFilter`, `layout` and `preview` in the store; all pass on both versions. `ct_compaction.py` runs at 64 lines for the same reason (passes on both). `toc_verifier.parse_pane` reads the region into `Pane.preview` and keeps it out of the entries and notes.
- Found, not caused here: `position_scenarios.py`'s CT-POS-003 and CT-COEX-001 judge the pause by a footer `⏸ 暂停跟随` that the Pane no longer draws (gone before this branch's base), so both fail on the current host with or without this ticket.
