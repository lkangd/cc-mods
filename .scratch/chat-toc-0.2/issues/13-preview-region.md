# 13: The preview region on the terminal

**What to build:** A region at the bottom of the Pane that shows one Turn group whole without jumping: the meta line (date, time, state, steps, duration, output tokens), the User input as typed, the last text as Markdown, and the files line. It shows the selected group while the Pane holds the keys, else the Current position's; `p` folds it to one line and the choice is kept. This is the tracer for 0.2: it adds the per-group facts that search, reuse and the Desktop tree build on.

Spec: [chat-toc 0.2](../spec.md) §1 (layout, shortage order), §3 (all but "Expanded" and "Text cap"), §4 (all but compaction boundaries and the fork line), §9.

**Blocked by:** none

**Status:** ready-for-agent

- [ ] The groups carry, in memory only: the User input as typed (code blocks and pasted content restored; `/name args`; `!cmd`; `(image only)`; a has-images flag), files changed (`Edit`/`Write` `file_path`, `bashEditDiff.changedFiles`) and read (`Read` only, changed wins), the summed `turn_duration` `durationMs` (absent without a row), and output tokens once per `message.id` (absent without `usage`); the running group's latest text so far
- [ ] An incremental read and a whole regroup give the same facts group by group (unit test)
- [ ] The region sits above the footer, its rule `Preview · p` / `预览 · p`, height 40% of the rows left after the head, search row and footer, held to 4–14 rows; the content cut files line → Agent text → User input, the meta line kept, the last row the Button `↓ N more lines · e: expand` (the press is wired by ticket 15; until then it does nothing visible beyond the line)
- [ ] The meta line's formats in both languages (date always; state only when not finished; duration `45s`/`3m 20s`/`1h 5m`/`<1s`; tokens `3.5k out`, `1.2M`); unreadable fields left out with no placeholder
- [ ] The files line's paths relative to the session's working directory when under it, else absolute with `~`; `+N` and `read N` as in the spec
- [ ] Which group: the selected entry's while the Pane holds the keys, else the Current position's, else the newest; a running group redrawn as rows arrive, staying at its top
- [ ] `p` toggles it, kept in `$.store` (unknown value reads as shown); hidden it is one Button `p: Preview`; at a short height the Minimap goes first, then the preview shrinks to 4 rows, then `p: Preview (no room)`; the list keeps 8 rows
- [ ] The last text in a `Markdown`; checked on 2.1.287, and if that host draws none, plain `Text` there by `$.session.version()`
- [ ] Drawn in all three Layouts at 36, 44 and 56 columns, on 2.1.287 and 2.1.295
- [ ] `CT-PREV-001` added to the PTY drivers and the release gate's MUST list, passing on both versions; `CT-SEC-001`'s `$.store` check includes the preview flag; `CT-UI-001`/`002` cover the region
- [ ] Root README: the controls table (`p`, selection drives the preview), "What it shows" (the preview), data and privacy (`$.store` gains the flag), known limits 1 and 2 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
