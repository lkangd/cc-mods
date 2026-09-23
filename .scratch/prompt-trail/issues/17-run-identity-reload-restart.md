# 17: 跨 reload 与重启维护 Run 身份

**What to build:** 让使用者在 plugin reload 后继续同一个 Run，在退出、重启或新进程中获得新 Run，并持续看到旧 Project Timeline，而不会因继承环境变量错误复用身份。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** resolved

- [x] Run 身份由随机 Run UUID 与实际宿主进程世代共同确定，不以 module instance、classic session ID 或单独环境变量充当 Run。
- [x] 同进程 `/reload-plugins` 产生新 module instance 但复用 Run；重放 render 不重复 Timeline Events。
- [ ] reload 后 Run collection mode、展开状态、选择位置和已持久事件保持。（部分满足：选择位置尚不存在，归 Issue 21；其余三项已满足。）
- [ ] 正常退出写入 Run 结束；重新启动创建新 Run，并继续读取同一 Project Timeline 和 Archive generation。（部分满足：Archive generation 仍是每个新 Run 随机生成的占位，归 Issue 30；其余已满足。）
- [x] 异常退出留下未闭合 Run；后续浏览显示中断而不伪造结束事件。
- [x] 继承 Run 环境标记但实际宿主进程世代不同的子进程创建新 Run。
- [x] 一个 Run 固定使用启动时的 helper 路径、摘要和 protocol；运行中制品变化使当前 Run 停止采集，恢复原制品或新 Run 才能继续。
- [x] 正常 SessionEnd 清理当前 session locator；重启不会复用旧 locator。
- [x] 旧 Prompt Entries 在普通新 Run 中继续可见，但不得凭持久数据伪造 Jump Target。（后半句目前是空满足：Jump Target 尚不存在，读回的行不带任何跳转绑定；Issue 22 实现时须守住。）
- [ ] plugin test、helper semantic test 与真实 PTY 覆盖 reload、正常退出、异常退出、重启、继承环境和 helper 变化。（部分满足：继承环境只有 bridge 协议测试以真实中间 shell 覆盖，PTY 没有专门测；其余均有 PTY。）

## Comments

### 2026-09-23 · 实现与真人 PTY 验收（review 前，未提交）

**开工前与使用者确认的三处取舍**：
1. reload/重启后显示旧条目只能让原文经 helper stdout 回到 hook 内存。使用者确认放行**唯一一个**专用读子命令 `timeline-read`；spec §16、US72 与 Issue 05 的 PT-SEC-001 措辞已同步修订。其余子命令的 stdout、所有 stderr/错误仍不含原文。
2. 与 Issue 21 分工：17 只做最小有界读（固定最新 128 条、sequence 升序、`truncated` 标记）；游标、向前加载、渲染窗口、overscan、跟随底部全部归 21，在同一协议上扩展。
3. 异常退出的 Run 在 UI 上标“Run 未记录结束”而不是“中断”：档案分不清崩溃的 Run 和仍在运行的并发 Run，这个措辞对两者都成立。它只画在 UI 上，不写进档案。

**做了什么**：
- helper：`boundary_kind_valid()` 新增 `run-started`/`run-ended`（表与 schema 不变）；新增 `timeline-read`（`PT_ROOT_OPTIONAL`，档案不存在时回空列表且不建档，根目录不可信时失败关闭）。
- bridge：`source=resume` 若能找到同一宿主进程世代的前驱 locator，就继承 Run 与 archiveGeneration（进程内 `/resume`），找不到就开新 Run。`reason=resume` 的 SessionEnd 不删 locator，交给新 session 的 publish 继承后再删。`startup`/`fork` 一律开新 Run，`clear` 仍必须有前驱。两个函数改名为 `load_predecessor_identity()`/`remove_predecessors()`。**这修正了一个此前没人发现的问题：进程内 `/resume` 原本会在同一进程里换一个新 Run。**
- `hooks/lifecycle.ts`：`LifecycleWrite.kind` 扩为三种；状态新增 `started`/`ended`；新增 `beginRun()`（run-started 插到队首）与 `endRun()`（按 reason 区分：`clear` 切段，`resume` 什么都不做，其余结束 Run；未 started 的 Run 不写 end）。
- `register.tsx`：
  - `ensureRunStarted()` 让 run-started 先入队。drain、disable、`/clear` 三条写路径都会先调用它。run-started 的 occurredAt 取 locator 里的宿主进程启动时刻；两种 Run 边界的 event id 都由 `sha256(kind:project:run)` 派生。
  - `flushOwnLifecycle()` 按顺序写完本 Run 的整条队列。`drainLifecycle()` 改为先补写其他 Run 的欠账。
  - `classic.SessionEnd` 把**所有** reason 都交给状态机。
  - `session.start` 读回 `prompt-trail:ui:<runId>` 的展开状态，并在已授权时调用 `timeline-read` 合并进面板。
  - 面板新增 Run 开始/结束行和“Run 未记录结束”标记；status 新增 `run:` 一行，欠账按种类分别统计。
- 测试：新增 `tests/run_identity.test.tsx`（状态机回放 + hook 场景）。测试替身新增持久档案、`timeline-read`、逐字段严格的 boundary 幂等、可切换的 Run 与 helper 摘要。Issue 14/16 的旧测试改用 `boundaryCalls()`，Issue 16 的 fixture 补上 `started: true`。helper 协议测试 +5，bridge 协议测试 +3。`artifact_static.py` 新增 SessionEnd hook 不得按 reason 过滤的源码检查。
- 门禁：`2.1.273`/`2.1.278` 各 126 项 plugin tests、8 项静态、16 项 bridge、42 项 helper、TypeScript 与确定性重建全部通过。

**真人 PTY（2.1.278，真实档案）**：
- A 启动：写入 run-started，status 显示 run。
- B reload：展开状态保持，旧条目只出现一次，Run 不变。
- C 进程内 `/resume`：Run 不变。
- E 运行中追加改动 helper：提交被阻止，显示 `digest-mismatch`；恢复原件后继续采集。
- F `kill -9`：显示“Run 未记录结束”，档案里没有 run-ended。
- D 首次失败：hook 仍保留 Issue 16 的 `e.reason === 'clear'` 过滤，退出事件没进状态机。`$.store` 里 X 为 `started: true`、没有 `ended`、队列为空，可以印证。修复后复验通过：`/exit` 时写入 run-ended，locator 被清理；重启后的顺序是“未记录结束 → Run 开始 → ping → Run 结束 → … → Run 开始 → ping”。宿主**会**在退出前等完 `classic.SessionEnd` 的异步 function hook，这不是宿主限制。
- 验收结束时档案 51 条事件、sequence 1..51 连续、0 pending。

**尚未满足或只部分满足、需要如实写进 Answer 的**：
- “Archive generation 延续”：重启后读的确实是同一个档案文件，但 locator 的 `archiveGeneration` 仍是每个新 Run 随机生成，档案侧没有 generation，归 Issue 30。
- “选择位置保持”：界面还没有选择这个概念。展开状态已持久化，Issue 21 引入选择后应放进 `prompt-trail:ui:<runId>` 这同一条记录。
- “不得伪造 Jump Target”：目前根本不存在 Jump Target，读回的行不带任何跳转绑定，Issue 22 负责实现。
- 继承环境的子进程：由 bridge 协议测试用真实的中间 shell 进程覆盖；PTY 没有专门测。
- 最低兼容版本 `2.1.273` 上**没有**跑真实 PTY，只跑了确定性测试（review finding #12）。spec §Testing Decisions 2 要求两个版本都跑；这一条要么补跑，要么在 Answer 里如实标注。

### 2026-09-23 · code review（`/code-review` round 1）与修复（未提交）

产物：`.code-review/runs/20260923-102955/round-1/`。16 条 finding，逐条处理：

**已修复**（门禁：`2.1.273`/`2.1.278` 各 129 项 plugin tests、8 静态、16 bridge、42 helper、TypeScript 全绿；新增 3 项测试）：
- #0 切换项目时旧项目的时间线行会留在面板里：`prepareProject()` 在项目 ID 变化时清空 `timeline`。
- #4/#8 恢复队列满时 Run 边界被拒却仍记为 started/ended：`queueLifecycleWrite()` 只对 `clear` 施加 16 条上限，Run 的开始/结束每 Run 至多一条，不受限（测试：`a full recovery queue still takes the Run's one start and one end`）。满队列时被拒的 `/clear` 恢复旧行为：本 Run 欠账冲刷完后仍直接尝试写一次。
- #7 退出时读不到 Run collection mode 会跳过 run-ended：`applyLifecycle()` 只在非退出事件上读取 mode。
- #9 `/clear` 与 disable 作为新 Run 首写时没有先补写其他 Run 的欠账：抽出 `flushForeignLifecycles()`，`drainLifecycle()`、`applyLifecycle()` 和 disable 都先调用它；disable 仍不被其他 Run 的欠账挡住（测试：`a stop that is a new Run's first write lands after the end another Run still owes`）。
- #10 status 把损坏丢弃的 Run 边界也叫 Clear Boundary：`damaged` 改为“Clear Boundary 或 Run 边界已丢失”；`overflowed` 现在只可能是 Clear Boundary，原文案保持。
- #11 重新授权后不读已有时间线：`requestConsent()` 新授予 `enabled` 后尽力调用 `loadTimeline()`（测试：`granting consent reads back what the archive already holds`）。
- #2 Issue 31 的发布清单与修订后的 PT-SEC-001 不一致：补上 `timeline-read` 响应。
- #3 `LifecycleContext` 注释：分别写明 `/clear` 得 `clear-deferred`、退出得 `run-end-unrecorded`。

**延后**：
- #5 `truncated` 标记没进 UI → 并入 `docs/code-review-backlog/20260922-bounded-persisted-timeline-view.md`（Issue 21）。
- #15 `BoundaryKind` 与 `TIMELINE_KINDS` 各写一份 → `docs/code-review-backlog/20260922-cleanup-minor-batch.md` 第 5 条。
- #12 `2.1.273` 真实 PTY → 见上方清单，需要使用者决定补跑还是标注。

**驳回**：
- #1/#14 Issue 16 的状态形状与函数名过时：那是已解决票据的带日期实现记录，不是现行契约；改名与新字段记在本票据。
- #6 升级时 run-started 排在该 Run 旧条目之后：只在把 Issue 17 之前的开发版热替换进一个已采集过的 Run 时出现一次；插件尚未发布（Issue 31），没有需要兼容的旧档案，为此从档案反推 started 不值得。
- #13 drain 时两次读 lifecycle 记录：一次 `$.store.get`，放在已有多次子进程调用的提交路径上，可忽略；把 `ensureRunStarted()` 的状态穿进 drain 反而增加耦合。

**需要 PTY 复验**（classic 事件在 2.1.273 的 plugin test 里发不出来，`applyLifecycle()` 的改动只有代码审读）：
#7 与 #9 的触发条件（store 读失败、退出时档案不可用）在 PTY 里难以人为制造，复验只防回归：
- 采集中 `/clear` 仍写 Clear Boundary；`/exit` 仍写 run-ended。
- 停用采集后 `/exit` 仍写 run-ended。

### 2026-09-23 · 复验（review 修复后）

使用者确认验证全部通过：
- 上一节「需要 PTY 复验」的回归场景：采集中 `/clear` 写 Clear Boundary、`/exit` 写 run-ended、停用采集后 `/exit` 仍写 run-ended。
- 最低兼容版本 `2.1.273` 也跑过了真实 PTY，review finding #12 视为已满足。
- 提交前重跑门禁：`verify-startup.sh` 全绿，`2.1.273`/`2.1.278` 各 129 项 plugin tests、8 静态、16 bridge、42 helper、TypeScript 与确定性重建通过。

### 2026-09-23 · Run 定义已由 Issue 32 修订

本票解析后，使用者决定 Run 改为会话谱系：`claude --resume`、`--continue` 与会话内 `/resume` 都续接原 Run，只有普通启动与 fork 开新 Run；run-started/run-ended 改为 run-started/run-attached/run-detached；helper 制品按进程接入而非整个 Run 绑定。本票 Answer 保留为当时的实现记录，现行契约见 [Issue 32](32-run-lineage-across-resume.md)。

## Answer

Run 身份现在跨 reload 保持、跨退出与重启更替。Run = 随机 Run UUID + 实际宿主进程世代，
不以 module instance、classic session id 或单独的环境变量充当。bridge 区分三种来源：
`source=resume` 只有找到**同一宿主进程世代**的前驱 locator 才继承 Run 与 archiveGeneration
（进程内 `/resume`），否则开新 Run；`startup`/`fork` 一律开新 Run；`clear` 仍必须有前驱。
这顺带修正了一个此前没人发现的问题：进程内 `/resume` 原本会在同一进程里换一个新 Run。
**但 `/resume` 之后的新 session 仍拿到新的根分支，分支重建归 Issue 18。**

**Run 边界是惰性的**：run-started 由首个写路径（drain、disable、`/clear`）插到恢复队列队首，
时刻取 locator 里的宿主进程启动时刻；除 `clear`、`resume` 外的所有 SessionEnd reason 都欠一个
run-ended，未 started 的 Run 不写 end。两种边界的 event id 由 `sha256(kind:project:run)` 派生；
恢复队列的 16 条上限**只约束 `clear`**。`classic.SessionEnd` 把所有 reason 交给状态机，
静态检查禁止再按 reason 过滤。异常退出的 Run 在 UI 上标“Run 未记录结束”，只画不写。

**`timeline-read` 是唯一可在 stdout 返回原文的子命令**（经使用者确认，spec §16、US72、
Issue 05 PT-SEC-001、Issue 31 已同步）：固定只回最新 128 条、sequence 升序、带 `truncated`，
档案不存在时回空且不建档，根目录不可信时失败关闭。游标、窗口与 `truncated` 的 UI 归 Issue 21。
展开状态按 Run 存于 `prompt-trail:ui:<runId>`。

**如实标注的缺口**：`archiveGeneration` 仍是每个新 Run 随机生成的占位，档案侧没有 generation
（Issue 30）；选择位置尚不存在（Issue 21，届时放进同一条 `prompt-trail:ui:<runId>`）；
Jump Target 尚不存在，“不伪造”目前是空满足（Issue 22）；继承环境的子进程只有 bridge 协议测试
覆盖，没有专门的 PTY。另外，只经 classic 事件到达的逻辑在 `2.1.273` 的 plugin test 里触发不到，
必须靠静态检查或 PTY 验收。

一轮 `/code-review` 找到 16 条 finding：9 条已修、3 条延后（2 条进 backlog，`2.1.273` PTY
已补跑）、4 条驳回，理由见 Comments。门禁：`2.1.273` 与 `2.1.278` 各 **129** 项 plugin tests、
8 项静态制品、16 项 bridge protocol、**42** 项 helper protocol，TypeScript 与确定性重建全部通过；
真人 PTY 在 `2.1.278` 与 `2.1.273` 上均通过。已提交 `prompt-trail/issue-17-run-identity-reload-restart`
（`21cb2a2`），未合并进 `main`。
