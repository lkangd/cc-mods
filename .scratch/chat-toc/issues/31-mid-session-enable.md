# 31: 会话中途启用后，目录立即列出已有对话

**What to build:** 在已经运行的会话里启用 chat-toc（不重启），Pane 弹出时就列出本会话已有的对话，不再是一片空白。

**Blocked by:** 无

**Status:** done

## 问题

使用者反馈：在运行中的会话里启用 chat-toc 后，右侧 Pane 弹出，但内容为空，要重启会话才有内容。

原因：transcript 路径只从 `classic.SessionStart` 取（`register.tsx`），中途加载时宿主只触发 `session.start`（debug log：`session.start: raised for chat-toc (loaded later)`），路径一直是 `''`，`load` 直接返回，`source` 停在 `unknown`，面板既无条目也无说明。提交下一条消息也不会恢复：chat-toc 不读 `classic.UserPromptSubmit` 带来的路径。

## 已定的决定（2026-10-12 grilling）

- `session.start` 时推算路径：`$.session.id()`（即 transcript 文件名）+ `$.session.cwd()` + 配置目录（`$.env.get('CLAUDE_CONFIG_DIR')`，没有则 `HOME/.claude`；Windows 取 `USERPROFILE`），然后立即读。
- 目录名照搬宿主规则（两版二进制读出并实测）：`[^a-zA-Z0-9]` 每个 UTF-16 单元换成 `-`；结果超过 200 字符时取前 200 个，再接 `-` + `Math.abs(javaHash(cwd)).toString(36)`，`javaHash` 为 `e=(e<<5)-e+charCode|0`。依赖了宿主未公开的规则，使用者接受这个风险；不做 `find` 搜索。
- 之后任何 classic 钩子（`SessionStart`、`UserPromptSubmit` 等）带来的 `transcript_path` 与当前不同，就以它为准，`forget()` 后从头重读。
- 推不出路径时，Pane 显示一行「提交下一条消息后显示目录」，等 classic 钩子补上路径。
- 推出的路径文件不存在，按现有「新会话还没有文件」处理。

## 步骤

- [x] 测试先行：目录名推算的纯函数（短路径、含中文与空格、超过 200 字符的非 ASCII 路径，期望值取自 spike 的 `sanitize.py` 实测）
- [x] 测试先行：`session.start` 无 classic 路径时按推算路径读出目录；classic 路径不同时改用它并重读；推不出时显示兜底文字
- [x] 实现
- [x] 验收契约新增 `CT-LIFE-007`（`CT-LIFE-006` 已被热重载占用）：两种启用路径——`/plugin` 界面启用（关闭菜单时自动 reload），以及 `claude plugin enable` 加 `/reload-plugins`——都在不重启的情况下列出已有对话；两版宿主 PTY 验收
- [x] 更新 `docs/agents/mod-host-gotchas.md`：中途加载只触发 `session.start`；`$.session.id()` 是文件名；目录名规则

## Comments

- 2026-10-12 spike（两版行为一致，证据在当时 scratchpad 的 `spike/runs/A*`）：`$.session.id()`、`cwd()`、`root()`、`$.env.get('CLAUDE_CONFIG_DIR')` 都可用；`classic.UserPromptSubmit` 带 `transcript_path`；`classic.Stop` 在未登录世界里不触发，未确认。
- 2026-10-12 实现（分支 `chat-toc/31-mid-session-enable`）：`hooks/locate.ts` 推算路径，`session.start` 在没有已知路径时调用；`classic.SessionStart` 与 `classic.UserPromptSubmit` 的路径不同就替换并从头重读；`load` 读完发现路径已换就丢弃结果。`classic.Stop` 没接（未确认带路径，`UserPromptSubmit` 已够）。PTY：`tests/acceptance/ct_mid_session.py` 在 2.1.287 与 2.1.295 上 cli、ui 两种启用方式都通过；同一脚本对 0.1.1 的代码失败（对照）。CLI 启用后要等宿主的设置监听生效（debug log `Settings changed from userSettings`）再 `/reload-plugins`，否则 reload 仍当它禁用。
