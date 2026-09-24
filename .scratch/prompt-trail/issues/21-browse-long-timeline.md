# 21: 连续浏览 100,000 个 Timeline Events

**What to build:** 让使用者在不分页、不全量加载的前提下连续浏览大型 Project Timeline，并在新事件到达时保持可预测的位置。

**Blocked by:** 12「同意采集并显示首个 Prompt Entry」

**Status:** resolved

- [x] helper range protocol 按项目 sequence 严格升序返回，并强制固定最大批次；调用方不能请求无界全表读取。
- [x] AbovePrompt 使用有界渲染窗口和一条更早事件作为 overscan，不随遍历无限累积已渲染节点。
- [x] 最早可见 Prompt Entry 获得焦点时加载上一批，并保留同一个 keyed Button，使上箭头连续跨批次。
- [x] 使用者只靠方向键即可从最新事件连续到达 Project Timeline 起点，再返回末尾；UI 不显示页码。
- [x] Timeline Events 按 sequence 从旧到新显示，时间戳不参与排序；Prompt、Run、Clear、Collection、branch 和 Gap 边界保持正确相对位置。
- [x] 位于底部时新 Prompt Entry 自动跟随；查看旧历史时位置不变并累计新条目提示，返回底部后提示清零。
- [x] 构造包含多种边界和分支的 100,000-event fixture，证明查询和渲染均不全量载入。
- [x] 在记录硬件和版本的参考机器上预热一次后重复十次，展开、加载下一批和显示新条目的 p95 各不超过 1 秒。
- [x] plugin test 验证窗口、key 和位置状态；helper benchmark 验证 range；真实 PTY 验证连续键盘体验与新条目行为。

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

### 实现中修订（2026-09-24）

与上面「实现层面对齐」不同的地方，都经使用者确认：

- **加载触发**：从「焦点落到窗口最早的 Prompt Entry」改为「滚动或焦点到达窗口任一端」。宿主在 band 树高于 `maxRows` 时把方向键变成 `ui.scroll`、不移动焦点，只靠焦点触发走不下去。
- **方向键**：逐条移动光标，由插件完成（`hooks/band.ts` 的 `arrowStep()`）；视图跟着光标走。
- **自己提交时跳到底部**（对齐时的 Q2）：使用者否决，维持规格：查看旧历史时位置不变、只计数。
- **视图由插件自管，标题固定**：band 只画放得下的行，视图按首行 key 锚定；加载前后视图不动，不再需要让引擎滚回原位。「底部」的定义随之改为「视图下面没有行且窗口含最新事件」，取代 `scroll.offset + bodyRows >= contentRows`。
- **`parents` 上下文**：只带 `{eventId, runId}`，不带对齐时写的 `sequence` 与 `ordinal`。视图只需要父节点的 Run；确认父节点 Pane 的序号来自 `branch-match` 的候选与 `prefer`（`e55ccda`），没有消费者需要这两项。
- **`n more` 行**：视图下面每有一行，就画一行空白占位，使树高于 band、宿主把滚动交给插件，宿主的 `n more` 于是等于窗口里视图下方的真实行数。到底时不画占位，树不超高，宿主不画 `n more`，但也收不到触控板；这时标题行右侧显示「↑ 点此向上浏览 · 底部不响应触控板」，点一下向上翻一页。使用者明确拒绝了常驻的假计数（例如一直显示「2 more」）。

## Answer

大型 Project Timeline 可以连续浏览：helper 按游标固定批次读取，插件只持有有界窗口、只画放得下的行，标题固定，方向键和触控板都能从最新事件走到项目起点再回来，不显示页码。实现分四个提交：`1396e5f`（helper range 与窗口上下文、fixture、benchmark）、`e55ccda`（`branch-match` 改为内存里自顶向下匹配）、`51c8420`（有界窗口与交互）、`95cab6a`（插件自管视图、固定标题）。与对齐结论不同的地方见上方「实现中修订」。

- **读取**：`timeline-read` 接受 `before|after <sequence>` 游标，批次在 helper 内固定 128，另多读一条作为 overscan；`earlier`/`later` 取代 `truncated`。批次附带只含 id、sequence、序数的窗口上下文 `path`、`parents`、`origins`，`capture-confirm` 回 `ordinal`。
- **窗口**：内存最多两批加一条 overscan（257 条），向一端加载超限时淘汰另一端一批；绘制只含视图里的行和视图下方的空白占位。
- **序号**：改为项目级 Prompt Entry 序数，**推翻 Issue 12 的「会话级、从 1 开始」**；确认父节点 Pane 用同一序号。
- **新条目**：在底部时跟随；不在底部时位置不变，标题显示「N 条新条目」，视图末尾一个「↓ N 条新条目」按钮回到最新一批；回到底部清零。只计本进程采集的条目；本进程追加时发现 sequence 不连续，在底部重读最新一批，不在底部只计数。
- **性能**（`scripts/benchmark-timeline.sh`，不进默认门禁；M1 Pro、macOS 15.8、SQLite 3.43.2；100,000 条混合事件，预热 1 次、重复 10 次）：三项操作背后的 helper 调用，p95 分别是展开 73 ms、加载更早一批 260 ms、采集并重读 155 ms。插件自己的解析与绘制（每次最多 129 条）没有计时，PTY 里没有可感知的延迟。最坏情况是单条 100,000 层深的链路，每次读约 180 ms，主要花在 path 遍历上。
- **`branch-match`**：候选只读一次、在内存里自顶向下匹配；截断 transcript 用 4M 步预算，超出就答 ambiguous、不点名任何候选。20,000 条相同 prompt 配 4,096 行相同 transcript 时，两种模式都远低于 3 秒（旧实现 30 秒超时）。
- **没做到的**：Gap 边界要等 Issue 26 才有事件类型，fixture 里没有 Gap；跨窗口的折叠计数与展开（backlog 的 a）仍然开着；到底时触控板不起作用，是宿主限制（见下）。
- **宿主事实**（2.1.281 实测，**修正 Issue 03**「收不到 Ghostty 触控板 `ui.scroll`」）：
  - band 的树高于 `maxRows` 时：滚轮和触控板送带 `pointer` 的 `ui.scroll`（Ghostty 也送）；方向键送不带 `pointer`、`by` 为 ±1 的 `ui.scroll`，焦点环不动；到边缘仍然送；hook 不调用 `next` 时宿主窗口不动。
  - 树不超过 `maxRows` 时：宿主一次 `ui.scroll` 都不送；方向键由宿主原生移动焦点，两端绕回（标题按 ↑ 到最后一个按钮，最后一个按 ↓ 到标题）。
  - 树高于 `maxRows` 时，宿主一定在底部画一行 `n more`，数字是树比窗口多出的行数，与窗口停在哪里无关；插件无法隐藏它或改文案。这个版本的 `Box` 没有 `position: absolute`，`Client` 收不到滚轮。
  - 焦点所在元素从树中消失时，宿主按位置保留焦点环，不发 `ui.focus`。`ctrl+x tab` 后焦点落在带 `autoFocus` 的按钮上。Button 在焦点和指针下都会反色，指针停在 band 上时会同时亮两行。
  - `$.ui.scroll({ in: <band requestId>, to: 'end' })` 在 PTY 里有效。
- **给后续实现者**：
  - 测试引擎拒绝插件自己调用的 `$.ui.focus` 和 `$.ui.scroll`（no implementation），光标和窗口的最终落点只能靠 PTY 验证。测试拿到的渲染树里 `Text` 不带 key，要数行数请数根节点的 `children`。
  - Issue 22、23：band 在底部时方向键是宿主原生移动焦点，其他位置是插件经 `ui.scroll` 移动；Enter 跳转和终端回退都要分别考虑这两种状态。

一轮 `/code-review` 找到 18 条：
- **修了 10 条**：
  - 窗口已满、视图不在底部时，新条目会挤掉视图首行、让视图前移；
  - 首次读取早于载入 Active Branch，tip 在窗口外时不折叠；
  - 回到最新批次失败时提前清掉了计数；
  - 晚完成的较早写入被静默丢弃；
  - 响应被解析两次；
  - benchmark 在条数过少时崩溃；
  - benchmark 的口径：头注释和上面的性能说明改为「测的是 helper 调用」；
  - 补了 10 万条归档下的插件窗口测试；
  - 票据状态改为 resolved；
  - map 注明取代 Issue 17 的 `truncated` 契约。
- **3 条进 backlog**：`timeline-read` 每批的 path 遍历、segment 全表扫描（新文件 `20260924-timeline-read-per-batch-cost.md`）；窗口首行的跨 Run 分支标记（追加到 `20260922-bounded-persisted-timeline-view.md`）。
- **1 条记为偏离**：`parents` 不带 sequence 与 ordinal（见上方「实现中修订」）。
- **1 条待补**：Issue 20 的「选定后马上按 Esc」要真人 PTY，本票没有做。
- **驳回 3 条**：
  - Status 用 `claimed`/`resolved` 正是 map 子票的约定；
  - 追加时按 eventId 去重的检查，在乱序插入之后是必需的；
  - Prompt Entry 按钮每次绘制新建闭包，开销可以忽略。

门禁：`2.1.273`/`2.1.281` 各 **248** 项 plugin tests、8 静态、32 bridge、66 helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.281 上通过（验收项目有 400 条合成事件）：
- `51c8420`：光标逐条走到 1 号再回到最新、底部跟随、离开底部计数、「↓」按钮、重新展开回到最新一批。
- `95cab6a`：标题固定；触控板上下滑、到两端加载；方向键两端不绕回；到底时没有 `n more`，点提示后触控板可用；到底提交时直接跟随。

review 的修复没有再做 PTY。
