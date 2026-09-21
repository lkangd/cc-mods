# 20: 人工确认歧义父节点

**What to build:** 当 transcript 无法唯一映射到历史分支时，阻止本次提交并让使用者在聚焦 Pane 中选择父 Prompt Entry 或新根，然后恢复原草稿等待再次提交。

**Blocked by:** 15「对账中断的 Pending Capture」、19「rewind 后建立新 Conversation Branch」

**Status:** ready-for-agent

- [ ] 多个历史分支具有相同前缀、内部 `user` row 冲突或 transcript 无法唯一映射时，插件不自动选择父节点。
- [ ] 首次歧义 composer submission 被 drop，完整草稿只保存在当前进程内存，不写入日志、locator 或诊断。
- [ ] 插件打开 `focus: true` 的 Pane，列出可区分的候选父 Prompt Entries 与“新根分支”，且不展示不必要的完整敏感文本。
- [ ] Pane 初始取得焦点，方向键、Enter、鼠标 hover/点击都能选择候选。
- [ ] 确认后先关闭 Pane，再通过 `$.prompt.fill()` 原样恢复草稿；插件绝不自动重提。
- [ ] 未选择、取消或再次尝试提交时保持阻止状态，不能默认采用第一个候选。
- [ ] 选择候选后，下一次人工提交使用该父节点；选择新根时建立新的根 Conversation Branch。
- [ ] 确认流程与 Pending Capture 对账状态互斥且可解释，不会把被 drop 的歧义草稿误记为 Prompt Entry。
- [ ] plugin test 验证候选、焦点、取消、选择与草稿恢复；真实 PTY 证明 Pane 焦点和 `isFilled` 行为。
