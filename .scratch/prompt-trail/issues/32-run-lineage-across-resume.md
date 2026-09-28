# 32: Run 谱系跨 resume 延续

**What to build:** 把 Run 从「一个进程」改为「一条会话谱系」：`claude --resume`、`--continue` 与会话内 `/resume` 找回并续接原 Run，普通启动与 fork 仍开新 Run；进程只是接入或离开一个 Run，同一 Run 同一时刻至多一个存活进程接入。

**Blocked by:** 14「切换 Run collection mode」、17「跨 reload 与重启维护 Run 身份」

**Status:** resolved

- [x] `source=resume`（`claude --resume`、`--continue`、会话内 `/resume`）按 classic session id 在 bridge 的会话索引里查出该会话所属的 Run 并沿用（即使该会话从未产生事件，见第 9 条）；索引里没有该会话时新建 Run。普通启动照旧新建 Run；后台 `/fork` 与 `--fork-session` 照旧新建 Run。
- [x] 会话内 `/resume` 到属于另一个 Run 的会话时，进程改绑到该 Run：locator 换成新 Run，后续事件记在新 Run 名下，原 Run 在本进程中离开。
- [x] Run 边界改为三种：`run-started` 只在 Run 首次创建时写；`run-attached`（显示「Run 续接」）在进程 resume 接入已有 Run 时写；`run-detached`（显示「Run 离开」）在进程退出或 `/resume` 去往别的 Run 时写。原 `run-ended` 不再使用（插件未发布，无旧档案需兼容）。
- [x] 每次接入与离开各有稳定幂等键，重复事件或重试不产生第二条；异常退出不伪造离开，时间线显示「未记录离开」。
- [x] 同一 Run 已被一个存活进程接入时，后来 resume 同一会话的进程新建 Run，并在 run-started 中记录其来源 Run（「从 Run X 分出」）；接入者已不存活（进程世代已终止）时正常接入。
- [x] Run collection mode 随谱系延续：在一个进程中停用后，resume 回来仍为停用。
- [x] helper 路径、摘要和 protocol 按进程接入绑定（而非整个 Run）：运行中制品变化使本次接入停止采集，恢复原制品或新的进程接入才能继续；一个 Run 的不同接入可以使用不同制品。
- [x] 同进程 `/reload-plugins` 仍延续当前接入，不写 attached/detached；继承环境但进程世代不同的子进程不得沿用父进程的接入。
- [x] spec、`CONTEXT.md`、Issue 05 的验收场景以及 Issue 18、24、29 的票面按新定义修订；Issue 17 的 Comments 追加修订说明。
- [x] plugin test、bridge/helper 协议测试与真实 PTY（`2.1.273`、`2.1.278`）覆盖：退出后 `claude --resume` 续接、`--continue` 续接、会话内 `/resume` 到同 Run 与不同 Run、无记录会话的 resume、双终端并发 resume、停用后 resume、异常退出后 resume。

## Comments

### 2026-09-23 · 由 Issue 18 拆出（与使用者对齐）

使用者要求 `claude --resume` 与 `/resume` 都保持原 Run，并让时间线与会话详情一致。逐项对齐的结论：

1. Run = 会话谱系（推翻 spec §2/§6 与 Issue 17「新进程开新 Run」的定义）。按 classic session id 找回 Run，找不到才新建；普通启动与 fork 不变。
2. 会话内 `/resume` 到另一个 Run 的会话时，进程改绑到那个 Run。
3. 边界改为 `run-started` / `run-attached` / `run-detached`；「Run 未记录结束」改为「未记录离开」。
4. 双终端同时 resume 同一会话：后到者新建 Run 并记录来源，等同 fork，不改分支模型。
5. Run collection mode 与 `clear-run` 都跟随谱系；`clear-run` 的确认界面写明范围跨越该 Run 的所有进程。
6. 档案不删任何记录；「resume 节点之后」不在活动路径上的条目只在视图中折叠（归 Issue 18）。
7. fork 不变。
8. 拆票：本票只做 Run 谱系；分支重建与视图留在 Issue 18，18 改为被本票阻塞。

### 2026-09-23 · 实现前的两处设计（与使用者对齐）

9. **会话 → Run 索引由 bridge 维护**：plugin data 下每个会话一个私有小文件，只存 session id、Run id 与 archiveGeneration，不含 prompt；每次发布 locator 时为新会话写入，resume 时查它。Run 仍只在 bridge 一处决定。副作用（已接受）：从未产生事件的会话被 resume 时也续接原 Run，比第 1 条「档案里无事件就新建」略宽。索引随 `clear-all`（Issue 30）一并删除。（2026-09-28 Issue 30 修订：仍在运行、会在新 generation 继续的 Run 保留索引。）
10. **locator 按进程命名**：`<session_id>.<hostPid>-<启动秒>-<启动微秒>.json`，修复并发 resume 同一会话时后到进程覆盖先到进程 locator 的既有缺陷；hook 列出 `<session_id>.*.json`，选 helper preflight 通过的那一个。

### 2026-09-23 · 实现（TDD，未提交）

**bridge**（`src/prompt_trail_bridge.c`）：
- locator 改名为 `<session>.<pid>-<启动秒>-<启动微秒>.json`；stale 清理、前驱读取仍识别旧名 `<session>.json`，开发期遗留文件会被清掉。`remove` 只删本进程自己那一份。
- 会话索引 `<plugin data>/sessions/<session>.json`（0600，目录 0700），内容只有 `indexVersion/sessionId/runId/archiveGeneration`。新会话在发布 locator 之前写入；已存在的不覆盖。记录存在但不可信时失败关闭（`session-index-untrusted` / `session-index-invalid`）。
- `resume`：索引里有这个会话就沿用它的 Run，除非该 Run 正被另一个存活进程占用（`run_held_elsewhere()` 扫描 locator），那样就新开 Run；索引里没有就新开 Run。`clear` 仍然必须有前驱。`clear`/`resume` 发布后清掉本进程的其他 locator，不管它们属于哪个 Run。
- 自带的旧用例改用新命名：进程内 `/resume` 拆成三条（同 Run、别的 Run、未索引会话）；「新进程 resume 开新 Run」改写为并发占用场景。

**helper**：preflight 按自身宿主进程世代算出唯一合法的 locator 路径，另一进程的 locator 返回 `locator-path`；`boundary_kind_valid()` 去掉 `run-ended`，加入 `run-attached`/`run-detached`；`timeline-read` 每行多返回 `segmentId`。

**状态机**（`hooks/lifecycle.ts`）：`ended` 换成 `attachment = { id(随机), host(进程世代), segmentId, closed?, leaving? }`。
- 这个进程第一次写入前要开启接入：Run 从未开始过则写 run-started（插队首），否则写 run-attached（排队尾）。
- 同一进程世代、尚未关闭的接入视为 reload，不再写。
- 退出时写 run-detached。
- 进程内 `/resume` 在 SessionEnd 时只预备一条 `leaving`：接入下一个会话时，如果仍在同一个 Run 就丢掉（`stayAttached`）；如果转到了别的 Run，就由 `detachAbandoned` 把它写进旧 Run 的队列。
- 事件 id：run-started 仍是 `sha256(kind:project:run)`；attached/detached 是 `sha256(kind:project:run:attachmentId)`。

**hook**：
- 用 `$.fs.list` 列出本会话的所有 locator，逐个检查，取 helper preflight 通过的那个；一个都没有时判为 `claude-code-version-unproven`。
- `ensureRunStarted` 改为 `ensureRunAttached`，写入前先调用 `detachAbandonedRuns()`。
- `applyLifecycle` 在退出和进程内 `/resume` 时都会算出离开所需的字段；`/resume` 这条不受 Run collection mode 短路。
- 面板显示「Run 开始 / Run 续接 / Run 离开 / Run 未记录离开」。某个 run-started 所在的会话里如果更早已有别的 Run 的事件，就显示「从 Run xxxxxxxx 分出」。档案里旧的 `run-ended` 读作「Run 离开」。

**门禁**：2.1.273 / 2.1.278 各 139 项 plugin tests、8 静态、22 bridge、44 helper、TypeScript 与确定性重建全部通过。

**需要真人 PTY**（classic 事件在测试引擎里发不出来）：见下方验收清单。

### 2026-09-23 · 真人 PTY 验收

使用者确认 A–F 六个场景全部通过：退出后续接；进程内 resume 回到同一 Run；进程内 resume 到别的 Run；双终端并发 resume 同一会话；停用后续接；`kill -9` 后续接。

### 2026-09-23 · code review（`/code-review` round 1）与修复（未提交）

产物：`.code-review/runs/20260923-132858/round-1/`，共 22 条 finding。

**已修复**：
- #0 spec 与 Issue 30 的 `clear-all` 删除范围补上会话索引。索引不记项目，所以按本项目档案里出现过的 Run 去找对应记录。
- #1 Run 边界不再受 16 条上限约束后，恢复队列可能无限增长，读取时又会截断。新增 `LIFECYCLE_QUEUE_CAPACITY = 64`，对所有种类生效，读取也按这个上限。队列满时拒绝开启接入（`run-attach-refused`），不会把没开启的接入记成已开启，此时本进程被阻止写入。
- #3 进程内 `/resume` 后，`prompt.submit` 还按旧 Run 的采集开关短路：从停用的 Run 切到启用的 Run，prompt 会被漏采。现在先检查会话是否变了；变了就重新读 locator，再读采集开关。
- #4/#6 并发发布的竞态：Run 占用检查与发布之间不是原子的，两个进程也可能同时写索引。bridge 现在用 `flock` 锁住 `.publish.lock`，决定 Run、写索引、发布 locator 整段串行执行。
- #7 票据第 1 条验收条目改为「按索引判断」，与第 9 条一致。
- #8 spec §9 删掉「正常 SessionEnd 写 Run 结束」，改为 run-detached，并说明进程内 `/resume` 何时补写离开。
- #9/#10 恢复队列里旧的 `run-ended` 解析为 `run-detached` 后按原 id 重放，不再丢弃并标记 damaged。
- #11 接入 id 不再随机生成，改为从 `host` 和上一次接入的 id 派生。同一进程里两个并发写入方开启的是同一条续接，helper 只会记一次。
- #12 崩溃后续接同一 Run：本进程开启自己的接入之前，也会标出「未记录离开」。`session.start` 顺带读取 lifecycle 记录，用来区分本进程自己的接入和旧进程留下的接入。
- #16 会话索引 `rename` 之后对 `sessions` 目录做 fsync。
- #18 locator 文件名的构造收进 `prompt_trail_common` 的 `pt_locator_file_name()`，bridge 和 helper 共用。
- #20 backlog 里的白名单草图更新为新的边界种类。
- 新增 4 项回归测试：队列满时拒绝开启接入；从停用的 Run 进程内 resume 后在新 Run 采集；旧的 `run-ended` 债务按离开重放；崩溃续接后写入前就显示「未记录离开」。

**延后**：
- #5 每次提交都枚举所有 Run 的 lifecycle 记录（Issue 16 起就有，现在变成两次）→ 新建 `docs/code-review-backlog/20260923-lifecycle-store-scan-per-submission.md`。
- #13/#14 「从 Run X 分出」只能在最新 128 条的窗口里推导 → 并入 `20260922-bounded-persisted-timeline-view.md`（Issue 21）。
- #19 bridge 两份私有原子发布、#21 多个候选时重复检查 → `20260922-cleanup-minor-batch.md` 第 6、7 条。

**驳回**（都源于 Issue 17 定下的「Run 边界是惰性的」：一个进程只在它往档案里写东西时才留下接入或离开的痕迹）：
- #15/#17 停用采集的 Run 被 resume 后不写 run-attached/run-detached：这个进程什么都没归档，它这一段不留痕迹。如果为它写边界，就会出现档案里唯一的几条记录是一个明确不采集的 Run 的情况。
- #2 A → B（B 里没写任何东西）→ 回到 A 时，A 预备的离开被丢弃：B 那一段没有任何痕迹，A 的时间线保持连续，也不会留下只有离开、没有续接的一对边界。这和「进程内 resume 回到同一 Run 不写边界」是同一条规则。

### 2026-09-23 · 复验（review 修复后）

使用者确认验证全部通过，包括建议补跑的 PTY：从停用的 Run 进程内 resume 到另一 Run 后提交会被采集；两个终端同时 resume 同一会话；`kill -9` 后 resume，提交前面板就显示「未记录离开」。修复后门禁：`2.1.273`/`2.1.278` 各 143 项 plugin tests、8 静态、22 bridge、44 helper、TypeScript 与确定性重建全绿。

## Answer

Run 现在是一条会话谱系，不再等于一个进程。`claude --resume`、`--continue` 与会话内 `/resume` 都续接被恢复会话所属的 Run，只有普通启动和 fork 开新 Run。进程只是**接入**或**离开**一个 Run，Run 本身没有「结束」。这推翻了 Issue 17「新进程开新 Run」的定义，经使用者同意；spec 与 CONTEXT.md 已同步修订，Issue 05/18/24/29/30 的票面也已修订，Issue 17 只追加了说明。

- **Run 仍只在 bridge 一处决定**。bridge 在 plugin data 下维护不含 prompt 的会话索引，resume 时查它，查不到就新开 Run（已接受的副作用：从未归档过的会话也会续接）。locator 改为按进程命名（`<session>.<pid>-<启动秒>-<启动微秒>.json`），helper 只认按自己宿主进程命名的那一份。这修掉了一个既有缺陷：两个终端 resume 同一会话时，后一个会覆盖前一个的 locator。原 Run 被存活进程占着时，后来的进程新开 Run；决定 Run 和发布 locator 在同一把 `flock` 下完成。
- **边界**是 `run-started`（Run 第一次出现）、`run-attached` 和 `run-detached`，不再写 `run-ended`；旧的 `run-ended`（档案行或队列里的欠账）一律当作离开读取。每个进程在 Run 里的一段是一个 attachment，它的 id 由进程世代和上一段派生，所以 reload 算同一段，同一进程离开后再回来算新的一段。
- **Run 边界仍然惰性**（沿用 Issue 17）：什么都不归档的进程不留痕迹，Run 停用采集时也一样。进程内 `/resume` 先把离开暂存起来，等下一个会话证明进程确实离开了这个 Run 才写。
- 面板显示「Run 续接 / Run 离开 / Run 未记录离开」。「从 Run X 分出」由 `timeline-read` 新返回的 `segmentId` 推导，schema 仍是 2。
- **给后续实现者**：
  - Run collection mode、UI 展开状态、`clear-run` 都跟着谱系走。
  - 恢复队列的总上限是 64 条（`LIFECYCLE_QUEUE_CAPACITY`），其中 clear 另有 16 条的上限。
  - `clear-all`（Issue 30）必须删除会话索引里指向本项目 Run 的记录。（2026-09-28 Issue 30 修订：当前 Run 与仍在运行的 Run 除外，见 Issue 30 的 Q6。）
  - 进程内 `/resume` 的 SessionEnd 接线只能用 PTY 验证。

一轮 `/code-review` 找到 22 条：修了 13 条，4 条进 backlog（其中每次提交都要扫描全部 Run 生命周期记录那条归入 `20260923-lifecycle-store-scan-per-submission.md`），3 条按「边界惰性」驳回，理由见 Comments。门禁：`2.1.273`/`2.1.278` 各 **143** 项 plugin tests、8 静态、**22** bridge、**44** helper，TypeScript 与确定性重建全部通过；真人 PTY 在两个版本上都通过，review 修复后也复验了。已提交到 `prompt-trail/issue-32-run-lineage-across-resume`（`6e6cf1a`），未合并进 `main`。
