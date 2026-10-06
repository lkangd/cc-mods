# 54: 运行 0.2.0 发布门禁并提交证据

**What to build:** 插件升到 0.2.0（最低宿主 2.1.290，成员资格以宿主存储行为准）。在干净工作树上完整运行 `scripts/release-evidence.sh`，得到零失败、零缺失、零跳过、零泄漏的报告，并把报告与脱敏 trace 提交到 `release/evidence/0.2.0/`。

**Blocked by:** 35、53

**Type:** task

**Status:** resolved

- [x] 报告整体 pass，记录提交 SHA、平台、宿主版本、helper 摘要、SQLite 与 pyte 版本、benchmark 参考硬件与结果。
- [x] 提交的证据链接全部指向仓库中存在的文件。

## Answer

0.2.0 的发布证据在 `mods/prompt-trail/release/evidence/0.2.0/`：`report.md`、`report.json`、`logs/` 与 `pty/2.1.290/<场景>.txt`。

- **运行**：`scripts/release-evidence.sh`，不带 `--only` 或 `--skip-gates`。在提交 `a68b4f5` 的干净工作树上运行，2026-10-06 09:30 UTC 开始（`build/evidence/20261006T093016Z/`）。
- **结果**：PASS，完整运行。56 个场景全部通过，0 失败、0 缺失、0 跳过、0 泄漏；52 个 PTY 场景在 `2.1.290` 上通过，最低版本与当前版本都是 2.1.290，所以只跑一遍。
- **门禁**：制品重建一致；plugin validate 通过；plugin test 503/503；TypeScript 5.9.3 通过；unittest 258 项；helper 探针与 protocol 不符探针通过；隐私扫描通过。
- **身份**：MacBookPro18,3（Apple M1 Pro，32 GiB）、macOS 15.8 arm64；helper `1d0ebafc…d6c0`、bridge `41cd158b…aad3`；SQLite 3043002、Python 3.14.8、pyte 0.8.2；function hooks 由 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 开启。
- **100k benchmark**：预热 1 次、重复 10 次。p95：展开 50.8 ms，加载下一批 51.1 ms，显示新条目 93.7 ms，都低于 1 秒。
- **隐私**：扫描 26596 个文件，其中 342 个在允许清单内；argv 采样 565 次；都没有标记或 token。
- **提交的证据与原始输出的差别**：本机路径换成了占位符，仓库根为 `<repo>`，HOME 为 `<home>`，TMPDIR（含 `/private` 前缀）为 `<tmp>`。`PT-BRANCH-004.txt` 里有两处 TMPDIR 在面板边缘折成两行，替换后用空格补齐，面板边框位置不变。所有文件行数不变。替换后报告的 365 个链接都指向存在的文件，也不再含用户名或 TMPDIR 前缀。

## Comments

### 2026-10-06 · 通过前的几轮

- **第 1 次**：在 PTY 开始前停掉。2.1.290 的 `plugin test` 在真实配置下拒绝运行（rollout 开关被存成了关）。门禁改为用临时空配置目录运行 validate 和 test，与 `verify-startup.sh` 一致（`41a8266`）。
- **第 2 次**：51 通过，4 失败，1 缺失。
  - PT-COMPAT-005 是真缺陷：提交在校验 helper 摘要之前，就通过 helper 读了档案健康（Issue 53 引入），所以被换掉的 helper 先被执行了一次。已修，提交、`enable`、`disable` 都改为先校验、再读健康（`68b1b3d`）。lifecycle 写入和时间线读取仍沿用之前的校验，另记 backlog `helper-trust-reused-outside-submissions`。
  - PT-UI-007：2.1.290 的 `bodyColumns` 扣掉了 `[-]` 占的 5 列，Button 标签过宽时折行，不再截断。门槛改为“band 所在栏宽 28 列”，标签按宽度截断（`68b1b3d`）。
  - PT-SEC-003、PT-STORE-006 是场景过时：Issue 53 之后，旧档案先要求完整复检；损坏在预写时就会拦下提交。缺失的 1 个是 `scenarios.json` 引用了已改名的测试（`7fd60f6`）。
- **定向重跑**：4 个场景（`--skip-gates --only`）中 3 个通过。PT-STORE-006 又单独跑了三次：按 transcript 行数判断“放行一次”不可靠，被拦下的 prompt 留下 3 行带标记的 transcript，普通提交只有 1 行。检查改为数非 meta 的 user 行（`1698009`、`a68b4f5`），第三次单独运行通过。
- **第 3 次完整运行**：PASS，见上方 Answer。
