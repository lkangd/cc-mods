# 16: 以 Clear Boundary 划分 Conversation Segment

**What to build:** 让 `/clear` 在同一 Run 中准确结束旧 Conversation Segment、创建一个可见边界并开始无父 prompt 的新 Segment，同时不把 compaction 或 UI 重放误判成清空。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** claimed

- [x] 只有 `classic.SessionEnd(reason=clear)` 原子写入一个 Clear Boundary，并结束当前 Conversation Segment。
- [x] Clear Boundary 使用旧 classic session ID 派生幂等键；重复事件或重试不会产生第二个边界。
- [x] `classic.SessionStart(source=clear)` 只关联新 classic session ID 和新 Conversation Segment，不写第二个 Clear Boundary。
- [x] clear 前后保持同一 Run；clear 后首个 Prompt Entry 没有 clear 前 Prompt Entry 的逻辑父节点。
- [x] 进程在 SessionEnd 与 SessionStart 之间退出时，已写入边界保留，并能在恢复时明确表示未完成转换。
- [x] `/compact`、`source=compact`、Pre/PostCompact、延迟 `prompt.context`、function-hook `session.start`、reload 和 `ui.render` 重放均不创建 Clear Boundary。
- [x] 时间线按 sequence 在 clear 前后显示恰好一行边界，并保持两侧 Prompt Entries 的原顺序。
- [x] slash `/clear` 本身不创建 Prompt Entry。
- [x] plugin test 使用记录的 lifecycle 序列验证幂等状态机；真实 PTY 复验 `/clear`、`/compact`、reload 和中断场景。

## Comments

### 实现（第一轮）

**形状**：生命周期状态机独立成 `mods/prompt-trail/hooks/lifecycle.ts`，是「存量状态 + 一个事件 →
决定」的纯函数；它只描述要写的边界，不执行写入。理由有二：一是把「什么算一次 `/clear`」这个判断
与 `$`、档案、子进程完全解耦；二是**测试引擎无法派发 classic 事件**（`EventCalls` 里没有
`classic` 名词，实测 `$` 只有 agent/attribution/command/config/prompt/session/skill/tool/turn/ui），
所以票据第 9 条的「用记录的 lifecycle 序列验证幂等状态机」只能直接回放状态机本身。

**C 侧**：只改了 `boundary_kind_valid()`，加 `clear`。表、schema、helper protocol 都没动。
`tests/helper_protocol.py` 里原先拿 `kind="clear"` 当「未知种类」的那条测试改用
`integrity-recovery`，另加三条：clear 边界分隔两个 Segment 且取中间的 sequence、同 event id 重放
只有一条边界、重放时 `occurredAt` 漂移则 `boundary-conflict` 失败关闭。

**幂等键**：`sha256("prompt-trail:clear-boundary:1:<projectId>:<旧 classic session id>")`，
64 位十六进制，过 `pt_is_safe_identifier`。重复事件、队列重试、下一个进程补写，三者取到同一个
event id，所以 `boundary-append` 回既存 sequence 而不是切第二刀。

**Segment 与分支**：`segment_id` 本来就是 classic session id，`branchKey` 也本来就按
(project, run, session) 分键。`/clear` 换 session id ⇒ 新 Segment 自动成立，新 Segment 第一次
`branchState()` 找不到记录 ⇒ 自动拿到 `parentEventId: null` 的新根分支。**第 4 条勾选项不需要新实现，
只补了测试**，与交接文档的预判一致。Run 不变由 bridge 的 `load_clear_identity()` 保证（Issue 11 已验）。

**恢复队列**（spec §9 要求，此前不存在）：`$.store` 的 `prompt-trail:lifecycle:<projectId>`，
值是 `{version, queue: LifecycleWrite[], clear?, unobservedClear?, overflowed?, damaged?}`，
**只有身份和时刻，没有任何原文**。`LifecycleWrite` 记下 event id、runId、segmentId、branchId 和
**原始 occurredAt**——重放必须逐字段一致，漂移一个字段就是 `boundary-conflict`。
上限 `LIFECYCLE_QUEUE_LIMIT = 16`，满了置 `overflowed` 而不是继续长；读不出来的行丢弃并置
`damaged`，两者都在 status 里如实报，不静默。

**清空时机**：`prompt.submit` 里 `settlePending()` **之后**、`archiveUnavailable` 短路**之前**。
顺序有含义：未决 pending 属于 `/clear` 之前的 Segment，先归档它、再补 Clear Boundary，边界才落在
两段之间；放在 `archiveUnavailable` 之前的理由与 Issue 15 相同——不确定的失败不能把要补的东西
锁在门外。补不上则 drop 本次提交并退回草稿（与 `stopBoundaryMissing` 同一种失败关闭）。
`enableCollection` 同样先清空再写 resume 边界。

### 本轮做的三个语义决定

1. **停用采集的 Run 不写 Clear Boundary。** spec §9 没有按 collection mode 限定，但禁用区间里的
   prompt 本就没记录，在其中标一条「会话段在此断开」是在描述没被归档的形状。结构事实并没丢：
   恢复采集本来就从新的根分支开始。改动点在 `applyLifecycle()` 的 `mode.mode === 'disabled'` 一处。
2. **`classic.SessionStart(source=clear)` 只关联，绝不补写边界。** 找不到对应的 SessionEnd 时置
   `unobservedClear` 并在 status 里说「观察到无对应 SessionEnd 的 source=clear」，不凭一个 start
   造边界。
3. **「未完成转换」是读时判断，不是写时标记**：`clearTransitionState(state, runId)`，
   `clear` 存在、没有 `resumedSessionId`、且 `clear.runId !== 当前 runId` ⇒ `unfinished`。
   同一个 Run 的两个事件之间是 `open`（正常在途），换了进程才是 `unfinished`。
   这同时让 `source=compact` 天然无害——它在同一个 Run 里，runId 相同。

### 顺手修掉的三处

- `recordBoundary()` 改为按 event id 幂等。补写成功但 `saveLifecycle` 失败时下一次会重放同一个
  event id，helper 回既存 sequence，若不去重时间线就会出现第二行——直接违反第 7 条。
- `loadLifecycle()` 每次重读 `$.store`，不跨调用缓存。该记录是 project 级的，并发 Run 可能排进了
  本 Run 没见过的边界，写回陈旧副本会把它丢掉。
- `disableCollection()` 在尝试写停止边界前补了 `refreshStartup($)`。此前它用缓存的
  `startup.sessionId`，`/clear` 之后那是**已经结束的** Segment，停止边界会挂错段。开关翻转仍在
  边界之后、且无条件生效，方向性没变。

### 测试替身也动了

`tests/support.tsx`：新增 `classicSession`（可变的 classic session id，用来模拟 `/clear` 轮换）、
`storeSetFailsFor`；并把 sequence 分配改成**按 event id 幂等的分配器**——原先按调用次数算，重放
同一个 event id 会拿到第二个 sequence，比真实 helper 宽松。

### 门禁

`scripts/verify-startup.sh` 在 `2.1.273` 与 `2.1.278` 下全绿：**103 项 plugin tests**、7 项静态制品、
13 项 bridge protocol、**37 项 helper protocol**、TypeScript、确定性重建。
`claude plugin validate` 列出的 hooks 已含 `classic.SessionEnd`、`classic.SessionStart`。

### 2026-09-22 真人 PTY 验收

`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/prompt-trail`，Claude Code `2.1.278`。
档案从 **21 entries / 4 boundaries / 0 pending、sequence 1..25** 增长到
**27 / 6 / 0、1..33 连续**。按交接文档的建议，**这轮以「已归档的 entry」收尾**（seq 33），
留下了可正面核对的痕迹。

```
26  entry  08ce917c  run 30de4345  seg 772f39c0  br c13b3346  parent -          A
27  entry  455ee9c8  run 30de4345  seg 772f39c0  br c13b3346  parent 08ce917c   B
28  clear  a86f0ebc  run 30de4345  seg 772f39c0  br c13b3346                    ← /clear
29  entry  c312b991  run 30de4345  seg 65f5c50c  br ba90de43  parent -          C
30  entry  d88c01e4  run 30de4345  seg 65f5c50c  br ba90de43  parent c312b991   D（/compact 之后）
31  entry  39c3f7bf  run 30de4345  seg 65f5c50c  br ba90de43  parent d88c01e4   E（reload 之后）
32  clear  2b592023  run 30de4345  seg 65f5c50c  br ba90de43                    ← 从恢复队列补写
33  entry  d7a359a0  run 30de4345  seg 1884e903  br e2b5b029  parent -          F
```

**A 段 `/clear`**：恰好一条边界落在 B 与 C 之间；边界挂在**结束的那个 Segment**（`772f39c0`）和
被切断的分支上；**run 全程不变**；C 换 Segment、换根分支、`parent = NULL`。第 1、3、4、7 条。

**幂等键端到端核对**：`sha256("prompt-trail:clear-boundary:1:<projectId>:<旧 session>")` 对两次
`/clear` 分别算出 `a86f0ebc47c7fe0d…` 与 `2b59202326e6f96e…`，与档案里两条边界的 `event_id`
**逐字相同**。第 2 条。

**B 段 `/compact`**：`clear transition` 一字未变、时间线仍只有一行边界。并且测出一个此前未知的
事实——**`/compact` 不轮换 classic session id**：D 留在 Segment `65f5c50c`、分支 `ba90de43` 上，
`parent = C`。所以 compact 既不建边界、不换 Segment、也不开新根分支。顺带排除了一个曾怀疑的
路径：既然 session id 不变，`hooks/hooks.json` 里 SessionStart matcher 不含 `compact` 就不构成
问题（没有新 session 需要 locator）。**这条对 Issue 19、20 有用。**

**C 段 reload**：`touch hooks/register.tsx` 后提交 E，Run、Segment、分支、父链全部延续，没有边界。
展开后只剩 E 是预期内的——时间线仍是内存态，归 Issue 21。

**D 段恢复队列**：把档案 `chmod 0400`（helper 在 `lstat` 阶段就以 `database-permissions` 拒绝，
不碰数据）后 `/clear`。status 如实显示 `Run collection mode: disabled · Clear Boundary 待补写`
与 `1 条 Clear Boundary 待补写`；提交被挡下、草稿退回。恢复 `0600` 后边界补写成功（seq 32，
身份与 SessionEnd 当时完全一致），F 随后归档在新 Segment 的新根分支上。第 2、5 条前半、第 6 条。

**E 段强退**：`ctrl-c ctrl-c` 后重启，seq 32 的边界仍在档案里，队列为空、无未决 pending。

**第 5 条后半「恢复时明确表示未完成转换」PTY 造不出来**：SessionEnd 与 SessionStart 之间是
毫秒级窗口。它由 plugin test 覆盖（`clearTransitionState()` 在 `resumedSessionId` 缺席且 runId
不同时返回 `unfinished`，以及对应的 status 文案）。验收时我一度预期重启后会看到「未完成转换」，
**那个预期是错的**：这次转换在旧 Run 里确实完成了（`resumedSessionId` 已写入），一条已完成的
转换无论之后多少个新进程来读都应当读作「已完成」。

### 一处没能解释的现象，以及因此补的可诊断性

D 段恢复 `0600` 之后，**第一次**提交 `PT-16-F` 仍被挡下（提示是
「无法补写中断的 Clear Boundary」，即 `drainLifecycle()` 返回 `blocked`），**第二次**才通过。

已排除的：helper 没有粘滞状态（在 scratchpad 的独立档案里复现 `0400 → 拒绝 → 0600 → 重试`，
**第一次重试即成功**）；不是 `archiveUnavailable` 卡住（`$.store` 里始终没有
`prompt-trail:archive-state:` 这个键，说明 `markArchiveUnavailable()` 全程未被调用）；
`run()` 只是一次 `$.process.run`，无重试无锁。剩下 `$.store` 偶发抛出与 helper 那次真的非零退出
两种可能，**我无法区分，也不编解释**。有个未经证实的猜测：补写前一瞬我用只读方式打开过同一个
WAL 档案，可能与 helper 的 `BEGIN IMMEDIATE` 撞了一次。

失败行为本身是正确的：失败关闭、挡下提交、退回草稿、重试即过、档案最终完全正确，代价是多按一次
回车。真正的问题是**当时查不出原因**——`appendBoundary()` 把 helper 的所有失败都塌缩成
`throw new Error('boundary-append')`，status 也只报一个条数。因此补了：`appendBoundary()` 改为
抛出 `safeCategory(result.stderr, 'boundary-append')`，Run 级的 `lifecycleFailure` 记下最近一次
失败类别，队列非空时 status 追加 `上次补写失败：<类别>`。新增一条 plugin test 断言该文案。
**这不修复那次失败，只让它下次可辨认。**

### 门禁（终态）

`2.1.273` 与 `2.1.278` 各 **104** 项 plugin tests、7 项静态制品、13 项 bridge protocol、
**37** 项 helper protocol，TypeScript 与确定性重建全部通过。

### 2026-09-22 code review 第一轮及修复

`/code-review`，6 个角度（correctness、removed-behavior、callers、cleanup、conventions、spec），
spec 源是 `spec.md` 与本票据。31 条原始、17 条合并、**14 条已验证**（2 critical、7 major、
4 minor、1 nit），0 条被驳回。产物在 `.code-review/runs/20260922-182641/round-1/`（已 gitignore）。

**两条 critical 都是本轮引入的，而且其中一条正是 PTY 里那次没解释清楚的失败的放大版。**

1. **并发 Run 互相覆盖生命周期记录**（critical）。`prompt-trail:lifecycle:<projectId>` 是
   project 级键，`$.store` 没有 compare-and-swap，两个 Run 从同一快照各自算出队列后整值写回，
   后写的抹掉先写的那条 Clear Boundary。**改成按 Run 分键**
   `prompt-trail:lifecycle:<projectId>:<runId>`，竞争直接消失；一个 Run 替别的 Run 欠的账
   通过 `$.store.keys()` 枚举前缀找到（`foreignLifecycles()`）。
2. **落盘失败会让欠账凭空消失**（critical）。`applyLifecycle` 原先「先 append 再落盘」，
   落盘失败时只留内存副本；而 `loadLifecycle()` 每次重读 `$.store`，读回空队列，
   drain 便回 `clear` 放行提交——**边界永久缺失且无人知道**。改成
   **先把 write 作为欠账落盘、再尝试 append**：崩在 append 前，队列还点着名；崩在 append 后，
   重放按派生 event id 幂等。两个崩溃窗口都可恢复。
3. **队列补写用了补写者的 Run 身份**（major）。`appendBoundary` 一直发 `startup.runId`，
   `drainLifecycle` 没传 `write.runId`。换个进程来补写，helper 的
   `existing_boundary_sequence()` 比对 `run_id` 不符 → `boundary-conflict` **永久卡死**；
   若原边界尚未提交则归错 Run。**PTY 里我恰好在同一个 Run 内重试所以 runId 相同**，
   这个洞才没暴露。加 `runId` override。
4. **另一个 Run 的 `source=clear` 能冒领转换**（major）。`decideLifecycle` 的 start 分支只看
   `resumedSessionId`，不比 `runId`，会把别人被中断的转换标成已完成。加 runId 比对。
5. **分支读不到就静默丢弃边界**（major）。`catch { return }` 不留任何痕迹。新增内存态
   `deferredClear`（只记 sessionId 和**当时的**时刻），阻止本 Run 下次提交，每次 drain 重试把它补完。
6. **pending 未结清时先写了边界**（major）。`/clear` 之前有未决 Pending Capture 时，
   它稍后确认会拿到边界之后的 sequence，旧 prompt 被排到新 Segment 里。改成
   **有 pending 就只入队不 append**，交给 `settlePending()` 之后的 drain 写，顺序自然正确。
7. `writeBoundary()` 统一了实时路径与补写路径（原 finding 13），`LifecycleContext` 拆成
   `{ runId, end? }`——只有 end 才需要 eventId/branchId/occurredAt，start 不再计算无用的
   sha256 与时钟（原 finding 14）。`isSafeId()` 收拢了四个解码器里重复的标识符策略（原 finding 11）。
8. 文档：Issue 14 的 Answer 里「kind 限定为三种」已补上 Issue 16 之后 `clear` 也合法（原 finding 10）。

**归入 backlog 两项**：`docs/code-review-backlog/20260922-lifecycle-integrity-gap.md`
（spec §9 的 Integrity gap 从未真正写进档案，四条路径会让 lifecycle 事实永久丢失而档案无标记；
归 Issue 26，且当前「可见但不阻塞」的取舍不能简单改成阻塞，否则是死锁）；
`20260922-cleanup-minor-batch.md` 追加第 4 条（两个 sequence 响应解析器的重复，Issue 14 遗留）。

**部分驳回**：finding 9 要求损坏的 lifecycle 记录应当阻塞。`damaged` 标志已让损失在 status 里
可见，不再是「静默」；改成阻塞则无解——`damaged` 每次读都重新判定，`disable`/`enable` 都解不开，
等于永久卡死。正确答案是 Integrity gap，已归 backlog。

新增 6 条回归测试。门禁：`2.1.273` 与 `2.1.278` 各 **110** 项 plugin tests、7 + 13 + 37 项 Python，
TypeScript 与确定性重建全部通过。

**注意：修复改变了 `$.store` 的键形状与 `/clear` 的落盘时序，按 Issue 15 的先例需要复验 PTY。**
真实 store 里那条旧的 project 级 `prompt-trail:lifecycle:<projectId>` 不再被匹配（前缀要求结尾冒号），
成为孤儿；它的队列为空、转换已完成，没有事实因此丢失。
