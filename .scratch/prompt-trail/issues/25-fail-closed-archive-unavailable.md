# 25: Archive unavailable 时失败关闭

**What to build:** 当 Prompt Trail 无法证明新 Prompt Entry 可正确保存时，阻止当前提交、保留草稿并提供明确恢复选择，而不是静默漏记、无限等待或退化到内存时间线。

**Blocked by:** 15「对账中断的 Pending Capture」、24「隔离项目并支持并发 Run」

**Status:** ready-for-agent

- [ ] SQLite busy 使用有界退避且总自动等待不超过 10 秒；超时进入 Archive unavailable，不在后台无限重试。
- [ ] 可用空间低于 1 GiB 时每个 Run 只警告一次；实际 `ENOSPC` 完整回滚，不产生半事件或丢失 Pending Capture。
- [ ] 只读目录、权限异常、locator/helper 启动失败、运行中 helper 消失或摘要变化均形成明确、非敏感的失败状态。
- [ ] Run-local locator/helper 故障只阻止受影响 Run；共享档案故障会让使用同一 Archive generation 的所有 Run 在下一次操作时停止写入。
- [ ] 已启用 Run 在 Archive unavailable 下 drop composer submission 并原样保留草稿，不允许 Claude Code 对话静默领先于档案。
- [ ] 使用者只可选择“重试”或“明确禁用当前 Run 后继续”；禁用写 Collection Boundary，且不得声称禁用区间完整。
- [ ] 重试成功后恢复原 Run 和 Active Branch，不重复 Pending Capture 或 Prompt Entry。
- [ ] `status` 在所有失败状态下可用，只显示作用范围、错误类别、必要路径和非敏感 ID。
- [ ] 任一失败路径都不截断、轮转、自动删除、联网、热切换 helper 或启用无持久化 fallback。
- [ ] helper fault injection、plugin test 与真实 PTY 分别覆盖 busy、ENOSPC、权限、helper/locator 失效、重试和禁用后继续。
