# 29: 物理清除当前 Run

**What to build:** 让使用者确认后只清除当前 Run 的 Prompt Trail 敏感数据，并准确说明其他 Run、Quarantined Archive、Claude Code 副本和物理介质不在这次删除保证内。

**Blocked by:** 14「切换 Run collection mode」、28「隔离损坏的 Archive generation」

**Status:** ready-for-agent

- [ ] 当前 Run 无目标记录时，`/prompt-history clear-run` 返回 no-op 且不询问确认。
- [ ] 有数据时先显示当前 Run（整条会话谱系，跨越其所有进程接入）、待删记录数和副本边界，并要求一次明确确认；确认文本不包含 prompt。
- [ ] 确认后删除当前 Run 的 Prompt Entries、Pending Captures、相关原文和可关联的敏感 prompt 元数据，其他 Run 数据保持不变。
- [ ] Collection consent 和当前 Run collection mode 不因 `clear-run` 改变；后续采集遵循现有模式。
- [ ] 存在无法安全打开的 Quarantined Archive 时拒绝声称完整按 Run 删除，并引导使用项目级清除。
- [ ] 删除使用 secure delete、WAL checkpoint/truncate 和必要空间回收；隔离 fixture 的 byte marker 扫描确认目标消失、其他 Run marker 保留。
- [ ] 逻辑删除完成但 WAL、备份或残留文件清理失败时，报告“逻辑删除完成、物理清除未完成”，列出残留并保持 Archive unavailable。
- [ ] 确认流程重申不会删除 Claude Code transcript/history、文件系统快照、系统/第三方备份，也不保证 SSD 物理不可恢复擦除。
- [ ] 控制命令不创建 Prompt Entry；日志、错误和删除报告不泄漏被删原文或文本哈希。
- [ ] helper black-box、plugin test 与真实 PTY 覆盖 no-op、取消、成功、其他 Run 保留、Quarantine 拒绝和部分物理失败。

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
