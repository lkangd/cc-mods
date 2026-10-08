# 33: 接续 session 沿用原 Run 与 Active Branch

**What to build:** 在 Claude Code 2.1.280 中，后台 `/fork` 之后，主线程会换到一个新的 classic session 继续：旧 transcript 末尾写一条 `continued-in`，新 session 由另一个进程承载。bridge 目前把它当作索引里查不到的会话，于是新开 Run；新 session 也没有分支记录。本票要让接续出来的 session 认回原 Run，并沿用原 session 的 Active Branch。

**Blocked by:** 18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** resolved

- [x] bridge 能认出接续：新 session 的 SessionStart 输入里没有来源 session，要从旧 transcript 的 `continued-in` 记录（或宿主提供的等价信号）找到来源 session。认出后沿用来源 session 所属的 Run，写入会话索引，并按 Issue 32 的规则写 `run-attached`。认不出时照旧新开 Run，不猜测。
- [x] 接续 session 的第一次对齐能拿到来源 session 的 Active Branch，作为已存分支使用，所以在时间线上显示为同一 Run 的续接，而不是「从 Run X 分出」。
- [x] 接续前后做过 `/compact`（它会让 `$.session.messages()` 里不再有 compact 之前的 user 行）时，按 Issue 18 的规则走「已存分支被 transcript 否定 → 人工确认」，不再静默开根。
- [x] 同一 Run 同一时刻至多一个存活进程接入的约束不被破坏：旧进程是否仍接入要先核实，再决定写不写 `run-detached`。
- [x] 真实 PTY 在 2.1.280 上覆盖：`/fork` 之后主线程继续提交、`/fork` 之后再 `/compact` 再提交。

## Comments

### 2026-09-23 · 从 Issue 18 验收中拆出

Issue 18 的 PTY 验收（2.1.280）中观察到的事实：
- `/fork 只回复 BG` 之后，主线程 session `208b3bcd` 的 transcript 末尾出现 `continued-in`，对话在新 session `a7504e5c` 中继续，由新进程承载。bridge 为它新开了 Run `5bbc7862`。
- 承载新 session 的进程启动约 10 秒后，bridge 才发布它的 locator。Issue 18 已经让提交和展开时间线时补读 locator 与档案。
- 在新 session 中 `/compact` 后提交 R3，R3 成为新 Run 的根：compact 清掉了 R1、R2，新 session 又没有已存分支，按规则静默开根，与 R2 的链接因此丢失。

### 2026-09-23 · 实现层面对齐（grilling 两轮，使用者均采用）

- **更正票面**：`continued-in` 来自「把会话转到后台」（左箭头或 `/background`），不是 `/fork`。2.1.280 只在 `keepParent` 为假时写这条记录，`/fork` 是 `keepParent: true`。宿主用 `--resume <旧 transcript 路径> --fork-session` 启动新进程，新 session 的 SessionStart source 是 `fork`，hook 输入里没有来源 session；新 transcript 按原 uuid 复制旧行，但没有指向来源的字段。What to build 原文不改。
- **实测时序**：旧 transcript 的 `continued-in` 写在 spawn 返回之后，比新进程 bridge 写会话索引早约 1.05 s（208b3bcd→a7504e5c）和 1.46 s（a7504e5c→64ed343a）。左箭头方式下旧进程转成进程内 attach 视图，仍然存活（208b3bcd 约 3 分钟后才写退出时的 cost-state）。
- **识别**：放在 bridge、锁内。只认 source=`fork`：扫描 hook 输入 `transcript_path` 所在目录里 mtime 在 120 秒内的其他 `.jsonl`，每个只读末尾 64 KiB，从尾部往回找，先碰到 `user`/`assistant` 行就停；`continued-in.continuedInSessionId` 等于本 session 的文件名即来源 session。不重试等待。认不出、来源未索引时照旧新开 Run。
- **占用判定**：接续时，占用来源 Run 的存活进程若只有 locator 指向来源 session 的那些，视为已交出，不算占用；不删不改它们的 locator。有其他存活进程占用时照旧新开 Run。不为旧进程写 `run-detached`：新进程首次写入时照常写 `run-attached`，旧进程退出时 `detachRun` 因 host 已不是它而不写。
- **传递**：只在真正沿用了来源 Run 时，会话索引写可选字段 `continuedFrom`（与 `runId` 同时，首次见到 session 时）；此后每次为该 session 发布 locator（包括 resume）都带上。`locatorVersion`/`indexVersion` 不升。插件 `parseLocator` 把它作为可选字段，存在但不是安全标识符或等于本 session 时按 locator schema 错误 fail closed。helper 不改。
- **Active Branch**：`alignBranch` 首次对齐时本 session 的分支键没有记录且有 `continuedFrom`，读 `branch:<project>:<run>:<来源 session>` 原样作为 stored 走 `settleBranch`，结果写本 session 的键；来源也没有就走现有流程。连续接续逐级继承。`branch-match` 限定范围不改（本 session 在 Run 里无条目时退回全项目，`prefer` 由继承的父节点承担）。
- **compacted**：`sessionCompacted` 看自己的键或来源 session 的键；命中来源时给本 session 的键补写 true。
- **不显示**：`/prompt-history status` 与时间线不显示「接续自」，靠同一 Run 与「Run 续接」边界表达。
- **测试**：bridge 在 `tests/bridge_protocol.py`，插件在新文件 `tests/continued_session.test.tsx`（`support.tsx` 加 `continuedFrom` 选项）。
- **PTY 场景**（2.1.280）：① R1、R2 → 转到后台 → 接续 session 提交 R3，R3 接在 R2 后、同一 Run、显示「Run 续接」；② 转到后台后 `/compact` 再提交，弹出确认父节点；③ 转到后台两次（a→b→c）后提交仍在同一 Run；④ 对照：`/fork` 仍新开 Run。另核实旧进程的 attach 视图不触发它自己的 `prompt.submit`。

### 2026-09-24 · 实现中修订

- **Active Branch 的继承放在 `branchState()`，不在 `alignBranch`**：提交流程里，`drainLifecycle` 写 `run-attached` 时会先调 `branchState()` 创建本 session 的分支记录，这一步在 `alignBranch` 之前。所以 `alignBranch` 里「本 session 没有记录」的分支永远走不到，已删除。现在由 `branchState()` 负责：本 session 的键没有记录且有 `continuedFrom` 时，原样沿用来源 session 的分支记录并写入本 session 的键；来源也没有记录时，照旧新建。`alignBranch` 读到的就是继承下来的 stored，后面照常走 `settleBranch`。

### 2026-09-24 · PTY 第一轮（2.1.281）与诊断

- 宿主已升级到 2.1.281。
- ① 通过：`5567743a` → `a5675173` 同属 Run `c5ff3c3d`，R3 挂在 R2 上，写了 `run-attached`。旧进程没有写 `run-detached`，接续后仍存活。
- ② 不是缺陷，是判据写错了：接续 session 里先提交了 R3，再 `/compact`，再提交 R4。本进程已经对齐过，又亲自见到了这次 compact，按 Issue 19 的规则以 compact 后的 transcript 为基线，R4 挂在 R3 上，不问。重跑时改成「转到后台后先 `/compact`，再第一次提交」（`e5264e0f`→`ffc674f1`），仍然不问，R3 挂在 R2 上，这也是对的：接续进程启动时已经载入 R1、R2，自己 compact 之后，`messages()` 仍然留着这两行（Issue 19 实测过：同一进程内 compact 后仍保留 compact 前的行）。用档案副本重放 `branch-match`：带上 R1、R2，`truncated` 唯一匹配到 R2；只给 compact 之后的行，结果是 `none`。只有 R2 能解释实际结果。所以只有「接续之前」的 compact 才会触发询问：先 `/compact`，再转到后台，新进程载入的已是 compact 过的 transcript。「接续之后」的 compact 不需要询问。
- ③ 数据里没有两次接续，只有两段单跳（`b6410d63`→`efa86f2f`、`5567743a`→`a5675173`），需要重跑。另外，`efa86f2f` 由 `claude bg-spare` 预热进程承载，从未提交过；随后的 `c7d1dac0` 是新启动的 session，不是接续。
- ④ `/fork` 新开 Run，这符合预期。但 BG 没挂上父节点：fork 子 session 继承了 compact 过的 transcript，却不知道它被 compact 过，按 `whole` 匹配得到 `none`。这是 Issue 18 就有的缺口，已拆到 Issue 34。
- ② 改过判据后重跑，通过：R1、R2 → `/compact` → 转到后台（`e39bbded`→`489bb81e`）→ 提交 R3，弹出「确认父节点」。选了 R2，这次提交被 drop，草稿回到输入框；重新提交后 R3 挂在 R2 上，同属 Run `49f796ff`，写了 `run-attached`。
- ③ 重跑：R1、R2 → 转到后台（`522fc6a2`→`9e6626c9`）→ 再转到后台 → 提交 R3。R3 挂在 R2 上，同属 Run `863149bc`，写了 `run-attached`。但只接续了一次：`9e6626c9` 由 daemon 的 `bg-spare` 预热进程承载，它的 transcript 里没有 `continued-in`，第二次「转到后台」没有生成新的 session。推测 2.1.281 中已经在后台进程里的 session 再转到后台只是把界面脱开，真实 PTY 造不出 a→b→c 链；`handed_off_chain` 的逐级回溯只由 bridge 测试覆盖。同一时刻 daemon 另起了一个带 `--plugin-dir` 的空 session `9d48c819`（没有 transcript），bridge 为它开了一个没有条目的 Run，无影响。

## Answer

接续出来的 session（把会话转到后台后，在另一个进程里继续的那个）现在沿用来源 session 的 Run 和 Active Branch。实现在 `9cffee7`；与对齐结论不同的地方，见上方「实现中修订」。

- **识别**：由 bridge 在锁内完成，只认 source=`fork` 且还没有索引的 session。它扫描同目录里 120 秒内、且不在未来修改过的 `.jsonl`，每个只读尾部 64 KiB，从尾行往回找，先碰到 `user`/`assistant` 行就停；`continued-in` 指名本 session 的那个文件就是来源，而且必须恰好只有一个。认出后沿用来源的 Run，会话索引和之后每次发布的 locator 都带可选字段 `continuedFrom`。交接链上的存活进程不算占用 Run；不为仍然存活的旧进程写 `run-detached`，所以时间线上是「Run 未记录离开」接着「Run 续接」。
- **分支与 compact**：`branchState()` 让还没有分支记录的接续 session 原样沿用来源的记录；`sessionCompacted()` 也认来源 session 的 compacted 键。只有「接续之前」的 compact 会触发确认父节点；接续之后在本进程里 compact，`messages()` 仍保留 compact 之前的行，transcript 能证明父节点，不询问是对的。
- **修正 Issue 18/32 的说明**：`continued-in` 来自「转到后台」，不是 `/fork`；`/fork` 与 `--fork-session` 照旧新开 Run，只有被认出的后台接续才沿用来源 Run。会话索引在 Issue 32 定下的 `indexVersion/sessionId/runId/archiveGeneration` 之外，多了可选字段 `continuedFrom`（存在但不是安全标识符时按 `session-index-invalid` 失败关闭）。
- **给后续实现者**：
  - 2.1.281 的 daemon 用 `claude bg-spare` 预热进程承载后台 session，接续 session 可能由它承载。同一时刻 daemon 还可能另起一个带 `--plugin-dir` 的空 session，bridge 会给它开一个没有条目的 Run，无害。
  - 2.1.281 上连续两次接续造不出来：已经在后台进程里的 session，再转到后台只是把界面脱开。链式回溯只由 bridge 测试覆盖；中间 session 从未提交时 C 继承不到分支，已进 backlog。
  - fork 一个 compact 过的 session 会挂不上父节点，是 Issue 18 就有的缺口，拆为 Issue 34。

一轮 `/code-review` 找到 10 条：修了 3 条（索引里类型不对的 `continuedFrom` 改为失败关闭、排除 mtime 在未来的 transcript、扫描到第二个匹配即停）；4 条说明性修正写在本 Answer 与 map 里；3 条进 backlog（major 1 条 `20260924-multi-hop-continuation-inheritance.md`，另两条追加到 `20260922-cleanup-minor-batch.md`）。

门禁：当前版本从 2.1.280 改为 2.1.281。`2.1.273`/`2.1.281` 各 **206** 项 plugin tests、8 静态、**32** bridge、57 helper，TypeScript 与确定性重建全部通过。真人 PTY 在 2.1.281 上通过：转到后台后继续提交（同一 Run、R3 接在 R2 后）、先 `/compact` 再转到后台后提交（弹出确认父节点）、`/fork` 仍新开 Run；review 修复后做了冒烟复验。
