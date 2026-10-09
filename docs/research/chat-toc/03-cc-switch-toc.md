# cc-switch「对话目录」的交互细节

为 chat-toc（Claude Code 终端会话右侧停靠的对话目录）做的参考研究：cc-switch 会话阅读页右侧的「对话目录」面板怎么分组、计数、取文字、高亮、跳转、截断，以及特殊行和长会话怎么处理。

- 研究对象：[farion1231/cc-switch](https://github.com/farion1231/cc-switch)，commit `2db86e94da13365caae55bb08d09295e31500d21`（2026-10-09 `git clone --depth 1` 的 `main`）。
- 方法：只读源码（前端 TypeScript + 后端 Rust 解析器 + 组件测试 + 用户手册），没有运行其中任何脚本。
- 下文的链接都固定在上面这个 commit。为简洁，`R/` 代表 `src/components/sessions/reader/`。

[R/SessionOutline.tsx]: https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx
[R/SessionReader.tsx]: https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx
[R/turns.ts]: https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts

## 结论速览

| 问题 | 结论 |
| --- | --- |
| 轮次分组 | 按消息的 `turnId` 把**连续**消息分组。Claude Code 没有原生轮次，后端遇到「真人输入」的 user 消息（非空文本、图片或斜杠命令）就开新一轮，记作 `t{n}`。 |
| 「N 步」 | 等于 `turn.steps.length`：合并之后的过程步骤数，思考、过程中的说明文字、图片、夹在中间的事件都各算 1 步；同一 MCP 服务器连续成功调用 ≥2 次会合并成 1 步。为 0 时不显示。**它跟正文「执行过程 · N 步」的口径不同**（正文只数工具调用）。 |
| Agent 侧文字 | 「最终回复」：本轮最后一条含文字的 assistant 消息里，位于本轮最后一个 tool_call 之后的 Text 块。最后一个工具调用排在所有文字之后，就算没有最终回复。 |
| 红点 | `aborted`（本轮出现中断事件）或者任一步骤状态为 `error` / `interrupted`。Hook 错误等事件行不会触发红点。 |
| 全部 / 对话 / 改动 | 只影响正文的行列表，目录永远基于全部轮次；但当前位置高亮按过滤后的行计算，点击跳转也在过滤后的行里找目标。 |
| scroll-spy | 视口顶部往下 8px 处第一个可见的虚拟行属于哪一轮，就高亮哪一轮；滚到底（距底 ≤24px）时强制高亮最后一轮。 |
| 点击 | 点「你」跳到提问行，点 Agent 跳到最终回复，没有回复时跳到该轮 Agent 侧第一行。目标行对齐到视口顶部，再加 2 秒焦点环。 |
| 截断 | 先去掉 Markdown 记号、折叠空白、截到 160 字符（不加省略号），再由 CSS 限制最多两行；提问气泡最宽 200px。 |
| 特殊行 | 只有事件的轮（单独的斜杠命令、模型切换等）不进目录；中断轮进目录，回复处写「已中断」；没有文字的提问写「（只有图片）」。 |
| 长会话 | 正文用 `@tanstack/react-virtual` 虚拟化；目录**不虚拟化**，渲染成普通 `<ol>`，只靠截断摘要控制 DOM 大小。 |

## 1. 面板结构

- 面板宽 260px，左边框作分隔，屏宽小于 `lg` 断点时隐藏（`max-lg:hidden`）。标题「对话目录」后面接条目数 `entries.length`，即过滤后真正进目录的轮数，不是后端的提问数。见 [R/SessionOutline.tsx#L94-L103](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L94-L103)。
- 默认打开，开关状态存在 `localStorage` 的 `cc-switch.sessionReader.outline`。会话读取失败或没有任何轮次时不渲染。见 [R/SessionReader.tsx#L188-L205](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L188-L205) 与 [#L807-L814](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L807-L814)。开关按钮在工具栏，也在 `lg` 以下隐藏：[src/components/sessions/reader/SessionReaderHeader.tsx#L649-L662](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReaderHeader.tsx#L649-L662)。
- 每个条目是一个 `<li>`，里面放两个按钮：
  - 上方「你」：靠右，小字 `你 · 时间`，下面是主题色 14% 混底的气泡。只在 `turn.question` 存在时渲染。
  - 下方 Agent：靠左，缩小到 72% 的 Agent 头像，旁边一行小字 `N 步` + 红点，再下面是回复摘要。**每个条目都有这一行**，即使本轮没有步骤也没有回复。
  - 见 [R/SessionOutline.tsx#L108-L185](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L108-L185)。
- 时间格式 `formatMessageTime`：本地化的「月 日 时:分」，不是今年时再加年份。见 [src/components/sessions/utils.ts#L100-L112](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/utils.ts#L100-L112)。
- 文案键（`sessionManager.reader.*`）：`outlineTitle`「对话目录」，`outlineSteps`「{{count}} 步」，`outlineFailed`「有失败步骤」（红点的 aria-label），`outlineAborted`「已中断」，`outlineNoReply`「没有回复」，`outlineEmptyQuestion`「（只有图片）」。见 [R/i18n.ts#L109-L115](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/i18n.ts#L109-L115)。

## 2. 消息怎么分成轮次

**后端（Claude Code 等没有原生 turn 的 Agent）**：`starts_turn` 判断一条消息是否开启新一轮。条件是 role 为 `user`、没有标记为注入，并且带有非空文本、图片或 `SlashCommand` 事件之一。只有中断事件、用户自己跑的 `!cmd`、或只装着工具结果的 user 消息，不开新轮，归入当前轮。`assign_turn_ids` 按这个条件递增编号 `t{n}`，首次提问之前的内容记为 `t0`。见 [src-tauri/src/session_manager/providers/blocks.rs#L715-L746](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src-tauri/src/session_manager/providers/blocks.rs#L715-L746)。Codex 直接用原生的 `turn_id`。

**Claude 记录怎么归类**（`push_user_texts`），见 [src-tauri/src/session_manager/providers/claude.rs#L658-L730](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src-tauri/src/session_manager/providers/claude.rs#L658-L730)，判断顺序如下：
1. `[Request interrupted by user…` → `Aborted` 事件，不开新轮。
2. `<command-name>/x</command-name><command-args>…` → `SlashCommand` 事件，文本是 `/x args`，**会开新轮**。解析函数见 [#L1285-L1300](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src-tauri/src/session_manager/providers/claude.rs#L1285-L1300)。
3. `<bash-input>` → 用户执行的工具调用，不开新轮。
4. `<local-command-caveat>`、`<local-command-stdout|stderr>`、`<task-notification>` → 注入内容（`injected`），默认隐藏，也不开新轮。判断函数见 [#L1277-L1282](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src-tauri/src/session_manager/providers/claude.rs#L1277-L1282)。
5. 其余文本先剥掉 `<system-reminder>`，剩下有内容就算真人提问；全部是 reminder 的话，整条标记为注入。

后端测试里有一个典型序列：`第一问`(t1) → `/compact`(t2) → 压缩摘要 → `<local-command-stdout>`(t2，注入) → 中断(t2) → Hook 错误(t2) → `/status verbose`(t3) → `!git status`(t3)。见 [claude.rs#L2286-L2393](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src-tauri/src/session_manager/providers/claude.rs#L2286-L2393)。

**前端**：`groupMessages` 把 `turnId` 相同的**相邻**消息合成一组；同一个 id 隔开后再次出现，key 加后缀 `#n`。旧数据没有 `turnId` 时，前端遇到提问消息自己递增编号。见 [R/turns.ts#L235-L262](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L235-L262)。

每一轮（`buildTurn`，见 [R/turns.ts#L298-L530](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L298-L530)）由这些部分组成：
- `question`：组内第一条「非注入、带非空文本或图片的 user 消息」，判断函数见 [#L227-L233](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L227-L233)。斜杠命令消息里只有事件块，**不算 question**。
- `leadingEvents`：提问之前的事件，例如斜杠命令、模型切换、压缩。没有提问的轮里，出现第一个非事件步骤之前的事件都归这里。见 [#L455-L467](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L455-L467)。
- `steps`：执行过程，下一节细说。
- `final`：最终回复。
- `trailingEvents`：最后一个工作步骤之后的事件全部移到这里，例如中断、Hook 错误、PR 链接。见 [#L492-L503](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L492-L503)。
- `aborted`：本轮任意位置出现 `aborted` 事件就置为 true（[#L456](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L456)）。

**哪些轮进目录**：`question || final || steps.length > 0 || aborted`。只有事件的轮被排除，例如没有后续输出的 `/login`，或者只做了模型切换、压缩的轮。见 [R/SessionOutline.tsx#L56-L75](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L56-L75)。

## 3. 「N 步」怎么数

- 目录里显示的是 `steps: turn.steps.length`（[R/SessionOutline.tsx#L71](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L71)），为 0 时整个「N 步」不显示（[#L163-L164](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L163-L164)）。
- `turn.steps` 里各类元素都算 1 步：
  - `tool`：一次工具调用，和它的结果按 callId 配成一对；
  - `thinking`：有内容、摘要或标记为 redacted 的思考块；
  - `note`：最终回复之前的助手说明文字；
  - `image`：过程中出现的图片；
  - `event`：夹在两个工作步骤之间的事件；
  - `merged`：合并后的一组调用。
  - 见 [R/turns.ts#L93-L99](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L93-L99) 与 [#L373-L468](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L373-L468)。
- 合并规则 `mergeSteps`：只合并**状态为成功、连续出现、至少 2 个**的工具步骤。Claude 风格只合并「同一 MCP 服务器的连续调用」，显示为 Called X N times；Codex 合并连续的 read/search，显示为 Explored。合并组只算 1 步。见 [R/toolSummary.ts#L37-L95](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/toolSummary.ts#L37-L95) 与 [R/agentStyles.ts#L72](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/agentStyles.ts#L72)。
- **口径不一致**：正文的「执行过程 · N 步」用 `summary.stepCount || stepTotal`，其中 `stepCount` 是展开合并组之后的**工具调用数**，不含思考和说明文字。所以同一轮的目录数字和正文摘要可能对不上。见 [R/SessionTimeline.tsx#L81](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionTimeline.tsx#L81) 与 [R/toolSummary.ts#L439-L476](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/toolSummary.ts#L439-L476)。工具栏的「工具调用次数」用的也是 `stepCount`（[SessionReaderHeader.tsx#L573](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReaderHeader.tsx#L573)）。

## 4. Agent 侧显示哪段文字

`locateFinal`（[R/turns.ts#L270-L296](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L270-L296)）的规则：
1. 找出本轮最后一个 `tool_call` 的位置，记作（消息下标, 块下标）。
2. 从组尾往前扫描非注入的 assistant 消息，取第一条在「最后一个 tool_call 之后」还有非空 Text 的消息，它的这些 Text 块就是最终回复。
3. 扫描到最后一个 tool_call 所在消息之前还没找到，说明本轮没有最终回复，例如中途被中断，或以工具调用收尾。

`final.text` 是这些 Text 块用空行拼接起来的结果（[#L517-L527](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L517-L527)）。最终回复之前的文字都成了 `note` 步骤，不会出现在目录摘要里。

## 5. 红点等状态标记

- 红点条件是 `failed = turn.aborted || turn.steps.some(isFailureStep)`（[R/SessionOutline.tsx#L72](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L72)）。`isFailureStep` 只看 `tool` 和 `merged` 两类步骤，状态为 `error` 或 `interrupted` 时算失败（[R/toolSummary.ts#L27-L33](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/toolSummary.ts#L27-L33)）。合并组只收成功的步骤，所以失败步骤一定单独存在。
- 红点是 6px 的 `bg-danger` 圆点，放在「N 步」之后，aria-label 是「有失败步骤」（[R/SessionOutline.tsx#L165-L170](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L165-L170)）。所以红点同时表示「有失败步骤」和「本轮被中断」两种情况。用户手册写的是「含步数、是否有失败或中断」（[docs/user-manual/zh/3-extensions/3.4-sessions.md#L135](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/docs/user-manual/zh/3-extensions/3.4-sessions.md#L135)）。
- **不触发红点的情况**：`hook`（Hook 执行出错）和 `error` 两类事件。正文里它们用 danger 色显示（[R/SessionEventRow.tsx#L57-L87](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionEventRow.tsx#L57-L87)），但目录不看事件。
- 回复为空时，用斜体弱化色的占位文字：已中断的轮写「已中断」，否则写「没有回复」（[R/SessionOutline.tsx#L172-L181](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L172-L181)）。

## 6. 「全部 / 对话 / 改动」

这是工具栏上的三选一分段控件，取值为 `ReaderFilter = "all" | "conversation" | "changes"`，状态只在组件内存里，不持久化。见 [SessionReaderHeader.tsx#L663-L674](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReaderHeader.tsx#L663-L674) 与 [R/SessionReader.tsx#L177](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L177)。

三种视图怎么生成正文的行，见 `turnRows`（[R/turns.ts#L913-L947](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L913-L947)）：
- **全部**：依次输出前置事件、注入内容（需打开「显示注入的上下文」）、提问、执行过程（折叠摘要行加步骤）、最终回复、后置事件。
- **对话**：每轮只输出提问和最终回复，不显示事件、过程和斜杠命令分隔行。
- **改动**：只保留含改动步骤的轮。改动步骤指 `edit` / `write` 类调用或带 diff 的调用（[#L773-L778](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L773-L778)）。每轮输出提问和这些改动步骤，不显示最终回复。整个会话没有改动时显示「这个会话没有文件改动」。
- 轮与轮之间插一条分隔线，没有任何行的轮直接跳过（`flattenRows`，[#L949-L968](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L949-L968)）。

**对目录的影响**：
- `<SessionOutline turns={turns}>` 接收的是未经过滤的全部轮次，所以**目录条目和计数不随过滤变化**。
- 当前位置高亮 `activeTurn` 是从**过滤后**的 `rows` 算出来的，跳转也在过滤后的 `rows` 里找目标行。
- 「改动」视图下点一个没有改动的轮，找不到任何行，结果下标为 -1，`scrollToRow` 直接返回，点击**无反应、也没有提示**（[R/SessionReader.tsx#L301-L334](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L301-L334)）。

## 7. 当前位置竖线（scroll-spy）

见 [R/SessionReader.tsx#L504-L515](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L504-L515)：

```ts
const scrollOffset = virtualizer.scrollOffset ?? 0;
const firstVisible = virtualizer.getVirtualItems().find((item) => item.end > scrollOffset + 8);
const activeTurn = atBottom && rows.length > 0
  ? rows[rows.length - 1].turn
  : firstVisible ? (rows[firstVisible.index]?.turn ?? 0) : 0;
```

- 这个值不是用事件或 IntersectionObserver 维护的，而是每次渲染时直接计算。虚拟列表滚动时本来就会重新渲染。
- 判定线在视口顶部往下 8px：哪个虚拟行跨过这条线，就取它所属的轮。轮间分隔线也带着轮号，所以分隔线压在顶部时，高亮的已经是下一轮。
- `atBottom` 在 `onScroll` 里更新，条件是 `scrollTop + clientHeight >= scrollHeight - 24`（[#L686-L690](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L686-L690)）。滚到底时直接高亮最后一轮，因为最后几轮太短，永远到不了视口顶部。
- 目录侧（[R/SessionOutline.tsx#L109-L124](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L109-L124)）：
  - 匹配条件是 `entry.turn.index === activeTurn`。
  - 命中的 `li` 加 `bg-subtle` 底色，左侧画一条绝对定位的 2px 竖线，上下各缩 8px，颜色是 `--reader-accent`，随 Agent 主题变。
  - 只有「你」那个按钮带 `aria-current="true"`。
  - 如果 `activeTurn` 指向一个没进目录的轮（例如只有斜杠命令的轮），这时目录里没有任何条目高亮。
- 目录自身跟随（[#L77-L91](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L77-L91)）：`activeTurn` 变化时，只调整目录 `<ol>` 的 `scrollTop`，把高亮条目以「刚好可见」的最小位移滚进视野，相当于 `nearest`。注释特意说明不用 `scrollIntoView`，以免连带滚动外层容器。

## 8. 点击目录项后的滚动与高亮

- 点「你」调用 `jumpToQuestion`：找本轮 `question` 行，找不到就退回到本轮第一行（不含分隔线）。
- 点 Agent 调用 `jumpToReply`：依次找本轮 `final` 行、本轮第一条 Agent 侧行（timeline / step / final / injected），都找不到就退回本轮第一行。
- 两者最后都调用 `scrollToRow`：`virtualizer.scrollToIndex(index, { align: "start" })` 把目标行对齐到视口顶部，再执行 `flash(key)`，目标行加 `ring-2` 焦点环，2 秒后自动消失。见 [R/SessionReader.tsx#L293-L334](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L293-L334) 与 [#L700-L714](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L700-L714)。
- 跳转后正文顶部落在目标轮，`activeTurn` 随之变化，目录高亮也跟着更新。目录不单独维护「选中」状态。
- 相关键盘操作：`j` / `k` 在轮之间跳，以当前虚拟范围首行所在的轮为基准，跳到下一轮或上一轮的第一行，同样调用 `scrollToRow`。焦点在输入框或带修饰键时不响应。见 [#L336-L372](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L336-L372)。查找命中的跳转用的是 `align: "center"`（[#L286-L291](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L286-L291)）。

## 9. 截断规则

`toSnippet` 依次做以下处理（[R/SessionOutline.tsx#L11-L24](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L11-L24)）：
1. 把围栏代码块 ```` ```…``` ```` 整段换成空格；
2. 去掉图片 `![..](..)`；
3. 链接 `[text](url)` 只保留 `text`；
4. 把 `# > * \` ~ |` 换成空格。`_` 和 `-` 保留，因为它们常出现在标识符里；
5. 连续空白（包括换行）压成一个空格，再 trim；
6. 用 `.slice(0, 160)` 截到 160 个 UTF-16 码元。**不加省略号**，这一步只是为了少往 DOM 里塞文字。

显示层由 CSS `line-clamp-2` 限制最多两行，浏览器在第二行末尾补省略号。提问气泡加 `max-w-[200px]` 并靠右；回复占满剩余宽度（面板 260px 减去头像列）。见 [#L141](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L141) 与 [#L172-L177](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L172-L177)。

提问存在但文字为空（只有图片）时，摘要是空串，显示「（只有图片）」。

后端和前端还各有一套 80 字符加「…」的 `questionPreview`（[R/turns.ts#L549-L584](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L549-L584)）。它用于会话标题回退和工具栏的「N 次提问」，目录不用它。注意这份索引会收录斜杠命令轮，而目录不收，所以「N 次提问」与「对话目录 N」可能不同。

## 10. 特殊行在目录里的处理

| 情形 | 正文 | 目录 |
| --- | --- | --- |
| 斜杠命令（`/login`、`/compact`…） | 本轮的 `leadingEvents`，渲染为居中、两侧带短横线的「运行了 /login」分隔行（[R/SessionEventRow.tsx#L72-L77](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionEventRow.tsx#L72-L77)、[#L210-L225](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionEventRow.tsx#L210-L225)） | 斜杠命令开了新轮，但这一轮没有 question。之后没有输出就不进目录；之后有步骤、回复或中断（例如 `/compact` 被打断，或 `/status` 后接 `!git status`）就进目录，但**没有「你」气泡**，只有一行 Agent。命令文字本身不出现在目录里。 |
| 本地命令输出 `<local-command-stdout>` | 注入内容，默认隐藏 | 不出现 |
| 中断 `[Request interrupted by user…]` | `aborted` 事件，通常落在后置事件里，显示为「已中断」分隔行 | 不开新轮；本轮置为 `aborted`，显示红点，回复为空时写「已中断」 |
| 工具失败或中断状态 | 失败步骤在折叠时也常显 | 显示红点 |
| Hook 错误 / `error` 事件 | danger 色事件行 | 不显示红点，不影响目录 |
| 模型切换、压缩、PR 链接 | 居中的事件分隔行 | 只有这类事件的轮不进目录；夹在两个工作步骤之间时算作 1 步 |
| 用户 `!cmd`（bash-input） | 一个 `by_user` 的工具调用步骤 | 算 1 步，不开新轮 |
| 只有图片的提问 | 图片气泡 | 显示「（只有图片）」 |

## 11. 长会话怎么渲染

- 正文使用 `@tanstack/react-virtual` 的 `useVirtualizer`：`overscan: 8`，`estimateSize` 按行类型估算高度（question 96、final 160、step 32、event 28、分隔线 17 等），再用 `measureElement` 动态测量实际高度。见 [R/SessionReader.tsx#L275-L284](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L275-L284) 与 [R/turns.ts#L1010-L1022](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/turns.ts#L1010-L1022)。
- **目录不虚拟化**：`entries.map` 一次渲染全部条目，放在一个 `overflow-y-auto` 的 `<ol>` 里。性能靠三点保证：
  - 组件用 `memo` 包裹；
  - `entries` 用 `useMemo([turns])` 缓存；
  - 摘要截到 160 字符。
  - 见 [R/SessionOutline.tsx#L46-L75](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L46-L75) 与 [#L104-L108](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionOutline.tsx#L104-L108)。
- 流式加载时，消息先经过 `useDeferredValue` 再交给 `buildTurns` 重建轮次，以低优先级渲染，滚动和点击不会被打断。见 [R/SessionReader.tsx#L213-L218](https://github.com/farion1231/cc-switch/blob/2db86e94da13365caae55bb08d09295e31500d21/src/components/sessions/reader/SessionReader.tsx#L213-L218)。

## 对终端 Pane 的参考价值

以下是基于上述源码的推论，不是 cc-switch 自己的说法：

1. **分组规则可以直接照搬**：遇到「非注入、带文本或图片、或者是斜杠命令」的 user 消息就开新轮；中断、`!cmd`、工具结果和 `<local-command-*>` 都归入当前轮。条目是否显示另外判断：`question || final || steps || aborted`。
2. **「N 步」要先定口径**。cc-switch 的目录和正文用的是两种口径，这是它的一个瑕疵。chat-toc 建议只用一种口径，例如只数工具调用，并在文档里写明。
3. **最终回复的定位**用「最后一个 tool_call 之后的 Text」，比「最后一条 assistant 文本」更准确：以工具调用收尾的轮会如实显示「没有回复」。
4. **红点合并了「失败」和「中断」两种含义**。终端里空间更紧，可以沿用一个标记，但 Hook 错误不计入这一点要知道。
5. **scroll-spy 不需要观察器**：「视口顶 + 8px 处是哪一轮」，加上「到底就算最后一轮」，这两条规则在终端的行坐标里同样适用。滚动目录时只做 `nearest` 式的最小位移，不要带动主区。
6. **跳转的目标是行，不是轮**：点问题跳到提问行，点回复跳到回复行，对齐到顶部，再短暂高亮约 2 秒。
7. **过滤与目录要保持一致**：cc-switch 在「改动」视图下点击一个被滤掉的轮会静默无反应。按 `no-misleading-ui-text` 的原则，chat-toc 应该给出可感知的反馈，例如把这类条目置灰。
8. **截断分两层**：先去掉 Markdown 记号、按字符数截断（用来控制成本），再按显示宽度裁成 1–2 行（用来控制外观）。终端里显示宽度要按 CJK 双宽字符计算，不能用码元数。
9. **长会话**：目录条目只有几百个时，全量渲染就够用；终端 Pane 只需要绘制可见窗口内的条目，天然就是「虚拟化」的。
