---
id: timeline-read-per-batch-cost
status: open
severity: minor
found: 2026-09-24
source: /code-review, round 1 (cleanup findings #2, #3)
target: Prompt Trail Issue 21, commits 1396e5f..95cab6a
---

# `timeline-read` repeats archive-wide work on every batch

## Problem

Two parts of each `timeline-read` in `mods/prompt-trail/src/prompt_trail_helper.c` cost more
than the fixed batch:

- **path**: with a tip, a recursive CTE walks the tip's whole ancestor chain on every read, only to
  intersect it with the batch and find the Run's first sequence on it. Each load while browsing
  walks the same chain again. On a single 100,000-deep lineage a read costs about 180 ms, mostly
  here.
- **origins**: when the batch holds a `run-started`, the query that finds each segment's first
  holder unions `prompt_entries` and `timeline_events` filtered by `segment_id`. Neither table has
  an index on `segment_id` (only `(run_id, sequence)`), so both are scanned in full.

## Why deferred

Issue 21's budget holds: on 100,000 mixed events the p95 of loading an earlier batch is 260 ms,
under the 1-second target. Indexing `segment_id` is a schema change, which needs the safe
migration path of Issue 27; caching the path across reads needs a place to keep it.

## Suggested fix approach

- origins: add an index on `segment_id` (or `(segment_id, sequence)`) to both tables in a schema
  migration, or record each segment's first holder when its first event is written.
- path: answer the path only for the batch's range, from a memo the helper keeps per tip (or
  materialise ancestor depth when an entry is written), instead of walking from the tip.

Done when a fixture with one 100,000-deep lineage and many Run starts reads each batch in time
that does not grow with the archive.

## Recommended tools

- `scripts/benchmark-timeline.sh` (not in the default gate) prints the three p95 values.
- `tests/timeline_fixture.py` builds large archives in one transaction.
