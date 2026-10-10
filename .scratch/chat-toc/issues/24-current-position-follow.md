# 24: Current position 高亮与 TOC 跟随

**What to build:** 目录用青色高亮使用者正在看的那一轮，并自动滚到它；跳转后高亮锁在目标组直到视口再次变化；手动翻目录时暂停跟随并显示「暂停」，下一次 transcript 视口变化时恢复；在后台标签时不画，回到前台第一帧就跟上。

规格见 [chat-toc MVP](../spec.md) §6、§2（共存）。

**Blocked by:** 23（完整跳转：Agent 侧、兜底与被拒）

**Status:** ready-for-agent

- [ ] 只看 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolGroup` 的在屏上报；报 `null` 的记录直接删掉；可绘制行有序数组只在读完和新行画出时重建
- [ ] 在屏行按对话顺序分段，只采信包含最近一次上报的那一段、取最靠前的行，归到所属组（不属于任何组时归前一组）；夹没夹着不在屏的可绘制行用二分查找判断
- [ ] 最后一个画出的行完整可见时强制末组；跳转成功后锁定目标组，跳转引起的重绘停下后视口第一次变化就解锁（CT-POS-001）
- [ ] 连续滚轮 180 格后，高亮与屏幕第 1 行所属的组一致（CT-POS-002）
- [ ] transcript render hook 只在值真变时用 `$.clock.after(0, …)` 写 `$.state` atom，Pane 读它重画；不在 render hook 里直接写、不用 `Promise.then`、不无条件 invalidate
- [ ] TOC 跟随高亮；手动滚动 TOC 或 Pane 聚焦时暂停，底栏显示「暂停」；Current position 下一次变化时恢复（CT-POS-003）；滚动由插件自管，不用 `$.ui.scroll({ to: "end" })`
- [ ] 不在前台（`isShown === false`）时 Current position 变了就撤销暂停，回到前台第一帧即跟随（CT-COEX-001）
- [ ] 热重载后映射在读完 transcript 后重建，跳转与高亮仍正确（CT-LIFE-006）
- [ ] 高亮与 ↑↓ 选择光标独立绘制
- [ ] 若「View filter、三种 Layout 与键盘」已完成，补上「无选择光标时 Layout 切换以 Current position 所在组为锚」
- [ ] 自动化测试覆盖连续段算法；PTY 验收上述场景在两个版本上通过
