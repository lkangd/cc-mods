# chat-toc MVP

## Destination

chat-toc MVP 的功能、交互、兼容与验收决策全部落定，足以直接汇总成可交给实现者的规格与验收方案（只规划，不实现）。

## Notes

- 后续交互与产物使用中文；提交说明用英文。
- 独立插件根是 `mods/chat-toc/`；与 prompt-history 完全独立：不互相依赖、不共享代码与数据，可同时启用。可借鉴 prompt-history 的做法（如 `$.ui.scroll({ to: { requestId } })` 跳转），但不抽公共库。
- 只用公开的 Claude Code mods API，不依赖宿主未公开行为；唯一例外是读当前会话的 transcript 文件（格式未公开），它是 TOC 的数据来源。分块读大文件时 macOS/Linux 用系统 `dd` 定位加 `head`（`tail -c +N` 在 macOS 上太慢），Windows 用自带的 Windows PowerShell 5.1。最低版本 Claude Code `>=2.1.287`（mods 在终端正式默认开启的版本，`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` 自此被忽略）；本机版本（当前 2.1.295，会随时升级）只是实测样本，不是版本锁。
- 目标表面：交互式终端的全屏布局，Pane 停靠在 transcript 右侧（`placement: 'dock'`）。自动弹出不接受 inline 放置，不能停靠时在状态栏常驻说明原因与满足条件的方法；唯一例外是使用者用 `/chat-toc` 主动打开时，宿主放成 inline 就照放（inline 形态不承诺，见规格）。
- 数据范围：一切以当前会话的 transcript 文件为准（当前分支的对话链），`$.session.messages()` 只作补充；不落盘、不建档案、无采集同意流程。只收主对话循环，子 agent 不进 TOC；`/clear` 后随新会话重建目录、不画分隔线；compact 前的条目照常显示；rewind 被弃的分支不显示。
- 条目单位是 Turn group（User input + Agent reply）。User input 是使用者在输入框敲入并回车上屏的任何内容，含斜杠命令。Agent reply 显示「N 步」加本轮最后一段文字的前 2 行；进行中显示「进行中 · N 步」，无文字回复显示「N 步 · 无文字回复」。用户侧显示「你 · 时间」加最多 2 行截断原文；时间取 transcript 行的时间戳，读不到就不显示，不伪造。
- 顶部三态 View filter「全部 / 用户 / Agent」，默认全部，选择跨会话全局记住（`$.store`）。三种 Layout（卡片 / 紧凑 / 时间轴）由使用者切换，同样跨会话记住。
- 每次会话启动自动打开；使用者关闭后本会话保持关闭，`/chat-toc` 重新打开，下次会话再自动弹出。
- 点击用户侧跳到该 prompt，点击 Agent 侧跳到本轮最后一段文字回复；焦点在 Pane 内时 ↑↓ 选择、Enter 跳转。跳转成功后高亮锁在目标组，直到视口下一次变化；TOC 滚动跟随 Current position；长会话连续滚动、可按需渲染，不分页。
- 交互参考 cc-switch（https://github.com/farion1231/cc-switch）会话详情右侧的「对话目录」。
- 宿主 API 事实以 `plugin-authoring` skill 写出的类型声明与 `~/.claude-code-docs/docs/plugins__mods__*.md` 为准；PTY 验收可用 cmux 驱动（见 prompt-history 的做法）。
- 领域术语见 [`CONTEXT.md`](../../mods/chat-toc/CONTEXT.md)。

## Decisions so far

- [决定首个版本的发布形态与文档](issues/16-grill-release-and-docs.md)：首版 `0.1.0`，证据按版本分目录、每次改版本号都重跑全部 MUST；根 README 写唯一一份用户文档（十节大纲，用界面用语，含不承诺清单），`mods/chat-toc/README.md` 只写开发与发布清单；marketplace 条目不加分类，独立性只在 README 里说明；条目、README 那一节和证据报告在 MUST 全部通过后放进同一个发布提交，不打 tag；发布前用本地目录 marketplace 冒烟，发布后从 GitHub 做安装级检查，失败就撤回。
- [决定 Layout 的切换入口与默认值](issues/13-grill-layout-switch-entry.md)：默认卡片；唯一入口是过滤行右端的「布局:<当前 Layout>」按钮，点击或聚焦时按 `l` 循环，不用 `v`、不设命令参数；底栏不常驻；切换时以选中组或 Current position 所在组为锚、跟随状态不变；`/chat-toc` 无参数，只打开、提前、聚焦，从不关闭。
- [用只收 label 的 Button 画三种 Layout](issues/15-prototype-label-only-button-layouts.md)：三种 Layout 都用「每行一个 Button」——每行一个 `plain` Button、同侧共用一个跳转，卡片头行 `dimColor`，悬停用 hover scope 整侧连亮；高亮竖条与时间列放在 Button 左边单独的 `Text` 里，两版都对齐；↑↓ 落在条目第一行；Button 无 `bold`，高亮不再加粗，只靠青色标记；换行截断由 mod 自己算。2.1.287 与 2.1.295 上九种组合都能画、能点。
- [决定与其他停靠 Pane 共存的行为](issues/14-prototype-dock-coexistence.md)：照宿主标签规则走——新开的 Pane 总在前台，chat-toc 自动弹出时也一样，不抢回、不提示；对方关掉后宿主自动把它提回前台并画最新状态；关闭标记只认自己 id 的 person 关闭；后台不画，Current position 在后台变了就撤销跟随暂停，回前台即跟随。另发现 `session.start` 在 `/clear` 时不触发，`CT-LIFE-002` 的再次弹出要靠 `classic.SessionStart`（source `clear`/`resume`）。
- [实测长会话的读取与渲染开销](issues/12-task-measure-long-session.md)：20 MB 在两个版本上都够快，条件是分块读取改用 `dd`+`head`、只增长时只重组末组、条目按组缓存只画窗口、Current position 用二分查找；重读由 `session.append`/`turn.complete` 尾随 300 ms 触发、不轮询；`CT-PERF-001` 阈值定为首次出目录晚于 transcript ≤4 s、整份读取 ≤1 s、增量单次 ≤150 ms、Pane 自身 ≤16 ms（含宿主 ≤100 ms）、Current position ≤2 ms；另发现 2.1.287 的 `Button` 只收 `label`，升格为新票。
- [定稿兼容与验收契约](issues/06-grill-acceptance-contract.md)：三级规范（MUST / 明确降级 / 不承诺），所有 MUST 零缺失零跳过才发布；承诺 `>=2.1.287` 全屏、OS 不限、`--plugin-dir` 与 marketplace，门禁只在本机 macOS 跑最低与当前两个版本；证据分 `claude plugin test` 自动化、cmux PTY、人工目检（非 MUST）三层，一致性由独立 verifier 比对 transcript 对话链；定了 `CT-*` MUST 清单与不承诺清单，报告放 `mods/chat-toc/tests/evidence/<版本>/`；性能阈值、Layout 入口、Pane 共存引用新升格的三张票。
- [原型验证停靠 TOC Pane 的外观与交互](issues/05-prototype-toc-pane.md)：三种 Layout 都保留，由使用者切换；过滤、跳转、高亮与光标、跟随暂停、生命周期（含 `/clear` 后再次弹出）都试过并通过，跳转后高亮锁在目标组。实测得知：本地命令记成 `system/local_command` 行；`ToolGroup` id 要按前 24 位匹配；全屏 transcript 虚拟化，残留的在屏值要按连续段过滤；跳转能到达没画出过的行。据此取消事先淡化，改为被拒才淡化。
- [决定没有 Jump target 的条目侧如何呈现与点击](issues/11-grill-unjumpable-sides.md)：本身在屏上、只是没有站点的行（本地命令回显、prompt 型命令输入、`!cmd`）跳到紧邻的已画出行，用 `center`，算作跳到了该 prompt；没被画出的行（resume 前 compact、rewind 残留）事先淡化，点击不跳，在 Pane 底部说明；补挂 `ToolGroup`；Current position 只看画出的行，改为「最后一个画出的行完整可见时强制末组」；↑↓ 不跳过淡化条目。
- [实测 Pane 随 Current position 重绘的方式](issues/10-task-pane-redraw-on-scroll.md)：transcript render hook 只在 Current position 真变化时用 `$.clock.after(0, …)` 写 `$.state` atom，Pane 读它重画；两版 0 错误、中位延迟 6–7 ms，transcript hook 不多跑。invalidate 可用但让 transcript hook 运行翻倍；`Promise.then` 写 state 偶发被拒；无条件 invalidate 会自循环。高亮保留。
- [实测 requestId 与 transcript 行身份的对应](issues/09-task-map-request-id-to-transcript.md)：`requestId` 就是 transcript 行的 `uuid`（resume 后不变）；`onScreen` 和屏幕逐行一致，高亮前提成立。斜杠命令的输入行、`!cmd` 的行、rewind 抛弃的行、resume 后 compact 之前的大部分行都没有 Jump target；`"placeholder"` 要忽略；render hook 里不能写 `$.state`。
- [决定是否做当前位置高亮](issues/08-grill-scroll-spy.md)：做，以 requestId 实测为前提，不成立就拿掉、不提示；高亮视口顶部那一行所属的组，最后一行完整可见时强制末组；与 ↑↓ 选择光标分开；TOC 滚动统一跟随高亮，手动滚动或 Pane 聚焦时暂停。
- [在 Claude Code 2.1.287 上核对关键 API](issues/07-task-verify-2-1-287-api.md)：清单上每一项（`onScreen`、`session.append`/`end`、`UiScrollTarget`、Pane 属性、`ui.close` origin、`fs.read`/`stat`、`process.run`、`transcript_path`）在 2.1.287 上都有，字段和 2.1.295 一样；最小 mod 能 validate 通过，不用抬高最低版本。新会话在第一条消息之前 transcript 文件还不存在。
- [定义 Turn group 的划分与边界](issues/04-grill-turn-group-model.md)：以 transcript 文件为数据源、沿当前分支对话链取行，照 cc-switch 判断哪些 user 行开组（`!cmd` 也开组）；步数 = 主循环 `tool_use` 数，末段 = 最后一个工具后的文字；中断、出错、时间都从文件精确取得，进行中靠 turn 事件；大文件按偏移增量分块读。
- [研究 cc-switch 对话目录的交互细节](issues/03-research-cc-switch-toc.md)：按非注入 user 消息开轮、目录全量渲染不随过滤变化、scroll-spy 取视口顶部所属轮、点击 Agent 侧有逐级回退；其斜杠命令不显示原文、步数口径不一致、过滤后点击静默无反应，均不照搬。
- [核实停靠 Pane 的生命周期与放置规则](issues/02-research-pane-lifecycle.md)：以官方 `cc-plugin-diff` 为模板——仅全屏时自动打开、`isPlaced:false` 即撤回；不设 `closeOnEscape`；自管滚动与跟随最新以守住 `>=2.1.287`；「本会话已关闭」放 `$.state`（`/clear`、`/resume` 会重置），View filter 放 `$.store`。
- [核实 transcript 行枚举与跳转原语](issues/01-research-transcript-row-primitives.md)：Jump target 只能在 `UserMessage`/`AssistantMessage`/`CommandOutput` 被绘制时拿 `requestId`，跳转须由使用者发起；步数与中断仅本进程内的轮精确；公开 API 无时间戳；scroll-spy 可用 `props.onScreen` 但 2.1.287 是否存在未证实；rewind 无事件，需文本对齐绕行。

## Not yet specified

（暂无：所有票都已解决，已到达目的地，可以汇总成规格与验收方案交给实现者。）

## Out of scope

- 持久档案、跨会话历史、采集同意（prompt-history 的职责）。
- inline 放置（输入框上方）作为自动弹出的降级形态（`/chat-toc` 主动打开时宿主放成 inline 除外）。
- Desktop、VS Code、JetBrains、移动端等非终端表面。
- 子 agent（sidechain）内容进 TOC。
- cc-switch 顶部的搜索、导出、「改动」视图。
