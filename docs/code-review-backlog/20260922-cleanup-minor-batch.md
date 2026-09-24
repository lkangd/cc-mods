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

---

## 5. `BoundaryKind` 类型与 `TIMELINE_KINDS` 白名单各写一份

*来自 Issue 17 的 review（`/code-review` round 1，nit，PLAUSIBLE、未验证）。*

`mods/prompt-trail/hooks/register.tsx` 顶部用联合类型声明 `CollectionBoundaryKind` 与
`BoundaryKind`，`parseTimeline()` 前的 `TIMELINE_KINDS` 又把同样六个字符串写了一遍作为
`timeline-read` 响应的运行期白名单。以后加一种边界要改两处，漏改运行期那份时，新种类的行
会让整次 `timeline-read` 被拒。

**为什么延后**：纯质量问题；Issue 21 会在同一协议上扩展时间线读取，届时一起收拢改动面更小。

**修法草图**：`const BOUNDARY_KINDS = ['collection-started', 'collection-stopped',
'collection-resumed', 'clear', 'run-started', 'run-attached', 'run-detached'] as const`（Issue 32 后的集合；旧 `run-ended` 只是读取时的兼容映射 `LEGACY_KINDS`，不进白名单），
`type BoundaryKind = typeof BOUNDARY_KINDS[number]`，`TIMELINE_KINDS = new Set<string>(BOUNDARY_KINDS)`；
`CollectionBoundaryKind` 用 `Extract<BoundaryKind, \`collection-${string}\`>` 或保持显式。
门禁原样通过即完成。

## 6. bridge 里 session 索引与 locator 各有一份私有原子发布

*来自 Issue 32 的 review（`/code-review` round 1，minor，PLAUSIBLE、未验证）。*

`mods/prompt-trail/src/prompt_trail_bridge.c` 的 `write_session_index()` 与 `publish_locator()`
都是「UUID 临时文件 → `O_EXCL | O_NOFOLLOW` 0600 打开 → 写入 → `fsync`/`close` → 私有权限检查
→ `rename` → 目录 `fsync`」。以后改临时文件安全或发布流程要同步改两处。

**为什么延后**：纯质量问题，两份实现当前行为一致；抽取会动 locator 发布这条已验收的路径，
不值得在 Issue 32 里顺手做。

**修法草图**：抽一个 `publish_private_file(directory, final_name, write_body)`（或接受已渲染
好的缓冲区），统一临时名、打开标志、刷新、权限检查、`rename`、目录 `fsync` 与失败清理；
`publish_locator()` 与 `write_session_index()` 改为调用它。bridge 协议测试原样通过即完成。

## 7. 多个 locator 候选时逐个重复检查共享的 owner 与目录

*来自 Issue 32 的 review（`/code-review` round 1，nit，PLAUSIBLE、未验证）。*

`inspectTarget()` 对每个 `<session>.*.json` 候选调用 `inspectLocator()`，每次都重新跑
`/usr/bin/id -u`，并对同一个 locator 目录做 `fileIdentity()` 和 `hasExtendedAcl()`。只有两个
进程同时 resume 同一会话时才会出现多个候选，但 `inspectTarget()` 在每次 composer 提交时都会
调用。

**为什么延后**：只在并发 resume 这个少见场景下多几次子进程；改动会拆开一段失败分类很细的
检查链，风险大于收益。

**修法草图**：在候选循环外求一次 owner 并校验目录（身份、权限、ACL），把结果传给
`inspectLocator()`，函数里只保留对候选文件本身的检查；`startup_refusal.test.tsx` 的目录
ACL 用例原样通过即完成。


## 8. 会话索引读取器靠一串位置输出参数

*来自 Issue 33 的 review（`/code-review` round 1，minor，PLAUSIBLE、未验证）。*

`mods/prompt-trail/src/prompt_trail_bridge.c` 的 `read_session_index()` 按位置写出 `run_id`、
`archive_generation`、`continued_from`。有的调用方只要其中一个字段，也得准备其余的临时缓冲区：
`handed_off_chain()` 只要 `continued_from`，fork 分支（`find_continued_source` 之后）的
`earlier` 也用不上。

**为什么延后**：纯接口整理，当前行为正确；改动会碰到 resume、fork 与交接链三处调用，不值得在
Issue 33 里顺手做。

**修法草图**：定义 `SessionIndex { run_id[129]; archive_generation[129]; continued_from[129]; }`，
由 `read_session_index()` 填写；调用方各取所需。bridge 协议测试原样通过即完成。

## 9. bridge 接续测试里重复的「先发布来源 session」

*来自 Issue 33 的 review（`/code-review` round 1，nit，PLAUSIBLE、未验证）。*

`mods/prompt-trail/tests/bridge_protocol.py` 里的接续用例几乎都以同一段开头：记下
`source_session = self.session_id`，发布 `SessionStart`，断言返回码，再读 locator。

**为什么延后**：只是测试里的重复，不影响行为。

**修法草图**：加一个 `publish_source()` 辅助方法，返回来源 session id 和 locator 内容，把接续
用例改为调用它。测试原样通过即完成。
