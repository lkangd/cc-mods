# 29: 物理清除当前 Run

**What to build:** 让使用者确认后只清除当前 Run 的 Prompt Trail 敏感数据，并准确说明其他 Run、Quarantined Archive、Claude Code 副本和物理介质不在这次删除保证内。

**Blocked by:** 14「切换 Run collection mode」、28「隔离损坏的 Archive generation」

**Status:** ready-for-agent

- [ ] 当前 Run 无目标记录时，`/prompt-history clear-run` 返回 no-op 且不询问确认。
- [ ] 有数据时先显示当前 Run、待删记录数和副本边界，并要求一次明确确认；确认文本不包含 prompt。
- [ ] 确认后删除当前 Run 的 Prompt Entries、Pending Captures、相关原文和可关联的敏感 prompt 元数据，其他 Run 数据保持不变。
- [ ] Collection consent 和当前 Run collection mode 不因 `clear-run` 改变；后续采集遵循现有模式。
- [ ] 存在无法安全打开的 Quarantined Archive 时拒绝声称完整按 Run 删除，并引导使用项目级清除。
- [ ] 删除使用 secure delete、WAL checkpoint/truncate 和必要空间回收；隔离 fixture 的 byte marker 扫描确认目标消失、其他 Run marker 保留。
- [ ] 逻辑删除完成但 WAL、备份或残留文件清理失败时，报告“逻辑删除完成、物理清除未完成”，列出残留并保持 Archive unavailable。
- [ ] 确认流程重申不会删除 Claude Code transcript/history、文件系统快照、系统/第三方备份，也不保证 SSD 物理不可恢复擦除。
- [ ] 控制命令不创建 Prompt Entry；日志、错误和删除报告不泄漏被删原文或文本哈希。
- [ ] helper black-box、plugin test 与真实 PTY 覆盖 no-op、取消、成功、其他 Run 保留、Quarantine 拒绝和部分物理失败。
