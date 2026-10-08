# 原型验证可滚动时间线

Type: prototype
Status: resolved
Blocked by: 01, 02, 08

## Question

怎样的 `AbovePrompt` 交互原型能在不分页的前提下，为持久时间线提供连续滚动、按需加载、鼠标与键盘导航、焦点管理、新条目提示、运行期与 `/clear` 强分隔，并在窄终端和其他 UI 占用槽位时保持可用；当回退父节点无法唯一匹配时，怎样阻止本次提交、聚焦候选确认并在选择后恢复草稿？

## Comments

- 已完成规则走查的一次性交互资产：[`Prompt Trail 交互台`](../prototypes/scrollable-timeline/scrollable-timeline.prototype.html)。这是单文件、纯内存的逻辑原型，覆盖连续浏览、新条目、窄终端与槽位竞争、回退歧义、失效跳转目标五个场景。
- 真人终端实测资产与步骤：[`可滚动时间线一次性原型`](../prototypes/scrollable-timeline/README.md)。首轮 trace 确认 Jump Target、新条目保持、鼠标点击与草稿恢复成立；同时暴露自动聚焦被宿主拒绝、等高虚拟窗口无触控板滚动、中文截断换行、实际 AskUserQuestion 未触发 `hasSurvey`、父节点确认未聚焦。修订版改用引擎滚动、cell-aware 截断、`tool.call(AskUserQuestion)` 让出和聚焦 Pane，并再次通过 Claude Code `2.1.273` 校验与 TypeScript 检查；定向复测结果与最终约束已记录在 README。

## Answer

采用“折叠标题 + `AbovePrompt` 连续列表 + 必要时聚焦 Pane”的交互模型，并明确接受 Claude Code `2.1.273` 的焦点与终端输入限制：

1. **折叠与展开**：默认只显示一行 `Prompt Trail` 标题；点击标题或 `/prompt-history` 切换展开。宿主有意保留键盘所有权，实测 `$.ui.focus` 对命令与标题点击均返回 `that site does not hold the keyboard`，所以展开不得声称自动聚焦；界面明确提示用户用 `ctrl+x tab` 或鼠标取得焦点。
2. **连续列表与按需加载**：按旧到新绘制，运行期、`/clear` 与分支边界各占一行。加载范围采用一条更早事件作为 overscan；最早可见 prompt 取得焦点时预载上一批并保持同一 keyed Button，使上箭头继续到前一条，只有到达项目时间线真正起点后才进入标题。不得再次使用只绘制等高窗口且期待 `ui.scroll` 的方案。
3. **键盘、鼠标与触控板**：方向键选择、Enter 激活、鼠标 hover/点击均已实测成立；PageUp/PageDown/Home/End 的 API 契约保留，但本机键盘无法实测。Ghostty 中两版原型均未收到触控板对应的 `ui.scroll`，即使列表真实溢出，因此触控板/滚轮不是 MVP 保证路径；无它们时仍须仅靠方向键与点击走完整条时间线。
4. **Escape**：Esc 能把键盘还给 composer，但没有插件可观察的按键或焦点离开事件，不能可靠同步折叠。最终契约是“Esc 仅退出焦点，列表可保持展开”；折叠使用标题或再次运行 `/prompt-history`。
5. **新增与跳转**：位于底部时跟随新增 Prompt Entry；查看旧历史时保持位置并累计新条目提示。失效条目保留、显示 `×`、激活不折叠；有效条目显示 `↵`，跳转成功后折叠且焦点回 composer。重复与多行 prompt、独立 requestId、旧位置保持与成功跳转均已真人验证。
6. **窄终端**：每个 prompt 永远只占一行；先以 `↵` 压平多行，再按终端 cell 宽度（CJK/emoji 计双宽）截断并直接加省略号。空间低于 28 列或 6 行时降级为折叠控制与空间不足提示；尺寸恢复后保留状态。修订版已验证 30–40 列不再换行。
7. **槽位竞争**：实测 AskUserQuestion 没有让 `AbovePrompt.hasSurvey` 生效；必须在 `tool.call(AskUserQuestion)` 的整个 `next(e)` 生命周期内让出，结束后恢复原展开与选择状态，定向 trace 已验证。第三方插件之间没有通用“槽位已占用”信号，不承诺自动仲裁；插件链顺序冲突属于兼容限制。
8. **歧义父节点**：composer 提交先 drop 并把完整草稿保存在内存；候选改用 `$.ui.open({ focus: true })` 的 Pane，方向键、Enter 和点击均可选。确认后先关闭 Pane，再 `$.prompt.fill()` 恢复草稿，绝不自动重提；再次提交前未确认则继续 drop。Pane 自动聚焦与 `isFilled=true` 已真人验证。

主要证据是 [`traces/mu4xz8hj-arauug.jsonl`](../prototypes/scrollable-timeline/traces/mu4xz8hj-arauug.jsonl) 与 [`traces/mu4z7osd-nt2crn.jsonl`](../prototypes/scrollable-timeline/traces/mu4z7osd-nt2crn.jsonl)：前者含 6 次成功 Jump Target 请求与新条目行为，后者含 `survey.tool-start → survey.yield → survey.restore → survey.tool-end`、9 次父节点 Pane 焦点事件及 `parent.chosen(isFilled=true)`；两者均不保存 prompt 原文。
