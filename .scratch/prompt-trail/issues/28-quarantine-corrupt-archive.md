# 28: 隔离损坏的 Archive generation

**What to build:** 当一个 Archive generation 损坏时，停止受影响项目的写入并原样保留证据，让使用者选择复检、隔离后重新开始或强确认清除，而不自动修复或覆盖。

**Blocked by:** 27「安全迁移档案 schema」

**Status:** resolved

- [x] 检出损坏后立即停止受影响 Archive generation 的所有 Run 写入，并保留原数据库及相关文件不变。
- [x] 损坏只影响对应 Project Timeline；其他项目数据库继续健康工作。
- [x] `status` 显示共享故障范围、generation、非敏感检查结果和可采取动作，不显示 prompt。
- [x] “重试完整性检查”不会修改文件；检查成功前不得恢复写入。
- [x] “隔离并开始新 generation”把原文件及相关敏感副本以私有权限保留为 Quarantined Archive，并创建空的新 generation。
- [x] Quarantined Archive 不参与后续 append、range read 或自动迁移，也不被自动修复、覆盖或删除。
- [ ] 存在无法安全打开的 Quarantined Archive 时，`clear-run` 必须拒绝声称完整按 Run 删除。（转交 Issue 29，见 Q8。）
- [ ] 强确认清除路径交由项目级清除语义处理，并在成功前保持 Archive unavailable。（转交 Issue 30，见 Q8。）
- [x] 多 Run 同时发现同一损坏时只完成一次 generation 状态转换，不创建多个隔离副本。
- [x] helper fault tests 与双 Run 集成场景验证原文件字节不变、项目隔离、幂等隔离和新 generation 可用。

## Answer

损坏的档案不会被修复或覆盖。被挡住的 Run 可以选择只读重新检查、把整份档案原样隔离后在空的新 generation 里继续，或者禁用当前 Run。实现在 `017c773`（helper 与插件），`ac8bbb4` 修复了 PTY 首轮发现的残留文件；与对齐稿不同的地方见上方「实现中修订」。

- **检出（Q1）**：任何命令撞上 `SQLITE_CORRUPT`/`SQLITE_NOTADB` 时报 `archive-integrity`，并带上这份档案的 generation。迁移前检查与迁移后复检照旧。普通打开不做完整性检查。
- **重新检查（Q4）**：新增 `integrity-check`，以只读连接跑 `integrity_check` 加 `foreign_key_check`，结果为 `ok`/`damaged`（带问题条数，最多 100）/`unreadable`/`absent`。主库、`-wal` 与备份字节不变。`ok` 或 `absent` 才解除共享故障并提交；否则对话框写明「完整性检查未通过（N 个问题）」后再问一次。
- **隔离（Q2、Q3、Q5）**：新增 `quarantine`：
  - 把主库、`-wal`、`-shm`、`-journal` 以及迁移备份和 `.partial` 原样 rename 进 `archives/quarantine/<projectId>/<UTC 时间戳>-<随机 8 位>/`（各级目录 0700，文件保持 0600）；
  - 在原路径放上只含一条 `archive-quarantined` 边界的新 generation；
  - generation 身份是活动文件的 `(dev, ino, birthtime)`，不改 schema；
  - 传入的 generation 已被别的 Run 换掉时，什么都不搬，按成功返回；
  - 隔离目录不参与之后的读写和迁移，也不会被自动删除。
- **插件（Q5、Q6、Q7）**：
  - 类别为 `archive-integrity` 或 `quarantine-failed` 时，对话框三项为「重新检查完整性 / 隔离并开始新档案 / 禁用当前 Run 后继续」，其他共享故障仍是两项；
  - 隔离成功后给出 toast，指向 `status`；
  - 已有的 Run 进入新 generation 时补写 `run-attached`、改为新根分支，旧库里的 Pending Capture 视为放弃；
  - band 显示「此前的记录已隔离（原样保留，不在本时间线中）」；
  - `status` 显示 generation、隔离档案的个数、路径与字节数、未完成的隔离和可选动作，不显示任何 prompt；
  - 新类别 `archive-generation`、`quarantine-failed` 已加入 `SAFE_ERROR_CATEGORIES`，后者也属于共享故障。
- **测试**：
  - helper 新增 18 项黑盒测试（含 code review 后补的 2 项）：
    - 撞上损坏报 `archive-integrity` 且带 generation；
    - 重新检查字节不变（完好、WAL 已合并、页损坏、索引不一致、文件头损坏）；不存在的档案不会被创建；
    - 隔离保留每个文件的字节与权限，新 generation 只含一条边界，另一个项目不受影响，不留任何构建残留；
    - 旧 generation 再隔离不做事；6 个进程同时隔离，只产生一个隔离副本；
    - 隔离会等待已在写入的命令，搬走后不再有写入落进旧文件；
    - 被 `chflags uchg` 打断的隔离：所有命令拒绝，直到下一次隔离完成；
    - 构造「新 generation 已就位、意向未删除」的崩溃点状态，续做时不搬新库；
    - 随机时刻 SIGKILL 30 轮（`random.Random(28)`，打断在开始前、进行中、完成后三种时刻都覆盖到），下一次隔离总能完成且证据不变；
    - `capture-begin` 遇到旧 generation 或已不存在的档案时什么都不写；`timeline-read`、`branch-match`、`capture-list`、`archive-status` 都报告 generation；
  - plugin test 新增 20 项（含 code review 后补的 7 项）：三项对话框、其他故障仍两项、重新检查通过或失败、隔离后提交进入新 generation、另一个 Run 的隔离在线被 `capture-begin` 发现、重启后被对齐发现、隔离已由别人完成、隔离失败再问、band 边界、视图重置、`status`、`enable` 的提示、重新检查查到另一份坏档案、检查结果跨 Run 可见、重启后续做未完成的隔离、接入重试、对齐后带 generation、丢弃已隔离 generation 的对账；
  - 变异检查：C 侧 16 条全部被抓到。其中「续做时覆盖隔离目录里已有的同名文件」起初只有随机 SIGKILL 测试守着，没抓到；补了上面的崩溃点状态测试后才抓到。插件侧 15 条中 14 条被抓到，存活的「新根分支 id 改回随机」由 `boundary-conflict` 容错兜住，两道保护都去掉时对应测试会失败；
  - 门禁：两个版本各 362 项 plugin test，静态 9 项，bridge 32 项，helper 116 项，真实 git 5 项。
- **真人 PTY（cmux，2.1.283）**：
  - 首轮：R1、R2 → 改坏档案头 → R3 → 三项对话框 → 选「重新检查」→ 如实报「已无法作为数据库读取」→ 选「隔离」→ R3 进入会话；新 generation 为 `archive-quarantined`、`run-attached`、R3（无父节点）；隔离目录 0700，主库与 `-wal` 的 SHA-1 与改坏后一致；band 显示隔离边界；`status` 列出隔离目录；其他 12 个项目的档案 SHA-1 不变。发现 `.fresh-wal`/`.fresh-shm` 残留，修复后复验。
  - 次轮（修复后的 helper，`--resume` 同一会话）：R4 挂在 R3 之后 → 再次改坏 → R5 → 隔离；第二个隔离目录的证据不变，根目录没有残留，新 generation 从头开始。
  - 隔离成功的 toast 在 `read-screen` 里读不到，由使用者目视确认。
- **未覆盖**：
  - 在 28 之前写下、尚未记录 generation 的分支状态，如果在本 Run 下一次预写前就被别的 Run 隔离，第一次预写会以 `-` 通过，旧父节点要到确认时才报 `capture-parent-unknown`，走现有的对账路径。这只影响升级后的第一条 prompt。
- **转交**：「存在隔离档案时 `clear-run` 拒绝」归 Issue 29；「强确认清除」归 Issue 30，30 的票据已补一条「把 `clear-all` 加进 `archive-integrity` 对话框，并覆盖隔离目录」。

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

### 实现中修订（2026-09-28）

- **项目锁与隔离意向（补充 Q2、Q5）**：
  - 档案旁新增 `<projectId>.lock`，不随档案搬走。所有打开档案的命令（含 `integrity-check`）持共享 `flock` 直到退出，`quarantine` 持独占锁，等待受同一个 8 秒 busy 预算约束。这样隔离时没有命令还握着旧文件，也不会有写入落进已搬走的文件。
  - 隔离先把目标目录名写进 `<projectId>.quarantine`（临时名写好、fsync 后改名），搬完、新 generation 就位后才删除。它存在期间，所有命令都报新类别 `quarantine-failed`（共享故障，对话框同样给三项）；下一次 `quarantine` 不论带什么 generation，都按意向续做到底。每个文件只在隔离目录里还没有同名文件时才搬，因此新 generation 就位后被打断，续做时也不会把新库当旧库搬走。
  - 新 generation 先在 `<projectId>.fresh` 建好（写入 `archive-quarantined` 边界、checkpoint 截断 WAL），再整体改名就位。系统 SQLite 在最后一个连接关闭后仍保留 `-wal`/`-shm`，所以建好后要删掉清空的 `.fresh-wal` 与 `.fresh-shm`；PTY 首轮发现它们残留，已修（`ac8bbb4`）。
- **只读检查补一个空 WAL（修订 Q4）**：只读连接打不开「WAL 模式、但 `-wal` 文件已被删除」的档案（`SQLITE_CANTOPEN`，errno ENOENT）。档案头标明 WAL 而 `-wal` 不存在时，helper 先建一个 0 字节的 `-wal` 再打开。主库和已有 `-wal` 的字节不变。
- **generation 的传递（补充 Q2、Q6）**：
  - `archive-integrity` 的错误输出带上撞到损坏时打开的那份档案的 generation。插件把它记进共享故障记录，隔离时只传这一份，别的 Run 已换上的新 generation 不会被再搬一次。
  - `capture-begin` 新增「预期 generation」参数（`-` 表示不知道），不一致时报 `archive-generation`，不写任何东西。成功输出、`timeline-read`、`branch-match` 都带当前 generation；分支状态（`$.store`）记住最近一次预写所在的 generation。
  - 插件发现 generation 已被替换有两条路径：进程在线时，由 `capture-begin` 报 `archive-generation` 发现；重启或 resume 后，由对齐阶段 `branch-match` 返回的 generation 发现，这时不再拿旧 lineage 去匹配或问人。两条路径都会补写 `run-attached`（事件 id 由离开的 generation 派生，可幂等重试），改为新根分支（`explicitRoot`），清掉对账状态，重置时间线视图。时间线读到另一个 generation 的批次时，也会整批重置窗口。
  - 重启路径下，进程自己的接入边界会先写入新 generation，随后才是这条 `run-attached`，时间线上会连着两行 Run 边界。
- **`enable` 不弹对话框（修订 Q5）**：`enable` 写不进边界而遇到损坏时，返回文字列出三项选择，并说明在下一次提交时选择；三项对话框只在被挡住的提交里出现。
- **`status`**：新增 `Archive generation`（token 前 12 个字符）、未完成隔离的提示、`Quarantined archives` 个数与各目录路径和字节数；遇到损坏时列出三项选择。数据来自新增的 `archive-status` 子命令，它不打开数据库。
- **`archive-quarantined` 不记录隔离目录名（修订 Q6）**：事件表没有能放它的列，而 Q2 定了不改 schema，所以这个边界只有时间和写入它的 Run/Segment/Branch。隔离目录由 `status` 列出，不借用 `branch_id` 等字段存放。

### Code review 修复（2026-09-28，round 1）

`.code-review/runs/20260928-134644/round-1/`，范围 `77ddbb2..35e5abe`，含 spec 角度。20 条中修 16 条（其中两条是同一问题），2 条进 backlog，1 条驳回，1 条记为上面的修订（`archive-quarantined` 不记录目录名）。

- **重新检查发现的是另一份坏档案时，隔离改为移走这一份**：检查结果里的 generation 会替换失败记录里原来的那个。
- **隔离先让新 generation 的目录项落盘，再删意向文件**：目录同步失败时意向文件保留；删除之后的那次同步不再算失败，因为崩溃后重现的意向会被下一次隔离续做，不会再搬动任何文件。
- **`quarantine-failed` 记录保留目标 generation**；拿不到 generation 时先问 `archive-status`，确认有未完成的隔离就直接续做，不再先做完整性检查（那样会在意向文件前被拒绝，形成死循环）。
- **进入新 generation 的 `run-attached` 由 session 与离开的 generation 派生**，新根分支 id 也由它派生；重试遇到 `boundary-conflict` 时视为这条接入已经写过。以前同一 Run 的另一个 session 离开同一 generation 时会被永久拒绝。
- **分支对齐与父节点面板写入的分支状态带上 `branch-match` 的 generation**，下一次预写因此有预检。
- **重新检查的结果（结论与问题条数）写进共享故障记录**，别的 Run 和重启后的 `status` 都能看到。
- **对账记录带上 pending 所在的 generation**（`capture-list` 现在也报告 generation）；有未决对账时先用 `archive-status` 比对 generation，已被替换就丢掉这条对账，不再为已隔离的 pending 弹对话框。
- **带预期 generation 的 `capture-begin` 在档案不存在时直接拒绝**，不先建空档案。
- **`timeline-read`、`capture-list`、`branch-match` 判断档案不存在前先加项目共享锁**，不会在隔离搬走主库的瞬间返回空结果。
- **测试**：「隔离等待在途命令」改为确认写入方已持锁再启动隔离；随机 SIGKILL 测试至少跑 30 轮，并持续到三种时刻都出现（上限 90 轮）。
- **`benchmark-timeline.sh` 补上 `capture-begin` 的 generation 参数**，已用 2000 条档案跑通。
- **可为 null 的 generation 统一由 `nullableGeneration` 校验**。
- **Answer 移到 Comments 之前**，符合 `docs/agents/issue-tracker.md`。
- **backlog**：`docs/code-review-backlog/20260928-new-generation-root-before-first-capture.md`（新根分支在第一次预写前没有绑定 generation）、`20260928-damaged-generation-travels-in-a-global.md`（损坏 generation 通过模块全局变量传递）。
- **驳回**：「预写时复用 `opened_generation`」，每次调用多一次 `lstat`，与起进程和打开 SQLite 相比可以忽略。

