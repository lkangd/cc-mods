# 22: 绑定和失效 Jump Target

**What to build:** 让当前 transcript 中仍存在的 Prompt Entry 可通过键盘或鼠标跳回原位置，同时让已失效的历史条目继续可见且不会跳错。

**Blocked by:** 13「严格匹配人类 composer 提交」、18「在 resume 与 fork 中重建 Conversation Branch」、19「rewind 后建立新 Conversation Branch」、21「连续浏览 100,000 个 Timeline Events」

**Status:** resolved

- [x] `ui.render(UserMessage)` 只为非 placeholder、当前活动路径上唯一对齐的 Prompt Entry 绑定 Jump Target，不创建 Timeline Event。
- [x] Jump Target request ID 只存在当前 Run 内存，不写入 SQLite、`$.store` 或 locator。
- [x] 重复文本按完整活动路径顺序分别绑定到各自 Prompt Entry，不能使用“第一个同文本未绑定项”的启发式。
- [x] reload、resume 和 fork 的共享历史 render 重放不会重复 Prompt Entry；只为当前重放且唯一对齐的共享前缀重新绑定目标。
- [x] 有效条目显示可跳转标记，鼠标点击或 Enter 激活后到达正确 transcript 位置、折叠 Prompt Trail 并把焦点还给 composer。
- [x] 普通重启、被 transcript 淘汰或无法唯一对齐的条目保留并显示 `×`；激活无副作用且不折叠。
- [x] 无匹配的 command output、内部消息或 preview render 被忽略，绝不绑定到最近文本相同的 Prompt Entry。
- [x] plugin test 验证绑定表和失效行为；真实 PTY 使用重复与多行 prompt 验证多个独立目标、reload/resume 重绑和重启失效。

## Comments

### 实现层面对齐（2026-09-27）

宿主事实：`$.session.messages()` 的行不带 uuid，能跳转的只有 `ui.render(UserMessage)` 的 `requestId`，所以绑定要把渲染出来的行与档案对齐。2.1.273 的 trace 里，reload 与 resume 在 `session.start` 之前按 transcript 顺序重放每一行、`requestId` 不变；也出现过没有 `prompt.submit` 的非 placeholder composer 行。band 窗口最多 257 条，`activePath` 只含窗口内的 id，插件内无法完整对齐。

- **渲染行**：插件按首次出现的顺序，在内存里记下非 placeholder、origin 为 composer 的 `UserMessage` 行（`requestId`、文本）。clear 或 session id 变化时清空；reload 换模块实例，本就从空开始。普通重启的新会话没有重放，旧条目全部失效。
- **对齐由 helper 做**：`branch-match` 增加一个可选参数，结果唯一时附带逐行对齐。沿用现有规则找出渲染行停在哪条 Prompt Entry（scoped，`prefer` 为当前 Active Branch tip），再对这条链逐行求最左与最右嵌入，同一行才算唯一，只回 `行号 → eventId`，不回原文。不新增子命令。fork 首次提交前没有存下的分支，也由 transcript 证明的链绑定。
- **重算**：同一轮连续到达的 render 用 `$.clock.after(0)` 合并；有新渲染行或 Active Branch tip 变化（确认采集、重建分支、选定父节点）时重算，窗口移动不触发，绑定表按 eventId 记。行数超过 4096 时只送最新的并标为 truncated。helper 失败时保留上一张表，下次触发再算。
- **显示（偏离规格）**：有效条目不加标记、正常亮度；失效条目行首 `×` 且变暗。规格写的是有效显示 `↵`，但 `↵` 已用来表示换行，而普通重启后旧条目全部失效，逐行加标记太吵。
- **激活**：点击或 Enter 调 `$.ui.scroll({ to: { requestId } })`。成功就折叠；返回 `{ deny }` 就删掉该绑定、当场变 `×`，不折叠、焦点不动、不弹提示；Promise 被拒绝（引擎故障，测试引擎也是这样）保留绑定、什么都不做。`×` 行激活无副作用。
- **焦点回 composer**：2.1.281 折叠后宿主可能把焦点环按位置留在标题上，插件没有交还焦点的 API。先在 band 在底部与不在底部两种状态下 PTY 验证；回不去就保持折叠、记为宿主限制（标题反色可见，Esc 回到输入框），不加文字。
- **已知缺口**：rewind 后再提交与被 rewind 掉的行相同的文本，新条目判为不唯一，显示 `×`（宿主不告知哪些行被移除）。render 文本与归档文本对不上（粘贴块、图片等）时显示 `×`，不做规范化；PTY 记下哪些情况对不上，常见的另开票。
- **验证**：对齐与「跳转结果 → 下一步」放进纯函数模块 `hooks/jump.ts`；helper 黑盒测逐行对齐；plugin test 用 `$.ui.render(UserMessage)` 喂行，靠 `×` 断言绑定表并测各类行的激活。跳转成功后的折叠和 `deny` 只能 PTY：2.1.281 resume/reload 是否仍完整按序重放、粘贴与图片的 render 文本、两种焦点状态下跳转后的焦点落点、rewind 或 compact 掉的行是否 `deny`、重复与多行 prompt 的独立目标、reload/resume 重绑与普通重启失效。

### 实现中修订（2026-09-27）

与上面「实现层面对齐」不同的地方，都经使用者确认（PTY 在 2.1.283 上发现）：

- **消失的行（修订 Q4）**：rewind 与 clear 不发信号，只在点击时靠 `deny` 兜底太晚（展开时仍显示可点）。每次对齐前、以及下面的重查时，读 `$.session.messages()`，把已渲染行按顺序在人类 `user` 行里逐个往后找；最后一个找得到的行之后的那些行就是被移除的，记为「已消失」：删掉绑定，之后宿主再画也不收。只剪末尾这一段，中间画法与 transcript 不同的行（粘贴块）不受影响。展开 band（点标题或 `/prompt-history`）时也对齐一次。
- **clear 后的旧行重画**：`SessionEnd` 之后宿主会把 clear 前的行再画一次，而此时 `messages()` 还是旧的。`SessionEnd` 时把已渲染的行全部记为「已消失」，不再清空这个集合。代价：同一进程里 `/resume` 回到本进程先前打开过的 session，原来的行一直显示 `×`，重启后恢复（不会跳错）。（2026-09-29 由 [Issue 43](43-jump-after-in-process-resume.md) 收掉：「已消失」只持续到下一个 classic SessionStart。）
- **展开状态下的 rewind**：rewind 不重画 transcript 行，也不重画 band，只重画输入框下的 `PromptHint`（旧 prompt 放回输入框）。band 展开且有跳转目标时，band 或 `PromptHint` 每次重画都立即重查一次，并在 500 ms 后补查一次，其间的重画并入补查；只有真有行消失才调用 helper。
- **门禁当前版本**：2.1.281 升为 2.1.283（本轮 PTY 所用版本）。
- **拆出新票**：模型运行中排队的提交被宿主撤回（`popAll`）后仍被存档，归 [Issue 35](35-queued-submission-withdrawn.md)。

## Answer

当前 transcript 仍画着的 Prompt Entry 可以跳回原位置：点击或 Enter 后 transcript 滚到那一行、band 收起，焦点回到输入框；没有目标的条目保留、变暗并加 `×`，激活无副作用。实现在 `5ea7f77`，review 修复在 `a5f79eb`；与对齐结论不同的地方见上方「实现中修订」。

- **绑定**：插件在内存里按首次出现顺序记下 composer 的渲染行（不含 `placeholder`），交给 `branch-match --rows`；helper 按 Active Branch 的匹配规则（总是先在本 session 内找，找不到条目才扩到全项目，`prefer` 为当前 tip）找出行停在的链，只在最早与最晚两种嵌入落在同一行时报出该行。插件不按文本自己匹配。触发：渲染、采集写入、重建分支、选定父节点、session 开始、展开 band。
- **消失的行**：每次对齐前读 `messages()`，最后一条仍在 transcript 里的行之后的渲染行视为已消失；`SessionEnd` 时全部渲染行视为已消失。展开期间 band 或 `PromptHint` 每次重画都立即重查、500 ms 后补查一次。`$.ui.scroll` 被拒绝（`nothing drawn under that requestId`）也视为已消失；调用本身失败则不变。
- **显示（偏离规格）**：有效条目不加 `↵`，失效条目行首 `×` 并变暗。
- **没做到的**：
  - rewind 后再提交与被移除行同文本的 prompt，新条目判为不唯一，显示 `×`；
  - 渲染文本与归档文本不同（例如图片）时显示 `×`，不做规范化；PTY 实测粘贴块（`[Pasted text …]`）不在此列：不显示 `×`，能正常跳转；图片未测；
  - 同一进程里 `/resume` 回到本进程先前打开过的 session，原来的行显示 `×`，重启后恢复。（2026-09-29 已由 [Issue 43](43-jump-after-in-process-resume.md) 修复。）
- **宿主事实**（2.1.283 实测）：
  - reload 与 resume 在 `session.start` 之前按 transcript 顺序重放全部行，`requestId` 不变；`UserMessage` 新增 `onScreen`，滚动时反复重画同一行。
  - rewind 不重画任何 transcript 行，也不重画 band，只重画 `PromptHint`；`/clear` 的 `SessionEnd` 之后宿主会把旧行再画一次，此时 `messages()` 尚未更新。
  - 模型运行中输入的提交先排队，`prompt.submit` 的 `next(e)` 在排队时就返回；排队的提交可能被 `popAll` 撤回，归 [Issue 35](35-queued-submission-withdrawn.md)。
  - 跳转成功后焦点回到输入框，band 在底部与不在底部两种状态相同。
- **给后续实现者**：测试引擎触发不了 classic 事件，也不实现插件自己的 `$.ui.scroll`，`SessionEnd` 清空和跳转成功只能靠 PTY；mock clock 的 `settle()` 不推进时间，延时回调要 `advance(ms)`；plugin test 可以只跑一个文件，做法见交接。

一轮 `/code-review` 找到 11 条（`.code-review/runs/20260927-105547/round-1/`）：
- **修了 9 条**：显式根分支的对齐跨 Run 匹配（major）；重建分支后不重新对齐（major）；消失行检测对旧行重复扫描（major，效率）；乱序写入漏掉对齐；读 transcript 途中新画的行被误判消失；渲染行判重为线性；helper 输入格式重复实现；对齐结果解析两次；C 端用哨兵指针表示是否输出行。
- **驳回 2 条**：重查发现消失后再读一次 transcript 是少见路径；地图里 2.1.281 是 Issue 33 当时的门禁版本。

门禁：`2.1.273`/`2.1.283` 各 **272** 项 plugin tests、8 静态、32 bridge、70 helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.283 上通过：重复与多行 prompt 的独立目标、底部与非底部两种焦点状态、`×` 条目无副作用、reload 与 resume 重绑、普通重启失效、收起与展开状态下的 rewind 与 clear。review 修复后在 2.1.283 上补做 PTY 并通过（session `b628a463`–`84c7cffe`）：重复与多行 prompt 的独立目标、展开状态下提交与 rewind、fork 共享前缀重绑、resume 重绑。

