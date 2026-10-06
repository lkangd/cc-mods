---
id: restart-reconcile-archives-staged-text
status: resolved
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

## Resolved 2026-10-06 (Issue 35 follow-up)

The person chose the prompt-free option. `ReconcileState` now carries `rewritten: true` when
`next(e)` returned a text other than the one staged. In `reconcilePending`, a pending whose final
text is gone (`owed.text === undefined`) and which was rewritten is never confirmed with
`--pending`: a `membership: 'row'` record is no longer confirmed without asking, and no dialog
offers 已进入. The person gets 不归档 / 新根分支 when the prompt may have entered (未进入 / 新根分支
when it cannot have), and the dialog says the final text was lost. Helper protocol 1 and schema 2
are unchanged. A pending found through the archive takes `rewritten` from the record its staging
Run left in the store, when that record names the same event. With no such record it still cannot
tell whether it was rewritten and is settled as before. Plugin tests: `a rewritten prompt keeps its
final text for a reconciliation in the same module instance`, and `after a restart a rewritten
prompt … is not archived from its staged text` for a `row` record, a queued one and idle ones over two rows and over none, and `a pending found in the archive keeps the staging Run's word that it was rewritten`.
