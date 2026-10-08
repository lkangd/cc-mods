# 39: 以真实 PTY 证明兼容与故障场景

**What to build:** 为 `PH-COMPAT-002/003/005`、`PH-STORE-002/003/006/008/009` 与 `PH-FAIL-001..006` 编写自动化 PTY 场景。故障只从外部注入（权限、`chflags`、写坏数据库、占锁、替换临时副本中的 helper），hook 代码不改。

**Blocked by:** 31「生成零跳过发布证据」、49「helper 不可用时 status 仍执行 helper」、50「另一个仍在运行的 Run 的 pending 被当成本 Run 的对账」、51「另一个 Run 的写入撤掉损坏报告并继续写坏档案」、52「档案拒绝写入时 helper 报成 capture-conflict」

**Status:** resolved

- [x] 不受支持目标、helper 不可用与进程接入版本绑定在真实宿主中验证。
- [x] 双 Run 并发、busy、损坏、generation 竞争与项目隔离有 PTY 集成场景。
- [x] `PH-FAIL-006` 列出的代表性真实宿主故障全部端到端覆盖；只能改代码造出的故障由 plugin test 与 helper 证明并在清单中写明。
- [x] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。

## Answer

- **场景**：`PH-COMPAT-002/003/005`、`PH-STORE-002/003/006/008/009` 与 `PH-FAIL-001..006` 在 `release/pty_scenarios.py` 里各有一个函数。做法、与对齐（Q1–Q17）不同的地方和宿主事实，见 Comments 里的「实现中修订」。故障全从外部注入：
  - 2.1.272 宿主、在 Rosetta 下运行的 x64 宿主、无法写入的 locator 目录；
  - 插件副本里被换掉的 helper、运行中被放宽的 locator；
  - SQLite 写锁、写坏表根页、`chflags uchg`；
  - 下游 fixture 的 HOLD、`SIGKILL` 宿主、第三个 Run 的 `clear-all`、git worktree 与移动项目目录。
- **只能改代码才造得出的故障**，由 plugin test 与 helper 单测证明，已写进 scenarios.json 的步骤文字：
  - 操作系统与 macOS 主版本；
  - SQLite 能力不足与执行被系统拒绝；
  - event ID 幂等；
  - hook 抛出异常与恢复队列溢出。
- **拆出并已修好的四张票**：49、50、51、52，见 Comments。
- **scenarios.json**：
  - FAIL-001..005 加上 `pty` 层；
  - COMPAT-002/003、STORE-002、FAIL-001/004/006 的步骤文字写明 PTY 的做法；
  - COMPAT-003、STORE-006、FAIL-001/002 补上 49–52 的测试引用。
- **验证**：
  - 正式入口 `release-evidence.sh --skip-gates --only <14 个 ID 与 PH-SEC-002/004>`（`build/evidence/20260930T101205Z/`）：32/32 PTY 通过，0 泄漏。报告因为只跑了部分场景、工作树未提交，按设计判 FAIL。
  - `verify-startup.sh` 通过：两个版本各 458 项 plugin test，helper 单测 152 项。
  - 变异检查（2.1.283）：每个场景反转一条关键断言，14 个全部以 `ScenarioFailure` 失败。
  - 换回修复前的插件时，PH-COMPAT-003 失败（Issue 49）。
- **Issue 40 的场景**：`fault_tour()` 扩展后，PH-SEC-002/004 在两个版本上重跑通过。PH-SEC-004 另外断言那个被换上的 helper 从未执行。

## Comments

### 实现层面对齐（2026-09-30）

开工前探测到的事实：
- 2.1.272 宿主能加载插件，status 为 `unsupported target · reason: claude-code-version`。
- npm 的 `@anthropic-ai/claude-code-darwin-x64` 经 `/usr/bin/arch -x86_64` 在 Rosetta 下运行时，status 为 `reason: architecture`（`detected: Darwin x86_64`）。
- 插件用绝对路径调用 `/usr/bin/uname` 与 `/usr/bin/sw_vers`；`SYSTEM_VERSION_COMPAT=1` 在 15.x 上不起作用，所以伪造不了操作系统和 macOS 主版本。
- 给 helper 加 `com.apple.quarantine` 拦不住执行。`sandbox-exec` 拒绝 `process-exec` 时连 `access(X_OK)` 也一起拒绝，bridge 先报 `helper-not-executable`，所以外部造不出 `execution-refused`。helper 动态链接的 `/usr/lib/libsqlite3.dylib` 在 dyld shared cache 里，`sqlite-capability` 同样造不出来。
- fixture 的 HOLD 在预写与确认之间停 5–8 秒。

Q1–Q17，使用者回复「均采用」。

- **Q1 结构**：一个 ID 一个函数、一个全新 Environment，14 个场景都在 `pty_scenarios.py`。驱动新增：`Host` 可以取 x64 版本（缓存在 `~/.cache/prompt-history-release/`，经 `/usr/bin/arch -x86_64` 启动）；`env.launch(host=…)`。没有 Rosetta 时判 FAIL，不跳过。
- **Q2 COMPAT-002**：PTY 做四种，每种单独启动：
  - 2.1.272 宿主（`claude-code-version`）；
  - x64 版本在 Rosetta 下（`architecture`）；
  - 启动前建好 locator 目录并加 `chflags uchg`，没有 locator（`claude-code-version-unproven`）；
  - 两个正式版本的 `supported` 作对照。

  每种都提交一条，断言：不弹 consent、不建档案；`watch_side_effects` 没有编译或网络的迹象；status 的 reason 相符。操作系统与 macOS 主版本由 plugin test 证明。第三种若 bridge 走别的路径，改为发布后把 locator 改成 0644（`locator-permissions`）。
- **Q3 COMPAT-003**：先用正常插件采集 2 条，再在同一世界里依次用插件副本启动：
  - 缺失；
  - 符号链接；
  - 0644；
  - 0775；
  - 内容被改写；
  - bridge 发布后把 locator 的 `helperProtocol` 改成 2。

  每种都断言：status 为 `helper unavailable` 并给出类别、提交被拦下、band 不出条目、档案字节不变、helper 路径仍是副本里那个。`sqlite-capability` 与 `execution-refused` 由 plugin test 和单测证明。
- **Q4 COMPAT-005**：用插件副本。提交，`/reload-plugins`，再提交（同一个 Run）；改写 helper 后提交，被 Archive unavailable 拦下；恢复原 helper 后重试，只提交一次，Run 不变。路径与 protocol 的变化由 plugin test 证明。
- **Q5 STORE-002**：A、B 交替提交 3+3 条：sequence 唯一且严格递增，event ID 唯一，父链各在本 Run 内。B `disable` 后，B 不进档案，A 照常采集。event ID 幂等由单测证明。
- **Q6 STORE-003**：占着写锁提交。从回车到对话框不超过 10 s，另加 2 s 余量，实测值写进结果。对话框出现后继续占锁 15 s，其间没有 helper 被拉起。释放后重试：只多一条条目，transcript 里也只有一次。
- **Q7 STORE-006**：一个世界，写坏前保存被覆写页的原始字节。
  - (a) 仍损坏时重新检查，对话框再次出现；写回原字节后重新检查，通过，prompt 只提交一次。
  - (b) 再写坏，选隔离：隔离副本逐字节相同，出现新 generation。
  - (c) 再写坏，选清除全部：错误短语不删，正确短语后 prompt 只放行一次。

  第一次损坏时，第二个终端的提交同样被拦下，档案文件不变。
- **Q8 STORE-008**：A、B 带 fixture，各提交 1 条。C 的 `clear-all` 把短语打好、先不回车。A 发出 HOLD prompt，预写后在 C 按回车；之后 A、B 各再提交 1 条。断言：切点前的条目全部消失，切点后的只在新 generation，新 sequence 从头开始。HOLD prompt 按插件现有行为处理（由探测决定），不允许带着旧 event ID 或旧 sequence 复活。
- **Q9 STORE-009**：
  - `alpha`（git）与 `beta`（普通目录）各自采集；写坏 `beta` 后，`alpha` 不受影响，`beta` 的提交被拦下。
  - 在 `alpha` 的 `git worktree` 里启动：重新请求 consent，档案独立。
  - `gamma` 采集后 `mv` 到新路径：重新请求 consent，旧档案不动。

  git 由 harness 在世界之外执行。
- **Q10 FAIL-001**：宿主运行中，对 `.sqlite3` 与 `-wal` 加 `uchg` 后提交：出现对话框，取消后草稿放回，没有 pending，transcript 里没有这条 prompt；解除后照常采集。`uchg` 碰不到预写时改锁 `archives/` 目录；再不行就只由 plugin test 证明，并写明原因。
- **Q11 FAIL-002**：用 `refused_confirmation()`。UI 与 status 显示「待对账」和 event ID，不含 prompt 原文；下一次提交先对账再提交；pending 没有重复成两条条目。
- **Q12 FAIL-003**：A、B 两个 Run，用写锁制造失败。
  - 对话框只有「重试」和「禁用当前 Run」；
  - 占锁时重试，对话框再次出现；释放后重试，只提交一次；
  - 再占锁后禁用：prompt 放行但不进档案；释放后停止边界只写一次；
  - A 之后不补录；B 照常采集。
- **Q13 FAIL-004**：
  - (a) A 的预写等写锁时 `SIGKILL` 宿主，relaunch 后写入 Integrity Gap（时序先探测）；
  - (b) 占锁时执行 `/clear`，Clear Boundary 进入 `$.store` 队列，释放后从队列恢复，不产生 Gap。

  hook 抛异常与恢复队列溢出由 plugin test 证明。
- **Q14 FAIL-005**：用 Q13(a) 的做法留下真实的 Gap。恢复后写入闭合边界，band 与 status（`integrity gaps: 1`）显示 Gap，relaunch 后仍可见。在另一个 Run 里 `clear-run`，Gap 还在；在持有 Gap 的 Run 里 `clear-run`，Gap 消失。
- **Q15 FAIL-006**：`fault_tour()` 补上 locator 不可用（发布后改成 0644）、busy、重试、禁用后继续；FAIL-006 的 `observe` 逐项断言；SEC-002/004 随后重跑。
- **Q16 scenarios.json**：FAIL-001..005 加上 `pty` 层。COMPAT-002/003、STORE-002、FAIL-004 的步骤文字写明哪些由 PTY 注入、哪些只由 plugin test 或单测证明。
- **Q17 验证**：
  - `run45.py` 两个版本都通过；
  - `release-evidence.sh --skip-gates --only <14 个 ID + SEC-002/004>` 与 `verify-startup.sh`；
  - 2.1.283 上逐个场景做变异检查；
  - 发现插件缺陷时先和使用者商量，再拆票。

### 实现中修订（2026-09-30）

- **拆出并已修好的四张票**：
  - [Issue 49](49-status-runs-untrusted-helper.md)：helper 不可用时 status 仍执行 helper（COMPAT-003 探测）；
  - [Issue 50](50-foreign-pending-adopted.md)：另一个仍在运行的 Run 的 pending 被当成本 Run 的对账（STORE-006 探测）；
  - [Issue 51](51-write-lifts-damage-report.md)：另一个 Run 的写入撤掉损坏报告并继续写坏档案（STORE-006 探测）；
  - [Issue 52](52-refused-write-called-conflict.md)：档案拒绝写入时 helper 报成 `capture-conflict`（FAIL-001 探测）。
- **驱动**（`release/pty_driver.py`）：
  - `Host(version, intel=True)`：`npm pack` 取 x64 包，解到 `~/.cache/prompt-history-release/hosts/`，经 `/usr/bin/arch -x86_64` 启动；
  - `launch(host=…)`；
  - `Terminal.kill()`：`SIGKILL` 后立即回收。否则僵尸进程的 pid 与启动时间都还在，插件会把被杀的宿主当成仍在运行，resume 就成了从它分出的新 Run。
- **与对齐不同的地方**：
  - Q2：COMPAT-002 不要求抽样到 socket。helper 只活几毫秒，`ps` 抽到时常只剩 `(prompt-history-hel)`，拿不到 argv。改为断言三种不受支持的情形下 `helper: not checked`，即 helper 根本没运行；socket 检查仍由 SEC-004 负责（一次巡回约 200 次抽样）。
  - Q3：COMPAT-003 的每一项（缺失除外）都用「记录调用后转交真 helper」的包装脚本，protocol 那一项也是。插件先检查 locator 的 `helperProtocol`，所以 reason 仍是 `protocol-mismatch`。
  - Q7：`meet_damage` 本来就会把同一条 prompt 发两次（第一次在确认时才碰到损坏，留下 pending）。重新检查通过后，插件先对账确认第一次那条，再把第二次的草稿放回输入框，所以断言按 transcript 的增量写。重新检查失败时对话框带着同样的选项再次出现，新增 `choose_once()` 只按一次回车。
  - Q8：HOLD 的 prompt 在清除切点之前就已预写，属于切点前的数据，被留在新 generation 之外。「切点落在它在途期间」用 transcript 文件判断：宿主在等 hook 时就会在屏幕上画出 prompt，但要等 hook 放行后才写进 transcript。
  - Q10：`uchg` 碰得到预写。修好 52 之后，类别为 `archive-read-only`、范围为本项目所有 Run；故障记录在案，解除后要选「重试」。
  - Q13：(a) 的时序稳定：提交等写锁时有 helper 子进程在等待，这时杀掉宿主，不会留下 pending。
  - Q15：`fault_tour()` 新增 busy→重试、禁用后继续、运行中把 locator 放宽为 0644 三段。locator 放宽后，status 报 `unsupported target · locator-permissions`，提交按 `locator-permissions` 拦下，没有放行。
- **status 的 `Quarantined archives`**：helper 没被问过时，status 只画 `Archive generation: unknown`，不画这一行。契约没有要求这一行，`status_fields` 只在档案状态已知时要求它。
