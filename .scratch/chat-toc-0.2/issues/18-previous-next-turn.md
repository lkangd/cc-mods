# 18: The previous and next Turn group

**What to build:** `‹ ›` Buttons at the search row's right end, and in the band, which now draws whenever the Pane is not on screen, that step the transcript from the Current position to the previous or next shown Turn group. They carry two borrowed actions so a person can bind keys to them; the README offers `meta+k`/`meta+j` if a bound key's press may scroll the transcript.

Spec: [chat-toc 0.2](../spec.md) §6.

**Blocked by:** 16 (Search on the terminal)

**Status:** ready-for-agent

- [ ] First measure, on 2.1.287 and 2.1.295: whether `$.ui.scroll` moves a transcript row from a press that came by a bound key (`meta+j` to `app:toggleDiffPreSession`), and whether the host redraws the band when the Pane becomes or stops being a back tab. Record both in this ticket; the rest follows the spec's outcome for each
- [ ] `‹` and `›` plain Buttons after the count and `✕`, carrying `app:toggleDiffNoiseFilter` and `app:toggleDiffPreSession` (named constants); no hotkey; `ring.ts` steps over them; not drawn on Desktop
- [ ] A step goes from the Current position over the groups the list shows (View filter, search matches kept), to the side the View filter shows; locks the Current position on the target; nothing at the ends; skips groups without a Jump target; with none left in that direction, the notice on the notes line or as a toast when the Pane is not on screen (unit tests for the walk)
- [ ] The band draws whenever `$.ui.panes()` says the Pane is not shown (closed, undrawn, back tab), with the same `‹ ›`; not while the Pane is on screen
- [ ] `CT-STEP-001` added to the PTY drivers and the release gate's MUST list, passing on both versions, its key part as the measurement allows; `CT-COEX-001` and `CT-UI-003` updated as the spec says
- [ ] Root README: `‹ ›` in the controls table; the binding section with the `keybindings.json` snippet (or, if refused, no keys and the limit saying so); known limit 8 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass
