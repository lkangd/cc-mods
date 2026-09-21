# 18: 在 resume 与 fork 中重建 Conversation Branch

**What to build:** 让 resume 会话续接唯一共享前缀，让后台和 CLI fork 建立新的 Run 与 Conversation Branch，同时保留共享历史且不重复归档。

**Blocked by:** 13「严格匹配人类 composer 提交」、17「跨 reload 与重启维护 Run 身份」

**Status:** ready-for-agent

- [ ] resume 进程创建新 Run，并使用启动 source、classic session ID、已归档 Active Branch 与完整有序共享前缀确定唯一父节点。
- [ ] resume 重放的共享 UserMessage 只重新绑定运行时状态，不创建重复 Prompt Entries。
- [ ] 后台 `/fork` 和 `--fork-session` 均创建新 Run、新 classic session 身份和新的 Conversation Branch。
- [ ] fork 的共享前缀保持原事件身份；fork 参数若以成功的 composer submission 进入，则记录为新 Prompt Entry。
- [ ] 内部 task notification 即使出现在 transcript 中也不参与人类 prompt 前缀或产生 Prompt Entry。
- [ ] 匹配使用完整有序前缀而非最后一条文本，因此正常重复 prompt 可区分。
- [ ] 无唯一候选时不猜测续接；状态进入待人工父节点确认，并保留所有旧分支。
- [ ] 时间线显示 Run 和 Conversation Branch 边界，并保持共享前缀只出现一次。
- [ ] plugin test 使用记录的 resume/fork 事件序列验证状态转换；真实 PTY 覆盖 resume、后台 fork、CLI fork 与重复文本前缀。
