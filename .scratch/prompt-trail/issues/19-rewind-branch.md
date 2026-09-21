# 19: rewind 后建立新 Conversation Branch

**What to build:** 让 `/rewind` 或 Esc Esc 恢复旧对话位置后的下一次 composer submission 从正确父节点建立新 Conversation Branch，并永久保留原分支后续。

**Blocked by:** 13「严格匹配人类 composer 提交」、18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** ready-for-agent

- [ ] `/rewind` 打开或取消菜单本身不写 Timeline Event，也不被当作恢复完成信号。
- [ ] Esc Esc 没有 `command.run` 信号时，仍可在下一次 composer submission 前通过 transcript 与 Active Branch 差异识别已发生恢复。
- [ ] 唯一匹配旧位置时，新 Prompt Entry 以所选历史 Prompt Entry 为逻辑父节点并创建新 Conversation Branch。
- [ ] 原 Conversation Branch 的全部后续 Prompt Entries 保留为非活动分支，不删除、不改写、不重新排序。
- [ ] 恢复到根位置时，下一次提交建立根 Conversation Branch，而不是猜测最近同文本 Prompt Entry。
- [ ] 多个重复 prompt 通过完整有序前缀区分，不能仅比较最后文本。
- [ ] 取消 rewind/Esc Esc 菜单且 transcript 未改变时，Active Branch 和下一次提交父节点保持不变。
- [ ] 时间线显示新旧 branch 边界，并让两条分支可连续浏览。
- [ ] plugin test 覆盖唯一、根、重复与取消场景；真实 PTY 覆盖 `/rewind` 和 Esc Esc 两个入口。
