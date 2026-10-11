# 23: 完整跳转：Agent 侧、兜底与被拒

**What to build:** 目录里每一侧都能点：Agent 侧跳到本轮最后一段文字回复；本地命令、prompt 型命令、`!cmd` 这些看得见但没有站点的行，兜底跳到紧邻的行并让原输入行留在屏上；实在跳不过去时给出一行说明并让这一侧变暗，不会点了没反应。

规格见 [chat-toc MVP](../spec.md) §5。

**Blocked by:** 18（独立 verifier 与 PTY 验收驱动）、19（完整的开组规则与 Agent reply）

**Status:** resolved

- [x] 挂 `UserMessage`、`AssistantMessage`、`CommandOutput`、`ToolGroup`（只读 `requestId` 与 `onScreen`，不改绘制）
- [x] `requestId` → 行按序匹配：精确 uuid → 去 `collapsed-` 前缀 → tool_use id → 前 24 位；跳转用宿主给的 id；每次读完 transcript 后重建映射，增量时只补新行、重试未解析的 id
- [x] Agent 侧跳到末段所在行；没有末段时跳到本组最后一个可绘制行（`AssistantMessage` 或 `ToolGroup`），本组一个都没有按被拒处理
- [x] 能跳到从没画出过的行，例如 resume 300 轮后跳到第 1 轮（CT-JUMP-001）
- [x] 兜底跳转：往后最近的可绘制行，往后没有再往前，`block: center`，被拒换下一个候选，最多 3 个（CT-JUMP-002）
- [x] 全部被拒时底部显示「这一条当前没有显示在对话里，无法跳转」，下一次跳转、选择移动或约 5 秒后消失；这一侧所有行 `dimColor`，直到行重新被宿主列出；无其他副作用（CT-JUMP-003）
- [x] 不事先淡化任何条目
- [x] 自动化测试覆盖四级匹配与候选顺序；PTY 验收 CT-JUMP-001～003 在两个版本上通过

## Comments

2026-10-11，分支 `chat-toc/23-jumps`。

- **代码**：`hooks/sites.ts` 是站点记录与 `requestId` 匹配（`RowIndex` 按对话链建索引：uuid → 位置、前 24 位、tool_use id；`Sites` 记下画过的 id、它对应的行、跳转用的宿主 id、在屏记录）。`hooks/jump.ts` 给出每一侧按序尝试的目标（`jumpTargetsOf`）、被拒一侧的淡化（`dimRefused`）与恢复（`relisted`）。`register.tsx` 挂四个站点的 `ui.render`（只记录，照常 `next(e)`），每次读完 transcript 后 `syncRows` + `resolveSites`：链是同一个数组只补新行、重试没解析出的 id；换了链（整份重读、rewind）全部重新匹配。
- **宿主事实**（读 2.1.287 二进制的 `reveal`）：宿主在消息列表里按「条目 uuid 相等 → 条目的 tool_use id（单个工具行、grouped、collapsed read/search 的成员）→ 同长度且前 24 位相同」查找；一条多块消息拆成 `<前 24 位><12 位序号>` 的条目。所以从没画出过的工具行可以用它第一个 tool_use id 跳到，不必猜 `collapsed-…`。
- **取舍**（规格没写死的地方）：
  - 兜底候选里的「可绘制行」除规格列的四种外，再加 assistant 的工具行（用 tool_use id 跳）。这样 prompt 型命令落在它的第一个工具组上，而不是一长串工具之后；Agent 侧没有末段时也按同一判断取本组最后的 assistant 行。
  - Agent 侧没有末段时用 `block: 'start'`（这是本侧自己的行，不是邻行）；用户侧兜底才用 `center`。
  - 每次点击都按完整候选表重试（最多 3 个），不跳过上次被拒的行；被拒没有副作用。
  - 淡化的恢复：任一站点画出的行正是这一侧（按当前数据重算的）候选之一时恢复，所以进行中的轮写出新行后也会恢复；跳转成功也会恢复。热重载与 `/clear` 清空。
  - 说明「这一条当前没有显示在对话里，无法跳转」：下一次跳转、选择移到别的条目（25 号的 `ui.focus` 钩子里，含它先挪窗口再落焦点的那一步）、或 5 秒后消失（只清自己那一次的定时器）。和数据源说明同时出现时排在上面，两行同在一个 `Text` 里，`pane.tsx` 没改。
  - 测试 fixture 的 uuid 改成首尾都带序号，前 24 位互不相同（原来全一样，前缀匹配无从测）。
- **给 24 号**：`Sites.onScreen` 已按 `<component>|<requestId>` 存在屏记录与上报序号（`seq`，最大者是最近一次），报 `null` 即删；`rowOf`（id → 行）、`RowIndex.order`（行 → 链上位置）可直接用。还没做：可绘制行的有序数组、连续段切分与二分查找、跳转后锁定。
- **测试**：合入当时的 `chat-toc/mvp`（含 20、21、25）后 `claude plugin test mods/chat-toc` 155 个全过（2.1.295），acceptance 单元测试 43 个通过；`tsc` 对 2.1.287 与 2.1.295 的声明都通过；两版 `plugin validate` 通过。新增 `tests/request_ids.test.ts`（四级匹配、先画后读、增量与换链）、`tests/jump_targets.test.ts`（候选顺序）、`tests/refused_jumps.test.ts`（测试引擎拒绝所有 transcript 跳转，借此测说明、淡化、5 秒、下一次跳转、选择移动、重新画出后恢复）。
- **PTY**：`tests/acceptance/jump_scenarios.py <版本>`（pyte，隔离环境，`--resume` 合成 transcript，不调用模型）。2.1.295 与 2.1.287 各一次全过：
  - CT-JUMP-001：resume 300 轮，点第 1 轮用户侧，prompt 落在顶部；点 Agent 侧，末段落在顶部。
  - CT-JUMP-002：`/tui` 跳到输出行、`! echo` 跳到下一条 prompt，都居中、原输入行留在上方；prompt 型 `/review` 跳到它的工具组、user 行形式的本地命令 `/model` 跳到输出、只有工具的 Agent 侧跳到最后的工具组，都没被拒。
  - CT-JUMP-003：宿主里 Esc Esc rewind（无模型调用）后点被弃分支的条目：底部出现说明、这一侧整段变灰（宿主把 dimColor 画成前景色 999999，pyte 下按颜色判断；悬停会反色，判断前先把指针移开）、另一组不变、transcript 不动；6 秒后说明消失、这一侧仍是灰的。「行重新被宿主列出后恢复」在 PTY 里造不出来（rewind 后无模型无法重新列出），由自动化测试覆盖。
  - 合入 mvp 后两版各重跑一次全过，运行目录：`mods/chat-toc/build/pty-runs/20261011-085207-CT-JUMP-current`、`20261011-085408-CT-JUMP-2.1.287`（gitignore）。
