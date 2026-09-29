# 40: 以真实 PTY 证明控制、删除与安全场景

**What to build:** 为 `PT-CONTROL-001..002`、`PT-DELETE-001..004` 与 `PT-SEC-001..004` 编写自动化 PTY 场景，与既有 plugin test、helper 证据共同构成三层覆盖。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** ready-for-agent

- [ ] `status`、enable/disable、`clear-run`、`clear-all`、无数据与残留、删除边界告知均有 PTY 场景。
- [ ] 私有权限在创建、迁移、隔离、清除和异常恢复后由 PTY 场景复核。
- [ ] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。
