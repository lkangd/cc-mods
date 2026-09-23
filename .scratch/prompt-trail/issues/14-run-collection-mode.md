# 14: 切换 Run collection mode

**What to build:** 让已授予 Collection consent 的使用者独立控制当前 Run 是否采集，并在时间线上看见真实的开始、停止和恢复边界，而不影响旧数据或其他 Run。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** resolved

- [x] `/prompt-history enable` 只在项目已 consent 且 preflight 健康时启用当前 Run；控制命令本身不创建 Prompt Entry。
- [x] `/prompt-history disable` 只停止当前 Run 的后续采集，不删除旧 Prompt Entries、不撤销 Collection consent。
- [x] disabled 期间的 composer submission 正常进入 Claude Code，但不创建 Pending Capture 或 Prompt Entry。
- [x] disable 和重新 enable 分别写入明确的 Collection Boundary，禁用区间不会被显示为完整历史。
- [x] 重新 enable 从新的根 Conversation Branch 开始，不补录禁用期间的 prompt。
- [x] `status` 始终准确显示 Collection consent、policy version、当前 Run collection mode 和最近 Collection Boundary，且不显示 prompt。
- [x] 未 consent 项目运行 enable 时先进入 consent 流程；不受支持或不健康环境不能呈现为成功启用。
- [x] 一个 Run 的 enable/disable 不修改其他 Run 的模式；并发隔离将在后续双 Run 场景中端到端复验。
- [x] reload 后当前 Run collection mode 与边界状态保持，普通进程重启按新 Run 的默认模式处理。
- [x] plugin test、helper semantic test 与真实 PTY 覆盖 enable、disable、重新 enable、disabled submission 和无补录行为。

## Comments

### 2026-09-22 实现进度（自动门禁全绿）

自动门禁：Claude Code `2.1.273` 与 `2.1.278` 各 **57** 项 plugin tests（原 48，
新增 `tests/collection_mode.test.tsx` 的 9 项）、7 项静态制品测试、13 项 bridge
protocol tests、**23** 项 helper protocol tests（原 19）、TypeScript 与确定性
重建全部通过。

**档案侧（C）。** 新增非 prompt Timeline Event 表 `timeline_events`
（`event_id`/`sequence`/`kind`/`run_id`/`segment_id`/`branch_id`/`occurred_at_ms`，
不含任何文本）与 `boundary-append` 子命令。边界与 Prompt Entry 共用
`metadata.next_sequence` 这一个项目级分配器，因此边界与 prompt 之间的先后只由
sequence 决定。相同 `event_id` 的重复调用幂等返回同一 sequence；未知 kind 以
`boundary-input` 失败关闭且不建库。本票据交付时 kind 限定为 `collection-started`、
`collection-stopped`、`collection-resumed`；**[Issue 16](16-clear-conversation-segment.md)
之后 `clear` 也是合法 kind**（`boundary_kind_valid()` 是唯一改动点，表与 schema 未变）。

**schema 到 2。** 新建库直接是 2；已存在的 1 号库在打开时执行 manifest 声明的
`1->2` 单向迁移，事务内只新增上述表，原有 entry、sequence 与 Run/Segment/Branch
关系逐字保留（`test_a_schema_1_archive_migrates_without_losing_its_entries` 用
手工构造的旧 schema fixture 证明）。manifest 随之变为
`schemaReadMin 1 / schemaReadMax 2 / schemaWriteMin 2 / schemaWriteMax 2` 并新增
`schemaMigrations: ["1->2"]`。**这里有一处对 spec 的已知欠账**：spec
「迁移、更新与制品信任」要求迁移前做完整性与空间检查并创建同权限备份，本轮没有
实现，已在 `spec.md` 就地标注并留给 Issue 27。

**插件侧。** Run collection mode 变成真实状态：`$.store` 的
`prompt-trail:run-mode:<projectId>:<runId>` 保存 `{version, mode, boundary}`。
键只含 project 与 Run，因此同 Run 的 reload 读回同一开关，新进程（新 Run）
没有记录、按默认值采集。没有记录即默认 `enabled`——把默认设成 `disabled` 会让
Issue 12 的首次 consent 询问永远不触发。

- `enable`：先 `prepareProject` → 重跑 preflight，`support !== 'supported'`
  直接返回失败文案且不写边界、不落盘开关；未 consent 先走 consent 流程；
  `archiveUnavailable`（也就是存在未解决的 Pending Capture）时拒绝启用，
  完整对账留给 Issue 15。真正发生 off→on 转换时才写边界，kind 取
  `collection-resumed`（本 Run 曾显式 disable）或 `collection-started`（本 Run
  此前因未授权而没有采集），并把 branch 重置为新 `branchId` + `parentEventId: null`。
- `disable`：停用永远生效（这是不会丢数据的方向），边界写入是随后尝试的，
  写不进就在文案里如实说明，而不是伪装成连续采集。既有 Prompt Entries、
  Collection consent 和其他 Run 的记录都不改。
- `prompt.submit`：读到 `mode === 'disabled'` 就在 `archiveUnavailable` 判断之前
  直接 `next(e)`，因此禁用区间既不预写 Pending Capture 也不被档案故障阻塞。
- `status`：`Run collection mode` 同时给出开关与它实际意味着什么
  （`enabled` / `disabled · 本 Run 已停用采集` / `disabled · 未授予 Collection consent`
  / `disabled · 档案不可用` / `disabled · <preflight reason>`），并新增
  `latest collection boundary` 一行。不受支持的目标下 `status` 不再去解析项目身份，
  以保持「不触碰档案」的既有承诺。
- 展开列表按 sequence 同时绘制 Prompt Entry 与边界，停止行写明「其后的 prompt
  未记录」、恢复行写明「新根分支；停用期间的 prompt 不补录」，显示序号只数
  Prompt Entry。

**semantic verifier 扩了一次。** `state: "set"` 新增可选 `boundaries` 数组；
一旦给出 `boundaries`，`entries` 与 `boundaries` 的每一项都必须显式带 `sequence`，
`metadata.next_sequence` 按两者总数断言，并新增 `boundarySet` 与
`sequencesDistinct` 两项必检。不带 `boundaries` 的旧调用行为不变，但会断言
`timeline_events` 为空。

**测试骨架。** `tests/support.tsx` 增加 `boundary-append` mock、`boundaryFails`
开关、共享的 `promptHistory()` 与 `renderBand()`；`composer_capture.test.tsx`
改用共享版本。

剩余：最后一条勾选项需要真人 PTY 验收，自动门禁不覆盖。

### 2026-09-22 code review 第一轮及修复

`/code-review`（5 角度 + spec 角度，spec 源为 `spec.md`、本票据、`CONTEXT.md`）对整棵未提交
工作树跑了一轮，26 条 finding。修复 15 条、backlog 4 条、驳回 3 条，门禁重跑全绿：
**61** 项 plugin tests（原 57）与 **27** 项 helper protocol tests（原 23）。

档案侧修复：

- **事件身份现在跨表唯一**。`boundary-append` 拒绝已被 `pending_captures` 占用的
  `event_id`，`capture-begin` 拒绝已被 `timeline_events` 占用的 `event_id`，否则同一 id
  可能同时成为一条 Prompt Entry 和一条边界，重试将无法分辨。
- **迁移判定移到写锁内**。原先在锁外读 `user_version`，两个 Run 同时打开 schema 1 档案时，
  后者会把迁移重放到已升级的文件上并以 `archive-sqlite` 把健康档案报成不可用。现在
  已是 2 的档案完全不加锁，更旧的才取锁并在锁内重读版本。
- **边界重试必须逐字段一致**。原先只比 `kind`，现在 `run_id`/`segment_id`/`branch_id`/
  `occurred_at` 任一不同都以 `boundary-conflict` 失败关闭，与 `pending_matches` 的既有
  严格度一致。
- sequence 分配器抽成 `allocate_sequence()`，由 confirm 与 boundary 共用。

插件侧修复：

- **读不到开关不再猜**。`loadRunMode` 不再把 `$.store.get` 失败吞成「无记录」；失败向上
  传播，已 consent 的提交按既有失败关闭语义 drop，`status` 显示
  `unknown · Run collection mode 不可读`。
- **写不进停止边界就不恢复采集**。disable 失败时把 `stopBoundaryMissing` 持久化；enable
  先补写这条停止边界，补不上就拒绝恢复——否则档案里会出现没有对应停止的恢复边界，
  把禁用区间显示成完整历史。
- **disable 总会尝试写边界**，不再因 `archiveUnavailable` 这个可能过期的内存标志直接跳过。
- **已停用的 Run 在项目身份不可证明时照样放行**。原先 `prepareProject` 抛错会 drop，
  但停用的 Run 本就不采集，没有可漏记的东西。
- **disable 能赢下与在途 capture 的竞争**。`/prompt-history` 是 `immediate`，可以在
  `next(e)` 等待期间执行；确认前重读一次开关，已停用就 `capture-abort` 而不是把这条
  prompt 归档到停止边界之后。
- `status` 的 consent 行在未决时也给出 policy version；采集模式的嵌套三元式改成
  `collectionModeText()`；展开列表按 `sequence` 排序后再绘制。

semantic verifier 增加 `eventIdsDistinct`，跨 `prompt_entries`/`timeline_events`/
`pending_captures` 检查事件 id 不重复。

驳回 3 条：`SAFE_ERROR_CATEGORIES` 里的 `boundary-*` 并非无用——`artifact_static.py` 的
`test_hook_accepts_every_native_helper_error_category` 要求 C 源里出现的每个 category 都在
该白名单中；渲染已经是单次遍历；Issue 13 那条注释是有日期的进度记录，描述的是当时的事实。

backlog 4 条见 `docs/code-review-backlog/`：Run 身份在模块存活期间可能过期（归 Issue 17）、
`$.store` 写失败时 Run mode 的持久性、有界持久化时间线视图（归 Issue 21）、三条小清理。

### 2026-09-22 真人 PTY 验收

对**修复后**的构建（提交 `7517412`）验收。先重跑
`mods/prompt-trail/scripts/verify-startup.sh`，exit 0 全绿，制品不陈旧。

真实终端：`env -u CLAUDECODE CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 npx -y
@anthropic-ai/claude-code@2.1.278 --plugin-dir mods/prompt-trail`，按
status → 提交 → disable → 提交两条 → status → enable → 提交 → 展开
的顺序跑完，使用者确认五步的呈现全部符合预期：disabled 期间两条 prompt 正常进入
Claude Code 且无任何建档提示，`status` 给出 `disabled · 本 Run 已停用采集` 与
`collection-stopped`，enable 后为 `collection-resumed`，展开列表的停止/恢复两行
文案可见且显示序号跳过禁用区间。

档案形态核对（只读，只打印形态；`prompt_text` 未进入任何对话或报告）：

| | 验收前 | 验收后 |
|---|---|---|
| schema `user_version` | 2 | 2 |
| prompt entries | 17 | 19 |
| timeline events | 2 | 4 |
| pending captures | 0 | 0 |
| `metadata.next_sequence` | 19 | 23 |

新增的 sequence 20..23 全部属于同一个新 Run，形态是
`prompt` → `collection-stopped` → `collection-resumed` → `prompt`：

- 禁用期间的两条 submission **没有留下任何行**，既无 Prompt Entry 也无 Pending Capture，
  且 sequence 无缺口——证明它们根本没有进入分配器，而不是建档后被删。
- 恢复边界与其后的 prompt 共用一个与停止边界不同的 `branch_id`（`2b0b4f` → `b58ec2`），
  证明重新 enable 确实从新的根 Conversation Branch 开始，没有补录。
- 停止与恢复边界各一条、成对出现，禁用区间因此在展开视图里被显式标界。
- 三条控制命令（`status`/`disable`/`enable`）没有产生 Prompt Entry，符合第 1 条勾选项。

第 10 条勾选项据此成立：plugin test、helper semantic test 与真实 PTY 三层都覆盖了
enable、disable、重新 enable、disabled submission 与无补录行为。

## Answer

Run collection mode 成立：它是 `$.store` 里 `prompt-trail:run-mode:<projectId>:<runId>`
这一条 Run 级记录，键只含 project 与 Run，所以 reload 读回同一开关、新进程（新 Run）
无记录并按默认 `enabled` 采集；默认不能设成 `disabled`，否则 Issue 12 的首次 consent
询问永远不触发。`disable` 只停当前 Run 的后续采集，既有 Prompt Entries、Collection
consent 和其他 Run 的记录一律不动。

真实的开始/停止/恢复由档案侧的 `timeline_events` 表与 `boundary-append` 子命令承载
（schema 升到 2，已存在的 1 号库在打开时走 manifest 声明的 `1->2` 迁移，迁移判定在写锁内
重读 `user_version` 因此并发打开安全）。边界不含任何文本，与 Prompt Entry 共用
`metadata.next_sequence` 这一个项目级分配器，因此边界与 prompt 的先后只由 sequence 决定，
事件身份跨 `prompt_entries`/`timeline_events`/`pending_captures` 三张表唯一。

方向性是这套设计的核心：**停用永远生效**（不丢数据的方向），边界写入是随后尝试的，写不进
就在文案里如实说明并把 `stopBoundaryMissing` 持久化；**恢复则必须先补上那条停止边界**，
补不上就拒绝恢复——否则档案里会出现没有对应停止的恢复边界，把禁用区间显示成完整历史。
同理，`enable` 在 preflight 不健康或 `archiveUnavailable` 时拒绝启用而不是假装成功；
读不到开关时 `loadRunMode` 向上抛错、按既有失败关闭语义处理，绝不猜成「无记录」。
重新 enable 会把 branch 重置为新 `branchId` + `parentEventId: null`，所以恢复后是新的根
分支，禁用期间的 prompt 不补录。

已知欠账：spec「迁移、更新与制品信任」要求的迁移前完整性检查、空间检查与同权限备份本轮
没有实现，已在 `spec.md` 就地标注，留给 Issue 27。`archiveUnavailable` 时的完整 Pending
Capture 对账留给 Issue 15。

**本票据被 Issue 15 取代的一点**：上面的进度记录里把 `archiveUnavailable` 说成「也就是存在
未解决的 Pending Capture」。那是 Issue 14 当时的实现事实，现在不再成立——Issue 15 把未决
Pending Capture 拆成独立的持久「待对账」状态（`$.store` 的
`prompt-trail:reconcile:<projectId>`），`archiveUnavailable` 退回它本来的含义：档案真的不可用。
判断 enable 的拒绝原因、`status` 的显示和失败路径时以 Issue 15 为准。
