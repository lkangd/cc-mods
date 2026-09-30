---
id: pty-command-reply-polling-duplicated
status: open
severity: minor
found: 2026-09-30
source: /code-review, round 1
target: working tree after 1b445dc — Issue 40 PTY scenarios with Issues 46–48
---

# Two copies of the PTY command-reply polling

## Problem

`mods/prompt-trail/release/pty_scenarios.py`: `replied()` (Issue 40) finds the last `❯ <command>` echo, takes the rows
after it, waits until they hold the expected text and snaps the terminal — the same steps as the `answered` closure in
`Context.command()`, except that `replied()` flattens wrapped lines (`flat()`) and does not send the command itself.
The two can diverge on host output changes (raw versus flattened matching).

## Why deferred

`Context.command()` returns raw text that many scenarios in 36–38 parse line by line; switching it to the flattened
form, or re-plumbing it, reaches well beyond Issue 40.

## Suggested fix approach

Extract `Context.reply(terminal, command, expect, timeout, flatten=False)` holding the echo search, the wait and the
snap; `command()` sends and then calls it raw, `replied()` becomes `reply(..., flatten=True)`. Done when both paths use
it and a full PTY run of the scenarios that call either passes on both versions.

## Recommended tools

`grep -n "ctx.command(\|replied(" mods/prompt-trail/release/pty_scenarios.py` to find the callers.
