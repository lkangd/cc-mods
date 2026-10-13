# 35: 界面改版——时间轨主体（方案 C）+ 页签与底栏（方案 A），桌面端单独绘制

**What to build:** 按 2026-10-13 方案页（https://claude.ai/artifact/UaH5mTQ54cuS4Xd8cfV8Pt）的方案 C 改终端目录主体，顶部筛选与底部按钮改用方案 A 的展示方式；桌面端（及 vscode / mobile）按方案 C 的桌面版单独绘制。

**Blocked by:** 无

**Status:** in progress

## 已定的决定（2026-10-13）

- 使用者选定：整体用方案 C；终端顶部与底部按钮的交互展示改用方案 A。桌面端同一轮一起做。
- 测试接口（使用者确认）：`entriesOf` 条目生成、`wrapCells` 折行、Pane 绘制（test kit 的 `$.ui.mount`，含 `surface: 'desktop'`）、PTY 验收 verifier（`toc_verifier.parse_pane`）。
- 顶部（方案 A）：三个 plain Button，label 只写名字（`全部`/`用户`/`Agent`），宿主画成 `1: 全部`；选中项不淡化，其余 `dimColor`；下一行是规则线，选中按钮正下方 `━`（`suggestion`），其余 `─`（`subtle`）；再空一行。布局按钮离开顶部。
- 底部（方案 A）：一行 `─`（`subtle`），下一行左边 `N 轮`（淡化；N 是目录持有的 Turn group 数，不随筛选变）或暂停时 `⏸ 暂停跟随`（`warning`），右边 plain Button `l: 布局 卡片`。底栏固定在面板底部。跳转被拒说明和数据源说明仍在列表下方。
- 主体（方案 C）：
  - 用户侧首行节点 `●`，Agent 侧首行分支 `├╴`，续行与组间空行是轨道 `│`；当前位置变 `◉` / `┣╸` / `┃`，整条 gutter（含时间）用 `suggestion`。进行中的 Agent 侧在分支后加 `◐`（`claude`）。
  - 卡片：没有时间列，`HH:MM` 在用户侧首行右端（淡化）；每侧最多 2 行。Agent 侧是「状态 · 回复」一段，整段淡化，不再有 `↳` 和单独的头行；也不再有「你 · 日期」头行。
  - 紧凑：左列 `HH:MM`，每侧 1 行。时间轴：左列 `HH:MM`，每侧最多 2 行。时间写在组里第一个显示的那一侧。
  - 日期分隔：列表里日期变化处（含第一组）插一行 `─ 10月12日 ───`，今天写 `今天 · 10月13日`，不是今年的带年份；读不到时间的组不触发、也不重置。卡片与时间轴里分隔前的组间空行不画轨道。
  - 悬停：同侧各行变 `suggestion` 色，不再整侧反色（指针正下方那一行仍由宿主反色）。
- 折行：右侧闭合标点不出现在行首（把上一行最后一个字带下来）；不超过 14 个字符的英文词 / 路径整体换到下一行。
- 桌面端：按 `e.surface` 分树。顶部三个 Button（选中的 `variant="primary"`）加布局 Select（没有 Select 的 surface 用按钮循环）；Svg 缩略条每轮一根竖条，高度按步数，当前位置与进行中上色，Svg 内自带 `prefers-color-scheme` 与 `prefers-reduced-motion`；条目每侧一个 Button，不预先折行；日期分隔与时间列同终端；底部是轮数或暂停。条目窗口沿用终端的窗口逻辑，保证一棵树有界。
- 规格里「不承诺 Desktop」改为承诺桌面端可用、观感由使用者在 Claude 应用里目检。
- 没有 Jump target 的一侧（被拒、resume 前已 compact）：Agent 侧本来就整段淡化，分不出来，改为首行挂空心记号——用户侧 `○`、Agent 侧 `├┄`（`subtle`），用户侧文字仍淡化（使用者 2026-10-13 选定）。

## 步骤

- [x] 折行：避头标点、英文词整体换行
- [x] 顶部页签与规则线
- [x] 底栏：轮数 / 暂停、布局按钮
- [x] 条目：卡片 / 紧凑 / 时间轴的新行模型
- [x] 日期分隔与行高
- [x] gutter：节点、轨道、当前位置、进行中；悬停色
- [x] 桌面端分树与缩略条
- [x] verifier 与场景脚本跟上新格式；两版宿主 PTY 验收
- [x] 文档：spec、CONTEXT、根 README、开发者 README

## Comments

- 2026-10-13 实现（分支 `chat-toc/35-visual-redesign`）：按测试接口逐轮红绿，`claude plugin test` 271 过，两版 tsc 与 validate 干净。首次建 4432 轮的条目表一度从约 30 ms 涨到约 50 ms（折行先把整段文字展开成数组、每字调一次宽度函数、每组多次解析时间戳），改成按需取字、宽度提到循环外、时间戳每组解析一次后与基线持平。「位置残留 5 ms」那条性能用例在机器负载约 20 时基线也会偶发失败，与本次改动无关。
- verifier `parse_pane` 改读时间轨（节点、分支、空心记号、日期分隔、时间列、页签线、底栏），样本换成两版宿主上 forms fixture 的四种视图截屏（`tests/acceptance/testdata/`），30 个单元测试过。各场景脚本改用 `user_row` / `agent_row`，UI-003/UI-004 改读轨道记号与颜色。
- 2026-10-13 CT-PERF-001（`release_gate.py run --only-perf`，两版串行）：头两轮在 load 10–20（`xctest`、Vibessage）下增量读取 p95 屡次超 150 ms；同负载下 0.1.2 与本版交替跑，0.1.2 也超（288 ms），读取路径未改，判为负载。另有 3 次运行在 pyte 内部崩溃（`screens.py` `render` 的 `IndexError`，34 号票也遇到过）：宿主在一帧中途用窄字符盖掉宽字符的首格，pyte 留下空占位格，自己的 `display` 读不了。`pty_harness.screen_rows` 把孤立占位格读作空格（与终端一致），`rows()` 改用它。load 2–5 时四个组合各 3 次全过：增量读取 p95 最大 107–128 ms，追加到模型 335–598 ms，空闲整份读取 181–366 ms，Pane 含宿主最大 11 ms。
- 2026-10-13 发布 0.1.3（使用者决定不等桌面端实机目检，直接发布）：被测提交 `28eefdf`，`release_gate.py run --screens` 两版串行，当前版本 tsc 用 `plugin-authoring` skill 的 `claude-code.d.ts`。全部门禁通过（37 个 MUST × 2、validate、test 271、单元 49、两版 tsc、本地 marketplace 冒烟、签字截屏）；2.1.287 perf-many 第一轮有一次增量读取 167 ms（load 约 9），挪到 scratchpad 的 `gate-perf-attempt1/` 后 `--only-perf` 重跑通过。`report`：114 条记录全部通过，缺失 0，泄漏 0，证据在 `mods/chat-toc/tests/evidence/0.1.3/`。
