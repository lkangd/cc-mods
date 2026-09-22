---
id: run-mode-durability-without-store
status: open
severity: major
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 14 Run collection mode
---

# An explicit disable can be undone by a reload when `$.store` cannot be written

## Problem

`mods/prompt-trail/hooks/register.tsx` `saveRunMode()` caches the new value in the module-level
`runMode` and then awaits `$.store.set(key, value)`. `disableCollection()` catches a failing
write, keeps only the in-memory value, and tells the person that a reload may revert the switch.

After a module reload the in-memory cache is gone. `loadRunMode()` finds no record under
`prompt-trail:run-mode:<projectId>:<runId>` and resolves the documented default, `enabled`, so a
Run the person explicitly disabled resumes archiving prompt text. A successfully written
`collection-stopped` boundary can remain in the archive while collection silently continues past
it — the timeline then shows a stop that did not hold.

Reading failures were fixed in this round (`loadRunMode()` now propagates them and callers fail
closed). This entry is only about a *successful* read finding a record that was never written.

## Why deferred

The only durable store the plugin has for this state is `$.store`; when it fails there is
nowhere else to record the switch. The real fix is to recover the Run's collection state from
the archive's own Collection Boundaries, which needs a helper read operation that does not exist
yet — a new subcommand, a protocol addition and its black-box tests. That is a larger surface
than Issue 14's ticket asks for, and it overlaps
`.scratch/prompt-trail/issues/21-browse-long-timeline.md` (see
`20260922-bounded-persisted-timeline-view.md`, which needs the same read path).

## Suggested fix approach

1. Add a bounded, schema-opaque read to `mods/prompt-trail/src/prompt_trail_helper.c` — the spec
   already promises "有界范围读取" and "状态统计" (`spec.md` §10). Minimum for this entry: the
   latest `timeline_events` row for a given `run_id`.
2. In `loadRunMode()`, when `$.store` holds no record for a Run, ask the archive for that Run's
   latest Collection Boundary before falling back to the default. A trailing
   `collection-stopped` means the Run is disabled.
3. Keep `$.store` as the fast path; the archive read is the authority only when the store is
   silent.

"Done" is a test where `$.store.set` fails during disable, the module state is dropped, and the
next `loadRunMode()` still resolves `disabled` from the archive.

## Recommended tools

- `grep -n 'saveRunMode\|loadRunMode\|storeSetFails' mods/prompt-trail/hooks/register.tsx mods/prompt-trail/tests/support.tsx`
- `mods/prompt-trail/tests/support.tsx` already has a `storeSetFails` switch to build on.
- `mods/prompt-trail/tests/helper_protocol.py` is where a new helper subcommand gets its
  black-box tests; `python3 -m unittest tests.helper_protocol` from `mods/prompt-trail`.
