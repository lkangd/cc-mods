# 52: 档案拒绝写入时 helper 报成 capture-conflict

**What to build:** Issue 39 的 PTY 探测发现（2.1.283）：宿主运行中，给档案的 `.sqlite3` 与 `-wal` 加 `chflags uchg` 后提交，预写失败，对话框写「类别：capture-conflict · 范围：本 Run（其他 Run 不受影响）」。

原因：helper 预写的 `INSERT` 只要 `sqlite3_step` 失败，就以 `capture-conflict` 为默认类别，再交给 `archive_failure()` 按 SQLite 错误码改写。`archive_failure()` 只认 BUSY/LOCKED、FULL（含 ENOSPC）、CORRUPT/NOTADB；写被拒（`SQLITE_READONLY`、`SQLITE_PERM`，或 `SQLITE_IOERR` 且 errno 为 EPERM/EACCES/EROFS）落到默认值。

后果：
- 类别误导：`capture-conflict` 本指 event ID 冲突、同一事件内容不一致；
- 范围错误：`archive-read-only` 是共享故障，应记录在案并拦住项目里所有 Run，`capture-conflict` 却只算本 Run 的失败。

**Blocked by:** —

**Status:** resolved

- [x] 先写 helper 单测，在原代码上确认变红：档案文件加 `uchg` 后执行 `capture-begin`，类别为 `archive-read-only`，没有预写任何东西。
- [x] `archive_failure()` 把写被拒归为 `archive-read-only`，所有 helper 调用点都适用；`capture-conflict` 只留给约束冲突。重新构建制品。
- [x] PTY：Issue 39 的 PH-FAIL-001 断言类别为 `archive-read-only`、范围为本项目所有 Run。

## Answer

- **修复**（`src/prompt_history_helper.c`）：`archive_failure()` 把 `SQLITE_READONLY`、`SQLITE_PERM`，以及 `SQLITE_IOERR` 且 errno 为 EPERM/EACCES/EROFS，归为 `archive-read-only`，所有 helper 调用点都适用。`capture-conflict` 只剩约束冲突这一种来源。制品由 `scripts/build-artifacts.sh` 重新构建（helper、bridge、manifest、`hooks/artifact.ts` 与生成的头文件）。
- **helper 单测**：`helper_protocol.HelperProtocolTests.test_an_archive_that_refuses_writes_is_read_only_and_stages_nothing`。档案与 WAL 加 `uchg` 后执行 `capture-begin`，类别为 `archive-read-only`，解除后没有 pending。它在原代码上报 `capture-conflict`。
- **PTY**：PH-FAIL-001 断言类别为 `archive-read-only`、范围为「本项目所有 Run」。故障现在会记录在案，解除 `uchg` 后，下一次提交先被拦下，选「重试」后进入档案。
