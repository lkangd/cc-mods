# Measure how the Pane redraws with the Current position

Type: task
Status: resolved
Blocked by: 

## Question

A render hook at a transcript site is refused when it writes `$.state` (see "Measure how requestId maps to transcript rows"). So when the transcript scrolls and the Current position changes, how does the docked Pane redraw? Measure on 2.1.287 and on the local version: is calling `$.ui.invalidate('ui.render')` in a transcript site's render hook (or after the hook returns) allowed, and does it loop on itself; it reruns every transcript row this plugin hooks, so what are the frame rate and the stutter during continuous scrolling in a session of a few hundred turns (within the cap of 30 times a second); is there a narrower way, such as invalidating only when the Current position really changes, with the Pane reading a module variable itself. Produce a workable way to redraw and the measured numbers; if none is workable, drop the highlight as "Decide whether to highlight the current position" provides as a fallback.

## Answer

**Verdict: drive the Pane's redraw with `$.state`.** The render hook at a transcript site works out the Current position; only when it really changes, `$.clock.after(0, …)` writes the new value into an atom. The Pane's render hook reads that atom, so only the Pane redraws and the transcript rows do not rerun with it. In 6 runs on 2.1.287 and 2.1.295 (3 on each version) there was no error. The median delay is 6–7 ms and p95 is 51–58 ms. During continuous scrolling the transcript hook runs as many times as in the no-redraw baseline. The highlight stays; there is no need to fall back and drop it.

### How it was measured

- Local 2.1.295, plus 2.1.287 installed by npm into a session temp directory. Fullscreen layout, a 170×44 pseudo-terminal, screen read with pyte, driven by SGR wheel events; all local plugins turned off.
- A synthetic 300-turn transcript was made and `--resume`d: per turn 1 prompt, 1 Bash call and a 5-line reply, 1200 rows and 1.08 MB in all. No model call at all. It was regenerated before every run so rows from `/rpd` would not mix in.
- The probe mod hooks `UserMessage` and `AssistantMessage` and takes "the smallest turn number among the on-screen rows", from the `T###` in the text, as the Current position. The docked Pane draws 300 Buttons and switches its redraw way by `RP_MODE`. Each run: idle for 5 seconds, then 80 notches of wheel up (40 notches/second), 80 notches down, and last 150 notches up (about 250 notches/second); it records the process tree's CPU seconds, how long the screen took to settle, and the top row on screen against the value the Pane shows. The hook side records the delay from each Current position change to the Pane drawing that value.
- Attachments: [the probe mod and scripts](../assets/10-redraw/), [the summary table](../assets/10-redraw/summary.txt), [the per-run results](../assets/10-redraw/results.jsonl), [the per-run logs](../assets/10-redraw/logs/).

### Each way as measured (medians; off, sync, micro-state, after-state, poll-state and loop ran 3 times per version, the others once, on 2.1.287 only)

| Way | Allowed | CPU seconds for 80 notches up (287 / 295) | Transcript hook runs | Pane delay median / p95 |
|---|---|---|---|---|
| off: no redraw (baseline) | — | 1.30 / 1.39 | ~1750 | Pane stays on the old value |
| sync: `$.ui.invalidate('ui.render')` in the render hook, only when the value changed | Allowed, no error, no self-loop | 2.70 / 2.85 | ~3500 (doubled) | 6 / 26–35 ms |
| micro: same, inside `Promise.then` | Allowed | 2.51 | ~2960 | 6.5 / 107 ms |
| after-inv: same, inside `$.clock.after(0)` | Allowed | 2.74 | ~3640 | 7 / 97 ms |
| poll-inv: `$.clock.every(50)` polls a module variable and invalidates on a change | Allowed | 2.79 | ~3700 | 14 / 49 ms |
| micro-state: write `$.state` inside `Promise.then` | **Refused now and then**: 3–12 times per run, `state.set: denied: … while ui.render is being dispatched` | 2.39 / 2.43 | ~1780 | 6 / 47–50 ms |
| **after-state: write `$.state` inside `$.clock.after(0)`** | **Allowed, 0 errors** | **2.42 / 2.26** | **~1590** (no increase) | **6–7 / 51–58 ms** |
| poll-state: `$.clock.every(50)` polls and writes `$.state` on a change | Allowed, 0 errors | 2.08 / 2.35 | ~1670 (no increase) | 22–23 / 60–88 ms |
| loop: invalidate every time in the render hook | Allowed, but **loops on itself** | 11.9 / 11.8 | ~29 000 | The screen never settles |

- In all 37 non-baseline runs, the value the Pane showed at the end equalled the last Current position. Values in the middle of a scroll are merged and skipped (3–13 per run); the host declares at most 10 invalidates a second, at most 30 for docked Panes and bands, and faster calls are merged. The Pane value read off the screen and the top row either agree or differ by 1: the row that differs sits under the host's pinned prompt bar and the algorithm counts it; grouping still follows the rule in "Decide whether to highlight the current position".
- In all three kinds of scrolling, every way except loop had a screen that settled within 0.12 seconds of the last wheel event, and at both 40 and 250 notches/second nothing looked behind. That only shows the terminal output does not pile up; **the frame rate the eye sees was not measured**.
- Idle cost: the baseline and after-state are 0.25–0.30 CPU seconds per 5 seconds (not 0: the baseline itself has that much); the poll ways are 0.33–0.39 CPU seconds per 5 seconds, about 2% of one core above the baseline; loop is 2.4 CPU seconds, close to half a core, and never stops.
- The CPU the two state ways spend above the baseline (about 1 more second for 80 notches up) comes from the Pane redrawing itself: about 100 times, each drawing 300 Buttons, an estimated 10 ms each. This cost is left to "Measure the cost of reading and drawing a long session": the Pane draws only the visible window, or the redraw rate is capped.

### Points for the implementation

- How to write it: in the transcript render hook, compare the new and old values first and call `$.clock.after(0, () => update($, atom, () => cp))` only on a change, then `return next(e)` as usual. The Pane subscribes to the atom with `read($, atom)`. Do not write in the render hook directly, and do not write through `Promise.then`: it is refused now and then, and on a refused write the Pane stays on the old value until the next change.
- Never call invalidate unconditionally: the host does not stop that loop, and it keeps about half a core busy.
- The atom is only this process's derived value; after a hot reload it is worked out again as the transcript rows redraw, so it does not need to persist.
- The docked Pane on 2.1.287 has no title row, so row 0 is the body; on 2.1.295 row 0 is the title row. The prototype layout has to be checked on both versions.
- Test leftovers: the synthetic transcripts were written to `~/.claude/projects/-private-tmp-…-scratchpad-proj/` and deleted after the test.
