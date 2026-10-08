# Clear 生命周期一次性原型

> THROWAWAY PROTOTYPE：只用于回答《原型验证 clear 生命周期》，不得迁入正式实现。

目标版本：Claude Code `2.1.273`。原型把 function-hooks 事件按实际发生顺序写入 `trace.jsonl`，不记录 prompt 正文。

## 启动

在仓库根目录运行：

function-hooks 在 `2.1.273` 中默认关闭，必须仅为本次进程启用 early-access 开关：

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude \
  --plugin-dir .scratch/prompt-history/prototypes/clear-lifecycle/plugin
```

不要写入全局设置；该环境变量只作用于这次启动。已有 `trace.jsonl` 会继续追加，以便观察插件 reload 与进程重启；需要全新样本时，手动移动旧文件后再启动。

## 最小实测脚本

在新开的 Claude Code 交互终端中依次执行：

1. `/clear-lifecycle-mark run-start`
2. 提交 `只回复 BASELINE`，等待完成。
3. `/clear-lifecycle-mark before-clear`
4. `/clear`
5. `/clear-lifecycle-mark after-clear`
6. 提交 `只回复 AFTER-CLEAR`，等待完成。
7. `/clear-lifecycle-mark before-compact`
8. `/compact`
9. `/clear-lifecycle-mark after-compact`
10. `/clear-lifecycle-mark before-reload`
11. `/reload-plugins`
12. `/clear-lifecycle-mark after-reload`
13. `/clear-lifecycle-path`
14. 正常退出 Claude Code（不要强杀进程）。

为区分异常退出，可另开一次短运行并强制结束；这不是判断正常退出契约的必要样本。

## 查看结果

```bash
node .scratch/prompt-history/prototypes/clear-lifecycle/summarize.mjs
```

重点核对：

- `/clear` 是否依次出现 `command.run(clear)`、`classic.SessionEnd(reason=clear)`、`classic.SessionStart(source=clear)`。
- `/clear` 前后 `moduleInstanceId` 是否相同，且是否没有新的 `session.start`。
- clear 后第一次对话前后，`prompt.context` 与 `ui.render` 的位置。
- `/compact` 是否可由 `command.run(compact)`、`session.compact`、classic compact 事件区分。
- `/reload-plugins` 后是否出现新的 `module.loaded`、`engine.create`、`session.start` 和新的 `moduleInstanceId`。
- 正常退出的 `classic.SessionEnd.reason`。

## 数据边界

- 仅写当前仓库 `.scratch/prompt-history/prototypes/clear-lifecycle/trace.jsonl`。
- 记录 session/transcript 标识、事件名、时间和有限元数据；不记录 prompt、上下文块正文或模型回答。
- logger 使用 `$.fs.read/write` 整文件重写，只适合短期原型，不能作为 prompt-history 的持久化实现。
