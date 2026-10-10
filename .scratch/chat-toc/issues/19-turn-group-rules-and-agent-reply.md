# 19: 完整的开组规则与 Agent reply

**What to build:** 目录里的每个条目都完整反映一轮对话：斜杠命令和 `!cmd` 也各自成组，通知、命令输出、中断标记等归入当前组；Agent 侧显示步数和最后一段文字回复，进行中、中断、出错、无文字回复各有明确的字样。

规格见 [chat-toc MVP](../spec.md) §4、§7（卡片布局）。

**Blocked by:** 17（自动停靠的最小目录）

**Status:** resolved

- [x] 开组：human 文本或图片、斜杠命令 user 行、`system/local_command` 中带 `<command-name>` 的行、`<bash-input>`；排除 `isMeta`、`isCompactSummary`、tool_result
- [x] 不开组、归入当前组：task-notification、`<local-command-stdout|caveat>`、`<bash-stdout>`、`[Request interrupted by user…]`、compact 摘要、hook 与提醒
- [x] 用户侧文字：斜杠命令还原成 `/name args`，`!` 行写 `!cmd`，去掉代码块、图片、Markdown 记号与 `<pasted_content>` 标签、压缩空白，只有图片写「（只有图片）」
- [x] 步数 = 本组主循环 `tool_use` 块数（并行逐个计、子 agent 算 1 步、0 不显示）；末段 = 最后一个 `tool_use` 之后的 text 块，同一 `message.id` 拼成一段
- [x] Agent 侧：「N 步」加末段 2 行；「N 步 · 无文字回复」；「已中断 · N 步」；「出错 · N 步」；最后一组在 `turn.start`→`turn.complete` 之间为「进行中 · N 步」并实时增加
- [x] 只有用户侧的组（本地命令、无 agent 工作的 `!cmd`）不画 Agent 侧
- [x] 按终端单元宽度折行截断（全角 2 格，末行加 `…`），多行、CJK、emoji 都正确
- [x] 时间取 User input 行的 `timestamp` 转本地，格式「M月D日 HH:MM」，非今年加年份；去掉时间戳的 fixture 不显示时间
- [x] 子 agent 内容不进 TOC
- [x] 自动化测试覆盖 CT-TURN-001～005 与 CT-DATA-005 的规则

## Comments

2026-10-10，分支 `chat-toc/19-turn-rules`。

- **代码**：开组规则、用户侧文字、步数、末段、结局（`done`/`interrupted`/`error`）、`hasAgentReply` 都在 `hooks/groups.ts`，每组只看自己的行（开组行到下一开组行），所以 22 号的增量重组照常成立；`tests/incremental_regroup.test.ts` 的随机会话加进了命令、`!cmd`、中断与 API 错误行。卡片的 Agent 侧在 `hooks/entries.ts`（`agentHeadOf`）；空行只隔开组，不隔开同组两侧（`hooks/pane.tsx`）。
- **进行中**：`turn.start` 置位，不立刻重画，等本轮第一批行读进来再画，避免上一组闪一下「进行中」；`turn.complete` 之后要等下一次读完才清掉，避免末段还没读到时闪出「无文字回复」。热重载发生在一轮中间时，这一轮不再显示「进行中」，直到下一轮开始（模块状态）。
- **取舍**（规格没写死的地方）：
  - 文件里一个 assistant 行也没有、也没中断的组（刚提交、还没写入回复的 prompt）不画 Agent 侧；正在跑时画「↳ 进行中」。
  - 正常结束但 0 步的回复，头行只写「↳」，不补别的字。
  - 中断、出错、进行中的组若有末段，也照文件画末段 2 行（出错时通常就是 `API Error: …` 文字）。
  - 去 Markdown：单个 `*`/`_` 只在包住字词时才去掉，`*.md` 这类通配保留；纯代码块的输入退回显示代码本身；`[Image #n]` 占位一并去掉。
  - Agent 侧的跳转目标暂用末段所在行，没有末段就用本组最后一个 assistant 行，再没有就用开组行；完整的候选与被拒规则留给 23 号。
- **测试**：`claude plugin test mods/chat-toc` 80 个全过（2.1.295）；`tsc` 对 2.1.287 与 2.1.295 的声明都通过；两版 `plugin validate` 通过。
- **PTY**（cmux，独立 workspace，合成 transcript `scratchpad/p19/gen19.py`，其他插件关闭）：2.1.295 与 2.1.287 下 `--resume` 都看到：`/tui`（system 行）与 `!echo` 只有用户侧；`/review src/a.ts --quick` 还原；「↳ 3 步」+ 同一 message 两段拼接的末段；「↳ 2 步 · 无文字回复」；「↳ 已中断 · 1 步」；「↳ 出错 · 1 步」+ 错误文字；`<pasted_content>` 标签、代码块、Markdown 记号去掉，CJK/emoji 折行正确；通知之后的回复算本组末段；时间为本地「10月10日 09:01」。两版各跑一轮合成 prompt（haiku，3 次 `sleep 2`），看到「↳ 进行中」→「进行中 · 1 步」→「2 步」→「3 步」，结束后变成「↳ 3 步」+ `ok`。注意：cmux 发的滚轮序列会被当成 Escape，轮中滚动 Pane 会中断这一轮（第一次试跑因此被中断，目录如实显示「已中断 · 4 步」）。
