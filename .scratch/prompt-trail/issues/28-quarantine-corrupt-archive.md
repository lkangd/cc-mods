# 28: 隔离损坏的 Archive generation

**What to build:** 当一个 Archive generation 损坏时，停止受影响项目的写入并原样保留证据，让使用者选择复检、隔离后重新开始或强确认清除，而不自动修复或覆盖。

**Blocked by:** 27「安全迁移档案 schema」

**Status:** ready-for-agent

- [ ] 检出损坏后立即停止受影响 Archive generation 的所有 Run 写入，并保留原数据库及相关文件不变。
- [ ] 损坏只影响对应 Project Timeline；其他项目数据库继续健康工作。
- [ ] `status` 显示共享故障范围、generation、非敏感检查结果和可采取动作，不显示 prompt。
- [ ] “重试完整性检查”不会修改文件；检查成功前不得恢复写入。
- [ ] “隔离并开始新 generation”把原文件及相关敏感副本以私有权限保留为 Quarantined Archive，并创建空的新 generation。
- [ ] Quarantined Archive 不参与后续 append、range read 或自动迁移，也不被自动修复、覆盖或删除。
- [ ] 存在无法安全打开的 Quarantined Archive 时，`clear-run` 必须拒绝声称完整按 Run 删除。
- [ ] 强确认清除路径交由项目级清除语义处理，并在成功前保持 Archive unavailable。
- [ ] 多 Run 同时发现同一损坏时只完成一次 generation 状态转换，不创建多个隔离副本。
- [ ] helper fault tests 与双 Run 集成场景验证原文件字节不变、项目隔离、幂等隔离和新 generation 可用。

## Comments

### 实现层面对齐（2026-09-28）

现状：Archive generation 目前只是个名字。bridge 给每个新 Run 生成一个随机 UUID，写进 locator 和会话索引，helper 只在 `status` 里原样显示；数据库路径固定为 `archives/<projectId>.sqlite3`，与这个 UUID 无关。普通打开不做完整性检查；SQLite 在读写中报 `SQLITE_CORRUPT`/`SQLITE_NOTADB` 时类别是 `archive-sqlite`。`archive-integrity` 只来自迁移前的 `integrity_check`/`foreign_key_check` 和迁移后下一次打开时对备份的 `quick_check`。共享故障对话框只有「重试 / 禁用当前 Run 后继续」，「重试」就是以读写方式重做原操作。`clear-run`（29）与 `clear-all`（30）都还没有实现。

- **Q1 检出入口**：任何操作撞上 `SQLITE_CORRUPT`/`SQLITE_NOTADB` 时报 `archive-integrity`，迁移前检查与迁移后复检照旧。不在普通打开时做 `quick_check`/`integrity_check`。只有 SQLite 自己报告的损坏才算损坏；「每行都能读、只有 `integrity_check` 才查得出」的不一致接受漏检，因为从不自动修复，晚发现不会扩大损失。
- **Q2 Generation 身份与布局**：
  - 活动档案路径不变。generation 身份取活动文件的 `(dev, ino, birthtime)`，由 helper 算成不透明 token 对外报告；不改 schema。
  - 隔离：把整组文件 `rename` 进 `archives/quarantine/<projectId>/<UTC 时间戳>-<随机后缀>/`（目录 0700），再在原路径新建空档案，即新 generation。
  - locator 与会话索引里现有的 `archiveGeneration` 字段 28 不动、不强制校验，含义留给 30 定。按 locator 绑定 generation 会让 Run 在隔离后换不到新 generation，因为 locator 只在 SessionStart 发布。
  - `CONTEXT.md` 中 Archive generation 改为「由 `clear-all` 或隔离建立」。
- **Q3 隔离的文件**：同一前缀下的主库、`-wal`、`-shm`、`-journal`、`.pre-migration-v<N>` 与 `.partial`，存在哪个搬哪个。迁移后才坏的档案，迁移备份恰是好副本。搬动不改字节、不改权限；任一步失败都保持 Archive unavailable，报新类别（如 `quarantine-failed`）。
- **Q4 重试完整性检查**：新增 helper 子命令，以 `SQLITE_OPEN_READONLY` 打开，跑 `integrity_check` 与 `foreign_key_check`。保证主库、`-wal` 与备份字节不变；`-shm` 是 SQLite 的共享内存索引，不在保证内（实现前实测只读打开 WAL 库的行为，不成立则回来重新对齐）。通过后清掉共享故障记录，再执行被挡住的提交；不通过就回到对话框。
- **Q5 入口与选项**：
  - 不新增子命令。类别为 `archive-integrity` 时对话框三项：「重新检查完整性 / 隔离并开始新档案 / 禁用当前 Run 后继续」；其他共享故障仍是两项。
  - 入口是被挡住的提交与 `enable`；`status` 列出可采取的动作，并说明在下次提交时选择。
  - 隔离不删任何东西，不再二次确认；选项说明写明「旧记录原样保留在隔离目录，新时间线从空开始」。
  - 多 Run 同时选隔离：helper 持项目锁并比对 generation token；token 已变说明别的 Run 已隔离，直接按成功返回，不产生第二个隔离副本。
- **Q6 已有 Run 在新 generation 中继续**：
  - 新 generation 的第一个事件是非 prompt 边界 `archive-quarantined`，只带时间与隔离目录名，时间线显示「此前的记录已隔离」。
  - 每个 Run 在新 generation 的第一条 prompt 开新根分支，不挂父节点。
  - 旧库里的 Pending Capture 视为放弃，不再对账，插件清掉内存里的 reconcile 状态。
  - 已存在的 Run 在新 generation 补写一条 `run-attached`，说明它从哪里接续。
- **Q7 `status`**：共享范围、当前类别、活动 generation token 的短形式、检查结果（只显示通过/不通过与问题条数，不显示 `integrity_check` 原始信息）、隔离档案个数与目录路径、可采取的动作。不显示 prompt，除字节大小外不显示内容统计。
- **Q8 转交范围**：「存在 Quarantined Archive 时 `clear-run` 拒绝」由 29 负责（29 已有此条）；「强确认清除路径」由 30 负责，30 的票据补一条「把 `clear-all` 加进 `archive-integrity` 对话框，并覆盖隔离目录」。本票这两条勾选项在 Answer 里注明转交。
- **Q9 验收层面**：
  - helper 黑盒：检出、重试只读且字节不变、隔离字节不变、幂等、其他项目不受影响。损坏手段：`writable_schema` 伪造索引不一致（只有 `integrity_check` 能发现），改坏页造出 `SQLITE_CORRUPT`。
  - plugin test：三项对话框、双 Run（B 在 A 隔离后恢复写入新 generation）、边界显示与 `status`。
  - 真人 PTY（经授权用 cmux）一个场景：造坏档案 → 提交 → 选「隔离」→ 提交进入新 generation → 时间线出现边界 → `status`。
