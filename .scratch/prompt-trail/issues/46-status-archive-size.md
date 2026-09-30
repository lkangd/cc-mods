# 46: status 应当显示活动档案的大小

**What to build:** spec 用户故事 9（「`/prompt-history status` 显示 consent、Run collection mode、档案健康、历史 Gap、运行时项目路径、数据库路径和大小」）与 PT-CONTROL-001 的 expected（「只显示 consent、Run 模式、健康、Gap 提示、项目路径、数据库路径与大小」）都要求 status 给出数据库大小。实际上 `archive:` 行只有 `ready · <路径>`，只有隔离档案带字节数。

**Blocked by:** —

**Status:** resolved

- [x] 先写 helper 单测：`archive-status` 返回活动档案的字节数（`.sqlite3`、`-wal`、`-shm` 之和），没有档案时为 0；在原代码上确认变红。
- [x] 先写 plugin test：档案就绪时 status 的 `archive:` 行为 `ready · <路径> · N bytes`，字节数取自 `archive-status`；读不到时写 `unknown`，不写 0。在原代码上确认变红。
- [x] 修改 helper 与 status，重建 artifacts；PT-CONTROL-001 断言该字段。

## Answer

- **helper**（`src/prompt_trail_helper.c`）：`archive-status` 多给一项 `archiveBytes`，即活动档案 `.sqlite3`、`-wal`、`-shm` 的字节数之和，没有档案时为 0；`lstat` 的其他失败按 `database-unavailable` 处理，与隔离档案的统计一致。已重建 artifacts。
- **插件**（`hooks/register.tsx`）：status 的 `archive:` 行为 `ready · <路径> · N bytes`；`archive-status` 读不到时写 `size unknown`，不写 0。
- **测试**：
  - 单测 `test_archive_status_gives_the_size_of_the_archive_in_place`，并在 `test_archive_status_names_the_generation_and_each_quarantined_archive` 的空项目里要求 `archiveBytes: 0`。两者在原 helper 上变红。
  - plugin test `consent_capture.test.tsx::status gives the size of the archive in place, or says it is unknown`，在原代码上变红。
- **PTY**：PT-CONTROL-001 要求 status 的字节数等于磁盘上三者之和，两个版本都通过（见 Issue 40）。
- **scenarios.json**：PT-CONTROL-001 引用上面的单测与 plugin test。

## Comments

### 2026-09-30 · 从 Issue 40 拆出

Issue 40 对齐 Q11 时发现：status 从来没有显示数据库大小。使用者决定拆新票修代码，不改契约，本票挡住 40。
