# 27: 长会话性能

**What to build:** 20 MB 级的长会话里，目录几秒内出现，滚动、跳转、重画都不卡，连续滚动能到达首尾、不分页。

规格见 [chat-toc MVP](../spec.md) §7（长会话）、§9。

**Blocked by:** 22（大文件分块与增量读取）、24（Current position 高亮与 TOC 跟随）、25（View filter、三种 Layout 与键盘）

**Status:** resolved

- [x] 条目按组缓存（键：宽度、进行中、步数、状态、末段），只在数据、宽度、View filter、Layout 变化时重建条目表；高亮与光标绘制时叠加；只画可见窗口；组到条目的定位用表
- [x] 用 20 MiB 的 many 与 heavy fixture，在 2.1.287 与当前版本各跑 3 次，p95 满足：首次出目录 ≤4 s、空闲整份读取加重组 ≤1 s、增量单次 ≤150 ms、追加一行到模型更新 ≤1 s、Pane 自身 ≤16 ms、含宿主 ≤100 ms、Current position ≤2 ms（3000 条残留 ≤5 ms）
- [x] 长会话连续滚动、跳转能到达首组和末组，不分页（CT-PERF-001）
- [x] 结果写成可进入发布报告的表

## Comments

2026-10-11，分支 `chat-toc/27-perf`（基于 `chat-toc/mvp` c4dccaa）。

- **条目表**（`hooks/table.ts`）：每组的条目按开组行缓存，键是组的位置、是否进行中、步数、结局、末段、用户侧文字（宽度、View filter、Layout、年份变了整份作废）。条目表（条目、高度、key 与反查表、每组起始条目）只在组数组、宽度、过滤、Layout、进行中变化时更新；文件只增长时只把末尾几组摘下重排（4432 组时 0.05 ms），整份重组后同样的组复用旧条目。register 的 Pane 绘制改用表：`entryOfGroup` 查表代替 `firstEntryFrom` 二分，高度、key 表不再每次重算；高亮与焦点仍在绘制时叠加，只画可见窗口。原先每次绘制都 `entriesOf` 全部条目，many 形状要 18–35 ms。
- **计时**（`hooks/perf.ts`）：只在环境变量 `CHAT_TOC_PERF` 有值时采样，每秒最多一批，以 `chat-toc-perf {...}` 行经 `$.ui.log(..., { to: 'debug' })` 写进宿主 debug 日志（宿主约 1 万字符截断一行，所以每行 ≤ 4000 字符）。样本只有数字，测试与拷贝证据时都核对过（CT-SEC-001）。不设变量时不量不写；`validate` 的 env reads 因此多了 `CHAT_TOC_PERF`，calls 多了 `ui.log`。
- **24 号提的残留在屏记录**：真实操作里最多 30 条（many，1500 格快速滚动），3000 条只能合成：在插件运行环境里 p95 0.31–0.34 ms（≤ 5 ms），没改 Current position 的算法。
- **结果表**：`mods/chat-toc/release/ct-perf-001.md`，29 号直接贴进 report.md；运行记录在 `.scratch/chat-toc/assets/27-perf/runs/`。两版 × 两种 fixture × 3 次全部通过：首次出目录比 transcript 晚 0.53–0.77 s，空闲整份读取 195–375 ms，增量读取 p95 26–111 ms，追加到模型 347–514 ms，Pane 自身 p95 ≤ 0.38 ms、含宿主 ≤ 8.7 ms，Current position p95 ≤ 0.03 ms；首组、末组都由连续滚动和点击到达。
- **已知的长尾**：读完文件后的第一次绘制要建整张表，many 55–61 ms（p95 不受影响）；热重载后的第一次增量读取约 100 ms 花在第一次 `$.process.run`。都在阈值内，没再优化。
- **28 号文档**：`mods/chat-toc/README.md` 补了 CT-PERF-001 的命令、`CHAT_TOC_PERF`、目录结构里的 `table.ts`/`position.ts`/`perf.ts`；根 README 草稿「已知限制」那句补了参考机器上的结论；「也能跳到很早、从没显示过的轮次」在 4521 轮的会话上再次验证，不用改。
- PTY 驱动：`tests/acceptance/perf_scenarios.py run <host> <many|heavy> --runs 3`，`table <运行目录>...` 出表；合成部分在 `tests/long_session.test.ts`。
