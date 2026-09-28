# 27: 安全迁移档案 schema

**What to build:** 让已存在的 Project Timeline 在已知 schema 升级中保持原文、事件顺序和可恢复性，并对空间不足、迁移中断或过高版本明确失败关闭。

**Blocked by:** 25「Archive unavailable 时失败关闭」

**Status:** resolved

- [x] helper manifest 明确声明可读写 schema 范围；高于支持版本的档案直接拒绝打开，不猜测降级。
- [x] 迁移前执行完整性检查和可用空间检查；任一失败都不修改活动数据库。
- [x] 迁移备份位于同目录、采用相同私有 owner/权限，并被视为含完整敏感原文的档案。
- [x] 已知升级在事务中完成，保留 Prompt Entries、Timeline Event 身份、sequence、Run/Segment/Branch 关系和 Archive generation。
- [x] 迁移中断或验证失败时，活动档案可恢复到迁移前状态且不会同时接受旧、新 schema writer。
- [x] 迁移后执行完整性与语义复检；只有下一次成功打开后才删除备份。
- [x] 空间不足、busy、只读、权限异常和 backup 清理失败均进入准确的 Archive unavailable 状态。
- [x] 新 helper 只执行 manifest 中的单向迁移；旧 helper 遇到更高 schema 时保持拒绝，不热切换制品。
- [x] helper black-box tests 使用旧 schema fixtures、故障点和 marker 验证原文/事件不变、回滚、权限和备份生命周期；测试不依赖当前生产表布局。

## Comments

### 实现层面对齐（2026-09-28）

现状：manifest 已声明 `schemaRead 1–2 / schemaWrite 2 / migrations ["1->2"]`，helper 里当前版本硬编码为 `2`，两者只靠 `artifact_static.py` 断言常量。唯一的迁移 1→2 只新增 `timeline_events` 表，在一个 `BEGIN IMMEDIATE` 里完成，没有完整性检查、空间检查和备份。高版本档案报 `schema-version`，但拒绝前已经执行 `PRAGMA journal_mode=WAL` 并拿过写锁。所有命令（包括只读的 `capture-list`/`timeline-read`/`branch-match`）都会执行 metadata 的 `INSERT … ON CONFLICT DO NOTHING`，因此都要拿写锁。插件每次调用 helper 的超时是 10 秒，到时 kill；helper 的 busy 预算是 8 秒。

- **Q1 范围**：不引入 schema 3。给现有 1→2 迁移补上备份、检查和复检，测试用 schema-1 fixture。流程按「每条声明的迁移都走同一套步骤」来写，以后新增迁移只需补 DDL。
- **Q2 流程与锁**：整个流程在同一个 `BEGIN IMMEDIATE` 里完成：
  1. 在锁下重读版本；
  2. `PRAGMA integrity_check` 与 `foreign_key_check`；
  3. 空间检查；
  4. 用 `sqlite3_backup_*` 从本连接写备份，先写临时名，fsync 后 rename 成正式名，再 fsync 目录；
  5. 迁移 DDL；
  6. 事务内复检：完整性检查，加上语义计数（各表行数、`next_sequence`、最大 sequence、event_id 集合与迁移前一致）；
  7. 通过才 COMMIT，否则 ROLLBACK。

  不用 `VACUUM INTO`：它不能在事务里执行，和迁移之间会留下窗口。
- **Q3 恢复**：helper 从不自动用备份覆盖活动库。迁移中断（崩溃、被 kill、ENOSPC）和复检失败都靠 SQLite 事务回到迁移前。备份是提交后才发现问题时留给人工恢复的证据，自动覆盖属于 spec 反对的「自动修复」，也会和 Issue 28 的隔离语义冲突。
- **Q4 备份命名与生命周期**：
  - **命名**：同目录 `<projectId>.sqlite3.pre-migration-v<来源版本>`，临时名 `….partial`；0600；创建前做与活动库同等的 owner/类型/symlink 校验。
  - **删除时机**：任何命令（含只读）以当前版本打开、通过 metadata 校验后，若存在备份，先执行 `PRAGMA quick_check`，通过后删除，并 fsync 目录。
  - **遗留状态**：
    - 活动库仍是旧版本、同时有遗留备份或 `.partial`：视为未提交的上次尝试，删除后重新迁移；
    - 正式备份名被非普通文件、symlink 或错误属主的文件占用：失败关闭，不删除。
- **Q5 空间阈值**：可用空间 ≥ 2 × 数据库大小（`page_count × page_size`）+ WAL 大小 + 16 MiB。不足时报 `archive-full`，不创建文件，不修改活动库。
- **Q6 失败类别**：
  - 沿用 `archive-full`、`archive-busy`、`database-permissions`；
  - 新增以下五个，全部归入共享故障；插件同步加入 `SAFE_ERROR_CATEGORIES` 与 `SHARED_FAILURES`：
    - `archive-read-only`：只读卷，或文件/目录不可写；
    - `archive-integrity`：迁移前完整性检查失败，只报类别、不改文件，隔离留给 Issue 28；
    - `migration-backup`：备份创建失败，或备份路径被占用、不可信；
    - `migration-verify`：复检不通过，已 ROLLBACK；
    - `migration-backup-cleanup`：迁移已成功但删除备份失败。
- **Q7 清理失败**：本次命令失败，Archive unavailable 阻止所有 Run，直到清理成功。残留备份是含全部原文的敏感副本，口径与 spec §15「物理清除未完成」一致；每次重试都会重新尝试删除。
- **Q8 高版本**：打开后第一步无锁读 `user_version`，大于 2 或为负数直接报 `schema-version`，此前不执行任何会写入的 PRAGMA，也不拿写锁。「旧 helper 遇到更高 schema 保持拒绝」由现有 helper 对 schema-3 fixture 的黑盒测试证明，因为无法构建历史 helper。
- **Q9 只读命令**：`capture-list`/`timeline-read`/`branch-match` 在档案已是当前版本且已有 metadata 行时，跳过 INSERT、不拿写锁；旧版本或缺行时照旧拿锁，迁移或补行。只读命令仍可触发迁移。验收：另一个连接持有 `BEGIN IMMEDIATE` 时，三者立即返回。backlog `20260927-read-commands-take-the-write-lock.md` 随本票关闭。
- **Q10 故障注入**：不加编译开关，不加环境变量注入点，全部用真实条件：
  - ENOSPC：`mount_small_volume` + `fill_volume`；
  - 只读：只读卷或 chmod；
  - 备份路径被占用：预置目录、symlink 或错误属主文件；
  - DDL 中途失败：schema-1 fixture 预置同名 `timeline_events` 对象；
  - 完整性失败：fixture 用字节级手段损坏一个页；
  - 崩溃点：直接构造状态 fixture，例如「schema 1 + 遗留 `.partial`」「schema 2 + 遗留备份」；
  - 真实 SIGKILL：只做一个统计型测试，大 fixture、多轮随机时刻 kill，每轮断言原文、事件和 sequence 不变。

  `migration-verify` 在真实条件下几乎触发不了，接受只靠代码审查和变异检查覆盖。
- **Q11 耗时**：先用 `benchmark-timeline.sh` 的 100k fixture 实测迁移耗时。远低于 10 秒就在 Answer 记录数字、不改动；接近上限再讨论放宽插件超时或让 helper 检查截止时间。
- **Q12 验收层面**：以 helper 黑盒测试为主。插件只补新类别映射，加一条 plugin test，证明新类别按共享故障显示并出现在 `status` 里。不做真人 PTY。
- **派生细节**：
  - 备份存在但下一次打开时 `quick_check` 不通过：报 `archive-integrity`，保留备份。
  - 迁移前任一检查失败都不创建 `.partial`；备份写到一半失败时，先删 `.partial` 再报错。
  - 静态门禁新增：helper 源码的当前版本常量与 manifest `schemaWriteMax` 一致。
  - spec §14 的「当前实现状态」在收尾时更新。

### 实现中修订（2026-09-28）

- **备份改由第二个只读连接写出（修订 Q2 第 4 步）**：SQLite 不允许从持有写事务的连接做 backup，`sqlite3_backup_step` 会一直返回 locked。改为主连接持有 `BEGIN IMMEDIATE`，另开一个只读连接复制；写锁挡住其他 writer，所以复制的正是迁移要改的那一版。
- **迁移步骤本身失败也报 `migration-verify`**：例如 DDL 撞上同名对象。Q6 只写了复检不通过，这里把「迁移没能完成、已回滚」归入同一类别，不再新增类别。回滚后同时删除刚写的备份。
- **只读卷改为打开前查卷的挂载标志（`MNT_RDONLY`）**：只读卷上的旧档案没有遗留的 `-shm` 时，SQLite 报的是 `SQLITE_CANTOPEN`，不会报只读；它会悄悄以只读方式打开，而且是惰性打开，`sqlite3_db_readonly` 也看不出来。因此不再按 SQLite 错误码映射 `archive-read-only`。
- **project 行只在缺失时插入**：Q9 的做法对所有命令统一生效，不按命令区分读写。
- **`user_version` 读取失败报 `archive-sqlite`**：原来读不到按 -1 处理，会被误报成 `schema-version`。
- **完整性 fixture 增加「索引与表不一致」**：通过 `writable_schema` 改写索引定义。页损坏时，指纹读取本身就会失败，单靠页损坏区分不出「跳过完整性检查」这种变异。

## Answer

已存在的 schema-1 档案升级时，会先做完整性和空间检查，写一份逐字节一致的私有备份，迁移并复检通过后才提交；下一次成功打开时再复检一次，然后删除备份。实现在 `9c93fab`（helper）和 `24f56dd`（插件）；与对齐稿不同的地方见上方「实现中修订」。

- **拒绝**：
  - 版本高于 2 或为负数：打开后第一步就报 `schema-version`，此前不切换 WAL、不拿写锁、不改文件，即使别的连接正持有写锁也立即作答；
  - 只读卷：打开前报 `archive-read-only`。
- **迁移**：全程在一个 `BEGIN IMMEDIATE` 里完成：
  1. 清理上次未提交尝试留下的备份和 `.partial`，但只清理本用户私有的普通文件；备份名被目录、symlink 或权限不对的文件占着时，报 `migration-backup` 且不动它；
  2. `integrity_check` 与 `foreign_key_check`，不通过报 `archive-integrity`；
  3. 可用空间须 ≥ 2 × 档案 + WAL + 16 MiB，否则报 `archive-full`；
  4. 写备份 `<projectId>.sqlite3.pre-migration-v1`（0600）：先写 `.partial`，F_FULLFSYNC 后以 `RENAME_EXCL` 改名，再 fsync 目录；
  5. 执行迁移步骤；
  6. 复检：完整性检查，加上指纹（条目数、sequence 之和与最大值、原文字节数、pending 数与字节数、`next_sequence`）与迁移前一致；
  7. 通过才 COMMIT，否则回滚、删除备份，报 `migration-verify`。
- **备份生命周期**：
  - 任何命令以当前版本打开并通过 metadata 校验后，若看到备份，先 `quick_check`，通过才删除并 fsync 目录；
  - 删不掉报 `migration-backup-cleanup`，档案保持不可用；复检不通过报 `archive-integrity`，保留备份；
  - helper 从不用备份覆盖活动库；迁移中断时，活动库靠 SQLite 事务回到迁移前。
- **读命令不再拿写锁**：档案已是当前版本且有 project 行时，`capture-list`/`timeline-read`/`branch-match` 不写入；别的 Run 持有写锁时也立即作答。
- **插件**：五个新类别（`archive-read-only`、`archive-integrity`、`migration-backup`、`migration-verify`、`migration-backup-cleanup`）都属于共享故障，沿用 Issue 25 的对话框、共享记录和 `status`。
- **manifest**：字段不变。静态门禁新增：helper 的 `ARCHIVE_SCHEMA_VERSION` 等于 `schemaWriteMax` 和 `schemaReadMax`，且 `schemaMigrations` 从 `schemaReadMin` 起逐级连续。
- **耗时（Q11）**：100k 条目实测，85 MiB 档案迁移 0.65 秒，403 MiB 档案 1.89 秒，下一次打开的复检加删除分别为 0.08 秒和 0.25 秒；约每 MiB 4.7 ms，档案到约 2 GiB 才会碰到插件的 10 秒超时。测量时页缓存是热的（档案刚写完）。未做改动。
- **测试**：
  - helper 新增 12 项黑盒测试：高版本拒绝、读不拿锁、备份逐字一致与生命周期、遗留文件、备份名被占（目录/symlink/共享文件）、完整性失败（页损坏/索引不一致）、空间不足（4 MB 小卷）、迁移步骤失败回滚、清理失败（`chflags uchg`）、复检失败保留备份、只读卷（`hdiutil -readonly`）、随机时刻 SIGKILL 30 轮（每次运行中 kill 都同时落在提交前和提交后，每轮后原文、sequence、pending 都不变，也不留多余文件）；
  - plugin test 新增 5 项；
  - 变异检查：C 侧 13 条中 12 条被抓到，存活的一条是「忽略复检指纹」（Q10 已接受）；插件侧从 `SHARED_FAILURES` 删掉类别会被抓到。
  - 门禁：两个版本各 342 项 plugin test，静态 9 项，bridge 32 项，helper 97 项，真实 git 5 项。
  - 未覆盖：备份写到一半遇到 ENOSPC（空间检查在前，真实条件下到不了），只做了代码核对。
- **backlog**：`20260927-read-commands-take-the-write-lock.md` 随本票解决。
