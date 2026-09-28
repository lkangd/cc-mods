# 26: 记录并闭合 Integrity gap

**What to build:** 当宿主级 fail-open 或不可阻止 lifecycle 写入使完整性无法证明时，留下永久可见的 Integrity gap；恢复正确采集后开始新的可验证区间而不改写历史。

**Blocked by:** 16「以 Clear Boundary 划分 Conversation Segment」、17「跨 reload 与重启维护 Run 身份」、25「Archive unavailable 时失败关闭」

**Status:** ready-for-agent

- [ ] Run、Clear 等不可阻止 lifecycle 事件写入失败时，使用不含 prompt 原文的小型恢复队列和幂等 ID。
- [ ] 下一次 composer submission 前必须先清空 lifecycle 恢复队列；能唯一恢复的事件保持原语义且不重复。
- [ ] plugin 崩溃导致 prompt 被宿主放行后，恢复流程结合 transcript、Pending Capture、Run/Segment 身份和活动前缀进行对账。
- [ ] 无法唯一证明 Timeline Events 与 Claude Code 对话一致时，写入显著、不可变的 Integrity gap，而不是静默忽略或猜测。
- [ ] Integrity gap 与 disabled Collection interval、Archive unavailable 和 Clear Boundary 在模型、UI 与 `status` 中保持不同含义。
- [ ] 正确采集恢复后写 Integrity recovery boundary；当前健康可回到 healthy，但历史 Gap 永久保留且跨 Gap 历史不得称为完整。
- [ ] timeline 按 sequence 显示 Gap 开始与恢复边界，并允许浏览其前后 Prompt Entries。
- [ ] 重复恢复、reload 或重启不会重复 Gap/恢复边界，也不会删除原 Gap。
- [ ] plugin test 注入 hook crash 与 lifecycle 写失败；真实 PTY 验证 fail-open 恢复、可见边界和 `status` 表达。

## Comments

### 实现层面对齐（2026-09-29）

现状：`overflowed`、`damaged`、`unobservedClear` 与只在内存里的 `deferredClear` 都只进 `/prompt-history status`，不进档案与 band；前两者设上后从不清除，`clear-all`/`clear-run` 之后仍在。整条 lifecycle 记录读不出时 `loadLifecycle` 静默回到空状态。插件 `prompt.submit` 抛错或超时时宿主放行 prompt（"a broken plugin never blocks a prompt"），`$.store` 里没有任何在途标记，transcript 预检（`transcriptKept`）放过标记之后追加的行，这类丢失完全无痕；崩溃在 `capture-begin` 之后时留下孤儿 pending，但 `pendingDiscovered` 仍为 true，要到 reload 或 `status` 才被列出。helper 只接受 `boundary_kind_valid()` 里的七种边界，`timeline_events` 无附加列；`clear-run` 按 `run_id` 删全部边界。`tests/helper_protocol.py` 有一项把 `integrity-recovery` 当未知种类。

- **Q1 档案表示**：`boundary_kind_valid()` 新增 `integrity-gap` 与 `integrity-recovery`，按 Run 归属（`run_id` 为发生丢失的 Run），不带原因，schema 不变。原因只在检测时的 toast 与 `status` 里出现。
- **Q2 哪些丢失算 gap**：`overflowed`、`damaged`（含整条记录读不出而回到空状态）、`unobservedClear` 算。未完成的 clear 转换（边界已在档案）、「Run 未记录离开」（spec §6 只显示不伪造）、已退役 generation 的写入被丢弃（属于已删除历史）不算。三个标志在 gap 与恢复边界都落档后清除。
- **Q3 generation 未知的 lifecycle 写入**：区分「当时没有档案」（`null`）与「未知」（`'unknown'`：盖章时 `archive-status` 失败、Issue 30 前的旧队列项、另一进程延后的 clear）。未知者回放时丢弃并记 gap。延后的 clear 在观察到 `/clear` 时即记下 generation。关闭 backlog `20260928-unknown-generation-lifecycle-writes-replay-unchecked.md`。
- **Q4 fail-open 检测**：`$.store` 在途标记（Run、宿主进程世代、随机调用 id，不含原文）加 hook 外层 catch。意外抛错时 catch 把「欠一个 gap」落盘后重抛；宿主超时或进程崩溃时 catch 不执行，由下一次提交发现遗留标记。不用 transcript 比对（内部 user 行误报）。
- **Q5 PTY 制造崩溃**：只在 `~/.cache/…` 下的插件副本里改一行，在指定阶段 `throw`，覆盖 pending 之前与之后；lifecycle 写失败沿用外部读者持锁或 `chflags`。生产代码不留注入开关。
- **Q6 标记阶段**：`before-pending` 一律记 gap，不用 transcript 行数豁免；`pending` 不记 gap，重置 `pendingDiscovered` 让下一次提交重新列出，交 Issue 15 对账（修掉孤儿 pending 要等 reload 的问题）；`settled` 只删标记。
- **Q7 标记写入点**：确认 Run 已启用、consent 已给之后、`settlePending` 之前。外层 catch 只在标记已写时记 gap；disabled 或未同意的 Run 不写标记也不记 gap。
- **Q8 欠账存储**：Run 的 lifecycle 记录里加 `gap: {eventId, occurredAt, generation, reasons}`，不占队列容量，每 Run 至多一个；落档前的新丢失只并入 `reasons`。eventId 检测时随机生成并立即落盘、重放原样使用；恢复边界 id 由 gap id 派生。在途标记另用键 `prompt-trail:inflight:<projectId>:<runId>`。
- **Q9 写入时机**：`drainLifecycle` 里先补写队列，再写 gap；本 Run 队列已清空且无未决 pending 时紧接着写恢复边界，然后本次提交照常采集。两者 sequence 相邻；gap 表示「本 Run 在它之前、上一条可验证事件之后的记录无法证明完整」。gap 写不进去与欠 lifecycle 一样拦下提交；gap 盖章的 generation 已退役则一并丢弃。
- **Q10 清除**：`clear-run` 按 `run_id` 连同本 Run 的 gap 与恢复边界一起删除；`clear-all` 同。两者清掉 `$.store` 里欠着的 gap、三个丢失标志与在途标记。
- **Q11 文案**：band 行 `—— Integrity gap：此前的记录无法证明与对话一致 ——` 与 `—— 已恢复可验证采集（此前的缺口不会补齐）——`，警示色、不 dim、不折叠进「另一 Run · N 条」（同「Run 未记录离开」）。检测到时 toast 一次并写明原因。`status` 新增 `integrity:` 行（healthy 或欠 gap 及原因）与「本项目有 N 处 Integrity gap，跨越它们的历史不完整」；N 来自 `archive-status` 新增的计数。band 标题不加标记。
- **Q12 lifecycle 在途标记**：只给 `classic.SessionEnd(reason=clear)` 处理写，阶段 `clear-observed`，入队后删除；遗留即记 gap，原因「/clear 未能记录」。SessionStart 与其他 SessionEnd 不加。
- **Q13 陈旧判定**：标记带宿主进程世代与随机调用 id；凡不是本模块实例正在执行的调用即陈旧，含同进程 reload 前留下的。宁可在 reload 恰逢提交途中时多记一个 gap，也不少记。
- **Q14 停用与启用**：`disable` 总是生效，顺带尝试写欠着的 gap，失败则继续欠着；停用期间不写恢复边界。`enable` 顺序：gap（若欠）→ `collection-resumed` → 恢复边界；gap 已在停用前落档而恢复边界未写时，在 `collection-resumed` 之后补上。
- **Q15 文档**：`CONTEXT.md` 的 Integrity gap 补「属于一个 Run，随该 Run 的清除一起删除」；spec §9、§13、§15 补本票内容并标「2026-09-29 Issue 26 修订」。
- **Q16 其他 Run**：已欠着的 gap 与恢复边界随 `flushForeignLifecycles` 替已不在运行的 Run 补写；外来在途标记只在用 `clear-all` 的存活判定确认该 Run 无存活进程时才当陈旧并记 gap。替别的 Run 补写不弹 toast，只体现在 `status` 计数。
- **实现手段**：helper 测试里的未知种类改名；plugin test 以预置陈旧标记覆盖检测、以新增假 helper 选项在指定阶段制造未捕获抛错覆盖外层 catch；100k 夹具补 gap 行；真人 PTY 另行征得授权。
