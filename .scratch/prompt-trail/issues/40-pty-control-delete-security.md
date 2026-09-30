# 40: 以真实 PTY 证明控制、删除与安全场景

**What to build:** 为 `PT-CONTROL-001..002`、`PT-DELETE-001..004` 与 `PT-SEC-001..004` 编写自动化 PTY 场景，与既有 plugin test、helper 证据共同构成三层覆盖。

**Blocked by:** 31「生成零跳过发布证据」、46「status 应当显示活动档案的大小」、47「对账因档案损坏失败时，提交应当给出损坏选项」、48「status 与清除回复中的误导性文字」

**Status:** resolved

- [x] `status`、enable/disable、`clear-run`、`clear-all`、无数据与残留、删除边界告知均有 PTY 场景。
- [x] 私有权限在创建、迁移、隔离、清除和异常恢复后由 PTY 场景复核。
- [x] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。

## Answer

- **场景**：`PT-CONTROL-001..002`、`PT-DELETE-001..004` 与 `PT-SEC-001..004` 在 `release/pty_scenarios.py` 里各有一个函数。做法、与对齐（Q1–Q11）不同的地方和宿主事实，见 Comments 里的「实现中修订」。
- **拆出并已修好的三张票**：
  - [Issue 46](46-status-archive-size.md)：status 显示活动档案的大小（Q11）。
  - [Issue 47](47-damage-during-reconciliation.md)：对账遇到损坏时给出损坏选项；并入 `clear-all` 残留提示的措辞。
  - [Issue 48](48-misleading-status-and-clear-text.md)：status 的 generation 截断、接着完成的清除说档案损坏、helper 不可用时说 `not created`。
- **正式入口**：`release-evidence.sh --skip-gates --only <10 个 ID>`（`build/evidence/20260930T063309Z/`）：20/20 PTY 通过，0 泄漏；报告因为是 partial、工作树未提交，按设计判 FAIL。
- **变异检查（2.1.283）**：每个场景反转一条关键断言，10 个全部失败。
- **`verify-startup.sh`**：通过（两个版本各 451 项 plugin test）；`release_verdict` 在改过的 scenarios.json 上通过。
- **scenarios.json**：PT-DELETE-003 与 PT-SEC-003 的步骤文字注明 PTY 的做法（Q2、Q8）；PT-CONTROL-001、PT-DELETE-002/003 与 PT-STORE-006 补上 46–48 的测试引用。

## Comments

### 实现层面对齐（2026-09-30）

第一轮 Q1–Q10，使用者回复「均采用」。

- **Q1 场景结构**：沿用 36/37/38，一个 ID 一个函数、一个全新 Environment，10 个场景都在 `pty_scenarios.py`。`Environment.finish()` 先对世界 `chflags -R nouchg`，再删除；另加权限采样线程（Q8）。
- **Q2 残留注入**：只对 `clear-all` 在 PTY 里造残留：对真实 `-wal` 加 `chflags uchg`（若 inventory 读库就先失败，改锁隔离档案文件）。断言「逻辑删除已完成、物理清除未完成」并列出残留、status 为 `clear: unfinished · 1 residual`、下一次提交被拦住；`nouchg` 后再 `clear-all` 无需短语即完成，档案恢复可用。`clear-run` 要先写库、VACUUM 与截断 WAL，`uchg` 会让它更早以别的错误失败，迁移备份又只活到下一次打开，所以它的残留仍由 plugin test 与单测证明，在 scenarios.json 步骤中写明。
- **Q3 隔离档案**：`/exit` 后从外部写坏档案，relaunch 后提交，在损坏对话框中选「隔离并开始新档案」。写坏哪里由探测决定，取稳定触发 `archive-integrity` 的一种。损坏本身的覆盖归 39（STORE-006），这里只是准备步骤。
- **Q4 CONTROL-001**：健康（真实提交后）；有 Gap（`timeline_fixture` 注入带 Integrity gap 边界的事件，同 UI-002，是准备步骤）；失败（Q3 的损坏状态，status 仍可用，显示 `archive: unavailable` 与 choices）。每种都断言 status 只含契约字段，status 区域不含 marker。
- **Q5 CONTROL-002**：未同意的项目直接 `/prompt-history enable`，先问 consent，启用后开始采集 → `disable` 后提交：无新条目、旧条目保留、consent 不变 → 按 CAPTURE-008 的配方（downstream fixture 的 HOLD 与 sqlite 写锁）留下 pending，再 disable、enable：按插件现有行为，先拒绝或对账，之后才写 `collection-resumed`，下一条从新根开始（档案里 `parentEventId` 为空）。
- **Q6 DELETE-001/002/004**：
  - DELETE-001：两个 Run 各提交几条，在第二个 Run 里 `clear-run`：先取消，什么都不删；再确认，只删本 Run，另一个 Run 原样。之后按 Q3 做出隔离档案，再 `clear-run`，被拒绝并指向 clear-all。
  - DELETE-002：隔离档案与多条记录都在时 `clear-all`：错误短语不删；正确短语后活动 DB、WAL/SHM 与隔离目录都没了，consent 与 Run 模式保留，status 显示新 generation，之后的提交进入空时间线。
  - DELETE-004：自己跑一遍两种清除，只读确认对话，断言提到 transcript/history、文件系统快照、外部备份与 SSD，然后取消。
- **Q7 SEC-001**：走一遍提交、展开 band、status、清除确认与失败对话，途中在场景内调用 `scan_tree`，断言：marker 确实出现在允许的档案文件里（`allowedFiles>0`）、至少采到一次 helper argv、泄漏为 0、marker 在展开的 band 上可见而在 status/确认对话区域不可见。另加扫描器自检：在世界之外的临时目录放一个含 marker 的文件，同一 scanner 必须报出，文件不进世界、不影响门禁。
- **Q8 SEC-003**：新增 `ctx.private_modes()`，遍历 `plugins/data/` 下 Prompt Trail 的目录、档案、隔离区、sessions 与 locator，返回非 0700 的目录与非 0600 的文件（宿主写的 store JSON 不在内）。在创建、迁移、隔离、清除与异常恢复（Q2 解除残留后）之后各查一次；另有 50 ms 权限采样线程抓 `.clearing`、`.partial` 等中间文件。迁移：先真实提交拿到 project id，`/exit` 后用 `helper_protocol` 的 `SCHEMA_1_DDL` 重建 schema-1 档案，relaunch 后提交触发迁移。备份只活到下一次打开，「看到备份」不作为硬断言：看到就查权限，没看到就在结果里写明，备份权限由单测证明。
- **Q9 SEC-002/004**：合成一个故障巡回：写锁导致确认失败、损坏、清除残留、helper 不可用（把插件复制到临时目录并替换其中的 helper，`launch` 加 `plugin_root` 参数，39 也会用）。
  - SEC-002：argv 采样不含 marker；每个失败的 UI（对话、status）不含 marker，只含事件 ID、sequence、错误码与路径。
  - SEC-004：采样线程记录世界的进程树，出现 `cc|clang|ld|xcrun|make|xattr|spctl|codesign|curl|wget|nc` 即失败；对 helper、bridge 进程抽样 `lsof -i`，不得有网络 socket；插件根的 xattr 前后快照一致；失败前后档案文件哈希不变；helper 不可用时 band 不出条目，status 为 unavailable。
- **Q10 验证**：scratchpad 的 `run45.py` 调试，两个版本都通过；收尾跑 `release-evidence.sh --skip-gates --only <10 个 ID>` 与 `verify-startup.sh`；2.1.283 上每个场景反转一条关键断言做变异检查；scenarios.json 只在做法与契约不同处改步骤文字（Q2 的 clear-run 残留、Q8 的迁移备份）。

第二轮 Q11，使用者回复「采用」。

- **Q11 status 缺数据库大小**：spec 用户故事 9 与 CONTROL-001 的 expected 要求 status 显示数据库路径和大小，现在 `archive:` 行只有 `ready · <路径>`。照 44/45 的做法拆为 Issue 46，挡住本票：在本分支用 TDD 修复，由 helper 的 `archive-status` 返回活动档案字节数（`.sqlite3`、`-wal`、`-shm` 之和），status 显示 `archive: ready · <路径> · N bytes`；CONTROL-001 断言该字段。

### 实现中修订（2026-09-30）

- **驱动**（`release/pty_driver.py`）：
  - `launch` 可以指定 `plugin_root`；
  - `private_modes()` 与 50 ms 的 `watch_modes()`；
  - `watch_side_effects()`：采样世界里的进程，记录禁用程序，并对 helper、bridge 抽样 `lsof -i`，同时计数，保证断言不是空查；
  - `finish()` 先执行 `chflags -R nouchg`。
- **与对齐不同的地方**：
  - Q3：写坏的是 `prompt_entries` 的表根页（折叠 WAL 之后）。写坏文件中间某一页不一定会被检查到。
  - Q4：Gap 的注入用 seed 22 的 400 条（与 UI-002 相同）；40 条里概率上没有 Gap。
  - Q7：SEC-001 的扫描器自检同时证明「档案文件被放过」；「失败对话」用的是损坏对话框。
  - Q8：迁移用 `SCHEMA_1_DDL` 在首次启动前建好 schema-1 档案（project id 是项目路径的 sha256），首次提交时触发迁移。「创建」取清除之后下一次提交新建的档案。50 ms 采样有时抓得到备份、有时抓不到，结果里如实写明是哪一种。
  - Q9：helper 不可用用的是替换 helper 的插件副本（`digest-mismatch`）。SEC-004 的「未自动删除」查的是：隔离区里的副本与对话框出现时的档案逐字节相同（`-shm` 除外），以及 helper 不可用期间档案文件不变。
- **宿主事实**：
  - `$.ui.ask` 的自由输入项是 `N. Type something.`，选中后直接打字、回车即可；
  - 刚画出的对话框可能不接收 Esc，要等约 1 秒并重试；
  - 被拦住的提交会把草稿放回输入框，之后再发命令前要先清空；
  - relaunch 之后马上查 status，偶尔会赶在 bridge 发布 locator 之前，报 `unsupported target · claude-code-version-unproven`（2.1.273 上遇到一次），稍等再查就正常。SEC-002/004 为此最多重查 5 次。
  - status 里的路径很长，场景用 250 列终端避免折行。

### Code review 修复（2026-09-30，round 1）

范围是 1b445dc 之后的整个工作树，对照 40、46、47、48。9 条发现：5 条修复（其中 2 条插件缺陷见 Issue 48 的 Comments），3 条 cleanup 记入 backlog，另 1 条 cleanup 直接修掉。

- `watch_side_effects` 原来只从 argv 含世界路径的进程往下找，宿主本身及其不带该路径的子进程会漏掉。现在把各终端的宿主 PID 也作为根。
- socket 抽样改为先用 `lsof -p <pid> -F t` 确认进程还在，才计入 `socket_checks`；按 `tIPv4`/`tIPv6` 判断网络 socket。
- `refused_confirmation` 在 pending 预写后快照档案，释放写锁 2 秒后要求档案不变（Q9「失败前后档案文件哈希不变」）。
- 去掉 `fault_tour` 没人用的返回值。
- 记入 backlog：`docs/code-review-backlog/20260930-pty-dialog-selection-duplicated.md`、`20260930-pty-command-reply-polling-duplicated.md`、`20260930-pty-mode-watcher-walks-twice.md`。
- 验证：`verify-startup.sh` 通过（两个版本各 453 项）；PT-SEC-002、PT-SEC-004、PT-CONTROL-002、PT-DELETE-002 在两个版本上通过，0 泄漏。
