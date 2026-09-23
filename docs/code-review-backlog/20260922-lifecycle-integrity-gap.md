---
id: lifecycle-integrity-gap
status: open
severity: major
found: 2026-09-22
source: /code-review, round 1
target: Prompt Trail Issue 16「以 Clear Boundary 划分 Conversation Segment」的未提交改动
---

# 无法恢复的 lifecycle 事实只被报告，从未成为不可变的 Integrity gap

## Problem

spec.md §9 最后一条要求「无法唯一恢复 lifecycle 事实时创建 Integrity gap，不猜测或静默忽略」。
Issue 16 实现了「不猜测」和「报告」，但**没有实现 Integrity gap 这个档案侧事件**。

四条路径会让一段 lifecycle 事实永久丢失，而档案里没有任何标记：

- `mods/prompt-trail/hooks/lifecycle.ts` 的 `unobservedClear`：观察到 `source=clear` 的
  SessionStart 但没有对应的 SessionEnd，因而没有边界可关联。
- 同文件 `overflowed`：恢复队列达到 `LIFECYCLE_QUEUE_LIMIT`（16）后拒绝继续增长，
  其后的 Clear Boundary 直接丢弃。
- `mods/prompt-trail/hooks/register.tsx` 的 `storedLifecycle()`：`$.store` 里损坏的队列行被
  丢弃并置 `damaged`，它命名的那条 Clear Boundary 无法重放，永久丢失。
- 同文件 `deferredClear`：进程在「观察到 `/clear`」与「把它写进 `$.store`」之间退出时，
  这个只存在于内存的事实随进程消失。

四者都只体现在 `/prompt-history status` 的 `clear transition:` 一行里。队列一旦清空，
Run 就回到 `enabled`，**其后的 Prompt Entry 会让时间线看起来跨过那个断口仍然连续**，
这正是 spec 禁止的。

## Why deferred

Integrity gap 与 Integrity recovery boundary 是两个新的 Timeline Event 种类，需要
`boundary_kind_valid()` 之外的设计：谁负责关闭一个 gap、gap 的区间如何表达、UI 如何
永久显示它、以及「跨 gap 的历史不得称为完整」在有界读取（Issue 21）里怎么体现。
map.md 已把 Integrity gap 划给 Issue 26，`archiveUnavailable` 的本义划给 Issue 25。
在本票据里顺手加一个 kind 会先于那两张票据把语义定死。

MVP 当前的取舍是**可见但不阻塞**：损失如实写进 status，不把 Run 永久卡死。
把它改成阻塞是一个死锁（`damaged` 每次读都会重新判定，`disable`/`enable` 也解不开），
所以不能作为临时替代。

## Suggested fix approach

1. 在 `boundary_kind_valid()`（`mods/prompt-trail/src/prompt_trail_helper.c`）加
   `integrity-gap` 与 `integrity-recovery` 两个 kind；表与 schema 不需要动，沿用
   Issue 16 的做法。
2. 把上列四个标志从「只进 status」改成「写一条 `integrity-gap` 边界」。写入点与
   Clear Boundary 相同：先落 `$.store` 的恢复队列再 append，失败则留在队列里。
3. 健康恢复时（队列清空且一次 `boundary-append` 成功）写 `integrity-recovery`。
4. `boundaryLine()` 为这两种 kind 各加一行文案，措辞必须说明「该区间无法证明完整」。
5. Done 的标准：`tests/helper_protocol.py` 证明两个新 kind 与既有 kind 共用 sequence 且
   幂等；plugin test 证明四条路径各自留下一条 gap 边界，且 gap 之后的恢复不会把 gap
   抹掉。

## Recommended tools

- `grep -n "unobservedClear\|overflowed\|damaged\|deferredClear" mods/prompt-trail/hooks/*.ts*`
  找齐四条路径的全部触点。
- `grep -n "boundary_kind_valid" -A 10 mods/prompt-trail/src/prompt_trail_helper.c` 看唯一改动点。
- 复现队列溢出：在 plugin test 里往 `prompt-trail:lifecycle:<projectId>:<runId>` 塞
  `LIFECYCLE_QUEUE_LIMIT + 1` 条 `LifecycleWrite`，断言 `overflowed` 为 true。
- 改了 `src/*.c` 后必须跑 `mods/prompt-trail/scripts/build-artifacts.sh`，
  再跑 `mods/prompt-trail/scripts/verify-startup.sh`。
