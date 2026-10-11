# 25: View filter、三种 Layout 与键盘

**What to build:** 使用者能用「全部 / 用户 / Agent」过滤目录，在卡片、紧凑、时间轴三种 Layout 之间切换，两个选择都跨会话记住；焦点在 Pane 内时全程可用键盘操作。

规格见 [chat-toc MVP](../spec.md) §7。

**Blocked by:** 19（完整的开组规则与 Agent reply）

**Status:** resolved

- [x] 过滤行左边三个 `plain` Button `●全部`/`○用户`/`○Agent`，热键 1/2/3，切换后立即重画；选「Agent」时只有用户侧的组整组隐藏
- [x] 过滤行右端「布局:<当前 Layout>」按钮，点击或按 `l` 按卡片 → 紧凑 → 时间轴循环；最右留约 3 列给 2.1.287 的 ✕
- [x] 紧凑：每侧一行、Agent 行整行 `dimColor`、青色 `●` 高亮；时间轴：左栏 8 列 `HH:MM`+`│`、高亮变青色 `┃`、Agent 行整行 `dimColor`；左栏在 Button 外的 `Text` 里，两版都对齐
- [x] 高亮不加粗，只靠青色标记
- [x] View filter 与 Layout 写进 `$.store`，跨进程记住；写入失败本次仍切换；值认不出时回到「全部」与卡片（CT-UI-001、CT-UI-002）
- [x] 切换 Layout 时以选中组为锚（Current position 已落地时，无选择光标则以它所在组为锚），锚定组留在可见窗口内，跟随或暂停状态不变；只改绘制，不改显示哪些条目
- [x] ↑↓ 走宿主焦点环、焦点落在条目第一行 Button，不跳过淡化条目；Enter 与点击相同（CT-UI-003）
- [x] 36、44、56 列宽下三种 Layout 都可读，两个版本截屏存档供人工目检

## Comments

**2026-10-11 实现（分支 `chat-toc/25-filter-layouts`）**

- 代码：`hooks/view.ts`（两个选择、`$.store` 键 `viewFilter`/`layout`、认不出回默认）、`hooks/entries.ts` 的 `entriesOf(groups, { layout, filter, width, nowMs, isRunning })`（三种 Layout 与过滤；`cardEntries` 保留为卡片全部的简写）、`hooks/pane.tsx`（过滤行、三种左栏 `gutterOf`、`litGroup`）、`hooks/ring.ts`（焦点环规则）、`hooks/window.ts` 的 `topRevealing`。
- **Current position 锚还没做**：24 未落地，切换时只以选择光标所在组为锚；没有光标、窗口被手动滚过时以窗口顶部那组为锚；窗口跟随最新时继续跟随。24 落地后在 `register.tsx` 的 `anchorForSwitch` 里加「无光标则用 Current position 所在组」。高亮同理：`drawPane` 已收 `litGroup`（卡片青色 `▌`、紧凑青色 `●`、时间轴整栏青色加 `┃`，都不加粗），目前恒为 `undefined`，由 24 填。光标锚在跟随状态下若锚定组不在跟随窗口内，只能把窗口停在锚上（等于暂停跟随）；Pane 聚焦时本来就暂停，影响不大。
- **↑↓ 的实测（两个版本一致）**：插件只画可见窗口、树不超出时，宿主的 ↑↓ 在**每个** Button 之间走（卡片的正文行也是 Button），到最后一个再按 ↓ 绕回第一个（过滤行的 `1:`），Tab 还会停在 ✕。所以 hook `ui.focus`（`ring.ts`）：落到某条目第 2 行起的 Button 时，从本条目第一行往下就改落下一条目的第一行，否则改落该条目第一行；在窗口最后一条往下（落到第 2 行或绕回 `f-all`）、窗口第一条往上（落到「布局」）时拒绝这一步、把窗口挪一条，再 `$.ui.focus` 到新露出的条目。点击正文行不会移动焦点环（实测），所以不会被误判成「往下」。
- 宿主不把插件自己的 `$.ui.focus` 交给本插件的 `ui.focus` hook，所以光标位置在 `focusKey` 里自己记。切换 Layout/过滤后宿主按「第几个 Button」保留焦点环，会落到正文行；所以重画后约 60 ms 再把它放回选中条目（`REFOCUS_MS`）。
- 测试工具：插件的 `$.ui.focus` 到不了测试的 `on('ui.focus')`（报 no implementation），与 `ui.scroll` 一样；光标最终落点放在 PTY 验收，单测只验 `ringMove` 纯函数和窗口移动。`tests/host.ts` 现在自带 `$.store`（`world.store`、`world.refuseStore`）和 `world.focuses`。
- **过滤行宽度**：宿主把带热键的 `plain` Button 画成 `1: ●全部`，比票 13 估计的宽：`1: ●全部 2: ○用户 3: ○Agent` 27 列，`l: 布局:时间轴` 14 列，加 ✕ 3 列共 45 列。放不下时「布局」按钮单独占过滤行下面一行、靠右（`filterRows`）。实测：44 列下卡片/紧凑一行放得下，时间轴两行；36 列三种都两行；56 列都一行。
- 紧凑的用户行：prompt 截成一行，右端 `HH:MM`（没有时间就不写，prompt 占满）；Agent 行 `↳ 状态 · 末段`。时间轴每侧最多 2 行，Agent 侧同样是 `↳ 状态 · 末段` 折行，左栏只在用户侧第一行写时间。卡片与时间轴组间空一行，紧凑不空。
- 另修（协调者转来，CT-TURN-003）：`cells.ts` 把 Emoji_Presentation 的 BMP 字符（✨ U+2728、✅、⭐、⚡、⌛ 等）算 2 格，与宿主一致；另补了 1F004、1F0CF、1F18E、1F191–1F19A、1F200–1F2FF。测试在 `card_entries.test.ts`。
- 验证：`claude plugin test mods/chat-toc` 132 通过；两个版本 `plugin validate` 通过；tsc 对 2.1.287、2.1.295 声明都无错。PTY（pyte，隔离配置、未登录，没有调用模型）：两个版本的 harness smoke 通过；`assets/25-layouts/` 下 `capture.py`（三种 Layout × 36/44/56 × 两版本，外加用户/Agent 过滤）、`check_screens.py`（核对每张截屏的 Layout、过滤、宽度，30 张全部 ok）、`probe.py`（按键序列，`keys-*.txt` 是两个版本 ↑↓ 走条目、窗口两端滚动、绕回过滤行的记录）、`remember.py`（选「Agent」与紧凑后退出再开仍记得；把 store 文件改成认不出的值后回到全部与卡片，`remember-*.txt`）。截屏在 `assets/25-layouts/screens/<版本>-<列宽>/`，供人工目检；青色高亮要等 24。
