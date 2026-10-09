# 在 Claude Code 2.1.287 上核对关键 API

Type: task
Status: resolved
Blocked by: 

## Question

在隔离目录装一份 Claude Code `2.1.287`（不动本机全局安装），取得它这一版写出的 mods 类型声明，逐项核对 chat-toc 依赖、研究中只判为「很可能有」的原语是否存在：`ui.render` transcript 站点的 `props.onScreen`、`session.append`（`uuid`/`door`/`agentId`/`isMeta`）、`session.end` 的 `reason`、`UiScrollTarget` 对 assistant 行 `requestId` 的支持，Pane 的 `placement`/`isPlaced`/`columns`/`ui.close` origin，以及读 transcript 文件所需的 `$.fs.read`（绝对路径、4 MiB 上限）、`$.fs.stat`、`$.process.run`（stdout 上限）和 classic 事件的 `transcript_path`。记录每项有无、字段差异，以及一个最小 mod 在 2.1.287 上能否 `claude plugin validate` 通过。

## Answer

**结论：清单上每一项在 2.1.287 上都有，字段和 2.1.295 一样。** `>=2.1.287` 这条最低版本不用抬高。最小 mod 在 2.1.287 上 `claude plugin validate` 通过。

### 怎么查的

- 用 npm 把 `@anthropic-ai/claude-code@2.1.287` 装进会话临时目录（本机全局的 2.1.295 没动），然后用 `claude -p "/probe" --plugin-dir` 加载一个探针 mod，让这一版自己写出类型声明（首行是 `// Written by Claude Code 2.1.287.`，574 KB；2.1.295 那份是 804 KB）。
- 附件：[2.1.287 类型声明](../assets/07-api-2-1-287/claude-code-2.1.287.d.ts)、[探针 mod](../assets/07-api-2-1-287/toc-probe/)。
- 探针（TypeScript）用到了下面每一个原语。用 tsc 5.6 分别对两版声明做 `strict` 类型检查，都是 0 错误；2.1.287 的 `claude plugin validate` 也通过，列出了全部 hook 和 `$.fs.read`、`$.fs.stat`、`$.process.run`、`$.ui.open/close/panes/scroll/resolve` 这些调用。
- 再用 2.1.287 `-p` 实际跑了一遍探针，结果见「运行期实测」。

### 逐项结果（2.1.287）

| 原语 | 有无 | 与 2.1.295 的差别 |
|---|---|---|
| `ui.render` 的 `props.onScreen`（`OnScreen \| null`，字段 `first`/`last`/`of`） | 有，出现在 `UserMessage`、`AssistantMessage`、`ToolUse`、`ToolResult`、`ToolGroup`、`CommandOutput`、`TurnDuration`、`InfoNotice` | 一样 |
| `session.append`（`message`、`door`、`origin`、`uuid`、`agentId?`；`message.isMeta?: true`） | 有 | 一样 |
| `session.end` 的 `reason`（`'clear' \| 'resume' \| 'logout' \| 'prompt_input_exit' \| 'other'`） | 有 | 一样 |
| `UiScrollTarget`（`{requestId} \| {key} \| 'start' \| 'end'`） | 有。声明写明 `requestId` 是「消息的 message id」，能指 transcript 里的消息；移动 transcript 行只限于回应使用者自己的输入 | 一样 |
| Pane：`placement: 'dock' \| 'inline'`、`bodyColumns`、`isFocused`、`scroll`、`view` | 有 | 字段一样，2.1.295 只多了注释 |
| `$.ui.open` 的 `columns`/`rows`，返回 `{isPlaced:true} \| {isPlaced:false, reason}`；`$.ui.panes()` 的 `isPlaced` | 有。没人请求时，终端宽 144 列才放；请求过一次后降到 110；`-p` 一律放置 | 一样 |
| `ui.close` 的 `origin.kind`（`plugin` / `person` / `unload`） | 有 | 一样 |
| `$.fs.read`（绝对路径可用；超过 4 MiB 就 reject；`{as:"bytes"}`） | 有 | 一样 |
| `$.fs.stat`（`kind`、`size`、`mtimeMs`、`isLink`、`realPath?`） | 有 | 一样 |
| `$.process.run(argv, {cwd, env, stdin, timeoutMs})`（不经 shell；stdout、stderr 各保留前 4 194 304 字节，`isStdoutTruncated`；默认超时 30 秒，最多 10 分钟） | 有 | 一样 |
| classic 事件的 `transcript_path`（`BaseHookInput`，所有 `classic.*` 都带，比如 `classic.SessionStart`） | 有 | 一样 |

2.1.295 新增、2.1.287 没有的，只有 `ui.notify`、`ui.selection`、`ui.fault`、`prompt.mention`、`prompt.autocomplete` 几个事件，以及 `AssistantMessage.isSummary`（compact 摘要行的标记），chat-toc 都没用到。渲染组件集合两版完全一样。

### 运行期实测（2.1.287，`-p`，本机 macOS）

- `classic.SessionStart` 拿到了 `transcript_path`。但 **会话里还没有任何消息时，这个文件还不存在**：`$.fs.exists` 返回 false，`$.fs.stat` 抛错。所以「文件还没写出」是新会话的正常状态，不能当成读取失败。
- `$.fs.stat` 和 `$.fs.read` 读 300 KB 的 jsonl 正常。读 5 MiB 的文件被 reject（`HooksError: … $.fs.read: … refuse…`）。
- `$.process.run(['sh','-c','tail -c +N "$1" | head -c M', …])` 分块读取正常。`cat` 5 MiB 文件时 stdout 正好截在 4 194 304 字节，`isStdoutTruncated: true`。
- `$.ui.open({id, columns})` 返回 `isPlaced: true`；`$.ui.close` 触发了 `ui.close`，`origin.kind` 是 `plugin`；`session.append` 收到 `hook-context` 行，带 `uuid`。
- 实现时要注意：`command.run` 的匹配器写 `{ command: '<name>' }`，不是 `{ name }`；写错了不报错，命令会落空，`-p` 里会提示「no command.run hook answered it」。

### 没有实测的

- `onScreen` 在全屏交互模式下实际怎么上报、`$.ui.scroll` 能不能跳到 assistant 行，`-p` 下测不出来，要交互 PTY，而且会真实调用模型。这两点本来就在「实测 requestId 与 transcript 行身份的对应」的范围里，在那里用 cmux 一起实测。
- 停靠的列数阈值只按声明核对过，没有在 2.1.287 的真实终端里量。
