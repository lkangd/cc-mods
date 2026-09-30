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

## Suggested fix approach

Keep the damage fact where writes are already serialized: have the helper record damage beside
the archive (for example a marker per generation, written under the SQLite write lock when it
meets `archive-integrity`) and refuse every write to a generation carrying it, until a recheck
that passes, a quarantine or a clear removes it. The `$.store` record then only mirrors it for
display. A cheaper, partial step is to reread the record right before the submit-time check,
which narrows but does not close the second window.

Done: a helper unit test in which one connection records damage while another is between its
check and its write shows the write refused; the plugin test
`a write that succeeds past the damage does not lift it for the other Runs` still passes.

## Recommended tools

`grep -n "archiveRecovered\|readArchiveState\|DAMAGE_FAILURES.has(archiveFailure" mods/prompt-trail/hooks/register.tsx`;
`tests/quarantine_archive.test.tsx` for the plugin side; `python3 -m unittest tests.helper_protocol`
for the helper.
