# chat-toc MVP

Status: ready-for-agent

> 由 [chat-toc 地图](map.md) 的 16 张决策票汇总而成。每条决定的依据与实测数字在对应票里，本文只写结论；括号里的票名指向出处。术语以 [`mods/chat-toc/CONTEXT.md`](../../mods/chat-toc/CONTEXT.md) 为准。

## Problem Statement

在 Claude Code 终端里进行长会话时，使用者看不到整段对话的形状：说过哪些话、Agent 每轮做了多少事、最后回了什么，都埋在不断增长的 transcript 里。想回到几十轮之前的某个 prompt 或某段回复，只能靠滚轮慢慢找。`/clear`、compact、rewind、resume 让「我现在看的是哪一轮」更难判断。

Claude Code 没有对话目录。公开的 mods API 也不直接提供这些：transcript 行只在被画出时才有可跳转的身份，没有时间戳，全屏 transcript 会虚拟化，rewind 没有事件，2.1.287 的 `Button` 只收 `label`。目录必须在这些边界之内做到准确：不能伪造时间或条目，不能静默地点了没反应，不能在高亮上误导人。

## Solution

chat-toc 是一个独立插件，插件根在 `mods/chat-toc/`，与 prompt-history 互不依赖、不共享代码和数据，可以同时启用。

它在交互式终端的全屏布局里，把一个 Pane 停靠在 transcript 右侧（`placement: 'dock'`）。这个 Pane 是**当前会话**的对话目录：每个条目是一个 Turn group（使用者的一次 User input 加上 Agent reply），按 Transcript 顺序排列。点击用户侧跳回该 prompt，点击 Agent 侧跳到本轮最后一段文字回复。青色高亮跟随 Current position，目录列表随之滚动。

数据来源是当前会话的 transcript 文件（`transcript_path`，格式未公开，这是对「只用公开 API」的唯一放宽），沿当前分支的对话链取行。插件不落盘、不建档案、不联网；`$.store` 只存 View filter 和 Layout 两个偏好。

支持矩阵：Claude Code `>=2.1.287`、交互式终端、全屏布局，OS 不限，`--plugin-dir` 与 marketplace 两种加载方式。自动弹出时不退回 inline 放置，不能停靠就在状态栏常驻说明；只有使用者用 `/chat-toc` 主动打开时，才照宿主的放置结果接受 inline。

## User Stories

1. 作为全屏终端里的使用者，我希望每次会话启动时目录自动停靠在右侧，以便不用记命令就能看到它。
2. 作为不想看到目录的使用者，我希望点 ✕ 后本会话不再弹出，以便它不反复打扰我。
3. 作为关掉过目录的使用者，我希望用 `/chat-toc` 随时重新打开并聚焦它，以便需要时找回。
4. 作为开始新会话的使用者，我希望下一次会话（包括 `/clear`、`/resume` 之后）目录再次自动弹出，以便「关闭」只作用于当前会话。
5. 作为终端太窄或没用全屏布局的使用者，我希望状态栏告诉我为什么没有目录、怎样才能看到，以便我不会以为插件坏了。
6. 作为长会话的使用者，我希望每个条目显示「你 · 时间」和我输入的前 2 行，以便一眼认出是哪一轮。
7. 作为使用者，我希望每轮的 Agent 侧显示「N 步」和最后一段文字回复的前 2 行，以便知道这一轮做了多少事、结论是什么。
8. 作为在 Agent 工作时看目录的使用者，我希望最后一轮显示「进行中 · N 步」并实时增加步数，以便知道它还在跑。
9. 作为使用者，我希望被中断或出错的轮显示「已中断」「出错」，没有文字回复的轮显示「无文字回复」，以便不把这些轮误当成正常完成。
10. 作为使用斜杠命令和 `!cmd` 的使用者，我希望它们也各自成为条目，以便目录反映我在输入框里敲过的一切。
11. 作为多次提交相同 prompt 的使用者，我希望每次提交都单独成为条目，以便目录不吞掉重复。
12. 作为使用者，我希望时间取自 transcript 本身，读不到就不显示，以便我看到的时间永远是真的。
13. 作为只想看自己说了什么（或只想看 Agent 回了什么）的使用者，我希望用「全部 / 用户 / Agent」三态过滤，并且这个选择跨会话记住。
14. 作为对排版有偏好的使用者，我希望在卡片、紧凑、时间轴三种 Layout 之间切换，并且跨会话记住，以便目录符合我的阅读习惯。
15. 作为使用者，我希望点击任意条目的用户侧就跳回那条 prompt，以便快速回到对话中的那个位置。
16. 作为使用者，我希望点击 Agent 侧就跳到那一轮最后一段文字回复，以便直接看结论。
17. 作为偏好键盘的使用者，我希望焦点在目录里时用 ↑↓ 选择、Enter 跳转，用 1/2/3 切过滤、`l` 切 Layout。
18. 作为在 transcript 里滚动的使用者，我希望目录高亮我当前看的那一轮，并且目录自动滚到它，以便我始终知道自己在哪儿。
19. 作为刚跳转过的使用者，我希望高亮停在我跳去的那一轮，直到我再次滚动，以便跳转有明确的反馈。
20. 作为手动翻目录的使用者，我希望手动滚动时目录暂停跟随并显示「暂停」，在我下次滚动 transcript 时恢复，以便我翻目录时不被拽回去。
21. 作为点到跳不过去的条目的使用者，我希望看到一行说明，并且这一侧随后变暗，以便知道不是我点错了。
22. 作为 compact 过的使用者，我希望 compact 之前的条目照常显示，以便目录不因为压缩而丢失历史。
23. 作为 rewind 过的使用者，我希望被抛弃的分支在下一次提交后从目录里消失，以便目录只反映当前分支。
24. 作为 resume 一个长会话的使用者，我希望目录与该会话一致，并且能跳到从没画出过的早期轮次。
25. 作为同时开着多个会话的使用者，我希望每个终端只显示自己的会话，以便不串台。
26. 作为同时用 `/diff` 等其他停靠 Pane 的使用者，我希望 chat-toc 按宿主的标签规则共存，不抢焦点，以便不打断我在用的那个 Pane。
27. 作为会话很长（20 MB 级 transcript）的使用者，我希望目录在几秒内出现、滚动和跳转都不卡、能到达首尾，以便长会话也能用。
28. 作为隐私敏感的使用者，我希望插件不在任何地方保存我的 prompt 内容，以便它只是一个只读的视图。
29. 作为 transcript 格式变化后的使用者，我希望目录告诉我「有 N 行无法识别」，以便知道目录可能不全。
30. 作为想安装的使用者，我希望根 README 写清楚环境要求、安装、操作、限制，以便判断它适不适合我。

## Implementation Decisions

### 1. 插件形态与支持矩阵

- 插件根 `mods/chat-toc/`，`plugin.json` 的 `name` 为 `chat-toc`，首个版本 `0.1.0`。与 prompt-history 不共享代码，需要的部分各写一份。（定稿兼容与验收契约；决定首个版本的发布形态与文档）
- 只用公开 mods API，唯一例外是读当前会话的 transcript 文件。宿主 API 事实以 `plugin-authoring` skill 写出的类型声明与 `~/.claude-code-docs/docs/plugins__mods__*.md` 为准。（地图 Notes）
- 承诺 Claude Code `>=2.1.287`。所用原语在 2.1.287 上都有，字段与 2.1.295 相同；2.1.295 新增的 `ui.notify`、`ui.selection`、`ui.fault`、`prompt.*`、`AssistantMessage.isSummary` 都不用。插件清单没有声明宿主最低版本的字段，所以不做运行时版本检测，只在 README 写明。（在 Claude Code 2.1.287 上核对关键 API；定稿兼容与验收契约）
- 实现时注意：`command.run` 的匹配器写 `{ command: 'chat-toc' }`，不是 `{ name }`；不要用 `h` 作局部变量名（会遮住 JSX 的 `h`）。（在 2.1.287 上核对关键 API；用只收 label 的 Button 画三种 Layout）

### 2. Pane 生命周期

- **自动打开**的时机：`session.start`（启动、热重载），以及 `classic.SessionStart` 且 `source` 为 `clear` 或 `resume` 时（`session.start` 在 `/clear` 时不触发）。三个条件都满足才打开：`viewport.isFullscreen` 为真；本会话没有被使用者关闭；`$.ui.panes()` 里还没有这个 Pane（热重载后 Pane 不会关，`session.start` 会再次触发）。（核实停靠 Pane 的生命周期与放置规则；决定与其他停靠 Pane 共存的行为）
- **自动弹出不接受 inline**：只在全屏时自动打开；`isPlaced:false` 时 Pane 保持等待、不画，状态栏常驻说明原因和满足条件的方法（例如「需要全屏布局」「终端再宽一些」），条件满足、Pane 停靠后清除说明（`$.ui.status(undefined)`）。阈值由宿主决定（未请求时 ≥144 列，请求过后 110 列），插件不写死列数。（地图 Notes；CT-COMPAT-003）
- **`/chat-toc` 时接受 inline**：使用者主动打开属于请求，宿主任意宽度都会放下 Pane，全屏下窄于 110 列（或非全屏）时放成 inline。这时照宿主的结果放，不关、不拦，状态栏照常说明怎样才能停靠。inline 形态下的排版、跟随与高亮不承诺。（2026-10-10 使用者确认）
- **停靠后被改成 inline**：自动弹出或停靠着的 Pane，在终端变窄后被宿主改成 inline（`$.ui.panes()` 里 `placement` 不再是 `dock`）时，由插件关闭（`origin` 为 `plugin`，不记「已关闭」）并显示状态栏说明，条件恢复后按自动打开的规则再打开。只有使用者用 `/chat-toc` 在不能停靠时打开的那一次 inline 例外。宿主在停靠后变窄时的实际行为没有实测过，在 CT-COMPAT-003 验收时取样确认。（2026-10-10 使用者确认）
- **关闭**：不设 `closeOnEscape`。只有 `e.id` 为本 Pane、`origin.kind === 'person'` 的 `ui.close` 才在 `$.state` 记「本会话已关闭」；别的 Pane 怎么关都不碰这个标记。`/clear`、`/resume` 时宿主会重置 `$.state`，所以之后会再次自动弹出，使用者已接受。（核实停靠 Pane 的生命周期与放置规则；原型验证停靠 TOC Pane 的外观与交互；决定与其他停靠 Pane 共存的行为）
- **`/chat-toc`**：没有参数，注册时加 `immediate: true`。Pane 关着就打开；已经开着（在前台或后台标签）就提到前台并 `focus: true`。它从不关闭 Pane，关闭只有 ✕ 一个入口。对已开着的 id 再 open 时若不切换标签，就退化为只聚焦。`focus` 只在输入框为空时生效。（决定 Layout 的切换入口与默认值；核实停靠 Pane 的生命周期与放置规则）
- **宽度**：用 `columns: 44` 请求宽度（取自原型，2026-10-10 使用者确认）；使用者调过的宽度优先。36–56 列都要可读。（原型验证停靠 TOC Pane 的外观与交互）
- **与其他停靠 Pane 共存**：完全照宿主的标签规则——新打开的 Pane 总在前台，chat-toc 自动弹出时也一样；被别的 Pane 挤到后台、或对方关闭后回到前台，chat-toc 都不做任何事，不用 `focus` 抢回，也不提示。后台标签不调 Pane 的 render hook，数据层照常更新；如果 Current position 在 chat-toc 不在前台时（`$.ui.panes()` 的 `isShown === false`）变了，就撤销跟随暂停，回到前台的第一帧即跟随。（决定与其他停靠 Pane 共存的行为，供 CT-COEX-001）

### 3. 读取 transcript

- **路径**：取自 classic 事件的 `transcript_path`。新会话在第一条消息之前文件还不存在，这是正常状态，不是读取失败。（在 2.1.287 上核对关键 API）
- **读取方式**：第一次读且文件 ≤4 MiB 时用 `$.fs.read`。其余情况用 `$.process.run` 从字节偏移分块读 4,000,000 B：
  - macOS/Linux：`sh -c '{ dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$3"; } < "$2"'`（`tail -c +N` 在 macOS 上太慢）；
  - Windows：系统自带的 Windows PowerShell 5.1，用 `[IO.File]` 按偏移读，base64 输出。
  - 每块截到最后一个换行，偏移加上保留部分的 UTF-8 字节数；文件变小就整份重读。单行超过一块（块里没有换行）时，按「无法识别的行」计数并跳过。
  （实测长会话的读取与渲染开销；定义 Turn group 的划分与边界）
- **触发与节流**：由 `session.append`（只看主循环，即没有 `agentId` 的行）和 `turn.complete` 触发；尾随 300 ms 读一次，正在读时合并成一次；`fs.stat` 大小没变就跳过；`turn.complete` 之后 +1.5 s 再查一次，兜住文件落后写入。不做周期轮询。（实测长会话的读取与渲染开销）
- **对话链**：从最新的叶子行沿 `parentUuid` 回溯；遇到 compact 边界（`system/compact_boundary`，`parentUuid: null`）改沿 `logicalParentUuid`。rewind 抛弃的分支不在链上。子 agent 写在单独的文件里，不读。（定义 Turn group 的划分与边界）
- **增量重组**：从新叶子往回走，碰到旧链末行，说明只在当前分支上增长，就保留旧链，从末组的开组行起重组；碰不到（rewind 的新分支、`/clear`）就整份重组。（实测长会话的读取与渲染开销）
- **失败**：文件读失败或没权限时，不显示任何条目，底部常驻原因；不拿 `$.session.messages()` 拼一份冒充完整的目录。遇到无法识别的行就跳过，底部说明「有 N 行无法识别，目录可能不完整」，N 是实际计数。文件还不存在时，正文只有一行「本会话还没有对话」。（定稿兼容与验收契约 CT-DATA-001～003）

### 4. Turn group

- **开新组**的行：`type:user`，不是 `isMeta`、`isCompactSummary` 或 tool_result，且是下列之一：
  - `origin.kind: "human"` 的文本或图片（`promptSource` 为 `typed`、`queued`、`suggestion_accepted`）；
  - 斜杠命令行（含 `<command-name>`；prompt 型命令带 `origin: human`，本地命令的 origin 为 null）；
  - `<bash-input>`（`!cmd`）。
  另外，`type: system, subtype: local_command` 中带 `<command-name>` 的行也开组，它的输出行归入该组。（定义 Turn group 的划分与边界；原型验证停靠 TOC Pane 的外观与交互）
- **不开组、归入当前组**：task-notification、`<local-command-stdout|caveat>`、`<bash-stdout>`、`[Request interrupted by user…]`、compact 摘要、hook 与提醒（isMeta）。所以排队提交自成一组，后台任务通知、`/loop` 触发的 agent 工作并入前一组。
- **用户侧文字**：斜杠命令还原成 `/name args`；`!` 行显示 `!cmd`；普通文本去掉代码块、图片与 Markdown 记号、`<pasted_content>` 标签，压缩空白；只有图片时写「（只有图片）」。
- **时间**：取 User input 行的 `timestamp`（UTC ISO，转本地时间），格式「M月D日 HH:MM」，不是今年的加年份；时间轴布局的左栏只写 `HH:MM`。读不到就不显示，不伪造。
- **步数**：本组内主循环 assistant 行里的 `tool_use` 块数。并行调用逐个计，一次子 agent 调用算 1 步，思考和中间文字不计，0 不显示。
- **末段文字**：本组最后一个 `tool_use` 之后的 text 块；同一 `message.id` 的多个块拼成一段。
- **Agent 侧状态**：
  - 正常：「N 步」加末段前 2 行；
  - 没有末段：「N 步 · 无文字回复」；
  - 中断（组内有 `[Request interrupted by user` 行）：「已中断 · N 步」；
  - 出错（组内最后一条 assistant 行带 `isApiErrorMessage`）：「出错 · N 步」，单个工具失败不标；
  - 进行中：只对最后一组，用宿主的 `turn.start` 到 `turn.complete` 判断，显示「进行中 · N 步」，步数实时增加。
- **只有用户侧的组**：本地斜杠命令和没有引起 agent 工作的 `!cmd` 只显示用户侧；View filter 选「Agent」时整组隐藏。
- **生命周期**：compact 前的组照常显示；`/clear` 后宿主写新文件，目录清空重建，不画分隔线；rewind 后的下一次提交，被弃分支的组消失（rewind 本身没有事件，提交之前的窗口里旧条目可能还在，使用者已接受）；resume、fork 后按对话链重建。

### 5. Jump target 与跳转

- **身份**：`ui.render` 的 `UserMessage`、`AssistantMessage`、`CommandOutput` 站点的 `e.requestId` 就是 transcript 行的 `uuid`（resume 后不变）。另外挂 `ToolGroup`（只读 `requestId` 和 `onScreen`，不改绘制）。`requestId` 为 `"placeholder"` 的一律忽略。render hook 是纯绘制，里面不能写 `$.state`。（实测 requestId 与 transcript 行身份的对应）
- **`requestId` → 行的匹配**，按顺序：精确匹配 uuid；去掉 `collapsed-` 前缀再匹配；按 tool_use id 匹配（非折叠时走 `ToolUse`）；按前 24 位匹配（`ToolGroup` 的 id 有时是 `collapsed-<uuid 前 24 位>000000000000`）。跳转时用宿主给的那个 id，不用 uuid。热重载后宿主先重画在屏行、后读完 transcript，所以映射在每次读完 transcript 后重做，增量读取时只为新行补前缀表、重试之前没解析出来的 id。（原型验证停靠 TOC Pane 的外观与交互；实测长会话的读取与渲染开销）
- **跳转目标**：用户侧是该组的开组行；Agent 侧是末段文字所在的行。Agent 侧没有末段（「无文字回复」、进行中还没有文字、中断）时，跳到本组最后一个可绘制行（`AssistantMessage` 或 `ToolGroup`），候选与被拒规则同兜底跳转；本组一个可绘制行都没有就按被拒处理（2026-10-10 使用者确认）。跳转只能由使用者发起（点击或 Enter）。`$.ui.scroll({ to: { requestId } })` 能跳到宿主消息列表里的任何一行，包括从没画出过的；直接跳转用 `block: 'start'`。（核实 transcript 行枚举与跳转原语；原型验证停靠 TOC Pane 的外观与交互）
- **兜底跳转**：本地命令的回显行、prompt 型命令的输入行、`!cmd` 的行在屏上看得见，但没有可挂钩的站点。这些用户侧跳到对话链中**往后**最近的可绘制行（user prompt、带文字的 assistant 行、非空的本地命令输出、画出过的行），往后没有就往前找，用 `block: 'center'`，让原输入行留在目标上方看得见；被拒就换下一个候选，最多 3 个。这算作跳到了该 prompt，条目样式不区分。（决定没有 Jump target 的条目侧如何呈现与点击，经原型修订）
- **被拒**：所有候选都被拒时（resume 前已被 compact 的行、rewind 残留），Pane 底部显示一行「这一条当前没有显示在对话里，无法跳转」，在下一次跳转、选择移动或约 5 秒后（`$.clock`）消失；这一侧随后淡化（所有行 `dimColor`），直到这一行重新被宿主列出。不事先淡化：虚拟化加热重载使「画出过没有」不能说明能不能跳。只陈述事实，不猜原因。（原型验证停靠 TOC Pane 的外观与交互，修订「决定没有 Jump target 的条目侧如何呈现与点击」）

### 6. Current position 与跟随

- **定义**：视口顶部那一行所属的 Turn group；最后一个画出的行完整可见（`last === of - 1`）时强制末组；跳转成功后锁定在目标组。该行不属于任何组（compact 摘要、hook 提示等）时，归到它前面最近的一组；前面没有组就不高亮。（决定是否做当前位置高亮，经原型修订）
- **计算**：只看 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolGroup` 的在屏上报，`ToolUse` 不参与。全屏 transcript 是虚拟化的，被卸掉的行不一定再报 `onScreen: null`，所以：
  - 报 `null` 的在屏记录直接删掉；
  - 可绘制行（站点行和画出过的行）按对话顺序存成有序数组，只在读完 transcript 和有新行画出时重建；
  - 把在屏行按对话顺序分段：两行之间只要夹着一个不在屏的可绘制行，就切开。只采信包含最近一次上报的那一段，取其中最靠前的行；夹没夹着用二分查找判断。
  （原型验证停靠 TOC Pane 的外观与交互；实测长会话的读取与渲染开销）
- **跳转后锁定**：跳转引起的重绘每次间隔不到 300 ms，期间保持锁定；重绘停下后，视口第一次变化就解锁，恢复按视口顶部计算。（原型验证停靠 TOC Pane 的外观与交互）
- **重绘 Pane**：transcript render hook 比较新旧 Current position，只有真的变了才 `$.clock.after(0, () => update($, atom, …))` 写一个 `$.state` atom，然后照常 `return next(e)`；Pane 的 render hook 读这个 atom。不要在 render hook 里直接写、不要用 `Promise.then` 写（偶发被拒），不要无条件 `invalidate`（会自循环）。这个 atom 是本进程的派生值，不持久化。（实测 Pane 随 Current position 重绘的方式）
- **TOC 跟随**：TOC 的滚动位置统一跟随高亮组（transcript 在底部时就停在最新）。使用者手动滚动 TOC，或 Pane 聚焦时，暂停跟随，底栏显示「暂停」；Current position 下一次变化时恢复跟随。滚动由插件自管：hook `ui.scroll` 返回 `{}` 自己维护偏移，不用 `$.ui.scroll({ to: 'end' })`（2.1.290 之前它会无限重绘）。（决定是否做当前位置高亮；核实停靠 Pane 的生命周期与放置规则）
- 高亮与 ↑↓ 选择光标相互独立，可以落在不同组上。

### 7. Pane 外观与交互

- **结构**，自上而下：过滤行（左边 View filter，右边「布局:<当前 Layout>」按钮，最右留约 3 列给 2.1.287 画在内容第一行的 ✕）；条目列表；底栏（不常驻，只在显示「暂停」、跳转被拒说明、数据源说明时出现）。2.1.287 的停靠 Pane 没有标题行，第 0 行就是正文；2.1.295 第 0 行是标题行，排版两版都要看。（决定 Layout 的切换入口与默认值；实测 Pane 随 Current position 重绘的方式）
- **View filter**：三个 `plain` Button，内容是单个字符串 `●全部`、`○用户`、`○Agent`（选中项是 `●`），热键 1/2/3；默认「全部」；切换后立即重画；选择写进 `$.store`，跨会话全局记住，值认不出时回到「全部」。（用只收 label 的 Button 画三种 Layout）
- **Layout**：默认卡片。唯一入口是过滤行右端一个 `plain` Button，文字为「布局:卡片」「布局:紧凑」「布局:时间轴」（显示当前的，不显示下一种）；点击它或 Pane 聚焦时按 `l`，按卡片 → 紧凑 → 时间轴 → 卡片循环。选择立即写进 `$.store`，写入失败时本次仍然切换；值认不出时回到卡片。切换时以选中的组（有选择光标时）或 Current position 所在组为锚，切换后锚定组留在可见窗口内，跟随或暂停的状态不变。不提供命令参数，不用 `v`。（决定 Layout 的切换入口与默认值，供 CT-UI-002）
- **三种 Layout 的画法**：每个条目画成一行 `Box`（row），左边是宽度统一的多行 `Text`（卡片和紧凑 2 列，时间轴 8 列：`HH:MM`、空格、`│`/`┃`、空格），右边是一列 Button。条目一侧的**每一行**是一个 `plain` Button，内容是这一行的字符串，同侧所有行共用一个 `onPress`；key 为 `<条目 key>` 和 `<条目 key>.<行号>`；`hover: { scope: 'e-<条目 key>', inverse: true }`，悬停时整侧一起反色。（用只收 label 的 Button 画三种 Layout）
  - **卡片**：头行「你 · M月D日 HH:MM」和「↳ N 步」（或状态）用 `dimColor`，下面各接最多 2 行正文；高亮是左栏的青色 `▌`。Agent 正文的缩进写在 Button 文字里。
  - **紧凑**：每侧一行，Agent 行整行 `dimColor`；高亮是青色 `●`。
  - **时间轴**：左栏是时间加 `│`，高亮时变青色 `┃`；Agent 行整行 `dimColor`。
  - 高亮不加粗（Button 没有 `bold`），只靠青色标记。
  - 换行和截断由插件自己算：按终端单元宽度折行（全角 2 格），第 2 行（紧凑是第 1 行）末尾加 `…`。Button 不会替你换行。
- **键盘**：Pane 聚焦时 ↑↓ 走宿主焦点环，焦点落在条目的第一行 Button（key 等于条目 key）；Enter 与点击相同；↑↓ 不跳过淡化的条目。1/2/3 切 View filter，`l` 切 Layout（Pane 内热键只能挂在画出的 Button 上，只在聚焦时生效）。选择光标是宿主的反色，与青色高亮一眼能分清。插件不能绑定 Tab 或方向键。（决定 Layout 的切换入口与默认值；用只收 label 的 Button 画三种 Layout）
- **长会话**：连续滚动、按需渲染、不分页。条目按组缓存（键是宽度、进行中、步数、状态、末段），只在数据、宽度、View filter、Layout 变化时重建条目表；高亮和光标在绘制时才叠加；只画可见窗口（一棵树最多画 100,000 字符）；组到条目的定位用表，不用 `findIndex`。（实测长会话的读取与渲染开销）

### 8. 隐私

- 不落盘、不建档案、不联网、没有采集同意流程。`$.store` 只存 View filter 和 Layout。prompt 原文只出现在 Pane 的绘制里，不进 `$.store`、插件数据目录、日志、错误文本和发布报告。（定稿兼容与验收契约 CT-SEC-001）

### 9. 性能（CT-PERF-001 阈值）

在参考机器（本机 macOS）上，用 20 MiB 的 many（4432 轮）和 heavy（111 轮、大工具结果）两种 fixture，两个版本各跑 3 次，取 p95（3 次时即最大值）：

| 项 | 阈值 |
|---|---|
| 首次出目录：TOC 比宿主 transcript 显示末轮晚 | ≤ 4 s |
| 空闲时整份读取加重组 | ≤ 1 s |
| 增量读取，单次 | ≤ 150 ms |
| 追加一行到目录模型更新 | ≤ 1 s |
| Pane 重画，插件自身计算 | ≤ 16 ms |
| Pane 重画，含等宿主 | ≤ 100 ms |
| Current position 每次计算 | ≤ 2 ms；3000 条残留在屏记录下 ≤ 5 ms |
| 长会话连续滚动、跳转到首组和末组 | 必须能到达，不分页 |

这些是发布证据，不是对所有硬件的 SLA。（实测长会话的读取与渲染开销）

### 10. 发布与文档

- **版本与证据**：首版 `0.1.0`，`plugin.json` 和 marketplace 条目两处都写。证据放 `mods/chat-toc/tests/evidence/<版本>/`，一个版本一个目录，每次改版本号都在新目录里重跑完整 MUST 门禁，旧目录不改；报告记录被测的提交哈希。目录里放 `report.md`（含人工目检签字）、`report.json`、`marketplace.md`；两个 Claude Code 版本合在一份报告里，按版本分列。不建 CHANGELOG。（决定首个版本的发布形态与文档）
- **marketplace 条目**：

  ```json
  {
    "name": "chat-toc",
    "source": "./mods/chat-toc",
    "description": "A docked table of contents of the current Claude Code session; jump to any turn.",
    "version": "0.1.0",
    "author": { "name": "chat-toc contributors" }
  }
  ```

  不加 `category`/`tags`，不提与 prompt-history 的关系。
- **发布动作**：插件代码可以先合进 main，但 marketplace 条目、根 README 一览表的一行和 chat-toc 一节、`evidence/0.1.0/` 要放在**同一个发布提交**里，在全部 MUST 通过后最后提交。不打 git tag。发布前用本地目录 marketplace 跑 CT-COMPAT-002 冒烟（两个版本）；推上去后从 `lkangd/cc-mods` 做一次安装级检查（添加、安装、版本号、enabled、Pane 弹出），结果补进 `marketplace.md`；失败就撤回发布提交。
- **根 README**：开头改成「每个 mod 是独立插件，互不依赖、不共享代码与数据，可以同时启用」；一览表新增 `chat-toc | 0.1.0 | 在对话右侧停靠当前会话的目录，点击跳回任意一轮`；新增与 prompt-history 同级的 chat-toc 一节，开头一句写两者的区别（chat-toc 什么都不保存、只显示当前会话；prompt-history 保存 prompt 原文档案；两者可以同时启用，一个在输入框上方，一个停靠在右侧），然后依次是：作用、环境要求（`>=2.1.287`、交互式终端、全屏、终端足够宽、**不需要** `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`、OS 不限但只在 macOS 实测）、安装（二选一不同时启用）、快速开始、操作（表格）、显示规则、数据与隐私、卸载（含残留 `$.store` 文件位置）、已知限制（即下文 Out of Scope 中的「不承诺」八条，改写成面向使用者的话）、开发（链接与 0.1.0 通过结果）。用界面上的字，不用 Turn group、Current position 等内部术语。
- **`mods/chat-toc/README.md`**：只写开发者内容：链接到根 README 和 `CONTEXT.md`；目录结构；本地加载；`claude plugin test` 的跑法；cmux PTY 验收；证据目录约定；发布清单（两个版本跑全部 MUST → 本地目录 marketplace 冒烟 → 人工目检签字 → 发布提交 → GitHub 安装级检查 → 失败就撤回）。

## Testing Decisions

1. **规范等级与门禁**（定稿兼容与验收契约）
   - MUST 是发布阻断：任一场景失败、缺失、跳过，或没有可追溯证据，都不能发布。「明确降级」的替代路径本身也是 MUST。「不承诺」必须事先写进 README 或界面提示。
   - 每次发布在本机 macOS 上分别用 2.1.287 和当时的当前版本跑一遍全部 MUST；完整场景用 `--plugin-dir`，marketplace 只跑 CT-COMPAT-002 冒烟。报告记录 OS 和架构，只作样本。
   - 场景 ID 格式 `CT-<组>-NNN`；完整清单（COMPAT 001–003、DATA 001–006、TURN 001–005、LIFE 001–006、UI 001–003、JUMP 001–003、POS 001–003、PERF 001、SEC 001、COEX 001）以「定稿兼容与验收契约」§4 为准，本文不复写。

2. **第一层：自动化测试（`claude plugin test`）**
   - 用 `claude plugin test` 和 `claude-code/testing` test kit 触发事件、给宿主调用打桩、检查绘制结果；纯函数用同一套件的普通 `test()`。只要求在当前版本上通过。
   - 覆盖：开组规则（含 `system/local_command`、`!cmd`、不开组的各种行）；对话链取行（compact 边界、rewind 分支）；步数与末段；`requestId` 到行的四级匹配；Current position 的连续段算法与二分查找；兜底跳转的候选顺序；分块边界（包括跨 4 MiB 块的半行、单行超过一块）；增量重组与整份重组逐组一致；`$.store` 记忆与认不出的值回退；截断与单元宽度。
   - Linux 与 Windows 的分块读取：只用 `$.process.run` 替身核对命令构造与输出解析。

3. **第二层：真实宿主 PTY 验收（cmux 驱动）**
   - 覆盖弹出与关闭、停靠阈值与状态栏、点击和 Enter 跳转、高亮锁定、`/clear`、compact、rewind、resume、fork、热重载、与 `/diff` 共存、20 MiB fixture 的性能。
   - 合成 transcript 用 `--resume` 打开，尽量不调用模型；只用合成 prompt，不含真实会话内容。可沿用各票 `assets/` 里的 fixture 生成器与 pyte 驱动。

4. **一致性判据：独立 verifier**
   - 直接沿 transcript 文件的对话链算出期望的 Turn group 序列，再与 Pane 实际列出的条目比对。生命周期与分支类场景都以它为判据，不与插件共享实现。

5. **第三层：人工目检**
   - 只看三种 Layout 的观感，以及青色高亮和反色光标能否分清。在 `report.md` 里签字，不是 MUST。

6. **发布报告**
   - 字段：插件版本、Claude Code 版本、OS、架构、fixture、场景 ID、预期、实际、结果、证据链接；另记被测提交哈希。位置与文件见 Implementation Decisions §10。

## Out of Scope

**不在本 MVP 内**（地图 Out of scope）：

- 持久档案、跨会话历史、采集同意（prompt-history 的职责）。
- inline 放置（输入框上方）作为自动弹出的降级形态（`/chat-toc` 主动打开时宿主放成 inline 除外）。
- Desktop、VS Code、JetBrains、移动端等非终端表面。
- 子 agent（sidechain）内容进 TOC。
- cc-switch 顶部的搜索、导出、「改动」视图。

**不承诺**（写进 README 已知限制；定稿兼容与验收契约 §5 及其后续修订）：

1. Claude Code `<2.1.287`：不检测、不提示；也不承诺 Desktop、IDE、移动端，以及非全屏布局下的 inline 放置。
2. Linux 与 Windows 只经过命令构造测试，未在真实系统上验收；Windows 只用 Windows PowerShell 5.1。
3. transcript 文件格式未公开，宿主改格式后目录可能显示不全，由 CT-DATA-003 提示。
4. 不保证能跳到 rewind 被弃的分支，也不保证能跳到 resume 前已被 compact 的行。
5. rewind 之后、下一次提交之前，目录可能仍显示被弃的条目。
6. 人工目检项（Layout 观感、颜色能否分清）不是发布阻断。
7. 不对所有硬件承诺固定的延迟 SLA；CT-PERF 阈值只是参考机器上的发布证据。
8. `/chat-toc` 在不能停靠时打开的 inline 形态：排版、跟随与高亮未经验收。

## Further Notes

- **参考实现**：官方内置 mod `cc-plugin-diff`（anthropics/claude-code@e47cc82 `mods/diff/`）的自动弹出、记住关闭、只在 dock 时自动打开、自管滚动，形状与 chat-toc 几乎一致。交互参考 cc-switch 的「对话目录」，但不照搬它的斜杠命令隐藏、混合步数口径和过滤后点击静默无反应。prompt-history 的 `$.ui.scroll({ to: { requestId } })` 跳转可借鉴，不抽公共库。
- **原型与探针**：各票的原型 mod、驱动脚本、fixture 生成器在 `.scratch/chat-toc/assets/` 下，可直接复用为 PTY 验收素材；原型分支 `prototype/chat-toc-pane` 与 `research/chat-toc-*` 分支不合并。
- **CT-COMPAT-003 的修订**：自动弹出时不出现 inline；`/chat-toc` 在不能停靠时出现 inline Pane 并列出条目；停靠后变窄被改成 inline 时插件关掉 Pane、状态栏说明、条件恢复后再自动打开。见「定稿兼容与验收契约」的后续修订。
