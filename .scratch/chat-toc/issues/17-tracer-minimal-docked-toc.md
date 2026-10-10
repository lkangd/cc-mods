# 17: 自动停靠的最小目录

**What to build:** 全屏会话启动时，chat-toc 的 Pane 自动停靠在 transcript 右侧，列出当前会话里每一条普通 prompt（卡片布局，只画用户侧「你 · 时间」加最多 2 行原文），点击就跳回对话里的那条 prompt。会话继续时目录跟着增长。这是贯穿「读 transcript → 组 Turn group → 画 Pane → 跳转」的第一条完整路径，后续票都在它上面扩展。

规格见 [chat-toc MVP](../spec.md) §1、§2、§3、§5、§7。

**Blocked by:** 无（可以立即开始）

**Status:** ready-for-agent

- [ ] 插件根、`plugin.json`（`chat-toc`、`0.1.0`）、`/chat-toc` 命令注册齐全，在 2.1.287 与当前版本上 `claude plugin validate` 0 错误
- [ ] 全屏会话启动时（`session.start`）自动打开停靠 Pane；`$.ui.panes()` 里已有时不重复打开
- [ ] 从 classic 事件拿 `transcript_path`，文件 ≤4 MiB 时用 `$.fs.read` 读取，沿 `parentUuid` 取当前分支
- [ ] `origin.kind: "human"` 的 user 行各自开组；完全相同的 prompt 各自成组
- [ ] 卡片布局用户侧：暗色头行「你 · M月D日 HH:MM」（时间读不到就只写「你」）加最多 2 行原文，每行一个 `plain` Button、同侧共用跳转、hover scope 整侧连亮
- [ ] 点击用户侧以 `block: start` 跳到该 prompt（`requestId` 精确匹配 uuid），`"placeholder"` 一律忽略
- [ ] 文件还不存在时正文只有一行「本会话还没有对话」，第一条 User input 落盘后出现条目
- [ ] `session.append`（无 `agentId`）与 `turn.complete` 触发重读：尾随 300 ms、读时合并、`fs.stat` 大小不变就跳过、`turn.complete` 后 +1.5 s 再查一次
- [ ] `claude plugin test` 套件建立，覆盖开组与绘制；在两个版本上手动冒烟一次（CT-COMPAT-001 的雏形）
