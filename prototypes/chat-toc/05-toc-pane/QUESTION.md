# 原型验证停靠 TOC Pane 的外观与交互

Type: prototype
Status: claimed
Blocked by: 01, 02, 03, 04, 08, 09, 10, 11

## Question

在真实终端里做一个粗糙的 chat-toc Pane，验证：Turn group 卡片的排版（「你 · 时间」、2 行截断、「N 步」与状态）在常见停靠宽度下是否可读；三态 View filter 的样式与点击/键盘操作；点击与 Enter 跳转是否落到正确行；Current position 高亮与 ↑↓ 选择光标的样式能否一眼区分、TOC 跟随高亮滚动与手动滚动暂停的手感；自动弹出、关闭后保持关闭、`/chat-toc` 重开、宽度不足时状态栏说明；几百轮长会话的滚动是否流畅。产出可交互原型与观察记录。另请确认：「本会话已关闭」标记在 `/clear`、`/resume` 后会被宿主重置、目录会再次自动弹出，这是否可接受。另需实测（来自「决定没有 Jump target 的条目侧如何呈现与点击」）：兜底跳转用 `block: 'center'` 时，原输入行是否留在屏上；`ToolGroup` 的 `collapsed-<前缀>` 能否唯一对上 uuid，非折叠显示时是否改走 `ToolUse`，补挂后 transcript hook 多跑多少；全屏 transcript 是否虚拟化（离屏的行是否都被画出），这决定没被画出的条目能否事先淡化；淡化样式与 Pane 底部说明行的可读性。
