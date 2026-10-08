# 18: 在 resume 与 fork 中重建 Conversation Branch

**What to build:** 让 resume 在续接的 Run 中按唯一共享前缀重建 Active Branch，并让时间线与会话详情一致；让后台和 CLI fork 建立新的 Run 与 Conversation Branch，同时保留共享历史且不重复归档。

**Blocked by:** 13「严格匹配人类 composer 提交」、17「跨 reload 与重启维护 Run 身份」、32「Run 谱系跨 resume 延续」

**Status:** resolved

- [x] resume（`claude --resume`、`--continue`、会话内 `/resume`）续接 Issue 32 找回的 Run，并使用启动 source、classic session ID、已归档 Active Branch 与完整有序共享前缀确定唯一父节点；resume 目标会话 transcript 前缀的最后一条即 resume 节点。
- [x] resume 重放的共享 UserMessage 只重新绑定运行时状态，不创建重复 Prompt Entries。
- [x] 档案不删除任何记录。resume 节点之后、不在当前 Run 活动路径上的条目，在分叉点折叠为一行「另一分支 · N 条」，可以展开查看；其他 Run 的条目照常按 sequence 显示。
- [x] 后台 `/fork` 和 `--fork-session` 均创建新 Run、新 classic session 身份和新的 Conversation Branch。
- [x] fork 的共享前缀保持原事件身份；fork 参数若以成功的 composer submission 进入，则记录为新 Prompt Entry。
- [x] 内部 task notification 即使出现在 transcript 中也不参与人类 prompt 前缀或产生 Prompt Entry。
- [x] 匹配使用完整有序前缀而非最后一条文本，因此正常重复 prompt 可区分。
- [x] 无唯一候选时不猜测续接，保留所有旧分支：零候选开新根分支；本 session 无已存分支（fork 等）且多候选时开新根分支并在 Run 开始边界标注「共享前缀无法唯一确定」；已存 Active Branch 被 transcript 否定或并列时进入待人工父节点确认。（2026-09-23 修订，见 Comments。）
- [x] 时间线显示 Run 和 Conversation Branch 边界，并保持共享前缀只出现一次。
- [x] plugin test 使用记录的 resume/fork 事件序列验证状态转换；真实 PTY 覆盖进程内与跨进程 resume、后台 fork、CLI fork、重复文本前缀和分支折叠/展开。

## Comments

### 2026-09-23 · 边界对齐，拆出 Issue 32

与使用者对齐后：Run 改为会话谱系（resume 保持原 Run），这部分拆为 [Issue 32](32-run-lineage-across-resume.md) 先做，本票改为被 32 阻塞。本票保留分支重建与视图：
- 两种 resume 同样处理，都以 resume 目标会话的 transcript 前缀为准；不在该前缀上的本 Run 条目离开活动路径。
- 「对得上会话详情」由视图保证：离开活动路径的条目折叠为可展开的「另一分支 · N 条」，档案保持不可变（US28）。完整的分支浏览归 Issue 21/22。
- fork 不变。

### 2026-09-23 · 实现层面对齐（grilling 三轮，使用者均采用）

- **时机**：惰性，在 composer 提交前、Pending 对账与 lifecycle 补写之后、`capture-begin` 之前；每个进程接入的每个 session 只做一次。停用采集的 Run 跳过。失败时阻止提交并回填草稿。每次提交比对 transcript 差异归 Issue 19。
- **位置**：新增 helper 子命令 `branch-match`，transcript `user` 行（含空文本行、无 `toolResults`）经 stdin 按序传入，沿 `parent_event_id` 回溯比对；stdout 只回 `unique|none|ambiguous`、候选 event id 与 sequence，不带原文。helper protocol 不升（见下方「实现中修订」），schema 仍为 2。
- **匹配**：候选链按序为 U 的子序列即匹配（跳过 task notification、停用期间 prompt 等）；取链末对齐位置最靠后者，同位取链更长者；仍并列时，resume 若已存父节点在其中则选它，否则歧义。候选集：resume 为当前 Run 本 session 段的条目（段内为空时退回全项目），fork 为全项目。部分匹配（链头超出 U）只在 U 达 4096 行时接受。
- **落地**：已存状态带 `explicitRoot` 且父节点为空时不匹配、直接沿用（重新 enable、Pending「新根分支」、人工「新根分支」都会置此标记）。唯一匹配等于已存父节点沿用 branchId，否则开新 branchId。零候选静默开新根。本 session 无已存分支且多候选时开新根，带 `explicitRoot` 与 `rootReason: 'ambiguous-prefix'`，正常归档不询问（后台 fork 的参数自动提交，无人应答，不能阻止）。已存状态被否定或并列时人工确认。
- **人工确认**：沿用 `$.ui.ask` → drop → 回填草稿 → 使用者重新提交；最多列 3 个候选（已存父节点置首）加「新根分支」，其余候选在问题正文里计数（`$.ui.ask` 只收 2–4 个选项）；关闭/取消不算回答。选已存父节点沿用 branchId，选其他开新 branchId，选新根带 `explicitRoot`；写入 `$.store` 成功才算已对齐。Pane 形式待时间线 Pane 相关票统一。
- **视图**：`timeline-read` 加回 `branchId`、`parentEventId`。当前 Run 中 sequence 在活动路径首条本 Run 条目之后、不在活动路径上的 Prompt Entry 按分叉点分组（实现修订，见下），折叠为「另一分支 · N 条」（N 仅计 128 条窗口内）；折叠行支持方向键/Enter/鼠标展开收起，状态只在内存；边界事件不折叠。不新增 branch 事件：fork 的 Run 开始边界复用「从 Run X 分出」，来源优先取本 Run 首条 Prompt Entry 父节点所在 Run；歧义开根时标注「共享前缀无法唯一确定」（由 `$.store` 分支状态推导，该 session 换分支后标注随之消失，档案不受影响）。
- **范围**：Jump Target 重新绑定归 Issue 22；本票只补测试锁住「重放不产生重复 Prompt Entry」。`/compact` 后 `messages()` 的行为在真人 PTY 验收时实测；若旧行消失，resume 走人工确认，不会挂错。

### 2026-09-23 · 实现中修订（验收与 review 后）

以下与上方对齐结论不同，均已告知使用者：
- 人工确认最多列 3 个候选：`$.ui.ask` 只收 2–4 个选项。helper 仍最多回 8 个，并接受 `<prefer>` 参数：已存父节点在并列候选里时总排第一，不会被 8 个的上限挤掉。
- helper protocol 不升：新增子命令从来不升（`timeline-read`、`capture-list` 都没升），helper 本身已由 SHA-256 固定。
- U 保留空文本 `user` 行：只带附件的提交在档案里是无文本的 Prompt Entry，也要能匹配。
- 「有无已存分支」按 `parentEventId` 是否非空判断：写边界时会先惰性建一条父节点为空的记录。
- 折叠下界取活动路径上最早的本 Run 条目，而不是 resume 节点：resume 节点没有持久化，而且下一次提交后 tip 就会前移。按这个下界，从活动路径分出的条目都会在各自的分叉点折叠；同一 Run 在活动路径开始之前的条目（`/clear` 之前的段）不会折叠。
- 2.1.280 上 function hook 的 `session.start` 可能早于 bridge 发布 locator（后台 `/fork` 约早 1 秒自动提交，`/fork` 接续的主线程约晚 10 秒才发布）：提交时若还没有本 session 的 Run 身份，就重读 locator，每 200ms 一次，最多约 2 秒，每个 session 只等一次；时间线改为未读时补读。门禁当前版本改为 2.1.280。
- `/fork` 接续出来的 session 会被 bridge 新开 Run，拆为 [Issue 33](33-continued-session-keeps-run.md)。

## Answer

resume 与 fork 现在都会在 session 的第一次采集前，用 transcript 重建 Active Branch；决定都放在纯函数模块 `hooks/branch.ts` 里，helper 新增的 `branch-match` 负责匹配，只回 event id，不回原文。实现在 `c9854a7`，与原对齐结论不同的地方见上方「实现中修订」。

- **匹配**：候选链按序是 transcript `user` 行的子序列即算匹配，task notification 和停用期间的 prompt 会被跳过。取自身所在行最靠后者，同位取链更长者。resume 先在本 session 段内找，fork 或还没有分支链的 session 在全项目找。
- **落地**：transcript 证明到的父节点直接沿用；已存分支链被 transcript 否定或出现并列时，用 `$.ui.ask` 请使用者确认，本次提交 drop 并回填草稿，不自动重提。新 session 零候选时静默开根；fork 多候选时开根，并在时间线上标注「共享前缀无法唯一确定」。
- **视图**：本 Run 离开活动路径的条目，在分叉点折叠成「另一分支 · N 条」，可以展开和收起，档案不删任何记录。fork 的 Run 开始边界显示「从 Run X 分出」，来源取自父链。
- **2.1.280 实机修正**：function hook 的 `session.start` 可能早于 locator 发布，所以提交时会短暂等待 locator，时间线也改为未读时补读。门禁当前版本改为 2.1.280。
- **给后续实现者**：
  - `/compact` 之后 `$.session.messages()` 里不再有 compact 之前的 user 行（PTY 实测），所以 compact 后 resume 会走人工确认。
  - `/fork` 接续出来的 session 会被新开 Run，归 [Issue 33](33-continued-session-keeps-run.md)。
  - 每次提交都比对 transcript 差异（rewind）归 Issue 19，Jump Target 归 Issue 22，窗口外的折叠与计数归 Issue 21。

一轮 `/code-review` 找到 20 条：修了 13 条（含 critical：SQLite 临时存储改为只在内存里，不再把原文写进临时文件）。2 条进 backlog：`20260922-bounded-persisted-timeline-view.md` 追加一节，另新建 `20260923-branch-match-repeated-prompt-cost.md`。3 条驳回，理由见 commit 说明。另有 1 条是旧原型会话写出的 trace，不属于本次改动。门禁：`2.1.273`/`2.1.280` 各 **179** 项 plugin tests、8 静态、22 bridge、**55** helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.280 上通过：进程内与跨进程 resume、折叠展开、重复文本、CLI fork、后台 fork、compact 后 resume；review 修复后也做了冒烟复验。
