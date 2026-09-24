# Prompt Trail MVP

## Destination

Prompt Trail MVP 的功能、数据、安全、兼容与验收决策全部落定，足以直接汇总成可交给实现者的规格与验收方案。

## Notes

- 后续交互与产物使用中文。
- 仓库承载多个 Claude Code mod；Prompt Trail 的独立插件根是 `mods/prompt-trail/`，首阶段仅通过该目录的 `--plugin-dir` 加载，不修改全局设置。
- 目标表面仅为 Claude Code `>=2.1.273` 交互式终端，使用 early-access function-hooks API；`2.1.273` 是最低兼容版本，不是精确版本锁。
- Prompt Trail 默认折叠；点击标题或 `/prompt-history` 展开。
- 时间线从旧到新，保留重复项；多行 prompt 以 `↵` 压成单行并按宽度截断。
- 鼠标点击或键盘激活可跳转；失效条目保留并标为不可跳转。
- 每个项目时间线在明确同意后，以独立 SQLite 永久、无上限保存各已启用 Run 的完整 prompt 文本；禁用区间与无法恢复的宿主级失效显式标界，不伪造完整性。
- 长历史采用连续的无限滚动体验，允许内部按需加载或虚拟化，不使用页码。
- 位于底部时跟随新条目；查看旧历史时保持位置并提示新条目。
- 不使用网络、prompt 日志、React/Ink 或其他第三方运行时依赖。
- 控制命令为 `/prompt-history enable|disable|status|clear-run|clear-all`；删除仅影响 Prompt Trail 存储。
- 领域术语见 [`CONTEXT.md`](../../mods/prompt-trail/CONTEXT.md)。
- 研究依据优先使用官方 Mods README、function-hook 声明、官方示例与 Claude Code `2.1.273` 本机行为。

## Decisions so far

- [核实生命周期、滚动与持久化原语](issues/01-verify-function-hook-primitives.md)：AbovePrompt 契约支持滚动时间线；clear 生命周期仍需实测；`$.store` 是 4 MiB 明文 JSON，不能承载永久无上限的完整 prompt 档案。
- [研究永久本地档案后端](issues/07-research-local-archive-backend.md)：官方没有满足全部要求的内建存储；推荐由 hook 通过 `$.process.run` 调用受信任的 SQLite helper，以事务、WAL、幂等键和项目 hash 管理档案。
- [决定持久时间线模型](issues/02-decide-persistent-timeline-model.md)：采用项目级不可变 SQLite 事件流，Run 内分支与 Segment 建模；Prompt Event 必须与会话详情的人类 prompt 一一对应，render 只绑定临时跳转目标。
- [原型验证 clear 生命周期](issues/06-prototype-clear-lifecycle.md)：以 `SessionEnd(reason=clear)` 幂等写入唯一边界、以 `SessionStart(source=clear)` 关联新会话；compact、reload、退出与 UI 重放均可明确排除。
- [原型验证 prompt 对齐与回退分支](issues/08-prototype-prompt-alignment-and-rewind.md)：仅成功的 composer `prompt.submit` 创建 Prompt Entry；UI 只绑定临时目标，reload/resume/fork 通过进程世代、session source 与活动前缀重建，歧义时阻止提交并要求人工选父节点。
- [原型验证可滚动时间线](issues/03-prototype-scrollable-timeline.md)：采用折叠标题、带 overscan 的连续 `AbovePrompt` 列表及歧义确认 Pane；确认新条目、跳转、窄屏和 AskUserQuestion 让出，并把自动聚焦、Esc 折叠、Ghostty 触控板滚动及第三方槽位仲裁列为不保证的宿主限制。
- [原型验证 SQLite 档案 helper](issues/09-prototype-sqlite-helper.md)：SQLite 事务、并发、恢复、增量读取、迁移、物理删除与权限均成立；function hook 不能直接获得插件路径，MVP 改用经典 command hook 发布 locator 后再以 `$.process.run` 调 bundled helper，并需另定平台分发矩阵。
- [决定存储安全与故障策略](issues/04-decide-storage-safety-policy.md)：采用项目级明示同意、Run 级开关、每项目独立数据库、Pending Capture 与常规故障失败关闭；严格处理 locator、迁移、损坏、并发删除和物理清理，并把宿主级失效标为 Integrity Gap。
- [决定 helper 分发与平台兼容矩阵](issues/10-decide-helper-distribution-compatibility.md)：MVP 仅支持 macOS 15.x arm64、Claude Code `>=2.1.273` 与本地 `--plugin-dir`，随附预构建 helper 并动态链接系统 SQLite，以固定摘要和 Run 级 locator 绑定版本，低于最低版本、无法证明版本或其他不兼容均失败关闭。
- [定稿兼容与验收契约](issues/05-finalize-acceptance-contract.md)：以唯一支持矩阵中的零缺失、零跳过 MUST 门禁，锁定采集、生命周期、分支、长历史交互、故障恢复、删除与隐私场景；SQLite schema 保持内部，宿主限制预先列为不承诺。
- [可信启动并报告支持状态](issues/11-trusted-startup-status.md)：Prompt Trail 以 `mods/prompt-trail/` 为独立插件根，在 macOS 15.x arm64、Claude Code `>=2.1.273` 下通过可信 locator、预构建 helper 和只读 preflight 报告支持状态；真实 PTY 已验证成功启动、`/clear` 轮换、退出清理及版本/helper 摘要/protocol 主要拒绝路径。
- [同意采集并显示首个 Prompt Entry](issues/12-consent-first-prompt-entry.md)：首次 composer 提交前询问一次带 policy version 的 Collection consent；拒绝则 prompt 正常进入且零建档，启用则先预写 Pending Capture、`next(e)` 成功后原子确认为 Prompt Entry。prompt 原文只经 stdin 进 helper，consent 与 Archive unavailable 持久化在 `$.store` 以跨 reload 保持；展开后的显示序号是会话级、从 1 开始，项目级永久 sequence 只存在于档案内。
- [严格匹配人类 composer 提交](issues/13-strict-composer-capture.md)：成员资格只取决于 `origin.kind === 'composer'` 且 `next(e)` 成功返回文本的 `prompt.submit`，不看 classic hook、transcript `user` row、`ui.render`，也不按 `/` 前缀过滤——slash 命令走 `command.run`，不经过 `prompt.submit`。重复文本按事件身份保持独立，宽字符与空行逐字保存，附件只留数量和宽泛类型，下游 drop 幂等丢弃 Pending Capture，render 重放不重复归档。宿主限制：`2.1.278` 把粘贴的附件替换成 `[Image #N]` 占位文本，故无文本 submission 不承诺出现。
- [切换 Run collection mode](issues/14-run-collection-mode.md)：Run collection mode 是 `$.store` 里 `prompt-trail:run-mode:<projectId>:<runId>` 的 Run 级记录，无记录即默认 `enabled`；disable 只停当前 Run 的后续采集，不删旧 Prompt Entries、不撤销 consent、不影响其他 Run。真实的开始/停止/恢复落在新的 `timeline_events` 表（schema 升到 2，旧库在写锁内判定并执行 `1->2` 迁移），边界不含文本、与 Prompt Entry 共用同一项目级 sequence 分配器，事件身份跨三张表唯一。方向性是核心：停用永远生效、边界写入随后尝试且失败如实说明；恢复必须先补上缺失的停止边界，补不上就拒绝恢复，且重置为新的根分支、不补录禁用期间的 prompt。preflight 不健康、未 consent、档案不可用或开关读不到一律失败关闭而非假装成功。迁移前的完整性/空间检查与备份留给 Issue 27，Pending Capture 对账留给 Issue 15。
- [对账中断的 Pending Capture](issues/15-reconcile-pending-capture.md)：未决 Pending Capture 成为独立的持久「待对账」状态（`$.store` 的 `prompt-trail:reconcile:<projectId>`，只存身份不存文本，按 project 键以跨重启），`archiveUnavailable` 退回「档案真的不可用」的本义。档案侧新增 `capture-list`（只回身份、固定最大批次 64、只有 ENOENT 才算空、不可信的根失败关闭）与 `capture-confirm --pending`（用预写文本确认，重启后唯一可用的形式，原文不出 helper）。自动对账只认两种无歧义形态：暂存文本在 `user` row 恰好出现一次，或一次未现且 transcript 完整；其余交给使用者三选一，`已进入` 归档、`未进入` 丢弃、`新根分支` 同样不归档只重置为新根——不确定时绝不猜成 Prompt Entry。取消不是答案、被阻止的提交不代为重发、草稿退不回时文案如实说明。时序不可调换：对账跑在 `archiveUnavailable` 短路之前，`新根分支` 先写新根再 abort，发现的 pending 立即落盘，结清一条后重新问档案直到报空。
- [以 Clear Boundary 划分 Conversation Segment](issues/16-clear-conversation-segment.md)：
  生命周期判断是独立于 `$` 的纯状态机（`hooks/lifecycle.ts`），只有
  `classic.SessionEnd(reason=clear)` 形成写入，幂等键从旧 classic session id 派生；
  Segment 与分支切换是既有 `(project, run, session)` 键控方案的自然结果，不需要新机制。
  新增的生命周期恢复队列按 **Run** 分键（不是按 project，避免并发 Run 互相覆盖），
  排在 `settlePending()` 之后、`archiveUnavailable` 之前清空，欠账先落盘再尝试写入。
  一轮 code review 抓到两条 critical（都是本票据引入的：project 级键的并发覆盖、
  先写后存的崩溃窗口）与一处队列补写会用错 Run 身份导致永久 `boundary-conflict` 的洞；
  10 条修复、2 条归 backlog（Integrity gap 归 Issue 26）、2 条部分驳回。
- [跨 reload 与重启维护 Run 身份](issues/17-run-identity-reload-restart.md)：
  Run = 随机 Run UUID + 宿主进程世代；reload 复用 Run，退出/重启/`startup`/`fork` 开新 Run，
  进程内 `/resume` 只在同一进程世代有前驱 locator 时继承 Run——**但 `/resume` 后的新 session
  仍拿到新根分支，分支重建归 Issue 18**。`archiveGeneration` 仍是占位，每个新 Run 随机生成，
  档案侧没有 generation（归 Issue 30）。Run 边界是惰性的，event id 由 `sha256(kind:project:run)`
  派生；恢复队列的 16 条上限只约束 `clear`。`timeline-read` 是唯一可在 stdout 返回原文的子命令，
  固定只回最新 128 条、带 `truncated`；游标、窗口和 `truncated` 的 UI 归 Issue 21（backlog
  `20260922-bounded-persisted-timeline-view.md`）。只经 classic 事件到达的逻辑，`2.1.273` 的
  plugin test 触发不到，必须补静态检查或 PTY 验收。
- [Run 谱系跨 resume 延续](issues/32-run-lineage-across-resume.md)（从 Issue 18 拆出）：
  Run 改为会话谱系，**推翻了 Issue 17「新进程开新 Run」**。resume（`--resume`/`--continue`/会话内
  `/resume`）按 bridge 的会话索引找回 Run，找不到就新开；普通启动和 fork 仍开新 Run；进程内 `/resume`
  到别的 Run 的会话时，进程改绑到那个 Run。locator 按进程命名，并发 resume 同一会话时后到的进程
  新开 Run，「从 Run X 分出」由 `segmentId` 推导。边界是 `run-started/attached/detached`，且仍然惰性：
  不归档的进程（含已停用采集的）不留痕迹。恢复队列总上限 64。`clear-all` 必须一并删除会话索引记录（Issue 30）。
  Issue 18 现在只剩分支重建和视图折叠（离开活动路径的条目折叠成「另一分支 · N 条」）。
- [在 resume 与 fork 中重建 Conversation Branch](issues/18-resume-fork-branches.md)：
  session 首次采集前用 transcript 的 `user` 行经 helper `branch-match` 对齐 Active Branch（只回 event id）；
  被否定的已存分支链由使用者确认，fork 多候选时开带标注的根，从不猜测。离开活动路径的条目在分叉点折叠成
  「另一分支 · N 条」。2.1.280 上 `session.start` 可能早于 locator：提交时短暂等待，时间线未读时补读，门禁改为 2.1.280。
  `/compact` 会清掉 `messages()` 里的旧 user 行。`/fork` 接续出的 session 被新开 Run，拆为
  [Issue 33](issues/33-continued-session-keeps-run.md)。窗口外折叠与重复 prompt 的匹配开销进了 backlog。
- [rewind 后建立新 Conversation Branch](issues/19-rewind-branch.md)：
  对齐改为每次提交：内存里的预检（上次采集的 prompt 是否仍在原行）挡掉绝大多数 helper 调用；rewind 由 transcript
  变化发现，不依赖任何信号。主对话 compact 写 per-session 的 `compacted` 标记：没有标记时 `none` 即 rewind 到根，
  直接开根；有标记时 `truncated` 匹配，`none` 仍询问。`branch-match` 的并列候选按已存父节点的祖先链裁决。
  视图从档案推导「新根分支 / 新分支」边界，不新增事件。**修正 Issue 18**：同一进程里 compact 后，`messages()`
  仍保留旧 prompt 行，只有跨进程 resume 才会丢失。
- [接续 session 沿用原 Run 与 Active Branch](issues/33-continued-session-keeps-run.md)：
  「转到后台」后在新进程里继续的 session（SessionStart source=`fork`，输入里没有来源），由 bridge 从同目录近期
  transcript 尾部的 `continued-in` 认出来源，沿用来源 Run，会话索引与 locator 带可选 `continuedFrom`；插件据此
  继承来源的分支记录与 compacted 标记。认不出就新开 Run，不猜测。**修正 Issue 18/32**：`continued-in` 来自
  转到后台而非 `/fork`，`/fork` 与 `--fork-session` 仍新开 Run。门禁当前版本改为 2.1.281。fork 一个 compact
  过的 session 挂不上父节点，拆为 [Issue 34](issues/34-fork-of-compacted-session.md)；连续接续中间 session
  未提交时的继承缺口进了 backlog。

## Not yet specified

<!-- 当前无尚不能精确成票据的范围。 -->

## Out of scope

- 搜索、复制和 `$.prompt.fill()` 回填旧 prompt。
- Desktop、VS Code、JetBrains、Mobile 等非终端表面。
- marketplace 发布、远程同步、网络访问和 prompt 日志。
- 修改 Claude Code transcript 文件或依赖 React/Ink、DOM、终端转义序列等内部实现。
