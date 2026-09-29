# 36: 以真实 PTY 证明生命周期与 Run 身份场景

**What to build:** 在 Issue 31 的 PTY 驱动器与场景清单上，为 `PT-LIFE-001..004` 与 `PT-STORE-001` 编写自动化 PTY 场景，使它们在 `2.1.273` 与当前发布验收版本上都产出可复核证据。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** ready-for-agent

- [ ] `/clear`、compaction、plugin reload、正常退出与普通重启、重启延续各有 PTY 场景，断言只依据屏幕快照与 semantic verifier。
- [ ] 每个场景在隔离环境中运行，使用合成标记，trace 写盘前脱敏。
- [ ] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。
