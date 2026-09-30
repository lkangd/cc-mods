---
id: pty-mode-watcher-walks-twice
status: open
severity: nit
found: 2026-09-30
source: /code-review, round 1
target: working tree after 1b445dc — Issue 40 PTY scenarios with Issues 46–48
---

# The PTY mode watcher walks the data tree twice per sample

## Problem

`mods/prompt-trail/release/pty_driver.py` `Environment.watch_modes()`: every 50 ms it calls `private_modes()`, which
walks `plugins/data/prompt-trail-inline` and the locator directory, then walks `prompt-trail-inline` again with
`rglob("*")` to collect the names seen (used to report whether the migration backup was sampled).

## Why deferred

A test-harness cost only, in one scenario (PT-SEC-003) whose run time is dominated by the host; not worth reshaping
the sampler inside the review round.

## Suggested fix approach

Let one walk yield `(path, mode)` pairs; `private_modes()` filters them for wrong modes and the sampler also records
the names from the same pass. Done when PT-SEC-003 still passes on both versions with the same result text.

## Recommended tools

`grep -n "def private_modes\|def watch_modes\|names_seen" mods/prompt-trail/release/*.py`.
