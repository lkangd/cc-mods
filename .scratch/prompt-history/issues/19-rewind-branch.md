# 19: rewind 后建立新 Conversation Branch

**What to build:** 让 `/rewind` 或 Esc Esc 恢复旧对话位置后的下一次 composer submission 从正确父节点建立新 Conversation Branch，并永久保留原分支后续。

**Blocked by:** 13「严格匹配人类 composer 提交」、18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** resolved

- [x] `/rewind` 打开或取消菜单本身不写 Timeline Event，也不被当作恢复完成信号。
- [x] Esc Esc 没有 `command.run` 信号时，仍可在下一次 composer submission 前通过 transcript 与 Active Branch 差异识别已发生恢复。
- [x] 唯一匹配旧位置时，新 Prompt Entry 以所选历史 Prompt Entry 为逻辑父节点并创建新 Conversation Branch。
- [x] 原 Conversation Branch 的全部后续 Prompt Entries 保留为非活动分支，不删除、不改写、不重新排序。
- [x] 恢复到根位置时，下一次提交建立根 Conversation Branch，而不是猜测最近同文本 Prompt Entry。
- [x] 多个重复 prompt 通过完整有序前缀区分，不能仅比较最后文本。
- [x] 取消 rewind/Esc Esc 菜单且 transcript 未改变时，Active Branch 和下一次提交父节点保持不变。
- [x] 时间线显示新旧 branch 边界，并让两条分支可连续浏览。
- [x] plugin test 覆盖唯一、根、重复与取消场景；真实 PTY 覆盖 `/rewind` 和 Esc Esc 两个入口。

## Comments

### 2026-09-23 · 实现层面对齐（grilling 两轮，使用者均采用）

- **发现**：每个 module instance 在 session 里的第一次提交照 Issue 18 做完整对齐。此后每次采集成功，在内存里记下这条 prompt 将落在第几个 `user` 行（k）和它的原文（只在内存，不落盘、不进 argv 或日志）。下一次提交先做本地预检：`user` 行不少于 k+1 且第 k 行原文不变，就判定没有 rewind，跳过 helper；否则调 `branch-match` 并按 `settleBranch` 落地。`messages()` 到 4096 行上限时一律调 helper。预检只是过滤，误判只多一次 helper 调用。`/rewind` 的 `command.run` 不监听，打开或取消菜单不产生信号、不写事件。
- **compact 与根的区分**：监听主对话（无 `agentId`）的 `session.compact`，透传 `next(e)`，成功后写单独的键 `prompt-history:compacted:<project>:<session>`（布尔值，不含原文）。不论采集模式和 consent 都写；项目未识别时先记内存、识别后补写；写失败只保留内存，不阻止 compact。
  - 无标记：已存父节点且 helper 回 `none`，视为 rewind 到根（或停用期间的 prompt 之前），直接开新根，不询问。第一次对齐（resume、reload）同样适用。
  - 有标记：helper 以 `truncated` 模式匹配；`none` 仍走 Issue 18 的人工确认。
  - 残余风险：标记写失败后又重启，compact 可能被当成 rewind 到根，结果是静默开根、链接丢失，不会挂错父节点。
- **rewind 开的根**：普通 `{parentEventId: null}`，不带 `explicitRoot`，之后仍接受 transcript 修正。已有 `explicitRoot` 语义不变，在其第一次采集前 rewind 预检不推翻它。
- **重复 prompt**：helper 的 `<prefer>` 从「这一个 event」放宽为「这个 event 及其祖先链」。rewind 只截短 transcript，transcript 一定是活动链的前缀；并列候选里恰好一条在这条链上时回 `unique`，否则回 `ambiguous`，已存父节点所在候选排第一。argv 不变，helper protocol 不升。改了 helper 语义，需要一次真人 PTY 冒烟。
- **视图**：rewind 到中间位置沿用分叉点折叠「另一分支 · N 条」。rewind 到根时，本 Run 中不是 Run 或段首条、父节点为空的 Prompt Entry 前画 `—— 新根分支 ——`；父节点在别的 Run 时画 `—— 新分支 ——`；紧跟在 Run 开始、Clear、采集恢复等边界事件之后的条目不重复画。旧条目留在边界之上、不折叠。从档案推导，不新增事件，`timeline-read` 不改。
- **失败**：预检认定 transcript 变了之后，`messages()`、helper 或 store 写失败都阻止提交并回填草稿，不猜父节点。
- **留给真人 PTY 实测的事实**：compact 之后能否 rewind 到 compact 之前；rewind 菜单的「只恢复代码」「从这里总结」在 2.1.280 上是否触发 `session.compact`、是否改动 transcript；`/rewind` 与 Esc Esc 两个入口的实际行为。

### 2026-09-23 · 实现中修订

以下与上方对齐结论不同或是补充：
- **预检基线**：除了「采集成功后记下 prompt 落在第 k 行」，每次对齐落定（包括人工确认之后、`explicitRoot` 直接沿用时）也会在内存里记下当时 transcript 最后一个 person-side `user` 行。否则人工确认后重新提交时没有基线，会再问一次。transcript 为空时，基线视为永远保持。
- **`<prefer>` 并列**：已存父节点本身在并列候选里，现在直接回 `unique`（它就在自己的祖先链上）。所以「已存父节点排第一」的挪位逻辑不会再被用到，已删除。Issue 18 Comments 里「总排第一，不会被 8 个的上限挤掉」由此改为「直接胜出」。
- **compact 标记的触发**：只认主对话（无 `agentId`）、`trigger` 不是 `precompute`、结果带 `messages` 的 compact。`precompute` 只算不装。「预算好的 compaction 真正装上时，是否会以 `auto`/`manual` 再派发一次 `session.compact`」尚未核实，放进真人 PTY。
- **测试替身**：`tests/support.tsx` 新增 `transcript` 选项（一个活的数组，引擎接受的提交会追加成 `user` 行，测试可以截短它来模拟 rewind）。三条旧用例原先的 transcript 在提交后不增长，这是真实引擎不会出现的状态，已改用 `transcript`。plugin test 里 `$.session.compact` 要传完整事件输入（`trigger`、`messages`）。
- **视图边界**：`—— 共享前缀无法唯一确定，未接续 ——` 与新增的 `—— 新根分支 ——` / `—— 新分支 ——` 不会同时出现，前者优先。被折叠的条目不画边界。
- **本进程内的 compact**：compact 会清掉第 k 行，预检必然失败；如果照常走 helper，每次 compact 后的第一次提交都会被 `none` 加上 compacted 标记送去询问。所以本进程观察到的 compact 只重置预检基线，沿用 Active Branch，不调 helper。代价是：rewind 之后、提交之前如果恰好发生 compact，这次 rewind 会漏判。reload 或重启之后的第一次对齐不受影响，仍按 compacted 规则走 `truncated` 匹配。
- **PTY 实测（2.1.280，session `392fa4a8`）**：同一进程里 `/compact` 之后，`$.session.messages()` 仍然带着 compact 之前的 prompt 行，沿 compact 前后连成一条链。用真实档案重放 `branch-match` 可以证实：只给 compact 之后的 4 个 `user` 行（摘要、meta、`/compact` 命令与输出）会回 `none`；给整条链会唯一匹配到 G，与档案里 H' 的父节点一致。所以同一进程里 compact 之后再 rewind，也能直接接上正确的父节点，不会询问。Issue 18 测到的「旧行消失」只发生在跨进程 resume。「compacted 且 `none` → 询问」这条路径由 plugin test 覆盖，真人 PTY 没有再走（与 Issue 18 的「compact 后 resume → 确认」是同一路径）。

## Answer

每次 composer 提交前，都会检查 transcript 是否被 rewind 过；rewind 过就从 transcript 证明的父节点开新分支，原分支完整保留。实现在 `f555580`，与对齐结论不同的地方见上方「实现中修订」。

- **发现**：session 的第一次提交照 Issue 18 做完整对齐。之后在内存里记下上次采集的 prompt 落在第几个 person-side `user` 行，下一次提交只要这一行还在，就不调 helper。`/rewind` 与 Esc Esc 都不发信号，也都不需要信号。
- **根与 compact**：主对话的 compact 会写 `prompt-history:compacted:<project>:<session>`。没有这个标记时，transcript 对不上任何档案条目，说明 rewind 到了根，直接开新根，不询问；有标记时，按 `truncated` 模式匹配，匹配不上仍请使用者确认。本进程观察到的 compact 只重置预检基线。
- **重复 prompt**：并列候选里，如果恰好只有一条落在已存父节点的祖先链上，`branch-match` 就选它（rewind 后的 transcript 一定是活动链的前缀）。有两条都落在链上时，仍回 `ambiguous`：`truncated` 模式下，两次重复可能只是三次重复的末尾。argv 与 protocol 都没变。
- **视图**：rewind 到中间位置，沿用分叉点折叠；rewind 到根，时间线上画 `—— 新根分支 ——`，接到别的 Run 的条目上画 `—— 新分支 ——`，旧条目保留在上方。
- **给后续实现者**：
  - 同一进程里 compact 后，`messages()` 仍保留 compact 之前的 prompt 行；跨进程 resume 后则没有。
  - `lineage_winner()` 的开销与重复 prompt 的匹配开销同属 Issue 21 的规模问题，已追加到 backlog `20260923-branch-match-repeated-prompt-cost.md`。
  - 预计算的 compaction 真正装上时，是否会以非 `precompute` 的 trigger 再派发 `session.compact`，还没有核实。

一轮 `/code-review` 找到 9 条：
- **修了 6 条**，其中 major 1 条：活动链上有连续重复 prompt 时，`truncated` 模式下两条并列候选会同时落在祖先链上，原实现会取先遇到的那条，现在改回 `ambiguous`。
- **1 条进 backlog**：窗口外的跨 Run 父节点画不出「新分支」，记在 `20260922-bounded-persisted-timeline-view.md`。
- **驳回 2 条**，理由见 commit 说明。

门禁：`2.1.273`/`2.1.280` 各 **200** 项 plugin tests、8 静态、22 bridge、**57** helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.280 上通过：`/rewind` 与 Esc Esc 两个入口的中间位置 rewind、rewind 到根、重复文本、取消菜单、compact 后提交、compact 后 rewind。
