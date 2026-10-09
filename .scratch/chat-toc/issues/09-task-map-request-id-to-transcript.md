# 实测 requestId 与 transcript 行身份的对应

Type: task
Status: resolved
Blocked by: 

## Question

在本机 Claude Code 全屏布局下，用一个只做记录的 dev mod 打印 `ui.render` 的 `UserMessage`、`AssistantMessage`、`CommandOutput` 站点的 `e.requestId`，与当前会话 transcript 文件中对应行的 `uuid`、`message.id` 对照（覆盖普通 prompt、prompt 型斜杠命令、本地斜杠命令、`!cmd`、多块 assistant 回复、compact 前的行、rewind 前后、resume 回来的行）。记录：`requestId` 等于哪个字段；一条多块回复对应几个 `requestId`；斜杠命令和 `!cmd` 由哪个站点绘制；compact 前与被 rewind 抛弃的行能否被 `$.ui.scroll` 跳到（从停靠 Pane 的 Button 发起）。顺带实测 `props.onScreen` 在全屏交互下的实际上报（滚动时哪些站点收到、`null` 与可见行数是否和屏幕一致）。产出对应规则与实测记录，可用 cmux 驱动 PTY。本票结果决定 Current position 高亮是否留在 MVP（见「决定是否做当前位置高亮」）：需判明 `onScreen` 是否在滚动时可靠上报、`first`/`last`/`of` 是否与屏幕行一致、顶部被切的行是否给出 `first > 0`、底部是否能用 `last === of - 1` 判断。

## Answer

**结论：`requestId` 就是 transcript 文件里那一行的 `uuid`。滚动时 `onScreen` 上报可靠，数字和屏幕逐行一致；Current position 高亮的前提全部成立，可以留在 MVP。** 但有一批行没有任何可挂钩的绘制站点，拿不到 Jump target。

### 怎么测的

- 本机 Claude Code 2.1.295，全屏布局（`/tui` 输出 `Current renderer: fullscreen`），170×44 的伪终端，`--model haiku`。用 pyte 模拟终端读屏，用 SGR 鼠标序列点击和滚轮。跑过两个进程：一次新会话，一次 `--resume`。resume 那次用 `--settings` 关掉了本机装的 prompt-history，因为它在 resume 后会拦下 prompt。
- 探针 mod 只做记录：在 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolUse`、`ToolResult`、`ToolGroup`、`TurnDuration`、`InfoNotice`、`PromptHint`、`SessionMode`、`ToolProgress` 这些站点上，记录 `requestId`、`origin`、`onScreen` 的每次变化；另开一个停靠 Pane，每个站点一个 Button，点了就调 `$.ui.scroll({ to: { requestId }, block: 'start' })` 并记下结果。
- 附件：[探针 mod、驱动脚本与对照脚本](../assets/09-request-id/)、[逐次运行的日志](../assets/09-request-id/logs/)、[transcript 行摘要](../assets/09-request-id/transcript-rows.txt)。

### 对应规则

| 场景 | 绘制站点与 `requestId` | 能否从停靠 Pane 跳到 |
|---|---|---|
| 普通 prompt | `UserMessage`，`origin.kind = composer`，`requestId` = 该 user 行的 `uuid` | 能，`{}` |
| 一条回复中间夹着工具调用 | 每个文字块是 transcript 里单独一行，各有 `uuid`，各自一个 `AssistantMessage`（`requestId` = 该行 `uuid`）；本次每个文字块的 `isFirstOfReply` 都是 `true`。工具调用画在 `ToolGroup`，`requestId` 形如 `collapsed-<首个 tool_use 行 uuid 前缀>` | 文字块都能跳 |
| 本地斜杠命令（`/tui`、`/probe`） | 提交瞬间有一个 `requestId` 字面量为 `"placeholder"` 的 `UserMessage`（乐观占位，多条输入共用这个 id）。真正落下来的命令回显行 `❯ /tui` **没有可挂钩站点**；输出行是 `CommandOutput`，`requestId` = `system/local_command` 中 stdout 那一行的 `uuid` | 回显行不能跳；`CommandOutput` 能（落点比回显行低一行）；`"placeholder"` 被拒：`nothing drawn under that requestId` |
| prompt 型斜杠命令（项目命令 `/hi`） | 同样只有 `"placeholder"`；`<command-name>` 那一 user 行没有站点；回复的 `AssistantMessage` 正常 | User 侧不能跳，Agent 侧能 |
| `!cmd` | `<bash-input>`、`<bash-stdout>` 两行在屏上显示为 `! echo …` 和 `⎿ …`，**没有任何可挂钩站点**。本次跑完 `!echo` 后模型还接着回了一段话，接在 `bash-stdout` 行下面，原因没查 | 两行都不能跳；后面那段回复能 |
| `/compact`（现场执行） | `UserMessage`，`origin.kind = unclassified`，`requestId` = 文本为 `/compact` 那一 user 行的 `uuid` | 能 |
| 当前进程里 compact 之前的行 | 照常绘制，`requestId` 不变 | 能（两次 compact 都验证过） |
| resume 回来、compact 之前的行 | 只画出 compact 前最后一段回复（`FIVE-DONE` 及其 `TurnDuration`），更早的行和那条 prompt 都不画；compact 摘要（`isCompactSummary` 行）不画成 `AssistantMessage`；resume 后的 `/compact` 显示为 `<command-name>` 行，没有站点 | 画出来的能；没画的被拒：`nothing drawn under that requestId` |
| resume 回来的其他行 | `requestId` 仍等于 `uuid`，和原进程里一样 | 能 |
| rewind 抛弃的行 | rewind 不触发任何事件（没有 `session.end`/`SessionStart`），transcript 还是同一个文件，当时不写新行；下一条 prompt 的 `parentUuid` 指回分叉点 | 被拒：`nothing drawn under that requestId` |

- 跳转都由 Pane 里的 Button 点击发起，是使用者发起的；成功一律返回 `{}`，目标落在视口顶部。全屏顶部那一行是宿主的置顶 prompt 条，所以目标消息的第 0 行（空行）落在屏幕第 1 行。
- 子 agent 不在本次范围内。

### `onScreen` 实测

- 第一次绘制时 `onScreen` 是 `undefined`，排版完成后马上变成具体值；离开视口变 `null`；只有变化时才重跑 render。
- 用滚轮滚动后对照屏幕：`first`/`last`/`of` 和屏上行逐行一致。`of` 包含消息上方那一空行（第 0 行）；被视口顶部切掉的消息给出 `first > 0`（例如 `25-26/27`）；底部被切的给出 `last < of - 1`（例如 `0-23/27`）。置顶 prompt 条不属于任何站点，不计入。
- `"placeholder"` 站点的 `onScreen` 会残留在旧值上，必须忽略。

### 实现时要注意

- **render hook 里不能写 `$.state`**：写了就被拒（`state.set: denied: it was made while ui.render is being dispatched, and drawing is pure`），整个 hook 被跳过，改由引擎自己绘制。所以「transcript 站点收到 `onScreen` → 让 Pane 重画」不能靠 atom 写入。2.1.287 和 2.1.295 都有 `$.ui.invalidate('ui.render')`，但它会让本插件所有 `ui.render` 匹配到的实例都重跑，其中包括每一条被挂钩的 transcript 行；在终端里最多每秒 30 次。可不可行、代价多大，没有测，另开一张票。
- `--plugin-dir` 下改动文件会热重载：模块变量清空，`session.start` 再次触发，可见行重新绘制。


## 后续修订

- 「原型验证停靠 TOC Pane 的外观与交互」实测：`ToolGroup` 的 id 有时是 `collapsed-<uuid 前 24 位>000000000000`，要按前 24 位匹配；全屏 transcript 是虚拟化的，被卸掉的行不一定再报 `onScreen: null`；`$.ui.scroll` 能跳到从没画出过的行。见 [05](05-prototype-toc-pane.md)。
