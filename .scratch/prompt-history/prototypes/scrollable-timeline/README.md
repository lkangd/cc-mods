# 可滚动时间线一次性原型

> THROWAWAY PROTOTYPE：只用于回答《原型验证可滚动时间线》，不得迁入正式实现。

目标版本：Claude Code `2.1.273`。本目录有两层资产：

- [`scrollable-timeline.prototype.html`](scrollable-timeline.prototype.html)：先确定交互规则的纯内存逻辑演示。
- [`plugin/`](plugin/)：在真实 `AbovePrompt` 上验证这些规则能否由 function-hooks API 实现。

## 已锁定的候选规则

1. 默认折叠；点击标题或 `/prompt-history` 展开。
2. 位于底部时跟随新条目；查看旧历史时保持位置并累计新条目提示。
3. 成功跳转后折叠时间线并期望焦点回到 composer；失败时保持展开。
4. `hasSurvey=true` 时完全让出 `AbovePrompt`，survey 结束后恢复原视窗、游标与待确认状态。
5. 回退父节点不唯一时 drop 本次提交、暂存草稿并显示候选；选择后只 `prompt.fill`，不自动提交。

真实原型要核实这些规则中的宿主行为，特别是自动聚焦、键盘滚动、跳转后的焦点、窄终端和 survey 让出。

## 数据边界

- 只在新开的测试会话中输入下面的合成文本，不要输入真实敏感内容。
- 原型在内存中保存并显示完整测试 prompt；Claude Code 自身仍按正常方式保存会话 transcript。
- `traces/*.jsonl` 只记录事件、尺寸、序号、文本长度和宿主拒绝原因，不记录 prompt 原文。
- 插件不访问网络、不修改全局设置、不写项目配置，也不使用第三方运行时依赖。

## 启动目标版本

仓库当前全局 `claude` 可能不是 `2.1.273`，因此用固定 npm 版本启动：

```bash
env -u CLAUDECODE CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 \
  npx -y @anthropic-ai/claude-code@2.1.273 \
  --plugin-dir .scratch/prompt-history/prototypes/scrollable-timeline/plugin
```

启动后先确认 `prompt-history` 在输入框上方只占一行。

## A. 折叠、滚动与焦点

1. 运行 `/prompt-history`。
2. 观察是否直接出现选中环；若状态行出现“宿主拒绝自动聚焦”，记下拒绝原因。
3. 若尚未聚焦，按 `ctrl+x tab` 或点击时间线条目取得焦点。
4. 依次尝试鼠标滚轮、`↑`、`↓`、`PageUp`、`PageDown`、`Home`、`End`。
5. 确认时间线连续移动，没有页码；到达已载入范围上沿时继续滚动应增加“已载入”数量，并保持可读位置。
6. 在旧合成条目上按 Enter 或点击；它应显示不可跳转原因并保持展开。
7. 按 Esc，确认键盘回到 composer；再次点击折叠标题，确认鼠标路径能展开并选中条目。

需要记录：

- `/prompt-history` 能否在不额外按键的情况下把焦点交给 `AbovePrompt`。
- wheel、PageUp/PageDown、Home/End 是否都会触发 `ui.scroll`。
- `↑/↓` 到视窗边缘时，焦点能否无跳闪地进入下一批虚拟行。

## B. 新条目与真实 Jump Target

1. 提交 `PH-LIVE-A：只回复 ACK-A`，等待完成。
2. 再次提交完全相同的 `PH-LIVE-A：只回复 ACK-A`，等待完成。
3. 粘贴并提交：

   ```text
   PH-LIVE-B 第一行
   PH-LIVE-B 第二行：只回复 ACK-B
   ```

4. 展开 prompt-history；新条目应分别存在并显示 `↵`，多行列表文本应以 `↵` 压平。
5. 滚到较早位置，按 Esc 回 composer，运行 `/prompt-history-probe-add 2`。
6. 重新聚焦时间线；视窗应留在原位置并显示 `2 新`，选择“较新”或滚到底后清零。
7. 对一条 `↵` 条目按 Enter；应滚到对应 transcript row 并折叠 prompt-history。立即键入一个字符再删除，用来判断焦点是否已经回到 composer。

需要记录：

- 两条重复文本是否各自保留并拥有独立 Jump Target。
- 跳转成功后折叠是否发生，焦点是否自动回到 composer。
- 查看旧历史时新增条目是否完全不改变视窗。

## C. 窄终端

1. 展开时间线，把终端逐步缩窄到约 50 列、35 列、低于 28 列。
2. 约 50 列时应隐藏部分时间元数据并保持一行一个事件；文本应按 `bodyColumns` 截断。
3. 低于 28 列或可用高度少于 6 行时，应只保留折叠控制与“空间不足”提示。
4. 恢复终端大小，确认原视窗和选中条目恢复。

## D. survey 槽位竞争

1. 让 Claude 调用一次 `AskUserQuestion`，例如输入：`请只调用 AskUserQuestion，询问我选择 A 还是 B。`
2. survey 出现时，prompt-history 必须完全让出 `AbovePrompt`。
3. 回答 survey 后，prompt-history 应按此前的展开状态、视窗与游标恢复。

`hasSurvey` 是 `2.1.273` 对槽位占用给出的明确契约；任意其他插件之间没有通用“已占用”字段，本原型不把插件链顺序误当作可检测的占用状态。

## E. 回退父节点歧义与草稿恢复

1. 运行 `/prompt-history-probe-ambiguity`。
2. 提交下面的两行文本；它不应进入会话：

   ```text
   PH-DRAFT 第一行
   PH-DRAFT 第二行：不得自动提交
   ```

3. 父节点候选应出现并取得焦点。按 Esc 后再按 Enter 尝试提交，仍应被阻止，且最新草稿继续暂存。
4. 用 `↑/↓` 与 Enter，或鼠标点击一个候选。
5. 候选界面应折叠，原草稿应恢复到 composer，但不会自动提交。

## 导出证据

在测试会话中运行：

```text
/prompt-history-probe-report
```

退出测试会话后，在仓库根目录运行：

```bash
node .scratch/prompt-history/prototypes/scrollable-timeline/summarize.mjs
```

重点查看：

- `focus.request` 的拒绝原因；
- `ui.scroll` 对 wheel、Page、Home/End 的 `by` 值；
- `survey.yield` / `survey.restore` 是否配对；
- `jump.request.deny`；
- `parent.chosen.isFilled`。

## 二次定向验证

首次真人走查确认 Jump Target、新条目、鼠标点击与草稿恢复成立，同时暴露四个宿主约束：`AbovePrompt` 不能由插件抢焦点、插件自管的等高虚拟窗口收不到触控板滚动、按 Unicode code point 截断会让中文换行、`hasSurvey` 未随实际 `AskUserQuestion` 生效。

修订版改为：

- 主时间线绘制一个真正高于窗口的已载入树，由引擎拥有滚动窗口；`ui.scroll` 只在上沿增量加载并校正 offset。
- 按终端 cell 宽度截断中文与 emoji，不允许 prompt row 换行。
- 在 `tool.call(AskUserQuestion)` 生命周期内主动让出 `AbovePrompt`。
- 回退父节点候选改用 `focus: true` 的 Pane；确认后关闭 Pane，再恢复草稿。
- `AbovePrompt` 焦点离开到 composer 时同步折叠；主时间线仍明确要求用户按 `ctrl+x tab`，不再伪装能够自动抢焦点。

只需复测：

1. `/prompt-history` 后按 `ctrl+x tab`，确认触控板滚动会移动时间线；按 Esc 后时间线应折叠。
2. 缩到约 30–40 列，确认每条 prompt 始终单行并直接显示省略号。
3. 让 Claude 调用 `AskUserQuestion`，确认问答期间 prompt-history 消失，回答后恢复。
4. `/prompt-history-probe-ambiguity` 后提交测试草稿，确认父节点 Pane 自动取得焦点，选择后草稿恢复且不自动提交。
5. 最后运行 `/prompt-history-probe-report` 并退出。

## 真人实测结论

- **成立**：重复与多行 Prompt Entry、真实 Jump Target、成功跳转后折叠并回 composer、旧历史位置保持与新条目提示、鼠标 hover/点击、cell-aware 单行截断、AskUserQuestion 全程让出后恢复、聚焦父节点 Pane、drop 后草稿恢复且不自动提交。
- **宿主限制**：`/prompt-history` 与标题点击都不能把焦点强行交给 `AbovePrompt`，`$.ui.focus` 返回 `that site does not hold the keyboard`；必须由用户按 `ctrl+x tab` 或点击取得键盘。
- **Ghostty 限制**：两版原型都没有收到触控板对应的 `ui.scroll`，即使第二版绘制了真实溢出树；MVP 不把触控板/滚轮列为保证路径，键盘方向键与鼠标点击必须独立完成全部导航。
- **Escape 限制**：Esc 会把键盘还给 composer，但没有产生插件可观察的 `ui.focus`/按键事件，因此不能可靠同步折叠；折叠使用标题点击或再次运行 `/prompt-history`。
- **加载边缘规则**：只渲染已载入范围会让上箭头从最早可见 prompt 跳到标题。最终交互采用一条更早事件作为 overscan；该行取得焦点时预载上一批并保持同一 keyed Button，使下一次上箭头继续到前一条，而不是标题。项目时间线真正起点之后才允许焦点进入标题。
- **占用范围**：`hasSurvey` 未随实测 AskUserQuestion 生效；修订版改为包围 `tool.call(AskUserQuestion)` 生命周期，trace 已捕获 `survey.tool-start → survey.yield → survey.restore → survey.tool-end`。任意第三方插件之间没有通用占用信号，不承诺自动仲裁。

主要证据为 `traces/mu4xz8hj-arauug.jsonl` 与 `traces/mu4z7osd-nt2crn.jsonl`；trace 不含 prompt 原文。

## 静态检查

原型已用目标版本执行：

```bash
npx -y @anthropic-ai/claude-code@2.1.273 plugin validate \
  .scratch/prompt-history/prototypes/scrollable-timeline/plugin

npx -y -p typescript@5.9.3 tsc -p \
  .scratch/prompt-history/prototypes/scrollable-timeline/plugin/tsconfig.json
```

`plugin validate` 通过，仅有一次性 manifest 未填写 author 的提示；TypeScript 检查通过。
