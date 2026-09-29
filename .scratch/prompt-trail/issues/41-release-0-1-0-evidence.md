# 41: 运行 0.1.0 发布门禁并提交证据

**What to build:** 在干净工作树上完整运行 `scripts/release-evidence.sh`（两个版本、全部场景、无 `--only`），得到零缺失、零跳过、零泄漏的报告，并把报告与脱敏 trace 提交到 `release/evidence/0.1.0/`。

**Blocked by:** 36、37、38、39、40

**Status:** ready-for-agent

- [ ] 报告整体 pass，记录提交 SHA、平台、宿主版本、helper 摘要、SQLite 与 pyte 版本、benchmark 参考硬件与结果。
- [ ] 提交的证据链接全部指向仓库中存在的文件。
