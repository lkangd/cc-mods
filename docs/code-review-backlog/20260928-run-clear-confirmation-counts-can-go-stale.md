---
id: run-clear-confirmation-counts-can-go-stale
status: open
severity: minor
found: 2026-09-28
source: /code-review, round 1
target: Issue 29 clear-run (b95dbaf...e9ff6b9)
---

# A Run clear's confirmation can understate the parent links it will cut

## Problem

`/prompt-history clear-run` reads `clear-inventory <run>` and shows the counts, including how many
of other Runs' entries have this Run's entries as parent (`unlinked`), then calls `clear-run`
after the person confirms (`clearRunCommand` in `mods/prompt-trail/hooks/register.tsx`). The
helper (`clear_run` in `mods/prompt-trail/src/prompt_trail_helper.c`) recounts under the
exclusive lock and nulls every such link at the cut, without comparing against what was shown.
If another Run forks from this Run's entries and submits while the dialog is up, that new link is
cut without having been shown before the confirmation. The success reply does report the
helper's actual `unlinked` count.

## Why deferred

The window is a live dialog in one Run while another Run forks from it and submits; the entries'
text is never changed, and the reply states the real number. Closing it needs the confirmed
counts passed through the helper protocol and a re-confirmation path, which is larger than the
review round warranted.

## Suggested fix approach

Pass the confirmed `entries/pending/events/unlinked` to `clear-run` (argv), compare them under
the exclusive lock before placing `.clearing-run`, and refuse with a new category (e.g.
`clear-run-changed`) when any differs; the plugin then re-reads the inventory and asks again.

## Recommended tools

`grep -n "clear_run_counts\|CLEAR_RUN_CHILDREN" mods/prompt-trail/src/prompt_trail_helper.c`;
`grep -n "askClearRun\|clearRunCommand" mods/prompt-trail/hooks/register.tsx`; helper tests
`python3 -m unittest -k run_clear tests.helper_protocol`, plugin tests in
`tests/clear_run.test.tsx`.
