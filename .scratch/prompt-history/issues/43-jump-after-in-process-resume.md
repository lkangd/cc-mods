# 43: 会话内 `/resume` 之后提交的条目没有 Jump Target

**What to build:** 在同一进程里 `/resume` 回到本进程先前打开过的 session 后，再提交的新条目在 band 里也显示 `×`，不能跳转。Issue 22 已知的缺口只涉及被恢复 session 里原来的行（`SessionEnd` 时全部渲染行被记为「已消失」）；`/resume` 之后才渲染的新行不在其列，应当能跳转。

**Blocked by:** 22「绑定和失效 Jump Target」

**Status:** resolved

- [x] 先诊断：新行为什么没有绑定（渲染行没收下、对齐失败，还是被判为已消失）。
- [x] 按诊断结果决定修复范围，与使用者对齐后改为 ready-for-agent。
- [x] 修复：A（被恢复 session 原来的行）与 E 都能跳转；plugin test 与 PTY 在两个版本上覆盖。

## Answer

根因是渲染行没收下，helper 那一侧按设计工作。临时日志在两个版本上看到同一条链：

1. `/resume S` 之后，宿主在 classic SessionStart 之后用**原来的 `requestId`** 重放 A。
2. 这个 `requestId` 在 SessionEnd 时已记入「已消失」，`recordRow` 不再收它，于是 `drawnRows` 只剩 `[E]`。
3. `branch-match --rows` 只拿到 E 这一行。E 的父节点 A 没有行持有，链就断了（`src/prompt_history_helper.c`：「an ancestor no row holds breaks a chain」），helper 答 `match: none`。

另一个终端并发 resume 时收下的是 `[A, E]`，所以能跳转。交接里「本进程对 Run 或 locator 的认识落后于宿主」的猜测不成立：`startup.sessionId` 与 Run 都已正确切回 S。

- **范围（与使用者对齐）**：A 和 E 一起修，也就收掉了 Issue 22「实现中修订」里记下的已知代价。
- **宿主时序（两个版本实测）**：SessionEnd 之后、下一个 classic SessionStart 之前，宿主把离开的 transcript 再画一次（resume 与 clear 都是这样）；resume 的重放发生在 SessionStart 之后。
- **修复**（`hooks/register.tsx`）：`forgetDrawnRows` 在 SessionEnd 时照旧把已画的行记为已消失；`forgetDrawnRows` 收到 reason，是 `clear` 或 `resume`（之后必有 SessionStart）时，同时打开「退出中」窗口（hook 本身不按 reason 分支，`artifact_static` 守着这一点），窗口内画的行一律不收。classic SessionStart（任何 source）关上窗口，并清空 `seenRows` 与 `goneRows`，于是新 session 画出的行重新收下。其他 reason 不开窗口，行为与修复前相同。
- **plugin test**（`tests/jump_target.test.tsx`；2.1.273 的测试包触发不了 classic 事件，两条都直接返回，由 2.1.283 覆盖）：
  - `rows replayed by an in-process resume back into a drawn session are tied again`：helper 的 mock 照真实规则只从根开始放行。修复前 stdin 只有 E 一行，A 和 E 都是 `×`。
  - `rows drawn on the way out of a clear are never tied, even once the next session starts`：守住「退出中」窗口，本进程画过的行与没画过的行各一条。它们后面有新 session 的行，所以 `vanishedRows` 救不了它们。
- **PTY**：扩展 `PH-BRANCH-001`，不新增场景 ID。会话内 `/resume` 之后展开 band，断言 A–D 与 F 每条只出现一次，而且都能跳转。
- **契约修订**：scenarios.json 的 BRANCH-001 补充预期，并引用上面两条 plugin test；Issue 05 的 PH-BRANCH-001 条目补一句（标「2026-09-29 Issue 43 修订」）；Issue 22 的两处已知代价注明已修。
- **验证**：
  - 一次性 PTY 探测（A → `/exit` → `--resume S` → `/clear` → D → `/resume S` → E）：修复前两个版本都是 A、E 带 `×`。修复后两个版本都没有 `×`，点击 A 和 E 都落到 transcript 上、band 收起，没有 `deny`。
  - 撤掉修复后，扩展后的 BRANCH-001 在 2.1.283 上红在「the in-process /resume did not bind the shared history once」。
  - 变异检查（2.1.283）：不在 SessionStart 重置，第一条 plugin test 变红；改在 SessionEnd 重置，或者窗口内照收没见过的行，第二条变红。
  - 正式入口 `release-evidence.sh --skip-gates --only PH-BRANCH-001`（review 修复后为 `build/evidence/20260929T161959Z/`）：2/2 PTY 通过，0 泄漏；报告因为是 partial 且工作树未提交，按设计判 FAIL。
  - `verify-startup.sh` 通过（两个版本各 439 项 plugin test）。

## Comments

### 2026-09-29 · 由 Issue 37 的探测发现

在 2.1.273 与 2.1.283 上都能复现（scratchpad 一次性脚本，隔离环境）：提交 A → `/exit` → `--resume S` → `/clear` → 提交 D → `/resume S` → 提交 E。展开 band 后，A 与 E 都带 `×`，D 折叠为「另一分支 · 1 条」；档案里 E 的父节点是 A，Run 不变，这部分是对的。A 的 `×` 属于 Issue 22 的已知缺口，E 的 `×` 不是。

另一次探测里，在 T3 仍存活时，由另一个终端 `--resume S`（并发，新 Run）看到的 band 中，同一个 E 能跳转：说明 E 的渲染文本与归档文本是对得上的。

### Code review 修复（2026-09-29，round 1）

`.code-review/runs/20260929-235353/round-1/`，4 条：

- **退出窗口内没见过的行仍会被收下**（minor，已修）：窗口内一律不收；窗口只在 `clear` 与 `resume` 时打开，其他 reason 保持修复前的行为。第二条 plugin test 加了一条本进程没画过的行。
- **Issue 37 Q8 仍说 BRANCH-001 不断言会话内 `/resume` 之后的跳转**（minor，已修）：注明已由本票修复。同一条里提到的 README 不承诺项也已删除。
- **resume 测试的 helper mock 另写了一份对齐**（minor，已修）：改用同文件已有的 `alignArchive`，它同样只从根开始放行。
复核时出现过两次偶发失败，都与本票无关：

- 2.1.273 在 `--continue` 那一步报「did not bind the shared history once」。探测显示，`--continue` 与 `--resume` 启动时都没有 SessionEnd，窗口不会打开；之后同一版本又连续通过两次。
- 2.1.283 在三个 PTY 并行时，等 status 回答超时。单独重跑后，两个版本都通过。

- **classic 测试包的类型断言重复**（nit，记入 backlog）：沿用既有写法，追加到 `docs/code-review-backlog/20260929-classic-test-kit-cast-duplicated.md`。
