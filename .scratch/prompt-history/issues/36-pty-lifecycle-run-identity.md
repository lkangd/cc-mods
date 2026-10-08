# 36: 以真实 PTY 证明生命周期与 Run 身份场景

**What to build:** 在 Issue 31 的 PTY 驱动器与场景清单上，为 `PH-LIFE-001..004` 与 `PH-STORE-001` 编写自动化 PTY 场景，使它们在 `2.1.273` 与当前发布验收版本上都产出可复核证据。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** resolved

- [x] `/clear`、compaction、plugin reload、正常退出与普通重启、重启延续各有 PTY 场景，断言只依据屏幕快照与 semantic verifier。
- [x] 每个场景在隔离环境中运行，使用合成标记，trace 写盘前脱敏。
- [x] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。

## Answer

`PH-LIFE-001..004` 与 `PH-STORE-001` 现在由真实 PTY 场景证明（`mods/prompt-history/release/pty_scenarios.py`），在 `2.1.273` 与 `2.1.283` 上都通过。实现提交：`0b7d780`。对齐见下方 Comments 的 Q1–Q11。

- **场景**：每个 ID 一个函数、一个全新的隔离环境。`Context` 新增：`identity()`（从 status 读 `run:` 和 `Archive generation:`）、`relaunch()`（在同一项目启动新进程并等到可输入）、`exit()`（`/exit` 后等进程结束）、`session()`（按标记找到 resume 要用的 classic session，属于准备步骤，不是断言）、`transcripts()`（与 `transcript_rows()` 共用）。`Terminal` 新增 `reversed_rows()`：在同一帧里读出反色绘制的行，也就是焦点环所在的行。
  - LIFE-001：`/clear` 之后恰好一个 clear 边界，位于两个条目之间；Run 不变，两个条目分属两个 segment，后一个开新根分支；band 里显示 Clear Boundary。
  - LIFE-002：`/compact` 之后的条目沿用同一 Run、segment 与 branch，父条目就是前一个；档案里只有 `run-started` 一个边界；两个条目都能跳转。
  - LIFE-003：先选中较早的条目，按 Esc 后执行 `/reload-plugins`。band 恢复为展开，每个条目只出现一次且能跳转，条目数与 Run 都不变；再次进入 band 时焦点落在最新条目。
  - LIFE-004：`/exit` 写入一次该 Run 的 `run-detached`；普通重启后得到新 Run，generation 不变；band 按顺序显示旧 Run 的「Run 开始 → × 条目 → Run 离开」。
  - STORE-001：重启后不再询问同意，status 显示 granted，新 Run 下能继续采集，generation 不变；`--resume <第一个 session>` 续接第一个 Run，恰好写入一次 `run-attached`；全部事件的 sequence 从 1 到 8 连续。
- **契约修订**（Q11）：reload 后不再承诺恢复选中位置。Issue 05 的 PH-LIFE-003、`release/scenarios.json` 的 expected 与 README 的不承诺清单已同步修改。
- **验证**：
  - scratchpad 脚本逐个场景调试，两个版本 5/5 通过；
  - 正式入口 `release-evidence.sh --skip-gates --only <5 个 ID>`（`build/evidence/20260929T080807Z/`）：10/10 PTY 通过，0 泄漏；报告因 partial 和跳过门禁按设计判 FAIL；
  - 变异检查（2.1.283）：5 个场景各反转一条关键断言，全部失败；
  - `verify-startup.sh` 通过。
- **与对齐稿不同**：Q9 预期重启后能看到新 Run 的「Run 开始」，实际上 `run-started` 要等新 Run 第一次写入才补写（Issue 17 的惰性边界），只启动不提交时 band 里只有旧 Run 的三行。场景改为断言这三行的顺序，新 Run 由 status 证明。
- **每个场景的耗时**：12–38 秒。

## Comments

### 实现层面对齐（2026-09-29）

使用者对 Q1–Q11 回复「均采用」。

- **Q1 选中位置（PH-LIFE-003）**：先用 PTY 探测宿主在 reload 后是否保留焦点环，再定。探测结果见 Q11。
- **Q2 场景切分**：一个 ID 对应一个场景函数，每个场景用全新的 Environment；「退出再启动」抽成 `Context` 上的方法共用。
- **Q3 STORE-001 的 resume**：退出后做一次 `--resume <原 session>`，只断言 Run id 与原 Run 相同、出现「Run 续接」边界、sequence 延续。分支语义归 37。
- **Q4 断言来源**：Run 同时比 status 的 `run:` 行与档案条目的 `runId`；generation 只比 status 的 `Archive generation:` 行（档案里没有 generation 列）；consent 延续的依据是重启后提交不再弹同意问题，且 status 显示 granted。
- **Q5 正常退出**：只用 `/exit`。其他 SessionEnd reason 由 plugin test 与静态检查承担。
- **Q6 LIFE-001**：PTY 断言恰好一个 clear 边界、Run 不变、前后条目分属不同 segment、后一个开新根分支，band 显示「/clear：新的 Conversation Segment」。重复事件与两事件间崩溃由清单中已有的 plugin/unit 证据承担。
- **Q7 LIFE-002**：compact 后的条目与前一个条目 `branchId`、`segmentId` 相同，`parentEventId` 指向前一个条目；没有 clear 边界，也没有新 Run；band 里两条都不带 `×`。
- **Q8 LIFE-003**：reload 前后条目数不变，band 里该条目只出现一次且不带 `×`，展开状态保持，status 的 `run:` 不变。
- **Q9 LIFE-004**：重启后展开 band，旧条目带 `×`，能看到「Run 离开」与新的「Run 开始」；status 的 `run:` 与旧 Run 不同，`Archive generation` 相同。
- **Q10 验证**：用 scratchpad 脚本调试单个场景；收尾时在两个版本上跑 `release-evidence.sh --skip-gates --only <5 个 ID>`，再跑 `verify-startup.sh`。不做完整运行（归 41）。变异检查只在 2.1.283 上做，每个场景反转一条关键断言。
- **Q11 选中位置的定义**：探测（2.1.283）表明，不经过 reload 焦点环也留不住：进入 band 后焦点落在最新条目，↑ 移到上一条，Esc 离开后再按 `ctrl+x tab`，又回到最新条目；reload 之后也一样。插件把 `autoFocus` 固定给最新条目，而 `/reload-plugins` 必须在输入框里执行，执行前焦点已经离开 band。据此修订契约：焦点离开 band 后不保留选中位置，reload 后与 Esc 后一样从最新条目开始；reload 要保证的是展开状态、条目与 Jump Target。PH-LIFE-003 的 expected、Issue 05 的契约条目与 README 的不承诺清单同步修订，PTY 断言 reload 后 `ctrl+x tab` 落在最新条目。

### Code review 修复（2026-09-29，round 1）

产物：`.code-review/runs/20260929-164918/round-1/`。8 条 finding，7 条修复、1 条驳回：

- **已修** #1：Issue 17 的「选择位置保持」检查项补上 Issue 36 修订注记。
- **已修** #2：`spec.md` 用户故事 46 删去「选择位置延续」，改写为焦点离开后不保留选择位置，并标注修订。
- **驳回** #3（STORE-001 依据 transcript 断言）：`session()` 只是为 `--resume` 找 session id 的准备步骤，Run 的续接由 status 与档案证明。它的 docstring 和失败信息已写明这是准备步骤；找不到唯一 session 时场景照样失败，因为 resume 根本没法开始。
- **已修** #4、#6：焦点行原本分两次加锁读取，可能跨帧。现改为 `Terminal.reversed_rows()` 在一次加锁中读取，场景层不再直接碰 pyte 的缓冲区。
- **已修** #5：STORE-001 断言事件恰好是 sequence 1..8（两个 Run 各有开始、条目、离开，再加续接和第三个条目），不再接受任意长度的连续序列。
- **已修** #7：`session()` 与 `transcript_rows()` 共用 `transcripts()`。
- **已修** #8：新增 `Context.relaunch()`，LIFE-004、STORE-001 的重启与 resume 都改用它（对齐 Q2 本就要求共用）。

复验：LIFE-003、LIFE-004、STORE-001 在 `2.1.283` 与 `2.1.273` 上都通过，0 泄漏；LIFE-003、STORE-001 的变异仍然会失败。
