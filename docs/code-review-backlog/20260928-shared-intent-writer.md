---
id: shared-intent-writer
status: open
severity: minor
found: 2026-09-28
source: /code-review, round 1
target: Issue 30 clear-all (905c774..005dcbe)
---

# The clear and quarantine intents are written by two copies of the same steps

## Problem

`clear_all` in `mods/prompt-trail/src/prompt_trail_helper.c` writes `<projectId>.clearing` by
creating a `.partial`, writing, `F_FULLFSYNC`/`fsync`, `rename` and syncing the directory;
`quarantine` inlines the same sequence for `<projectId>.quarantine`. A change to how intents are
made durable has to be made twice.

## Why deferred

Cleanup finding (unverified by policy); touching the quarantine path is outside what the review
round needed, and both copies are covered by crash-state tests.

## Suggested fix approach

Extract `static bool publish_intent(const char *staged, const char *intent, const char *content)`
answering whether the intent is in place, and let each caller keep its own failure category (the
clear must still report `clear-unfinished` once the rename succeeded).

## Recommended tools

`grep -n "staged_intent\|\.clearing\|F_FULLFSYNC" mods/prompt-trail/src/prompt_trail_helper.c`;
`python3 -m unittest -k quarantine -k clear tests.helper_protocol` from `mods/prompt-trail`.
