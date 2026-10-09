# 核实 transcript 行枚举与跳转原语

Type: research
Status: resolved
Blocked by: 

## Question

在 Claude Code `>=2.1.287`（对照本机 2.1.295）的公开 mods API 中，mod 能否：(1) 枚举当前 transcript 中主循环的 User input 行（含斜杠命令、`!` shell 等一切回车上屏的输入）与 assistant 文字行，并拿到每行可传给 `$.ui.scroll({ to: { requestId } })` 的身份；(2) 跳到 assistant 文字行而不只是 prompt 行；(3) 区分主循环与子 agent、区分系统注入的 user 行（task notification、hook 注入、compact 摘要）；(4) 统计一轮内的工具步数、判断一轮是否进行中或被中断；(5) 拿到每条消息的时间戳；(6) 得知 transcript 当前可视区域或滚动位置（决定 scroll-spy 能否做）；(7) 在 `/clear`、compact、rewind、resume 后得到可靠的变更通知。逐项给出事件/方法名、版本可用性（以 changelog 判断是否 2.1.287 即有）与必须靠原型实测的残余不确定点。

## Answer

研究文档在分支 `research/chat-toc-transcript-row-primitives`（不合并）的 `docs/research/chat-toc/01-transcript-row-primitives.md`，末尾有按风险排序的 7 项实测清单。版本判断：拿仓库里 2.1.273 与 2.1.290 的类型声明对比，2.1.273 已有的算「2.1.287 一定有」，只在 2.1.290 出现且未标版本的算「很可能有，未证实」。

1. **枚举与身份**：能，但只在行被画出时拿到。`ui.render` 的 `UserMessage`、`AssistantMessage`、`CommandOutput` 站点的 `e.requestId` 即 `$.ui.scroll` 目标；使用者输入靠 `props.origin.kind === 'composer'` 并排除 `placeholder`。`AssistantMessage` 按块绘制，一条回复多个 id（`isFirstOfReply`、`isSummary`）。`$.session.messages()` 的行无 id，只能按文本对齐。（一定有）待测：斜杠命令回显与 `!` shell 行由哪个站点画、带何 origin；长 resume 会话是否每行都至少画一次。
2. **跳到 assistant 行**：契约上可以，但只在使用者发起时（如 Button onPress）有效，否则 `{ deny: 'not person-initiated' }`。只有 prompt 行在 2.1.290 PTY 验证过；摘要块、折叠工具组、远端行、从停靠 Pane 发起都待测。
3. **主循环 vs 子 agent / 注入行**：绘制层无 `agentId`，但 `origin.kind`（`task-notification`、`peer`、`plugin`、`unclassified` 等）可区分大部分来源；`session.append` 的 `agentId`、`door`、`isMeta` 分得全（很可能有）。待测：子 agent、hook 注入、compact 摘要是否画进主 transcript。
4. **步数与状态**：本进程内的轮精确（`turn.start`、`turn.step`、按 `agentId`/`turnId` 计 `tool.call`、`turn.complete` 的 `reason`/`isAborted`，逐行 `ToolUse.isRunning`/`isInterrupted`）；resume 回来的历史轮只能从 `messages()` 的 `toolUses` 近似，中断无结构化字段。斜杠命令与 `!` 形成的轮没有 turn 事件。
5. **时间戳**：公开 API 不提供。替代：实时用 `$.clock.now()` 在 append/首次绘制时打点；历史只能读 `transcript_path` 的 JSONL（未公开格式，单文件 4 MiB 上限），违背「只用公开 API」。
6. **可视区域**：每个 transcript 站点有 `props.onScreen = { first, last, of }`（屏外 `null`，变化时重跑 render），可做 scroll-spy；仅全屏有。**最大风险**：2.1.273 无、2.1.290 有，文档与 changelog 都没提，2.1.287 有无未证实。
7. **变更通知**：`/clear`、resume 有 `session.end` 的 `reason`（很可能有）与 classic `SessionStart.source`（一定有）；compact 有 `session.compact` 与 classic `PreCompact`/`PostCompact`（一定有）；**rewind 无事件**，只能照 prompt-history 借 `PromptHint` 重绘重读 `messages()` 做文本对齐。离开会话时旧行可能重画，须在此期间忽略绘制。
