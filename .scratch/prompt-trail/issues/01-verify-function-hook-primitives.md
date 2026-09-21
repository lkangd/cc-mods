# 核实生命周期、滚动与持久化原语

Type: research
Status: resolved
Blocked by:

## Question

Claude Code `2.1.273` 的 function-hooks API 能否可靠支持 Prompt Trail 所需的运行期与 `/clear` 边界识别、`AbovePrompt` 连续滚动及键盘/鼠标交互、跨运行持久化与按项目隔离？官方声明中的具体事件、字段、组件、存储语义、容量与安全限制是什么，哪些行为仍必须通过原型验证？

## Answer

- `engine.create` 每次插件加载或 reload 执行一次，`session.start` 每进程一次且明确不因 `/clear` 触发；模块闭包跨 `/clear` 保留是强推断，但仍需用 `moduleInstanceId` 原型验证。
- `/clear` 的契约信号是 `classic.SessionEnd.reason === "clear"` 与 `classic.SessionStart.source === "clear"`；`command.run(command === "clear")` 可作为候选早期信号。历史 issue 显示运行时曾偏离契约，因此必须在 2.1.273 实测，不能把 `other` 或 `startup` 猜成 clear。
- `AbovePrompt` 在内容超过 `maxRows` 后由引擎提供滚动窗口；`AbovePrompt.scroll`、`ui.scroll`、`ui.focus`、`Button` 与 terminal `onKey` 覆盖滚轮、方向键、PageUp/PageDown、Home/End、焦点和点击。没有通用 `Scroll` 组件；列表变化后需 `$.ui.invalidate("ui.render")`。焦点、追加后位置和窄终端行为仍需原型验证。
- `/clear` 边界应保存在 Prompt Trail 自绘时间线中；没有专用 `PreClear`/`PostClear` 或向原生 transcript 插入消息的 API。`$.ui.log` 会进入 debug log，不适合作为隐私友好的边界实现。
- `$.store` 是插件级、跨 session/reload 的 JSON 文件存储，支持 `get/set/delete/keys`，整个 store 上限 4 MiB，并以普通本地明文 JSON 读写；无加密、TTL、分页或增量追加保证。它不适合作为永久、无上限的完整 prompt 档案，只适合小型索引和元数据。
- 因此：滚动式时间线在 API 契约上可行；可靠 clear 生命周期必须原型验证；永久完整文本需要另选本地存储后端并单独确定安全策略。

### Sources

- [Official Mods README](https://github.com/anthropics/claude-code/blob/main/mods/README.md)
- [Claude Code 2.1.273 function-hook declarations](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)
- [Mods/function hooks issue](https://github.com/anthropics/claude-code/issues/91870)
- [`/clear` and SessionEnd issue](https://github.com/anthropics/claude-code/issues/6428)
- [`/clear` and SessionStart issue](https://github.com/anthropics/claude-code/issues/34072)
- [Desktop `/clear` field mismatch](https://github.com/anthropics/claude-code/issues/76704)
- [Claude Code security](https://code.claude.com/docs/en/security.md)
