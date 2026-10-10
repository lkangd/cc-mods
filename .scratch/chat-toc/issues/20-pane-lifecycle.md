# 20: Pane 生命周期

**What to build:** 使用者能控制目录的去留：点 ✕ 后本会话不再弹出，`/chat-toc` 随时重新打开或提前聚焦（从不关闭），`/clear`、`/resume` 之后目录随新会话重建并再次自动弹出，热重载不重复打开，也不受其他插件 Pane 开关的影响。

规格见 [chat-toc MVP](../spec.md) §2。

**Blocked by:** 17（自动停靠的最小目录）、18（独立 verifier 与 PTY 验收驱动）

**Status:** ready-for-agent

- [ ] 只有本 Pane id、`origin.kind === person` 的 `ui.close` 才在 `$.state` 记「本会话已关闭」；不设 `closeOnEscape`
- [ ] `/chat-toc`（无参数、`immediate: true`）：关着就打开；开着（前台或后台标签）就提到前台并 `focus: true`；从不关闭；对已开 id 再 open 不切标签时退化为只聚焦
- [ ] `classic.SessionStart` 的 `source` 为 `clear` 或 `resume` 时，按同样条件再次自动打开，并换读新的 `transcript_path`；`/clear` 后目录清空重建、不画分隔线
- [ ] 热重载后 `session.start` 再触发时，先查 `$.ui.panes()` 与关闭标记，不重复打开
- [ ] 其他插件（如内置 diff）的 Pane 开关不影响关闭标记；chat-toc 自动弹出时照宿主规则在前台，被挤到后台或回到前台时不做任何事
- [ ] PTY 验收 CT-LIFE-001、CT-LIFE-002 在两个版本上通过
