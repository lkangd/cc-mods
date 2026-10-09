# chat-toc 研究 02：停靠 Pane 的生命周期与放置规则

研究问题：在 Claude Code `>=2.1.287`（对照本机 2.1.295）的公开 mods API 中，停靠 Pane 的放置、排队、关闭、重开、按键/滚动归属、宽度请求、状态栏、与其他 mod 的 Pane 并排成标签、reload 后的存续这些规则各是什么；哪些可以从声明与文档确定，哪些必须靠原型实测。

只读研究，没有写 mod，也没有动 `~/.claude/dev-mods`。

## 出处与缩写

| 缩写 | 指向 | 可信度 |
| --- | --- | --- |
| `d.ts` | `/private/tmp/claude-501/bundled-skills/2.1.295/b63029d1f174acf098aa2856af0b60f5/plugin-authoring/types/claude-code.d.ts`：2.1.295 引擎在 skill 加载时自己写出的整套 API 声明 | 最高。reference.md 第 5 行说"the declaration file is the authority" |
| `skill-ref` | 同目录的 `reference.md` | 高（同一构建附带的长文说明） |
| `docs/<页>` | `~/.claude-code-docs/docs/plugins__mods__<页>.md`：官方文档本地镜像 | 高，但可能比 d.ts 写得粗 |
| `changelog` | `~/.claude-code-docs/docs/changelog.md`：本地镜像只到 **2.1.293**，2.1.294/2.1.295 没有条目 | 用来判断版本 |
| `diff@e47cc82` | 内置 mod `cc-plugin-diff` 的公开源码，`anthropics/claude-code` 仓库 `mods/diff/`，提交 `e47cc82bdbd27b5f799acd5b05fd0c29d33bb48c`（2026-10-08）。官方文档 `docs/overview` 第 240–245 行指向它，说它是"scrolling the mod handles itself"的范例 | 高：Anthropic 自己写的、跟 chat-toc 形状最接近的 mod（会话中自动弹出、记住关闭、只在 dock 时自动开、自己处理滚动）。注意：main 上的代码可能比 2.1.287 实际带的新 |
| `ph` | 本仓库 `mods/prompt-history/hooks/register.tsx` | 中：本仓库已在 2.1.29x 上跑通的做法 |

## 版本可用性的判断方法

- `docs/overview:97`：终端里的 mods 从 v2.1.287 起可用；`changelog:487-489`（2.1.287）为"Added Claude Mods"。
- 官方文档对 2.1.287 之后才有的东西逐条标了 "Requires Claude Code v2.1.xxx"：`prompt.mention` 要 2.1.290（`docs/reference:73`），`ui.fault` 要 2.1.289（`docs/reference:135`），`$.ui.selection()` 在 2.1.288 加入（`changelog:396`）。Pane 相关的方法、字段和事件（`$.ui.open/close/panes/scroll/focus/status`、`ui.close`、`ui.scroll`、`ui.focus`、`Pane` 的 props、`command.run.presentation`）在文档里**都没有这种标注**，2.1.287–2.1.293 的 changelog 里也**没有它们的"Added"条目**。
- `docs/interactive-mode:559-572`：`/diff` 面板就是 `cc-plugin-diff` 画的，要求 "Claude Code v2.1.287 or later"。也就是说 2.1.287 已经有一个内置 mod 在用 dock Pane、144/110 阈值、`presentation`、记住关闭这些东西。
- 结论：下文标"2.1.287 起"的条目，依据是"没有后来加入的记录，并且 2.1.287 的内置 mod 已在用"，属于推断，**不是逐版本比对 d.ts 得出的**（本机只有 2.1.295 的 d.ts）。凡是 changelog 里明确有后续修复的地方单独注明。要在 2.1.287 上发布，至少得在 2.1.287 上跑一遍原型。

---

## 1. `session.start` 时主动 `$.ui.open` 的放置

### 1.1 阈值：两条互相独立的规则

**规则 A（是否落座，按"是否由使用者请求"）**

- "Asked"（由使用者请求）指：使用者输入的命令、提交的 prompt、操作过的 Button/Input/Select 所触发的 hook。明确**不算**请求的有：timer、`session.start`、排队的 prompt，以及 `focus` 字段本身。请求打开的 Pane 在任意宽度下都会落座（`d.ts:14117-14133`、`d.ts:2482-2484`、`d.ts:7381-7388`）。
- 未经请求的 Pane 从 **144** 列起落座。若使用者以前请求打开过这个 id（本会话或更早的会话），并且之后**没有手动关掉过**，门槛降到 **110**（`d.ts:14124-14127`、`d.ts:7384-7387`、`docs/interface:334-337`、`docs/reference:279`）。
- 由此推出：**在 `session.start` 里 open 一律算 unasked**，用 144/110 门槛。110 这份"被请求过"的记忆由引擎跨会话保存，**使用者一旦手动关闭就清掉**，下一会话又回到 144。

**规则 B（坐在哪：dock 还是 inline，按布局）**

- 全屏（alternate-screen）布局下，从 110 列起 dock 在 transcript 旁边；主屏布局（`CLAUDE_CODE_NO_FLICKER=0`、tmux 默认）下，不论多宽都 inline 在输入框上方（`d.ts:1752-1759`、`d.ts:1763-1765`、`d.ts:10331-10338`、`d.ts:14122-14123`）。
- 推论：**全屏布局且宽度在 [110,144) 之间时，请求打开的 Pane 会 dock**；全屏且窄于 110 时，请求打开的 Pane 落座为 inline（`d.ts:14122-14123` 原文为 "docked beside a fullscreen transcript from 110 columns, else inline above the prompt"）。
- **主屏布局、≥144 列时，未经请求的 Pane 会以 inline 落座**，因为规则 A 只看宽度，不看布局。这对 chat-toc 是个坑，见 1.4。

版本：2.1.287 起（推断）。`diff@e47cc82 hooks/limits/columns/auto-open-min-columns.ts` 与 `open-min-columns.ts` 分别把 144、110 写成常量，并注明是"the built-in sidebar's own"。

### 1.2 宽度不足时：排队与自动落座

- 宽度不够时，`$.ui.open` 解析为 `{ isPlaced: false, reason }`。这时 Pane **已经算"打开"**，只是没画出来：不触发 `ui.render`，`$.ui.panes()` 里能看到它，`isPlaced: false`（`d.ts:14143-14157`、`d.ts:14186-14192`、`d.ts:2486-2487`）。
- 两种情况下它会自动落座：使用者打开它（比如跑 `/chat-toc`，此时那次 open 算请求），或终端拉宽到门槛（`d.ts:2486-2487`、`d.ts:14127-14129`、`d.ts:14186-14190`）。
- `reason` 是给人看的字符串，内容是"落在哪个门槛下、现在多宽"，或者"当前连接的 surface 都不放 Pane（如旧版 desktop）"（`d.ts:14147-14153`）。不应该拿它做程序判断。
- 官方 diff 的做法：发现 `isPlaced === false` 就马上 `closePane` 撤回，"so no later resize seats it"，等下一次触发再问（`diff@e47cc82 hooks/register.ts:444-450`，README 第 23–24 行）。chat-toc 可以照这样撤回，也可以留着等变宽自动落座。但要注意：留着排队的 Pane 在**主屏布局**下变宽到 144 后会以 inline 落座。
- 版本：2.1.287 起（推断）。

### 1.3 `isPlaced` 与 `placement` 的取值

- `UiOpenResult`：`{ isPlaced: true }`（已画出或就地改了标题，随后来第一次 `ui.render`），或 `{ isPlaced: false, reason: string }`（`d.ts:14134-14158`）。
- `UiPane`（来自 `$.ui.panes()`，只列本插件的 Pane）有 `id`、`title`、`isShown`（是不是当前显示的那张，其余是背后的标签）、`isFocused`、`isPlaced`（`d.ts:14167-14193`、`d.ts:2516-2527`）。
- `placement: 'dock' | 'inline'` **只出现在 `Pane` 的 render props 里**，各 surface 各自给值，`$.ui.panes()` 不返回它（`d.ts:10331-10338`、`d.ts:14160-14166`、`d.ts:2491`）。只读，hook 改它会被拒（`d.ts:10335-10337`）。
- 版本：2.1.287 起（推断）。

### 1.4 能否禁止 inline、只要 dock

- **API 里没有"只要 dock"的开关。** `PaneOpenArgs` 的全部字段是 `id/title/focus/closeOnEscape/holdToasts/rows/columns`（`d.ts:7390-7461`），布局和落座方式都归 surface 决定。
- 官方给的做法是**打开前先自己判断布局**：`e.viewport.isFullscreen` 表示"这个 surface 会不会把 Pane 当侧栏 dock"。终端始终会给值，并且**整个会话内固定**（`d.ts:10400-10415`）。d.ts 的示例就是 `if (e.viewport?.isFullscreen === true) void $.ui.open({ id })`（`d.ts:10413`）。skill-ref 第 117 行写的是 "so a plugin opens a pane unasked only where it would be a sidebar"，并提醒字段缺失时"do not assume"。
- 难点在 `session.start` 拿不到 viewport。官方 diff 的办法是挂一个每次都会画的 `PromptHint` 的 `ui.render`，从里面读 `viewport.columns` 和 `viewport.isFullscreen`，第一次量到值时再触发打开，自己原样 `next(e)`（`diff@e47cc82 hooks/register.ts:700-719`，README "What it hooks" 中 `ui.render of PromptHint` 那一行）。它的判断条件是 `model.isFullscreen === true && columns >= floor`，surface 没给值就不自动开（`register.ts:478-497`，README 第 17–21 行 "where the surface does not say, nothing opens by itself"）。
- 命令路径里可以读 `command.run` 的 `e.presentation.isFullscreen`（`d.ts:1808-1818`），见第 3 节。
- 兜底：如果已经 dock 的 Pane 之后变成 inline（全屏下拉窄到 110 以下时**可能**发生，见 1.5），mod 可以在 `Pane` 的 render 里看到 `placement === 'inline'`，再用 `$.clock.after(0, …)` 调 `$.ui.close`。这时 origin 是 `plugin`，不会被当成使用者关闭。ph 里已有在 render 中延后 close 的写法（`ph:7929-7934`）。这套组合**需要原型实测**。

### 1.5 必须实测

1. 全屏、已 dock 时把终端拉窄到 <110 或 <144：Pane 是改成 inline，还是变回 `isPlaced:false`？对已落座的未请求 Pane，144 门槛是否持续生效？（d.ts 只说了门槛决定"落座"，没说已落座后再变窄怎么办；diff 在 render 里处理了 `isReseated`，说明 placement 会变，`register.ts:737`。）
2. `session.start` 里调 `$.ui.open` 与从 `PromptHint` render 里（借 `session.start` 的 `$`，像 diff 那样）调，两种做法哪个能可靠拿到 `isFullscreen` 和列数。
3. 110 记忆的范围：按插件+id 记录，具体存在哪里，`--plugin-dir` 开发版与 marketplace 安装版是否共用一份。

---

## 2. 使用者关闭时 mod 收到什么

- 所有关闭都会触发 `ui.close`，`e = { id, origin: { kind } }`。`kind` 取值：`plugin`（某个插件调了 `$.ui.close`）、`person`（使用者点了关闭标记或按了关闭键）、`unload`（引擎自己关的）（`d.ts:7344-7379`、`d.ts:2502-2507`、`docs/reference:133`）。
- `person` 包含：右上 ✕ 标记、`ctrl+x x`（字段有焦点时也算），以及开了 `closeOnEscape` 时的 Esc（`d.ts:10306-10309`、`d.ts:7416-7417`、`docs/interface:516-517`、`docs/interface:549`）。
- **origin 只带 `kind`，分不出是 Esc、✕ 还是 ctrl+x x**（`d.ts:7372-7379`）。
- hook 不调 `next` 直接回答，可以把 `plugin` 和 `person` 的关闭拦下来，`unload` 拦不住；拦下来的关闭会让调用方拿到 `{ deny }`（`d.ts:7362-7366`、`d.ts:2506-2513`）。diff 在 inline 详情页里正是用 `{ deny }` 把关闭变成"返回列表"（`diff@e47cc82 hooks/register.ts:819-838`）。
- `unload` 指 Pane 已经没人画了（插件被卸载，或它的绘制抛错）。触发时 Pane 已经不在了，**打开它的那个插件的 hook 不会被调用**（`d.ts:7366-7370`）。另外 skill-ref 第 129 行提到，引擎没能画出任何内容时 Pane 会被关闭（"the pane was closed"）。
- **`closeOnEscape` 的副作用**：设了它之后，Pane 有键盘时按 Esc 会关闭；**而且 prompt 拿回键盘后，在空闲、空输入框状态下按 Esc 也会关闭它**（`d.ts:7419-7424`）。对常驻的目录来说这太容易误关，**建议 chat-toc 不设 `closeOnEscape`**。不设时 Esc 只把键盘还给 prompt，Pane 保留（`d.ts:7425`、`docs/interface:517`）。

**能否记住"本会话已关闭"**：能。参照 diff 的写法：`on('ui.close', { id: PANE }, …)`，先 `await next(e)`，结果没有 `deny` 且 `e.origin.kind === 'person'` 时记下这次关闭（`diff@e47cc82 hooks/register.ts:819-854`，diff 写的是 `$.store`，下一会话也保持关闭）。ph 也有同样的模式（`ph:7910-7923`）。chat-toc 要的是"本会话"范围，应该写 `$.state`（见第 8 节）。`$.state.set` 不能在 render hook 里调，`ui.close` hook 里可以（skill-ref 第 118 行、`docs/interface:769`）。

版本：2.1.287 起（推断）。

需实测：Esc 关闭（开了 `closeOnEscape` 时）是否确实以 `person` 触发 `ui.close`；✕ 是否真的出现在 dock 模式的边框上（`docs/interface:549` 讲的是 inline 示例；`d.ts:10343-10345` 说 dock 也有一行留给关闭标记）。

---

## 3. `/chat-toc` 斜杠命令重开

- 用 `$.command.register({ name, description })` 注册，在 `on('command.run', { command: 'chat-toc' }, …)` 里回答。返回 `{}` 不打印任何东西（`docs/api:37`）；返回 `{ text }` 会作为一行写进 transcript，**模型也会读到**（同一处）。要在 Claude 工作中途也能用，就在注册时加 `immediate: true`，否则会等这一轮结束（`docs/interface:330`、`docs/api:37`）。
- 在命令 hook 里调 `$.ui.open` 算 **asked**，任意宽度都落座（`d.ts:14117-14121`），并且会让这个 id 记下"被请求过"，此后自动打开的门槛是 110（`d.ts:14124-14127`）。
- `e.presentation = { isFullscreen: boolean, columns: number }`，由引擎打上、固定不变（`d.ts:1761-1775`、`d.ts:1808-1818`）。`columns` 在没有终端测量时为 80。
- 对已经打开的 id 再 open，只会**更新标题，不会出第二个实例**（`d.ts:7392-7393`、`d.ts:2482`）。`focus: true` 只是请求：**只有当 prompt 持有键盘且输入框为空时**，surface 才会聚焦并**把这个 Pane 提到前面（raises）**。输入框有字、对话框、问卷都会让它拒绝聚焦（`d.ts:7408-7414`、`docs/interface:502`）。斜杠命令提交后输入框是空的，所以通常能拿到焦点（推断）。
- 官方 diff 的 `/diff` 是**开/关切换**：已开就关（origin `plugin`），未开且全屏宽度 <110 就回一行"请加宽终端"，不开（`diff@e47cc82 hooks/pane-toggle/pane-toggle-of.ts`、`hooks/register.ts:768-817`）。非全屏时它改用 `focus: true` 加 `rows` 打开 inline 对话框（`register.ts:421-439`）。
- 版本：2.1.287 起（推断）。`immediate` 的引入版本未查到，需实测。

需实测：Pane 已开但被别的 mod 的标签挡在后面时，不带 `focus` 的 open 会不会把它提到前面；带 `focus` 但拿不到焦点时（比如输入框里有草稿）会不会提到前面。

---

## 4. Pane 内的点击、焦点、按键、滚动由谁拥有

### 4.1 键盘与焦点

- mod **从不直接读键盘**，按键由引擎分派给有焦点的控件（`docs/interface:492`）。Pane 获得焦点的途径只有三种：带 `focus:true` 从命令或点击打开、`ctrl+x tab`、鼠标点它（`docs/interface:494-502`）。
- Pane 有焦点时：Tab 切到下一个控件；**↑↓ 在内容能放下时在控件之间移动，内容超出时改为滚动**；Enter 按下聚焦的 Button、提交 Input 或在 Select 里选定；Button 的 `hotkey`（一位数字或小写字母）直接按下它；PgUp/PgDn/Home/End 滚动；`ctrl+x` 加方向键调整 Pane 大小；`ctrl+x x` 关闭；Esc 把键盘还给 prompt（`docs/interface:506-517`、`d.ts:10322-10325`）。
- **"A mod can't bind Tab or the arrow keys to anything else"**（`docs/interface:519`）。不过焦点环每次移动都会先触发 `ui.focus` 事件，hook 可以改 `element` 让它落到别的位置，或者 `{ deny }` 原地不动（`d.ts:13863-13915`、skill-ref 第 133 行）。`$.ui.focus({ requestId, key })` 只能在这个 site 持有键盘时移动焦点环（`d.ts:2543-2558`、`d.ts:13832-13848`）。`autoFocus` 指定开局时焦点在哪（`docs/interface:526`、`d.ts:1133-1141`）。
- 一行目录项可以做成一个 `Button`：`plain` 加 `key` 加 `Text` 子元素，`hover` 设反显（skill-ref 第 131 行，`ph:7952-7962` 有现成写法）。点击、hotkey 或焦点下按 Enter 都会触发 `ui.press` → `onPress`（`d.ts:1050-1058`）。终端只有在**全屏布局**下才上报普通单击（`d.ts:7924`，skill-ref 第 125 行）。

### 4.2 滚动：两种所有权模型

- **默认由引擎拥有**：`Pane.scroll = { offset, bodyRows }` 是引擎管的窗口，只读，靠使用者的滚轮或按键移动；树比窗口高时"scrolls as a whole"（`d.ts:10340-10347`、`d.ts:11844-11863`、`docs/reference:218`）。dock 时 `bodyRows` 是给树的行数；inline 时 Pane 随树长高，`bodyRows` 是上限（`docs/reference:214-216`、`d.ts:10343-10346`）。
- **mod 可以接管**：hook `ui.scroll`（`component` 为 `Pane` 或 `AbovePrompt`），读 `e.by`、`e.bodyRows`、`e.contentRows`、`e.origin`，以及 `e.pointer`（滚轮或触控板所在的格子，键盘滚动时没有），然后**不调 `next`、返回 `{}`，把引擎窗口按住不动**，由 mod 自己算偏移、自己画出那一段（`d.ts:14296-14356`、`d.ts:14348-14352` 原文 "A hook pinning a list over rows it scrolls itself…"）。官方 diff 在 dock 模式下就是这么做的：person 发起的滚动按指针位置分给列表或 hunk，最后 `return {}`（`diff@e47cc82 hooks/register.ts:878-896`、`hooks/views/body/body-scrolled-by.ts`）。本仓库 ph 对 AbovePrompt 也是这样：箭头（`pointer` 为空且 `|by|===1`）用来走焦点环，滚轮用来滚自己的视图（`ph:7970-7994`）。
- 区分箭头和滚轮的依据：键盘箭头 `by=±1`、没有 `pointer`；翻页键 `by=bodyRows`；Home/End `by=contentRows`；滚轮静止时每格 ±1，挤在一起时会更多（`d.ts:14326-14334`）。diff 判断 End 用的是 `|by| >= contentRows && contentRows > bodyRows`（`body-scrolled-by.ts`）。

### 4.3 "位于底部时跟随最新"

- 引擎模型下：`$.ui.scroll({ in: PANE, to: 'end' })`，其中 `'end'` 会**跟着增长的树走，直到下一次有别的东西移动窗口**（`d.ts:14425-14433`）。"是否在底部"可以在 `ui.scroll` hook 里用 `e.offset >= e.contentRows - e.bodyRows` 判断（`d.ts:14338-14341`）。但 render props 只给 `offset/bodyRows`，**没有 `contentRows`**（`d.ts:11848-11863`），所以只能靠 mod 自己数行。引擎自己对窗口的修正（跟到末尾、夹紧）**不会再问 mod**（`d.ts:11853-11856`）。
- 自有窗口模型下（推荐）：mod 自己保存 `top` 和一个 `isFollowing` 标记；使用者往上滚就清掉标记，滚到底就重新置上；新增条目时如果 `isFollowing` 为真，就把 `top` 设为末尾。全部状态都在 mod 手里，行为可以确定。
- 版本注意：`changelog:215` / `:219`（2.1.290）修了"跟随末尾、树每次绘制高度都变时无限重绘"的问题（pane/band 一条，inline pane 一条）。**如果靠引擎的 `'end'` 跟随，实际可用的版本下限是 2.1.290**；自有窗口模型绕开了这个问题。

### 4.4 长列表按需渲染

- 必须这么做：一棵树只会画出前 100,000 个字符（skill-ref 第 129 行，`docs/reference:274`），原文就是 "To show more, draw the part in view"。
- 官方 diff 的 `drawWindow` 只画窗口里的行，**并且多画 `SCROLL_MARGIN_ROWS = 8` 行**，"so a line whose wrap was counted short still leaves it full; the pane clips the rest"（`diff@e47cc82 hooks/views/body/draw-window.tsx`、`hooks/limits/sizes/pane/scroll-margin-rows.ts`）。宽度按 `e.props.bodyColumns` 排（skill-ref 第 117 行，`docs/reference:214`），diff 还会再减去右侧留白（`register.ts:743-747`）。
- 重绘节流：可见 Pane 在终端里最多 30 次/秒，多出来的合并（`docs/reference:277`）。

### 4.5 必须实测

1. 树**恰好**等于 `bodyRows` 时，引擎还会不会把滚轮交给 `ui.scroll` hook？ph 的注释说要"树比引擎窗口高"才会交过来（`ph:7970-7973`），diff 多画 8 行或许也起了这个作用。自有窗口模型可能必须让树始终比 `bodyRows` 高。
2. dock 模式下 ↑↓ 走焦点环和滚动的切换点：内容超出时 ↑↓ 改为滚动，焦点环就不再跟随，需要像 ph 那样在 `ui.scroll` 里用 `$.ui.focus` 自己移动焦点环。
3. 触控板惯性滚动时 `by` 的大小与频率（关系到使用者记忆里的"触控板优先"）。

---

## 5. 宽度请求（不存在 `preferredColumns`）

- 字段名是 **`columns`**，没有 `preferredColumns`。含义是"dock 在全屏 transcript 旁时，内容想要的 body 列数，dock 就开这么宽、上下撑满"。**只是请求，不保证**：使用者拖动或按键调过的宽度（本会话的，或保存下来的）优先；inline 时忽略；不给时用默认份额；每次 open 都重新设置（`d.ts:7448-7461`、`docs/interface:321`）。
- 对应的 inline 高度字段是 `rows`：默认三分之一，最多到布局能让出的高度，使用者调过的高度优先，dock 时忽略（`d.ts:7440-7447`、`docs/interface:320`）。
- 使用者用 `ctrl+x` 加方向键调整大小（`docs/interface:515`）。
- 版本：2.1.287 起（推断）。
- 需实测：使用者调过的宽度"kept"保存在哪个范围（按插件+id？是否跨会话？）；有多个标签时 dock 宽度是共用一个，还是随当前标签的 `columns` 变化。

---

## 6. 状态栏 `$.ui.status`

- `$.ui.status(text)` 把一行固定在 prompt 下面，和引擎自己的固定通知并排，直到下一次调用替换。每个插件只有一行；`$.ui.status(undefined)` 清除。终端上只画前 2,000 个字符，远程 surface 是 10,000（`d.ts:2467-2477`、skill-ref 第 129 行）。
- 显示形式：**以 `⚠` 加 mod 名开头**，例如 `⚠ my-mod: checks: 3 passing`（`docs/api:122`、`docs/api:130`）。"⚠"带有警示意味，用来显示"目录已就绪"这类中性信息可能会误导（参见使用者记忆中"不要误导性的界面文字"），**建议 chat-toc 只在真有缺口时用**，比如"终端过窄，目录未显示，/chat-toc 打开"。
- 官方 diff 用 status 表示"已武装的 ask"，解除时 `status(undefined)`（`diff@e47cc82 hooks/register.ts:529-533`、`:675`）。
- 版本：2.1.287 起（推断）。
- 需实测：模块 reload 或卸载后，旧实例设的 status 是保留还是被清掉；`/clear` 之后是否保留。

---

## 7. 与其他 mod 的 Pane（如 cc-plugin-diff）成为标签页

- 所有 Pane 是**一组实例，同一时刻只显示一个，其余是标签**（`d.ts:10302-10304` 原文 "one instance per id (`requestId`), its body the hook's tree, one shown, the rest tabs"）。`title` 只在打开了不止一个 Pane 时作为标签名画出来，只有一个时不画标题（`d.ts:10314-10321`、`d.ts:7398-7404`）。
- 切换方式：点击标签，或用 Tab 移到标签上再按 Enter（`d.ts:10317-10318`）；`ctrl+x tab`（`d.ts:10306-10307`）。别人的标签和关闭标记都是焦点环上的引擎停靠点，这时 `ui.focus` 的 `element` 为空（`d.ts:13880-13885`）。
- `$.ui.panes()` **只列本插件的 Pane**，看不到 diff 的（`d.ts:2519-2521`），但可以用 `isShown` 判断自己是不是当前显示的那张（`d.ts:14178-14181`）。
- `cc-plugin-diff` 是内置 mod，在交互式终端会话里默认开启（`docs/overview:232`），会在 Claude 第一次编辑文件时于全屏 ≥144 列（使用者以前开过则 ≥110）自动打开，使用者关掉后跨会话保持关闭（`docs/interactive-mode:572`，以及 `diff@e47cc82 hooks/register.ts:478-517`）。所以 chat-toc 跟它**成为标签是常态**，不是边缘情况。
- 其他插件可以 hook `ui.open` 改标题或 `{ deny }`，但不能改名（`d.ts:7007-7011`）；理论上 diff 能拒绝 chat-toc 的 open，实际上它的源码没 hook `ui.open`（README "What it hooks" 表中没有）。
- 版本：2.1.287 起（推断）。
- 需实测：(1) chat-toc 已显示时 diff 自动打开，谁在前面？(2) 两者都开时，一方关闭后另一方是否自动显示、是否重新 render；(3) 背后标签的 render 是否暂停（关系到后台更新目录的开销）；(4) 两个 Pane 各请求了 `columns` 时 dock 宽度怎么定；(5) 不带 `focus` 的 open 会不会抢到前面。

---

## 8. reload 之后：Pane 是否保留，开关状态记在哪

### 8.1 Pane 本身

- **热重载不会关掉 Pane**：`$.ui.panes()` 返回的是"The engine's record, not the module's: a module reloaded while its pane stayed up finds it here"（`d.ts:2516-2521`）。d.ts 示例本身就是"先查 panes，没有才 open"（`d.ts:2523-2525`）。ph 的 render 里处理了"由已重载前的模块实例打开、留到现在的 Pane"（`ph:7928-7934`），是本仓库的实际经验。
- **但 `session.start` 在每次 reload 后都会再触发**（`docs/reference:106` "again after a reload of that mod"、`docs/interface:797`、`docs/interface:812`）。所以 reload 后的 `session.start` 必须先查 `$.ui.panes()` 和"本会话已关闭"标记，不能直接 open：否则会把使用者已经关掉的目录又弹出来。`/clear`、`/resume`、`/branch` 之后 `session.start` **不会**触发（同一处）。
- 卸载或停用插件时，以 `unload` 关闭，开启者的 hook 不会被调用（`d.ts:7366-7370`）。reload 失败时，上一版继续运行（`docs/troubleshoot:226`）；`changelog:213`（2.1.290）修了"失败 reload 之后紧接刷新、mod 被无声卸载"的问题。
- 热重载触发条件：`--plugin-dir`、`CLAUDE_CODE_PLUGIN_DIRS` 文件夹或 skills 文件夹里有保存时重载，环境全新，旧 timer 丢弃；本会话 turn 进行中的保存，等 turn 结束才重载（skill-ref 第 72-73 行）。marketplace 安装版要靠 `/reload-plugins` 重新读取（skill-ref 第 76 行、`docs/reference:311`）。

### 8.2 状态放哪

| 存放处 | 存活到 | 适合 chat-toc 的什么 | 出处 |
| --- | --- | --- | --- |
| 模块级变量 | 下一次 reload | 只能放可以丢的缓存（diff 的 `isPaneOpen` 就是模块变量，`register.ts:46`，靠 `ui.close` 和 `panes` 纠正） | `docs/interface:704`、`docs/troubleshoot:192-194` |
| `$.state` | 会话结束，或 `/clear`、`/resume`、`/branch`（这三个会把它重置为默认值）；**reload 后保留** | "本会话已被使用者关闭"、滚动位置、`isFollowing`。render 中读取会自动订阅重绘 | `docs/interface:705`、`docs/interface:712`、`docs/interface:786`、skill-ref 第 118 行 |
| `$.store` | 跨会话，直到 mod 删除，或 `cleanupPeriodDays` 内没有任何会话读写；单插件 JSON 文件位于 `~/.claude/plugins/store/`；上限 4 MiB；**所有会话共享，get/set 不是原子操作** | 如果以后要"跨会话记住不想要目录"，就放这里（diff 就是这样，`register.ts:812`、`:850`、`:485-497`） | `docs/interface:706`、`docs/interface:818`、`docs/reference:275` |

- `$.state` 需要在 `PluginState` 里声明，用 `atom/read/update` 读写；render 里不能写，要在 `onPress`、`ui.close` 这类 hook 里写（skill-ref 第 118 行、`docs/interface:714-769`）。
- 推论：用 `$.state` 记"本会话已关闭"，reload 之后的 `session.start` 能读到这个标记，就不会再弹。`/clear` 等重置之后标记回到默认（未关闭），但这时 `session.start` 不会触发，所以也不会自动弹，除非之后又发生一次 reload。这个边缘情况可以接受，也可以在 `classic.SessionStart`（`source` 为 `clear`/`resume`/`fork`）里处理（`docs/interface:786-788`）。
- 推断：引擎本身不会因 `/clear` 或 `/resume` 关闭 Pane。diff 在 `/resume` 时主动关闭，在 `/clear` 时保留（`diff@e47cc82 hooks/register.ts:899-930`）。这暗示引擎不替插件关闭，需实测。
- 版本：2.1.287 起（推断）。`changelog:415`（2.1.288）修了"重启后在旧视图上点 Button 会执行别的 Button 的动作"的问题。

### 8.3 必须实测

1. `/reload-plugins`（marketplace 安装版）与 `--plugin-dir` 热重载，对 Pane 和 `$.state` 的影响是否一样。
2. reload 后的第一次 render 是不是由新模块的 hook 来画（中间是否闪一下引擎自己的空 Pane）。
3. `/clear`、`/resume` 后 Pane 是否还在、`$.ui.panes()` 的返回。

---

## 对 chat-toc 的直接含义（从上面推出，不是结论之外的新事实）

1. 启动时不要在 `session.start` 里直接 open。在那里只注册命令并读 `$.state`，然后学 diff，在 `PromptHint` render 第一次量到 `viewport` 时判断：`isFullscreen === true`、未被本会话关闭、`$.ui.panes()` 里没有它、列数达到门槛，才 open。门槛可以交给引擎判断，看 `isPlaced` 就行。
2. 不设 `closeOnEscape`，避免在空 prompt 按 Esc 误关；使用者关闭靠 ✕ 或 `ctrl+x x`，在 `ui.close` 里以 `person` 识别，写入 `$.state`。
3. `/chat-toc` 做成切换或强制重开都行。在命令里 open 算请求，可以清掉"已关闭"标记；非全屏时可以选择拒绝，或 inline 打开（由 `presentation.isFullscreen` 判断）。
4. 列表滚动用自有窗口加 `ui.scroll` 返回 `{}`，只画可见段并多画几行，自己维护 `isFollowing`；行用 `plain Button`，↑↓/Enter 交给引擎的焦点环，超出时参照 ph 在 `ui.scroll` 里接住箭头。
5. 要把"跟 diff 成为标签"当作常态来设计和验收。

## 残余不确定点汇总（需原型实测）

| # | 点 | 关联章节 |
| --- | --- | --- |
| 1 | 已 dock 的 Pane 在终端变窄（<110/<144）时变成 inline 还是取消落座 | 1.5 |
| 2 | 在 `PromptHint` render 中（借 `session.start` 的 `$`）调 `$.ui.open` 是否可靠 | 1.4/1.5 |
| 3 | 110 记忆的范围（插件+id、开发版与安装版） | 1.5 |
| 4 | dock 模式边框上 ✕ 的位置，Esc 关闭的 origin | 2 |
| 5 | open 已开但在背后的 id 时，带或不带 `focus` 是否会提到前面 | 3、7 |
| 6 | 树不高于 `bodyRows` 时 `ui.scroll` 是否还会触发 | 4.5 |
| 7 | 箭头在"能放下"与"超出"之间切换时焦点环的行为 | 4.5 |
| 8 | 使用者调过的 dock 宽度保存在什么范围，多标签时宽度怎么定 | 5 |
| 9 | reload、卸载、`/clear` 后 status 是否保留 | 6 |
| 10 | 与 diff 共存时的显示顺序、背后标签是否 render | 7 |
| 11 | `/reload-plugins` 与热重载对 Pane、`$.state` 的影响是否相同；`/clear`、`/resume` 后 Pane 是否保留 | 8.3 |
| 12 | 上面所有"2.1.287 起（推断）"在 2.1.287 实机上是否成立（本机只有 2.1.295 的 d.ts；changelog 镜像缺 2.1.294/2.1.295） | 版本判断方法 |
| 13 | 依赖引擎 `'end'` 跟随时，下限实际上是 2.1.290 | 4.3 |
