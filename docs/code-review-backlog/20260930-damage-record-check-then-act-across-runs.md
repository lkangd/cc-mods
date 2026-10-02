---
id: damage-record-check-then-act-across-runs
status: open
severity: major
found: 2026-09-30
source: /code-review, round 1
target: Issues 39, 49–52 of Prompt Trail, 4b8cba4..b35695b
---

# A damage record another Run writes can be missed or deleted in a narrow window

## Problem

The shared damage record (`archiveStateKey`, `$.store`) is read and acted on in separate awaited
steps, and another Run can write it in between. Two places in `mods/prompt-trail/hooks/register.tsx`:

- `archiveRecovered()` (around line 1903): after an ordinary successful write it reads the record
  and returns if it names damage, otherwise it deletes the key. If Run B records `archive-integrity`
  after Run A's read and before A's delete, A deletes B's report. Issue 51 says an ordinary write
  never lifts damage.
- The submit path (around line 5245): the damage check uses `archiveFailure`, which
  `prepareProject()` → `readArchiveState()` (around line 1731) filled a few store calls earlier
  (consent, `settleInflight`, `writeMarker`). Damage recorded in that window is not seen, and this
  submission goes on to `settlePending`, `drainLifecycle` and `capture-begin` in the damaged
  generation. Issue 51 wants damage on record to stop a submission before those writes.

B keeps its own in-memory block, and a later write by any Run that touches the damaged page meets
the damage again and records it. What is lost is that other Runs stop before writing, until then.

## Why deferred

Not introduced by this change: before Issue 51 every successful write deleted the record
unconditionally, so the window was wider. It cannot be closed with the host's store: `$.store`
has only `get`/`set`/`delete`/`keys`, with no conditional write (only `$.state.set` has
`ifVersion`, and `$.state` is per session, not shared between Runs). Closing it needs a design
decision about where the damage record lives. The person chose on 2026-09-30 to keep it here
rather than open an issue, and to go on with Issue 41.

On 2026-10-01 the person chose to reopen this work as
[Issue 53](../../.scratch/prompt-trail/issues/53-serialize-damage-state-across-runs.md).
Its implementation plan was subsequently approved, with helper-owned generation/state/token
health receipts and all concurrent writers required to upgrade first (schema 2 / protocol 1
unchanged). The initial implementation passed the unified non-model startup gate on
2026-10-01. A single-pass review then identified recovery and health-publication gaps;
Issue 53 and this backlog were reopened on 2026-10-02 while those fixes are verified.
Helper mutation guards and token-bound recovery have targeted coverage. Interrupted health
publication now keeps a durable gate across rename and directory sync; a temporary-child
filesystem adapter reproduced the previous failed-reset/healthy-query path, then passed after
the fix. A 165-test ordinary-file subset passed; later stage-trust and query-interleaving
additions have targeted passes. Both fixed host versions passed 475 plugin tests and validation;
TypeScript 5.9.3 passed. The single authorized startup verification exited 0, including all
177 helper tests and 74 other Python tests, artifact consistency and protocol probes.
Real PTY/model acceptance, deployment and release were not performed.
Real-host fault injection is still not authorized; the issue records the separate, bounded
TemporaryDirectory-only helper/startup test approval.

On 2026-10-02 all 13 single-pass review findings were checked against the current code and
fixed (10 CONFIRMED, 3 cleanup PLAUSIBLE; the latter had no independent verifier and were
checked by the main session). The final ordinary-file helper subset passed 173/173 after AST
screening 249 methods and their self-fixture closure; 11 of the full suite's 184 tests were
excluded because they reach hdiutil/chflags. Both fixed hosts passed 480/480 plugin tests and
validation; TypeScript 5.9.3, the other 74 Python tests, artifact rebuild SHA/type/mode equality,
and protocol probes passed. The PTY inventory was corrected but only syntax-checked.
Full diagnostics now publish real damage after closing the reader and rechecking the generation;
ordinary failure categories do not publish damage, and healthy diagnostics do not authorize
recovery. Init rechecks even an existing receipt without lifting recorded damage. Post-cut
clear-run integrity failures publish damage before reporting the unfinished clear.
The existing busy diagnostic regression was already GREEN before the final classification
cleanup; no new busy RED is claimed. Details and every finding's disposition are in Issue 53.
This backlog remains open, and Issue 53 claimed, pending a newly authorized post-fix full
helper/startup system-test gate. The one-shot system-operation budgets are already used; the
2026-10-01 startup PASS is not evidence for the reviewed-and-fixed version. No real PTY/model
acceptance, deployment, version upgrade, stage, commit or push was performed.

## Suggested fix approach

Keep the damage fact where writes are already serialized: have the helper record damage beside
the archive (for example a marker per generation, written under the SQLite write lock when it
meets `archive-integrity`) and refuse every write to a generation carrying it, until a recheck
that passes, a quarantine or a clear removes it. The `$.store` record then only mirrors it for
display. A cheaper, partial step is to reread the record right before the submit-time check,
which narrows but does not close the second window.

Targeted evidence: helper CLI tests show a mutation refused after another caller persists
damage. The plugin retains separate late-helper-damage and mirror-delete-race blocking tests.
The earlier `a write that succeeds past the damage does not lift it for the other Runs` test
only constructed a store mirror while helper health was healthy; it was renamed and made
explicit as `ordinary success retires a stale damage mirror when helper health is healthy`.
It is not evidence that an actual helper damage receipt can be cleared by ordinary success.

## Recommended tools

`grep -n "archiveRecovered\|readArchiveState\|DAMAGE_FAILURES.has(archiveFailure" mods/prompt-trail/hooks/register.tsx`;
`tests/quarantine_archive.test.tsx` for the plugin side; `python3 -m unittest tests.helper_protocol`
for the helper.
