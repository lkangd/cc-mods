# 43: 会话内 `/resume` 之后提交的条目没有 Jump Target

**What to build:** 在同一进程里 `/resume` 回到本进程先前打开过的 session 后，再提交的新条目在 band 里也显示 `×`，不能跳转。Issue 22 已知的缺口只涉及被恢复 session 里原来的行（`SessionEnd` 时全部渲染行被记为「已消失」）；`/resume` 之后才渲染的新行不在其列，应当能跳转。

**Blocked by:** 22「绑定和失效 Jump Target」

**Status:** needs-triage

- [ ] 先诊断：新行为什么没有绑定（渲染行没收下、对齐失败，还是被判为已消失）。
- [ ] 按诊断结果决定修复范围，与使用者对齐后改为 ready-for-agent。

## Comments

### 2026-09-29 · 由 Issue 37 的探测发现

在 2.1.273 与 2.1.283 上都能复现（scratchpad 一次性脚本，隔离环境）：提交 A → `/exit` → `--resume S` → `/clear` → 提交 D → `/resume S` → 提交 E。展开 band 后，A 与 E 都带 `×`，D 折叠为「另一分支 · 1 条」；档案里 E 的父节点是 A，Run 不变，这部分是对的。A 的 `×` 属于 Issue 22 的已知缺口，E 的 `×` 不是。

另一次探测里，在 T3 仍存活时，由另一个终端 `--resume S`（并发，新 Run）看到的 band 中，同一个 E 能跳转：说明 E 的渲染文本与归档文本是对得上的。
