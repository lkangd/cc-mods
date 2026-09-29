# 42: 新进程在第一次提交前 `/clear`，Clear Boundary 变成 Integrity gap

**What to build:** 新进程（普通启动、`--resume`、`--continue`）在第一次提交之前就执行 `/clear` 时，档案里记下的是一对 `integrity-gap`/`integrity-recovery`，没有 Clear Boundary；band 显示「Integrity gap：此前的记录无法证明与对话一致」。同一进程先提交一次、或者先跑一次 `/prompt-history status` 再 `/clear`，就会正常写入 Clear Boundary。要让「第一件事就是 `/clear`」也记下 Clear Boundary。

**Blocked by:** 16「以 Clear Boundary 划分 Conversation Segment」、32「Run 谱系跨 resume 延续」

**Status:** resolved

- [x] 新进程在第一次提交前执行 `/clear`，档案里恰好一个 Clear Boundary，没有 Integrity gap；之后的提交开新 segment 与新根分支。
- [x] 普通启动与 `--resume` 两条路径都覆盖。
- [x] plugin test 覆盖「SessionEnd(clear) 时本进程还没读过 locator」；真实 PTY 场景在两个版本上复现并通过。

## Answer

推测的根因成立：函数 hook 的 `session.start` 先于 bridge 的 classic SessionStart 发布 locator，所以新进程在第一次提交（或 status）之前 `startup.runId` 一直为空。SessionEnd(clear) 因此走 `defer()`，只在内存里记下 clear；随后的 SessionStart(clear) 找不到 `state.clear`，判为 `clear-unobserved`，记成 Integrity gap。

- **修复**：`applyLifecycleEvent` 在 `startup.runId` 为空时先 `refreshStartup($)` 读一次 locator，读不到才 `defer()`（`hooks/register.tsx`）。bridge 的 SessionEnd 也会删除 locator，但两个版本实测在 SessionEnd(clear) 里重读都能读到 Run。
- **plugin test**：`tests/clear_segment.test.tsx::a clear before this process has read its locator still writes the boundary`。`session.start` 时 locator 未发布、SessionEnd 前发布，档案应为 `run-started → clear → prompt`；修复前得到 `run-started → integrity-gap → integrity-recovery → prompt`。2.1.273 的测试包不能触发 classic 事件，这条在那里直接返回，由 2.1.283 覆盖。
- **PTY**：按对齐结果扩展 `PT-LIFE-001`，不新增场景 ID。在原流程之后先 `/exit`，普通重启后第一件事就 `/clear` 再提交；再 `/exit`，`--resume` 后重复一次。断言 Clear Boundary 夹在前后两条 prompt 之间、属于新条目的 Run，新条目没有父节点，`--resume` 沿用原 Run，档案里共 3 个 Clear Boundary、没有 Integrity gap。
- **契约修订**：scenarios.json 的 LIFE-001 增加一步、补充预期，并引用新的 plugin test；Issue 05 的 PT-LIFE-001 条目补一句（标「2026-09-29 Issue 42 修订」）。
- **验证**：
  - 撤掉修复后，扩展后的 LIFE-001 在两个版本上都红在「the /clear first thing after a restart left no Clear Boundary before the prompt」；只保留 `--resume` 一段时，红在 `--resume` 那条断言上；
  - 变异检查（2.1.283，修复在位）：新增的 4 条断言各反转一次，全部失败；
  - 正式入口 `release-evidence.sh --skip-gates --only PT-LIFE-001`（`build/evidence/20260929T131743Z/`）：2/2 PTY 通过，0 泄漏；报告因 partial 和工作树未提交按设计判 FAIL；
  - `verify-startup.sh` 通过（两个版本各 437 项 plugin test）。

## Comments

### 2026-09-29 · 由 Issue 37 的探测发现

在 2.1.273 与 2.1.283 上都能复现（scratchpad 一次性脚本，隔离环境）：

- 提交 A → `/exit` → 普通重启 → `/clear` → 提交 D：`run-started`(新 Run) → `integrity-gap` → `integrity-recovery` → D；没有 `clear`。
- 同样的流程换成 `--resume S`：`run-detached` → `run-attached` → `integrity-gap` → `integrity-recovery` → D。
- 对照：`--resume S` 后先提交 C 再 `/clear`，或先跑 `/prompt-history status` 再 `/clear`：`clear` 边界正常写入，没有 gap。

推测的根因（未验证）：进程还没读 locator 时 `startup.runId` 为空，`applyLifecycleEvent` 对 SessionEnd(clear) 走 `defer()`，只在内存里记下 `deferredClear`；随后 `source=clear` 的 SessionStart 在 `decideLifecycle` 里遇到 `state.clear` 为空，判为 `clear-unobserved`，记为 Integrity gap。提交与 status 都会先读 locator，所以能避开。修复前先按 `mattpocock-skills:diagnosing-bugs` 取证。

### Code review 修复（2026-09-29，round 1）

`.code-review/runs/20260929-220839/round-1/`，3 条：

- **LIFE-001 预期没说清三次 `/clear` 对应几个边界**（minor，已修）：scenarios.json 的预期改为「每次恰好一个，整个场景共 3 个」。
- **没有覆盖 `--continue`**（minor，驳回）：验收项只要求普通启动与 `--resume`。另用 scratchpad 探测补了一次「`--continue` 后第一件事就 `/clear`」，两个版本都得到 `run-attached → clear → prompt`，没有 gap，所以不再扩展场景。
- **classic 测试包的类型断言重复**（nit，记入 backlog）：这种重复在本票之前就有，本票只是沿用；见 `docs/code-review-backlog/20260929-classic-test-kit-cast-duplicated.md`。
