# 37: 以真实 PTY 证明分支与跳转场景

**What to build:** 为 `PT-BRANCH-001..004` 与 `PT-JUMP-001..002` 编写自动化 PTY 场景（resume、`--continue`、会话内 `/resume`、双终端并发 resume、两种 fork、rewind 与 Esc Esc、父节点歧义、有效与失效 Jump Target），在两个版本上产出证据。

**Blocked by:** 31「生成零跳过发布证据」

**Status:** ready-for-agent

- [ ] 每个场景 ID 有 PTY 脚本，鼠标激活用 SGR 序列、键盘激活用按键。
- [ ] 歧义场景验证 drop、候选 Pane、草稿恢复且不自动重提。
- [ ] 场景清单引用新 PTY 脚本，报告中这些场景在两个版本上都判为 pass。
