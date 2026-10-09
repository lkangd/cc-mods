# 决定与其他停靠 Pane 共存的行为

Type: prototype
Status: open
Blocked by: 

## Question

`cc-plugin-diff` 等其他 mod 也打开停靠 Pane 时，宿主会把它们变成标签页。在本机实测两者同时启用后，需要决定：
- 会话启动时 chat-toc 自动弹出，是否抢占前台标签；
- 另一个 Pane 关闭后，chat-toc 如何回到前台；
- 使用者关闭 chat-toc 后，与另一个 Pane 的「本会话已关闭」状态是否互相影响；
- Current position 跟随与高亮在后台标签里是否照常更新。

结论供 `CT-COEX-001` 引用。
