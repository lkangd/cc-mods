# 30: 原子清除 Project Timeline

**What to build:** 让使用者通过强确认清除当前项目的全部 Prompt Trail 档案，并在线性化切点切换 Archive generation，使并发旧 writer 无法复活被删除数据。

**Blocked by:** 24「隔离项目并支持并发 Run」、28「隔离损坏的 Archive generation」

**Status:** resolved

- [x] 当前 Project Timeline 没有任何活动、备份或隔离档案时，`/prompt-history clear-all` 返回 no-op 且不询问。
- [x] 有数据时显示项目范围、活动/备份/隔离文件和记录数，并要求输入固定确认短语；提示不展示 prompt。
- [x] `clear-all` 建立线性化切点和新的 Archive generation；切点前记录全部删除，切点后已接受的新提交只进入新 generation。
- [x] 旧 generation 的并发 writer、重试或陈旧 locator 无法向新 generation 写入或复活记录。
- [x] 删除范围覆盖活动数据库、WAL/SHM、迁移备份、Quarantined Archives 及全部 prompt 元数据，以及会话索引（`<plugin data>/sessions/`）里指向本项目档案中出现过的 Run 的记录；之后 resume 这些会话会新建 Run。（Issue 32 新增。）
- [x] locator 生命周期保持独立；Collection consent 与当前 Run collection mode 保留，并在空的新 generation 中继续工作。
- [x] secure delete、checkpoint/truncate、空间回收和文件删除完成后，byte marker 扫描确认所有项目 prompt 标记消失。
- [x] 逻辑删除成功但任何敏感残留清理失败时，准确报告部分物理失败并保持 Archive unavailable，直到清理成功或使用者明确禁用。
- [x] 确认流程重申 Claude Code transcript/history、快照、备份和 SSD 介质边界。
- [x] 把 `clear-all` 作为强确认清除加进 `archive-integrity` 对话框，并覆盖 Issue 28 的隔离目录 `archives/quarantine/<projectId>/`。（Issue 28 转交。）
- [x] helper generation-race tests、双 Run PTY 与故障注入覆盖取消、成功、陈旧 writer、Quarantine、残留和清除后继续采集。

## Answer

`/prompt-history clear-all` 在使用者输入固定短语后永久删除本项目的全部 Prompt Trail 档案，隔离档案也在内；旧 generation 的 writer 无法再写进新档案。实现在 `739ea98`（helper 与 lifecycle 的 generation）、`8657325`（插件流程）；`4d00379` 修复了 PTY 发现的三处问题。对齐见下方「实现层面对齐」。

- **helper**：
  - 新命令 `clear-inventory`：持共享锁、只读，列出 Prompt Entry 与 Pending Capture 条数（损坏时为 `null`）、本项目其他正在运行的 Run 数（`live_runs_elsewhere()` 与档案里的 Run 取交集；档案读不出时为 `null`）、本项目在档案根下的每个文件及字节数，以及隔离档案。清除未完成时只按文件名和大小列出，不打开档案。
  - 新命令 `clear-all <root> <project> <本 Run> <sha> <protocol> --stdin`（stdin 为插件 store 里本项目的 Run，一行一个）：
    - 持项目独占锁，先只读读出条数和 Run，再原子写 `<projectId>.clearing`，这一步即切点；
    - 删除会话索引里属于这些 Run 的记录（本 Run 与仍在运行的 Run 除外）；
    - 删除 `<projectId>.` 开头的一切文件（`.lock` 除外）和 `quarantine/<projectId>/`，只 `unlink` 加目录 `fsync`，然后删除意向。
  - 任何文件删不掉时，意向保留，报 `clear-unfinished`（共享故障），此后一切打开都报这个类别，下一次 `clear-all` 接着删。没有任何文件时 no-op，也不建目录。
  - `boundary-append` 新增预期 generation 参数，语义与 `capture-begin` 相同。档案不存在时，`capture-confirm` 报 `capture-not-found`，`capture-abort` 答 `{"aborted":false}`，都不建库。`quarantine` 遇到未完成的清除时拒绝。`archive-status` 新增 `clearUnderway`。
- **插件**：
  - 确认对话框写明：项目路径、条数、文件、隔离档案、其他运行中的 Run、「正在提交中的 prompt 也会被清除」、consent 与采集模式不变，以及 transcript/快照/备份/SSD 边界。选项为「取消 / 返回」，确认短语 `delete all prompts` 在宿主的自由输入项里输入，去掉首尾空白后必须完全一致。
  - 损坏对话框变为四项，多了「清除全部档案」；`clear-unfinished` 对话框为「继续清除 / 禁用当前 Run 后继续」并列出残留。续做不再要求短语。`status` 增加 `clear: unfinished · N residual`。
  - 清除后删除 `reconcile:` 和共享故障记录，清空本项目各 Run 的 lifecycle 待写队列，去掉各 Run `run-mode:` 里最近的 Collection Boundary，重置时间线视图。保留 consent、采集模式和 branch；下一次预写报 `archive-generation`，走 `enterNewGeneration()`。
  - lifecycle 写入在首次保存时记下当时的 generation（问 `archive-status`，问不到记为 `null`）。回放时带上它，遇到 `archive-generation` 就丢弃该项，不再阻塞。
- **与对齐稿不同**：
  - helper protocol 没有加一，理由同 Issue 28；
  - Q7 改为清空所有 Run 的 lifecycle 队列，而不是删除已退出 Run 的整条记录，因为插件分不出哪个 Run 还活着；
  - Q13 不必另调 `archive-status`：展开时本就重读最新批次，批次的 generation 不同时整窗重置；
  - 档案被外部删除后，`capture-confirm` 的类别从 `database-unavailable` 改为 `capture-not-found`（与清除后的空路径分不开）；
  - 另外清除会去掉 `run-mode:` 里的 Collection Boundary，这一条是 PTY 发现后补的。
- **测试**：
  - helper 新增 12 项黑盒测试：全量删除加 byte marker 扫描（其他项目不变）、no-op、残留阻塞与续做、旧 generation 的 begin/boundary/confirm/abort、会话索引（本 Run、运行中的 Run、无关 Run 保留）、inventory 只读与计数、等待在途写入、三种崩溃点状态、未开始的 `.partial`、非法 Run 输入、其他运行中 Run 的计数、未完成清除的 inventory 不读档案；
  - plugin test 新增 12 项：lifecycle generation 的回放、丢弃与记录，no-op，短语与取消，清除后继续采集，损坏对话框里的清除，残留报告与阻塞，两种续做，另一个 Run 清除后展开，清除后的 `status`；
  - 变异检查：helper 25 条中 24 条被抓到，存活的一条是等价变异（去掉「档案不存在」短路后，比较的是未初始化缓冲区，结果仍报 `archive-generation`）；插件 23 条全部被抓到；
  - 门禁：两个宿主版本各 374 项 plugin test，静态 9 项，bridge 32 项，helper 128 项，真实 git 5 项。
- **真人 PTY（cmux，2.1.283，两个 Run 同一测试项目）**：
  - A、B 各提交一条；A 执行 `clear-all`：短语输错时如实拒绝；输对后只剩 `.lock`，两个运行中 Run 的会话索引保留，插件数据里找不到任何被清除的标记；
  - B 下一次提交进入新 generation（`run-attached`、prompt），没有复活任何旧记录；A 的 band 只显示新记录；
  - 故障注入（`chflags uchg` 锁住主库）：A 得到残留报告，B 的提交被「继续清除 / 禁用」对话框挡住；解锁后在 B 选「继续清除」，清除完成，提交进入新 generation；
  - PTY 发现并修复了三处：未完成清除的残留报告曾重新打开被切断的档案，带回 `-wal`/`-shm`；确认文字写的是宿主并不显示的「Other」；清除后 `status` 仍列出旧历史的 Collection Boundary。修复后复验：残留只剩被锁的文件，`status` 为 `clear: unfinished · 1 residual`，命令续做只问「继续清除 / 取消」，完成后只剩 `.lock`。
  - 从对话框续做成功后的 toast 在 `read-screen` 里读不到，未经目视确认。
- **未覆盖**：
  - 刚启动的会话立刻执行 `/prompt-history disable` 时，曾答「无法读取当前 Run collection mode」，稍后重试正常。这看起来是启动期的时序问题，与本票无关，未深入。
  - 续做清除时，完成报告里的条数来自切点后对残留档案的只读计数（helper 内部读取，不经任何 Run）。

## Comments

### 实现层面对齐（2026-09-28）

现状：generation 身份是活动文件的 `(dev, ino, birthtime)`（helper `archive_generation()`），不存数据库。带预期 generation 的 `capture-begin` 以 `archive-generation` 拒绝旧 writer；`capture-confirm` 不校验，但 pending 行随旧库一起消失，只会报 `capture-not-found`，插件按「已在别处结算」处理，不会重新预写；`boundary-append` 既不校验也会建库，插件的 lifecycle 队列（含代已退出 Run 回放的队列）可以把切点前的边界写进新 generation。所有打开档案的命令持 `<projectId>.lock` 共享锁，`quarantine` 持独占锁。locator 与会话索引里的 `archiveGeneration` 是 bridge 为每个新 Run 生成的随机值，从不校验；bridge 不知道 projectId。会话索引（`<plugin data>/sessions/<session>.json`）只记 session → Run，不记项目。Collection consent 与 Run collection mode 都在插件 `$.store`，不在档案里。`$.ui.ask` 只有 2–4 个选项，自由文本走对话框的 Other。其他运行中的 Run 不轮询档案，内存里的时间线窗口只在下一次提交、翻页到窗口边缘或 reload 时换代。

- **Q1 新 generation 何时出现**：clear-all 删完后原路径留空，不建新库、不写标记事件；下一次写入（提交或 lifecycle 边界）才建出新 generation。旧文件消失即身份改变，带旧 generation 的 `capture-begin` 找不到文件就报 `archive-generation`，插件照常走 `enterNewGeneration()`。
- **Q2 物理删除**：整文件 `unlink` 加目录 `fsync`，不覆写，不先 `DELETE`/`VACUUM`（APFS 写时复制，覆写只给出擦除的错觉）。票据的「secure delete / checkpoint / 空间回收」在 clear-all 上落实为文件不存在，由 byte marker 扫描验证；SSD 与快照边界在确认界面声明。
- **Q3 切点、崩溃与残留**：持项目独占锁 → 原子写 `<projectId>.clearing`（切点；此后一切打开报新类别 `clear-unfinished`，共享故障）→ 删会话索引记录（Q6）→ 删全部档案文件 → `fsync` 目录 → 删意向。任一步失败或崩溃，意向留下即保持 Archive unavailable；再次 clear-all 幂等续做并报告残留清单，或禁用当前 Run。删除范围含活动库与 `-wal`/`-shm`/`-journal`、迁移备份及 `.partial`、`.fresh*`、`.quarantine`、`.quarantine.partial` 和 `quarantine/<projectId>/`。`.lock` 不删：删掉后，正在等锁的进程锁在已 unlink 的 inode 上，新进程另建锁文件，互斥失效；它是空文件。
- **Q4 堵住旧 writer**：`boundary-append` 加预期 generation 参数（`-` 表示不限），不一致报 `archive-generation`，与 `capture-begin` 同义。lifecycle 队列项记下入队时的 generation，入队时不知道就先问一次 `archive-status`；回放时 generation 已换则丢弃该项。`enterNewGeneration` 写的 `run-attached` 用 `-`。`capture-confirm` 不改。
- **Q5 locator 与会话索引的 `archiveGeneration`**：字节不动、不校验。spec §2、`CONTEXT.md` 与 bridge 注释写明它是历史遗留的 Run 世代令牌，不是 Archive generation；generation 的唯一身份是档案文件身份，由插件分支状态携带、helper 校验。删字段要升 locator 与索引版本，旧索引会以 `session-index-invalid` 让所有 resume 失败关闭，不值得。
- **Q6 删除哪些会话索引记录**：Run 集合 = 活动库可读时读出的 Run ∪ 插件 store 里本项目 `branch:`、`run-mode:`、`lifecycle:` 键出现的 Run（插件经 stdin 传给 helper，helper 在锁内删）。隔离档案不打开（只读打开缺 `-wal` 的库要往隔离目录里写）。仍在运行的 Run（`live_runs_elsewhere()` 加本 Run）不删：它们在新 generation 继续，否则同一进程 `/clear` 后的会话又会接回旧 Run，谱系自相矛盾。索引只含 ID，删除失败写进报告，不阻塞档案。
- **Q7 插件 store**：删除本项目的 `reconcile:`（含 pending 的 eventId 与附件数）、`archive-state:` 和已退出 Run 的 `lifecycle:` 队列；保留 `consent:`、`run-mode:`、`branch:`（有 generation 校验兜底）、`compacted:`、`ui:`、`space-warned:`。其他 Run 从内存写回的旧值由 helper 的 generation 校验挡在新档案外。
- **Q8 确认短语**：`/prompt-history clear-all` 弹对话框展示范围，选项「取消 / 返回」，在 Other 里输入 `delete all prompts`（去首尾空白后完全一致）；不符视为取消，并说明「短语不符，未删除任何内容」。
- **Q9 确认界面**：项目路径；活动档案的 Prompt Entries 与 Pending Captures 数（损坏时写「无法读取（档案损坏）」）；迁移备份与每个隔离目录的名称和字节数；其他运行中 Run 的数量，并说明它们在下次读取前视图可能仍显示旧内容；「正在提交中的 prompt 也会被清除」；Claude Code transcript/history、文件系统快照、第三方备份与 SSD 物理介质的边界。不含 prompt。数据来自新 helper 命令 `clear-inventory`（共享锁、只读、不改任何文件）。
- **Q10 切点时在途的提交**：切点前 `capture-begin`、切点后 `capture-confirm` 的提交随 pending 一起删除，确认报 `capture-not-found` 按已结算处理，不入档，不记 Integrity gap（是使用者主动清除，不是完整性失败）。
- **Q11 no-op**：本项目在档案根下没有任何相关文件（Q3 所列，外加 `.clearing`；`.lock` 不算）时 no-op，回复「没有可清除的 Prompt Trail 档案」，不弹对话框。库在但 0 条 Prompt Entry 照样确认，界面显示 0 条：Run ID 与时间也是要清掉的元数据。
- **Q12 对话框**：
  - 损坏对话框（`archive-integrity`/`quarantine-failed`）四项：「重新检查完整性 / 隔离并开始新档案 / 清除全部档案 / 禁用当前 Run 后继续」。选清除进入 Q8/Q9 的确认；成功后重试这次提交，取消或短语不符回到损坏对话框，提交保持阻止。
  - `clear-unfinished` 对话框两项：「继续清除 / 禁用当前 Run 后继续」，正文列残留路径。`.clearing` 本身证明本项目已有人输入过短语，续做不再要短语，任何 Run 都可点。
  - `/prompt-history clear-all` 遇到已存在的 `.clearing`：同样不要短语，只给「继续清除 / 取消」。
- **Q13 其他运行中 Run 的视图**：沿用现有换代路径（下一次提交、翻页到边缘、reload），另外 `/prompt-history` 展开时调一次 `archive-status`，generation 变了就重置窗口。不做定期轮询。
- **Q14 当前 Run 的反馈**：立即重置视图、清对账状态。成功回复列出清掉的 Prompt Entry、Pending Capture 与隔离档案数，说明 Collection consent 与当前 Run 采集模式未变、新时间线从下一次提交开始，并附边界声明。部分失败回复「切点已生效，旧记录不会再被读写」、列出残留路径、说明清除完成前档案不可用、可再次执行 `/prompt-history clear-all` 续做。`status` 增加 `clear: unfinished · N residual`。文字不含 prompt 原文或文本哈希。
- **默认项**：clear-all 不看 Collection consent 状态，有档案文件就可执行；helper 新增 `clear-inventory` 与 `clear-all`，`boundary-append` argv 多一个参数，helper protocol 加一，plugin test 假 helper 同步；验收沿用 helper 黑盒（generation 竞争、陈旧 lifecycle 回放、构造 `.clearing` 残留的各崩溃点、残留删除失败、byte marker 扫描）、plugin test（两个对话框、短语、no-op）、双 Run 真人 PTY（实现后另行征得授权），逐条变异检查。
