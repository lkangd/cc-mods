---
id: locator-directory-failure-scope
status: open
severity: minor
found: 2026-09-27
source: /code-review, round 1
target: Issue 24 of Prompt Trail (commits 766bcf6..f1c50f5), project isolation and concurrent Runs
---

# An unreadable shared locator directory marks each project's archive unavailable

## Problem

Since Issue 24, `capture-list` (`live_runs_elsewhere` in
`mods/prompt-trail/src/prompt_trail_helper.c`) opens the per-user locator directory
`~/.claude/plugins/data/.function-hook-locators/prompt-trail` to find Runs held by live
processes. Any `opendir` failure other than `ENOENT` ends with `archive_error("locator-directory")`.
The plugin's pending discovery then fails, and the submission path calls
`markArchiveUnavailable($, currentProject)` (`mods/prompt-trail/hooks/register.tsx`, the
`settlePending` catch in the `prompt.submit` hook). That persists `archive-state: unavailable`
for whichever project is running, although its archive is healthy. The failure is in shared,
per-user infrastructure, not in the project.

## Why deferred

Failing closed here matches the bridge, whose `run_held_elsewhere` also fails on the same
directory. The locator directory is not a project's to isolate. What is missing is Issue 25's
work: classifying failures as Run-local or shared-archive, and recovering from Archive
unavailable. At the moment `archive-state` is never cleared.

## Suggested fix approach

Under Issue 25, give helper failures a scope. A `locator-*` category from `capture-list`
should block the current Run with an accurate, retryable state, and should not be written as
the project's `archive-state`. Done looks like this: after the directory's permissions are
restored, the next submission lists again and proceeds, and no project is left marked
unavailable.

## Recommended tools

`grep -n "locator-directory" mods/prompt-trail/src/*.c`. Reproduce with a helper black-box
test in `tests/helper_protocol.py` that `chmod 000`s the locator directory and runs
`capture-list`, then a plugin test with `listFails` returning that category.
