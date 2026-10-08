# 15: 对账中断的 Pending Capture

**What to build:** 让提交过程中的写入或宿主中断保持可恢复：不确定的提交不会被猜成 Prompt Entry，草稿不会丢失，使用者可以看见并解决歧义。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** resolved

- [x] Pending Capture 预写失败时，本次 composer submission 被 drop，输入内容原样保留或恢复到 composer，且不产生半成品 Timeline Event。
- [x] `next(e)` 成功后确认写入失败时，Pending Capture 保留，当前 Run 进入待对账状态并阻止后续 composer submission。
- [x] transcript 能唯一证明提交已进入时自动确认 Prompt Entry；能唯一证明未进入时自动丢弃 pending。
- [x] 无法唯一证明时，使用者只能选择“已进入 / 未进入 / 新根分支”，且每个选择幂等并产生对应语义结果。
- [x] 待对账期间 `status` 清楚显示状态和非敏感事件 ID，不输出 draft 或 prompt 原文。
- [x] disable 当前 Run 不删除 Pending Capture；再次 enable 前必须先完成对账。
- [x] 对账 UI 关闭或取消时保持阻止状态，不会默认确认、丢弃或让原提交自动重试。
- [x] helper/crash 重启后 Pending Capture 仍可发现和解决；重复执行恢复不会产生多个 Prompt Entries。
- [x] plugin test 注入预写、下游、确认和重启故障；helper test 与真实 PTY 分别验证持久状态、草稿恢复和提交阻止。

## Comments

### 2026-09-22 实现进度（自动门禁全绿，真人 PTY 待跑）

自动门禁：Claude Code `2.1.273` 与 `2.1.278` 各 **82** 项 plugin tests（原 61，新增
`tests/reconcile_pending.test.tsx` 的 21 项）、7 项静态制品测试、13 项 bridge protocol
tests、**34** 项 helper protocol tests（原 27）、TypeScript 与确定性重建全部通过。
（这组数字含下文 code review 修复后新增的测试。）

**核心状态：未决 Pending Capture 现在是一个独立的、可持久的「待对账」状态**，不再复用
`archiveUnavailable` 这个粗粒度旗标。`$.store` 的 `prompt-history:reconcile:<projectId>`
保存 `{version, eventId, runId, branchId, parentEventId}`——**只有身份，没有任何文本**。
键按 project 而非 Run，因为 pending 躺在项目档案里，重启进入新 Run 同样欠着这个答案。
`archiveUnavailable` 退回它本来的含义（档案真的坏了），归 Issue 25。

**档案侧新增两个原语。**

- `capture-list <dbRoot> <projectId> <sha> <protocol>`：按 rowid 从旧到新列出未决 pending，
  只回 `eventId`/`runId`/`segmentId`/`branchId`/`parentEventId`/`occurredAtMs`/
  `attachmentCount`，**不回 `promptText`，也不回 `attachmentKinds`**。固定最大批次 64，
  协议上没有任何加大批次的办法，因此调用方无法把它变成全表扫描；超出时 `truncated: true`。
  档案根或库不存在时回 `{"pending":[],"truncated":false}` 而不是失败——这个读问的是
  「有没有欠账」，没建过库就是「没有」。为此 `capture_runtime` 的 `create_root` 布尔改成
  `pt_root_mode` 三态（REQUIRE / CREATE / OPTIONAL）并返回根是否存在。
- `capture-confirm … --pending`：用**已经预写在 pending 行里的文本**确认，而不是从 stdin 取。
  这是重启后唯一可用的确认形式（插件已经没有草稿了），并且让原文继续只存在于 helper 内部。
  `--stdin` 形式一字未改。

**对账流程。** `prompt.submit` 在预写下一条 capture 之前先结算欠账，所以第二条 pending
永远不会叠在第一条上：

- **自动对账只在 transcript 能唯一证明时发生**。判据只有两种无歧义形态：暂存文本在
  `user` row 里恰好出现一次（证明已进入 → 确认），或者一次都没出现且 transcript 短于
  4096 条因而是完整的（证明未进入 → 丢弃）。出现两次以上、或 transcript 可能被截断，
  都算无法证明。重启后没有文本可比，一律走显式对账。
- **无法证明时只给三个选项**，各自幂等：`已进入` 确认为 Prompt Entry；`未进入` 丢弃
  pending；`新根分支` 同样不归档，并把 Active Branch 重置为新根。
- **对话框被关闭或取消不是答案**：保持阻止，不默认确认、不默认丢弃。
- **被阻止的那条提交永远不会被代为重发**，无论对账成功与否：草稿用 `$.prompt.fill()`
  退回 composer，由使用者自己按 Enter。预写失败的那条同样退回草稿。

**一个需要复核的语义决定。** spec 只列了「已进入 / 未进入 / 新根分支」三个选项的名字，
没有定义第三个的档案语义。本轮取的解释是：**`新根分支` 不归档**。理由是本票据的核心承诺
是「不确定的提交不会被猜成 Prompt Entry」，而第三个选项正是「我也说不准」那一档，
把它实现成「确认归档」等于在不确定时猜它进入了。代价是：如果它其实进入了，时间线会少一条，
并从新根分支继续——有损但不伪造。如果使用者要的是相反的取舍（宁可留下记录也不丢），
改动只在 `reconcilePending()` 的 `新根分支` 分支。

**发现路径每个 Run 只跑一次。** `discoverPending()` 在本 Run 第一次归档前问一次
`capture-list`；健康的 Run 不会为此每条 prompt 多开一个子进程。上一个进程可能在写
`$.store` 记录之前就崩了，所以档案才是权威来源。

**幂等性来自 helper 本身**：`capture-confirm` 对已确认事件直接回原 sequence 并清掉 pending，
`capture-abort` 对已确认事件回 `capture-conflict`、对不存在的 pending 回 `{"aborted":false}`。
因此重复恢复不会产生第二条 Prompt Entry（plugin 与 helper 两侧各有一条测试证明）。

**被本轮取代的旧断言**：`consent_capture.test.tsx` 的
「a confirmation failure keeps collection blocked across a reload」原先断言确认失败会持久化
`archive-state: unavailable`；现在断言持久化的是 `reconcile` 记录、且 `archive-state` 保持
未设置。`collection_mode.test.tsx` 里「控制命令不建档」的断言从
`startsWith('capture-')` 收紧为逐个检查 `capture-begin/confirm/abort`，因为 `capture-list`
是读不是写。

剩余：第 9 条勾选项的真人 PTY 部分未跑（持久状态、草稿恢复、提交阻止三项）。

### 2026-09-22 code review 第一轮及修复

`/code-review`（5 角度 + spec 角度，spec 源为 `spec.md`、本票据、`CONTEXT.md`）对整棵未提交
工作树跑了一轮，22 条 finding（9 major / 11 minor / 2 nit，17 CONFIRMED）。修复 17 条、
backlog 4 条、驳回 1 条。门禁重跑全绿：**82** 项 plugin tests（原 77）与 **34** 项 helper
protocol tests（原 33）。

**最重的一条：对账曾被 `archiveUnavailable` 永久锁在门外。** `prompt.submit` 原先在发现
pending 之前就对 `archiveUnavailable` 短路返回，而 `beginCapture` 失败和 `next(e)` 抛出
这两条路径都会设置这个旗标。可是这两种失败恰恰是**结果不确定**的：helper 完全可能已经把
pending 行提交进 SQLite 才死掉。于是档案里留着一条 pending，插件却永远走不到对账——
`enable` 同样在对账前就返回。这直接违反本票据第 8 条。修法两处：把 `archiveUnavailable`
的检查移到对账之后（`prompt.submit` 与 `enableCollection` 都是），并在这两个不确定的
catch 里把 `pendingDiscovered` 重置，让本 Run 不再相信它先前「没有欠账」的答案。

**其余 major 修复：**

- **一次对账只结清一条 pending。** 崩溃可能给每个 Run 各留一条，`enable` 原先只解决第一条
  就写恢复边界并报告成功，下一条 prompt 随即被剩下的 pending 挡住。现在抽出 `settlePending()`
  循环：结清一条就重新问一次档案，直到 `capture-list` 报空为止，上限取 helper 自己的固定
  批次 64。`prompt.submit` 与 `enableCollection` 共用它。
- **`新根分支` 会丢失使用者的选择。** 原先先 abort pending（连带清掉对账记录）再写新根分支；
  写失败就返回 blocked，而此时 pending 已经没了、记录也清了，下一条 prompt 直接在旧分支上
  归档。现在**先写新根分支再 abort**：写不进就保持 pending 原样，阻止继续有效。
- **确认成功但分支写失败会在重启后变成孤儿。** `discoverPending()` 原先只把发现的 pending
  放在内存里，没落盘；一旦 `capture-confirm` 成功（档案里的 pending 行随之消失）而随后的
  分支写失败，重启后 `capture-list` 已经报空，那条 entry 就挂在错误的父节点下。现在发现即
  用 `saveReconcile()` 落盘。
- **`$.prompt.fill` 失败时谎称草稿已恢复。** `restoreDraft()` 吞掉一切失败，调用方照样说
  「草稿已恢复」。现在它返回是否真的写回（`isFilled: false` 也算失败），文案由 `draftNote()`
  给出「草稿已恢复」或「草稿未能恢复，请重新输入」。
- **`capture-list` 失败时草稿被丢掉、Run 还显示健康。** 现在这条 catch 会恢复草稿并
  `markArchiveUnavailable`。
- **`status` 把「问不到」显示成「没有欠账」。** 新增 `pendingUnknown`，`status` 显示
  `pending reconciliation: unknown · 未决 Pending Capture 不可读`，采集模式一并显示为
  `unknown`，而不是紧接着就被下一条提交打脸。
- **helper 的 `capture-list` 对不可信的档案根失败开放。** `PH_ROOT_OPTIONAL` 原先对任何
  没通过 `pt_path_is_private_directory()` 的根都返回「空」，包括属主错、权限被放宽、类型
  不对的根。现在只有 `lstat` 证明 ENOENT 才算「没建过库」，其余一律以
  `database-root-unavailable` 失败关闭。新增一条权限被放宽的测试。

**测试替身的保真度修了四处**（它们会让重启类测试通过得太容易）：失败的 `capture-confirm`
不再占用一个 sequence（真实 helper 回滚时不分配）；`capture-confirm` 成功后从
`capture-list` 的结果里移除该行；`capture-abort` 只在**成功**时移除（原先失败也移除，
于是注入的 abort 失败在替身里看起来像成功）。

**一处行为变化**：遇到对账的那条提交现在一律 drop 并退回草稿，而 `settlePending()` 会在这
一次提交里把档案里所有 pending 结清。原先是每条 pending 各挡一次提交。

**驳回 1 条**：cleanup 角度建议把 `prepareProject` 里的 archive-state 与 reconcile 两次
`$.store.get` 并行化。两次读都是本地存储，延迟可忽略，而 `Promise.all` 会让那段
「读失败即失败关闭」的语义更难读——这是在正确性代码里用可读性换一个量不出来的收益。

**backlog 4 条**见 `docs/code-review-backlog/20260922-reconciliation-duplication-batch.md`：
时间线追加写了两遍、Active Branch 写入散在四处（与 Issue 17/18/19 纠缠，等它们先落地再切
接缝）、`capture-list` 重复了档案路径探测、对账测试重抄了 collection-mode 的 fixture。

### 2026-09-22 真人 PTY 验收

分两次进行。**第一次**对 code review 之前的构建，用 helper 直接在真实档案里预写两条
Pending Capture 模拟「上一个进程崩在确认之前」，再启动 Claude Code：`status` 显示
`pending reconciliation: FDCDA413 · 待对账`；提交被挡下并弹出三选一；按 Esc 取消后保持阻止、
草稿退回 composer；随后分别选「未进入」丢弃 A、「已进入」归档 B；结清后提交才正常建档。
档案形态核对与预期一致——pending 2 → 0，entries 19 → 21（sequence 24 = B，走 `--pending`
用预写文本归档，留在它自己的旧 Run 和分支上；sequence 25 = 验收 Run 的新 prompt），
A 一行未留，`next_sequence` 23 → 25 无缺口。

**第二次**在 code review 修复之后进行，由使用者确认通过。需要复跑是因为修复改变了这条
路径的行为：遇到对账的提交现在一律 drop 并退回草稿，且 `settlePending()` 会在同一次提交里
把档案中所有 pending 连续结清，而不是每条各挡一次。

**这次验收档案侧能证明的范围要说清楚**：复跑后档案没有新增任何行（仍是 21 entries /
4 boundaries / 0 pending、`next_sequence` 25）。这与「两条 pending 都选了『未进入』、
其后没有再提交被归档的 prompt」完全一致——`capture-begin` 不分配 sequence，`capture-abort`
删行，所以这样一轮本来就不留痕迹。因此第二次验收的依据是使用者的现场观察，档案只能证明
「没有留下未决 pending、没有产生多余 entry」，不能反过来证明每一步的呈现。后续若要更强的
证据，应让复跑以「已进入」收尾，从而留下一条可核对的 entry。

## Answer

未决 Pending Capture 现在是一个独立的、可持久的「待对账」状态，不再复用
`archiveUnavailable`。`$.store` 的 `prompt-history:reconcile:<projectId>` 保存
`{version, eventId, runId, branchId, parentEventId, attachmentCount}`——只有身份，没有任何
文本。键按 project 而非 Run，因为 pending 躺在项目档案里，重启进入新 Run 同样欠着这个答案。
`archiveUnavailable` 退回它本来的含义（档案真的不可用），归 Issue 25。

**档案侧新增两个原语。** `capture-list` 按 rowid 从旧到新列出未决 pending，只回身份，
固定最大批次 64 且协议上无法加大，`truncated` 说明还欠一次调用；只有 `lstat` 证明 ENOENT
才算「没建过库」而回空列表，属主错、权限放宽、类型不对的根一律以
`database-root-unavailable` 失败关闭。`capture-confirm … --pending` 用已预写在 pending 行里
的文本确认，这是重启后唯一可用的确认形式，原文因而继续只存在于 helper 内部。

**方向性同 Issue 14 一脉相承：不确定时不猜。** 自动对账只认两种无歧义形态——暂存文本在
`user` row 里恰好出现一次（确认），或一次都没出现且 transcript 短于 4096 条因而完整
（丢弃）；其余交给使用者。三个选项各自幂等：`已进入` 归档；`未进入` 丢弃；`新根分支`
**同样不归档**，只把 Active Branch 重置为新根。第三个选项正是「我也说不准」那一档，把它
实现成确认归档等于在不确定时猜它进入了，与本票据的核心承诺相悖；代价是它若确实进入过，
时间线会少一条——有损但不伪造。对话框被关闭或取消不是答案，保持阻止。被阻止的提交永远不会
被代为重发，草稿用 `$.prompt.fill()` 退回，退不回时文案如实说明。

**时序上有三处必须按这个顺序，否则会静默丢失事实**：对账要跑在 `archiveUnavailable`
短路**之前**（`beginCapture` 失败与 `next(e)` 抛出都是结果不确定的失败，档案里可能已经有行，
先看旗标会让它永远够不着，这两处 catch 还要重置 `pendingDiscovered`）；`新根分支` 要**先写
新根再 abort**（反过来则写失败时选择被静默丢弃）；发现的 pending 要**立即落盘**（否则确认
成功而分支写失败时，重启后 `capture-list` 已报空，那条 entry 会挂在错误的父节点下）。
结清一条 pending 后要重新问一次档案，直到报空为止——崩溃可能给每个 Run 各留一条。

已知欠账：Integrity gap 归 Issue 26、有界持久化时间线读取归 Issue 21、迁移前的完整性与
空间检查归 Issue 27。四条重复性清理见
`docs/code-review-backlog/20260922-reconciliation-duplication-batch.md`。
