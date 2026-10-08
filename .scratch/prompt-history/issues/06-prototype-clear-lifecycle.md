# 原型验证 clear 生命周期

Type: prototype
Status: resolved
Blocked by: 01

## Question

Claude Code `2.1.273` 终端中执行 `/clear` 时，`command.run`、`classic.SessionEnd`、`classic.SessionStart`、`prompt.context`、`ui.render` 与 module instance 的实际事件顺序是什么；哪组信号能无重复、无漏记地插入清空边界，并与 `/compact`、reload 和进程退出区分？

## Comments

- 一次性实测资产：[`clear-lifecycle` 原型](../prototypes/clear-lifecycle/README.md)。插件清单与 hooks 已由 Claude Code `2.1.273` 的 `claude plugin validate` 验证通过；等待按 README 的交互脚本采集终端实测 trace 后再作决策。
- 首次启动未加载 hooks module；`2.1.273` 二进制中的默认值为关闭，原型必须以进程级 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 启动。README 已补充该 early-access 前置条件，不修改全局设置。

## Answer

Claude Code `2.1.273` 的一次完整交互实测记录了 228 个事件、2 个 module instance；原始证据见 [`trace.jsonl`](../prototypes/clear-lifecycle/trace.jsonl)，复现步骤与摘要器见 [`clear-lifecycle` 原型](../prototypes/clear-lifecycle/README.md)。

- **启动**：`module.loaded → register.called → engine.create → classic.SessionStart(source=startup) → session.start → prompt.context`。function-hooks 必须以进程级 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 开启。
- **`/clear`**：`command.run(clear).before → classic.SessionEnd(reason=clear) → classic.SessionStart(source=clear) → command.run(clear).after`；前后保持同一 module instance，且不触发 function-hooks `session.start`。旧、新 classic session id 不同。
- **clear 后上下文**：`prompt.context` 不在 clear 当下触发，而在 clear 后首个普通 prompt 提交时重算；`ui.render` 在整个过程中多次触发，不能作为边界或档案身份信号。
- **`/compact`**：`command.run(compact) → session.compact → classic.PreCompact → classic.SessionStart(source=compact) → classic.PostCompact → session.compact.after → command.run.after`；classic session id 不变，且没有 `SessionEnd`，因此不会误判为 clear。
- **reload**：`/reload-plugins` 后产生新 module instance，依次执行 `module.loaded → register.called → engine.create → session.start`，沿用 clear 后的 classic session id；没有 classic `SessionEnd/SessionStart`，但会重放大量 `ui.render`。
- **正常退出**：收到 `classic.SessionEnd(reason=prompt_input_exit)`，与 clear 明确可分。

决策如下：

1. 仅以 `classic.SessionEnd(reason=clear)` **原子写入一个 Clear Boundary 并结束当前 Conversation Segment**；使用旧 `session_id` 派生的幂等键，保证重试不重复。`command.run(clear)` 只可用于提前显示或诊断，不能作为持久化事实。
2. 随后的 `classic.SessionStart(source=clear)` **确认转换并关联新 classic session id**；若它重复则按新 session id 幂等。它不是第二个 Clear Boundary。即使进程在两事件之间退出，已写入的边界也不会丢失。
3. `source=compact`、plugin reload 的 function-hooks `session.start`、`ui.render` 重放和非 `clear` 的 SessionEnd 均不得创建 Clear Boundary。
4. `prompt.context` 仅是 clear 后首个对话的延迟佐证，不参与边界判断；module instance 只标识一次 load/reload，不能等同于 Run。
