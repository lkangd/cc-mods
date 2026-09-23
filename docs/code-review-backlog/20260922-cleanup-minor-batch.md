---
id: cleanup-minor-batch
status: open
severity: minor
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail uncommitted working tree, Issue 14 Run collection mode; Issue 16 Clear Boundary
---

# Small cleanups deferred from the Issue 14 and Issue 16 reviews

Batched because each is real but none is worth interrupting Issue 14 for. All three are
`PLAUSIBLE`, reviewer-only cost claims (the cleanup angle skips verification by policy), so
confirm the cost before acting.

## Problem

1. **Duplicated archive sequence-response validation** —
   `mods/prompt-trail/hooks/register.tsx` `parseConfirmedResponse()` and
   `parseBoundaryResponse()` both parse JSON, check `eventId` and `projectId`, and validate a
   `sequence` that must be a safe integer `>= 1`. They differ only in `parseBoundaryResponse()`
   also checking `kind`.
2. **Duplicated capture-identity validation in the helper** —
   `mods/prompt-trail/src/prompt_trail_helper.c` `capture_begin()` and `boundary_append()` run
   nearly the same `pt_is_safe_identifier()` block over `run_id`, `segment_id`, `branch_id` and
   `event_id`, differing only in their error category (`capture-input` vs `boundary-input`) and
   in `capture_begin()`'s extra parent/attachment checks.
3. **Repeated identity fixture in the helper tests** —
   `mods/prompt-trail/tests/helper_protocol.py` builds the same
   `{"project_id": ..., "run_id": str(uuid.uuid4()), "segment_id": ..., "branch_id": ...}`
   dict in roughly seven tests.

## Why deferred

Quality-only, no behavior at stake, and each touches code the in-flight tickets (15, 17, 21, 27)
will edit again. Folding them in now would add churn to a diff that already carries a schema
migration. Items 1 and 2 also trade duplication for indirection, which may not be a net win —
judge that with the code in front of you.

## Suggested fix approach

1. Extract a shared `parseArchiveSequence(text, eventId, projectId, extra?)` in `register.tsx`,
   or leave both if the shared shape ends up more opaque than the two explicit checks.
2. In the helper, extract
   `static void require_event_identity(const char *run_id, const char *segment_id,
   const char *branch_id, const char *event_id, const char *category)` and call it from both
   subcommands, preserving each caller's error category.
3. In `helper_protocol.py`, add a `def identity(self, project_id: str) -> dict[str, str]`
   fixture helper next to `begin_argv()` and `boundary_argv()`.

"Done" is the full gate still green with no behavior change.

## Recommended tools

- `grep -n 'parseConfirmedResponse\|parseBoundaryResponse' mods/prompt-trail/hooks/register.tsx`
- `grep -n 'pt_is_safe_identifier' mods/prompt-trail/src/prompt_trail_helper.c`
- `grep -n 'segment_id.*str(uuid.uuid4())' mods/prompt-trail/tests/helper_protocol.py`
- Full gate: `mods/prompt-trail/scripts/verify-startup.sh` (rebuilds artifacts — a helper edit
  requires it, or the gate fails as "stale artifacts").


---

## 4. `parseConfirmedResponse` 与 `parseBoundaryResponse` 各有一份 sequence 校验

*来自 Issue 16 的 review（`/code-review` round 1，minor，PLAUSIBLE、未验证）。*

`mods/prompt-trail/hooks/register.tsx` 里这两个函数都在校验
`eventId` 与 `projectId` 回显、`Number.isSafeInteger(sequence)` 和 `sequence >= 1`；
`parseBoundaryResponse` 只多一个 `kind` 比对。对协议响应校验或 sequence 下界的改动
必须同步改两处，否则会悄悄分叉。

**为什么延后**：这份重复是 Issue 14 引入 `parseBoundaryResponse` 时就存在的，
Issue 16 只把它的 `kind` 参数类型从 `CollectionBoundaryKind` 放宽到 `BoundaryKind`，
没有加深重复。属于审查目标之外的既有代码。

**修法草图**：抽一个
`function parseSequenceResponse(text, eventId, projectId, extra?: (value: Record<string, unknown>) => boolean): number`，
两个调用点各自传 `kind` 比对或不传。改完跑
`mods/prompt-trail/scripts/verify-startup.sh`；现有的 `capture-response` 与
`boundary-response` 两类失败测试应当原样通过。
