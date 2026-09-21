# 27: 安全迁移档案 schema

**What to build:** 让已存在的 Project Timeline 在已知 schema 升级中保持原文、事件顺序和可恢复性，并对空间不足、迁移中断或过高版本明确失败关闭。

**Blocked by:** 25「Archive unavailable 时失败关闭」

**Status:** ready-for-agent

- [ ] helper manifest 明确声明可读写 schema 范围；高于支持版本的档案直接拒绝打开，不猜测降级。
- [ ] 迁移前执行完整性检查和可用空间检查；任一失败都不修改活动数据库。
- [ ] 迁移备份位于同目录、采用相同私有 owner/权限，并被视为含完整敏感原文的档案。
- [ ] 已知升级在事务中完成，保留 Prompt Entries、Timeline Event 身份、sequence、Run/Segment/Branch 关系和 Archive generation。
- [ ] 迁移中断或验证失败时，活动档案可恢复到迁移前状态且不会同时接受旧、新 schema writer。
- [ ] 迁移后执行完整性与语义复检；只有下一次成功打开后才删除备份。
- [ ] 空间不足、busy、只读、权限异常和 backup 清理失败均进入准确的 Archive unavailable 状态。
- [ ] 新 helper 只执行 manifest 中的单向迁移；旧 helper 遇到更高 schema 时保持拒绝，不热切换制品。
- [ ] helper black-box tests 使用旧 schema fixtures、故障点和 marker 验证原文/事件不变、回滚、权限和备份生命周期；测试不依赖当前生产表布局。
