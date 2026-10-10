# 27: 长会话性能

**What to build:** 20 MB 级的长会话里，目录几秒内出现，滚动、跳转、重画都不卡，连续滚动能到达首尾、不分页。

规格见 [chat-toc MVP](../spec.md) §7（长会话）、§9。

**Blocked by:** 22（大文件分块与增量读取）、24（Current position 高亮与 TOC 跟随）、25（View filter、三种 Layout 与键盘）

**Status:** ready-for-agent

- [ ] 条目按组缓存（键：宽度、进行中、步数、状态、末段），只在数据、宽度、View filter、Layout 变化时重建条目表；高亮与光标绘制时叠加；只画可见窗口；组到条目的定位用表
- [ ] 用 20 MiB 的 many 与 heavy fixture，在 2.1.287 与当前版本各跑 3 次，p95 满足：首次出目录 ≤4 s、空闲整份读取加重组 ≤1 s、增量单次 ≤150 ms、追加一行到模型更新 ≤1 s、Pane 自身 ≤16 ms、含宿主 ≤100 ms、Current position ≤2 ms（3000 条残留 ≤5 ms）
- [ ] 长会话连续滚动、跳转能到达首组和末组，不分页（CT-PERF-001）
- [ ] 结果写成可进入发布报告的表
