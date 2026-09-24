# 21: 连续浏览 100,000 个 Timeline Events

**What to build:** 让使用者在不分页、不全量加载的前提下连续浏览大型 Project Timeline，并在新事件到达时保持可预测的位置。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** claimed

- [ ] helper range protocol 按项目 sequence 严格升序返回，并强制固定最大批次；调用方不能请求无界全表读取。
- [ ] AbovePrompt 使用有界渲染窗口和一条更早事件作为 overscan，不随遍历无限累积已渲染节点。
- [ ] 最早可见 Prompt Entry 获得焦点时加载上一批，并保留同一个 keyed Button，使上箭头连续跨批次。
- [ ] 使用者只靠方向键即可从最新事件连续到达 Project Timeline 起点，再返回末尾；UI 不显示页码。
- [ ] Timeline Events 按 sequence 从旧到新显示，时间戳不参与排序；Prompt、Run、Clear、Collection、branch 和 Gap 边界保持正确相对位置。
- [ ] 位于底部时新 Prompt Entry 自动跟随；查看旧历史时位置不变并累计新条目提示，返回底部后提示清零。
- [ ] 构造包含多种边界和分支的 100,000-event fixture，证明查询和渲染均不全量载入。
- [ ] 在记录硬件和版本的参考机器上预热一次后重复十次，展开、加载下一批和显示新条目的 p95 各不超过 1 秒。
- [ ] plugin test 验证窗口、key 和位置状态；helper benchmark 验证 range；真实 PTY 验证连续键盘体验与新条目行为。

## Comments

### 实现层面对齐（2026-09-24）

- **helper range 协议**：扩展 `timeline-read`，不新增子命令；argv 末尾依次为可选游标 `before <sequence>` / `after <sequence>`（缺省读最新一批）与 `<tip event id|->`。批次固定 128，调用方不能放宽；多读的一条作为 overscan 画出，不再丢弃。响应以 `earlier`/`later` 取代 `truncated`，并带本批首行之前的 Prompt Entry 数（项目级序数的起点）。`HELPER_PROTOCOL` 不升级。
- **窗口上下文**（只含 id、sequence、序数，不含原文，均有界、按需查询）：`path` 为 tip 祖先链落在窗口内的 event id 与本 Run 在链上最早的 sequence；`parents` 为窗口内 Prompt Entry 在窗口外的父节点 `{eventId, runId, sequence, ordinal}`；`origins` 为窗口内每个 `run-started` 所在 segment 最早的持有 Run。它们分别解决 backlog `bounded-persisted-timeline-view` 的 Issue 18 review #2（b）、Issue 19 review #2 与 Issue 32 review #13/#14（c、d）、Issue 20 review #2（e）。
- **`capture-confirm`** 响应增加 `ordinal`。
- **显示序号**：改为项目级 Prompt Entry 序数（项目第一条为 1），**推翻 Issue 12 的「会话级、从 1 开始」**：窗口滑动后序号必须稳定。
- **可聚焦行**：Prompt Entry 改画 `Button plain`，本票 `onPress` 无动作（Issue 22 接跳转）；边界与说明行仍是 `Text`，方向键跳过它们。
- **有界窗口**：内存与绘制同为最多 2 批（256 条）加 1 条 overscan；向一端加载超限时淘汰另一端的一批，窗口可以不含最新事件。
- **加载触发**：`ui.focus`（origin person）落到窗口最早（或窗口不含最新事件时的最晚）画出的 Prompt Entry 时读相邻一批，keyed Button 不变，焦点留在原处；加载中重复触发由守卫合并。
- **底部跟随**：「在底部」= 窗口含最新事件且 `scroll.offset + bodyRows >= contentRows`。展开总是回到最新一批并滚到末尾。在底部时追加并滚到末尾；不在底部时位置不变，标题显示「N 条新条目」，列表末尾一个 Button「↓ N 条新条目」读最新一批并滚到末尾；回到底部清零。只计本进程采集的 Prompt Entry，并发 Run 的事件归 Issue 24。
- **缺口防护**：本进程追加的 sequence 不等于窗口末尾 + 1 时，在底部重读最新一批，不在底部只计数，窗口里不出现看不见的缺口。
- **`branch-match` 开销**（backlog `branch-match-repeated-prompt-cost`，f）：改为自顶向下带备忘的匹配（每条目最早嵌入位置，按文本的有序位置表加二分），`lineage_winner()` 改用并列集合；独立提交。
- **不做**：跨窗口的折叠计数与展开（a），追加回 backlog；本票折叠只统计窗口内成员。
- **验证**：测试专用的 Python fixture 构造器按 schema 在一个事务里直接写入 100,000 条混合事件；`helper_protocol.py` 加约 1,000 条的双向逐批遍历用例；plugin test 验证窗口、key、位置状态；`scripts/benchmark-timeline.sh` 不进默认门禁，记录硬件与版本，预热 1 次、重复 10 次，给出展开、加载下一批、显示新条目三项 p95，结果写入 Answer。Integrity gap 事件要到 Issue 26 才存在，fixture 暂缺 Gap 边界，如实记为缺口。真人 PTY 验收连续键盘体验与新条目行为，并补测 Issue 20 的「选定后马上按 Esc」。
- **提交拆分**：helper range 与上下文加 fixture；`branch-match` 重写；插件窗口与交互；最后一个 resolve 提交。
