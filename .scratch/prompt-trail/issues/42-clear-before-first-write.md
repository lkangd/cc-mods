# 42: 新进程在第一次提交前 `/clear`，Clear Boundary 变成 Integrity gap

**What to build:** 新进程（普通启动、`--resume`、`--continue`）在第一次提交之前就执行 `/clear` 时，档案里记下的是一对 `integrity-gap`/`integrity-recovery`，没有 Clear Boundary；band 显示「Integrity gap：此前的记录无法证明与对话一致」。同一进程先提交一次、或者先跑一次 `/prompt-history status` 再 `/clear`，就会正常写入 Clear Boundary。要让「第一件事就是 `/clear`」也记下 Clear Boundary。

**Blocked by:** 16「以 Clear Boundary 划分 Conversation Segment」、32「Run 谱系跨 resume 延续」

**Status:** ready-for-agent

- [ ] 新进程在第一次提交前执行 `/clear`，档案里恰好一个 Clear Boundary，没有 Integrity gap；之后的提交开新 segment 与新根分支。
- [ ] 普通启动与 `--resume` 两条路径都覆盖。
- [ ] plugin test 覆盖「SessionEnd(clear) 时本进程还没读过 locator」；真实 PTY 场景在两个版本上复现并通过。

## Comments

### 2026-09-29 · 由 Issue 37 的探测发现

在 2.1.273 与 2.1.283 上都能复现（scratchpad 一次性脚本，隔离环境）：

- 提交 A → `/exit` → 普通重启 → `/clear` → 提交 D：`run-started`(新 Run) → `integrity-gap` → `integrity-recovery` → D；没有 `clear`。
- 同样的流程换成 `--resume S`：`run-detached` → `run-attached` → `integrity-gap` → `integrity-recovery` → D。
- 对照：`--resume S` 后先提交 C 再 `/clear`，或先跑 `/prompt-history status` 再 `/clear`：`clear` 边界正常写入，没有 gap。

推测的根因（未验证）：进程还没读 locator 时 `startup.runId` 为空，`applyLifecycleEvent` 对 SessionEnd(clear) 走 `defer()`，只在内存里记下 `deferredClear`；随后 `source=clear` 的 SessionStart 在 `decideLifecycle` 里遇到 `state.clear` 为空，判为 `clear-unobserved`，记为 Integrity gap。提交与 status 都会先读 locator，所以能避开。修复前先按 `mattpocock-skills:diagnosing-bugs` 取证。
