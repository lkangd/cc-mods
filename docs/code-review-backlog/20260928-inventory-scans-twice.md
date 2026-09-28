---
id: inventory-scans-twice
status: open
severity: nit
found: 2026-09-28
source: /code-review, round 1
target: Issue 30 clear-all (905c774..005dcbe)
---

# clear-inventory scans the project's files twice

## Problem

`clear_inventory` in `mods/prompt-trail/src/prompt_trail_helper.c` computes `present` with
`clear_has_files()` and then walks the archive root and the quarantine directory again to list
the files and quarantined archives it prints.

## Why deferred

Cleanup nit (unverified by policy); the directories hold a handful of entries per project.

## Suggested fix approach

Collect the file and quarantined listings first and derive `present` from whether either is
non-empty (or the intent stands); keep `clear_has_files()` for `clear_all`'s no-op check.

## Recommended tools

`grep -n "clear_has_files\|write_quarantined" mods/prompt-trail/src/prompt_trail_helper.c`;
`python3 -m unittest -k inventory tests.helper_protocol`.
