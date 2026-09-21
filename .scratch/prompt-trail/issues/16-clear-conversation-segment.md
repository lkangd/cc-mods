# 16: 以 Clear Boundary 划分 Conversation Segment

**What to build:** 让 `/clear` 在同一 Run 中准确结束旧 Conversation Segment、创建一个可见边界并开始无父 prompt 的新 Segment，同时不把 compaction 或 UI 重放误判成清空。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** ready-for-agent

- [ ] 只有 `classic.SessionEnd(reason=clear)` 原子写入一个 Clear Boundary，并结束当前 Conversation Segment。
- [ ] Clear Boundary 使用旧 classic session ID 派生幂等键；重复事件或重试不会产生第二个边界。
- [ ] `classic.SessionStart(source=clear)` 只关联新 classic session ID 和新 Conversation Segment，不写第二个 Clear Boundary。
- [ ] clear 前后保持同一 Run；clear 后首个 Prompt Entry 没有 clear 前 Prompt Entry 的逻辑父节点。
- [ ] 进程在 SessionEnd 与 SessionStart 之间退出时，已写入边界保留，并能在恢复时明确表示未完成转换。
- [ ] `/compact`、`source=compact`、Pre/PostCompact、延迟 `prompt.context`、function-hook `session.start`、reload 和 `ui.render` 重放均不创建 Clear Boundary。
- [ ] 时间线按 sequence 在 clear 前后显示恰好一行边界，并保持两侧 Prompt Entries 的原顺序。
- [ ] slash `/clear` 本身不创建 Prompt Entry。
- [ ] plugin test 使用记录的 lifecycle 序列验证幂等状态机；真实 PTY 复验 `/clear`、`/compact`、reload 和中断场景。
