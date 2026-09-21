# 26: 记录并闭合 Integrity gap

**What to build:** 当宿主级 fail-open 或不可阻止 lifecycle 写入使完整性无法证明时，留下永久可见的 Integrity gap；恢复正确采集后开始新的可验证区间而不改写历史。

**Blocked by:** 16「以 Clear Boundary 划分 Conversation Segment」、17「跨 reload 与重启维护 Run 身份」、25「Archive unavailable 时失败关闭」

**Status:** ready-for-agent

- [ ] Run、Clear 等不可阻止 lifecycle 事件写入失败时，使用不含 prompt 原文的小型恢复队列和幂等 ID。
- [ ] 下一次 composer submission 前必须先清空 lifecycle 恢复队列；能唯一恢复的事件保持原语义且不重复。
- [ ] plugin 崩溃导致 prompt 被宿主放行后，恢复流程结合 transcript、Pending Capture、Run/Segment 身份和活动前缀进行对账。
- [ ] 无法唯一证明 Timeline Events 与 Claude Code 对话一致时，写入显著、不可变的 Integrity gap，而不是静默忽略或猜测。
- [ ] Integrity gap 与 disabled Collection interval、Archive unavailable 和 Clear Boundary 在模型、UI 与 `status` 中保持不同含义。
- [ ] 正确采集恢复后写 Integrity recovery boundary；当前健康可回到 healthy，但历史 Gap 永久保留且跨 Gap 历史不得称为完整。
- [ ] timeline 按 sequence 显示 Gap 开始与恢复边界，并允许浏览其前后 Prompt Entries。
- [ ] 重复恢复、reload 或重启不会重复 Gap/恢复边界，也不会删除原 Gap。
- [ ] plugin test 注入 hook crash 与 lifecycle 写失败；真实 PTY 验证 fail-open 恢复、可见边界和 `status` 表达。
