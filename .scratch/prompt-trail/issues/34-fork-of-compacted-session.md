# 34: fork 一个 compact 过的 session 时沿用来源的 Active Branch

**What to build:** 对一个 `/compact` 过的 session 做 `/fork`，fork 出来的子 session 拿到的 transcript 也是 compact 过的，compact 之前的 user 行都不在里面。子 session 有自己的进程，又不知道这份 transcript 被 compact 过：compacted 标记记在来源 session 的键下，fork 拿不到来源 session。于是 `branch-match` 按 `whole` 匹配，链上的祖先找不齐，结果是 `none`，子 session 的第一条 prompt 静默开了无父根，时间线上也就没有「从 Run … 分出」。本票让 bridge 从子 session 的 transcript 认出 compact，并交给插件，让插件按 `truncated` 匹配。

**Blocked by:** 18「在 resume 与 fork 中重建 Conversation Branch」

**Status:** resolved

- [x] ~~bridge 在 SessionStart（source 为 `fork`；`resume` 是否也要，实现前核实）时检查本 session 的 transcript 里有没有从来源复制过来的 `compact_boundary`。有的话，在会话索引和 locator 里写一个可选字段，并在该 session 之后每次发布 locator 时都带上。`locatorVersion`/`indexVersion` 不升。~~（按 Q1 作废：bridge 运行时还读不到这些行，见下方 Comments。作废项，替代做法见下一条。）
- [x] ~~插件的 `parseLocator` 把这个字段当可选字段处理，值不合法时按 locator schema 错误 fail closed。`sessionCompacted` 认这个字段，命中时给本 session 的 compacted 键补写 true。~~（按 Q1 作废：改为由 `sessionCompacted` 识别 transcript 开头的摘要行，命中时同样补写 compacted 键。替代做法已完成：`hooks/branch.ts` 的 `opensOnCompactionSummary`，测试与 `PT-BRANCH-002` 见 Answer。）
- [x] fork 一个 compact 过的 session 后，子 session 的第一条 prompt 挂在来源的最后一条 Prompt Entry 上，时间线显示「从 Run … 分出」。
- [x] fork 一个没 compact 过的 session，行为不变（仍按 `whole` 匹配）。
- [x] 真实 PTY（2.1.281）：R1…Rn → `/compact` → 再提交一条 → `/fork 只回复 BG`，BG 挂在最后一条 prompt 上，并显示「从 Run … 分出」。

## Answer

compact 过的 session 被后台 `/fork` 或 `--resume S --fork-session` 分叉后，子 session 的第一条 prompt 挂在来源的最后一条 Prompt Entry 上，时间线显示「从 Run … 分出」。`--fork-session` 在提交之前就能重新绑定共享历史。做法按 Comments 里的 Q1–Q3，没有改 bridge 和 locator。

- **插件**：
  - `hooks/branch.ts` 新增 `opensOnCompactionSummary`：transcript 的第一行是 person 的 user 行（没有 tool result），而且以 `COMPACTION_SUMMARY_OPENING` 开头。
  - `hooks/register.tsx` 的 `sessionCompacted` 多了可选参数 `messages`，命中时和 `continuedFrom` 的继承一样处理：补写本 session 的 compacted 键，按 `truncated` 匹配。
  - 两处调用都传入当时读到的 transcript：一处是提交时的对齐（`settleAlignment`），另一处是 Jump Target 的对齐。
- **plugin test**（两个版本各 461 项，全部通过）：
  - `resume_fork_branch.test.tsx` 新增两项：compact 过的 fork 按 `truncated` 匹配并写下 compacted 键；摘要文字不在第一行时仍按 `whole` 匹配，也不写键。
  - `jump_target.test.tsx` 新增一项：compact 过的 fork 在提交前就按 `truncated` 绑定共享历史。
  - 三项都先在原代码上看到变红，再修复。
- **PTY**：`PT-BRANCH-002` 在原有步骤之后，让来源先 `/compact`、再提交 C，然后：
  - 后台 `/fork <K>`：K 属于新 Run，父节点是 C；
  - `--resume S --fork-session`：提交前 C 已经可以跳转；之后提交的 M 父节点是 C、属于新 Run，band 显示「从 Run … 分出」。

  `scenarios.json` 里 BRANCH-002 的步骤、预期和 plugin test 引用都已补上。场景在 2.1.273 和 2.1.283 上通过。去掉 hooks 的修复后，场景在 2.1.283 上以「the fork of the compacted session does not go on from its last entry」失败。
- **`verify-startup.sh`**：通过。
- **已知代价**：
  - 依赖宿主摘要的固定措辞。将来措辞变了，只会退回修复前的样子（新开无父根），不会挂错父节点。
  - 如果有人第一条 prompt 恰好以这句话开头，这个 session 会按 `truncated` 匹配。
- **偶发失败与 code review**：两个版本并行跑场景时，2.1.283 有一次在原有断言「--fork-session did not bind the shared history once」上失败：band 展开时 A、B 还是 ×。code review（`.code-review/runs/20261001-104344/round-1`）把它列为 #1。修法：BRANCH-002 的两处 `--fork-session` 检查改用 `wait_bound`，最多等 15 秒，直到条目可以跳转。修改后两个版本并行跑都通过。
- **版本**：插件版本号没动，`release/evidence/0.1.0/` 仍对应 `b61296e`（Q3）。

## Comments

### 2026-09-24 · 从 Issue 33 验收中拆出

Issue 33 的 PTY 第四步（2.1.281）：session `a5675173` 依次提交 R3 → `/compact` → R4、R5、R6 → `/fork 只回复 BG`。fork 子 session `de7e0660` 新开了 Run `fa375d9f`，这符合预期；但 BG 的 `parent_event_id` 为空。

实机取证：
- 子 session 的 transcript 以复制过来的 `compact_boundary` 和 compact 摘要开头，后面是 R4、R5、R6 的副本，没有 R1–R3。复制的行在文件里排在它自己的 `SessionStart:fork` 之前。
- 子 session 的进程是 `claude bg-spare` 预热进程，启动于来源进程接续后不久；它自己没有派发过 `session.compact`，store 里也没有子 session 的 compacted 键。
- 用档案副本重放 `branch-match`（输入截到 BG 提交前，只打印事件 id）：`whole` 得到 `none`，`truncated` 唯一匹配到 R6 `6018b339`。

与使用者对齐：用 bridge 标记（和 `continuedFrom` 的做法一致），不采用「插件在 `whole` 得到 `none` 时退回 `truncated`」。后者会放宽匹配：没 compact 过的 fork，如果尾部碰巧和别的链一致，可能被挂错父节点。

待核实：bridge 运行时，子 transcript 里复制的行是否已经全部落盘。上面「复制的行排在 SessionStart:fork 之前」只说明它们在 hook 结果写入之前就已在文件里。

### 2026-10-01 · 实现前核实与对齐

探针（两个版本：2.1.273、2.1.283）：源 session 依次提交 R1、R2，然后 `/compact`，再提交 R3；之后分别做后台 `/fork <G>` 和 `--resume S --fork-session` 并提交 H。另加载一个只做观察的插件，在 SessionStart 与 `prompt.submit` 时拷下子 transcript，并记下 `$.session.messages()`。

- 两个版本都复现了：G 和 H 的父节点都为空。
- **票面做法行不通**：bridge 执行 SessionStart:fork 时，复制过来的行还没写到磁盘上：
  - 后台 `/fork` 的子 transcript 只有 `ai-title`、`agent-name`、`mode` 等行，没有 `compact_boundary`；
  - `--resume S --fork-session` 的子 transcript 文件这时还不存在，到第一次 `prompt.submit` 时也还不存在。

  后台 `/fork` 的复制行在第一次 `prompt.submit` 之前已经写到磁盘。上面 Comments 里的「待核实」由此得到回答：bridge 运行时，复制的行没有写到磁盘。
- SessionStart 的输入里没有来源 session，只有 `session_id`、`source`、`transcript_path` 和几项用量字段。
- 宿主 API 没有结构化的 compact 标记：`SessionMessage` 只有 `role/text/toolUses/toolResults`；`{ as: "api" }` 里也没有。
- **能用的信号**：两种子 session 在第一次提交时，`$.session.messages()` 的第一行都是宿主写的 compact 摘要。它是一条 user 行、没有 tool result，开头是 `This session is being continued from a previous conversation that ran out of context.`，两个版本的措辞相同。

使用者的决定：
- **Q1 做法**：由插件识别摘要行。对齐时，如果 `$.session.messages()` 的第一行是以这句话开头的 user 行，就按 compacted 处理：补写本 session 的 compacted 键，按 `truncated` 匹配。不改 bridge 和 locator；票面前两条改按这个做法验收。宿主将来改了措辞，行为只会退回今天的样子（新开无父根），不会挂错父节点。
- **Q2 PTY**：扩展 `PT-BRANCH-002`：在原有步骤之后先 `/compact` 再提交一条，然后后台 `/fork` 与 `--fork-session` 各做一次，断言父节点和「从 Run … 分出」。
- **Q3 版本**：插件版本号暂不动；`release/evidence/0.1.0/` 仍对应 `b61296e`。34、35 做完后，再决定是否升到 0.1.1 并重跑门禁。
