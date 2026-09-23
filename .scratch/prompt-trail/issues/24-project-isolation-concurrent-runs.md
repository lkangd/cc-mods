# 24: 隔离项目并支持并发 Run

**What to build:** 让多个项目、worktree 和同项目并发 Claude Code 进程安全共存：项目物理隔离，同项目 Run 保持独立 Active Branch 并共享确定的事件顺序。

**Blocked by:** 14「切换 Run collection mode」、17「跨 reload 与重启维护 Run 身份」、18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** ready-for-agent

- [ ] 每个规范项目根使用独立 SQLite 数据库；数据库只持久保存项目 hash，不保存绝对根路径。
- [ ] 同一 Git 仓库的子目录和 symlink 归并到真实根，不同 worktree 得到不同 Project Timeline，移动后的路径视为新项目。
- [ ] 非 Git 项目使用规范启动目录作为项目根，并遵循同样的 consent 与隔离规则。
- [ ] 两个同项目 Run 同时提交时，各自保持独立 Active Branch，并通过短事务取得唯一、连续、项目级单调 sequence。
- [ ] 至少 24 个并发 writer 全部提交；幂等重试不重复事件，相同 prompt 文本的不同事件保持独立。
- [ ] disable 一个 Run 不改变另一个 Run 的 mode、pending、Active Branch 或写入能力。
- [ ] 同一 Run 同一时刻至多一个存活进程接入；双终端并发 resume 同一会话时后到者成为新 Run（Issue 32），两个 Run 各自保持 Active Branch。
- [ ] 一个项目的 locator、权限、I/O 或数据库故障不影响另一个项目的数据库和健康状态。
- [ ] `status` 只显示当前运行时项目绝对路径和对应数据库路径，不泄漏其他 Project Timelines。
- [ ] helper black-box concurrency/isolation tests 与双 PTY Run 场景验证顺序、分支、开关和物理隔离。

## Comments

### 2026-09-23 · Run 定义修订

Issue 32 把 Run 从「一个进程」改为「一条会话谱系」。本票的「并发 Run」仍指同一项目中同时接入的不同 Run；同一 Run 不会被两个进程同时接入（见新增条目）。
