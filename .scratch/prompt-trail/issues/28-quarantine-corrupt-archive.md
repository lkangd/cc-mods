# 28: 隔离损坏的 Archive generation

**What to build:** 当一个 Archive generation 损坏时，停止受影响项目的写入并原样保留证据，让使用者选择复检、隔离后重新开始或强确认清除，而不自动修复或覆盖。

**Blocked by:** 27「安全迁移档案 schema」

**Status:** ready-for-agent

- [ ] 检出损坏后立即停止受影响 Archive generation 的所有 Run 写入，并保留原数据库及相关文件不变。
- [ ] 损坏只影响对应 Project Timeline；其他项目数据库继续健康工作。
- [ ] `status` 显示共享故障范围、generation、非敏感检查结果和可采取动作，不显示 prompt。
- [ ] “重试完整性检查”不会修改文件；检查成功前不得恢复写入。
- [ ] “隔离并开始新 generation”把原文件及相关敏感副本以私有权限保留为 Quarantined Archive，并创建空的新 generation。
- [ ] Quarantined Archive 不参与后续 append、range read 或自动迁移，也不被自动修复、覆盖或删除。
- [ ] 存在无法安全打开的 Quarantined Archive 时，`clear-run` 必须拒绝声称完整按 Run 删除。
- [ ] 强确认清除路径交由项目级清除语义处理，并在成功前保持 Archive unavailable。
- [ ] 多 Run 同时发现同一损坏时只完成一次 generation 状态转换，不创建多个隔离副本。
- [ ] helper fault tests 与双 Run 集成场景验证原文件字节不变、项目隔离、幂等隔离和新 generation 可用。
