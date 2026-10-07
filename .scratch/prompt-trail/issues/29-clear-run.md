# 29: 物理清除当前 Run

**What to build:** 让使用者确认后只清除当前 Run 的 Prompt Trail 敏感数据，并准确说明其他 Run、Quarantined Archive、Claude Code 副本和物理介质不在这次删除保证内。

**Blocked by:** 14「切换 Run collection mode」、28「隔离损坏的 Archive generation」

**Status:** resolved

- [x] 当前 Run 无目标记录时，`/prompt-history clear-run` 返回 no-op 且不询问确认。
- [x] 有数据时先显示当前 Run（整条会话谱系，跨越其所有进程接入）、待删记录数和副本边界，并要求一次明确确认；确认文本不包含 prompt。
- [x] 确认后删除当前 Run 的 Prompt Entries、Pending Captures、相关原文和可关联的敏感 prompt 元数据，其他 Run 数据保持不变。
- [x] Collection consent 和当前 Run collection mode 不因 `clear-run` 改变；后续采集遵循现有模式。
- [x] 存在无法安全打开的 Quarantined Archive 时拒绝声称完整按 Run 删除，并引导使用项目级清除。
- [x] 删除使用 secure delete、WAL checkpoint/truncate 和必要空间回收；隔离 fixture 的 byte marker 扫描确认目标消失、其他 Run marker 保留。
- [x] 逻辑删除完成但 WAL、备份或残留文件清理失败时，报告“逻辑删除完成、物理清除未完成”，列出残留并保持 Archive unavailable。
- [x] 确认流程重申不会删除 Claude Code transcript/history、文件系统快照、系统/第三方备份，也不保证 SSD 物理不可恢复擦除。
- [x] 控制命令不创建 Prompt Entry；日志、错误和删除报告不泄漏被删原文或文本哈希。
- [x] helper black-box、plugin test 与真实 PTY 覆盖 no-op、取消、成功、其他 Run 保留、Quarantine 拒绝和部分物理失败。

## Answer

`/prompt-history clear-run` 在使用者确认一次后，从原档案里删除当前 Run（整条会话谱系）的全部记录，其他 Run 的记录保留。实现在 `f0a8c5d`（helper）、`02636fd` 与 `38a1057`（预写前校验父条目、`ownRun`）、`6e0cf4c`（插件流程）；`213ed61`、`dd652a3` 补了变异检查发现的测试。对齐见下方「实现层面对齐」。

- **helper**：
  - 新命令 `clear-run <root> <project> <本 Run> <sha> <protocol> [--continue]`：
    > 2026-10-07 backlog 清理后，新清除改为 `clear-run <root> <project> <本 Run> <sha> <protocol> --confirmed <entries> <pending> <events> <unlinked>`：计数与确认对话框不符时报 `clear-run-changed`；续做仍是 `--continue`。
    - 持项目独占锁；遇到 `clear-all` 或隔离未完成照旧拒绝；有隔离档案时报 `clear-run-quarantined`；先做 `quick_check`，损坏报 `archive-integrity`；三张表都没有该 Run 的行时 no-op。
    - 原子写 `<projectId>.clearing-run`（内容为 Run id）即切点；随后一个事务里把其他 Run 的 `prompt_entries`、`pending_captures` 中指向被删条目的父链接置空，删除该 Run 在三张表的全部行；再 `VACUUM`、`wal_checkpoint(TRUNCATE)`；关库后核对 `-wal` 不存在或 0 字节，删除 `.pre-migration-*`；全部成功才删意向。
    - 越过切点后的任何失败都报 `clear-run-unfinished`（共享故障），意向留下，此后一切打开报这个类别。意向在时，任何 Run 调用都只续做意向里记着的 Run；`--continue` 在意向已不在时什么都不删。回答含 `cleared`、`continued`、`ownRun` 与四项计数。
  - `clear-inventory` 可带 Run 参数，答 `run`（条数、边界数、接入次数、最早时间、会断开的父链接数；越过切点或读不出时为 `null`）；它与 `archive-status` 都答 `clearRunUnderway`。`quarantine` 遇到 `.clearing-run` 拒绝；`clear-all` 把它当本项目文件一并删除，即覆盖未完成的按 Run 清除。
  - `capture-begin` 在预写前校验父条目，未知时报 `capture-parent-unknown`，不留 pending。
  - `clear-all` 写意向的代码抽成 `place_intent()`，两个清除共用。
- **插件**：
  - 确认界面写明：范围是整条会话谱系、接入次数、最早一条的时间；Prompt Entry、Pending Capture、边界事件数；会断开的其他 Run 父链接数；编号可能前移；其他 Run 不变；consent 与采集模式不变；`CLEAR_BOUNDARY`。选项「清除当前 Run / 取消」，不含 prompt 与 Run id。
  - 清除成功后，本 Run 各会话的分支改为显式新根，清空本 Run 的 lifecycle 队列、`run-mode:` 里的 Collection Boundary、`deferredClear`，对账记录只在属于本 Run 时清除；其他 Run 的 store 不动。视图重读。
  - 未完成时回复「逻辑删除已完成……物理清除未完成」并列出残留（非空 `-wal`、迁移备份），档案标为不可用；被挡住的提交弹「继续清除 / 禁用当前 Run 后继续」，续做不再确认；`/prompt-history clear-run` 遇到别的 Run 的意向只给「继续清除 / 取消」，完成后说明当前 Run 未清除。`status` 增加 `clear-run: unfinished · N residual`。
  - `capture-begin` 报 `capture-parent-unknown` 时，分支改为显式新根并重试一次。
- **与对齐稿不同**：
  - Q10 的第一次 checkpoint 去掉了：变异检查显示 `VACUUM` 之后的 checkpoint 已覆盖它。
  - Q3 的兜底要求 `capture-begin` 在预写前就校验父条目（原先要到确认时才拒绝，那时 prompt 已进入会话，无法改新根重试）；旧测试 `test_capture_refuses_an_unknown_or_self_referencing_parent` 随之改为预写时拒绝。确认时的校验保留。
  - helper 回答多了 `ownRun`：续做可能清掉的是别的 Run，插件据此决定是否清理本 Run 的状态、以及回复措辞。
  - helper protocol 没有加一，理由同 Issue 28、30。
- **测试**：
  - helper 新增 13 项黑盒测试：byte marker 扫描（db、`-wal`、`-shm`，目标消失、其他 Run 保留）、父链接置空、freelist 为 0、generation 不变；no-op 与 `--continue` no-op；隔离档案拒绝；两种崩溃点（未删、已删但 WAL 仍有原文）由另一个 Run 续做并验证意向期间六个命令被拒；外部读者占住 WAL 时未完成、释放后续做；外部写锁挡住删除时报 `clear-run-unfinished`；等在途命令；旧 schema 档案升级后不留迁移备份；`clear-all` 覆盖未完成的按 Run 清除；sequence 不复用、另一个 Run 的 pending 在父条目被清后仍能确认；损坏档案拒绝且不写意向；inventory 计数；预写时拒绝已被清除的父条目。
  - plugin test 新增 13 项：no-op、确认界面与取消、成功（本 Run 状态清理、其他 Run 不变、之后提交为根）、隔离拒绝、残留报告与阻塞与 `status`、被挡住的提交续做、别的 Run 的意向只续做、续做时已由别处完成、宿主在切点后终止、续做时取消、`clear-all` 未完成时的提示、别的 Run 的对账记录保留、父条目被清后改新根重试。
  - 变异检查：helper 28 条中 26 条被抓到，存活 2 条（最后的 checkpoint、关库后的 WAL 空检查）互为兜底：去掉任一条，另一条仍把残留判为未完成；另有损坏类的 quick_check 在当前夹具下等价（计数时即报 `archive-integrity`）。插件 27 条全部被抓到。
  - 门禁：两个宿主版本各 393 项 plugin test，静态 9 项，bridge 32 项，helper 143 项，真实 git 5 项。
- **真人 PTY（cmux，2.1.283，两个 Run 同一测试项目）**：
  - 无档案时 no-op；A 取消后档案不变；A 确认后 A 的行全部消失、插件数据里扫描不到 A 的标记、B 的行与 sequence 不变、WAL 0 字节、freelist 0；
  - 之后 A 的提交成为根（sequence 6，未复用 1–3），B 接着自己的分支；A 展开 band 时编号前移，B 的条目显示为另一个 Run；
  - 故障注入（外部读者占住 WAL）：B 清除时得到残留报告（`-wal` 86552 字节），意向留下；A 的 `status` 为 `clear-run: unfinished · 1 residual`，A 的提交被「继续清除 / 禁用当前 Run 后继续」挡住；释放读者后 A 选「继续清除」完成 B 的清除，WAL 归零，插件数据里扫描不到 B 的标记，A 的提交入档；
  - B 之后的提交作为根入档，没有被挡住。
  - 续做成功后的 toast 在 `read-screen` 里读不到，未目视确认。
- **未覆盖**：
  - 被挡住提交的对话框第一句沿用挡住它那一步的原因（PTY 里是「无法读取未决的 Pending Capture」，因为是 `capture-list` 先被拒），不是专门为按 Run 清除写的。
  - 真实 fork 出的 Run 在来源 Run 被清除后的父链接置空只由 helper 与 plugin test 覆盖，PTY 没有构造 fork。

## Comments

### 2026-09-23 · Run 定义修订

Issue 32 把 Run 改为会话谱系：`clear-run` 的范围随之包括该 Run 在此前所有进程（含已退出后被 resume 的进程）中产生的记录，确认界面须写明这一点。

### 实现层面对齐（2026-09-28）

现状：档案里带 `run_id` 的只有 `prompt_entries`、`pending_captures`、`timeline_events` 三张表；`open_archive` 已开 `secure_delete=ON`。fork 与并发 resume 出来的 Run，其第一条 Prompt Entry 的 `parent_event_id` 指向来源 Run 的条目：父条目被删后，`timeline-read` 的 `write_parents` 查不到它会报 `archive-sqlite`，`branch-match` 把它当断链，`capture-confirm` 的 `require_known_parent` 报 `capture-parent-unknown`。`sequence` 是项目级单调序号（`metadata.next_sequence`），band 编号是 `prompt_ordinal`（≤ 该 sequence 的条目数）。其他 Run 展开 band 时重读最新批次并替换窗口；已画出的旧行要到那时才消失。Archive generation 的身份是活动文件的 `(dev, ino, birthtime)`。

- **Q1 删除方式**：原地删除。持项目独占锁，一个事务里 `DELETE`（`secure_delete` 清零），再 `wal_checkpoint(TRUNCATE)` → `VACUUM` → `wal_checkpoint(TRUNCATE)`，最后核对 `-wal`。档案文件身份不变，Archive generation 不变。不采用 `VACUUM INTO` 重建：generation 一变，其他 Run 会走 `enterNewGeneration()` 被当成新根，而它们的记录都还在。
- **Q2 删除范围**：三张表里 `run_id = 当前 Run` 的全部行，含所有边界事件；当前 Run 写过的 `archive-quarantined` 标记也随之删除。不做例外。
- **Q3 其他 Run 的父链接**：同一事务里把其他 Run 的 `prompt_entries` 与 `pending_captures` 中指向被删条目的 `parent_event_id` 置为 NULL，它们成为根；确认界面写明断开的数量、内容不变。插件遇到 `capture-parent-unknown`（分支停在被删条目上，例如 fork 后尚未提交）时把分支改为显式新根并重试一次。
- **Q4 序号**：留下 sequence 空洞，`next_sequence` 不回退（回退会让其他 Run 的游标与幂等重试错位）；后面条目的 band 编号前移，确认界面说明。
- **Q5 拒绝条件**：本项目有任何隔离档案时拒绝（helper 从不打开隔离档案），引导 `clear-all`；活动档案损坏或 Archive unavailable 时拒绝，引导损坏对话框或 `clear-all`；`clear-all`/隔离意向未完成时沿用现有拒绝。
- **Q6 no-op**：三张表都没有本 Run 的行时 no-op，不弹确认。只有边界、没有 prompt 也要确认，界面显示「0 条 Prompt Entry、N 条边界事件」（同 Issue 30 Q11：Run ID 与时间也是元数据）。
- **Q7 当前 Run 之后**：沿用同一 Run id，会话索引不动；分支改为显式新根，下一次提交是根条目；清除时不写任何标记事件。插件清空本 Run 的 lifecycle 队列、本 Run 的 reconcile 记录、`run-mode:` 里的 Collection Boundary 与 `deferredClear`，重置视图；保留 consent 与采集模式；其他 Run 的 store 键不动。
- **Q8 确认界面**：Run 起始时间；进程接入次数（`run-started` + `run-attached`），说明范围是整条会话谱系、跨越其所有进程接入；Prompt Entry、Pending Capture、边界事件数；断开的其他 Run 父链接数；编号可能前移；其他 Run 数据不变；consent 与采集模式不变；`CLEAR_BOUNDARY`。不显示 prompt 原文与 Run id。选项「清除当前 Run / 取消」，一次确认，无短语。数据来自 `clear-inventory` 的可选 Run 参数（共享锁、只读）。
- **Q9 切点与意向**：独占锁下先原子写 `<projectId>.clearing-run`（内容为 Run id），即切点；再做 DELETE 事务与物理步骤；全部完成后删除意向。意向存在期间一切打开报新类别 `clear-run-unfinished`（共享故障）。不复用 `.clearing`（续做它会删掉整个项目）。`clear-all` 可覆盖它（意向在 `<projectId>.` 前缀的删除范围内）；`quarantine` 遇到它拒绝；`clear-inventory` 与 `archive-status` 报告 `clearRunUnderway`。意向写在 DELETE 之前，否则提交后、checkpoint 前崩溃会让原文留在旧 WAL 帧里而无状态记录。
- **Q10 物理完成的判据**：`wal_checkpoint(TRUNCATE)` 完整（无 busy、帧全部回写）；`VACUUM` 后再 checkpoint(TRUNCATE)；`-wal` 不存在或 0 字节；本项目的 `.pre-migration-*` 迁移备份已删除（本次打开刚迁移时备份仍在）。任何一步失败即报「逻辑删除完成、物理清除未完成」，列出残留（`-wal` 字节数、迁移备份路径，或「空间回收未完成（archive-full）」），意向保留。`VACUUM` 失败也算未完成。
- **Q11 续做**：任何 Run 都可续做，不再确认；续做再做一遍 DELETE（幂等）与全部物理步骤。helper 加 `--continue`：意向已不在时什么都不删，答 `cleared:false`。被挡住的提交弹「继续清除 / 禁用当前 Run 后继续」，正文列残留并说明这是之前确认过的一次按 Run 清除（不说「当前 Run」）。Run B 执行 `/prompt-history clear-run` 而意向属于 Run A 时，只给「继续清除 / 取消」，完成后回复「之前的按 Run 清除已完成；当前 Run 的记录未清除，如需清除请再执行一次」。`status` 增加 `clear-run: unfinished · N residual`。
- **Q12 回复**：成功时列出清掉的 Prompt Entry、Pending Capture、边界事件与断开的父链接数，说明其他 Run 记录不变、编号可能前移、consent 与采集模式未变、下一次提交开始新的根，并附边界声明。切点前失败答「未删除任何内容（类别）」；切点后失败（含宿主超时）重新问 `archive-status` 判断，按 Q10 报未完成。`clear-run` 不看 consent 状态；无档案或无本 Run 的行时 no-op。文字不含原文或哈希。
- **Q13 验收**：helper 黑盒（db/`-wal`/`-shm`/迁移备份的 byte marker 扫描：目标消失、其他 Run 保留；父链接置空与 sequence 空洞；no-op；隔离档案拒绝；构造 `.clearing-run` 的各崩溃点；`chflags uchg` 锁迁移备份构造残留；`--continue`；`clear-all` 覆盖未完成的 `clear-run`；意向期间其他命令被拒）；plugin test（no-op、取消、成功、跨 Run 续做、`capture-parent-unknown` 改新根重试、残留报告与阻塞、`status`）；双 Run 真人 PTY（实现后另行征得授权）；逐条变异检查。helper protocol 不加一，理由同 Issue 28、30。

### Code review 修复（2026-09-28，round 1）

产物在 `.code-review/runs/20260928-214837/round-1/`（已 gitignore）。8 条中修 7 条，1 条进 backlog，无驳回。

- **隔离目录读不出来时失败关闭**：`clear_count_quarantined()` 在 `opendir` 失败（非 `ENOENT`）时报 `database-unavailable`，不再当作没有隔离档案（`clear-run` 与 `clear-all` 都经过它）。
- **`clear-all` 接手未完成的按 Run 清除**：从 `.clearing-run` 读出 Run id，加进要删的会话索引集合；该 Run 的行此时可能已不在档案里。
- **本 Run 发起的清除未完成时**，立即清理本 Run 的插件状态（分支新根、lifecycle 队列、Collection Boundary），之后无论由谁完成，都不会把已删的边界补写回去。
- **回答丢失**：`clear-run` 以 `helper-call-failed` 或无法解析的回答失败、且没有清除在进行时，重读本 Run 的计数；已为 0 就按已完成回复并清理状态，不再说「未删除任何内容」。
- **命令续做发现已由别处完成时**解除档案不可用的记录，与被挡住提交的路径一致。
- **清理**：插件的 lifecycle 队列与 Collection Boundary 清理抽成 `forgetOwedLifecycle()`、`forgetCollectionBoundary()`，两种清除共用；helper 的 `clear_count()` 可带一个绑定参数，替代 `clear_run_count()`。
- **backlog**：`20260928-run-clear-confirmation-counts-can-go-stale.md`（确认对话框停留期间另一个 Run 新建的父链接未在确认前展示）；`20260928-shared-intent-writer.md` 注明 `clear-all` 与 `clear-run` 已共用 `place_intent()`。
- **测试**：helper 新增 2 项（共 145），plugin test 新增 3 项（共 396）；新增的 5 条变异全部被抓到。
