---
id: branch-fold-lookup-linear
status: open
severity: minor
found: 2026-10-07
source: /code-review, round 1
target: Prompt Trail backlog sweep, working tree vs b54339e (branch prompt-trail/backlog-sweep)
---

# `timeline-read` groups a Run's branch folds with a linear key search

## Problem

`mods/prompt-trail/src/prompt_trail_helper.c` `branch_fold_for()` scans every fold found so far
with `strcmp` before adding a new one, and `write_branches()` calls it once per off-path entry of
the Run since its path began. With K distinct folds (independent roots or distinct leave points)
the grouping costs about K²/2 string comparisons, and every window of the same long branch that
the person browses rebuilds it. The read runs under the 10 s `runArchive` timeout of
`timelineRead` in `hooks/register.tsx`.

## Why deferred

Realistic Runs have few branch points, so K stays small; the cost only shows on Runs with
thousands of separate branches. Fixing it means a hash or sorted index in C plus a rebuild of the
helper artifacts, which is more than this review round's fixes warranted.

## Suggested fix approach

Give each fold key an index lookup: most keys name one of the Run's own entries (`at:<entry on
the path>`, `root:<own entry>`), so the fold index can live on that `branch_entry` and be found
through the existing `find_branch()` binary search; only keys naming nodes outside the Run's own
entries need a fallback (a small hash or a sorted array). Done when a fixture with ~10,000
independent roots in one Run reads within budget in `scripts/benchmark-timeline.sh`.

## Recommended tools

- `grep -n 'branch_fold_for\|write_branches\|find_branch' mods/prompt-trail/src/prompt_trail_helper.c`
- `bash mods/prompt-trail/scripts/benchmark-timeline.sh <count>` and `tests/timeline_fixture.py` for a many-roots fixture
- `python3 -m unittest tests.helper_protocol` from `mods/prompt-trail`, then `scripts/build-artifacts.sh`
