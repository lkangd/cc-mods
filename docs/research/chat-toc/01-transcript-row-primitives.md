# chat-toc 研究 01：transcript 行的枚举与跳转原语

> 问题：在 Claude Code `>=2.1.287` 的公开 mods API 中（以本机 2.1.295 为准），一个 mod 能否枚举当前 transcript 的 User input 行与 assistant 文字行、拿到能交给 `$.ui.scroll({ to: { requestId } })` 的身份，并据此做一个停靠在右侧的对话目录（含当前位置高亮）。
>
> 调研日期：2026-10-09。只读调研：没有写 mod，也没有往 `~/.claude/dev-mods` 写任何文件。

## 出处缩写

| 缩写 | 指什么 | 可信度 |
| :- | :- | :- |
| `D` | `/private/tmp/claude-501/bundled-skills/2.1.295/b63029d1f174acf098aa2856af0b60f5/plugin-authoring/types/claude-code.d.ts`，由 2.1.295 引擎生成的 API 类型声明（共 21451 行） | 最高：引擎自己写出的契约。`R` 第 5 行写明「the declaration file is the authority」 |
| `R` | 同一目录下的 `reference.md`（plugin-authoring 技能的长版说明） | 高 |
| `DOC/<页>` | `~/.claude-code-docs/docs/plugins__mods__<页>.md`，官方文档的本地镜像 | 高，但比类型声明粗：很多 props 没有列出 |
| `CL` | `~/.claude-code-docs/docs/changelog.md`。镜像里最新一条是 2.1.293，没有 2.1.294 和 2.1.295 的条目 | 中：mods API 的增量没有逐条进 changelog |
| `T273` | `git show 2118a70:mods/prompt-trail/.claude/types/claude-code.d.ts`，2.1.273 生成的类型声明（文件头 `// Written by Claude Code 2.1.273.`） | 高，只用来判断版本 |
| `T290` | `git show 3f6dbde:mods/prompt-trail/.claude/types/claude-code.d.ts`，2.1.290 生成的类型声明 | 高，只用来判断版本 |
| `PH` | 本仓库 `mods/prompt-history/`，已在 2.1.290 上过 PTY 验收的现成做法 | 中高：只证明它实际用到的那部分 |

### 版本可用性怎么判断

本机找不到 2.1.287 到 2.1.289 生成的类型声明，所以版本只能分档推断：

- **A 档：2.1.287 一定有。** 符号在 `T273` 里就已存在，在 `T290` 和 `D` 里仍然存在。
- **B 档：很可能 2.1.287 就有，但没有证实。** 符号 `T273` 没有，`T290` 有；`CL` 中 2.1.287 到 2.1.293 没有一条说「Added」它；`DOC` 也没有标「Requires Claude Code v2.1.28x or later」。`DOC` 确实会给晚到的功能标版本（`DOC/reference` 第 73 行的 `prompt.mention`「v2.1.290」、第 135 行的 `ui.fault`「v2.1.289」），所以没有标注算一条弱证据。但也有反例：`$.ui.selection()` 是 2.1.288 加的（`CL` 第 395–396 行），文档表里却没有标版本。
- **C 档：changelog 写明了版本。**

2.1.290 和 2.1.295 之间，下文涉及的声明没有实质差异。对两份文件做 diff，再按 onScreen、scroll、UserMessage、AssistantMessage、requestId、session.messages、origin、compact、turn 这些词过滤，只剩下与本题无关的四行注释。

---

## 结论速览

| # | 问题 | 结论 | 主要原语 | 版本档 |
| :- | :- | :- | :- | :- |
| 1 | 枚举 User input 行和 assistant 文字行，拿到可跳转的身份 | **能，但只能在「绘制时」拿到。** `ui.render` 的 `UserMessage`、`AssistantMessage`、`CommandOutput` 站点给出 `e.requestId`，它就是 `$.ui.scroll` 要的身份。没有一个 API 能一次性列出带 id 的行：`$.session.messages()` 返回的行不带 id。斜杠命令和 `!` shell 行由哪个站点画、带什么 origin，类型声明没有写。 | `ui.render`、`$.session.messages`、`session.append` | `ui.render` 和 `requestId` 属 A 档；`session.append` 属 B 档 |
| 2 | 能否跳到 assistant 文字行 | **类型契约上能**：`UiScrollTarget.requestId` 接受「a transcript message's」实例 id，`AssistantMessage` 就是 transcript 消息站点。只有 prompt 行在 PTY 实测过。 | `$.ui.scroll` | A 档 |
| 3 | 区分主循环与子 agent，识别系统注入的 user 行 | **部分能。** 绘制站点的 props 没有 `agentId`，但 `UserMessage.origin.kind`、`task`、`from` 能区分 task notification、peer、plugin 等来源。在写入层，`session.append` 的 `agentId`、`door`、`origin`、`isMeta` 能把所有来源分清。`$.session.messages()` 只读主循环，但读出的行不带来源标记。 | `UserMessage.props.origin`、`session.append` | origin 属 A 档；task、from、append 属 B 档 |
| 4 | 一轮内的工具步数，一轮是否进行中或被中断 | **实时能，历史上只能近似。** 实时靠 `turn.start`、`turn.step.index`、`tool.call`、`turn.complete`（`reason`、`isAborted`）；每一行可以看 `ToolUse.isRunning`、`isInterrupted`；历史上靠 `messages()` 里的 `toolUses` 计数。resume 回来的历史轮没有 turn 事件，「被中断」也没有结构化标记。 | `turn.*`、`tool.call`、`ToolUse` props、`SessionMessage.toolUses` | A 档 |
| 5 | 每条消息的时间戳 | **API 不提供。** `SessionMessage`、`ui.render` props、`session.append` 的 `e` 都没有时间戳，类型声明明说时间戳「not on e」。实时只能用 `$.clock.now()` 自己打点；历史要用 `$.fs` 去读 `transcript_path` 指向的 JSONL。 | `$.clock.now`、classic 事件的 `transcript_path`、`$.fs.read` | A 档，读 JSONL 属于绕行办法 |
| 6 | transcript 的可视区域或滚动位置 | **只在全屏终端能拿到：** 每个 transcript 消息站点有 `e.props.onScreen`（`{first,last,of}`，屏外为 `null`），变化时那条消息的 render 会重跑。非全屏主屏上这个字段不存在。transcript 没有 `ui.scroll` 事件。 | `e.props.onScreen` | **B 档（关键风险）** |
| 7 | `/clear`、compact、rewind、resume 后的变更通知 | `/clear` 和 resume 有可靠事件：`session.end` 的 reason 为 `clear` 或 `resume`，classic `SessionStart` 的 source 为 `clear`、`resume`、`compact`、`fork`。compact 有 `session.compact`，classic 还有 `PreCompact` 和 `PostCompact`。**rewind 没有任何事件**，只能重读 `messages()` 来比对。 | `session.end`、`classic.SessionStart`、`session.compact`、`classic.PostCompact` | `session.end` 属 B 档，其余属 A 档 |

---

## (1) 枚举 User input 行与 assistant 文字行，拿到可跳转身份

### 能用的原语

**`ui.render` 的 transcript 站点（主路径）**

- `RenderComponent` 里有 `'UserMessage' | 'AssistantMessage' | 'ToolUse' | 'ToolResult' | 'ToolGroup' | 'CommandOutput' | 'TurnDuration' | 'InfoNotice' | …`（`D:9360`）。
- `e.requestId` 是「The instance: the tool_use_id for a dialog or tool row, the message id for a message」（`D:9728-9734`）。`R:111-112` 的说法相同，`DOC/reference:198-201` 的站点表也写着 `UserMessage`、`AssistantMessage`、`CommandOutput` 的 `e.requestId` 是「The message id」。
- 这个 id 和跳转的身份是同一个：`UiScrollTarget` 的 `{ requestId }`「names a render instance by the id its `ui.render` hook saw (a transcript message's, a tool row's tool_use_id)」（`D:14423-14438`）。`$.ui.selection()` 返回的 `requestId` 也是「the id that row's `ui.render` reads as `e.requestId` and `$.ui.scroll` takes」（`D:14491-14499`）。
- `UserMessage` 站点覆盖所有 user-role 行，包括使用者的 prompt、后台任务的 notification、其它 agent 或 session 发来的消息，靠 `e.props.origin.kind` 区分；matcher 可以直接按它过滤（`R:133`；`D:9785-9812`）。
- `AssistantMessage` 是「One block of an assistant reply」，是一个块，不是整条回复。`isFirstOfReply` 标出开头画圆点的那一块；`isSummary` 标出「a summary of the text the model wrote between two tool calls」的块（`D:9845-9875`）。所以一条回复可能对应多个 `requestId`，而工具调用之间那段文字在默认视图里可能只画成摘要。
- `CommandOutput` 是斜杠命令输出所在的行，`props.command` 是不带斜杠的命令名，`props.args` 是「as the echo above the row shows them」（`D:10025-10068`）。

**`$.session.messages()`（补全文本，没有 id）**

- 返回「one SessionMessage per user or assistant message」，最多取最新的 4096 条（`D:2739-2771`；`DOC/reference:276`）。
- `SessionMessage` 只有 `role`、`text`、`toolUses`、`toolResults?`、`handle?`，而且 `handle`「Absent on `$.session.messages()`」（`D:11131-11160`）。**没有 id，也没有时间戳，没有来源。** 所以这里的行不能直接对上 `requestId`。
- `$.session.turns()` 返回「how many prompts the user has sent this session」（`D:2788-2792`），可以拿来核对计数。

**`session.append`（写入时的身份，B 档）**

- 「every place the engine adds a row to a conversation it keeps calls it, once」，范围涵盖 prompt、斜杠命令的记录和输出、模型回复的每一块、tool result、注入的提醒、hook context、compaction 的边界和摘要、notice，而且「in the main conversation and in every subagent's alike」（`R:137`）。
- `e.uuid` 是「The row's id, the same in the transcript file and on every later read」（`D:10582-10586`）。`e.door` 的取值有 `'prompt' | 'command' | 'response' | 'tool-result' | 'tool-message' | 'delivery' | 'attachment' | 'hook-context' | 'note' | 'compaction' | 'notice'`（`D:10552-10556`）。
- **load 不算 append。** `--resume`、teleport 或子 agent 存档读进来的行都不会触发这个事件（`R:137`）。所以光靠 `session.append`，拿不到 resume 回来的历史行。

### 仓库现成做法（prompt-history）

- `on('ui.render', { component: 'UserMessage', surface: 'terminal' }, …)` 只收 `e.requestId !== 'placeholder'` 且 `e.props.origin.kind === 'composer'` 的行，用 `recordRow` 按首次绘制的顺序记下 `{ requestId, text }`，同一个 id 重绘不会重复记录（`PH/hooks/register.tsx:7708-7718`；`PH/hooks/jump.ts:13-31`）。
- 「A resume replays its rows under the requestIds they had」：resume 时引擎会用原来的 requestId 重画旧行（`PH/hooks/register.tsx:3699-3708`）。这说明 `requestId` 跨 resume 稳定，而且很可能就是 transcript 文件里的 uuid（属推断，见残余不确定点）。
- 它对 `messages()` 的用法只是**按文本对齐**，用 `isPersonRow`（`role === 'user'` 且没有 toolResults，见 `PH/hooks/branch.ts:137-140`）判断某个已画行还在不在 transcript 里，从不认为两者的 id 相同（`PH/hooks/register.tsx:3609-3650`）。

### 斜杠命令与 `!` shell

- 类型声明**没有说明**斜杠命令的回显行（`> /foo args`）和 `!cmd` 输入行由哪个站点画，也没有说明它们带什么 `origin`。`D` 里只有 `CommandOutput` 提到「under its echo」（`D:10026`），没有任何 `bash-input` 或 bash mode 字样。
- 旁证：prompt-history 以 `prompt.submit`（composer）加 `session.append { door: 'prompt' }` 作为一条记录成立的证据。它在 2.1.290 PTY 上实测 `/cost`、`/prompt-history status`、`/reload-plugins`、`/compact`、`/clear`、`/rewind` 都没有产生记录（`PH/release/evidence/0.3.0/report.md:107`；`PH/release/pty_scenarios.py:395-415`），而插件里并没有按 `/` 前缀过滤的代码。所以**内置斜杠命令走的不是 composer prompt 那条路**：它在 `session.append` 层大概率走 `door: 'command'`（`R:137` 说这个 door 承载「a slash command's record and output」）。
- 其它可用的信号有：`command.run` 事件（「`/name args` typed」，`D:4226-4239`）和 classic `UserPromptExpansion`（`expansion_type: 'slash_command' | 'mcp_prompt'`、`command_name`、`command_args`，`D:14652-14659`），后者覆盖展开成 prompt 的命令。

**残余不确定（需要原型实测）：**
1. 斜杠命令的回显行是不是 `UserMessage` 站点，`origin.kind` 是什么；还是说只有 `CommandOutput` 一行，回显画在它里面。
2. `!cmd` 的输入行和输出行各由哪个站点画（`UserMessage`？`CommandOutput`？）、`origin` 是什么、`text` 里有没有 `<bash-input>` 之类的标签；在 `session.append` 里走哪个 door。
3. `$.session.messages()` 里斜杠命令和 `!` 行的 `text` 长什么样（是否带 `<command-name>`、`<bash-input>` 标签）。
4. `ui.render` 的 `requestId` 是否就等于 `session.append.uuid` 和 transcript JSONL 的 `uuid`。如果等于，就能用 `session.append` 给行打上 door、origin、agentId 和时间。
5. 全屏下打开一个很长的 resume 会话时，是不是每一行都至少触发一次 `ui.render`，包括从没滚进视口的行。如果 transcript 是虚拟化的，只有画过的行才会被枚举到。`D:14496-14497` 提到「scrolled out of the rows the transcript keeps drawn」，说明确实存在「不再保持绘制」的行。

## (2) 能否跳到 assistant 文字行

- `$.ui.scroll(args)`：「Scrolls something into view as the DOM's `scrollIntoView` would: a render instance by `requestId` … A transcript row moves only while this call answers the person's own input」（`D:2528-2542`）。
- `UiScrollTarget` 里的 `{ requestId }` 覆盖「a transcript message's, a tool row's tool_use_id」（`D:14423-14438`）。`AssistantMessage` 是 transcript 消息站点，它的 `requestId` 是「the message id」（`D:9728-9734`；`DOC/reference:199`），**所以契约上可以跳到 assistant 块。** 也能跳到 `ToolUse` 行（用 tool_use_id）。
- `block` 可选 `'start' | 'center' | 'end' | 'nearest'`，默认 `nearest`（`D:14274-14289`）。
- 拒绝时返回 `{ deny }`，原因可能是：`not person-initiated`、`the window moved meanwhile`、目标不属于本插件、没有能滚动的东西（`D:14404-14421`）。目录里的 Button 在 `onPress` 里调用，就算使用者本人的输入。prompt-history 正是这样做的：band 行的 onPress 调 `jumpTo`，`jumpTo` 第一个 await 就是 `$.ui.scroll`（`PH/hooks/register.tsx:3720-3741`）。遇到 deny，它就把这一行判为失效，以后不再作为跳转目标（`PH/hooks/jump.ts:89-96`）。
- 实测证据：2.1.290 PTY 上「Enter and a click each brought an off-screen entry into view」（`PH/release/evidence/0.3.0/report.md:119`）。**不过这只覆盖了 `UserMessage`。**
- 版本：A 档。`T273` 已有 `UiScrollTarget`、`not person-initiated`、「a transcript message's」（`T273:9184,9194`），`AssistantMessage` 站点也在（`T273:6306`）。

**残余不确定：**
1. 对 `AssistantMessage` 的 requestId 调 `$.ui.scroll` 能不能真的滚过去，尤其是 `isSummary` 块，以及折叠在 `ToolGroup` 里的情况。
2. 目标行已经超出「the rows the transcript keeps drawn」时，是返回 deny，还是照样能滚过去。
3. 「answers the person's own input」的时间窗：`onPress` 里先 await 别的调用再 scroll，还算不算使用者的输入。
4. Pane 停靠在右侧（`placement: 'dock'`）时，从 Pane 的 Button 发起的 scroll 是否同样有效。prompt-history 只验证过 band（`AbovePrompt`）。

## (3) 区分主循环与子 agent，区分系统注入的 user 行

**绘制层**

- `UserMessage.props` 只有 `text`、`origin`、`isExpanded`、`task?`、`from?`、`onScreen?`（`D:9795-9844`），`AssistantMessage.props` 只有 `text`、`isFirstOfReply`、`isSummary?`、`onScreen?`（`D:9854-9885`）。**两者都没有 `agentId`。**
- `origin: PromptOrigin` 是一个封闭集合：`composer`（使用者在终端回车，含排队提交）、`bridge`、`sdk`、`task-notification`、`scheduled-trigger`、`peer`、`peer-send-message`、`projects-relay`、`channel`、`coordinator`、`observer`、`observer-activity`、`auto-continuation`、`unclassified`、`slack-ping`、`plugin`（带 `name`、`asUser?`）（`D:8857-8980`）。「composer」的定义是「Enter at the prompt, typed or queued, or a click on a transcript link」（`D:8870-8871`）。
- `task?: UserMessageTask` 只出现在 task-notification 行上，带 `id`、`status`、`type`、`toolUseId`、`durationMs`（`D:9826-9829`、`D:14615-14650`）。`from?: UserMessageFrom` 只出现在其它 agent、teammate、session 或 channel 发来的行上（`D:14596-14613`）。
- `isExpanded` 为 true 表示 ctrl+o 或 `--verbose` 的全量视图（`D:9814-9824`）。`R:133` 建议在这种视图下让 hook 直接 `next(e)`。

**写入层（B 档）**

- `session.append` 的 `e.agentId` 标出这一行属于哪个子 agent 的循环，主循环为空（`D:10587-10593`）。`e.origin` 是 `PromptOrigin`、`PromptAttachmentOrigin`、`{kind:'model'}` 或 `{kind:'tool'}`（`D:10640-10663`）。`e.message` 还带 `type`（`user`、`assistant`、`attachment`、`system`）、`name`（例如 `compact_boundary`、`local_command`）、`role` 和 `isMeta`（「a user-side row the person does not see as typed (a reminder, a nudge, a delivery's text)」）（`D:10596-10638`）。
- 按 door 区分：hook 注入是 `hook-context`，compact 的边界和摘要是 `compaction`，提醒和清单是 `attachment`，模型回复是 `response`（`D:10552-10556`；`R:137-139`）。prompt-history 的筛法是 `door: 'prompt'` 且 `origin.kind === 'composer'`、`type === 'user'`、`isMeta !== true`、`agentId === undefined`（`PH/hooks/register.tsx:7868-7880`）。

**读取层**

- `$.session.messages()` 不带参数时只读主循环，`{ agentId }` 读某个子 agent，读不到时返回 `{ deny }`（`D:11201-11247`）。主循环里 Agent 调用的 `toolUses[].agentId` 指向它派生的子 agent（`D:13178-13189`）。但 `SessionMessage` 里**没有** `isMeta`、`origin` 或 door，所以在读取层分不清哪条是系统注入的 user 行。
- `ApiMessage`（`as: 'api'`）是「after the engine's normalization (the last compaction's summary in place of what it replaced, reminders as text blocks)」（`D:632-640`），同样不带来源。

**版本：** `origin` 属 A 档（`T273` 已有 `origin: PromptOrigin`）。`task`、`from`、`session.append`、`messages({ agentId })` 属 B 档（`T273` 没有，`T290` 有）。

**残余不确定：**
1. 子 agent 自己的 user 和 assistant 行会不会以 `UserMessage` 或 `AssistantMessage` 站点出现在主 transcript 里（例如 ctrl+o 展开 Agent 行时）。如果会，绘制层没有 `agentId`，就无法排除它们。
2. hook 注入的 context、`isMeta` 提醒、compact 摘要会不会经过 `UserMessage` 站点绘制；如果会，`origin.kind` 是什么（可能是 `unclassified`？）。
3. `requestId` 与 `session.append.uuid` 是否相同。只有相同，才能把写入层的 door、agentId、isMeta 挂到绘制层的行上（同 (1) 的第 4 条）。

## (4) 一轮内的工具步数，一轮是否进行中或被中断

**实时（本进程内发生的轮次）**

- `turn.start { text, turnId }`：一轮开始，在第一次模型调用之前触发（`D:4442-4446`、`D:13370-13385`）。子 agent 的运行不触发 `turn.start`（`D:13295-13298`）。
- `turn.step { turnId, index, model, messageCount, agentId? }`：每次模型请求触发一次，`index` 从 0 开始（`D:4447-4455`、`D:13421-13464`）。它是 async generator 事件（`R:28-31`），只想计数的话也必须写成 `async function*` 并 `yield* next(e)`。
- `tool.call`：每次工具调用触发，带 `agentId` 和 `tool_use_id`（`D:192-203` 一带）。按主循环（`agentId === undefined`）加 `turnId` 区间计数即可。
- `turn.complete { answer, durationMs, isAborted, turnId, agentId?, usage?, reason }`，其中 `reason` 为 `'answer' | 'aborted' | 'refusal' | 'error'`（`D:4456-4464`、`D:13272-13330`）。从 `turn.start` 到 `turn.complete` 之间就是「进行中」。
- 辅助信号：`Spinner` 站点只在一轮进行时绘制（`D:10100-10136`）；`AbovePrompt` 和 `PromptHint` 的 props 带 `isWorking`（`DOC/reference:197,208`）。

**逐行（绘制层）**

- `ToolUse.props` 有 `isRunning`、`isErrored`、`isInterrupted`（「an abort ended the call: the user's Esc or a plugin's `$.turn.abort`」），以及 `output`（`D:9892-9940`）。`ToolGroup.props.calls` 列出被折叠的同组调用，`isActive` 表示这一组仍在进行（`D:9997-10024`）。
- `TurnDuration` 是一轮结束的那一行（「Baked for 3s」），带 `durationMs`，只在终端绘制（`D:10137-10162`）。可以拿它当「这一轮已结束」的绘制锚点。

**历史（resume 回来的或本进程之前的轮次）**

- 没有 turn 事件。只能在 `messages()` 里，以两条使用者 prompt 行为界，累加 assistant 行的 `toolUses.length`（`D:11143-11147`、`D:13147-13196`）。被中断与否没有结构化字段，只能从 `toolUses[].text` 或 user 行的文字去启发式判断，或者依赖绘制出来的 `ToolUse.isInterrupted`。

**版本：** 全部属 A 档（`T273` 已有 `turn.start`、`turn.step`、`turn.complete`、`TurnCompleteReason`、`isAborted`、`isInterrupted`、`ToolGroup`、`TurnDuration`）。

**残余不确定：**
1. 斜杠命令或 `!` shell 形成的「轮」不会触发 `turn.start` 和 `turn.complete`，目录要另行处理。
2. 使用者在一轮进行中又提交的 prompt：`prompt.submit` 带进行中那一轮的 `turnId`（`D:9069-9077`），会被折叠进当前轮，不会单独开一轮。目录应该把它画成独立条目，还是挂在当前轮下面，需要实测它的绘制形态。
3. 历史轮「被中断」时，transcript 文本里的标记长什么样（例如 `[Request interrupted by user]`），需要实测。

## (5) 每条消息的时间戳

- `SessionMessage` 没有时间戳（`D:11131-11160`），`UserMessage` 和 `AssistantMessage` 的 props 也没有（`D:9795-9885`）。
- `session.append` 的说明里写明，时间戳不在 `e` 上，而是按原样存储：「Not on `e`, so stored as made: a tool result's structured record, the row's timestamps, parent links and provenance stamps」（`D:10558-10565`；`R:143`）。
- 可行的替代办法：
  - **实时：** 在 `session.append`（B 档）或首次 `ui.render` 时，用 `$.clock.now()` 打点，按 `requestId` 或 uuid 存入 `$.state` 或 `$.store`。
  - **轮级时长：** `turn.complete.durationMs`、`TurnDuration.durationMs`、`UserMessageTask.durationMs`、`ToolUseSummary.durationMs`。
  - **会话起点：** `$.session.usage().startedAt`（`D:11704-11716`）。
  - **历史：** 每个 classic 事件的 `e` 都带 `transcript_path`（`D:826-828`；`R:27`），可以用 `$.fs.read` 读出 JSONL 里每条记录的 `timestamp`。单个文件最多读 4 MiB（`DOC/reference` 限制表）。这需要上面说的 uuid 与 `requestId` 对应关系，而且依赖的是**未公开的** JSONL 格式。

**残余不确定：** `requestId` 是否等于 JSONL 的 `uuid`；`$.fs` 读 `~/.claude/projects/...` 下的 transcript 是否受权限或 policy 限制；长会话 JSONL 超过 4 MiB 时，要用 `$.process.run` 调 `tail` 之类的命令，开销需要评估。

## (6) transcript 当前可视区域或滚动位置（scroll-spy）

- 每个 transcript 消息站点（`UserMessage`、`AssistantMessage`、`ToolUse`、`ToolGroup`、`CommandOutput`、`TurnDuration`、`InfoNotice` 等）都带 `onScreen?: OnScreen | null`。字段说明是「Which of its rows the transcript's viewport shows now: `null` while drawn outside it, absent where the surface does not say … Reported once drawn and again when it changes: on a scroll, for the messages at the viewport's edges only」（`D:9836-9843`、`D:9877-9884` 及其余各站点）。
- `OnScreen = { first, last, of }`：终端上以行为单位，从这个站点排版出的第一行算起，`first=7` 表示顶部 7 行已经滚出视口（`D:6776-6807`）。声明里自带用例：`if (e.props.onScreen) shown.set(e.requestId, e.props.onScreen) else shown.delete(e.requestId) // the band's legend lists shown`（`D:6786-6787`）。**这正是 scroll-spy 需要的原语。**
- `R:114` 说「the hook re-runs for that message when it changes」，又说「absent where the surface does not say, **as on the terminal's main screen**」。所以只有全屏终端布局有这个字段；非全屏（主屏，滚动回看）上拿不到。好在 Pane 停靠在侧边本身也只发生在全屏布局（`R:117`：「the terminal's fullscreen layout does, its main screen opens one inline」）。
- transcript 自身**没有** `ui.scroll` 事件：`UiScrollComponent = 'Pane' | 'AbovePrompt'`（`D:14291-14295`；`DOC/reference:132` 写的是「The focused control or the scroll position of a pane or the band」）。
- 不能用 `$.ui.scroll` 的回执去推算位置，它只返回 `{}` 或 `{ deny }`（`D:14404-14421`）。
- 约束：hook 只能读 `onScreen`，不能改；「A rewrite carries it on as received; one that changes or drops it is refused」（`D:9840-9842`）。render hook 里也不能写 `$.state`（`R:118`），所以 `onScreen` 要先存进模块变量，再在别的事件或 clock 回调里 `$.state.set`，才能触发目录 Pane 重绘。如果直接在 render hook 里 `$.ui.invalidate`，会受到每秒 10 次（终端 30 次）的节流（`DOC/reference` 限制表）。

**版本：B 档，是本题风险最大的一项。** `T273` 里没有 `onScreen`，`T290` 里有（`T290:9512,9553` 等 9 处），`CL` 中 2.1.287 到 2.1.293 也没有提到它；`DOC/reference:194-208` 的站点表**没有列出** `onScreen`，它只出现在类型声明里。

**残余不确定：**
1. 2.1.287、2.1.288、2.1.289 上 `onScreen` 是否存在；如果不存在，scroll-spy 要按版本降级。
2. 「for the messages at the viewport's edges only」意味着一次大跨度跳转（PageUp/Down、Home/End、或 `$.ui.scroll`）后，被整体跨过的消息可能不会收到 `null`。目录需要自己做容错，例如只信任最新上报的边缘消息，再按文档顺序推算中间的消息。
3. 滚动时 render 重跑的频率与开销，以及 hook 的执行时间预算（单次 10 s，见 `DOC/reference` 限制表）。
4. 桌面端也会上报 `onScreen`，但单位不同（「compare `first / of` there」，`D:6780-6782`）。chat-toc 目前只针对终端，暂不处理。

## (7) `/clear`、compact、rewind、resume 后的变更通知

| 操作 | 可靠事件 | 出处 | 版本档 |
| :- | :- | :- | :- |
| `/clear` | `session.end`，`reason: 'clear'`，「the process goes on under a new session id, and no `session.start` fires for it」；classic `SessionEnd`（reason `clear`）之后是 classic `SessionStart`（`source: 'clear'`） | `D:4416-4427`、`D:11041-11077`、`D:11643-11645`；`R:27`；`DOC/reference:106-107` | `session.end` 属 B 档（`T273` 没有这个 mod 事件，只有 classic）；classic 事件属 A 档 |
| resume（`/resume`；`/branch` 也报 `resume`） | `session.end` 的 `reason: 'resume'`，以及 classic `SessionStart` 的 `source: 'resume'` 或 `'fork'`；`session.start`「Not after `/clear`, `/resume`, or `/branch`」 | `DOC/reference:106-107`；`D:11643-11665` | 同上 |
| compact | `session.compact`：带 `trigger`（`manual`、`auto`、`plugin`、`precompute`；`precompute` 什么都不安装），子 agent 自己的 compact 会带 `agentId`；`await next(e)` 拿到 `result.messages` 就表示 compact 已生效。classic 还有 `PreCompact` 和 `PostCompact`（带 `compact_summary`）以及 `SessionStart`（`source: 'compact'`）。`session.append` 里也有 `door: 'compaction'` 的行 | `D:4372-4383`、`D:10791-10856`、`D:7789-7796`；`PH/hooks/register.tsx:7753-7770` | A 档（`session.compact` 和 `PostCompact` 在 `T273` 已有） |
| rewind | **没有事件。** prompt-history 的结论是「A rewind says nothing and draws nothing」，它的做法是借 `PromptHint` 站点重绘（rewind 会把旧 prompt 放回输入框，提示行随之重画）作为触发，立刻重读一次 `messages()`，500 ms 后再读一次，用文本对齐找出被截掉的行（`vanishedRows`） | `PH/hooks/register.tsx:640-645`、`PH/hooks/register.tsx:7700-7705`、`PH/hooks/register.tsx:3653-3686`；`PH/hooks/jump.ts:33-63` | 只是绕行办法 |

补充：
- `/clear` 或 resume 离开会话时，引擎可能「draw some of it once more on the way out」，把旧 transcript 的行再画一次。prompt-history 用 `transcriptEnding` 标志，在 classic `SessionEnd` 和 classic `SessionStart` 之间丢弃所有绘制（`PH/hooks/register.tsx:3688-3708`、`PH/hooks/register.tsx:7726-7752`）。chat-toc 也需要同样的门控。
- resume 会用原来的 requestId 重画旧行（`PH/hooks/register.tsx:3699-3701`），所以 resume 之后能靠 `ui.render` 重建目录。
- 模块热重载后 `register` 会在全新环境里再跑一次，模块变量全部丢失（`R:73`）。目录状态应该放在 `$.state` 里。重载后引擎是否会重放 transcript 的绘制，prompt-history 有一处注释可作佐证：「A reload or a resume replays the transcript's rows before this」（`PH/hooks/register.tsx:7695`）。

**残余不确定：**
1. rewind 截断后，被移除的行会不会收到一次 `onScreen: null` 或别的重绘，从而可以当作信号。
2. compact 之后，旧行的 `requestId` 是否还在 transcript 里（全屏下 compact 之前的行通常仍然可以向上滚动查看），对它们 scroll 会不会返回 deny。
3. 只依赖 `PromptHint` 来检测 rewind 是否可靠，例如 rewind 时选了「summarize」选项的情形。

---

## 给原型的实测清单（按风险排序）

1. **`onScreen` 的版本与行为**：分别在 2.1.287 和 2.1.295 的全屏布局下，打印 `UserMessage` 和 `AssistantMessage` 的 `e.props.onScreen`；做一次大跨度跳转，检查被跨过的消息有没有收到 `null`。
2. **跳到 assistant 块**：在 Pane Button 的 `onPress` 里对 `AssistantMessage`（包括 `isSummary` 块和 `ToolGroup` 内的块）的 requestId 调 `$.ui.scroll({ to: { requestId }, block: 'start' })`，记录返回值。
3. **斜杠命令和 `!` 行**：对 `/cost`、自定义 prompt 型命令（如 `/review`）、`!ls` 三种输入，分别记录哪些 `ui.render` 站点被触发、各自的 `props.origin.kind` 和 `text`，以及 `session.append` 里对应的 `door`、`origin`、`message.type/name/isMeta`。
4. **`requestId` 与 `session.append.uuid`、transcript JSONL `uuid` 的关系**：同一行在三处 id 是否一致。如果一致，时间戳、来源、agentId 都能顺带解决。
5. **长 resume 会话**：全屏打开一个几百轮的会话，统计 `ui.render(UserMessage)` 触发了多少个不同的 requestId，和 `$.session.turns()` 对比。
6. **子 agent 与注入行**：跑一个会派生子 agent 的任务，以及一个带 hook `additionalContext` 的提示，看主 transcript 有没有出现 agentId 不明的 `UserMessage` 或 `AssistantMessage` 实例。
7. **rewind 信号**：rewind 时记录所有 `ui.render` 事件（`PromptHint`、被截断行的 `onScreen`），以及 `messages()` 的变化时序。

## 出处索引（文件:行号）

- 绘制契约：`D:9360`（RenderComponent）、`D:9706-9748`（RenderInputOf、requestId）、`D:9763-9885`（UserMessage、AssistantMessage props）、`D:9892-9940`（ToolUse）、`D:9997-10024`（ToolGroup）、`D:10025-10068`（CommandOutput）、`D:10137-10162`（TurnDuration）、`D:6776-6807`（OnScreen）
- 跳转：`D:2528-2542`（`$.ui.scroll`）、`D:14251-14438`（UiScrollArgs、Block、Component、Input、Result、Target）、`D:14478-14500`（UiSelection）
- 读取：`D:2739-2771`（`$.session.messages`）、`D:2788-2792`（turns）、`D:11131-11277`（SessionMessage 及各参数形态）、`D:632-640`（ApiMessage）、`D:13147-13196`（ToolUseSummary）
- 来源：`D:8857-8980`（PromptOrigin）、`D:9047-9094`（PromptSubmitInput）、`D:14596-14650`（UserMessageFrom、UserMessageTask）、`D:14652-14669`（classic UserPromptExpansion、UserPromptSubmit）
- 写入：`D:4348-4359`、`D:10552-10663`（session.append：door、input、message、origin）；`R:135-145`
- 轮次：`D:4442-4464`、`D:13272-13464`（turn.start、step、complete）
- 生命周期：`D:4323-4334`（session.start）、`D:4372-4383`、`D:10791-10856`（session.compact）、`D:4416-4427`、`D:11041-11077`（session.end）、`D:11643-11686`（classic SessionStart、SessionStartInput）、`D:7789-7796`（PostCompact）、`D:6046-6064`（classic MessageDisplay，按 assistant 消息 UUID 流式触发，可作参考）、`D:826-828`（transcript_path）
- 说明：`R:27`、`R:111-118`、`R:133`、`R:137-143`、`R:167-182`
- 官方文档：`DOC/reference:106-108`（session 事件表）、`DOC/reference:132`（ui.scroll 只覆盖 pane 和 band）、`DOC/reference:194-208`（站点表）、`DOC/reference:276`（messages 上限 4096）、`DOC/overview:97`（终端从 v2.1.287 起可用）
- changelog：`CL:487-488`（2.1.287 Added Claude Mods）、`CL:395-396`（2.1.288 `$.ui.selection()`）、`CL:13`（镜像最新为 2.1.293）
- 版本比对：`T273` 文件头为 2.1.273，没有 onScreen、isSummary、session.append、`'session.end'` mod 事件、`task?`、`from?`，已有 UiScrollTarget（`T273:9184,9194`）、AssistantMessage（`T273:6306`）、`origin: PromptOrigin`、turn 事件、session.compact；`T290` 文件头为 2.1.290，上述符号全部具备（`T290:9512` 起 onScreen 共 9 处，`T290:13978,13988` 为 scroll 说明）
- 仓库：`PH/hooks/register.tsx:617-645,3600-3741,7695-7770,7868-7880`；`PH/hooks/jump.ts:1-96`；`PH/hooks/branch.ts:137-140`；`PH/release/evidence/0.3.0/report.md:107,119`；`PH/release/pty_scenarios.py:395-415`
