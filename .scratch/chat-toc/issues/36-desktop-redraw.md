# 36: 桌面端按实机能力重画

**What to build:** 35 号票的桌面端在 Claude 应用里实机看，与方案 C 的设计图差得很远（每侧一个灰底原生按钮、单行截断、没有轨道、缩略条一大块、hotkey 角标、「暂停跟随」误报）。按 2026-10-14 在 Desktop 上用试验插件（`.scratch/chat-toc/prototypes/desktop-click-probe/`）量出的能力重画桌面端。

**Blocked by:** 无

**Status:** done

## 实机量出的宿主行为（Claude 应用，2026-10-14）

- `plain` 的 Button 在桌面端画成一行纯文字，没有按钮外框；悬停变色；快速连点每次都算。只认 `dimColor`，子元素里的 `bold`、`color`、换行都被忽略；超宽时截断加省略号。非 `plain` 的 Button 是灰底原生按钮，`hotkey` 画成角标。
- Markdown 链接配 `onLinkPress` 能把点击交给插件，但画成强调色链接，连点第二下被当成双击吞掉。
- Svg 按 `width`/`height`（CSS px）画；不给宽度时按标记宽度缩到槽宽。图上的点击传不回插件；绝对定位的 Button 盖在图上只占它自己那一小块。
- Box 的 `width`/`height` 单位是格：一列约 8.2 px，一行约 19 px（`bodyColumns` 78 时内容宽约 642 px，48 时约 398 px）。`borderStyle` 的盒子总是铺满整行。
- 消息的 `ui.render`（`UserMessage`）在桌面端只在画出时来一次，`onScreen` 一直是 `null`，滚动会话不再触发：桌面端拿不到会话的可见范围，没有 Current position。
- Svg 里的 `prefers-color-scheme` 跟着应用的深色。
- `$.ui.scroll` 滚 transcript 一律被拒：`deny: transcript not scrollable here`（官方已有 anthropics/claude-code#100610，2026-10-14 补了 2.1.295 的复现与 chat-toc 的用例）。桌面端不能跳转。
- 悬停时宿主在指针下的 Button 后面画一个底框，插件关不掉。

## 已定的决定（2026-10-14 使用者）

- 点哪条跳哪条不妥协：条目的每一行是一个 `plain` Button，用户侧正常色、Agent 侧淡化，点哪一行都跳到那一侧。
- 时间、节点、轨道、分支、进行中记号画成每条左侧的一张 Svg，高度按行数 × 19 px，相邻条目叠成一条连续的轨道；组间空行与日期分隔也是 Svg。
- 顶部筛选用设计图的分段控件：底图（槽与选中项的浅底块）是 Svg，三个 `plain` Button 叠在上面，选中的不淡化；不带 `hotkey`（桌面端会画角标）。布局下拉不带「布局」标签。
- 缩略条每轮一根竖条（灰；进行中为 Claude 色），下面一行写首轮的日期时间、`N 轮`、末轮时间；`N 轮` 不再单独放在底部。
- 桌面端没有 Current position：不高亮、不显示「暂停跟随」。
- 桌面端不能跳转（宿主限制），使用者选方案 2：照常显示目录，按下条目先照常请求滚动，宿主回答 `transcript not scrollable here` 时底部提示「Claude 应用暂不支持跳转到对话」，不把该侧记为被拒、不淡化；宿主将来放开时不改代码即可跳。
- 筛选选中项的底块缩成宿主悬停框的大小与形状（方案 A），悬停时与之重合。
- 宽度按 `bodyColumns × 8.2 px` 算。

## 步骤

- [x] 分段控件、布局下拉
- [x] 缩略条与标签行
- [x] 条目：左侧 Svg 轨道 + 每行一个 plain Button；日期分隔、组间空行
- [x] 桌面端不暂停、不高亮
- [x] 不能滚动时的提示（不记为被拒）
- [x] 使用者在 Claude 应用里实机目检（截图往返，三种 Layout）
- [x] 给官方补充 feature request（#100610 评论与 +1）

## Comments

- 2026-10-14 实现：`desktop.tsx` 重写，`minimap.ts` 加标签行与 `stripLabels`，`jump.ts` 加 `isUnscrollable` / `UNSCROLLABLE_TEXT`，`register.tsx` 在 Desktop 的拒绝上只提示；删掉不再用的 `sideText`。`claude plugin test` 273 过，tsc 干净。使用者在 Claude 应用里用工作区副本（本地目录 marketplace `toc-probe-local`）看过三种 Layout 与提示。顺带恢复了根 README 里 prompt-history 环境要求被 35 号票误改的一行。
