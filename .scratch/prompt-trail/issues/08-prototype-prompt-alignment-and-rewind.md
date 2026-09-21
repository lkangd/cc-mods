# 原型验证 prompt 对齐与回退分支

Type: prototype
Status: resolved
Blocked by: 02, 06

## Question

Claude Code `2.1.273` 终端中，Prompt Event 是否与会话详情的人类输入 prompt 一一对应并排除内部 `user` role 流量；`ui.render(UserMessage)` 如何只绑定 Jump Target 而不造成 startup/resume/reload 重放重复；Run 能否跨 Mod reload 保持身份；`/rewind`、Esc Esc、`/fork` 与 resume 的事件序列能否可靠重建目标、分支和活动路径，无法自动重建时怎样触发人工目标确认？

## Comments

- 一次性实测资产：[`prompt-alignment-rewind` 原型](../prototypes/prompt-alignment-rewind/README.md)。插件已由 Claude Code `2.1.273` 的 `claude plugin validate` 验证通过；等待按 README 完成真人交互 trace 后再作决策。
- 已完成 4 个进程、startup/reload/rewind/Esc Esc/后台 fork/resume/CLI fork 的真人交互实测；原始证据位于原型的 [`traces/`](../prototypes/prompt-alignment-rewind/traces/) 目录，并捕获于 `research/prompt-alignment-rewind` 分支的 `21c98ce`。

## Answer

Claude Code `2.1.273` 的四份实测 trace 覆盖 4 个进程、2 个主进程 module instance、重复与多行 prompt、slash command、reload、`/rewind`、Esc Esc、后台 `/fork`、resume、CLI fork 和内部 task notification。决策如下：

1. **Prompt Entry 的唯一成员资格来源是成功进入会话的 `prompt.submit`，且输入 `e.origin.kind === "composer"`。** Hook 必须先调用 `next(e)`；仅当结果不是 `drop` 时，以结果中的最终文本写入一个 Prompt Entry。重复文本各产生独立事件，多行原文完整保留。实测中的普通 prompt 均一一对应，`/cost`、`/reload-plugins`、`/rewind` 和插件命令均未触发 `prompt.submit`。
2. **不得用 classic hook 或 transcript 的 `user` role 判定成员资格。** `classic.UserPromptSubmit.source` 在全部样本中均缺失；后台 fork 的内部 `<task-notification>` 同时触发 classic `UserPromptSubmit`、`prompt.submit(origin=task-notification)` 并进入 `$.session.messages()` 的普通 `user` row。只有 function-hook 的 origin 能可靠排除它。目标表面仅为终端，因此 `bridge` 等非 composer 来源不计入 MVP 人类 prompt 集合。
3. **`ui.render(UserMessage)` 只绑定 Jump Target，不创建 Prompt Entry。** 提交预览、slash command 和真实消息都会触发它；`requestId="placeholder"` 不是目标。两个相同 prompt 获得不同 UUID，而 reload、resume 和 fork 对共享历史的重放复用原 UUID，且不重放 `prompt.submit`。实现只把非 placeholder 的 render 按当前活动路径顺序与已有 Prompt Entry 对齐，在内存中绑定；无匹配项的命令行 row 忽略，`requestId` 不写入 SQLite。
4. **Run 使用“随机 Run UUID + 宿主进程世代”标识。** 同进程 reload 从 module M1 变为 M2，但宿主 PID 与 Run UUID 均保持不变；resume、后台 `/fork` 和 CLI fork 都启动新进程并获得新 Run。仅用环境变量不够，因为 fork 子进程会继承它；helper 必须读取实际宿主 PID（或等价进程世代 token），只有它与环境中的标记一致时才复用 Run UUID，否则创建新 Run。
5. **回退没有专用完成事件。** `/rewind` 只在打开菜单时产生 `command.run(rewind)`；选择 Restore conversation 不触发 lifecycle 或 `prompt.fill`。所选旧 prompt 被直接放入输入框。下一次 composer `prompt.submit` 之前，`$.session.messages()` 已反映缩短后的 transcript；本次选择较早的重复 prompt 后，前缀为空，新 `PT-C` 因而成为根节点。旧 `PT-A, PT-A, PT-B` 必须永久保留为非活动分支。
6. **Esc Esc 与 `/rewind` 共用 UI，但没有 `command.run` 信号。** 取消菜单不改变状态；若从该入口执行恢复，只能像普通 rewind 一样，在下一次 composer 提交时通过 transcript/活动路径差异发现。因此分支识别不得依赖 `command.run(rewind)`，它只可用于提前提示。
7. **Resume/fork 通过启动 source、session id 与共享前缀重建。** Resume 为新 Run、`classic.SessionStart(source=resume)`、沿用 session id；后台 `/fork` 与 `--fork-session` 为新 Run、新 session id、`source=fork`。共享历史只重放 UserMessage，不生成新 Prompt Entry；fork 参数在子会话中以 composer prompt 进入，应记录为新条目。父关系由已归档活动路径与启动时/提交前 transcript 的有序前缀唯一匹配，不能解析 task-notification 文本来猜。
8. **自动对齐只在候选父节点唯一时成立。** 比较完整有序前缀而不是只比较最后一条文本，因此正常重复 prompt 可区分；若多个历史分支具有相同前缀、内部 user row 与历史 prompt 冲突，或 transcript 无法唯一映射，则不得猜测。首次歧义 composer 提交应被 `drop`，保存其草稿于内存，打开聚焦的人工确认 UI，列出候选父 prompt 与“新根分支”；用户选择后用 `$.prompt.fill()` 恢复草稿并重新提交。具体 Pane/AbovePrompt 交互由《原型验证可滚动时间线》统一验证。
