---
id: release-gate-unit-module-list-duplicated
status: open
severity: minor
found: 2026-09-29
source: /code-review, round 1
target: Issue 31 release evidence gate (5755f1c..19715c2)
---

# The release gate and the startup gate list the unittest modules separately

## Problem

`mods/prompt-trail/release/release_evidence.py:22` holds `UNIT_MODULES = ["artifact_static", "bridge_protocol", "helper_protocol", "project_root", "release_verdict"]`, while `mods/prompt-trail/scripts/verify-startup.sh:44-48` runs the same five modules one `python3 -m unittest -v` line each. A module added to one list and not the other makes the two gates run different suites; the release report would then cite no evidence from the tests only the startup gate runs.

## Why deferred

The cost only arises when a test module is added, and Issue 31's alignment (Q10) kept `verify-startup.sh` as it is. Sharing the list means changing the fast development gate, which is better done alongside the next change that touches both.

## Suggested fix approach

Let `release/unit_runner.py` own the module list (for example a `MODULES` constant used when no names are passed), and have `verify-startup.sh` call `python3 "$ROOT/release/unit_runner.py" >/dev/null` in place of the five lines, making the runner exit non-zero when any test fails. `release_evidence.py` then imports or omits the list.

## Recommended tools

`grep -n "unittest\|UNIT_MODULES" mods/prompt-trail/scripts/verify-startup.sh mods/prompt-trail/release/*.py`. Verify with `scripts/verify-startup.sh` and with the gate section of the release run (`run_gates` in `release/release_evidence.py`); a `--skip-gates` run does not reach the list.
