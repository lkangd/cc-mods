---
id: release-gate-artifact-list-duplicated
status: open
severity: minor
found: 2026-09-29
source: /code-review, round 1
target: Issue 31 release evidence gate (5755f1c..19715c2)
---

# The release gate and the startup gate list the rebuilt artifacts separately

## Problem

`mods/prompt-trail/release/release_evidence.py:26` holds `ARTIFACTS` (helper, bridge, `artifacts/helper-manifest.json`, `hooks/artifact.ts`, `src/prompt_trail_generated_artifact.h`); `mods/prompt-trail/scripts/verify-startup.sh:17-27` hashes the same five files in `artifact_state()`. An artifact added to `scripts/build-artifacts.sh` and only one list leaves the other gate blind to it being stale.

## Why deferred

No artifact is being added now, and the fix touches the startup gate that Issue 31's alignment (Q10) left unchanged.

## Suggested fix approach

Have `scripts/build-artifacts.sh` (the one place that knows what it writes) print or record its outputs, e.g. a small `scripts/artifact-paths.txt` read by both gates, or let `release_evidence.py` read the paths named in `artifacts/helper-manifest.json` plus the two generated sources. Done when both gates derive the list from one source.

## Recommended tools

`grep -n "prompt_trail_generated_artifact\|helper-manifest" mods/prompt-trail/scripts/*.sh mods/prompt-trail/release/*.py`; verify with `scripts/verify-startup.sh` and the gate section of the release run.
