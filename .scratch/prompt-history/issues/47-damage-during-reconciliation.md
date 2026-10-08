# 47: 对账因档案损坏失败时，提交应当给出损坏选项

**What to build:** 档案在 `capture-begin` 之后才被发现损坏（`capture-confirm` 报 `archive-integrity`）时，会留下一个 Pending Capture。之后每次提交都先对账，confirm 因损坏再次失败，`reconcilePending` 返回 `blocked`，提交路径（`hooks/register.tsx` 的 `settlePending` 分支）直接丢弃提交并提示「仍有未决的 Pending Capture 待对账」，走不到档案拦截。于是 status 承诺的「重新检查完整性 / 隔离并开始新档案 / 清除全部档案 / 禁用当前 Run 后继续（在下一次提交时选择）」永远不会出现，提示也不说档案损坏。

**Blocked by:** —

**Status:** resolved

- [x] 先写 plugin test：`capture-confirm` 以 `archive-integrity` 失败并留下 pending 后再提交，应给出与 `capture-begin` 报损坏时相同的四个选择，提示说明档案损坏；在原代码上确认变红。
- [x] 修复提交路径：对账因损坏类失败而受阻时，按损坏处理并给出选择；其余受阻原因行为不变。
- [x] 四个选择各自之后，pending 的去向正确：重新检查通过后照常对账，隔离与清除后不再欠账，禁用后放行。
- [x] PTY：Issue 40 用这条真实路径造隔离档案。

## Answer

- **修复**（`hooks/register.tsx`）：对账时 confirm 或 abort 以损坏类失败（`DAMAGE_FAILURES`）时，`reconcilePending` 把错误抛给调用方，而不是返回 `blocked`。
  - 提交路径因此按损坏处理：给出与 `capture-begin` 报损坏时相同的四个选择，对话框首句是「无法完成未决 Pending Capture 的对账」。
  - `enable` 遇到同样的情况，回复「无法完成未决 Pending Capture 的对账（archive-integrity），未启用采集。档案已损坏：下一次提交时可选择……」，不再说「无法读取」。这句提示与写 Collection Boundary 失败时共用 `DAMAGE_NEXT_SUBMISSION`。
  - 其余受阻原因行为不变。
- **plugin test**（`quarantine_archive.test.tsx`），5 项都在原代码上变红：
  - `damage met while settling a pending offers the same choices, not an endless reconciliation`（隔离后 pending 随旧 generation 离开，新 prompt 进入新 generation）；
  - `a recheck that passes over an owed pending settles it first`；
  - `a clear over an owed pending takes the pending with it`；
  - `disabling the Run over an owed pending lets the prompt through and keeps the pending`；
  - `enable that meets damage while settling a pending names the choices, not a read failure`。
- **一并修正的措辞**：`clear-all` 留下残留时，回复开头改为「逻辑删除已完成（切点已生效，旧记录不会再被读写），但物理清除未完成」，与 spec 用户故事 70、README 和 PH-DELETE-003 一致。`clear_all.test.tsx::a clear that leaves files behind says what is left and holds the archive` 先加断言、在原代码上变红。
- **PTY**：Issue 40 的 PH-CONTROL-001、PH-DELETE-001/002 与 PH-SEC 各场景都走这条真实路径造出损坏选择或隔离档案，两个版本都通过。
- **scenarios.json**：PH-STORE-006 引用上面 5 项 plugin test。

## Comments

### 2026-09-30 · 从 Issue 40 拆出

在 2.1.283 上探测 40 的 Q3（造隔离档案）时复现：`/exit` 后写坏档案中间一页，relaunch 后提交，prompt 进入会话、confirm 失败留下 pending；此后提交一律被「待对账」丢弃，status 却写着下一次提交时可以选择。先对账再判档案是有意的顺序（避免 pending 因档案标记永远无法处理），但没有照顾到对账本身因损坏失败。使用者还能用 `/prompt-history disable` 或 `clear-all` 脱身。使用者决定拆新票修代码，本票挡住 40。

### 2026-09-30 · 实现中并入

使用者决定把「clear-all 留下残留时的提示没有『逻辑删除完成、物理清除未完成』」并入本票修改，不另拆票。
