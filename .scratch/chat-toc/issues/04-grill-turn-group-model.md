# 定义 Turn group 的划分与边界

Type: grilling
Status: resolved
Blocked by: 01

## Question

基于宿主原语，Turn group 的确切划分规则是什么：哪些输入算 User input（斜杠命令、`!` shell、队列中被撤回的提交、粘贴附件占位文本、多行输入）；斜杠命令这类没有 agent 回复的输入如何成组与显示；Agent reply 的「最后一段文字」与「步数」的精确定义（含子 agent、并行工具、思考块）；进行中、中断、出错、无文字回复的状态；`/clear`、compact、rewind、resume、fork 后 Turn group 与 Jump target 如何重建与失效；不可跳转条目如何处理。另需定：时间显示的来源——公开 API 无时间戳，本进程内的轮可用 `$.clock.now()` 打点，resume 回来的历史轮无法在只用公开 API 的前提下得到时间，是否接受「新轮有时间、历史轮无时间」；resume 历史轮的步数与中断只能近似时如何显示；斜杠命令与 `!` shell 行没有 turn 事件时如何成组。

## Answer

**数据源：Transcript 以当前会话的 transcript 文件（`transcript_path`）为准**，与 cc-switch 一致。宿主事件只用作「该重读了」的触发和「进行中」判断；`$.session.messages()` 只作补充。依据是本机 167 个真实 transcript 文件（`~/.claude/projects/-Users-liangkangda-Fe-project-cc-mods/`，Claude Code 2.1.29x）的实测，以及 [研究 cc-switch 对话目录的交互细节](03-research-cc-switch-toc.md)。

### 读取

- **对话链**：从最新的叶子行沿 `parentUuid` 回溯，遇到 compact 边界（`system/compact_boundary`，`parentUuid:null`）时改沿 `logicalParentUuid`。rewind 在文件里追加一条新分支、不删除旧行，被抛弃的分支不在链上，自然不显示。实测样本 `6ca4d0f5…` 里 17 个 prompt 中有 2 个是被弃的分支。
- **子 agent** 写在单独的文件里，主文件只含主循环（实测 `isSidechain` 全为 false）。
- **大文件**：本机最大的 transcript 有 20 MB，而 `$.fs.read` 只能整份读、超过 4 MiB 就 reject，没有按位置读或 watch 的接口。文件只追加，所以记下字节偏移、每次只读新增；发现文件变小就整份重读。超过 4 MiB 时用 `$.process.run` 分块读（stdout 上限也是 4 MiB），块边界截到最后一个换行：
  - macOS/Linux：`tail -c +N | head -c M`；
  - Windows：用系统自带的 Windows PowerShell 5.1 以 `[IO.File]` 按偏移读、base64 输出，不需要自带工具。
- 文件读不到、格式对不上时，Pane 里说明原因，不显示伪造的内容。

### Turn group

- **开新组**的行：`type:user`，不是 `isMeta`、`isCompactSummary` 或 tool_result，并且是以下之一：
  - `origin.kind:"human"` 的文本或图片（`promptSource` 为 `typed`、`queued`、`suggestion_accepted`）；
  - 斜杠命令行（`<command-name>`；prompt 型命令带 `origin:human`，本地命令的 origin 为 null）；
  - `<bash-input>`。
  `!cmd` 开新组，这一点与 cc-switch 不同，依据是 map 的已定口径「回车上屏的任何内容」。
- **不开组、归入当前组**：task-notification、`<local-command-stdout|caveat>`、`<bash-stdout>`、`[Request interrupted by user…]`、compact 摘要、hook 与提醒（isMeta）。所以排队提交自成一组，后台任务通知、`/loop` 触发引起的 agent 工作并入前一组。
- **用户侧**：斜杠命令还原成 `/name args`；`!` 行显示 `!cmd`；普通文本照 cc-switch 去掉代码块、图片与 Markdown 记号、压缩空白，最多 2 行；只有图片时写「（只有图片）」。
- **时间**：取 User input 行的 `timestamp`（UTC ISO，转本地时间），resume 的历史轮同样准确。格式照 cc-switch：「M月D日 HH:MM」，不是今年的加年份。
- **步数**：本组内主循环 assistant 行里的 `tool_use` 块数。并行调用逐个计，一次 Agent 调用算 1 步，思考和中间文字不计，0 不显示。不照搬 cc-switch 的混合口径。
- **末段文字**：本组最后一个 `tool_use` 之后的 text 块，同一 `message.id` 的多个块拼成一段。没有就显示「N 步 · 无文字回复」。
- **只有用户侧的组**：本地斜杠命令和 `!cmd` 没有 agent 工作，只显示用户侧；View filter 选「Agent」时整组隐藏。
- **状态**：
  - 中断：组内出现 `[Request interrupted by user` 行，显示「已中断 · N 步」。文件里有这个标记，所以历史轮也一样精确。
  - 出错：组内最后一条 assistant 行带 `isApiErrorMessage`，显示「出错 · N 步」。单个工具失败不标。
  - 进行中：文件是异步写入的，会落后，所以只对最后一组用宿主的 `turn.start` 到 `turn.complete` 判断，显示「进行中 · N 步」。

### 生命周期

- **rewind 与 resume**：按对话链重建，不依赖 prompt-history 那套绕行办法。
- **compact**：文件仍保留压缩前的行，所以压缩前的组照常显示。
- **`/clear`**：宿主换成新会话、写新文件（文件以 `/clear` 命令行开头），目录跟着清空重建，不画分隔线。
- **Jump target**：文件行的 `uuid` 或 `message.id` 与 `ui.render` 的 `requestId` 怎么对应，留给原型实测。条目照常显示；对应不上，或对应的行没被画出、跳转被拒时，点击在 Pane 内显示一行说明，不能静默没反应。

### 对 map 的改动

- Notes「只用公开 API」放宽为：允许读当前会话的 transcript 文件，它的格式没有公开。
- compact 后改为照常显示压缩前的组；`/clear` 改为重建、不画分隔线。
- `CONTEXT.md` 新增 Transcript，并改正 Agent reply 的步数口径。

## 后续修订

- 「原型验证停靠 TOC Pane 的外观与交互」实测：本地斜杠命令在 2.1.295 记成 `system/local_command` 行，带 `<command-name>` 的那一行开组，输出行归入该组。见 [05](05-prototype-toc-pane.md)。
- 「实测长会话的读取与渲染开销」实测：macOS 的 `tail -c +N` 每 4 MB 要 140–260 ms，macOS/Linux 的分块读取改用 `{ dd bs=1 skip=N count=0; head -c M; } < file`（逐字节相同，快约 10 倍）；文件只增长时只重组末组。见 [12](12-task-measure-long-session.md)。
