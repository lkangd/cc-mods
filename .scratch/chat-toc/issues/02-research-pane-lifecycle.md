# 核实停靠 Pane 的生命周期与放置规则

Type: research
Status: resolved
Blocked by: 

## Question

在 Claude Code `>=2.1.287` 的公开 mods API 中，停靠 Pane 的确切规则是什么：`session.start` 时主动 `$.ui.open` 的放置阈值（144 列 / 110 列、全屏与否）、宽度不足时的排队与之后自动落座、`isPlaced` 与 `placement` 的取值；使用者关闭（Esc、✕、ctrl+x x）时 mod 收到什么、能否区分并记住「本会话已关闭」；`/chat-toc` 命令重开的行为；Pane 内的鼠标点击、焦点、↑↓/Enter 按键、滚动由谁拥有；`preferredColumns` 之类的宽度请求；状态栏 `$.ui.status` 的显示与清除；与其他 mod 的 Pane 成为标签页时的行为；reload 后 Pane 是否保留。逐项注明版本可用性与需原型实测的点。

## Answer

研究文档在分支 `research/chat-toc-pane-lifecycle`（提交 e1a8899，不合并）的 `docs/research/chat-toc/02-pane-lifecycle.md`。头号参照是官方内置 mod `cc-plugin-diff`（anthropics/claude-code@e47cc82 `mods/diff/`）：自动弹出、记住关闭、只在 dock 时自动开、自管滚动，形状与 chat-toc 几乎一致。

- **放置**：是否落座看「是否使用者请求」：命令/prompt/控件触发的任意宽度落座；`session.start` 等非请求需 ≥144 列，使用者请求打开过且未手动关过则降到 110，手动关一次回到 144。坐在哪看布局：全屏 ≥110 列 dock，否则 inline。宽度不足返回 `{isPlaced:false, reason}`，Pane 已开但不画，变宽或使用者打开后自动落座。**没有「只要 dock」开关**：照 diff 的做法，在 render 里读 `viewport.isFullscreen`（会话内不变），为 true 才自动打开，`isPlaced:false` 时立刻关掉撤回。
- **关闭**：✕、`ctrl+x x`、（启用 `closeOnEscape` 时的）Esc 都触发 `ui.close`，`origin.kind === 'person'`，分不出哪种；在 hook 里 `next` 之后记下。建议**不设 `closeOnEscape`**，否则空闲时按 Esc 会误关目录。
- **`/chat-toc` 重开**：命令内 open 算请求、任意宽度落座；对已开的 id 再 open 只改标题；`focus:true` 只在输入框为空时生效；注册时加 `immediate:true` 才能在 Claude 工作中途用。
- **按键与滚动**：mod 不能绑定 Tab 或方向键；↑↓ 放得下时走焦点环、超出时滚动；Enter 按下聚焦的 Button；全屏单击触发 `ui.press`。可 hook `ui.scroll` 返回 `{}` 自管偏移、只画可见段（diff 与 prompt-history 都这么做）。引擎的 `$.ui.scroll({to:'end'})` 到 2.1.290 才修好无限重绘，故跟随最新由 mod 自己维护 `isFollowing`，保住 `>=2.1.287` 下限。一棵树只画前 100,000 字符，按需渲染是必须的。
- **宽度**：请求字段是 `columns`（无 `preferredColumns`），使用者调过的宽度优先。
- **状态栏**：`$.ui.status(text)` 每插件一行，带 `⚠ 模块名:` 前缀，`undefined` 清除；只在真有缺口（终端过窄、非全屏）时用。
- **与 diff 共存**：同一时刻只显示一个 Pane，其余是标签；diff 在首次编辑文件时自动打开，并排是常态；`$.ui.panes()` 的 `isShown` 可知自己是否在前。
- **reload**：热重载不关 Pane，但 `session.start` 会再触发，须先查 `$.ui.panes()` 与「本会话已关闭」标记。该标记放 `$.state`：reload 保留，但 `/clear`、`/resume`、`/branch` 会重置（即这些操作后会再次自动弹出）；跨会话偏好（View filter）放 `$.store`。
- **版本**：Pane 相关 API 无「Requires」标注且 2.1.287 自带的 diff 已在用，推断 2.1.287 即有，需实机核对；明确更晚的有 `$.ui.selection` 2.1.288、`ui.fault` 2.1.289、跟随末尾重绘修复 2.1.290。
- **留给原型实测**：已 dock 后变窄是改 inline 还是取消落座；在 render 里打开 Pane 是否可靠；110 记忆的范围；树不超窗口时 `ui.scroll` 是否触发；对背后的 id 再 open 会否提前；dock 宽度的保存范围；与 diff 共存时谁在前、背后标签是否继续 render；reload、`/clear`、`/resume` 后 status 与 Pane 是否保留。
