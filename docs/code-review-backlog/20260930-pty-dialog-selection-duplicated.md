---
id: pty-dialog-selection-duplicated
status: open
severity: minor
found: 2026-09-30
source: /code-review, round 1
target: working tree after 1b445dc — Issue 40 PTY scenarios with Issues 46–48
---

# Two copies of the PTY dialog option-selection loop

## Problem

`mods/prompt-trail/release/pty_scenarios.py`: `answer_freely()` (Issue 40) repeats the loop of `Context.choose()`:
the one-second wait, up to ten scans of the rows for a `^\s*(❯)?\s*\d+\. <option>$` line, and a Down key until the
selection marker stands on it. Only the action after selection differs (`choose` presses Enter until the dialog is
gone; `answer_freely` types the phrase into the `Type something.` item, then Enter). Timing-sensitive host dialog
handling now lives in two places that can drift when the host changes how it draws or accepts choices.

## Why deferred

`Context.choose()` is used by almost every PTY scenario (36–40); reshaping it risks every scenario for a
duplication of about ten lines, and the review round was about Issue 40's behaviour.

## Suggested fix approach

Extract `Context.select(terminal, option)` that moves the selection onto the numbered option and returns once it
is there (raising `ScenarioFailure` otherwise). `choose()` becomes select + Enter until gone; `answer_freely()`
becomes `select(terminal, "Type something.")` + type + Enter. Done when both use it and a PTY run of CONTROL-002,
DELETE-001..003 and SEC-001 passes on both versions.

## Recommended tools

`grep -n "def choose\|def answer_freely\|Type something" mods/prompt-trail/release/pty_scenarios.py`; run with the
scratch `run45.py <version> <IDs>` recipe from the Issue 38 handoff.
