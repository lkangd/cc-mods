# 25: View filter、三种 Layout 与键盘

**What to build:** 使用者能用「全部 / 用户 / Agent」过滤目录，在卡片、紧凑、时间轴三种 Layout 之间切换，两个选择都跨会话记住；焦点在 Pane 内时全程可用键盘操作。

规格见 [chat-toc MVP](../spec.md) §7。

**Blocked by:** 19（完整的开组规则与 Agent reply）

**Status:** ready-for-agent

- [ ] 过滤行左边三个 `plain` Button `●全部`/`○用户`/`○Agent`，热键 1/2/3，切换后立即重画；选「Agent」时只有用户侧的组整组隐藏
- [ ] 过滤行右端「布局:<当前 Layout>」按钮，点击或按 `l` 按卡片 → 紧凑 → 时间轴循环；最右留约 3 列给 2.1.287 的 ✕
- [ ] 紧凑：每侧一行、Agent 行整行 `dimColor`、青色 `●` 高亮；时间轴：左栏 8 列 `HH:MM`+`│`、高亮变青色 `┃`、Agent 行整行 `dimColor`；左栏在 Button 外的 `Text` 里，两版都对齐
- [ ] 高亮不加粗，只靠青色标记
- [ ] View filter 与 Layout 写进 `$.store`，跨进程记住；写入失败本次仍切换；值认不出时回到「全部」与卡片（CT-UI-001、CT-UI-002）
- [ ] 切换 Layout 时以选中组为锚（Current position 已落地时，无选择光标则以它所在组为锚），锚定组留在可见窗口内，跟随或暂停状态不变；只改绘制，不改显示哪些条目
- [ ] ↑↓ 走宿主焦点环、焦点落在条目第一行 Button，不跳过淡化条目；Enter 与点击相同（CT-UI-003）
- [ ] 36、44、56 列宽下三种 Layout 都可读，两个版本截屏存档供人工目检
