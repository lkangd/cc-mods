---
id: composer-row-counted-before-storage
status: open
severity: minor
found: 2026-10-06
source: /code-review, round 1
target: Issue 35 working-tree changes under mods/prompt-trail (queued submissions reconciled explicitly)
---

# Composer rows are counted before the host has kept them

## Problem

The `session.append` hook (`mods/prompt-trail/hooks/register.tsx`, `on('session.append', { door: 'prompt' }, …)`) calls `noteComposerRow($)` before `next(e)`. If keeping the row then fails (the host's transcript write rejects), the row has already been counted, in two possible ways:

- inside a submission window, where it can let that submission confirm as a Prompt Entry;
- for an `unproven` pending's `rowsSince`, where it makes the dialog offer 已进入.

The approved plan said to count only after `next(e)` resolves.

## Why deferred

The 2.1.290 test kit has no bottom implementation for `session.append`, and a test hook may not answer it, so every append in the tests ends in the kit's own rejection. Counting after success, or reverting on failure, would turn every harness row into "not stored". That would break the whole suite, and the success path could no longer be tested. The host declares that `next(e)` "resolves once the row is kept" and that composer rows cannot be refused by hooks, so the gap is limited to a host storage failure.

## Suggested fix approach

Once a kit implements `session.append` (or lets a test hook answer it), move counting after `await next(e)`. On rejection, mark every open window `shared` and set `rowsSince` to `'unknown'`, then add a test with a rejecting append. Until then, keep the comment on the hook explaining why it counts first.

## Recommended tools

- `grep -n "no implementation for session.append" mods/prompt-trail/tests/support.tsx`
- After each host upgrade, recheck the kit: `CLAUDE_CONFIG_DIR=$(mktemp -d) npx -y @anthropic-ai/claude-code@<v> plugin test mods/prompt-trail`
