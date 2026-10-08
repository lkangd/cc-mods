# 31: 生成零跳过发布证据

**What to build:** 让发布维护者用一次可重复流程证明唯一支持矩阵中的全部 MUST 场景均通过、没有 prompt 泄漏，并生成可审计的发布报告。

**Blocked by:** 23「在终端限制下保持时间线可用」、26「记录并闭合 Integrity gap」、29「物理清除当前 Run」、30「原子清除 Project Timeline」

**Status:** resolved

- [x] 发布流程固定并记录 macOS 15.x arm64、Claude Code 最低兼容版本 `2.1.273` 与当前发布验收版本、交互式终端、function-hooks 开关、插件版本、helper 摘要和 SQLite 版本。
- [x] 插件校验、TypeScript 检查、静态 Mach-O/manifest 检查、plugin tests、helper protocol tests、真实 PTY acceptance、100k benchmark 和隐私扫描全部纳入同一门禁。
- [x] `PH-COMPAT`、`PH-CAPTURE`、`PH-LIFE`、`PH-BRANCH`、`PH-JUMP`、`PH-UI`、`PH-STORE`、`PH-FAIL`、`PH-CONTROL`、`PH-DELETE` 和 `PH-SEC` 的每个稳定场景 ID 都映射到步骤、预期、实际、结果和证据链接。
- [x] 每个场景使用隔离临时项目、plugin data、locator 和 HOME；不得读取、修改或删除现有 prompt-history/Claude Code 用户数据。
- [x] 每个 fixture 使用不可猜测的合成 prompt 标记；扫描 argv、locator、stdout/stderr、Claude Code/plugin 日志、错误、trace、备份清单和报告。
- [x] 合成标记只能出现在目标 SQLite 原文字段、`timeline-read` 响应和当下允许显示的 UI；任何其他出现（包括其他子命令的 stdout）都阻断发布。
- [x] 终端 trace 与报告在落盘前或汇总时完成脱敏，只保留非敏感 ID、sequence、错误码、计数、版本和路径。
- [x] 100,000-event fixture 的有界读取/渲染和三个 p95 目标均在报告中记录参考硬件、运行次数和测量结果。
- [x] README/status 明确列出不支持平台、Marketplace 边界、自动焦点/Esc/滚轮/槽位限制、删除边界及移除 `--plugin-dir` 前的数据清理说明。
- [x] 任一 MUST 场景 failed、missing、skipped、无证据或 leaked marker 时报告整体失败；只有零缺失、零跳过、零泄漏才允许发布。

## Answer

发布门禁现在是一条可重复的流程：`mods/prompt-history/scripts/release-evidence.sh`。它按 `release/scenarios.json` 判定 Issue 05 的 56 个 MUST 场景，只有零失败、零缺失、零跳过、零泄漏才通过。本票按对齐 Q1 只带第一批 PTY 场景，其余 PTY 在 36–40，正式发布证据在 41。实现提交：`b5eb76d`（`status` 的 `not promised:` 行与 README）、`02fde7d`（门禁、清单、PTY 驱动器、首批场景）、`47db226`（网络错误重跑与两处等待）、`c97fc2f`（运行开始时记提交、validate 列为门禁、修正对账步骤）。对齐见下方 Comments 的 Q1–Q21。

- **门禁**（`release/release_evidence.py`）：依次跑制品重建比对、两个宿主版本的 `plugin validate` 与 `plugin test`、TypeScript、全部 unittest（经 `release/unit_runner.py` 按 id 收集）、helper 探针与 protocol 不符探针、100k benchmark、PTY 场景，最后扫描整个输出目录。每一步的输出存为 `logs/<门禁>.log`，报告里的证据链接是相对路径，整个目录可以原样搬到 `release/evidence/<版本>/`。
- **判定**（`release/evidence.py`，纯逻辑）：
  - plugin test 输出按「文件::测试名」解析；同名测试在一个文件里出现两次算失败。
  - 依赖宿主的证据（plugin test、PTY、validate）在两个版本上各取一次；场景结果取最差的一项（failed > missing > skipped > pass）；清单里声明的证据层没有任何引用即为 missing；清单缺少某个契约 ID 为 missing，多出契约没有的 ID 使报告失败。
  - 报告失败的其他理由：局部运行、工作树与运行开始时的提交不符、任何泄漏、任何门禁失败。
- **PTY**（`release/pty_driver.py`、`release/pty_scenarios.py`）：
  - 每个场景新建临时 HOME、`CLAUDE_CONFIG_DIR`、项目与 TMPDIR；插件数据随 `CLAUDE_CONFIG_DIR` 落在临时目录，实测确认。token 从钥匙串条目 `prompt-trail-release` 读出，只经 `CLAUDE_CODE_OAUTH_TOKEN` 交给隔离进程；模型固定 haiku。
  - pyte 屏幕回答宿主的终端查询；鼠标用 SGR 序列；每个断言点存一份脱敏屏幕快照，原始字节不落盘。档案经 `tests/semantic_verifier.py` 新增的 `describe()` 按语义读取，只留在内存。
  - 每个场景结束后扫描整个隔离目录再删除；运行期间每 0.25 秒采样一次全部进程的 argv。
  - 下游测试插件 `release/fixtures/downstream`（只在 PTY 里与生产插件一起加载）：含 `PH-FIXTURE-DROP` 的 prompt 被它 drop，含 `PH-FIXTURE-HOLD` 的被它压住几秒，让场景能在 prompt-history 预写之后、确认之前动手。生产插件的 hook 代码没有任何改动。
- **首批 PTY 场景**：`PH-COMPAT-001` 与 `PH-CAPTURE-001..008`。其中 CAPTURE-004 用粘贴图片路径制造附件；CAPTURE-007 先用 HOLD 证明 prompt-history 在测试插件之上预写，再验证 drop；CAPTURE-008 在 HOLD 期间用 sqlite3 占住写锁，使确认在有界等待后失败。
- **README 与 `status`**：新建中文 `mods/prompt-history/README.md`；`status` 在 `target:` 下新增一行 `not promised:`，列出各项边界的名称并指向 README。
- **与对齐稿不同**：
  - 对账的真实流程与票面措辞不同：确认失败后的下一次提交先对账（transcript 能唯一证明时自动确认），这条新 prompt 本身被 drop 并作为草稿退回（「已完成对账，草稿已恢复；请重新提交」），要再提交一次。CAPTURE-008 按实际流程断言。
  - 增加 `--skip-gates`（与 `--only` 一样使报告成为 partial）。
  - 测试文件命名为 `tests/release_verdict.py`，避免与 `release/release_evidence.py` 同名互相遮蔽。
  - 宿主在加载测试插件时会生成 `tsconfig.json`，它已随测试插件提交，免得每次运行都弄脏工作树。
  - Q21（宿主网络错误整场重跑一次）是实现中追加的决定。
- **测试**：
  - `tests/release_verdict.py` 22 项（已加入 `verify-startup.sh`）：plugin test 输出解析、场景与报告判定、标记生成与前缀匹配、跨行脱敏、扫描允许清单、网络错误识别、Markdown 报告。
  - 变异检查：判定逻辑 20 条，首轮存活 3 条（跨行脱敏的行宽判断、允许清单的 `archives/` 路径要求、文件名的 `$` 锚），补断言后全部被抓到。
  - plugin test：`startup.test.tsx` 断言 unsupported 的 `status` 也有 `not promised:` 行，先红后绿；两个版本各 436 项。
- **完整运行**（`20260929T051517Z`，提交 `47db226`，MacBookPro18,3 / M1 Pro，macOS 15.8，SQLite 3043002）：结果是 FAIL，符合预期：18 pass、0 failed、38 missing（36–40 负责的 PTY 与 SEC-001 的完整扫描）、0 skipped、0 leaked。全部门禁通过；9 个 PTY 场景在 2.1.273 与 2.1.283 上都通过。扫描 6006 个文件，允许清单内 92 个，argv 采样到 49 次 helper 调用，都不含标记。benchmark p95：展开 54.6 ms、下一批 48.6 ms、新条目 91.7 ms。
  - 第一次完整运行（`20260929T035715Z`）有 3 个失败：一个是 band 展开前就断言（已改为等 band 真正展开）；两个是宿主连不上 API（ECONNRESET 重试到第 7 次），因此有了 Q21。
- **调试中查明的宿主事实**：
  - 对话框刚画出来时不接收按键；
  - 紧跟在输入文字后面的 Enter 会被当作粘贴的一部分，prompt 留在输入框里；
  - `/cost` 打开独立的设置面板，要按 Esc 关掉；
  - 2.1.273 的 hook 没有 `next.budget`；
  - haiku 会把带随机标记的 prompt 当成注入而长篇回复，prompt 措辞已改为说明这是自动化验收。
  - 隔离配置目录下，宿主仍会自行克隆官方 marketplace（约 530 个文件），这些文件都在扫描范围内。
- **未覆盖**：
  - argv 采样只能抓到运行时间较长的 helper 调用（占锁等待期间）；短调用的 argv 证据依赖 plugin test。
  - 修正对账步骤、把 validate 列为门禁的 `c97fc2f` 之后没有再完整运行一次（改动只涉及清单文字和报告列表；判定逻辑的 unittest 通过）。
  - `release/evidence/<版本>/` 的首次提交属于 41。

## Comments

### 实现层面对齐（2026-09-29）

使用者对三轮问题均回答「均采用」。

- **Q1 范围**：本票做流程骨架——全量场景清单与证据映射、报告生成、零缺失判定、隐私扫描、benchmark 并入、README、PTY 驱动器——以及第一批 PTY 场景（Q11）。其余 PTY 场景拆到 36–40，正式发布证据在 41。它们完成前，报告如实判定整体失败。
- **Q2 PTY 驱动**：Python `pty` + pyte 终端模拟器，完全无头；鼠标用 SGR 序列，resize 用 `TIOCSWINSZ` + SIGWINCH，颜色从模拟屏幕读取。不用 cmux，也不用 `expect`。
- **Q3 登录**：隔离 HOME 下用 `claude setup-token` 生成的长期 token，经 `CLAUDE_CODE_OAUTH_TOKEN` 传入（文档确认的变量名）；不读使用者的钥匙串凭据或 `~/.claude`。prompt 一律 `--model haiku`，内容让模型只回「ok」。token 与标记一样参与泄漏扫描。
- **Q4 版本**：PTY 全量场景在 `2.1.273` 与当前版本 `2.1.283` 上都跑。本票不升当前版本（本机全局已是 2.1.284，升级另由使用者决定）。
- **Q5 场景清单**：`mods/prompt-history/release/scenarios.json` 逐条列出 ID、标题、步骤、预期、所需证据层与证据引用（plugin test 文件::测试名、helper unittest id、PTY 脚本 id、静态检查项）。所有引用在每个必需版本上都通过，场景才算 pass；引用不存在算 missing，被跳过算 skipped，缺一层证据也算 missing，均判失败。报告同时输出 JSON 与 Markdown。
- **Q6 报告位置**：每次运行输出到 gitignore 的目录；发布时把 `report.json`、`report.md` 和脱敏 trace 一起提交到 `release/evidence/<插件版本>/`。
- **Q7 扫描范围**：扫描隔离 HOME、项目、plugin data、TMPDIR、脚本 stdout/stderr、trace 与报告里的每个文件。允许清单只有两类：档案 SQLite 族（db、wal、shm、迁移备份、Quarantined Archive），以及 Claude Code 自己的对话数据（transcript jsonl、`history.jsonl` 等）。允许清单写进报告；`$.store` 落盘文件不在允许清单内。argv 的证据为 plugin test 断言每次 `process.run` 的 argv 不含标记，外加 PTY 期间定时 `ps -axww` 采样。不开 `--debug`。
- **Q8 标记与脱敏**：标记为「128 位随机 hex + 场景 ID」，随机部分在前。扫描与脱敏同时匹配完整标记和随机部分任意 ≥12 字符的前缀（UI 截断会留下前缀），写盘前替换为 `<marker:N>`。
- **Q9 人工证据**：不接受真人目视确认；所有 MUST 由本次运行自动产生证据。以往各票手动完成的 PTY 不计入报告。
- **Q10 入口**：新增 `scripts/release-evidence.sh` 作为唯一发布门禁，依次运行 verify-startup（含两个版本的 plugin tests）、benchmark、PTY 套件、隐私扫描，再生成报告；非零缺失、零跳过、零泄漏即非零退出。`verify-startup.sh` 保持为快速开发门禁。
- **Q11 拆票**：31 含 `PH-COMPAT-001` 与 `PH-CAPTURE-001..008` 的 PTY。36 生命周期与 Run 身份（LIFE-001..004、STORE-001）；37 分支与跳转（BRANCH-001..004、JUMP-001..002）；38 时间线 UI（UI-001..008）；39 兼容与故障（COMPAT-002/003/005、STORE-002/003/006/008/009、FAIL-001..006）；40 控制、删除与安全（CONTROL、DELETE、SEC）；41 正式运行 0.1.0 发布门禁并提交证据（依赖 36–40）。
- **Q12 被测插件**：PTY 一律 `--plugin-dir` 直接加载生产插件根，hook 代码在任何场景都不改。故障只从外部注入（权限、`chflags`、写坏数据库、sqlite3 占锁）；helper 制品类故障用临时插件副本替换 helper，副本 hooks 与原件逐字节一致，报告写明副本和改动。只能改代码才能造出的故障（plugin 崩溃）按契约由 plugin test 与 helper 证明。
- **Q13 trace**：只保存终端模拟后的屏幕快照（每个断言点一份，含文字和必要的颜色属性），脱敏后写盘；原始字节流从不落盘。
- **Q14 plugin test 对应**：清单按「文件::测试名」精确引用现有测试，不给测试名加场景 ID。改名后引用对不上即判 missing。
- **Q15 运行方式**：场景顺序执行、不并行。允许 `--only <ID>` 局部运行，但局部运行的报告标为 `partial`、整体判失败，不能作为发布证据。
- **Q16 pyte**：入口脚本首次运行时在 `~/.cache/prompt-history-release/venv` 建 venv，以 `--require-hashes` 安装钉死版本的 pyte；报告记录其版本。建 venv 需要联网，属于开发工具链，不受插件「不得联网」约束。
- **Q17 README 与 status**：新建中文 `mods/prompt-history/README.md`，写明支持矩阵、不支持的平台、Marketplace 边界、焦点/Esc/滚轮/槽位限制、删除边界，以及移除 `--plugin-dir` 前的清理步骤（各项目先 `/prompt-history clear-all`，再删插件数据目录）。`status` 只加一行列出这些边界的名称并指向 README。
- **Q18 隔离环境**：每个场景新建临时 HOME、`CLAUDE_CONFIG_DIR`、项目目录与 TMPDIR；onboarding 与项目信任用预写 `.claude.json` 跳过。插件数据目录是否随 `CLAUDE_CONFIG_DIR` 隔离要先实测，不会则显式隔离，绝不写入使用者真实的插件数据目录。
- **Q19 token 来源**：使用者用 `security add-generic-password -s prompt-trail-release -a "$USER" -w` 把 token 存进钥匙串的专用条目，脚本只读这一条。
- **Q20 提交绑定**：报告记录当前提交 SHA；工作树不干净时照常生成报告，但整体判失败。

### 实现中追加（2026-09-29）

- **Q21 宿主网络故障**：第一次完整运行中，两个 PTY 场景因宿主与 API 的连接中断（`Connection dropped (ECONNRESET) · Retrying … attempt 7/10`）等不到回合结束而失败。使用者选择：失败时的屏幕带宿主网络错误特征才整场重跑一次，只重跑一次；报告的 actual 写明「retried after a host network error」，第一次的 trace 另存为 `<ID>.attempt-1.txt`。没有这种特征的失败照常判失败。

### Code review 修复（2026-09-29，round 1）

`/code-review` 对 `5755f1c..19715c2` 给出 15 条（产物 `.code-review/runs/20260929-133045/round-1/`）：修 11 条，backlog 2 条，驳回 2 条。

- 扫描（`release/evidence.py`）：`scan_tree` 新增 `config` 参数，允许清单只认隔离配置目录下 `plugins/data/*/archives/` 的档案文件与宿主对话记录；允许清单内的文件仍查 secret；文件名、目录名与符号链接目标都扫描，报告里的路径先脱敏；进不去的目录与读不了的文件记为 `unscannable` 泄漏。隔离目录删不掉时记 `not removed` 泄漏（`release/pty_driver.py`）。
- 判定：清单里重复的场景 ID 使报告失败。
- 门禁：缺失或读不了的制品记为 `artifacts-reproducible` 失败，不再中止运行；`datetime.UTC` 改为 `datetime.timezone.utc`；`scripts/release-evidence.sh` 在 venv 版本与 `requirements.txt` 不一致时重装（实测 0.8.1 被重装为 0.8.2）。
- CAPTURE-004 加一次纯附件提交：两个宿主都产生 1 个附件、文本只有宿主 `[Image #N]` 占位符的条目。
- 模块注释不再称「纯逻辑」。
- backlog：`docs/code-review-backlog/20260929-release-gate-unit-module-list-duplicated.md`、`20260929-release-gate-artifact-list-duplicated.md`。
- 驳回：npx 的 `claude` 在两个版本上都是原生 arm64 Mach-O，不依赖 node，PATH 不缺；「esc to interrupt」在提交的同时显示，不经 API，回合启动超过 10 秒才显示的前提不成立。
- 测试：`tests/release_verdict.py` 22 → 28 项；新增扫描逻辑的 10 条变异首轮存活 3 条，补测后全部被抓到。修复后没有重新完整运行门禁，只在两个版本上跑了 CAPTURE-004。
