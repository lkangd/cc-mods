# 26: 记录并闭合 Integrity gap

**What to build:** 当宿主级 fail-open 或不可阻止 lifecycle 写入使完整性无法证明时，留下永久可见的 Integrity gap；恢复正确采集后开始新的可验证区间而不改写历史。

**Blocked by:** 16「以 Clear Boundary 划分 Conversation Segment」、17「跨 reload 与重启维护 Run 身份」、25「Archive unavailable 时失败关闭」

**Status:** resolved

- [x] Run、Clear 等不可阻止 lifecycle 事件写入失败时，使用不含 prompt 原文的小型恢复队列和幂等 ID。
- [x] 下一次 composer submission 前必须先清空 lifecycle 恢复队列；能唯一恢复的事件保持原语义且不重复。
- [x] plugin 崩溃导致 prompt 被宿主放行后，恢复流程结合 transcript、Pending Capture、Run/Segment 身份和活动前缀进行对账。
- [x] 无法唯一证明 Timeline Events 与 Claude Code 对话一致时，写入显著、不可变的 Integrity gap，而不是静默忽略或猜测。
- [x] Integrity gap 与 disabled Collection interval、Archive unavailable 和 Clear Boundary 在模型、UI 与 `status` 中保持不同含义。
- [x] 正确采集恢复后写 Integrity recovery boundary；当前健康可回到 healthy，但历史 Gap 永久保留且跨 Gap 历史不得称为完整。
- [x] timeline 按 sequence 显示 Gap 开始与恢复边界，并允许浏览其前后 Prompt Entries。
- [x] 重复恢复、reload 或重启不会重复 Gap/恢复边界，也不会删除原 Gap。
- [x] plugin test 注入 hook crash 与 lifecycle 写失败；真实 PTY 验证 fail-open 恢复、可见边界和 `status` 表达。

## Answer

Prompt Trail 现在把无法证明完整的区间记为该 Run 的 Integrity gap，紧接着写恢复边界，历史里的 gap 永久保留。实现在 `5fd8805`（helper）、`b7fb479`（lifecycle 丢失与 generation 未知）、`9791236`（在途标记）、`6c81a46`（停用/启用、清除、`status`）；`48161fd` 补了变异检查发现的测试，`ccd35eb` 改了 `CONTEXT.md`、spec 与 backlog。对齐见下方「实现层面对齐」。

- **helper**：
  - `boundary-append` 接受 `integrity-gap` 与 `integrity-recovery`，与其他边界共用 sequence 和幂等规则；schema 不变。
  - `archive-status` 多答两项：`integrityGaps`（档案里 gap 的条数，只读连接计数；没有档案为 0，读不出或清除/隔离意向在时为 `null`）与 `liveRuns`（别的存活进程接入的 Run；读不出为 `null`，不影响其余字段）。
- **插件**：
  - lifecycle 记录多了 `gap`（事件 id、Run、segment、branch、时间、generation、原因、`landed` 与恢复边界的时间）。`overflowed`、`damaged`（含整条记录读不出，原先静默回到空状态）、`unobservedClear` 在 drain 里转成 gap；队列全部落档后写 gap，保存 `landed`，再写恢复边界，然后清掉 gap 与三个标志。gap 写不进去与欠 lifecycle 一样拦下提交。
  - 队列项没有 generation（Issue 30 之前）或盖章时 `archive-status` 失败的，记为 `'unknown'`，回放时丢弃并记 gap；`null`（当时没有档案）照旧不校验回放。别的 Run 的记录同样处理，gap id 由被丢弃的写入派生。延后的 `/clear` 在观察到时即盖章。
  - 在途标记 `prompt-trail:inflight:<projectId>:<runId>:<call>`（宿主进程世代、阶段、segment、branch、时间，不含原文）：已启用、已同意的提交在对账前写下，预写后改为 `pending`，hook 正常结束时删除，抛错时留下且该调用不再算在途；`/clear` 从观察到入队期间留 `clear-observed` 标记，延后期间保持在途。下一次提交（和 `enable`）先判定：`before-pending`、`clear-observed` 或读不出的标记记为 gap（原因 fail-open / `/clear` 未能记录），`pending` 让本 Run 重新列出 pending。别的 Run 的标记只在它不在 `liveRuns` 里时判定，`liveRuns` 为 `null` 时不动。gap id 由标记键派生，重复判定落到同一个 gap。标记写不进去报 `inflight-unrecorded`，读不出报 `inflight-unreadable`，都拦下提交。
  - 已不在运行的别的 Run 欠的 gap 与恢复边界随 `flushForeignLifecycles` 补写；仍存活的只补 gap，恢复边界留给它自己。
  - `disable` 先写欠着的 gap 再写停止边界；`enable` 的顺序是 gap → `collection-resumed` → 恢复边界。
  - `clear-run` 清掉本 Run 欠的 gap、丢失标志与本 Run 的陈旧标记；`clear-all` 对所有 Run 如此，只保留 `liveRuns` 里的 Run 的标记。档案里的 gap 行随 `run_id` 删除（helper 原有行为）。
  - band：两行以黄色、不 dim 绘制，折叠进「另一 Run · N 条」时仍单独显示。检测到本 Run 的 gap 时 toast 一次并写明原因；替别的 Run 记的不 toast。
  - `status` 新增 `integrity:`（healthy / gap owed 与原因 / gap recorded 待恢复边界 / N 次提交未正常结束）和 `integrity gaps:`（N · 跨越部分不完整，或 unknown）；三个丢失标志不再在 `clear transition:` 里重复。
- **与对齐稿不同**：
  - Q2：`settleGap` 清掉全部三个标志，不区分落档后新出现的丢失。区分规则在变异检查里被证明走不到：它结算的正是即将保存的本地状态。
  - Q9：只有本 Run 由标志转成的 gap 盖检测时的 generation；由标记或被丢弃的写入派生的 gap 写入时不校验 generation（这类 gap 的原本 generation 同样无法确定）。
  - Q16 需要知道哪些 Run 存活，`archive-status` 因此多了 `liveRuns`；为此把 helper 的存活扫描拆成可失败返回的版本。
  - 新增两个 Run 级故障类别 `inflight-unrecorded`、`inflight-unreadable`（失败关闭，对齐时未单列）。
  - 旧测试随 Q3 改期望：预置的队列项补上 `generation: null`；「旧版本留下的 `run-ended`」改为断言记成该 Run 的 gap。
  - helper protocol 没有加一，理由同 Issue 28、30。
- **测试**：
  - helper 新增 5 项：两种边界共用 sequence 且幂等、`timeline-read` 读回；gap 计数随 `clear-run` 减少；读不出时计数为 `null` 且档案字节不变；没有档案时为 0；`liveRuns` 列出别的进程的 Run、不列本进程、目录读不出时为 `null`。100k 夹具补了 gap 行；原来把 `integrity-recovery` 当未知种类的测试改用别的名字。
  - plugin test 新增 34 项（`tests/integrity_gap.test.tsx`）：三种标志各留 gap；gap 只写一次；gap 写不进拦下提交；band 颜色与不折叠；四种 generation 未知情形（含别的 Run、存活 Run 不写恢复边界）；在途标记（正常结束不留、两种陈旧、`pending` 走对账、下游抛错、写不进拦下、别的 Run 已离开/仍存活、`clear-observed`、停用 Run 不写）；`/clear` 标记的两条路径（仅 2.1.283）；停用/启用顺序两项；两种清除；`status` 三项；变异补测四项。
  - 变异检查：插件 35 条中 30 条首轮被抓到，补测 4 项后全部被抓到，另 1 条因简化 `settleGap` 不再适用；helper 7 条中 6 条被抓到，存活 1 条（`clear_open_archive` 打开失败时计数为 0）等价：SQLite 只读打开非数据库文件不报错，要到查询才失败。
  - 门禁：两个宿主版本各 430 项 plugin test，静态 9 项，bridge 32 项，helper 150 项，真实 git 5 项。
- **真人 PTY（cmux，2.1.283，测试项目，插件副本里按 prompt 标记注入 `throw`）**：
  - pending 之前抛错：宿主报 `prompt.submit hook skipped: threw Error: pt26-crash` 并放行，模型回复；store 留下 `before-pending` 标记，档案无该条。`status` 为 `integrity: healthy · 1 次提交未正常结束…`。下一次提交前写入 gap 与恢复边界（seq 3、4），之后才是该 prompt（seq 5）；`status` 为 `integrity gaps: 1 · …`；band 依序画出两行，使用者目视确认为黄色并看到 toast。
  - pending 之后抛错：标记为 `pending`，档案有 1 条 pending；下一次提交弹出对账对话框，没有记 gap；选「已进入」后归档，pending 与标记清零。
  - `clear-run` 后该 Run 的行（含 gap）全部删除，`status` 为 `integrity gaps: 0`。
- **未覆盖**：
  - 插件自身代码在 pending 之前抛出、未被捕获的错误，在 plugin test 里造不出来：提交路径上的 helper 与 store 失败都已被捕获，宿主也会吞掉 toast 的失败。这条路径由预置陈旧标记的测试和 PTY 的注入覆盖。宿主按时限杀掉 hook 没有实测。
  - `clear-observed` 标记只由 2.1.283 的 plugin test 覆盖，PTY 没有构造 `/clear` 途中退出。
  - `prepareProject` 失败时延后的 `/clear` 没有标记，进程在补写前退出仍无痕，与对齐前相同。
  - 「另一 Run · N 条」的 N 包含被单独画出的 gap 行。

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

### Code review 修复（2026-09-29，round 1）

`/code-review`，产物在 `.code-review/runs/20260929-005742/round-1/`（已 gitignore）。10 条中修 7 条，驳回 3 条，无 backlog。

- **修复**：
  - #1、#4：别的 Run 记录里的丢失标志（含整条读不出的记录，现按 damaged 处理），在该 Run 不在 `liveRuns` 里时转成它的 gap，gap id 由记录键与原因派生；仍存活的 Run 留给它自己记。
  - #2：外来 Run 的 run-mode 为 disabled 时只补 gap，不写恢复边界（同 Q14）。
  - #3：`/resume` 时保留的 `attachment.leaving` 在保存时就盖 generation；没有 generation 的按 unknown 处理。
  - #8：在对话框里选「禁用当前 Run 后继续」放行的提交，在交给宿主前删除在途标记。
  - #9：`GapReason` 由 `lifecycle.ts` 的 `GAP_REASONS` 元组推导，运行时校验共用这份清单。
  - #10：marker key 的解码收进 `markerOwner()`，判定、清除与 `status` 共用。
  - 新增 plugin test 6 项；这几处修复的 6 条变异全部被抓到。
- **驳回**：
  - #5（`/clear` 标记写失败且之后 lifecycle 也写不进）：此时 store 不接受写入，没有可以留下持久痕迹的地方，行为与改动前相同。
  - #6（`archive-status` 失败时由标志转成的 gap 不校验 generation）：对齐时已取「宁可多记」，这类 gap 的 generation 同样无法确定，丢弃会少记。
  - #7（并发写入使 gap 与恢复边界的 sequence 不相邻）：Q9 的「相邻」是描述，不是约束；中间插入别的 Run 的事件不改变两者的含义。
- 另有一条因批次不匹配未进结果：locator 读不出时 `liveRuns` 会漏掉那个 Run。这与 `capture-list` 的既有规则一致（不受信任的 locator 不算任何 Run 的声明），未处理。
