# 18: 在 resume 与 fork 中重建 Conversation Branch

**What to build:** 让 resume 在续接的 Run 中按唯一共享前缀重建 Active Branch，并让时间线与会话详情一致；让后台和 CLI fork 建立新的 Run 与 Conversation Branch，同时保留共享历史且不重复归档。

**Blocked by:** 13「严格匹配人类 composer 提交」、17「跨 reload 与重启维护 Run 身份」、32「Run 谱系跨 resume 延续」

**Status:** ready-for-agent

- [ ] resume（`claude --resume`、`--continue`、会话内 `/resume`）续接 Issue 32 找回的 Run，并使用启动 source、classic session ID、已归档 Active Branch 与完整有序共享前缀确定唯一父节点；resume 目标会话 transcript 前缀的最后一条即 resume 节点。
- [ ] resume 重放的共享 UserMessage 只重新绑定运行时状态，不创建重复 Prompt Entries。
- [ ] 档案不删除任何记录。resume 节点之后、不在当前 Run 活动路径上的条目，在分叉点折叠为一行「另一分支 · N 条」，可以展开查看；其他 Run 的条目照常按 sequence 显示。
- [ ] 后台 `/fork` 和 `--fork-session` 均创建新 Run、新 classic session 身份和新的 Conversation Branch。
- [ ] fork 的共享前缀保持原事件身份；fork 参数若以成功的 composer submission 进入，则记录为新 Prompt Entry。
- [ ] 内部 task notification 即使出现在 transcript 中也不参与人类 prompt 前缀或产生 Prompt Entry。
- [ ] 匹配使用完整有序前缀而非最后一条文本，因此正常重复 prompt 可区分。
- [ ] 无唯一候选时不猜测续接；状态进入待人工父节点确认，并保留所有旧分支。
- [ ] 时间线显示 Run 和 Conversation Branch 边界，并保持共享前缀只出现一次。
- [ ] plugin test 使用记录的 resume/fork 事件序列验证状态转换；真实 PTY 覆盖进程内与跨进程 resume、后台 fork、CLI fork、重复文本前缀和分支折叠/展开。

## Comments

### 2026-09-23 · 边界对齐，拆出 Issue 32

与使用者对齐后：Run 改为会话谱系（resume 保持原 Run），这部分拆为 [Issue 32](32-run-lineage-across-resume.md) 先做，本票改为被 32 阻塞。本票保留分支重建与视图：
- 两种 resume 同样处理，都以 resume 目标会话的 transcript 前缀为准；不在该前缀上的本 Run 条目离开活动路径。
- 「对得上会话详情」由视图保证：离开活动路径的条目折叠为可展开的「另一分支 · N 条」，档案保持不可变（US28）。完整的分支浏览归 Issue 21/22。
- fork 不变。
