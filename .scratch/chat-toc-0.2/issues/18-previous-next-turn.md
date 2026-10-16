# 18: The previous and next Turn group

**What to build:** `‹ ›` Buttons at the search row's right end, and in the band, which now draws whenever the Pane is not on screen, that step the transcript from the Current position to the previous or next shown Turn group. They carry two borrowed actions so a person can bind keys to them; the README offers `meta+k`/`meta+j` if a bound key's press may scroll the transcript.

Spec: [chat-toc 0.2](../spec.md) §6.

**Blocked by:** 16 (Search on the terminal)

**Status:** ready-for-agent

- [x] First measure, on 2.1.287 and 2.1.295: whether `$.ui.scroll` moves a transcript row from a press that came by a bound key (`meta+j` to `app:toggleDiffPreSession`), and whether the host redraws the band when the Pane becomes or stops being a back tab. Record both in this ticket; the rest follows the spec's outcome for each
- [ ] `‹` and `›` plain Buttons after the count and `✕`, carrying `app:toggleDiffNoiseFilter` and `app:toggleDiffPreSession` (named constants); no hotkey; `ring.ts` steps over them; not drawn on Desktop
- [ ] A step goes from the Current position over the groups the list shows (View filter, search matches kept), to the side the View filter shows; locks the Current position on the target; nothing at the ends; skips groups without a Jump target; with none left in that direction, the notice on the notes line or as a toast when the Pane is not on screen (unit tests for the walk)
- [ ] The band draws whenever `$.ui.panes()` says the Pane is not shown (closed, undrawn, back tab), with the same `‹ ›`; not while the Pane is on screen
- [ ] `CT-STEP-001` added to the PTY drivers and the release gate's MUST list, passing on both versions, its key part as the measurement allows; `CT-COEX-001` and `CT-UI-003` updated as the spec says
- [ ] Root README: `‹ ›` in the controls table; the binding section with the `keybindings.json` snippet (or, if refused, no keys and the limit saying so); known limit 8 of the spec
- [ ] `claude plugin test`, `tsc` and `claude plugin validate` pass

## Measurement (2026-10-16)

Measured on the terminal with 2.1.287 and 2.1.295 (isolated worlds, not logged in, a 30-turn fixture resumed, 170×44), with the probe mod [`step-probe`](../assets/18-step-probe/step-probe/) and its PTY driver [`drive.py`](../assets/18-step-probe/drive.py); per host `steps.json`, the probe's log and the debug log's scroll lines under [`runs/`](../assets/18-step-probe/runs/). The world binds `meta+k` → `app:toggleDiffNoiseFilter`, `meta+j` → `app:toggleDiffPreSession` and `ctrl+x .` → `pane:next`. The two hosts behave identically.

- **The scroll from a bound key is allowed.** A press by `meta+j` or `meta+k` on an action Button whose `onPress` returns the promise of `$.ui.scroll({ to: { requestId }, block: 'start' })` answers `{}` and the debug log says `ui.scroll step-probe to <uuid>: revealed`; the transcript shows the target row. Alike from the Pane's Buttons (the Pane open, the keyboard in the composer), from the band's while the Pane is a back tab, and from the band's while the Pane is closed. So the README documents the binding (spec §6, first outcome).
- **The host does not redraw the band at a pure tab switch.** With the probe's Pane and a second pane open, `ctrl+x .` (the engine's `pane:next`) brings either to the front with no `AbovePrompt` render at all: the band drawn while the probe's Pane was a back tab stays drawn after the Pane comes to the front, and a band not drawn stays undrawn when the Pane goes behind. Opening or closing a pane (a command) does redraw the band, and the band's `$.ui.panes()` then reads the new `isShown`. So the README says the keys may not answer while the Pane is a back tab (spec §6, second outcome). chat-toc's own Pane drawing, when it comes to the front, asks for a redraw so the band goes; nothing tells it when it goes behind, until the next redraw (a new row in the transcript, a measure, another pane opened or closed).
