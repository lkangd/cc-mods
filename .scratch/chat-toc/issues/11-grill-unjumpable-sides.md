# 决定没有 Jump target 的条目侧如何呈现与点击

Type: grilling
Status: resolved
Blocked by: 

## Question

实测表明下面这些 User input 或 Agent reply 在 transcript 中没有可挂钩的绘制站点，或者没被绘制，因此没有 Jump target：本地斜杠命令的回显行（只有下一行 `CommandOutput` 能跳）、prompt 型斜杠命令的输入行、`!cmd` 的输入行与输出行、rewind 抛弃的行、resume 后 compact 之前没被画出的行。它们在 Chat TOC 里怎么呈现（照常显示还是置灰，要不要说明原因）？点击时做什么（跳到最近的可跳行，比如本地命令跳到它的 `CommandOutput`、`!cmd` 跳到下一组；还是不跳，但要让人感知到）？本地命令跳到输出行算不算「跳到该 prompt」？`$.ui.scroll` 返回 `nothing drawn under that requestId` 时怎么反馈？Current position 落在这些行上时怎么归组？

## Answer

**按两类处理。A 类：本身画在屏上、只是没有站点的行（本地命令回显、prompt 型命令输入行、`!cmd` 两行）。点击时跳到紧邻的已画出行，算作跳到了该 prompt。B 类：没被画出的行（resume 后 compact 之前的行、rewind 后残留的旧分支）。事先淡化，点击不跳，并在 Pane 内说明。** 所依据的宿主事实：`$.ui.scroll` 的 `block` 支持 `start | center | end | nearest`；`to: 'start'/'end'` 只能滚本插件自己的 Pane，滚不到 transcript 末尾；没有按行偏移跳转的参数。

1. **A 类兜底跳转**：跳到 transcript 中紧随其后、本进程画出过的那一行。本地命令跳到它的 `CommandOutput`；prompt 型命令的用户侧跳到本组第一个画出的行；`!cmd` 跳到下一个画出的行，后面没有就跳到前一个。兜底跳转用 `block: 'center'`，让原输入行留在目标行上方的屏上；直接跳转保持 `start`。条目样式不区分，不加提示。目标行比一屏还高时，原输入行会被切掉，这个代价接受。
2. **补挂 `ToolGroup`**：只读 `requestId`（`collapsed-<首个 tool_use 行 uuid 前缀>`）和 `onScreen`，不改绘制，同时用于兜底跳转和 Current position，避免 prompt 型命令的兜底目标落到一长串工具之后。前缀能否唯一对上 uuid、非折叠显示时是否改走 `ToolUse`、hook 次数增加多少，交原型实测；不成立就退回 `UserMessage`/`AssistantMessage`/`CommandOutput` 三个站点。
3. **B 类事先淡化**：mod 记下本进程里 render hook 见过的 `requestId`。从没画出过的一侧照常显示原文，但淡化显示；点击或 Enter 不跳转，在 Pane 内给一行说明。前提是全屏 transcript 不虚拟化，即离屏的行也会被画出、进入集合。原型若发现会虚拟化，就取消事先淡化，只在跳转被拒时说明。
4. **跳转被拒的反馈**：`$.ui.scroll` 返回 `nothing drawn under that requestId` 或其他错误时，在 Pane 底部显示一行说明，下一次跳转、选择移动或约 5 秒后（`$.clock`）消失；被拒的这一侧随后改为淡化，直到它再次被画出。说明只陈述事实、不猜原因（rewind 残留与 resume 前 compact 无法区分），措辞类似「这一条当前没有显示在对话里，无法跳转」。`"placeholder"` 永远不当作目标。
5. **Current position 只看画出的行**：由屏上最靠前的已挂钩行决定，归组按「决定是否做当前位置高亮」的规则。没有任何画出行的组（单独的 `!cmd` 组、resume 前的组）永远不会被高亮。「transcript 最后一行完整可见时强制末组」改为「最后一个画出的行完整可见时强制末组」，这样末组是 `!cmd` 时，到底部也能高亮它。
6. **键盘**：Pane 聚焦时，↑↓ 选择光标照常停在淡化的条目上，Enter 的反应与点击相同，不跳过这些条目。

术语：`mods/chat-toc/CONTEXT.md` 的 Jump target 增补兜底到紧邻行的含义。

## 后续修订

- 「原型验证停靠 TOC Pane 的外观与交互」实测后修订：取消第 3 条的事先淡化，一律先跳、被拒才淡化；第 1 条的兜底改为往后最近的可绘制行，往后没有再往前，用 `center`，被拒就换下一个候选；第 5 条的 Current position 另加跳转后锁定。见 [05](05-prototype-toc-pane.md)。
