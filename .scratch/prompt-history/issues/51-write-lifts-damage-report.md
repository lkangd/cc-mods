# 51: 另一个 Run 的写入撤掉损坏报告并继续写坏档案

**What to build:** Issue 39 的 PTY 探测发现（2.1.283）：Run A 碰到损坏后，`$.store` 里已经记下 `archive-state: unavailable · archive-integrity`（带 generation）。随后同一项目的 Run B 提交，没有被拦下：B 往损坏的 generation 写入了自己的 Run 开始边界，又预写了 pending，prompt 进了会话，确认时才碰到损坏。

原因：
- 提交时先对账（`settlePending`），再补写欠下的 lifecycle 边界（`drainLifecycle`），最后才检查记录（`register.tsx` 的 `archiveFailure?.blocking`）；
- 坏页只在 Prompt Entries 表，边界写入成功，而 `appendBoundary`、`capture-begin` 等每次写入成功都会调用 `archiveRecovered()`，连损坏记录一起撤掉。

对 busy、只读这类故障，「写成功说明恢复了」成立；对损坏不成立。这违背 spec §13 与 PH-STORE-006「停止整个 generation 写入」，以及插件自己的注释「a damaged archive is never retried by writing to it」。

**Blocked by:** —

**Status:** resolved

- [x] 先写 plugin test，在原代码上确认变红：`$.store` 有另一个 Run 记下的当前 generation 的 `archive-integrity`，本 Run 欠一条 lifecycle 边界时提交，直接给出损坏的四个选项；使用者选择前没有 `boundary-append`、`capture-begin`，记录保留。
- [x] 当前 generation 的损坏记录在补写 lifecycle 与预写之前就拦下提交（已有 pending 的对账仍按 Issue 47 走损坏选项）；普通写入成功不撤掉损坏记录，只有重新检查通过、隔离或清除才撤掉。generation 已换掉的记录视为过期。
- [x] PTY：Issue 39 的 PH-STORE-006 中，第二个 Run 在写入任何东西之前被损坏对话框拦下。

## Answer

- **修复**（`hooks/register.tsx`）：
  - 提交时，如果记录里有损坏（`DAMAGE_FAILURES`）且不是使用者选择的重试，在对账、补写 lifecycle 与预写之前就给出损坏的选择。已有 pending 由损坏选项了结（Issue 47）。
  - `archiveRecovered()` 多一个参数 `'settles-damage'`：只有重新检查通过、隔离与清除传这个参数。其余写入成功时，若内存或 `$.store` 里的记录是损坏，就不撤掉。
  - 票面「generation 已换掉的记录视为过期」没有另外实现：隔离、清除与重新检查通过都会删除记录，不会留下过期的损坏记录。
- **plugin test**（`quarantine_archive.test.tsx`）：
  - `damage another Run found stops this Run before it writes anything`：在原代码上变红，没有出现对话框，prompt 直接进入；
  - `a write that succeeds past the damage does not lift it for the other Runs`：本 Run 选「禁用当前 Run 后继续」，写入停止边界后，损坏记录仍然保留。临时去掉 `archiveRecovered()` 的修改时，这一项失败。
- **PTY**：PH-STORE-006 中，第二个 Run 在写入任何东西之前就被损坏对话框拦下，损坏期间档案文件不变。
