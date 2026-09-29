# 31: 生成零跳过发布证据

**What to build:** 让发布维护者用一次可重复流程证明唯一支持矩阵中的全部 MUST 场景均通过、没有 prompt 泄漏，并生成可审计的发布报告。

**Blocked by:** 23「在终端限制下保持时间线可用」、26「记录并闭合 Integrity gap」、29「物理清除当前 Run」、30「原子清除 Project Timeline」

**Status:** ready-for-agent

- [ ] 发布流程固定并记录 macOS 15.x arm64、Claude Code 最低兼容版本 `2.1.273` 与当前发布验收版本、交互式终端、function-hooks 开关、插件版本、helper 摘要和 SQLite 版本。
- [ ] 插件校验、TypeScript 检查、静态 Mach-O/manifest 检查、plugin tests、helper protocol tests、真实 PTY acceptance、100k benchmark 和隐私扫描全部纳入同一门禁。
- [ ] `PT-COMPAT`、`PT-CAPTURE`、`PT-LIFE`、`PT-BRANCH`、`PT-JUMP`、`PT-UI`、`PT-STORE`、`PT-FAIL`、`PT-CONTROL`、`PT-DELETE` 和 `PT-SEC` 的每个稳定场景 ID 都映射到步骤、预期、实际、结果和证据链接。
- [ ] 每个场景使用隔离临时项目、plugin data、locator 和 HOME；不得读取、修改或删除现有 Prompt Trail/Claude Code 用户数据。
- [ ] 每个 fixture 使用不可猜测的合成 prompt 标记；扫描 argv、locator、stdout/stderr、Claude Code/plugin 日志、错误、trace、备份清单和报告。
- [ ] 合成标记只能出现在目标 SQLite 原文字段、`timeline-read` 响应和当下允许显示的 UI；任何其他出现（包括其他子命令的 stdout）都阻断发布。
- [ ] 终端 trace 与报告在落盘前或汇总时完成脱敏，只保留非敏感 ID、sequence、错误码、计数、版本和路径。
- [ ] 100,000-event fixture 的有界读取/渲染和三个 p95 目标均在报告中记录参考硬件、运行次数和测量结果。
- [ ] README/status 明确列出不支持平台、Marketplace 边界、自动焦点/Esc/滚轮/槽位限制、删除边界及移除 `--plugin-dir` 前的数据清理说明。
- [ ] 任一 MUST 场景 failed、missing、skipped、无证据或 leaked marker 时报告整体失败；只有零缺失、零跳过、零泄漏才允许发布。

## Comments

### 实现层面对齐（2026-09-29）

使用者对三轮问题均回答「均采用」。

- **Q1 范围**：本票做流程骨架——全量场景清单与证据映射、报告生成、零缺失判定、隐私扫描、benchmark 并入、README、PTY 驱动器——以及第一批 PTY 场景（Q11）。其余 PTY 场景拆到 36–40，正式发布证据在 41。它们完成前，报告如实判定整体失败。
- **Q2 PTY 驱动**：Python `pty` + pyte 终端模拟器，完全无头；鼠标用 SGR 序列，resize 用 `TIOCSWINSZ` + SIGWINCH，颜色从模拟屏幕读取。不用 cmux，也不用 `expect`。
- **Q3 登录**：隔离 HOME 下用 `claude setup-token` 生成的长期 token，经 `CLAUDE_CODE_OAUTH_TOKEN` 传入（文档确认的变量名）；不读使用者的钥匙串凭据或 `~/.claude`。prompt 一律 `--model haiku`，内容让模型只回「ok」。token 与标记一样参与泄漏扫描。
- **Q4 版本**：PTY 全量场景在 `2.1.273` 与当前版本 `2.1.283` 上都跑。本票不升当前版本（本机全局已是 2.1.284，升级另由使用者决定）。
- **Q5 场景清单**：`mods/prompt-trail/release/scenarios.json` 逐条列出 ID、标题、步骤、预期、所需证据层与证据引用（plugin test 文件::测试名、helper unittest id、PTY 脚本 id、静态检查项）。所有引用在每个必需版本上都通过，场景才算 pass；引用不存在算 missing，被跳过算 skipped，缺一层证据也算 missing，均判失败。报告同时输出 JSON 与 Markdown。
- **Q6 报告位置**：每次运行输出到 gitignore 的目录；发布时把 `report.json`、`report.md` 和脱敏 trace 一起提交到 `release/evidence/<插件版本>/`。
- **Q7 扫描范围**：扫描隔离 HOME、项目、plugin data、TMPDIR、脚本 stdout/stderr、trace 与报告里的每个文件。允许清单只有两类：档案 SQLite 族（db、wal、shm、迁移备份、Quarantined Archive），以及 Claude Code 自己的对话数据（transcript jsonl、`history.jsonl` 等）。允许清单写进报告；`$.store` 落盘文件不在允许清单内。argv 的证据为 plugin test 断言每次 `process.run` 的 argv 不含标记，外加 PTY 期间定时 `ps -axww` 采样。不开 `--debug`。
- **Q8 标记与脱敏**：标记为「128 位随机 hex + 场景 ID」，随机部分在前。扫描与脱敏同时匹配完整标记和随机部分任意 ≥12 字符的前缀（UI 截断会留下前缀），写盘前替换为 `<marker:N>`。
- **Q9 人工证据**：不接受真人目视确认；所有 MUST 由本次运行自动产生证据。以往各票手动完成的 PTY 不计入报告。
- **Q10 入口**：新增 `scripts/release-evidence.sh` 作为唯一发布门禁，依次运行 verify-startup（含两个版本的 plugin tests）、benchmark、PTY 套件、隐私扫描，再生成报告；非零缺失、零跳过、零泄漏即非零退出。`verify-startup.sh` 保持为快速开发门禁。
- **Q11 拆票**：31 含 `PT-COMPAT-001` 与 `PT-CAPTURE-001..008` 的 PTY。36 生命周期与 Run 身份（LIFE-001..004、STORE-001）；37 分支与跳转（BRANCH-001..004、JUMP-001..002）；38 时间线 UI（UI-001..008）；39 兼容与故障（COMPAT-002/003/005、STORE-002/003/006/008/009、FAIL-001..006）；40 控制、删除与安全（CONTROL、DELETE、SEC）；41 正式运行 0.1.0 发布门禁并提交证据（依赖 36–40）。
- **Q12 被测插件**：PTY 一律 `--plugin-dir` 直接加载生产插件根，hook 代码在任何场景都不改。故障只从外部注入（权限、`chflags`、写坏数据库、sqlite3 占锁）；helper 制品类故障用临时插件副本替换 helper，副本 hooks 与原件逐字节一致，报告写明副本和改动。只能改代码才能造出的故障（plugin 崩溃）按契约由 plugin test 与 helper 证明。
- **Q13 trace**：只保存终端模拟后的屏幕快照（每个断言点一份，含文字和必要的颜色属性），脱敏后写盘；原始字节流从不落盘。
- **Q14 plugin test 对应**：清单按「文件::测试名」精确引用现有测试，不给测试名加场景 ID。改名后引用对不上即判 missing。
- **Q15 运行方式**：场景顺序执行、不并行。允许 `--only <ID>` 局部运行，但局部运行的报告标为 `partial`、整体判失败，不能作为发布证据。
- **Q16 pyte**：入口脚本首次运行时在 `~/.cache/prompt-trail-release/venv` 建 venv，以 `--require-hashes` 安装钉死版本的 pyte；报告记录其版本。建 venv 需要联网，属于开发工具链，不受插件「不得联网」约束。
- **Q17 README 与 status**：新建中文 `mods/prompt-trail/README.md`，写明支持矩阵、不支持的平台、Marketplace 边界、焦点/Esc/滚轮/槽位限制、删除边界，以及移除 `--plugin-dir` 前的清理步骤（各项目先 `/prompt-history clear-all`，再删插件数据目录）。`status` 只加一行列出这些边界的名称并指向 README。
- **Q18 隔离环境**：每个场景新建临时 HOME、`CLAUDE_CONFIG_DIR`、项目目录与 TMPDIR；onboarding 与项目信任用预写 `.claude.json` 跳过。插件数据目录是否随 `CLAUDE_CONFIG_DIR` 隔离要先实测，不会则显式隔离，绝不写入使用者真实的插件数据目录。
- **Q19 token 来源**：使用者用 `security add-generic-password -s prompt-trail-release -a "$USER" -w` 把 token 存进钥匙串的专用条目，脚本只读这一条。
- **Q20 提交绑定**：报告记录当前提交 SHA；工作树不干净时照常生成报告，但整体判失败。
