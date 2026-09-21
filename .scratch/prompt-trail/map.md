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

## Not yet specified

<!-- 当前无尚不能精确成票据的范围。 -->

## Out of scope

- 搜索、复制和 `$.prompt.fill()` 回填旧 prompt。
- Desktop、VS Code、JetBrains、Mobile 等非终端表面。
- marketplace 发布、远程同步、网络访问和 prompt 日志。
- 修改 Claude Code transcript 文件或依赖 React/Ink、DOM、终端转义序列等内部实现。
