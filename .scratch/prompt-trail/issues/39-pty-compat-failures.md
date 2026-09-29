# 39: 以真实 PTY 证明兼容与故障场景

**What to build:** 为 `PT-COMPAT-002/003/005`、`PT-STORE-002/003/006/008/009` 与 `PT-FAIL-001..006` 编写自动化 PTY 场景。故障只从外部注入（权限、`chflags`、写坏数据库、占锁、替换临时副本中的 helper），hook 代码不改。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** ready-for-agent

- [ ] 不受支持目标、helper 不可用与进程接入版本绑定在真实宿主中验证。
- [ ] 双 Run 并发、busy、损坏、generation 竞争与项目隔离有 PTY 集成场景。
- [ ] `PT-FAIL-006` 列出的代表性真实宿主故障全部端到端覆盖；只能改代码造出的故障由 plugin test 与 helper 证明并在清单中写明。
- [ ] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。
