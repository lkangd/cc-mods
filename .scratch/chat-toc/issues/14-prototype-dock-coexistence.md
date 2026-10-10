# 决定与其他停靠 Pane 共存的行为

Type: prototype
Status: resolved
Blocked by: 

## Question

`cc-plugin-diff` 等其他 mod 也打开停靠 Pane 时，宿主会把它们变成标签页。在本机实测两者同时启用后，需要决定：
- 会话启动时 chat-toc 自动弹出，是否抢占前台标签；
- 另一个 Pane 关闭后，chat-toc 如何回到前台；
- 使用者关闭 chat-toc 后，与另一个 Pane 的「本会话已关闭」状态是否互相影响；
- Current position 跟随与高亮在后台标签里是否照常更新。

结论供 `CT-COEX-001` 引用。

## Answer

**结论（使用者已确认）**：chat-toc 完全照宿主的标签规则走，不追踪、不抢夺别的插件的 Pane。
- **自动弹出**：会话启动、`/clear` 或 `/resume` 后重开时，如果别的 Pane 已经开着，就照宿主规则放到前台，对方退为标签。不额外判断。
- **前后台切换**：别的 Pane 中途打开把 chat-toc 挤到后台，或者它关闭后 chat-toc 回到前台，chat-toc 都不做任何事：不用 `focus` 抢回前台（会拿走键盘），也不提示。
- **关闭状态**：各管各的。只有 `e.id === 'toc'` 且 `origin.kind === 'person'` 的 `ui.close` 才记「本会话已关闭」。别的 Pane 怎么关都不碰这个标记，关掉 chat-toc 也不影响对方。
- **后台更新**：后台不画，数据层照常（transcript hook 照常算 Current position、写 `$.state`）。如果 Current position 在 chat-toc 不在前台时变了（`$.ui.panes()` 里 `isShown === false`），就撤销手动滚动造成的跟随暂停。这样回到前台的第一帧就会滚到当前高亮的组。

**宿主事实（2.1.287 与 2.1.295 实测一致，170×44 全屏）**
1. 新打开的 Pane 总在前台，不论是否由使用者请求、是否带 `focus`：别的插件由 timer 打开、`/diff`、`/clear` 后重开的 chat-toc 都是这样。
2. 对已开但在后台的 id 再 `$.ui.open`：不带 `focus` 时不提前（只返回 `{isPlaced:true}`）；带 `focus` 且输入框为空时会提前，并拿走键盘。
3. 前台 Pane 被关掉（插件 `close`，或使用者点 ✕）后，剩下的那个自动回到前台，第一帧就用最新的 `$.state` 画。点标签切换也一样，但点标签不给焦点。
4. 后台标签完全不调 Pane 的 render hook（日志里「隐藏时的 render」都是变为显示后的第一帧，早于 500 ms 的 `panes()` 轮询记录）。
5. dock 宽度跟随前台标签请求的 `columns`（TOC 44 / Other 50 / Diff 约 80）。chat-toc 的宽度只在它在前台时生效。
6. `ui.open` / `ui.close` hook 能看到别的插件（包括内置 `diff`）的开关事件，带它们的 `id` 和 `origin`；`$.ui.panes()` 只列自己的。
7. 只有一个 Pane 时不画标签行。2.1.295 在第 0 行画 ✕，2.1.287 把 ✕ 画在内容第一行的右侧。
8. **新发现，影响「定稿兼容与验收契约」的 `CT-LIFE-002`**：`session.start` 在 `/clear` 时**不触发**（d.ts 原文 "never `/clear`"），实测也是这样。只在 `session.start` 里自动打开的话，`/clear` 后不会再弹出（`$.state` 确实被重置了）。实现时要 hook `classic.SessionStart`，在 `source` 为 `clear` 或 `resume` 时按同样条件（未被本会话关闭、`panes()` 里没有）打开。探针在两个版本上都验证可行，重开的 TOC 会到 Diff 前面。另外 `/clear` 也会把其他 `$.state` atom 重置为默认值（tick 归 0）。

**未测**：Diff 在 Claude 首次编辑文件时的真自动打开要调用模型，没测；用 timer 打开的 Other（同属未请求的打开）代替，结果与 `/diff` 一致。

**资产**：`assets/14-coexist/`。`toc-coex/` 是 chat-toc 的替身，在 `session.start` 和 `classic.SessionStart` 里自动打开，每 500 ms 写一次 `$.state` 并记 `isShown`；`other-coex/` 是会自己打开的另一个 dock Pane。`drv.py` 是私有 PTY 驱动，`run.sh` / `cmd.sh` / `scr.sh` / `seq.sh` 是驱动脚本，其中 `seq.sh` 是 2.1.287 的完整序列。`logs/seq-287.txt` 是每一步的前台标签截屏，`logs/toc-*.json` 是事件日志。
