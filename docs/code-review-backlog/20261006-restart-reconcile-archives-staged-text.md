---
id: restart-reconcile-archives-staged-text
status: open
severity: major
found: 2026-10-06
source: /code-review, round 1
target: Issue 35 working-tree changes under mods/prompt-trail (queued submissions reconciled explicitly)
---

# A pending settled as 已进入 after a restart archives the staged text, not the final text

## Problem

`submitCollected` stages a capture with `e.text` (`capture-begin --stdin`) before `next(e)`. Downstream hooks may rewrite the prompt inside `next(e)`. The final text is kept only in memory, as `reconcile.text` (`saveReconcile` persists `ReconcileState`, which has no text). After a reload or restart, `prepareProject` rebuilds `reconcile` from the store without text. `confirmCapture(..., undefined)` then runs `capture-confirm --pending` (`hooks/register.tsx`, the comment above `confirmCapture`), and that archives the bytes staged before the rewrite. The spec says an Entry's text is the final text.

This is not new. Every restart-discovered pending already behaved this way. What Issue 35 changes is how often it happens: every queued submission now waits for explicit reconciliation, so the window "rewritten, queued, restarted before it was settled, then settled as 已进入" is wider.

## Why deferred

Recording the final text durably needs either a helper protocol change (re-stage the final text after `next(e)`) or a new prompt-free persistence rule. The Issue 35 plan explicitly keeps helper protocol 1, schema 2 and the "final text from submit" source. Deciding between "re-stage via helper" and "do not offer 已进入 when the final text is gone and the text was rewritten" is a product decision.

## Suggested fix approach

The smallest prompt-free option: persist `rewritten: true` in `ReconcileState` when `finalText !== e.text`. In `reconcilePending`, when `owed.text === undefined && owed.state.rewritten`, do not confirm with `--pending`: withhold 已进入 and say that the final text is no longer available. Handle `membership: 'row'` the same way. The fuller option is a helper `capture-restage` that replaces a pending's text under protocol 2.

## Recommended tools

- `grep -n "'--pending'\|saveReconcile(\|confirmPending" mods/prompt-trail/hooks/register.tsx`
- Test with the harness option `rewrite: true` plus a pre-seeded v2 record, as in `tests/queued_capture.test.tsx` "after a restart …".
