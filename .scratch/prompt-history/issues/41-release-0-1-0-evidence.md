# 41: 运行 0.1.0 发布门禁并提交证据

**What to build:** 在干净工作树上完整运行 `scripts/release-evidence.sh`（两个版本、全部场景、无 `--only`），得到零缺失、零跳过、零泄漏的报告，并把报告与脱敏 trace 提交到 `release/evidence/0.1.0/`。

**Blocked by:** 36、37、38、39、40

**Status:** resolved

- [x] 报告整体 pass，记录提交 SHA、平台、宿主版本、helper 摘要、SQLite 与 pyte 版本、benchmark 参考硬件与结果。
- [x] 提交的证据链接全部指向仓库中存在的文件。

## Answer

0.1.0 的发布证据在 `mods/prompt-history/release/evidence/0.1.0/`：`report.md`、`report.json`，以及报告链接到的 `logs/`（门禁输出）与 `pty/<版本>/<场景>.txt`（脱敏屏幕快照）。

- **运行**：`scripts/release-evidence.sh`，没有加 `--only` 或 `--skip-gates`，在干净工作树上从提交 `b61296e` 开始，2026-09-30 14:17–15:57 UTC（`build/evidence/20260930T141730Z/`）。
- **结果**：PASS，非局部运行。56 个场景全部通过，0 失败、0 缺失、0 跳过、0 泄漏；52 个 PTY 场景在 `2.1.273` 与 `2.1.283` 上都通过，没有一场因为宿主网络错误重跑。
- **门禁**：制品重建结果一致；两个版本的 plugin validate 通过，plugin test 各 458 项全部通过；TypeScript 通过；unittest 226 项；helper 探针与 protocol 不符探针通过；隐私扫描通过。
- **身份**：MacBookPro18,3（Apple M1 Pro，32 GiB）、macOS 15.8 arm64、helper `d6dafd18…d31a`、bridge `728b2419…c832`、SQLite 3043002、Python 3.14.3、pyte 0.8.2，function hooks 由 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 开启。
- **100k benchmark**（预热 1 次，重复 10 次）：p95 展开 51.6 ms、加载下一批 49.3 ms、显示新条目 119.9 ms，都低于 1 秒。
- **隐私**：扫描 42533 个文件，其中 673 个在允许清单内；argv 采样 1059 次；都没有标记或 token。
- **提交的证据与原始输出不同的地方**（使用者决定）：提交前把本机路径换成了占位符：仓库根换成 `<repo>`，HOME 换成 `<home>`，TMPDIR（含 `/private` 前缀，以及终端在屏幕边缘截断的部分）换成 `<tmp>`。其余内容与门禁输出逐字一致，行数不变。替换后，报告里的 114 个链接都指向存在的文件，也不再有用户名或 TMPDIR 前缀。
