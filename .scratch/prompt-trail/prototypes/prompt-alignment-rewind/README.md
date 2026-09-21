# Prompt 对齐与回退一次性原型

> THROWAWAY PROTOTYPE：只用于回答《原型验证 prompt 对齐与回退分支》，不得迁入正式实现。

目标版本：Claude Code `2.1.273`。本原型验证三件事：

1. `prompt.submit(origin=composer)` 是否与会话中的真人 prompt 一一对应，并排除 tool-result、通知等内部 `user` role 流量。
2. `ui.render(UserMessage)` 的 `requestId` 在重绘、reload、rewind、resume 时如何变化，能否只作为临时 Jump Target。
3. 同进程 reload、`/rewind`、Esc Esc、`/fork`、resume 与 `--fork-session` 是否留下足够事件来恢复 Run、会话前缀和分支父节点。

## 数据边界

- Trace 位于本目录的 `traces/`，每个 Claude Code 进程一个 JSONL 文件，避免 `/fork` 并发覆盖。
- Trace **会保存测试 prompt 原文**，但不保存 assistant 正文；只使用下面的合成文本，不要输入真实敏感内容。
- 原型仅使用本地文件和 `node` 子进程读取宿主 PID，不访问网络、不修改全局设置。

## 启动

从仓库根目录启动一个新的交互终端：

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude \
  --plugin-dir .scratch/prompt-trail/prototypes/prompt-alignment-rewind/plugin
```

function-hooks 在 `2.1.273` 中默认关闭；环境变量只作用于本次进程。

## A. 对齐、reload 与 rewind

按顺序执行：

1. `/prompt-trail-probe-mark run-start`
2. 提交 `PT-A：只回复 ACK-A`，等待完成。
3. 再次提交完全相同的 `PT-A：只回复 ACK-A`，等待完成。
4. 粘贴并提交一个两行 prompt，等待完成：

   ```text
   PT-B 第一行
   PT-B 第二行：只回复 ACK-B
   ```

5. `/prompt-trail-probe-snapshot baseline`
6. `/cost`（验证纯 slash command 不会被误记为 Prompt Entry）。
7. `/reload-plugins`
8. `/prompt-trail-probe-mark after-reload`
9. `/prompt-trail-probe-info`；确认 reload 前后 `probeRunId` 没变。
10. `/rewind`，在两个同名 `PT-A` 中选择**较早的一个**，选择 **Restore conversation**。
11. Claude Code 会把所选旧 prompt 放回输入框；整段替换为 `PT-C：回退分支，只回复 ACK-C` 并提交。
12. `/prompt-trail-probe-snapshot after-rewind`
13. `/prompt-trail-probe-mark before-esc-esc`
14. 在空输入框按两次 Esc，确认打开与 `/rewind` 相同的菜单，选择 **Never mind**。
15. `/prompt-trail-probe-mark after-esc-esc`
16. `/fork 只回复 PT-FORK-ACK`；等待后台副本完成或至少成功启动。
17. `/prompt-trail-probe-info`，记下父会话的 `sessionId`。
18. 正常退出 Claude Code。

## B. Resume

用 A 阶段记下的 `sessionId` 启动：

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude \
  --resume <sessionId> \
  --plugin-dir .scratch/prompt-trail/prototypes/prompt-alignment-rewind/plugin
```

依次执行：

1. `/prompt-trail-probe-mark resumed`
2. 提交 `PT-D：恢复后，只回复 ACK-D`。
3. `/prompt-trail-probe-snapshot after-resume`
4. `/prompt-trail-probe-info`
5. 正常退出。

## C. CLI fork

再次从 A 阶段的 `sessionId` 建立显式 fork：

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude \
  --resume <sessionId> \
  --fork-session \
  --plugin-dir .scratch/prompt-trail/prototypes/prompt-alignment-rewind/plugin
```

依次执行：

1. `/prompt-trail-probe-mark cli-fork`
2. 提交 `PT-E：CLI fork 后，只回复 ACK-E`。
3. `/prompt-trail-probe-snapshot after-cli-fork`
4. `/prompt-trail-probe-info`
5. 正常退出。

## 查看结果

```bash
node .scratch/prompt-trail/prototypes/prompt-alignment-rewind/summarize.mjs
```

重点核对：

- 每条真人输入是否恰有一个 `prompt.submit.before(origin=composer)` 和一个 `classic.UserPromptSubmit.before(source=user)`。
- 重复 prompt 是否有不同 `UserMessage.requestId`；reload/resume 重绘是否复用相同 id，而不产生新的 `prompt.submit`。
- rewind 后首次 `prompt.submit.before` 的 transcript 前缀是否已缩短；`prompt.fill` 是否暴露被选中的旧 prompt；重复文本是否仍能唯一确定父节点。
- 同进程 reload 是否只更换 module instance 而保留 `probeRunId`；resume、后台 `/fork` 与 CLI fork 是否获得新 Run，并出现可解释的 session source/session id。
- Esc Esc 是否只打开同一 rewind UI，而不伪造 `command.run(rewind)` 或 Prompt Entry。
