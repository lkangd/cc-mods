# 37: 以真实 PTY 证明分支与跳转场景

**What to build:** 为 `PT-BRANCH-001..004` 与 `PT-JUMP-001..002` 编写自动化 PTY 场景（resume、`--continue`、会话内 `/resume`、双终端并发 resume、两种 fork、rewind 与 Esc Esc、父节点歧义、有效与失效 Jump Target），在两个版本上产出证据。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** resolved

- [x] 每个场景 ID 有 PTY 脚本，鼠标激活用 SGR 序列、键盘激活用按键。
- [x] 歧义场景验证 drop、候选 Pane、草稿恢复且不自动重提。
- [x] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。

## Answer

`PT-BRANCH-001..004` 与 `PT-JUMP-001..002` 现在由真实 PTY 场景证明（`mods/prompt-trail/release/pty_scenarios.py`），在 `2.1.273` 与 `2.1.283` 上都通过。对齐见下方 Comments 的 Q1–Q14。

- **场景**：
  - BRANCH-001：`--continue` 与并发 `--resume` 重绑共享历史、不重复归档；`--continue`、`--resume`、会话内 `/resume` 都保持 Run，并接在 session 的最后一条之后；`/clear` 之后的条目在分叉点折叠为「另一分支 · 1 条」，点击后展开；原 Run 被占用时再 resume，会开新 Run，band 显示「从 Run X 分出」；条目总数恰好 7。
  - BRANCH-002：后台 `/fork` 的参数恰好归档一次，属于新 Run 和新 branch，父节点是共享历史的最后一条；`--fork-session` 重绑共享历史、把另一次 fork 的条目标 `×`，自己开新 Run 并显示来源。
  - BRANCH-003：`/rewind` 回到 B 之前，下一条接在 A 后、开新 branch，B、C 在分叉点折叠为「另一分支 · 2 条」；Esc Esc 回到开头，下一条开新根分支，band 显示「—— 新根分支 ——」，旧条目全部保留在它上面。
  - BRANCH-004：compact 后跨进程 resume，第一次提交被 drop，输入框为空，「确认父节点」Pane 聚焦在第一个候选上；Esc 放回草稿，再次提交仍会询问；点击 B 后 Pane 关闭、草稿放回且 5 秒内不自动发送；再提交，条目接在 B 后，Run 不变。
  - JUMP-001：Enter 与点击各把一个屏幕外的条目带进视野，band 收起，之后输入的字进入输入框。
  - JUMP-002：普通重启后，旧条目显示 `×`，旁边是同文、能跳转的新条目；对旧条目按 Enter 或点击，band、transcript 与档案都不变，Enter 后焦点仍在旧条目上。
- **驱动与扫描**：
  - `Terminal.click()` 先发移动事件再按下：宿主只对 hover 过的位置响应点击；
  - 新增 `Terminal.reversed_spans()`：Pane 画在 transcript 右侧，按整行判断反色读不到它的焦点；
  - 新增 `Terminal.column()`：左侧 transcript 有宽字符时，按单元格计算点击位置；
  - `Environment.finish()` 结束本世界派生的后台 daemon 及其子进程，扫描并删除它在 `/tmp/cc-daemon-<uid>/` 下的目录，漏掉的记为泄漏；
  - `ALLOWED_RULES` 增加宿主的后台会话记录（`sessions/`、`daemon/`、`jobs/`），`release_verdict` 新增一项测试（共 28 项）。
  - `Context` 新增 `focus()`、`click_row()`，`relaunch()` 可以传终端尺寸。
- **契约修订**：scenarios.json 的 BRANCH-004 步骤改为实际做法（Q4）；spec Testing Decisions §10 补上后台会话记录与 daemon 清理（Q9）；README 的不承诺清单补上 Issue 22 的已知缺口（Q8）。
- **验证**：
  - scratchpad 脚本逐个场景调试，两个版本 6/6 通过；
  - 正式入口 `release-evidence.sh --skip-gates --only <6 个 ID>`（`build/evidence/20260929T094956Z/`）：12/12 PTY 通过，0 泄漏；报告因 partial 和跳过门禁按设计判 FAIL；
  - 变异检查（2.1.283）：6 个场景各反转一条关键断言，全部失败；关掉 daemon 清理后，BRANCH-002 结束时确实留下 daemon 进程；
  - `verify-startup.sh` 通过。
- **拆出新票**：[Issue 42](42-clear-before-first-write.md)（新进程在第一次提交前 `/clear`，Clear Boundary 变成 Integrity gap）；[Issue 43](43-jump-after-in-process-resume.md)（会话内 `/resume` 之后提交的条目没有 Jump Target）。
- **每个场景的耗时**：28–64 秒。

## Comments

### 实现层面对齐（2026-09-29）

第一轮 Q1–Q6，使用者回复「均采用」。

- **Q1 场景结构**：一个 ID 对应一个函数、一个全新的 Environment。BRANCH-001 在同一个环境里串起 `--continue`、`--resume`、会话内 `/resume`、双终端并发，断言时按阶段读档案增量；BRANCH-002 的两种 fork 也串在同一个环境里。
- **Q2 断言来源**：沿用 36。Run 同时比 status 的 `run:` 行与条目的 `runId`；父节点与分支比档案的 `parentEventId`/`branchId`；「只重绑、不重复归档」由条目数不变加上 band 里对应行不带 `×` 证明；「另一分支 · N 条」「从 Run X 分出」「新根分支」从 band 读。transcript 只用来找 session id，属于准备步骤。
- **Q3 BRANCH-003**：`/rewind` 回到中间：A、B、C 之后回到 B 之前，再提交 D。断言 D 的父节点是 A、D 开了新 branch、B 与 C 仍在档案里，band 在分叉点显示「另一分支 · 2 条」。Esc Esc 回到根：再提交 E，断言 E 没有父节点、开了新 branch，band 显示「—— 新根分支 ——」，旧条目保留在上方。Esc Esc 这条路径不经过 `/rewind`，同时证明「不依赖 `command.run(rewind)`」。
- **Q4 BRANCH-004**：A、B → `/compact` → `/exit` → `--resume` → 提交 C：断言 drop、没有条目也没有 pending、输入框为空、Pane 已聚焦（反色行）→ Esc 取消：断言草稿回到输入框、仍无条目 → Enter 重新提交，Pane 再次弹出 → 用 SGR 点击选中 B：断言 Pane 关闭、草稿回到输入框，5 秒内没有新条目、也没有进入运行状态 → Enter：断言 C 的父节点是 B、Run 不变。scenarios.json 的步骤文字改为「跨进程 resume 一个 compact 过的会话，使 transcript 无法唯一确定父节点」，expected 不改。
- **Q5 JUMP 激活方式**：JUMP-001 与 JUMP-002 都用鼠标点击和 Enter 各激活一次。
- **Q6 验证**：沿用 36：用 scratchpad 脚本调试；收尾时跑 `release-evidence.sh --skip-gates --only <6 个 ID>` 和 `verify-startup.sh`；在 2.1.283 上给每个场景反转一条关键断言做变异检查；不做完整运行（归 41）。

第二轮 Q7–Q14，使用者回复「均采用」。先写下探测（2.1.273 与 2.1.283，scratchpad 一次性脚本）得到的事实：

- 会话内 `/resume <session id>` 能直接带参数使用。`--continue` 续接最近的 session 和它的 Run，写入 `run-attached`，旧条目能跳转。
- `/rewind` 与 Esc Esc 打开的是同一个菜单：先选消息（初始停在 `(current)`，↑ 往前移），再选「1. Restore conversation」。选中消息之后的内容被撤回，这条消息的原文放回输入框。
- 后台 `/fork <参数>` 在隔离环境里可用。子进程带着插件，参数被记为新 Run 的条目，父节点是来源 session 的最后一条；来源的 band 里显示「▸ 另一 Run · 1 条」。`--resume S --fork-session` 同样开新 Run，band 显示「Run 开始（从 Run X 分出）」。
- 点击条目要先有 hover（鼠标移动事件）；不发移动事件直接按下，条目行没有反应，标题行却能响应。
- 键盘跳转（`ctrl+x tab` → ↑ → Enter）会把 transcript 滚到目标条目，band 收起，之后输入的字进入输入框。
- band 的展开状态随 Run 延续；展开时 40 行的终端放不下 status 的输出。

决定：

- **Q7 新进程第一件事就是 `/clear`**：任何新进程（包括普通重启）在第一次提交之前执行 `/clear`，档案里记下的是 integrity gap/recovery，Clear Boundary 丢失，两个版本都能复现；先提交一次或先跑一次 status 就正常。拆为 [Issue 42](42-clear-before-first-write.md)，37 不被它阻塞。BRANCH-001 在 `--resume` 之后先提交一条，再 `/clear`。
- **Q8 会话内 `/resume` 之后的新条目显示 `×`**：拆为 [Issue 43](43-jump-after-in-process-resume.md)，先诊断。BRANCH-001 不在会话内 `/resume` 之后断言跳转。Issue 22 的已知缺口（同一进程 `/resume` 回到它打开过的 session，旧行显示 `×`）补进 README 的不承诺清单。（2026-09-29 Issue 43 已修复这两处：BRANCH-001 在会话内 `/resume` 之后断言 A–D 与 F 能跳转，README 的这一条已删除。）
- **Q9 后台 `/fork` 的宿主文件与残留进程**：宿主把 fork 参数原文写进 `sessions/<pid>.json`、`daemon/roster.json`、`jobs/<id>/state.json` 和 `jobs/<id>/tmp/parent-transcript.jsonl`。`ALLOWED_RULES` 增加「config 目录下的 Claude Code 后台会话记录：`sessions/`、`daemon/`、`jobs/`」。`Environment.finish()` 先扫描、再结束本世界派生出的 daemon 及其子进程（识别依据是 `--spawned-by` 的 cwd 落在本世界内），然后扫描并删除它在 `/tmp/cc-daemon-<uid>/` 下持有的目录；扫描漏掉的进程或目录记为泄漏。spec Testing Decisions 与 README 的允许文件说明同步修改。
- **Q10 鼠标点击**：`Terminal.click()` 先发移动事件（`\x1b[<35;x;yM`），停 0.3 秒，再按下、松开，对所有调用方生效。
- **Q11 BRANCH-001**：T1 提交 A（同意采集）、B，然后 `/exit` → T2 `--continue`：提交前 band 里 A、B 能跳转、条目数仍为 2；提交 C，父节点是 B，Run 不变，新增一条 `run-attached`；然后 `/exit` → T3 `--resume S`：提交 D（父节点是 C）→ `/clear` → 提交 E → `/resume S` → 提交 F：F 的父节点是 D，Run 不变；band 在分叉点显示「▸ 另一分支 · 1 条」，点击展开后看到 E → T4：在 T3 仍存活时 `--resume S`：status 的 Run 与原 Run 不同；提交前 A、B、C、D、F 能跳转；提交 G，父节点是 F，band 在 G 之前显示「Run 开始（从 Run <原 Run 前 8 位> 分出）」；条目总数恰好是 7。
- **Q12 BRANCH-002**：T1 提交 A、B，然后 `/fork <G>`，最多等 60 秒：G 属于新 Run，父节点是 B，branch 与 B 不同，条目总数为 3 → T2 `--resume S --fork-session`：提交前 A、B 能跳转、G 显示 `×`；提交 H：Run 与 T1 和 G 都不同，父节点是 B，开了新 branch，band 在 H 之前显示「Run 开始（从 Run <T1 Run 前 8 位> 分出）」。
- **Q13 JUMP-001**：24 行终端，提交 A–E。键盘：`ctrl+x tab` → ↑ 四次 → Enter：跳转前屏幕上看不到 A 的 prompt 行，跳转后能看到；band 收起为 `▸`；随后输入的字进入输入框。鼠标：重新展开，hover 后点击 B，断言同上。
- **Q14 JUMP-002**：T1 提交 A，然后 `/exit` → 普通重启，提交与 A 原文完全相同的 A2 → 展开 band：旧 A 显示 `×`，A2 能跳转 → 键盘：焦点移到旧 A → Enter：band 仍为 `▾`，焦点仍在旧 A 上，条目数不变，transcript 区域不变 → 鼠标：hover 后点击旧 A，断言同上。同文的 A2 用来证明「不猜测目标」。

### Code review 修复（2026-09-29，round 1）

产物：`.code-review/runs/20260929-201338/round-1/`。6 条 finding，全部修复：

- **已修** #0（major）：BRANCH-001 的 `--resume` 阶段只断言了父节点。现在也断言 D 的 Run 与 status 的 `run:` 都是原 Run，并且档案里恰好有第二条该 Run 的 `run-attached`（`--continue` 一条，`--resume` 一条）。变异（改成只期望一条）会让场景失败。
- **已修** #1：lsof 给不出 daemon 的目录时，原来会直接跳过，不扫描也不删除。现在对 argv 含 `daemon run` 却认不出目录的进程记一条「not inventoried」泄漏。
- **已修** #2：SIGKILL 可能落到被复用的 PID 上。现在按「PID + 启动时间」认定进程，每轮发信号和判断存活都只针对仍是原进程的那些。
- **已修** #3–#5：抽出 `check_bound()`（共享历史恰好出现一次且能跳转）、`check_fold()`（折叠行的位置与被折叠的条目）、`check_branched_off()`（新 Run 的「从 Run X 分出」）。
  > 2026-10-07 backlog 清理后 `check_bound()` 已并入 `wait_bound()`：等共享历史稳定后再断言。
- **顺带修复**：复验时 BRANCH-001 在 2.1.273 上失败过一次：`identity()` 在 status 刚出现标题、还没画完时就去读，结果读不到 `run:`。现在要等到最后一行 `run:` 画出来才读。`identity()` 也被 36 的场景使用，LIFE-003、LIFE-004、STORE-001 已在 2.1.283 上重跑通过。

复验：BRANCH-001、BRANCH-002、BRANCH-003 在 `2.1.283` 与 `2.1.273` 上都通过（BRANCH-001 在 2.1.273 上又连跑两次），0 泄漏，没有残留的 daemon。
