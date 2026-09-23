# 33: 接续 session 沿用原 Run 与 Active Branch

**What to build:** 在 Claude Code 2.1.280 中，后台 `/fork` 之后，主线程会换到一个新的 classic session 继续：旧 transcript 末尾写一条 `continued-in`，新 session 由另一个进程承载。bridge 目前把它当作索引里查不到的会话，于是新开 Run；新 session 也没有分支记录。本票要让接续出来的 session 认回原 Run，并沿用原 session 的 Active Branch。

**Blocked by:** 18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** ready-for-agent

- [ ] bridge 能认出接续：新 session 的 SessionStart 输入里没有来源 session，要从旧 transcript 的 `continued-in` 记录（或宿主提供的等价信号）找到来源 session。认出后沿用来源 session 所属的 Run，写入会话索引，并按 Issue 32 的规则写 `run-attached`。认不出时照旧新开 Run，不猜测。
- [ ] 接续 session 的第一次对齐能拿到来源 session 的 Active Branch，作为已存分支使用，所以在时间线上显示为同一 Run 的续接，而不是「从 Run X 分出」。
- [ ] 接续前后做过 `/compact`（它会让 `$.session.messages()` 里不再有 compact 之前的 user 行）时，按 Issue 18 的规则走「已存分支被 transcript 否定 → 人工确认」，不再静默开根。
- [ ] 同一 Run 同一时刻至多一个存活进程接入的约束不被破坏：旧进程是否仍接入要先核实，再决定写不写 `run-detached`。
- [ ] 真实 PTY 在 2.1.280 上覆盖：`/fork` 之后主线程继续提交、`/fork` 之后再 `/compact` 再提交。

## Comments

### 2026-09-23 · 从 Issue 18 验收中拆出

Issue 18 的 PTY 验收（2.1.280）中观察到的事实：
- `/fork 只回复 BG` 之后，主线程 session `208b3bcd` 的 transcript 末尾出现 `continued-in`，对话在新 session `a7504e5c` 中继续，由新进程承载。bridge 为它新开了 Run `5bbc7862`。
- 承载新 session 的进程启动约 10 秒后，bridge 才发布它的 locator。Issue 18 已经让提交和展开时间线时补读 locator 与档案。
- 在新 session 中 `/compact` 后提交 R3，R3 成为新 Run 的根：compact 清掉了 R1、R2，新 session 又没有已存分支，按规则静默开根，与 R2 的链接因此丢失。
