# 19: 完整的开组规则与 Agent reply

**What to build:** 目录里的每个条目都完整反映一轮对话：斜杠命令和 `!cmd` 也各自成组，通知、命令输出、中断标记等归入当前组；Agent 侧显示步数和最后一段文字回复，进行中、中断、出错、无文字回复各有明确的字样。

规格见 [chat-toc MVP](../spec.md) §4、§7（卡片布局）。

**Blocked by:** 17（自动停靠的最小目录）

**Status:** ready-for-agent

- [ ] 开组：human 文本或图片、斜杠命令 user 行、`system/local_command` 中带 `<command-name>` 的行、`<bash-input>`；排除 `isMeta`、`isCompactSummary`、tool_result
- [ ] 不开组、归入当前组：task-notification、`<local-command-stdout|caveat>`、`<bash-stdout>`、`[Request interrupted by user…]`、compact 摘要、hook 与提醒
- [ ] 用户侧文字：斜杠命令还原成 `/name args`，`!` 行写 `!cmd`，去掉代码块、图片、Markdown 记号与 `<pasted_content>` 标签、压缩空白，只有图片写「（只有图片）」
- [ ] 步数 = 本组主循环 `tool_use` 块数（并行逐个计、子 agent 算 1 步、0 不显示）；末段 = 最后一个 `tool_use` 之后的 text 块，同一 `message.id` 拼成一段
- [ ] Agent 侧：「N 步」加末段 2 行；「N 步 · 无文字回复」；「已中断 · N 步」；「出错 · N 步」；最后一组在 `turn.start`→`turn.complete` 之间为「进行中 · N 步」并实时增加
- [ ] 只有用户侧的组（本地命令、无 agent 工作的 `!cmd`）不画 Agent 侧
- [ ] 按终端单元宽度折行截断（全角 2 格，末行加 `…`），多行、CJK、emoji 都正确
- [ ] 时间取 User input 行的 `timestamp` 转本地，格式「M月D日 HH:MM」，非今年加年份；去掉时间戳的 fixture 不显示时间
- [ ] 子 agent 内容不进 TOC
- [ ] 自动化测试覆盖 CT-TURN-001～005 与 CT-DATA-005 的规则
