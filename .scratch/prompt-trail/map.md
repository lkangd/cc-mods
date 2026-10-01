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
- [对账中断的 Pending Capture](issues/15-reconcile-pending-capture.md)：未决 Pending Capture 成为独立的持久「待对账」状态（`$.store` 的 `prompt-trail:reconcile:<projectId>`，只存身份不存文本，按 project 键以跨重启；Issue 50 起改为按 Run 存放，旧键只读），`archiveUnavailable` 退回「档案真的不可用」的本义。档案侧新增 `capture-list`（只回身份、固定最大批次 64、只有 ENOENT 才算空、不可信的根失败关闭）与 `capture-confirm --pending`（用预写文本确认，重启后唯一可用的形式，原文不出 helper）。自动对账只认两种无歧义形态：暂存文本在 `user` row 恰好出现一次，或一次未现且 transcript 完整；其余交给使用者三选一，`已进入` 归档、`未进入` 丢弃、`新根分支` 同样不归档只重置为新根——不确定时绝不猜成 Prompt Entry。取消不是答案、被阻止的提交不代为重发、草稿退不回时文案如实说明。时序不可调换：对账跑在 `archiveUnavailable` 短路之前，`新根分支` 先写新根再 abort，发现的 pending 立即落盘，结清一条后重新问档案直到报空。
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
  仍拿到新根分支，分支重建归 Issue 18**。`archiveGeneration` 是每个新 Run 随机生成的令牌
  （后续：Issue 28 起档案侧 generation 取活动文件身份；Issue 30 定下 locator 里这个字段只是不校验的 Run 令牌）。Run 边界是惰性的，event id 由 `sha256(kind:project:run)`
  派生；恢复队列的 16 条上限只约束 `clear`。`timeline-read` 是唯一可在 stdout 返回原文的子命令，
  固定只回最新 128 条、带 `truncated`；游标、窗口和 `truncated` 的 UI 归 Issue 21（backlog
  `20260922-bounded-persisted-timeline-view.md`）。只经 classic 事件到达的逻辑，`2.1.273` 的
  plugin test 触发不到，必须补静态检查或 PTY 验收。
- [Run 谱系跨 resume 延续](issues/32-run-lineage-across-resume.md)（从 Issue 18 拆出）：
  Run 改为会话谱系，**推翻了 Issue 17「新进程开新 Run」**。resume（`--resume`/`--continue`/会话内
  `/resume`）按 bridge 的会话索引找回 Run，找不到就新开；普通启动和 fork 仍开新 Run；进程内 `/resume`
  到别的 Run 的会话时，进程改绑到那个 Run。locator 按进程命名，并发 resume 同一会话时后到的进程
  新开 Run，「从 Run X 分出」由 `segmentId` 推导。边界是 `run-started/attached/detached`，且仍然惰性：
  不归档的进程（含已停用采集的）不留痕迹。恢复队列总上限 64。`clear-all` 一并删除不再继续的 Run 的会话索引记录，当前 Run 与仍在运行的 Run 保留（Issue 30）。
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
  过的 session 挂不上父节点，拆为 [Issue 34](issues/34-fork-of-compacted-session.md)（Issue 34 已修好：插件从 transcript 开头的 compact 摘要认出）；连续接续中间 session
  未提交时的继承缺口进了 backlog。
- [人工确认歧义父节点](issues/20-confirm-ambiguous-parent.md)：
  transcript 无法唯一确定父节点时，提交被 drop，草稿只留在内存，使用者在聚焦的「确认父节点」Pane 里选候选或新根；
  选定后先关 Pane 再 `$.prompt.fill()` 回填，从不自动重提。列出全部候选（取代 `$.ui.ask` 的 3 个上限）；关闭 Pane
  即取消并回填；等待中再次提交会重新对齐，最新文本取代草稿。对账（Issue 15）仍用 `$.ui.ask`。测试套件无法模拟
  使用者关闭 Pane，取消路径由真人 PTY 覆盖。窗口外已存父节点缺序号进了 backlog。
- [连续浏览 100,000 个 Timeline Events](issues/21-browse-long-timeline.md)：
  helper `timeline-read` 按 `before|after` 游标读固定 128 条批次，另附一条 overscan 和只含 id 的窗口上下文；插件只持有
  两批加一条（257 条），只画放得下的行，标题固定，方向键和触控板都能走到项目起点再回来；响应以 `earlier`/`later`
  **取代 Issue 17 的 `truncated`**。100,000 条时三项 helper 调用的 p95 为 73/260/155 ms。**修正 Issue 12**：显示序号改为项目级 Prompt Entry 序数。**修正 Issue 03**：Ghostty 的触控板会送
  `ui.scroll`，但只在 band 的树高于 `maxRows` 时送，且此时宿主必画 `n more`；插件用空白行占位让计数等于视图下方的
  真实行数，到底时树不超高、收不到触控板，由标题行提示点击上翻。`branch-match` 改为内存里自顶向下匹配。Gap 边界等
  Issue 26，跨窗口折叠计数和宿主 `n more` 限制进了 backlog。
- [绑定和失效 Jump Target](issues/22-bind-jump-targets.md)：
  当前 transcript 仍画着的 Prompt Entry 点击或 Enter 即跳回原行并收起 band，焦点回到输入框；没有目标的条目变暗并加
  `×`，**偏离规格**：有效条目不加 `↵`。绑定只存在内存：插件记下 composer 渲染行，由 `branch-match --rows` 在两种嵌入一致时
  报出每行对应的条目；rewind、clear 没有信号，靠读 `messages()` 剪掉末尾消失的行，展开时借 band 与 `PromptHint` 的重画
  重查。门禁当前版本改为 2.1.283。**修正 Issue 13**：排队的提交在 `next(e)` 返回时尚未进入对话，可能被撤回，拆为
  [Issue 35](issues/35-queued-submission-withdrawn.md)。
- [在终端限制下保持时间线可用](issues/23-terminal-fallbacks.md)：
  支持路径是方向键、Enter、点击和 PageUp/PageDown；标题行常驻 `ctrl+x tab 键盘选择`；视图上方还有行时，两种状态下都有
  向上翻页的按钮。按字素簇计宽，保证每行只占一行（`hooks/cells.ts`）。低于 28 列或 6 行时只剩标题和「空间不足」，
  状态保留。AskUserQuestion 的 `tool.call` 期间让出 band。**修正 Issue 21**：「树不超高时宿主不送 `ui.scroll`」
  只适用于方向键和触控板，页键在底部同样会送。Home/End 到不了最前或最后，不承诺；宿主的其他对话框和第三方插件争用
  槽位记为兼容限制。
- [隔离项目并支持并发 Run](issues/24-project-isolation-concurrent-runs.md)：
  物理隔离前序票据已经做到，本票补测。项目根抽成纯函数：调用 git 时去掉 `GIT_*` 重定向变量，git 以任何原因失败时往上查 `.git`，
  查不到就用启动目录。**修正 Issue 15**：`capture-list` 新增调用方 Run 参数，响应新增 `skipped`，单次最多扫描 256 行；它不再列出别的存活 Run 的 pending，只计入 `skipped`，并且有 `skipped` 时下次提交会重新列出。两个 Run 同时结清同一条
  pending 时先到者生效。**修正 Issue 12**：consent 每次都从 `$.store` 刷新，并发询问时先答者生效，后答者收到 toast。宿主事实：
  `$.store` 跨进程实时共享。band 展开时一律重读最新一批，本 Run 起点之后，其他 Run 折叠成「另一 Run · N 条」。24 个并发 writer
  的 sequence 无缺无重。起点之前的并发边界无法区分，进了 backlog。
- [Archive unavailable 时失败关闭](issues/25-fail-closed-archive-unavailable.md)：
  helper 每次调用共用 8 秒 busy 预算，超时报 `archive-busy`；写满报 `archive-full`，事务完整回滚；`capture-begin` 报低空间。
  档案本身的故障写入按项目划分的共享记录，其他 Run 每次操作都重新读取，读到就不经尝试直接拦下提交；locator、helper、preflight
  故障只影响本 Run，只记在内存。任何成功写入都会解除共享记录（损坏除外，见 Issue 51）。被拦下的提交只给「重试」和「禁用当前 Run 后继续」两个选择，
  关闭对话框即恢复草稿。`status` 显示范围、类别和磁盘空间，band 标题显示「档案不可用」。顺带修了新档案切换 WAL、
  并发创建 archives 目录这两个原有竞争。读命令也要拿写锁，进了 backlog（已由 Issue 27 解决）。
- [安全迁移档案 schema](issues/27-safe-schema-migration.md)：
  高于 2 的 schema 在任何写入和加锁之前就被拒绝。`1->2` 迁移在一个写事务里依次做完整性检查、空间检查（≥ 2 × 档案 + WAL + 16 MiB），
  在同目录写出逐字节一致、0600 的 `.pre-migration-v1` 备份，迁移后以完整性检查加逐行比对复检，通过才提交；下一次成功打开时
  `quick_check` 通过才删除备份，删不掉就保持 Archive unavailable。helper 从不用备份覆盖活动库，中断靠事务回滚。读命令不再
  拿写锁。新增 `archive-read-only`、`archive-integrity`、`migration-backup`、`migration-verify`、`migration-backup-cleanup`
  五个共享故障类别。100k 条目、403 MiB 的档案迁移耗时 2.61 秒。
- [隔离损坏的 Archive generation](issues/28-quarantine-corrupt-archive.md)：
  SQLite 撞上的损坏一律报 `archive-integrity`，并带上那份档案的 generation（活动文件的 dev/ino/birthtime，不改 schema）。
  被挡住的提交给三项：只读重新检查（主库和 WAL 字节不变）、把整组文件原样搬进 `archives/quarantine/<projectId>/<时间戳>-<随机>/`
  后在原路径换上只含 `archive-quarantined` 边界的新 generation，或禁用当前 Run。项目锁让隔离等在途命令结束；意向文件让中断的隔离
  拒绝一切打开，直到下一次隔离续做完成；多 Run 同时隔离只产生一个副本。`capture-begin` 带预期 generation，与
  `branch-match`、`timeline-read` 一起让别的 Run 在新 generation 里补写 `run-attached` 并从新根分支重来。`status` 列出隔离目录。
  `clear-run` 的拒绝与强确认清除转交 29、30。
- [原子清除 Project Timeline](issues/30-clear-project-timeline.md)：
  `/prompt-history clear-all` 展示范围（条数、文件、隔离档案、其他运行中的 Run、不能删除的副本），输入 `delete all prompts`
  才清除；损坏对话框也提供它。helper 在项目独占锁下写 `.clearing` 意向作为切点，删除本项目会话索引里不再继续的 Run、
  除 `.lock` 外的全部档案文件和隔离目录，原路径留空到下一次写入。删不掉就保持 `clear-unfinished`，下一次续做，不再要求短语。
  `boundary-append` 带预期 generation，lifecycle 队列记下事实发生时的 generation，旧 generation 的写入被丢弃。
  locator 与会话索引里的 `archiveGeneration` 只是历史遗留的 Run 令牌，不是 Archive generation。
- [物理清除当前 Run](issues/29-clear-run.md)：
  `/prompt-history clear-run` 展示当前 Run（整条会话谱系、接入次数、最早时间、条数、会断开的其他 Run 父链接），确认一次即清除。
  helper 在项目独占锁下写 `.clearing-run`（内含 Run id）作为切点，在原档案内删除三张表里该 Run 的全部行、把其他 Run 指向它的
  父链接置空，再 `VACUUM` 和 checkpoint(TRUNCATE)，WAL 为空、迁移备份删除后才删意向；generation 不变，sequence 留空洞。
  失败保持 `clear-run-unfinished`，任何 Run 可续做。有隔离档案时拒绝。`capture-begin` 预写前即校验父条目，插件遇到
  `capture-parent-unknown` 改新根重试。

- [记录并闭合 Integrity gap](issues/26-integrity-gap-recovery.md)：
  `integrity-gap` 与 `integrity-recovery` 是按 Run 归属的两种边界。恢复队列溢出、记录损坏、只见 `source=clear` 的开始，以及
  generation 无法确定的队列项（不再回放），都转成该 Run 欠的 gap；队列落档后、下一个 Prompt Entry 前写 gap，紧接着写恢复边界。
  fail-open 由 `$.store` 里不含原文的在途标记发现：pending 之前或 `/clear` 途中留下的记为 gap，pending 之后的交给对账；别的 Run 的
  标记只在它不再存活时判定（`archive-status` 新增 `liveRuns` 与 gap 计数）。停用时只写 gap，恢复边界在 `collection-resumed` 之后。
  清除随 Run 删除 gap。band 以黄色、不折叠显示，`status` 显示当前是否欠 gap 与档案里的 gap 数。
- [生成零跳过发布证据](issues/31-release-evidence.md)：
  `scripts/release-evidence.sh` 是唯一发布门禁：在 `2.1.273` 与当前版本上跑制品重建比对、plugin validate/test、TypeScript、
  unittest、helper 探针、100k benchmark、真实 PTY 场景与隐私扫描，按 `release/scenarios.json` 把 56 个场景 ID 逐条映射到
  「文件::测试名」、unittest id、门禁与 PTY 脚本，写出 JSON/Markdown 报告；零失败、零缺失、零跳过、零泄漏、非局部运行、工作树
  干净才判定通过。PTY 用 Python `pty` + pyte，在临时 HOME/`CLAUDE_CONFIG_DIR` 里以钥匙串专用条目中的 `setup-token` token 运行
  生产插件，只存脱敏后的屏幕快照；标记扫描匹配随机部分 ≥12 字符的前缀，档案 SQLite 族与宿主对话记录列入允许清单。
  宿主网络错误导致的失败整场重跑一次并写明。31 只带 `PT-COMPAT-001` 与 `PT-CAPTURE-001..008` 的 PTY，其余拆到 36–40，正式证据在 41。
- [以真实 PTY 证明生命周期与 Run 身份](issues/36-pty-lifecycle-run-identity.md)：
  `PT-LIFE-001..004` 与 `PT-STORE-001` 的 PTY 场景覆盖 `/clear`、`/compact`、`/reload-plugins`、`/exit` 后普通重启，
  以及 `--resume` 续接原 Run，在两个版本上通过。Run 与 generation 从 status 读，事件从 semantic verifier 读，焦点环按反色行判断。
  契约不再承诺 reload 后恢复选中位置：焦点一离开 band 就不保留，再进入时从最新条目开始。
- [以真实 PTY 证明分支与跳转](issues/37-pty-branch-jump.md)：
  `PT-BRANCH-001..004` 与 `PT-JUMP-001..002` 的 PTY 场景覆盖 `--continue`、`--resume`、会话内 `/resume`、并发 resume、
  后台 `/fork` 与 `--fork-session`、`/rewind` 与 Esc Esc、compact 后 resume 的父节点确认，以及有效与失效 Jump Target 的 Enter 和点击，
  在两个版本上通过。点击要先 hover；后台 `/fork` 的 daemon 活得比终端久，场景结束时要结束它并扫描它在 `/tmp` 下的目录。
  探测中发现两个缺陷，拆为 [Issue 42](issues/42-clear-before-first-write.md)（第一次提交前 `/clear` 记成 Integrity gap）
  与 [Issue 43](issues/43-jump-after-in-process-resume.md)（会话内 `/resume` 之后的新条目没有 Jump Target）。
- [第一次提交前 `/clear` 也记下 Clear Boundary](issues/42-clear-before-first-write.md)：
  函数 hook 的 `session.start` 早于 bridge 发布 locator，新进程在提交前不知道自己的 Run。生命周期事件遇到 Run 未知时先重读 locator，
  再决定是否暂存，于是普通启动或 `--resume` 后第一件事就 `/clear`，也恰好写入一个 Clear Boundary，不再记成 Integrity gap。`PT-LIFE-001` 扩展覆盖这两条路径。
- [会话内 `/resume` 之后的条目也能跳转](issues/43-jump-after-in-process-resume.md)：
  宿主在 resume 后用原来的 `requestId` 重放会话的行，插件却把本进程画过的行一直记为已消失，交给 helper 的行缺了祖先，新条目就绑不上。
  现在「已消失」只持续到下一个 classic SessionStart，之前那段「退出时重画」照旧不收，于是重放的历史和之后的新条目都能跳转，也收掉了 Issue 22 的已知代价。
  `PT-BRANCH-001` 扩展覆盖。
- [以真实 PTY 证明时间线 UI 场景](issues/38-pty-timeline-ui.md)：
  `PT-UI-001..008` 的 PTY 场景覆盖折叠与展开、顺序与边界颜色、新条目计数、键盘与点击遍历整条时间线、不发滚动时的点击降级、
  10 万条历史的端到端耗时（按键到画面 p95 ≤ 1 s）、28 列与 22 行的门槛，以及 AskUserQuestion 让出，在两个版本上通过。
  长历史直接用 `tests/timeline_fixture.py` 写入档案；颜色和反色从 pyte 单元格读。探测中发现两个缺陷，拆为 44、45，均已修好。
- [裸 `/prompt-history` 切换展开与折叠](issues/44-bare-command-toggles.md)：
  band 已展开时，裸命令折叠它并按 Run 保存，回复「已折叠」；折叠时照旧展开并回到最新。`PT-UI-001` 覆盖。
- [视图跟随焦点时不再丢方向键](issues/45-arrow-lost-after-view-follow.md)：
  2.1.273 偶尔拒绝 render 路径的 `$.ui.focus`（新帧还没提交），宿主又按位置保留焦点环，插件的 `ringKey` 就落后一行。
  现在插件把焦点送往哪一行，就先把 `ringKey` 设为那一行；被拒时隔 50 ms 重试，最多 3 次。`PT-UI-002/004/006` 在 2.1.273 上也通过。
- [以真实 PTY 证明控制、删除与安全场景](issues/40-pty-control-delete-security.md)：
  `PT-CONTROL-001..002`、`PT-DELETE-001..004` 与 `PT-SEC-001..004` 的 PTY 场景覆盖三种状态下的 status、首次 enable 先问 consent、
  disable 与带 pending 的重新 enable、按 Run 与全部清除（取消、错短语、隔离档案、无数据、WAL 残留与恢复）、删除边界告知、
  标记扫描自检、失败时的诊断、各阶段的私有权限，以及故障中没有编译、xattr、联网或自动删除，在两个版本上通过。
  故障全从外部注入：写坏表根页、`chflags uchg`、SQLite 写锁、下游 fixture 与替换临时副本里的 helper。
  探测中发现三处缺陷，拆为 46、47、48，均已修好。
- [status 显示活动档案的大小](issues/46-status-archive-size.md)：
  `archive-status` 多给 `archiveBytes`（`.sqlite3`、`-wal`、`-shm` 之和），status 写 `ready · <路径> · N bytes`，读不到时写 `size unknown`。
- [对账遇到损坏时给出损坏选项](issues/47-damage-during-reconciliation.md)：
  档案在预写之后才被发现损坏时，留下的 pending 让每次提交都停在「待对账」，拿不到损坏的四个选择。现在对账的 confirm 或 abort
  遇到损坏类失败，就按损坏处理并给出选择，`enable` 也说明档案已损坏。`clear-all` 留下残留时改说「逻辑删除已完成……但物理清除未完成」。
- [status 与清除回复不再误导](issues/48-misleading-status-and-clear-text.md)：
  status 显示完整的 generation（前 12 位只是设备号与 inode 高位，区分不了）；接着完成的清除读不到条数时不再说档案损坏；
  目标不受支持或 helper 不可用时，`archive:` 写 `unknown` 而不是 `not created`。
- [以真实 PTY 证明兼容与故障场景](issues/39-pty-compat-failures.md)：
  `PT-COMPAT-002/003/005`、`PT-STORE-002/003/006/008/009` 与 `PT-FAIL-001..006` 的 PTY 场景覆盖：
  - 不受支持的目标：2.1.272、Rosetta 下的 x64、没有 locator；
  - 六种不可信的 helper，以及 reload 后 helper 被替换；
  - 双 Run 并发、busy 的有界等待、损坏的三种选择、在途捕获遇到 `clear-all`、项目隔离；
  - 预写与确认失败、重试与禁用、宿主崩溃留下的 Gap 及其清除，以及一条真实宿主的故障巡回。

  在两个版本上通过。故障全从外部注入，hook 代码没有为注入而改；只能改代码造出的故障由 plugin test 与单测证明。
  探测中发现四处缺陷，拆为 49、50、51、52，均已修好。
- [helper 不可用时 status 不再执行 helper](issues/49-status-runs-untrusted-helper.md)：
  status 只在目标受支持时才向 helper 查询档案与 pending，不可用时 `pending reconciliation:` 写 `unknown`。
  原来一个被换掉、组可写或换成符号链接的 helper，只要执行一次 status 就会被运行。
- [另一个 Run 的 pending 不再被当成本 Run 的对账](issues/50-foreign-pending-adopted.md)：
  待对账记录按 Run 存放在 `$.store`，只接管本 Run 的；旧的按项目存放的记录只在属于本 Run 时接管。其他 Run 的 pending 交给 archive 列表，
  仍在运行的 Run 的 pending 不会被别人问起或丢弃。`clear-all` 忘掉所有 Run 的记录。
- [写入成功不再撤掉损坏报告](issues/51-write-lifts-damage-report.md)：
  记录里有损坏时，提交在对账、补写 lifecycle 与预写之前就给出损坏的选择；普通写入成功不撤掉损坏记录，只有重新检查通过、隔离或清除才撤掉。
- [档案拒绝写入时报 `archive-read-only`](issues/52-refused-write-called-conflict.md)：
  helper 把 `SQLITE_READONLY`、`SQLITE_PERM` 与 EPERM/EACCES/EROFS 的 I/O 错误归为 `archive-read-only`，作为共享故障记录在案；
  原来预写遇到它时报成 `capture-conflict`，只算本 Run 的失败。
- [0.1.0 发布门禁与证据](issues/41-release-0-1-0-evidence.md)：
  在提交 `b61296e` 的干净工作树上完整跑 `release-evidence.sh`，结果 PASS：56 个场景全部通过，0 失败、0 缺失、0 跳过、0 泄漏，
  52 个 PTY 场景在两个版本上都通过。报告、门禁日志与脱敏 trace 提交在 `mods/prompt-trail/release/evidence/0.1.0/`，
  提交前已把本机路径换成 `<repo>`、`<home>`、`<tmp>`。
- [fork compact 过的 session 时沿用来源的 Active Branch](issues/34-fork-of-compacted-session.md)：
  bridge 执行 SessionStart:fork 时，复制过来的行还没写到磁盘上（`--fork-session` 的文件到第一次提交时都还不存在），所以没有采用票面的 bridge 标记。
  改为插件对齐时识别：transcript 的第一行是宿主的 compact 摘要，就补写 compacted 键，按 `truncated` 匹配。
  后台 `/fork` 与 `--fork-session` 的第一条都挂在来源的最后一条上；`PT-BRANCH-002` 扩展覆盖。

## Not yet specified

<!-- 当前无尚不能精确成票据的范围。 -->

## Out of scope

- 搜索、复制和 `$.prompt.fill()` 回填旧 prompt。
- Desktop、VS Code、JetBrains、Mobile 等非终端表面。
- marketplace 发布、远程同步、网络访问和 prompt 日志。
- 修改 Claude Code transcript 文件或依赖 React/Ink、DOM、终端转义序列等内部实现。
