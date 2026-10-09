# 原型验证停靠 TOC Pane 的外观与交互

Type: prototype
Status: resolved
Blocked by: 01, 02, 03, 04, 08, 09, 10, 11

## Question

在真实终端里做一个粗糙的 chat-toc Pane，验证：Turn group 卡片的排版（「你 · 时间」、2 行截断、「N 步」与状态）在常见停靠宽度下是否可读；三态 View filter 的样式与点击/键盘操作；点击与 Enter 跳转是否落到正确行；Current position 高亮与 ↑↓ 选择光标的样式能否一眼区分、TOC 跟随高亮滚动与手动滚动暂停的手感；自动弹出、关闭后保持关闭、`/chat-toc` 重开、宽度不足时状态栏说明；几百轮长会话的滚动是否流畅。产出可交互原型与观察记录。另请确认：「本会话已关闭」标记在 `/clear`、`/resume` 后会被宿主重置、目录会再次自动弹出，这是否可接受。另需实测（来自「决定没有 Jump target 的条目侧如何呈现与点击」）：兜底跳转用 `block: 'center'` 时，原输入行是否留在屏上；`ToolGroup` 的 `collapsed-<前缀>` 能否唯一对上 uuid，非折叠显示时是否改走 `ToolUse`，补挂后 transcript hook 多跑多少；全屏 transcript 是否虚拟化（离屏的行是否都被画出），这决定没被画出的条目能否事先淡化；淡化样式与 Pane 底部说明行的可读性。

## Answer

**结论：停靠 TOC Pane 的外观与交互可行，使用者逐项试过都通过。三种布局都保留，做成可切换的功能。实测改掉了三条前面的决定：取消「事先淡化」；Current position 只采信连续的在屏行，跳转后锁定在目标组；本地命令按 `system/local_command` 行开组。** 原型是 mod `chat-toc-proto`，在本机 Claude Code 2.1.295 的本会话里热重载试用；另用 cmux 全屏 workspace 跑了一份 300 轮的合成 transcript。

- 原型（不合并）：本地分支 `prototype/chat-toc-pane`（e6f96a1）的 `prototypes/chat-toc/05-toc-pane/`。同一份内容也在 [assets/05-prototype/](../assets/05-prototype/)：mod 源码、[观察记录](../assets/05-prototype/notes.md)、cmux 驱动脚本、合成 transcript 生成器、逐次日志。

### 使用者确认的外观与交互

1. **布局**：卡片（「你 · 时间」+ 2 行原文，「↳ N 步」+ 2 行回复，左侧 `▌` 标高亮）、紧凑（每侧一行，`●` 标高亮）、时间轴（左侧时间 + `│`，高亮时变青色 `┃`）三种都保留，由使用者切换，跨会话记在 `$.store`。原型的切换入口是底栏 `‹ ›`、Pane 聚焦时的热键 `v` 和 `/chat-toc a|b|c`，正式入口留给规格。56、44、36 列宽下都可读。
2. **View filter**：顶部 `●全部 ○用户 ○Agent`，Pane 聚焦时也可按 1/2/3；切换后立即重画。
3. **高亮与选择光标**：选择光标用宿主的反色，高亮用青色竖线或圆点，一眼就能分开。
4. **跟随与暂停**：手动滚动 TOC 后暂停跟随（底栏显示「暂停」），Current position 下一次变化时恢复跟随，手感对。
5. **生命周期**：会话开始时自动打开；✕ 关掉后本会话保持关闭；`/chat-toc` 能重新打开；`/clear`、`/resume` 后宿主重置「已关闭」标记、目录再次自动弹出，**使用者接受**。终端不够宽时 `isPlaced:false`，Pane 保持等待，状态栏说明原因。
6. **跳转后锁定高亮**（修订「决定是否做当前位置高亮」）：跳转成功后，高亮直接落在目标组上。跳转引起的重绘每次间隔不到 300 ms，期间保持锁定；重绘停下后视口第一次变化就解锁，恢复按视口顶部计算。原因是兜底跳转用 `center`，视口顶部是上面的组。使用者评价「得劲了」。

### 实测得到的宿主事实（2.1.295）

- **本地斜杠命令**（例如 `/chat-toc`）在 transcript 里记成 `type:system, subtype:local_command` 行，`content` 含 `<command-name>`，在对话链上；输出也是同类的 system 行。`/clear` 本身仍是 user 行。「定义 Turn group 的划分与边界」的开组规则漏掉了这种行。
- **`ToolGroup` 的 `requestId`** 有时是 `collapsed-<完整 uuid>`，有时是 `collapsed-<uuid 前 24 位>000000000000`；按前 24 位匹配能唯一对上。非折叠显示时走 `ToolUse`，`requestId` 是 tool_use id。`UserMessage`、`AssistantMessage`、`CommandOutput` 的 `requestId` 都等于 uuid。
- **全屏 transcript 是虚拟化的**：resume 300 轮后只画最后约 20–25 轮，滚动或跳转到哪里，哪里附近才画出来。行被卸掉时**不一定**再报 `onScreen: null`，残留的「在屏」值会把 Current position 钉在旧位置。早先本会话里「跳到 B 却高亮 A」也是这个原因，和置顶 prompt 条无关。
- **`$.ui.scroll({ requestId })`** 能跳到宿主消息列表里的任意一行，包括从没画出过的（`drawn:false` 也返回 `{}`）。只有不在列表里的行才会被拒，比如 resume 前被 compact 的行、rewind 残留。
- **热重载**后宿主只重画当时在屏的行，而且先于 transcript 读入；`requestId` 的映射必须在每次读完 transcript 后重做。
- **兜底跳转用 `center`** 时，回显行（`❯ /tui`）留在目标行正上方，看得见。
- **置顶 prompt 条**：不需要「只露 1 行不计」的规则。去掉后，直接跳转和逐格滚动的高亮都对上屏幕第 1 行所属的组。

### 由此修订的决定

- **取消 B 类「事先淡化」**（修订「决定没有 Jump target 的条目侧如何呈现与点击」第 3 条）：虚拟化加热重载，「画出过没有」不能说明能不能跳。所有条目照常显示，一律先跳；被拒后才把这一侧淡化，并在 Pane 底部说明。说明的措辞和消失规则沿用原第 4 条。
- **兜底跳转**（修订原第 1 条）：本地命令、prompt 型命令和 `!cmd` 的用户侧，都跳到对话链中**往后**最近的可绘制行（user prompt、带文字的 assistant 行、非空的本地命令输出、画出过的行），往后没有就往前找，用 `center`。被拒就换下一个候选（原型最多试 3 次）。
- **Current position 的计算**（修订「决定是否做当前位置高亮」第 2、3 条的实现）：
  - 只看 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolGroup` 的在屏上报，`ToolUse` 不参与。
  - 把在屏行按对话顺序分段：两行之间只要夹着一个不在屏的可绘制行，就切开；只采信包含最近一次上报的那一段，取其中最靠前的行。
  - 最后一个画出的行完整在屏时，强制末组；跳转后的锁定见上文第 6 条。
- **`requestId` → 行**：先精确匹配 uuid，再去掉 `collapsed-` 前缀，再按 tool_use id，最后按前 24 位匹配。跳转时用宿主给的那个 id，不用 uuid。
- **开组规则**（补充「定义 Turn group 的划分与边界」）：`system/local_command` 中带 `<command-name>` 的行开组；它的输出行归入该组。贴入内容的 `<pasted_content>` 标签显示时去掉。

### 性能样本（合成 300 轮、1.5 MB）

- 整份读取加解析：冷启动 376 ms，之后每次 9–49 ms。本会话的真实 transcript 约 1.6 MB，每次 13–20 ms。
- Pane 只画可见窗口，每次重画约 7.5 ms（连续滚轮期间 139 次共 1040 ms）。连续滚轮 180 格后，高亮与屏幕顶行一致。
- 20 MB 级文件的首次解析与增量读取没有测，留在「长会话的渲染与性能」。

### 其他

- 测试中有一次误操作：`/exit` 没生效，重启命令被当成 prompt 提交，触发了一次 Haiku 调用（没有调用工具）。合成 transcript 与测试 workspace 都已删除。
- 术语：`mods/chat-toc/CONTEXT.md` 修订 Current position、Jump target，新增 Layout。
