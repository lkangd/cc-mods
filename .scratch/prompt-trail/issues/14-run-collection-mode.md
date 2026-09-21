# 14: 切换 Run collection mode

**What to build:** 让已授予 Collection consent 的使用者独立控制当前 Run 是否采集，并在时间线上看见真实的开始、停止和恢复边界，而不影响旧数据或其他 Run。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** ready-for-agent

- [ ] `/prompt-history enable` 只在项目已 consent 且 preflight 健康时启用当前 Run；控制命令本身不创建 Prompt Entry。
- [ ] `/prompt-history disable` 只停止当前 Run 的后续采集，不删除旧 Prompt Entries、不撤销 Collection consent。
- [ ] disabled 期间的 composer submission 正常进入 Claude Code，但不创建 Pending Capture 或 Prompt Entry。
- [ ] disable 和重新 enable 分别写入明确的 Collection Boundary，禁用区间不会被显示为完整历史。
- [ ] 重新 enable 从新的根 Conversation Branch 开始，不补录禁用期间的 prompt。
- [ ] `status` 始终准确显示 Collection consent、policy version、当前 Run collection mode 和最近 Collection Boundary，且不显示 prompt。
- [ ] 未 consent 项目运行 enable 时先进入 consent 流程；不受支持或不健康环境不能呈现为成功启用。
- [ ] 一个 Run 的 enable/disable 不修改其他 Run 的模式；并发隔离将在后续双 Run 场景中端到端复验。
- [ ] reload 后当前 Run collection mode 与边界状态保持，普通进程重启按新 Run 的默认模式处理。
- [ ] plugin test、helper semantic test 与真实 PTY 覆盖 enable、disable、重新 enable、disabled submission 和无补录行为。
